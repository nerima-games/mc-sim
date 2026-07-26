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
import type { CameraPoseSnapshot, Position } from '../domain/kernel-vocabulary'
import { ClockPort, monotonicSecs } from '../domain/kernel-vocabulary'

export type PlayerServiceApi = {
  readonly pose: Effect.Effect<Camera.PlayerPose>
  /** Rotate the view. Pitch is clamped; yaw is not wrapped. */
  readonly look: (deltaYaw: number, deltaPitch: number) => Effect.Effect<Camera.PlayerPose>
  /** Move to a feet-origin position. The name carries the coordinate convention. */
  readonly moveTo: (feetPosition: Position) => Effect.Effect<void>
  /**
   * The snapshot mc-render mirrors. Stamped from `ClockPort`.
   *
   * Deliberately an `Effect` requiring `ClockPort` rather than a plain read:
   * making the clock dependency visible in the type is what stops someone
   * "simplifying" this into a `Date.now()` call, which `pnpm check:deps` would
   * reject anyway but which would then have to be un-designed rather than
   * un-written.
   */
  readonly cameraPose: Effect.Effect<CameraPoseSnapshot, never, ClockPort>
  readonly restore: (pose: Camera.PlayerPose) => Effect.Effect<void>
  /** Return to the fresh-world pose. Required for re-entrant world loads. */
  readonly reset: Effect.Effect<void>
}

export class PlayerService extends Context.Tag('@nerima-games/mc-sim/PlayerService')<
  PlayerService,
  PlayerServiceApi
>() {}

export const makePlayerService = (
  initial: Camera.PlayerPose = Camera.INITIAL_PLAYER_POSE,
): Effect.Effect<PlayerServiceApi> =>
  Effect.map(Ref.make(initial), (state) => ({
    pose: Ref.get(state),
    look: (deltaYaw, deltaPitch) =>
      Ref.modify(state, (current) => {
        const next = Camera.applyLook(current, deltaYaw, deltaPitch)
        return [next, next]
      }),
    moveTo: (feetPosition) => Ref.update(state, (current) => Camera.withFeetPosition(current, feetPosition)),
    cameraPose: Effect.flatMap(monotonicSecs, (now) =>
      Effect.map(Ref.get(state), (current) => Camera.cameraPoseOf(current, now)),
    ),
    restore: (pose) => Ref.set(state, pose),
    reset: Ref.set(state, Camera.INITIAL_PLAYER_POSE),
  }))

export const PlayerServiceLayer = (
  initial: Camera.PlayerPose = Camera.INITIAL_PLAYER_POSE,
): Layer.Layer<PlayerService> => Layer.effect(PlayerService, makePlayerService(initial))
