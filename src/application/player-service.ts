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
import { Context, Effect, Layer, Ref } from 'effect'
import * as Camera from '../domain/camera-pose'
import type { CameraPoseSnapshot, Position } from "@nerima-games/mc-kernel"
import { ClockPort, monotonicSecs } from "@nerima-games/mc-kernel"
import type { Dimension } from '@nerima-games/mc-worldgen'

/**
 * The dimension a fresh world starts in.
 *
 * mc-sim's OWN decision rather than a transcription — mc-worldgen owns the word
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
 * NOT PUBLISHED as a persistence format and deliberately not called a snapshot:
 * `VitalsServiceApi.snapshot` exists because mc-save needs the whole of the
 * vitals, and no caller has asked for the whole of the player yet. Adding one
 * here on speculation is plan.md §8's second risk. This type exists so that the
 * two fields share a single `Ref` — see the header of `application/
 * vitals-service.ts` for why a two-step read-decide-write is the hazard.
 */
type PlayerState = {
  readonly pose: Camera.PlayerPose
  readonly dimension: Dimension
}

export type PlayerServiceApi = {
  readonly pose: Effect.Effect<Camera.PlayerPose>
  /**
   * Which world the player is in.
   *
   * THE STATE THAT MAKES A PORTAL CROSSING COMPLETABLE. mc-worldgen's
   * `resolveNetherTravel` takes a `from: Dimension` and returns a
   * `toDimension`, and until this member existed nothing could answer the first
   * or receive the second — `mx-gameplay/domain/player-port.ts` recorded the gap
   * by name, and this is the member it named.
   *
   * mc-sim NEVER READS THIS VALUE. Nothing here branches on it; the type is
   * imported directly from mc-worldgen.
   */
  readonly dimension: Effect.Effect<Dimension>
  /** Rotate the view. Pitch is clamped; yaw is not wrapped. */
  readonly look: (deltaYaw: number, deltaPitch: number) => Effect.Effect<Camera.PlayerPose>
  /** Move to a feet-origin position. The name carries the coordinate convention. */
  readonly moveTo: (feetPosition: Position) => Effect.Effect<void>
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
  readonly setDimension: (dimension: Dimension) => Effect.Effect<void>
  /**
   * The snapshot mc-render mirrors. Stamped from `ClockPort`.
   *
   * Deliberately an `Effect` requiring `ClockPort` rather than a plain read:
   * making the clock dependency visible in the type is what stops someone
   * "simplifying" this into a `Date.now()` call. The tests and code review keep
   * the wall-clock boundary explicit.
   */
  readonly cameraPose: Effect.Effect<CameraPoseSnapshot, never, ClockPort>
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
   * No error channel, deliberately, for the reason `VitalsServiceApi.restore`
   * has none: failing a world load over a recoverable field turns a repairable
   * save into an unopenable one.
   */
  readonly restore: (pose: Camera.PlayerPose, dimension: Dimension) => Effect.Effect<void>
  /**
   * Return to the fresh-world pose AND dimension. Required for re-entrant world
   * loads.
   *
   * The dimension is reset too. A `reset` that returned the pose to spawn while
   * leaving the player in the Nether is the DN-09 failure the other services'
   * `reset` notes describe — a teardown path that silently keeps one field of
   * the world it was told to discard.
   */
  readonly reset: Effect.Effect<void>
}

export class PlayerService extends Context.Tag('@nerima-games/mc-sim/PlayerService')<
  PlayerService,
  PlayerServiceApi
>() {}

export const makePlayerService = (
  initial: Camera.PlayerPose = Camera.INITIAL_PLAYER_POSE,
  initialDimension: Dimension = INITIAL_PLAYER_DIMENSION,
): Effect.Effect<PlayerServiceApi> =>
  Effect.map(Ref.make<PlayerState>({ pose: initial, dimension: initialDimension }), (state) => ({
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
    restore: (pose, dimension) => Ref.set(state, { pose, dimension }),
    reset: Ref.set(state, { pose: Camera.INITIAL_PLAYER_POSE, dimension: INITIAL_PLAYER_DIMENSION }),
  }))

export const PlayerServiceLayer = (
  initial: Camera.PlayerPose = Camera.INITIAL_PLAYER_POSE,
  initialDimension: Dimension = INITIAL_PLAYER_DIMENSION,
): Layer.Layer<PlayerService> =>
  Layer.effect(PlayerService, makePlayerService(initial, initialDimension))
