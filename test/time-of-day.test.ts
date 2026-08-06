import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import {
  advance,
  dayLengthSecs,
  DEFAULT_DAY_LENGTH_SECS,
  INITIAL_TIME_STATE,
  isNight,
  isValidTimeState,
  MAX_DAY_LENGTH_SECS,
  MAX_TIME_FRACTION,
  MIN_DAY_LENGTH_SECS,
  moonPhase,
  normaliseTimeState,
  setDayLength,
  setDayLengthThenTimeOfDay,
  setTimeOfDay,
  TICKS_PER_SECOND,
  timeOfDay,
  type TimeState,
} from '../src/domain/time-of-day'

const stateOf = (dayLengthSeconds: number, fraction: number): TimeState =>
  setDayLengthThenTimeOfDay(INITIAL_TIME_STATE, dayLengthSeconds, fraction)

/**
 * THE regression test for plan.md §3.8's ordering rule.
 *
 * Named after the failure, not the feature: if this file ever goes green with
 * the assertions inverted, the tick denominator has been changed to something
 * that commutes and the moon-phase / day-counter behaviour has silently gone
 * with it.
 */
describe('REGRESSION: setDayLength must run BEFORE setTimeOfDay', () => {
  it.effect('correct order — the requested time of day is the time of day you get', () =>
    Effect.sync(() => {
      const state = setTimeOfDay(setDayLength(INITIAL_TIME_STATE, 600), 0.3)

      expect(dayLengthSecs(state)).toBe(600)
      expect(timeOfDay(state)).toBeCloseTo(0.3, 12)
    }),
  )

  it.effect('wrong order — a SHORTER day afterwards silently DOUBLES the time of day', () =>
    Effect.sync(() => {
      // Start from the default 400 s day, ask for 0.30, then halve the day
      // length. ticks were fixed at 0.30 * 24000 = 7200; halving the
      // denominator to 12000 leaves the same ticks meaning 0.60 of a day.
      // Dusk instead of mid-morning, with nobody having asked for it.
      const state = setDayLength(setTimeOfDay(INITIAL_TIME_STATE, 0.3), 200)

      expect(dayLengthSecs(state)).toBe(200)
      expect(timeOfDay(state)).toBeCloseTo(0.6, 12)
      expect(timeOfDay(state)).not.toBeCloseTo(0.3, 3)
    }),
  )

  it.effect(
    'REGRESSION: the module header worked example is the arithmetic — a LONGER day moves the time of day DOWN, to 0.20',
    () =>
      Effect.sync(() => {
        // domain/time-of-day.ts states the hazard once, as a matched pair of
        // lines both passing 600, and that statement is the only place a
        // consumer reads to learn the rule. It said 0.60 — the number the
        // SHORTER day above produces — so anyone who reproduced it with 600 got
        // 0.20, concluded the note was unreliable, and had no reason to trust
        // the rest of the module. The hazard was always real; only the example
        // was wrong, which is worse, because it discredits a correct warning.
        //
        // No test could catch it: every other test here asserts the CODE, and
        // the code was right. This one asserts the number the comment prints.
        const lengthened = setDayLength(setTimeOfDay(INITIAL_TIME_STATE, 0.3), 600)

        expect(dayLengthSecs(lengthened)).toBe(600)
        expect(lengthened.ticks).toBe(7200)
        expect(timeOfDay(lengthened)).toBeCloseTo(0.2, 12)

        // The intended half of the pair, with the same argument, for contrast.
        expect(timeOfDay(setTimeOfDay(setDayLength(INITIAL_TIME_STATE, 600), 0.3))).toBeCloseTo(0.3, 12)
      }),
  )

  it.effect('the two orders disagree — which is the whole reason the rule exists', () =>
    Effect.sync(() => {
      const correct = setTimeOfDay(setDayLength(INITIAL_TIME_STATE, 300), 0.8)
      const wrong = setDayLength(setTimeOfDay(INITIAL_TIME_STATE, 0.8), 300)

      expect(timeOfDay(correct)).not.toBeCloseTo(timeOfDay(wrong), 3)
    }),
  )

  it.effect('setDayLengthThenTimeOfDay is the correct order, so callers cannot get it wrong', () =>
    Effect.sync(() => {
      const combined = setDayLengthThenTimeOfDay(INITIAL_TIME_STATE, 600, 0.3)
      const byHand = setTimeOfDay(setDayLength(INITIAL_TIME_STATE, 600), 0.3)

      expect(combined).toStrictEqual(byHand)
      expect(timeOfDay(combined)).toBeCloseTo(0.3, 12)
    }),
  )

  it.effect('setDayLength ALONE is still legal, and its side effect on time of day is real', () =>
    Effect.sync(() => {
      // Mid-session settings changes do exactly this in the reference
      // (input-stage-runtime.ts:17-30). The test documents the consequence
      // rather than pretending the call is forbidden.
      const before = stateOf(1200, 0.25)
      const after = setDayLength(before, 600)

      // Morning becomes midday. Nobody asked for that; halving the denominator
      // did it. Written as an assertion so the behaviour cannot drift unnoticed.
      expect(timeOfDay(before)).toBeCloseTo(0.25, 12)
      expect(timeOfDay(after)).toBeCloseTo(0.5, 12)
    }),
  )
})

