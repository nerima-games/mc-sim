import { describe, expect, it } from '@effect/vitest'
import { Either, Effect } from 'effect'
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
        expect(Either.isRight(result)).toBe(true)
        if (Either.isRight(result)) {
          expect(result.right.ticks).toBe(row.ticks)
          expect(result.right.state.accumulator).toBeCloseTo(row.remainder)
          expect(result.right.interpolationFraction).toBeCloseTo(row.fraction)
          expect(result.right.overloaded).toBe(row.overloaded)
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
      expect(Either.isRight(result)).toBe(true)
      if (Either.isRight(result)) {
        expect(result.right.ticks).toBe(2)
        expect(result.right.state.tick).toBe(SimulationTick(2))
        expect(result.right.state.accumulator).toBeCloseTo(0.025)
        expect(result.right.interpolationFraction).toBeCloseTo(0.5)
        expect(result.right.overloaded).toBe(false)
      }
    }),
  )

  it.effect('caps catch-up at five ticks and reports overload', () =>
    Effect.sync(() => {
      const result = advance(initialFixedStepAccumulator(), dt(1))
      expect(MAX_CATCH_UP_TICKS).toBe(5)
      expect(Either.isRight(result)).toBe(true)
      if (Either.isRight(result)) {
        expect(result.right.ticks).toBe(5)
        expect(result.right.state.tick).toBe(SimulationTick(5))
        expect(result.right.state.accumulator).toBe(duration(0))
        expect(result.right.interpolationFraction).toBe(interpolationFraction(duration(0)))
        expect(result.right.overloaded).toBe(true)
      }
    }),
  )

  it.effect('pause ignores input and resume accepts new elapsed time', () =>
    Effect.sync(() => {
      const paused = pause(initialFixedStepAccumulator())
      const whilePaused = advance(paused, dt(1))
      expect(Either.isRight(whilePaused)).toBe(true)
      if (Either.isRight(whilePaused)) {
        expect(whilePaused.right.ticks).toBe(0)
        expect(whilePaused.right.state.accumulator).toBe(duration(0))
      }

      const afterResume = advance(resume(paused), dt(0.05))
      expect(Either.isRight(afterResume)).toBe(true)
      if (Either.isRight(afterResume)) expect(afterResume.right.ticks).toBe(1)
    }),
  )

  it.effect('preserves a paused remainder and clears it on resume', () =>
    Effect.sync(() => {
      const first = advance(initialFixedStepAccumulator(), dt(0.075))
      expect(Either.isRight(first)).toBe(true)
      if (Either.isRight(first)) {
        const paused = pause(first.right.state)
        const whilePaused = advance(paused, dt(0.2))
        expect(Either.isRight(whilePaused)).toBe(true)
        if (Either.isRight(whilePaused)) {
          expect(whilePaused.right.state.accumulator).toBeCloseTo(0.025)
          expect(whilePaused.right.ticks).toBe(0)
        }
        expect(resume(paused).accumulator).toBe(duration(0))
      }
    }),
  )

  it.effect('propagates addTick overflow without changing the accumulator', () =>
    Effect.sync(() => {
      const state = initialFixedStepAccumulator(SimulationTick(Number.MAX_SAFE_INTEGER))
      const result = advance(state, dt(0.05))
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) expect(result.left._tag).toBe('TimeOverflow')
    }),
  )
})
