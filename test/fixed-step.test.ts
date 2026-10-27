import { describe, expect, it } from '@effect/vitest'
import { Result, Effect } from 'effect'
import {
  DeltaTimeSecs,
  FixedDurationSecs,
  SimulationTick,
  interpolationFraction,
  tickDuration,
  type FixedDurationSecs as FixedDurationSecsValue,
} from '@nerima-games/mc-kernel'
import {
  advance,
  DEFAULT_TICK_DURATION,
  initialFixedStepAccumulator,
  MAX_CATCH_UP_TICKS,
  pause,
  resume,
} from '../src/domain/fixed-step'

const dt = (seconds: number): DeltaTimeSecs => DeltaTimeSecs(seconds)
const duration = (seconds: number): FixedDurationSecsValue => FixedDurationSecs(seconds)
const advanceAtRuntime = (state: unknown, delta: unknown) => {
  const args = JSON.parse('[null, null]')
  args[0] = state
  args[1] = delta
  return Reflect.apply(advance, undefined, args)
}

describe('fixed-step accumulator', () => {
  it.effect('matches the fixed-step tick oracle for literal frame deltas', () =>
    Effect.sync(() => {
      const oracle = [
        { delta: 0.05, ticks: 1, remainder: 0, fraction: 0, overloaded: false },
        { delta: 0.1, ticks: 2, remainder: 0, fraction: 0, overloaded: false },
        { delta: 0.12, ticks: 2, remainder: 0.02, fraction: 0.4, overloaded: false },
        { delta: 0.01, ticks: 0, remainder: 0.01, fraction: 0.2, overloaded: false },
        { delta: 0.3, ticks: 5, remainder: 0, fraction: 0, overloaded: true },
      ]

      for (const row of oracle) {
        const result = advance(initialFixedStepAccumulator(), dt(row.delta))
        expect(Result.isSuccess(result)).toBe(true)
        if (Result.isSuccess(result)) {
          expect(result.success.ticks).toBe(row.ticks)
          expect(result.success.state.accumulator).toBeCloseTo(row.remainder)
          expect(result.success.interpolationFraction).toBeCloseTo(row.fraction)
          expect(result.success.overloaded).toBe(row.overloaded)
        }
      }
    }),
  )

  it.effect('uses the kernel tick duration by default', () =>
    Effect.sync(() => {
      const state = initialFixedStepAccumulator()
      expect(DEFAULT_TICK_DURATION).toBe(tickDuration)
      expect(state.tickDuration).toBe(FixedDurationSecs(0.05))
    }),
  )

  it.effect('turns DeltaTimeSecs into whole ticks and retains the remainder', () =>
    Effect.sync(() => {
      const result = advance(initialFixedStepAccumulator(), dt(0.125))
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.success.ticks).toBe(2)
        expect(result.success.state.tick).toBe(SimulationTick(2))
        expect(result.success.state.accumulator).toBeCloseTo(0.025)
        expect(result.success.interpolationFraction).toBeCloseTo(0.5)
        expect(result.success.overloaded).toBe(false)
      }
    }),
  )

  it.effect('caps catch-up at five ticks and reports overload', () =>
    Effect.sync(() => {
      const result = advance(initialFixedStepAccumulator(), dt(1))
      expect(MAX_CATCH_UP_TICKS).toBe(5)
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.success.ticks).toBe(5)
        expect(result.success.state.tick).toBe(SimulationTick(5))
        expect(result.success.state.accumulator).toBe(duration(0))
        expect(result.success.interpolationFraction).toBe(interpolationFraction(duration(0)))
        expect(result.success.overloaded).toBe(true)
      }
    }),
  )

  it.effect('pause ignores input and resume accepts new elapsed time', () =>
    Effect.sync(() => {
      const paused = pause(initialFixedStepAccumulator())
      const whilePaused = advance(paused, dt(1))
      expect(Result.isSuccess(whilePaused)).toBe(true)
      if (Result.isSuccess(whilePaused)) {
        expect(whilePaused.success.ticks).toBe(0)
        expect(whilePaused.success.state.accumulator).toBe(duration(0))
      }

      const afterResume = advance(resume(paused), dt(0.05))
      expect(Result.isSuccess(afterResume)).toBe(true)
      if (Result.isSuccess(afterResume)) expect(afterResume.success.ticks).toBe(1)
    }),
  )

  it.effect('preserves a paused remainder and clears it on resume', () =>
    Effect.sync(() => {
      const first = advance(initialFixedStepAccumulator(), dt(0.075))
      expect(Result.isSuccess(first)).toBe(true)
      if (Result.isSuccess(first)) {
        const paused = pause(first.success.state)
        const whilePaused = advance(paused, dt(0.2))
        expect(Result.isSuccess(whilePaused)).toBe(true)
        if (Result.isSuccess(whilePaused)) {
          expect(whilePaused.success.state.accumulator).toBeCloseTo(0.025)
          expect(whilePaused.success.ticks).toBe(0)
        }
        expect(resume(paused).accumulator).toBe(duration(0))
      }
    }),
  )

  it.effect('propagates addTick overflow without changing the accumulator', () =>
    Effect.sync(() => {
      const state = initialFixedStepAccumulator(SimulationTick(Number.MAX_SAFE_INTEGER))
      const result = advance(state, dt(0.05))
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) expect(result.failure._tag).toBe('TimeOverflow')
    }),
  )

  it.effect('returns BrandError for negative and NaN runtime deltas', () =>
    Effect.sync(() => {
      for (const delta of [-0.05, Number.NaN]) {
        const result = advanceAtRuntime(initialFixedStepAccumulator(), delta)
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) expect(result.failure._tag).toBe('BrandError')
      }
    }),
  )

  it.effect('returns BrandError for an invalid maxCatchUpTicks state', () =>
    Effect.sync(() => {
      for (const maxCatchUpTicks of [-1, Number.NaN]) {
        const state = initialFixedStepAccumulator(SimulationTick(0), DEFAULT_TICK_DURATION, maxCatchUpTicks)
        const result = advance(state, dt(0.05))
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) expect(result.failure._tag).toBe('BrandError')
      }
    }),
  )

  it.effect('returns typed failures for malformed runtime accumulator fields', () =>
    Effect.sync(() => {
      const initial = initialFixedStepAccumulator()
      const malformed = [
        { state: { ...initial, accumulator: null }, expectedTag: 'BrandError' },
        { state: { ...initial, tick: null }, expectedTag: 'BrandError' },
        { state: { ...initial, tickDuration: 0 }, expectedTag: 'BrandError' },
        {
          state: {
            ...initial,
            tickDuration: Number.MAX_VALUE,
            maxCatchUpTicks: Number.MAX_SAFE_INTEGER,
          },
          expectedTag: 'InvalidFixedStepConfiguration',
        },
        { state: { ...initial, paused: 'paused' }, expectedTag: 'InvalidFixedStepConfiguration' },
      ]

      for (const { state, expectedTag } of malformed) {
        const result = advanceAtRuntime(state, dt(0.05))
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) expect(result.failure._tag).toBe(expectedTag)
      }
    }),
  )
})
