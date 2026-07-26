/**
 * Day/night state, and the `setDayLength -> setTimeOfDay` ordering hazard.
 *
 * ---------------------------------------------------------------------------
 * The hazard, stated once
 * ---------------------------------------------------------------------------
 *
 * The state is an ABSOLUTE tick counter plus a DENOMINATOR:
 *
 *   timeOfDay = (ticks % dayLengthTicks) / dayLengthTicks
 *
 * `setDayLength` changes the denominator and leaves `ticks` alone. So changing
 * the day length silently MOVES the current time of day. `setTimeOfDay`, by
 * contrast, multiplies by the denominator that happens to be installed when it
 * runs. The two therefore do not commute:
 *
 *   setDayLength(600) then setTimeOfDay(0.30)  ->  timeOfDay 0.30   (intended)
 *   setTimeOfDay(0.30) then setDayLength(600)  ->  timeOfDay 0.60   (a bug)
 *
 * Hence the rule: ALWAYS `setDayLength` BEFORE `setTimeOfDay`.
 *
 * Verified in the reference implementation:
 *   ts-minecraft/packages/game/application/time-service-state.ts:32-33
 *     (state.ticks % state.dayLengthTicks) / state.dayLengthTicks
 *   ts-minecraft/packages/game/application/time-service-state.ts:45-48
 *     setDayLengthOnState writes dayLengthTicks and leaves ticks untouched
 *   ts-minecraft/packages/game/application/time-service-state.ts:50-53
 *     setTimeOfDayOnState writes ticks = fraction * state.dayLengthTicks
 *   ts-minecraft/packages/app/application/main/session-bootstrap-world-presentation-time.ts:26-27
 *     the bootstrap calls them in the correct order — and is the only caller
 *     that does. ts-minecraft/packages/app/application/frame/stages/input-stage-runtime.ts:17-30
 *     calls setDayLength ALONE mid-session when the setting changes, which
 *     shifts the time of day as a side effect. That is the live bug.
 *
 * ---------------------------------------------------------------------------
 * Why the representation is kept, rather than fixed
 * ---------------------------------------------------------------------------
 *
 * Storing a normalised fraction would make the operations commute and delete
 * the hazard. It would also delete `getMoonPhase`, which is
 * `floor(ticks / dayLengthTicks) % 8` — the absolute counter is how the world
 * knows which day it is on. The absolute counter is the right representation;
 * the ordering constraint is the price, and the price is paid by naming it and
 * pinning it with a regression test rather than by hoping callers remember.
 *
 * `advance` is a pure function of state and delta, with no clock read anywhere
 * in this file. Time enters the simulation at exactly one place, the frame
 * loop, and is passed down. That is what makes fast-forward possible: a
 * scenario test can advance a simulated week in a few microseconds.
 */
import type { DeltaTimeSecs } from './kernel-vocabulary'

/** Simulation ticks per second. Vanilla parity; the reference uses the same rate. */
export const TICKS_PER_SECOND = 60

/** Day-length bounds, in seconds. ts-minecraft/packages/game/application/time-service-state.ts:23. */
export const MIN_DAY_LENGTH_SECS = 120
export const MAX_DAY_LENGTH_SECS = 1200

/**
 * Fractions are clamped to just under 1, never to 1 itself: `timeOfDay === 1`
 * and `timeOfDay === 0` denote the same instant, and allowing both makes
 * "is it the same time?" comparisons wrong exactly once per day.
 */
export const MAX_TIME_FRACTION = 0.9999

/** Number of distinct moon phases. */
export const MOON_PHASE_COUNT = 8

export type TimeState = {
  /** Absolute tick counter since world creation. Never wraps; carries the day number. */
  readonly ticks: number
  /** Ticks in one day. The DENOMINATOR — changing it moves the time of day. */
  readonly dayLengthTicks: number
}

