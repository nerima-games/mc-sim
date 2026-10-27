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
import { Context, Effect, Layer, Ref, Result, Schema } from 'effect'
import * as Camera from '../domain/camera-pose.js'
import type { CameraPoseSnapshot, Dimension, DimensionRevision, Position, WorldRevision } from "@nerima-games/mc-kernel"
import { ClockPort, DIMENSIONS, monotonicSecs } from "@nerima-games/mc-kernel"
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
  readonly look: (deltaYaw: number, deltaPitch: number) => Effect.Effect<Camera.PlayerPose, PlayerServiceInputError>
  /** Move to a feet-origin position. The name carries the coordinate convention. */
  readonly moveTo: (feetPosition: Position) => Effect.Effect<void, PlayerServiceInputError>
  /**
   * Record that the player is now in another world.
   *
   * SEPARATE FROM `moveTo`, AND THAT IS A DECISION WITH A COST. A single
   * `travelTo(dimension, feetPosition)` would make the two writes atomic and
   * would make "moved without switching" unrepresentable, which is the defect
   * `mx-gameplay/domain/player-port.ts` describes: a destination in the other
   * world's coordinate frame applied to a world that was never switched.
   *
   * It is still two members, because the two are not always paired. `moveTo`
   * alone is every ordinary movement in a world — walking, respawning, a
   * teleport within one dimension — and it is called far more often than this.
   * Fusing them would put a `Dimension` argument on the hot path and force every
   * caller to restate the dimension it is already in, which is the way that
   * argument gets passed wrongly. The pairing is the CALLER's to get right and
   * it is a rule, so it lives in mx-gameplay where the other portal rules are;
   * `test/player-service.test.ts` pins that both orders leave the same state, so
   * a caller doing them in either order is safe.
   */
  readonly setDimension: (dimension: Dimension) => Effect.Effect<void, PlayerServiceInputError>
  /** Build the render pose using the supplied simulation clock. */
  readonly cameraPose: Effect.Effect<CameraPoseSnapshot, Camera.CameraPoseError, ClockPort>
  /**
   * THE WORLD-LOAD PATH. Both halves of the player's location, together.
   *
   * `dimension` IS A REQUIRED SECOND PARAMETER rather than an optional one, and
   * that is the whole reason this signature changed rather than gaining a
   * sibling. A `restore(pose)` that left the dimension alone would load a save
   * taken in the Nether into a player standing at the saved coordinates in the
   * Overworld — no crash, no error, and the only bug report available is "my
   * save opens in the wrong place". An optional parameter produces exactly that
   * for every caller that does not know to pass it, which is every caller
   * written before this member existed.
   *
   * Invalid runtime values fail before replacing the current state, so a bad
   * save cannot poison later camera snapshots.
   */
  readonly restore: (pose: Camera.PlayerPose, dimension: Dimension) => Effect.Effect<void, PlayerServiceInputError>
  /**
   * Return to the fresh-world pose AND dimension. Required for re-entrant world
   * loads.
   *
   * The dimension is reset too. A `reset` that returned the pose to spawn while
   * leaving the player in the Nether is the DN-09 failure the other services'
   * `reset` notes describe — a teardown path that silently keeps one field of
   * the world it was told to discard.
   */
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
  /** Reset the pose and dimension to their fresh-world values. */
  readonly reset: Effect.Effect<void>
}

const PlayerServiceBase: Context.ServiceClass<PlayerService, '@nerima-games/mc-sim/PlayerService', PlayerServiceApi> =
  Context.Service<PlayerService, PlayerServiceApi>()('@nerima-games/mc-sim/PlayerService')

export class PlayerService extends PlayerServiceBase {}

export type PlayerServiceInputError = Readonly<{
  _tag: 'PlayerServiceInputError'
  reason: 'invalid-look' | 'invalid-pose' | 'invalid-position' | 'invalid-dimension'
  field: 'pose' | 'deltaYaw' | 'deltaPitch' | 'yawRadians' | 'pitchRadians' | 'feetPosition' | 'feetPosition.x' | 'feetPosition.y' | 'feetPosition.z' | 'dimension'
}>

const inputError = (
  reason: PlayerServiceInputError['reason'],
  field: PlayerServiceInputError['field'],
): PlayerServiceInputError => ({ _tag: 'PlayerServiceInputError', reason, field })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const invalidPositionField = (feetPosition: unknown): PlayerServiceInputError['field'] | undefined => {
  if (!isRecord(feetPosition)) return 'feetPosition'
  if (typeof feetPosition['x'] !== 'number' || !Number.isFinite(feetPosition['x'])) return 'feetPosition.x'
  if (typeof feetPosition['y'] !== 'number' || !Number.isFinite(feetPosition['y'])) return 'feetPosition.y'
  if (typeof feetPosition['z'] !== 'number' || !Number.isFinite(feetPosition['z'])) return 'feetPosition.z'
  return undefined
}

