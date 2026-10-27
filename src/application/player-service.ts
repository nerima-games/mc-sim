/**
 * PlayerService — the authoritative player pose, and the only publisher of
 * `CameraPoseSnapshot`.
 *
 * This is the service that makes plan.md §5.1-2 ("camera pose is owned by sim")
 * true rather than aspirational. mc-render calls `cameraPose` and mirrors the
 * result; there is no path by which a renderer can write a pose back, because
 * this API exposes no such method and mc-sim cannot see mc-render at all.
 *
 * `cameraPose` is the one function here that touches `ClockPort`, because a
 * snapshot must be stamped with the instant the simulation produced it — that
 * stamp is what lets a renderer running ahead of or behind the simulation
 * measure the gap instead of silently drawing a stale pose.
 */
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import * as Camera from '../domain/camera-pose.js'
import type { CameraPoseSnapshot, Dimension, DimensionRevision, Position, WorldRevision } from "@nerima-games/mc-kernel"
import { ClockPort, monotonicSecs } from "@nerima-games/mc-kernel"
import {
  PLAYER_REPLICATED_OWNER_ID,
  PlayerServiceSnapshotSchema,
  type ReplicatedOwnerChange,
  type ReplicatedSnapshot,
  type ReplicatedWorldDelta,
} from './replicated-state.js'
import {
  ReplicatedOwnerUnknown,
  WorldCommitCoordinator,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'

/**
 * The dimension a fresh world starts in.
 *
 * mc-sim's OWN decision rather than a transcription — mc-kernel owns the word
 * `Dimension`, not the answer to "where does a new player appear". It is
 * exported because `reset`'s meaning is otherwise unobservable from outside: a
 * caller that wants to assert what a re-entrant world load produced needs the
 * constant, and reading it here is better than restating `'overworld'` at every
 * such call site.
 */
export const INITIAL_PLAYER_DIMENSION: Dimension = 'overworld'

/**
 * Pose and dimension as one value, because they are written together.
 *
 * This is the service's coordinate-only working state. `replicatedCandidate`
 * adds the world-position shape, and only the coordinator-backed `snapshot`
 * exposes committed replicated state.
 */
type PlayerState = {
  readonly pose: Camera.PlayerPose
  readonly dimension: Dimension
}

type PlayerReplicatedState = Schema.Schema.Type<typeof PlayerServiceSnapshotSchema>

const playerReplicatedCandidateOf = (current: PlayerState) => ({
  pose: {
    feetPosition: {
      dimension: current.dimension,
      x: current.pose.feetPosition.x,
      y: current.pose.feetPosition.y,
      z: current.pose.feetPosition.z,
    },
    yawRadians: current.pose.yawRadians,
    pitchRadians: current.pose.pitchRadians,
  },
})

export type PlayerServiceApi = {
  readonly pose: Effect.Effect<Camera.PlayerPose>
  /** The dimension currently associated with the player's pose. */
  readonly dimension: Effect.Effect<Dimension>
  /** Rotate the view. Pitch is clamped; yaw is not wrapped. */
  readonly look: (deltaYaw: number, deltaPitch: number) => Effect.Effect<Camera.PlayerPose>
  /** Move to a feet-origin position. The name carries the coordinate convention. */
  readonly moveTo: (feetPosition: Position) => Effect.Effect<void>
  /** Change the player's dimension. Position changes remain a separate operation. */
  readonly setDimension: (dimension: Dimension) => Effect.Effect<void>
  /** Build the render pose using the supplied simulation clock. */
  readonly cameraPose: Effect.Effect<CameraPoseSnapshot, never, ClockPort>
  /** Read the player state and revision from the world-session committed snapshot. */
  readonly snapshot: Effect.Effect<
    ReplicatedSnapshot<typeof PlayerServiceSnapshotSchema>,
    Schema.SchemaError | ReplicatedOwnerUnknown,
    WorldCommitCoordinator
  >
  /** Build an owner candidate from the current service state; this is not a committed snapshot. */
  readonly replicatedCandidate: Effect.Effect<PlayerReplicatedState, Schema.SchemaError>
  /** Submit the current player candidate through the world coordinator. */
  readonly submitReplicatedCandidate: (
    expectedRevision: WorldRevision,
    expectedDimensionRevision: DimensionRevision,
  ) => Effect.Effect<ReplicatedWorldDelta<ReplicatedOwnerChange>, WorldCommitCoordinatorError, WorldCommitCoordinator>
  /** Restore the pose and dimension together. */
  readonly restore: (pose: Camera.PlayerPose, dimension: Dimension) => Effect.Effect<void>
  /** Reset the pose and dimension to their fresh-world values. */
  readonly reset: Effect.Effect<void>
}

const PlayerServiceBase: Context.ServiceClass<PlayerService, '@nerima-games/mc-sim/PlayerService', PlayerServiceApi> =
  Context.Service<PlayerService, PlayerServiceApi>()('@nerima-games/mc-sim/PlayerService')

export class PlayerService extends PlayerServiceBase {}

export const makePlayerService = (
  initial: Camera.PlayerPose = Camera.INITIAL_PLAYER_POSE,
  initialDimension: Dimension = INITIAL_PLAYER_DIMENSION,
): Effect.Effect<PlayerServiceApi> =>
  Effect.map(Ref.make<PlayerState>({ pose: initial, dimension: initialDimension }), (state) => {
    const replicatedCandidate = Effect.flatMap(Ref.get(state), (current) =>
      Schema.decodeUnknownEffect(PlayerServiceSnapshotSchema)(playerReplicatedCandidateOf(current)),
    )

    return {
      pose: Effect.map(Ref.get(state), (current) => current.pose),
      dimension: Effect.map(Ref.get(state), (current) => current.dimension),
      look: (deltaYaw, deltaPitch) =>
        Ref.modify(state, (current) => {
          const next = Camera.applyLook(current.pose, deltaYaw, deltaPitch)
          return [next, { ...current, pose: next }]
        }),
      moveTo: (feetPosition) =>
        Ref.update(state, (current) => ({
          ...current,
          pose: Camera.withFeetPosition(current.pose, feetPosition),
        })),
      setDimension: (dimension) => Ref.update(state, (current) => ({ ...current, dimension })),
      cameraPose: Effect.flatMap(monotonicSecs, (now) =>
        Effect.map(Ref.get(state), (current) => Camera.cameraPoseOf(current.pose, now)),
      ),
      snapshot: Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
        coordinator.snapshot(PLAYER_REPLICATED_OWNER_ID, PlayerServiceSnapshotSchema),
      ),
      replicatedCandidate,
      submitReplicatedCandidate: (expectedRevision, expectedDimensionRevision) =>
        Effect.flatMap(replicatedCandidate, (candidate) =>
          Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
            Effect.flatMap(
              coordinator.snapshot(PLAYER_REPLICATED_OWNER_ID, PlayerServiceSnapshotSchema),
              (committed) => {
                const previousDimension = committed.state.pose.feetPosition.dimension
                const nextDimension = candidate.pose.feetPosition.dimension
                const changes = [{ ownerId: PLAYER_REPLICATED_OWNER_ID, state: candidate }] as const

                if (previousDimension === nextDimension) {
                  return coordinator.commit({
                    expectedRevision,
                    expectedDimensions: [{ dimension: previousDimension, expectedRevision: expectedDimensionRevision }],
                    changes,
                  })
                }

                return Effect.flatMap(coordinator.dimensionRevision(nextDimension), (nextDimensionRevision) =>
                  coordinator.commit({
                    expectedRevision,
                    expectedDimensions: [
                      { dimension: previousDimension, expectedRevision: expectedDimensionRevision },
                      { dimension: nextDimension, expectedRevision: nextDimensionRevision },
                    ],
                    changes,
                  }),
                )
              },
            ),
          ),
        ),
      restore: (pose, dimension) => Ref.set(state, { pose, dimension }),
      reset: Ref.set(state, { pose: Camera.INITIAL_PLAYER_POSE, dimension: INITIAL_PLAYER_DIMENSION }),
    }
  })

export const PlayerServiceLayer = (
  initial: Camera.PlayerPose = Camera.INITIAL_PLAYER_POSE,
  initialDimension: Dimension = INITIAL_PLAYER_DIMENSION,
): Layer.Layer<PlayerService> =>
  Layer.effect(PlayerService, makePlayerService(initial, initialDimension))
