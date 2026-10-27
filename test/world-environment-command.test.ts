import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Result } from 'effect'
import { makeWeatherService } from '../src/application/weather-service'
import {
  DEFAULT_WEATHER_REMAINING_SECS,
  INITIAL_WEATHER_STATE,
  makeWeatherTransition,
} from '../src/domain/weather'
import { simulationTickToDayFraction } from '../src/domain/time-of-day'

describe('world environment command conversions', () => {
  it.effect('converts a validated absolute tick to the current day fraction', () =>
    Effect.sync(() => {
      const converted = simulationTickToDayFraction(6000, 24000)

      expect(Result.isSuccess(converted)).toBe(true)
      if (Result.isSuccess(converted)) expect(converted.success).toBe(0.25)
    }),
  )

  it.effect('rejects invalid tick and day-length inputs instead of inventing a time', () =>
    Effect.sync(() => {
      expect(Result.isFailure(simulationTickToDayFraction(-1, 24000))).toBe(true)
      expect(Result.isFailure(simulationTickToDayFraction(6000.5, 24000))).toBe(true)
      expect(Result.isFailure(simulationTickToDayFraction(Number.MAX_SAFE_INTEGER + 1, 24000))).toBe(true)
      expect(Result.isFailure(simulationTickToDayFraction(6000, 0))).toBe(true)
    }),
  )

  it.effect('turns a weather literal into a complete state and rejects invalid literals', () =>
    Effect.sync(() => {
      const transition = makeWeatherTransition('rain')

      expect(Result.isSuccess(transition)).toBe(true)
      if (Result.isSuccess(transition)) {
        expect(transition.success).toStrictEqual({
          weather: 'rain',
          remainingSecs: DEFAULT_WEATHER_REMAINING_SECS,
        })
      }
      expect(Result.isFailure(makeWeatherTransition('snow'))).toBe(true)
      expect(Result.isFailure(makeWeatherTransition('rain', Number.NaN))).toBe(true)
    }),
  )

  it.effect('keeps invalid weather transitions atomic and installs a candidate only after restore', () =>
    Effect.gen(function* () {
      const weather = yield* makeWeatherService()
      const candidate = yield* weather.candidateTransition('thunder', 45)

      expect(yield* weather.snapshot).toStrictEqual(INITIAL_WEATHER_STATE)
      expect(candidate).toStrictEqual({ weather: 'thunder', remainingSecs: 45 })

      const rejected = yield* Effect.exit(
        weather.applyTransition({ weather: 'rain', remainingSecs: 0 }),
      )
      expect(Exit.isFailure(rejected)).toBe(true)
      expect(yield* weather.snapshot).toStrictEqual(INITIAL_WEATHER_STATE)

      yield* weather.restore(candidate)
      expect(yield* weather.snapshot).toStrictEqual(candidate)
    }),
  )
})
