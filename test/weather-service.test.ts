import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeWeatherService } from '../application/weather-service'
import {
  INITIAL_WEATHER_STATE,
  isValidWeatherState,
  normaliseWeatherState,
  type WeatherState,
} from '../domain/weather'

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

  it.effect('normalises corrupt constructor, transition, and restore input', () =>
    Effect.gen(function* () {
      const weather = yield* makeWeatherService({
        weather: 'snow',
        remainingSecs: Number.NaN,
      } as unknown as WeatherState)
      expect(yield* weather.snapshot).toStrictEqual(INITIAL_WEATHER_STATE)

      const applied = yield* weather.applyTransition({
        weather: 'rain',
        remainingSecs: -10,
      })
      expect(applied).toStrictEqual({ weather: 'rain', remainingSecs: 600 })

      yield* weather.restore({
        weather: 'fog',
        remainingSecs: 12,
      } as unknown as WeatherState)
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
})
