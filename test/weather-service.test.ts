import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Result } from 'effect'
import {
  makeWeatherService,
  WeatherService,
  WeatherServiceLayer,
} from '../src/application/weather-service'
import {
  INITIAL_WEATHER_STATE,
  makeWeatherTransition,
  isValidWeatherState,
  normaliseWeatherState,
  validateWeatherState,
  type WeatherState,
} from '../src/domain/weather'

describe('weather state', () => {
  it('recognises all supported weather kinds and positive finite durations', () => {
    expect(isValidWeatherState({ weather: 'clear', remainingSecs: 600 })).toBe(true)
    expect(isValidWeatherState({ weather: 'rain', remainingSecs: 300 })).toBe(true)
    expect(isValidWeatherState({ weather: 'thunder', remainingSecs: 120 })).toBe(true)
  })

  it('rejects incomplete, expired, and non-finite state', () => {
    expect(isValidWeatherState({ weather: 'snow', remainingSecs: 300 })).toBe(false)
    expect(isValidWeatherState({ weather: 'rain', remainingSecs: 0 })).toBe(false)
    expect(isValidWeatherState({ weather: 'rain', remainingSecs: -1 })).toBe(false)
    expect(isValidWeatherState({ weather: 'rain', remainingSecs: Number.NaN })).toBe(false)
    expect(isValidWeatherState({ weather: 'rain', remainingSecs: Number.POSITIVE_INFINITY })).toBe(
      false,
    )
    expect(isValidWeatherState(null)).toBe(false)
  })

  it('repairs invalid fields independently and deterministically', () => {
    expect(normaliseWeatherState({ weather: 'snow', remainingSecs: 45 })).toStrictEqual({
      weather: 'clear',
      remainingSecs: 45,
    })
    expect(normaliseWeatherState({ weather: 'thunder', remainingSecs: 0 })).toStrictEqual({
      weather: 'thunder',
      remainingSecs: 600,
    })
    expect(normaliseWeatherState(undefined)).toStrictEqual(INITIAL_WEATHER_STATE)
  })

  it('validates complete state transitions from weather literals', () => {
    const transition = makeWeatherTransition('rain')

    expect(Result.isSuccess(transition)).toBe(true)
    if (Result.isSuccess(transition)) {
      expect(transition.success).toStrictEqual({ weather: 'rain', remainingSecs: 600 })
    }
    expect(Result.isFailure(makeWeatherTransition('snow'))).toBe(true)
    expect(Result.isFailure(makeWeatherTransition('rain', 0))).toBe(true)

    const validState = validateWeatherState({ weather: 'thunder', remainingSecs: 30 })
    expect(Result.isSuccess(validState)).toBe(true)
    if (Result.isSuccess(validState)) {
      expect(validState.success).toStrictEqual({ weather: 'thunder', remainingSecs: 30 })
    }

    const unknownWeather = validateWeatherState({ weather: 'snow', remainingSecs: 30 })
    expect(Result.isFailure(unknownWeather)).toBe(true)
    if (Result.isFailure(unknownWeather)) {
      expect(unknownWeather.failure).toStrictEqual({
        _tag: 'WeatherValidationFailure',
        field: 'weather',
        reason: 'unknown-weather',
      })
    }

    expect(validateWeatherState(null)).toEqual(
      Result.fail({ _tag: 'WeatherValidationFailure', field: 'state', reason: 'not-object' }),
    )
  })
})

describe('WeatherService', () => {
  it.effect('starts with fresh-world clear weather', () =>
    Effect.gen(function* () {
      const weather = yield* makeWeatherService()

      expect(yield* weather.snapshot).toStrictEqual(INITIAL_WEATHER_STATE)
    }),
  )

  it.effect('atomically applies complete clear, rain, and thunder transition results', () =>
    Effect.gen(function* () {
      const weather = yield* makeWeatherService()
      const transitions: ReadonlyArray<WeatherState> = [
        { weather: 'rain', remainingSecs: 240 },
        { weather: 'thunder', remainingSecs: 90 },
        { weather: 'clear', remainingSecs: 720 },
      ]

      for (const transition of transitions) {
        expect(yield* weather.applyTransition(transition)).toStrictEqual(transition)
        expect(yield* weather.snapshot).toStrictEqual(transition)
      }
    }),
  )

  it.effect('builds a weather literal candidate without installing it', () =>
    Effect.gen(function* () {
      const weather = yield* makeWeatherService()
      const candidate = yield* weather.candidateTransition('thunder', 75)

      expect(candidate).toStrictEqual({ weather: 'thunder', remainingSecs: 75 })
      expect(yield* weather.snapshot).toStrictEqual(INITIAL_WEATHER_STATE)
    }),
  )

  it.effect('round-trips a persisted snapshot', () =>
    Effect.gen(function* () {
      const source = yield* makeWeatherService()
      yield* source.applyTransition({ weather: 'thunder', remainingSecs: 73.5 })
      const saved = yield* source.snapshot

      const restored = yield* makeWeatherService()
      yield* restored.restore(saved)

      expect(yield* restored.snapshot).toStrictEqual(saved)
    }),
  )

  it.effect('repairs corrupt construction and restore input, while rejecting invalid transitions atomically', () =>
    Effect.gen(function* () {
      const weather = yield* makeWeatherService({
        weather: 'snow',
        remainingSecs: Number.NaN,
      })
      expect(yield* weather.snapshot).toStrictEqual(INITIAL_WEATHER_STATE)

      const failedTransition = yield* Effect.exit(weather.applyTransition({
        weather: 'rain',
        remainingSecs: -10,
      }))
      expect(Exit.isFailure(failedTransition)).toBe(true)
      expect(yield* weather.snapshot).toStrictEqual(INITIAL_WEATHER_STATE)

      yield* weather.restore({
        weather: 'fog',
        remainingSecs: 12,
      })
      expect(yield* weather.snapshot).toStrictEqual({ weather: 'clear', remainingSecs: 12 })
    }),
  )

  it.effect('resets a running world without mutating caller-owned transition state', () =>
    Effect.gen(function* () {
      const weather = yield* makeWeatherService()
      const transition: WeatherState = { weather: 'rain', remainingSecs: 180 }

      yield* weather.applyTransition(transition)
      yield* weather.reset

      expect(transition).toStrictEqual({ weather: 'rain', remainingSecs: 180 })
      expect(yield* weather.snapshot).toStrictEqual(INITIAL_WEATHER_STATE)
    }),
  )

  it.effect('provides the weather service through its layer', () =>
    Effect.gen(function* () {
      const weather = yield* WeatherService

      expect(yield* weather.snapshot).toStrictEqual(INITIAL_WEATHER_STATE)
    }).pipe(Effect.provide(WeatherServiceLayer())),
  )
})
