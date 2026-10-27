import { Result } from 'effect'

/** Weather kinds shared by persistence, gameplay, and presentation boundaries. */
export const WEATHERS = ['clear', 'rain', 'thunder'] as const

export type Weather = (typeof WEATHERS)[number]

/** Complete persistable weather state. Durations are active and therefore positive. */
export type WeatherState = {
  readonly weather: Weather
  readonly remainingSecs: number
}

export type WeatherValidationFailure = Readonly<{
  readonly _tag: 'WeatherValidationFailure'
  readonly field: 'state' | 'weather' | 'remainingSecs'
  readonly reason: 'not-object' | 'unknown-weather' | 'invalid-duration'
}>

export const DEFAULT_WEATHER_REMAINING_SECS = 600

export const INITIAL_WEATHER_STATE: WeatherState = {
  weather: 'clear',
  remainingSecs: DEFAULT_WEATHER_REMAINING_SECS,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isWeather = (value: unknown): value is Weather =>
  typeof value === 'string' && WEATHERS.some((weather) => weather === value)

export const isValidWeatherState = (value: unknown): value is WeatherState => {
  if (!isRecord(value)) return false

  const state = value
  return (
    isWeather(state['weather']) &&
    typeof state['remainingSecs'] === 'number' &&
    Number.isFinite(state['remainingSecs']) &&
    state['remainingSecs'] > 0
  )
}

export const validateWeatherState = (
  value: unknown,
): Result.Result<WeatherState, WeatherValidationFailure> => {
  if (!isRecord(value)) {
    return Result.fail({ _tag: 'WeatherValidationFailure', field: 'state', reason: 'not-object' })
  }

  const weather = value['weather']
  if (!isWeather(weather)) {
    return Result.fail({ _tag: 'WeatherValidationFailure', field: 'weather', reason: 'unknown-weather' })
  }

  const remainingSecs = value['remainingSecs']
  if (typeof remainingSecs !== 'number' || !Number.isFinite(remainingSecs) || remainingSecs <= 0) {
    return Result.fail({ _tag: 'WeatherValidationFailure', field: 'remainingSecs', reason: 'invalid-duration' })
  }

  return Result.succeed({ weather, remainingSecs })
}

export const makeWeatherTransition = (
  weather: unknown,
  remainingSecs: unknown = DEFAULT_WEATHER_REMAINING_SECS,
): Result.Result<WeatherState, WeatherValidationFailure> =>
  validateWeatherState({ weather, remainingSecs })

/** Repair state entering from construction or persistence without making a world unloadable. */
export const normaliseWeatherState = (value: unknown): WeatherState => {
  if (!isRecord(value)) return INITIAL_WEATHER_STATE

  const state = value
  return {
    weather: isWeather(state['weather']) ? state['weather'] : INITIAL_WEATHER_STATE.weather,
    remainingSecs:
      typeof state['remainingSecs'] === 'number' &&
      Number.isFinite(state['remainingSecs']) &&
      state['remainingSecs'] > 0
        ? state['remainingSecs']
        : DEFAULT_WEATHER_REMAINING_SECS,
  }
}
