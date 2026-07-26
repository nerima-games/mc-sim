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
 * Both start from the fresh-world state, whose day is 400 s:
 *
 *   setDayLength(600) then setTimeOfDay(0.30)  ->  timeOfDay 0.30   (intended)
 *   setTimeOfDay(0.30) then setDayLength(600)  ->  timeOfDay 0.20   (a bug)
 *
 * The SIGN of the error follows the denominator, and both directions are real:
 *
 *   - LENGTHENING the day (400 s -> 600 s) leaves the same absolute tick count
 *     sitting earlier in a bigger day, so the time of day moves DOWN: 0.30 into
 *     a 400 s day is tick 7200, and 7200 of 36000 is 0.20.
 *   - SHORTENING it (400 s -> 200 s) does the reverse and moves the time of day
 *     UP: 7200 of 12000 is 0.60. `test/time-of-day.test.ts` pins this half,
 *     because a doubling from mid-morning to dusk is the more alarming of the
 *     two to read; it pins the 600 s half too, so this worked example cannot
 *     drift away from the arithmetic again.
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

/**
 * Does this value carry a magnitude at all?
 *
 * `Math.max` and `Math.min` PROPAGATE `NaN`, so a clamp built from them is not a
 * clamp for a `NaN` input — it is a pass-through, and the `NaN` lands in the
 * denominator where `isNight` turns it into permanent daylight. The type says
 * `number`, and that is not enough: `Number('')` and `parseFloat('')` are both
 * `NaN`, and a settings field a player cleared is the documented caller of
 * `setDayLength`.
 *
 * The `typeof` test is not redundant with the `NaN` test, and TypeScript cannot
 * make it so. These values come off disk and across a version boundary, where
 * `undefined` (a field a newer schema added) and `null` (what `JSON.stringify`
 * writes for `NaN`) both arrive wearing the `number` type. `Number.isNaN` is
 * false for both, and `Math.min(1200, null)` is 0 — so without this, a `NaN` day
 * length that has been through a save file would clamp to the MINIMUM rather
 * than reaching the default below.
 */
const hasMagnitude = (value: number): boolean => typeof value === 'number' && !Number.isNaN(value)

/**
 * Clamp a day length in seconds into [MIN, MAX]. TOTAL over every input.
 *
 * A value with no magnitude falls back to `DEFAULT_DAY_LENGTH_SECS`: it is the
 * fresh-world day, and the only non-arbitrary choice available when the input
 * says nothing. An INFINITY is not such a value — it has a direction — and is
 * clamped to the bound it points at.
 *
 * `setDayLength`, `setDayLengthThenTimeOfDay` and `normaliseTimeState` all go
 * through here, which is what makes "the save path and the setter path cannot
 * disagree about what a legal day is" true rather than aspirational.
 */
const clampDayLengthSecs = (seconds: number): number =>
  hasMagnitude(seconds)
    ? Math.max(MIN_DAY_LENGTH_SECS, Math.min(MAX_DAY_LENGTH_SECS, seconds))
    : DEFAULT_DAY_LENGTH_SECS

/**
 * Clamp a time-of-day fraction into [0, MAX_TIME_FRACTION]. TOTAL over every
 * input, for the same reason as above.
 *
 * A value with no magnitude becomes 0 — midnight — which is where every other
 * below-range input already lands. It is a real instant, which is the property
 * that matters: `setTimeOfDay(Number(''))` used to write `ticks: NaN` and leave
 * the world reporting daylight forever.
 */
const clampFraction = (fraction: number): number =>
  hasMagnitude(fraction) ? Math.max(0, Math.min(MAX_TIME_FRACTION, fraction)) : 0

/**
 * Can the readers below answer questions about this state?
 *
 * `dayLengthTicks` is a DENOMINATOR. At zero every reader returns `NaN`, and
 * `isNight` — which is `fraction < 0.25 || fraction > 0.75` — then returns
 * `false`, because both comparisons against `NaN` are false. A world restored
 * from a truncated save therefore reported permanent DAYLIGHT: not an error,
 * not a `NaN` a UI could notice, but the boolean a caller would act on. Mobs
 * never spawn and the sky never darkens.
 *
 * Exported so that a persistence layer (mc-save) can tell a save it must repair
 * from one it may load verbatim, WITHOUT having to know the clamp bounds.
 */
