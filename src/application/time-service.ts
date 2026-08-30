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
import type { DeltaTimeSecs } from "@nerima-games/mc-kernel"
import * as Time from '../domain/time-of-day.js'

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
   * WORLD BOOTSTRAP CALLS THIS. WORLD LOAD CALLS `restore`, NOT THIS.
   *
   * An earlier version of this comment said "world bootstrap and world load",
   * and the second half was wrong in a way that only shows up several in-game
   * days later. `setTimeOfDay` writes `ticks = fraction * dayLengthTicks`,
   * which moves the state into day ZERO; a world reloaded through
   * `configureDay` therefore comes back on moon phase 0 whatever night it was
   * saved on. `domain/time-of-day.ts` keeps an absolute tick counter
   * specifically because `moonPhase` needs it, and this call is the one way to
   * throw it away. A load has a whole `TimeState` in hand and must put it back
   * as it was: that is `restore`.
   *
   * The reference's bootstrap gets the ORDER right by hand
   * (ts-minecraft/.../session-bootstrap-world-presentation-time.ts:26-27);
   * making it one call means it cannot be got wrong by the next caller.
   */
  readonly configureDay: (dayLengthSeconds: number, timeOfDayFraction: number) => Effect.Effect<void>
  /** Whole state, for persistence. */
  readonly snapshot: Effect.Effect<Time.TimeState>
  /**
   * Restore from persistence. THE WORLD-LOAD PATH, and what `reset` uses.
   *
   * Unlike `configureDay` this preserves the absolute tick counter, so the day
   * number and therefore the moon phase survive a save/load round trip.
   *
   * The incoming state is repaired by `Time.normaliseTimeState` before it is
   * installed. It arrives from disk, across a version boundary, and a
   * `dayLengthTicks` of 0 used to make every reader `NaN` while `isNight`
   * answered `false` — a world stuck in permanent daylight that no reader could
   * detect and that `setTimeOfDay` could not recover, because 0 x anything is
   * still 0. Repairing here rather than in the readers keeps `isNight` the
   * character-identical predicate mx-gameplay mirrors.
   *
   * A caller that needs to know whether a save was repaired asks
   * `Time.isValidTimeState` BEFORE restoring; this method has no error channel
   * on purpose, because failing a world load over a recoverable field would
   * turn a repairable save into an unopenable one.
   */
  readonly restore: (state: Time.TimeState) => Effect.Effect<void>
}

const TimeServiceBase: Context.TagClass<TimeService, '@nerima-games/mc-sim/TimeService', TimeServiceApi> =
  Context.Tag('@nerima-games/mc-sim/TimeService')<TimeService, TimeServiceApi>()

export class TimeService extends TimeServiceBase {}

/**
 * Build a TimeService over a fresh Ref.
 *
 * Exported separately from the Layer so that a caller wanting several
 * independent worlds in one process (mc-playground-kit, running two previews
 * side by side) can have several, rather than fighting an app-scoped singleton.
 * plan.md §3.8's re-entrancy requirement is easiest to satisfy by not creating
 * the shared thing in the first place.
 *
 * `initial` goes through `Time.normaliseTimeState` for exactly the reason
 * `restore` does — it is the OTHER way a state this repository did not compute
 * gets in. `TimeServiceLayer(loadedState)` is the natural way a host supplies a
 * loaded world at layer-construction time, and a service that starts life with
 * `dayLengthTicks: 0` is the permanent-daylight defect with a different entry
 * point. `makeInventoryService` makes the same argument about slot counts.
 */
export const makeTimeService = (
  initial: Time.TimeState = Time.INITIAL_TIME_STATE,
): Effect.Effect<TimeServiceApi> =>
  Effect.map(Ref.make(Time.normaliseTimeState(initial)), (state) => ({
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
    restore: (next) => Ref.set(state, Time.normaliseTimeState(next)),
  }))

export const TimeServiceLayer = (
  initial: Time.TimeState = Time.INITIAL_TIME_STATE,
): Layer.Layer<TimeService> => Layer.effect(TimeService, makeTimeService(initial))