/**
 * Fresh-world state. Values taken verbatim from
 * ts-minecraft/packages/game/application/time-service-state.ts:18-21.
 *
 * `ticks: 7200` over `dayLengthTicks: 24000` is a time of day of 0.30 — that
 * is, mid-morning, not midnight. The reference's comment (:11-17) records why,
 * and it is a gameplay bug rather than a technical one:
 *
 *   in this cycle 0 is MIDNIGHT (0.25 = dawn, 0.5 = noon, 0.75 = dusk). A
 *   midnight start spawned the night-mob roster on top of brand-new players,
 *   and daylight-immune hostiles then camped the respawn point: an
 *   unrecoverable death loop on world creation.
 *
 * 24000 ticks at 60 ticks/s is a 400-second day, which is the reference's
 * default and sits inside the [120, 1200] clamp range.
 */
export const INITIAL_TIME_STATE: TimeState = {
  ticks: 7200,
  dayLengthTicks: 24000,
}

/** The fresh-world day length in seconds, for callers that want it named. */
export const DEFAULT_DAY_LENGTH_SECS = 400

const clampDayLengthSecs = (seconds: number): number =>
  Math.max(MIN_DAY_LENGTH_SECS, Math.min(MAX_DAY_LENGTH_SECS, seconds))

const clampFraction = (fraction: number): number => Math.max(0, Math.min(MAX_TIME_FRACTION, fraction))

/** Position within the current day, in [0, 1). 0 = dawn boundary, 0.5 = dusk boundary. */
export const timeOfDay = (state: TimeState): number => (state.ticks % state.dayLengthTicks) / state.dayLengthTicks

/** Day length in seconds — the inverse of what `setDayLength` takes. */
export const dayLengthSecs = (state: TimeState): number => state.dayLengthTicks / TICKS_PER_SECOND

/** Which of the eight moon phases tonight is. Needs the ABSOLUTE tick counter. */
export const moonPhase = (state: TimeState): number =>
  Math.floor(state.ticks / state.dayLengthTicks) % MOON_PHASE_COUNT

/** Night is the half of the day centred on the 0/1 boundary. */
export const isNight = (state: TimeState): boolean => {
  const fraction = timeOfDay(state)
  return fraction < 0.25 || fraction > 0.75
}

/** Advance by one frame. Pure; the delta is supplied, never read from a clock. */
export const advance = (state: TimeState, dt: DeltaTimeSecs): TimeState => ({
  ...state,
  ticks: state.ticks + dt * TICKS_PER_SECOND,
})

/**
 * Install a new day length.
 *
 * ORDERING: call this BEFORE `setTimeOfDay`, never after. `ticks` is left
 * untouched, so the time of day this state reports afterwards is generally not
 * the one it reported before. See the module header.
 */
export const setDayLength = (state: TimeState, seconds: number): TimeState => ({
  ...state,
  dayLengthTicks: clampDayLengthSecs(seconds) * TICKS_PER_SECOND,
})

/**
 * Move to a position within the current day.
 *
 * Reads the CURRENT `dayLengthTicks`, which is why the day length must already
 * be correct when this runs. Note that this also resets the day counter to 0,
 * i.e. it moves within day zero — matching the reference.
 */
export const setTimeOfDay = (state: TimeState, fraction: number): TimeState => ({
  ...state,
  ticks: clampFraction(fraction) * state.dayLengthTicks,
})

/**
 * Set day length and time of day together, in the only safe order.
 *
 * PREFER THIS over the two setters. It exists so that the ordering constraint
 * is expressible as "there is one function", rather than as a comment that
 * every future caller has to have read. The individual setters remain exported
 * because mid-session a caller genuinely may need only one — but a caller that
 * wants both should never be the one deciding the order.
 */
export const setDayLengthThenTimeOfDay = (
  state: TimeState,
  seconds: number,
  fraction: number,
): TimeState => setTimeOfDay(setDayLength(state, seconds), fraction)