describe('day length clamping', () => {
  it.effect('clamps below the minimum and above the maximum rather than accepting absurd days', () =>
    Effect.sync(() => {
      expect(dayLengthSecs(setDayLength(INITIAL_TIME_STATE, 1))).toBe(MIN_DAY_LENGTH_SECS)
      expect(dayLengthSecs(setDayLength(INITIAL_TIME_STATE, 999_999))).toBe(MAX_DAY_LENGTH_SECS)
      expect(dayLengthSecs(setDayLength(INITIAL_TIME_STATE, 0))).toBe(MIN_DAY_LENGTH_SECS)
    }),
  )

  it.effect('a clamped day length is still installed before the time of day is applied', () =>
    Effect.sync(() => {
      const state = setDayLengthThenTimeOfDay(INITIAL_TIME_STATE, 1, 0.5)

      expect(dayLengthSecs(state)).toBe(MIN_DAY_LENGTH_SECS)
      expect(timeOfDay(state)).toBeCloseTo(0.5, 12)
    }),
  )
})

describe('time fraction bounds', () => {
  it.effect('never reaches exactly 1, so that 0 and 1 cannot both denote the same instant', () =>
    Effect.sync(() => {
      expect(timeOfDay(setTimeOfDay(INITIAL_TIME_STATE, 1))).toBeCloseTo(MAX_TIME_FRACTION, 12)
      expect(timeOfDay(setTimeOfDay(INITIAL_TIME_STATE, 5))).toBeCloseTo(MAX_TIME_FRACTION, 12)
      expect(timeOfDay(setTimeOfDay(INITIAL_TIME_STATE, -3))).toBe(0)
    }),
  )
})

describe('advance', () => {
  it.effect('is a pure function of state and delta — no clock is read anywhere', () =>
    Effect.sync(() => {
      const start = stateOf(1200, 0)
      const oneMinute = advance(start, DeltaTimeSecs(60))

      expect(timeOfDay(oneMinute)).toBeCloseTo(60 / 1200, 12)
      // Determinism: same inputs, same output, always.
      expect(advance(start, DeltaTimeSecs(60))).toStrictEqual(oneMinute)
    }),
  )

  it.effect('fast-forwards a full week in microseconds, which is what makes scenario tests cheap', () =>
    Effect.sync(() => {
      const start = stateOf(1200, 0)
      const week = advance(start, DeltaTimeSecs(1200 * 7))

      expect(timeOfDay(week)).toBeCloseTo(0, 9)
      expect(week.ticks).toBe(start.ticks + 1200 * 7 * TICKS_PER_SECOND)
    }),
  )

  it.effect('keeps the ABSOLUTE tick counter, so the moon phase advances across days', () =>
    Effect.sync(() => {
      const start = stateOf(1200, 0)

      expect(moonPhase(start)).toBe(0)
      expect(moonPhase(advance(start, DeltaTimeSecs(1200)))).toBe(1)
      expect(moonPhase(advance(start, DeltaTimeSecs(1200 * 3)))).toBe(3)
      // Eight phases, then it wraps.
      expect(moonPhase(advance(start, DeltaTimeSecs(1200 * 8)))).toBe(0)
    }),
  )
})

