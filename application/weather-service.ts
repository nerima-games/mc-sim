import { Context, Effect, Layer, Ref } from 'effect'
import * as Weather from '../domain/weather'

export type WeatherServiceApi = {
  /** Whole state for persistence and frame inbox publication. */
  readonly snapshot: Effect.Effect<Weather.WeatherState>
  /** Atomically install the complete transition result computed by the gameplay rules. */
  readonly applyTransition: (
    next: Weather.WeatherState,
  ) => Effect.Effect<Weather.WeatherState>
  /** World-load path. Invalid fields are repaired before installation. */
  readonly restore: (weather: Weather.WeatherState) => Effect.Effect<void>
  /** Back to fresh-world weather for re-entrant world loads. */
  readonly reset: Effect.Effect<void>
}

export class WeatherService extends Context.Tag('@nerima-games/mc-sim/WeatherService')<
  WeatherService,
  WeatherServiceApi
>() {}

export const makeWeatherService = (
  initial: Weather.WeatherState = Weather.INITIAL_WEATHER_STATE,
): Effect.Effect<WeatherServiceApi> =>
  Effect.map(Ref.make(Weather.normaliseWeatherState(initial)), (state) => ({
    snapshot: Ref.get(state),
    applyTransition: (candidate) =>
      Ref.modify(state, () => {
        const next = Weather.normaliseWeatherState(candidate)
        return [next, next]
      }),
    restore: (next) => Ref.set(state, Weather.normaliseWeatherState(next)),
    reset: Ref.set(state, Weather.INITIAL_WEATHER_STATE),
  }))

export const WeatherServiceLayer = (
  initial: Weather.WeatherState = Weather.INITIAL_WEATHER_STATE,
): Layer.Layer<WeatherService> => Layer.effect(WeatherService, makeWeatherService(initial))