export const isValidTimeState = (state: TimeState): boolean =>
  Number.isFinite(state.ticks) &&
  state.ticks >= 0 &&
  Number.isFinite(state.dayLengthTicks) &&
  state.dayLengthTicks >= MIN_DAY_LENGTH_SECS * TICKS_PER_SECOND &&
  state.dayLengthTicks <= MAX_DAY_LENGTH_SECS * TICKS_PER_SECOND

/**
 * Repair a state read from persistence into one every reader can answer for.
 *
 * REPAIRS, RATHER THAN REJECTS, and the choice is the same one
 * `domain/frame-timing.ts` makes about a raw frame delta: the input may be out
 * of range because it crossed a version boundary or was truncated, and the
 * simulation wants a world it can run rather than a throw at the boundary.
 * `TimeService.restore` is on the world-load path and has no error channel to
 * report into; `isValidTimeState` is how a caller that DOES want to know asks.
 *
 * What it does NOT do is invent a time of day. Only the two broken fields move:
 *
 *   - `dayLengthTicks` goes through the SAME clamp `setDayLength` uses, so the
 *     two paths cannot disagree about what a legal day is — an infinity lands
 *     on the maximum here exactly as `setDayLength(Infinity)` does, and anything
 *     with no magnitude at all lands on `DEFAULT_DAY_LENGTH_SECS`.
 *   - `ticks` non-finite or negative becomes 0. A finite, non-negative counter
 *     is left ALONE even when it is enormous: it carries the day number, which
 *     `moonPhase` needs and which nothing else can reconstruct.
 *
 * TOTAL OVER ANY RUNTIME VALUE, not merely over any `number`. A field that is
 * absent, `null` or a string still satisfies the declared type at the boundary
 * this function guards — that is what "crossed a version boundary" means — so
 * every field is dividing a value it does not trust, and the division is kept
 * on the `number` side of the `typeof` test rather than after it. The output
 * always satisfies `isValidTimeState`; `test/time-of-day.test.ts` asserts that
 * over the malformed shapes as well as the out-of-range ones.
 */
export const normaliseTimeState = (state: TimeState): TimeState => ({
  ticks: Number.isFinite(state.ticks) && state.ticks >= 0 ? state.ticks : 0,
  dayLengthTicks:
    clampDayLengthSecs(
      // `undefined / 60` is NaN and would be caught, but `null / 60` is 0 and
      // would clamp to the minimum. Deciding on the value itself, before any
      // arithmetic can coerce it, is what keeps the two indistinguishable.
      typeof state.dayLengthTicks === 'number'
        ? state.dayLengthTicks / TICKS_PER_SECOND
        : Number.NaN,
    ) * TICKS_PER_SECOND,
})

/**
 * Position within the current day, in [0, 1).
 *
 * 0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = dusk — the same convention the
 * reference uses, recorded at INITIAL_TIME_STATE above. An earlier version of
 * this line said "0 = dawn boundary, 0.5 = dusk boundary", which contradicted
 * both that note and `isNight` directly below: night is `< 0.25 || > 0.75`,
 * which is the half centred on 0, and that is only night if 0 is midnight.
 */
export const timeOfDay = (state: TimeState): number => (state.ticks % state.dayLengthTicks) / state.dayLengthTicks

/** Day length in seconds — the inverse of what `setDayLength` takes. */
export const dayLengthSecs = (state: TimeState): number => state.dayLengthTicks / TICKS_PER_SECOND

/** Which of the eight moon phases tonight is. Needs the ABSOLUTE tick counter. */
export const moonPhase = (state: TimeState): number =>
  Math.floor(state.ticks / state.dayLengthTicks) % MOON_PHASE_COUNT

/**
 * Night is the half of the day centred on the 0/1 boundary.
 *
 * DO NOT ADD A `NaN` BRANCH HERE. `mx-gameplay/domain/day-night.ts` restates
 * this predicate character for character by design — the hostile-mob spawn rule
 * and the state it reads live in different repositories, so the boundary is
 * written down twice and pinned by a test on both sides (docs/public-api.md
 * §2-0). Widening it here would silently make the two disagree, and mx-gameplay
 * cannot be edited from this repository.
 *
 * A `NaN` fraction used to reach this function and leave it returning `false`
 * — permanent daylight. That is fixed where it belongs, at the boundary that
 * let the bad state in: see `normaliseTimeState` above and
 * `TimeService.restore`. This predicate is total on every state those produce.
 */
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