describe('isNight', () => {
  it.effect('is the half of the day centred on the 0/1 boundary', () =>
    Effect.sync(() => {
      expect(isNight(stateOf(1200, 0))).toBe(true)
      expect(isNight(stateOf(1200, 0.1))).toBe(true)
      expect(isNight(stateOf(1200, 0.3))).toBe(false)
      expect(isNight(stateOf(1200, 0.5))).toBe(false)
      expect(isNight(stateOf(1200, 0.7))).toBe(false)
      expect(isNight(stateOf(1200, 0.9))).toBe(true)
    }),
  )

  it.effect('a fresh world starts in daylight, not at midnight with hostile mobs', () =>
    Effect.sync(() => {
      // ts-minecraft/packages/game/application/time-service-state.ts:11-21 —
      // a midnight start was an unrecoverable death loop on world creation.
      expect(INITIAL_TIME_STATE).toStrictEqual({ ticks: 7200, dayLengthTicks: 24000 })
      expect(timeOfDay(INITIAL_TIME_STATE)).toBeCloseTo(0.3, 12)
      expect(dayLengthSecs(INITIAL_TIME_STATE)).toBe(DEFAULT_DAY_LENGTH_SECS)
      expect(isNight(INITIAL_TIME_STATE)).toBe(false)
    }),
  )

  it.effect(
    'REGRESSION: the predicate is still exactly `< 0.25 || > 0.75` — mx-gameplay mirrors this line',
    () =>
      Effect.sync(() => {
        // mx-gameplay/domain/day-night.ts restates this predicate character for
        // character, because the hostile-mob spawn rule and the state it reads
        // live in different repositories (docs/public-api.md §2-0). A NaN
        // branch, a clamp, or a moved boundary here would silently disagree
        // with a sibling that cannot be edited from this repository.
        //
        // The permanent-daylight defect was fixed at the boundary that let a
        // NaN in (`normaliseTimeState`), NOT here, precisely so that this line
        // could stay identical. Asserting the four boundary points is what
        // keeps the two copies checkable against each other.
        expect(isNight({ ticks: 2999, dayLengthTicks: 12000 })).toBe(true)
        expect(isNight({ ticks: 3000, dayLengthTicks: 12000 })).toBe(false)
        expect(isNight({ ticks: 9000, dayLengthTicks: 12000 })).toBe(false)
        expect(isNight({ ticks: 9001, dayLengthTicks: 12000 })).toBe(true)
      }),
  )
})

/**
 * REGRESSION: a save that crosses a version boundary cannot produce a world
 * stuck in permanent daylight.
 *
 * `timeOfDay` divides by `dayLengthTicks`. At zero every reader was NaN, and
 * `isNight` answered `false` — not an error, not a NaN a UI could notice, but
 * the boolean a caller acts on: mobs never spawn and the sky never darkens.
 * `setTimeOfDay` could not recover it either, since 0.5 x 0 is 0.
 *
 * The repair is here, at the boundary, and NOT in `isNight`: see the test above
 * for why that predicate must stay character-identical to mx-gameplay's.
 */