const invalidPoseError = (
  pose: unknown,
  reason: PlayerServiceInputError['reason'],
): PlayerServiceInputError | undefined => {
  if (!isRecord(pose)) return inputError(reason, 'pose')
  if (typeof pose['yawRadians'] !== 'number' || !Number.isFinite(pose['yawRadians'])) return inputError(reason, 'yawRadians')
  if (typeof pose['pitchRadians'] !== 'number' || !Number.isFinite(pose['pitchRadians'])) return inputError(reason, 'pitchRadians')
  const positionField = invalidPositionField(pose['feetPosition'])
  return positionField === undefined ? undefined : inputError(reason, positionField)
}

export const makePlayerService = (
  initial: Camera.PlayerPose = Camera.INITIAL_PLAYER_POSE,
  initialDimension: Dimension = INITIAL_PLAYER_DIMENSION,
): Effect.Effect<PlayerServiceApi, PlayerServiceInputError> =>
  Effect.gen(function* () {
    const initialError = invalidPoseError(initial, 'invalid-pose')
    if (initialError !== undefined) return yield* Effect.fail(initialError)

    const state = yield* Ref.make<PlayerState>({ pose: initial, dimension: initialDimension })
    const modify = <A>(f: (current: PlayerState) => readonly [Effect.Effect<A, PlayerServiceInputError>, PlayerState]) =>
      Ref.modify(state, f).pipe(Effect.flatten)

    return {
      pose: Effect.map(Ref.get(state), (current) => current.pose),
      dimension: Effect.map(Ref.get(state), (current) => current.dimension),
      replicatedCandidate: Effect.flatMap(Ref.get(state), (current) =>
        Schema.decodeUnknownEffect(PlayerServiceSnapshotSchema)(playerReplicatedCandidateOf(current)),
      ),
      look: (deltaYaw, deltaPitch) => modify((current) => {
        if (!Number.isFinite(deltaYaw))
          return [Effect.fail(inputError('invalid-look', 'deltaYaw')), current]
        if (!Number.isFinite(deltaPitch))
          return [Effect.fail(inputError('invalid-look', 'deltaPitch')), current]

        const result = Camera.applyLook(current.pose, deltaYaw, deltaPitch)
        if (Result.isFailure(result)) {
          const field = Number.isFinite(current.pose.yawRadians + deltaYaw)
            ? 'pitchRadians'
            : 'yawRadians'
          return [Effect.fail(inputError('invalid-look', field)), current]
        }
        const next = result.success
        const nextError = invalidPoseError(next, 'invalid-look')
        return nextError === undefined
          ? [Effect.succeed(next), { ...current, pose: next }]
          : [Effect.fail(nextError), current]
      }),
      moveTo: (feetPosition) => modify((current) => {
        const positionField = invalidPositionField(feetPosition)
        if (positionField !== undefined)
          return [Effect.fail(inputError('invalid-position', positionField)), current]
        return [Effect.void, { ...current, pose: Camera.withFeetPosition(current.pose, feetPosition) }]
      }),
      setDimension: (dimension) =>
        DIMENSIONS.includes(dimension)
          ? Ref.update(state, (current) => ({ ...current, dimension }))
          : Effect.fail(inputError('invalid-dimension', 'dimension')),
      cameraPose: Effect.flatMap(monotonicSecs, (now) =>
        Effect.flatMap(Ref.get(state), (current) => Effect.fromResult(Camera.cameraPoseOf(current.pose, now))),
      ),
      snapshot: Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
        coordinator.snapshot(PLAYER_REPLICATED_OWNER_ID, PlayerServiceSnapshotSchema),
      ),
      submitReplicatedCandidate: (expectedRevision, expectedDimensionRevision) =>
        Effect.flatMap(
          Effect.flatMap(Ref.get(state), (current) =>
            Schema.decodeUnknownEffect(PlayerServiceSnapshotSchema)(playerReplicatedCandidateOf(current)),
          ),
          (candidate) => Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
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
      restore: (pose, dimension) => {
        const error = invalidPoseError(pose, 'invalid-pose')
        return error === undefined ? Ref.set(state, { pose, dimension }) : Effect.fail(error)
      },
      reset: Ref.set(state, { pose: Camera.INITIAL_PLAYER_POSE, dimension: INITIAL_PLAYER_DIMENSION }),
    }
  })

export const PlayerServiceLayer = (
  initial: Camera.PlayerPose = Camera.INITIAL_PLAYER_POSE,
  initialDimension: Dimension = INITIAL_PLAYER_DIMENSION,
): Layer.Layer<PlayerService, PlayerServiceInputError> =>
  Layer.effect(PlayerService, makePlayerService(initial, initialDimension))
