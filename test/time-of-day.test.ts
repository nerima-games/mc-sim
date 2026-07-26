import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { DeltaTimeSecs } from '../domain/kernel-vocabulary'
import {
  advance,
  dayLengthSecs,
  DEFAULT_DAY_LENGTH_SECS,
  INITIAL_TIME_STATE,
  isNight,
  MAX_DAY_LENGTH_SECS,
  MAX_TIME_FRACTION,
  MIN_DAY_LENGTH_SECS,
  moonPhase,
  setDayLength,
  setDayLengthThenTimeOfDay,
  setTimeOfDay,
  TICKS_PER_SECOND,
  timeOfDay,
  type TimeState,
} from '../domain/time-of-day'

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

  it.effect('wrong order — setDayLength afterwards silently DOUBLES the time of day', () =>
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
})