describe('REGRESSION: a restored TimeState is repaired, never left un-answerable', () => {
  it.effect('the zero day length that made every reader NaN is clamped to the legal minimum', () =>
    Effect.sync(() => {
      const repaired = normaliseTimeState({ ticks: 0, dayLengthTicks: 0 })

      expect(dayLengthSecs(repaired)).toBe(120)
      expect(timeOfDay(repaired)).toBe(0)
      expect(Number.isNaN(moonPhase(repaired))).toBe(false)
      // Midnight of day zero, which is a real time of day. It reads as NIGHT,
      // where the unrepaired state read as permanent day.
      expect(isNight(repaired)).toBe(true)
    }),
  )

  it.effect('a day length out of range is clamped exactly as setDayLength clamps it', () =>
    Effect.sync(() => {
      // The two paths must not disagree about what a legal day is, or a save
      // round trip would move a world the setter would have left alone.
      expect(dayLengthSecs(normaliseTimeState({ ticks: 0, dayLengthTicks: 60 }))).toBe(120)
      expect(dayLengthSecs(normaliseTimeState({ ticks: 0, dayLengthTicks: 9_999_999 }))).toBe(1200)
      expect(dayLengthSecs(normaliseTimeState({ ticks: 0, dayLengthTicks: -1 }))).toBe(120)
      expect(dayLengthSecs(setDayLength(INITIAL_TIME_STATE, 1))).toBe(120)
      expect(dayLengthSecs(setDayLength(INITIAL_TIME_STATE, 999_999))).toBe(1200)
    }),
  )

  it.effect('only NaN falls back to the default — an infinity still has a direction to clamp along', () =>
    Effect.sync(() => {
      expect(dayLengthSecs(normaliseTimeState({ ticks: 0, dayLengthTicks: Number.NaN }))).toBe(400)
      expect(
        dayLengthSecs(normaliseTimeState({ ticks: 0, dayLengthTicks: Number.POSITIVE_INFINITY })),
      ).toBe(1200)
      expect(
        dayLengthSecs(normaliseTimeState({ ticks: 0, dayLengthTicks: Number.NEGATIVE_INFINITY })),
      ).toBe(120)
      // ...and setDayLength agrees on all three, which is the point.
      expect(dayLengthSecs(setDayLength(INITIAL_TIME_STATE, Number.POSITIVE_INFINITY))).toBe(1200)
      expect(dayLengthSecs(setDayLength(INITIAL_TIME_STATE, Number.NEGATIVE_INFINITY))).toBe(120)
    }),
  )

  it.effect('a VALID state is returned untouched, so a good save is never rewritten', () =>
    Effect.sync(() => {
      // Including an enormous tick counter: it carries the day number, which
      // moonPhase needs and which nothing else can reconstruct.
      const aged = { ticks: 103_200, dayLengthTicks: 24000 }

      expect(normaliseTimeState(aged)).toStrictEqual(aged)
      expect(normaliseTimeState(INITIAL_TIME_STATE)).toStrictEqual(INITIAL_TIME_STATE)
      expect(moonPhase(normaliseTimeState(aged))).toBe(4)
    }),
  )

  it.effect('a broken tick counter becomes 0 rather than poisoning the day number', () =>
    Effect.sync(() => {
      expect(normaliseTimeState({ ticks: Number.NaN, dayLengthTicks: 24000 }).ticks).toBe(0)
      expect(normaliseTimeState({ ticks: -5, dayLengthTicks: 24000 }).ticks).toBe(0)
    }),
  )

  it.effect('isValidTimeState is how a caller asks BEFORE restoring, since restore cannot fail', () =>
    Effect.sync(() => {
      expect(isValidTimeState(INITIAL_TIME_STATE)).toBe(true)
      expect(isValidTimeState({ ticks: 103_200, dayLengthTicks: 24000 })).toBe(true)
      expect(isValidTimeState({ ticks: 0, dayLengthTicks: 0 })).toBe(false)
      expect(isValidTimeState({ ticks: 0, dayLengthTicks: Number.NaN })).toBe(false)
      expect(isValidTimeState({ ticks: Number.NaN, dayLengthTicks: 24000 })).toBe(false)
      expect(isValidTimeState({ ticks: -1, dayLengthTicks: 24000 })).toBe(false)
    }),
  )

  it.effect('normalising is idempotent, and its output always passes isValidTimeState', () =>
    Effect.sync(() => {
      const broken: ReadonlyArray<TimeState> = [
        { ticks: 0, dayLengthTicks: 0 },
        { ticks: Number.NaN, dayLengthTicks: Number.NaN },
        { ticks: -1, dayLengthTicks: -1 },
        { ticks: 103_200, dayLengthTicks: 9_999_999 },
      ]

      for (const state of broken) {
        const once = normaliseTimeState(state)
        expect(isValidTimeState(once)).toBe(true)
        expect(normaliseTimeState(once)).toStrictEqual(once)
      }
    }),
  )

  it.effect(
    'REGRESSION: a MALFORMED save — a missing or null field — is repaired too, not just an out-of-range one',
    () =>
      Effect.sync(() => {
        // The casts are the point. "Crossed a version boundary" means the value
        // satisfies `TimeState` to the compiler and not to the runtime: a field
        // a newer schema added is `undefined`, and `JSON.stringify(NaN)` writes
        // `null`. Both used to slip past the repair and come back as NaN — the
        // permanent-daylight defect, produced BY the function added to fix it,
        // on exactly the inputs `isValidTimeState` exists to flag.
        //
        // `null` is the nastier of the two: `Number.isNaN(null)` is false and
        // `null / 60` is 0, so it does not merely evade the NaN branch, it
        // clamps to the MINIMUM day and looks deliberate.
        const malformed: ReadonlyArray<TimeState> = [
          { ticks: 0 } as unknown as TimeState,
          {} as unknown as TimeState,
          { ticks: 7200, dayLengthTicks: null } as unknown as TimeState,
          { ticks: 7200, dayLengthTicks: undefined } as unknown as TimeState,
          { ticks: 7200, dayLengthTicks: '600' } as unknown as TimeState,
          { ticks: null, dayLengthTicks: 24000 } as unknown as TimeState,
        ]

        for (const state of malformed) {
          expect(isValidTimeState(state)).toBe(false)

          const repaired = normaliseTimeState(state)
          expect(isValidTimeState(repaired)).toBe(true)
          expect(Number.isNaN(timeOfDay(repaired))).toBe(false)
          expect(Number.isNaN(moonPhase(repaired))).toBe(false)
          expect(normaliseTimeState(repaired)).toStrictEqual(repaired)
        }

        // A field carrying no magnitude gets the fresh-world day, NOT the
        // minimum: 120 s would be a real decision this function has no basis
        // for making, and `null` must not be read as the number zero.
        expect(dayLengthSecs(normaliseTimeState({ ticks: 7200 } as unknown as TimeState))).toBe(400)
        expect(
          dayLengthSecs(
            normaliseTimeState({ ticks: 7200, dayLengthTicks: null } as unknown as TimeState),
          ),
        ).toBe(400)
      }),
  )
})

