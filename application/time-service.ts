/**
 * TimeService — the Ref wrapper around `domain/time-of-day.ts`.
 *
 * Every mutator is `Ref.modify` or `Ref.update`, never `Ref.get` followed by
 * `Ref.set`. plan.md §3.8 lists `Ref.modify` for TOCTOU avoidance among the
 * Effect conventions to carry over, and the reason is concrete: between a
 * separate get and set, another fiber (the autosave daemon, a network message
 * handler, a stage running concurrently) can interleave and have its write
 * silently discarded. `Ref.modify` performs the read-decide-write as one atomic
 * step and returns the decision.
 *
 * Reference: ts-minecraft/packages/entity/application/player-service.ts:22-29
 * and .../health-service.ts:68-86 are the two clearest examples of the pattern
 * — an existence check fused with the insert, and a damage transition that
 * computes `justDied` inside the same step so the death signal fires once.
 */
import { Context, Effect, Layer, Ref } from 'effect'
import type { DeltaTimeSecs } from '../domain/kernel-vocabulary'
import * as Time from '../domain/time-of-day'

export type TimeServiceApi = {
  /** Advance the world clock by one frame. The delta is supplied, never read. */
  readonly advance: (dt: DeltaTimeSecs) => Effect.Effect<void>
  /** Position within the current day, in [0, 1). */
  readonly timeOfDay: Effect.Effect<number>
  /** Day length in seconds. */
  readonly dayLengthSecs: Effect.Effect<number>
  /** Which of the eight moon phases tonight is. */
  readonly moonPhase: Effect.Effect<number>
  readonly isNight: Effect.Effect<boolean>
  /**
   * Install a new day length.
   *
   * DANGER: this moves the current time of day as a side effect — the tick
   * counter is absolute and this changes its denominator. See
   * `domain/time-of-day.ts`. Prefer `configureDay`, which does both in the only
   * safe order. Reach for this alone only when the time of day genuinely must
   * be left to float (e.g. a settings change mid-session), and only after
   * deciding that on purpose.
   */
  readonly setDayLength: (seconds: number) => Effect.Effect<void>
  /** Move to a position within the current day, using the CURRENT day length. */
  readonly setTimeOfDay: (fraction: number) => Effect.Effect<void>
  /**
   * Set day length and time of day together, in the order that works.
   *
   * This is what world bootstrap and world load should call. The reference's
   * bootstrap gets the order right by hand
   * (ts-minecraft/.../session-bootstrap-world-presentation-time.ts:26-27);
   * making it one call means it cannot be got wrong by the next caller.
   */
  readonly configureDay: (dayLengthSeconds: number, timeOfDayFraction: number) => Effect.Effect<void>
  /** Whole state, for persistence. */
  readonly snapshot: Effect.Effect<Time.TimeState>
  /** Restore from persistence. Used by world load and by `reset`. */
  readonly restore: (state: Time.TimeState) => Effect.Effect<void>
}

export class TimeService extends Context.Tag('@nerima-games/mc-sim/TimeService')<
  TimeService,
  TimeServiceApi
>() {}

/**
 * Build a TimeService over a fresh Ref.
 *
 * Exported separately from the Layer so that a caller wanting several
 * independent worlds in one process (mc-playground-kit, running two previews
 * side by side) can have several, rather than fighting an app-scoped singleton.
 * plan.md §3.8's re-entrancy requirement is easiest to satisfy by not creating
 * the shared thing in the first place.
 */
export const makeTimeService = (
  initial: Time.TimeState = Time.INITIAL_TIME_STATE,
): Effect.Effect<TimeServiceApi> =>
  Effect.map(Ref.make(initial), (state) => ({
    advance: (dt) => Ref.update(state, (current) => Time.advance(current, dt)),
    timeOfDay: Ref.get(state).pipe(Effect.map(Time.timeOfDay)),
    dayLengthSecs: Ref.get(state).pipe(Effect.map(Time.dayLengthSecs)),
    moonPhase: Ref.get(state).pipe(Effect.map(Time.moonPhase)),
    isNight: Ref.get(state).pipe(Effect.map(Time.isNight)),
    setDayLength: (seconds) => Ref.update(state, (current) => Time.setDayLength(current, seconds)),
    setTimeOfDay: (fraction) => Ref.update(state, (current) => Time.setTimeOfDay(current, fraction)),
    configureDay: (dayLengthSeconds, timeOfDayFraction) =>
      Ref.update(state, (current) =>
        Time.setDayLengthThenTimeOfDay(current, dayLengthSeconds, timeOfDayFraction),
      ),
    snapshot: Ref.get(state),
    restore: (next) => Ref.set(state, next),
  }))

export const TimeServiceLayer = (
  initial: Time.TimeState = Time.INITIAL_TIME_STATE,
): Layer.Layer<TimeService> => Layer.effect(TimeService, makeTimeService(initial))
