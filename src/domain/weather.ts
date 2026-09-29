/** Weather kinds shared by persistence, gameplay, and presentation boundaries. */
export const WEATHERS = ['clear', 'rain', 'thunder'] as const

export type Weather = (typeof WEATHERS)[number]

/** Complete persistable weather state. Durations are active and therefore positive. */
export type WeatherState = {
  readonly weather: Weather
  readonly remainingSecs: number
}

export const INITIAL_WEATHER_STATE: WeatherState = {
  weather: 'clear',
  remainingSecs: 600,
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
        : INITIAL_WEATHER_STATE.remainingSecs,
  }
}