/**
 * REGRESSION: the SETTERS cannot poison a healthy world either.
 *
 * `isNight`'s contract is that it is total on every state this module produces.
 * Repairing `restore` was not enough to make that true: `clampDayLengthSecs` and
 * `clampFraction` were `Math.max`/`Math.min` chains, and those PROPAGATE `NaN`.
 * So a mid-session `setDayLength(Number(''))` — a settings field the player
 * cleared, and `application/time-service.ts` documents that call as the reason
 * the lone setter is exported — wrote `dayLengthTicks: NaN` into a world that
 * had been fine, and the world reported daylight from then on.
 *
 * Worse, it survived a save: the poisoned state autosaves as `null`, reloads as
 * a 120-second day, and the moon phase the absolute counter exists to preserve
 * comes back shifted.
 */
describe('REGRESSION: setDayLength and setTimeOfDay are total, so a settings field cannot stop the night', () => {
  it.effect('a day length with no magnitude falls back to the default rather than to NaN', () =>
    Effect.sync(() => {
      const poisoned = setDayLength(INITIAL_TIME_STATE, Number.NaN)

      expect(isValidTimeState(poisoned)).toBe(true)
      expect(dayLengthSecs(poisoned)).toBe(400)
      expect(Number.isNaN(timeOfDay(poisoned))).toBe(false)
      // The state is untouched, which is the best possible answer: the caller
      // asked for nothing, so nothing moved.
      expect(poisoned).toStrictEqual(INITIAL_TIME_STATE)
    }),
  )

  it.effect('a time of day with no magnitude is midnight, where every below-range input lands', () =>
    Effect.sync(() => {
      const poisoned = setTimeOfDay(INITIAL_TIME_STATE, Number.NaN)

      expect(isValidTimeState(poisoned)).toBe(true)
      expect(timeOfDay(poisoned)).toBe(0)
      // Same answer as the documented below-range case, which is what makes it
      // a clamp rather than a special case.
      expect(timeOfDay(setTimeOfDay(INITIAL_TIME_STATE, -3))).toBe(0)
    }),
  )

  it.effect('configureDay is total in both arguments, being the two setters in order', () =>
    Effect.sync(() => {
      const state = setDayLengthThenTimeOfDay(INITIAL_TIME_STATE, Number.NaN, Number.NaN)

      expect(isValidTimeState(state)).toBe(true)
      expect(dayLengthSecs(state)).toBe(400)
      expect(timeOfDay(state)).toBe(0)
    }),
  )

  it.effect('a mid-session settings change cannot shift the moon phase through a save', () =>
    Effect.sync(() => {
      // The full chain: five days in, a cleared settings field, autosave,
      // reload. The day number is what `restore` exists to preserve, and a NaN
      // day length used to move it — the world came back on a different night.
      const dayFive = advance(INITIAL_TIME_STATE, DeltaTimeSecs(400 * 5))
      expect(moonPhase(dayFive)).toBe(5)

      const afterSettingsChange = setDayLength(dayFive, Number.NaN)
      expect(moonPhase(afterSettingsChange)).toBe(5)
      expect(isNight(afterSettingsChange)).toBe(isNight(dayFive))

      // Round-tripped through a save, NaN included: JSON writes it as null.
      const reloaded = normaliseTimeState(
        JSON.parse(JSON.stringify(afterSettingsChange)) as TimeState,
      )
      expect(moonPhase(reloaded)).toBe(5)
    }),
  )
})
