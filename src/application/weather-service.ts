import { Context, Effect, Layer, Ref } from 'effect'
import * as Weather from '../domain/weather.js'

export type WeatherServiceApi = {
  /** Whole state for persistence and frame inbox publication. */
  readonly snapshot: Effect.Effect<Weather.WeatherState>
  /** Validate a weather literal into a complete candidate without installing it. */
  readonly candidateTransition: (
    weather: unknown,
    remainingSecs?: unknown,
  ) => Effect.Effect<Weather.WeatherState, Weather.WeatherValidationFailure>
  /** Atomically install the complete transition result computed by the gameplay rules. */
  readonly applyTransition: (
    next: unknown,
  ) => Effect.Effect<Weather.WeatherState, Weather.WeatherValidationFailure>
  /** World-load path. Invalid fields are repaired before installation. */
  readonly restore: (weather: unknown) => Effect.Effect<void>
  /** Back to fresh-world weather for re-entrant world loads. */
  readonly reset: Effect.Effect<void>
}

const WeatherServiceBase: Context.ServiceClass<WeatherService, '@nerima-games/mc-sim/WeatherService', WeatherServiceApi> =
  Context.Service<WeatherService, WeatherServiceApi>()('@nerima-games/mc-sim/WeatherService')

export class WeatherService extends WeatherServiceBase {}

export const makeWeatherService = (
  initial: unknown = Weather.INITIAL_WEATHER_STATE,
): Effect.Effect<WeatherServiceApi> =>
  Effect.map(Ref.make(Weather.normaliseWeatherState(initial)), (state) => ({
    snapshot: Ref.get(state),
    candidateTransition: (weather, remainingSecs) =>
      Effect.fromResult(Weather.makeWeatherTransition(weather, remainingSecs)),
    applyTransition: (candidate) =>
      Effect.flatMap(Effect.fromResult(Weather.validateWeatherState(candidate)), (next) =>
        Ref.modify(state, () => [next, next]),
      ),
    restore: (next) => Effect.map(Ref.set(state, Weather.normaliseWeatherState(next)), () => undefined),
    reset: Ref.set(state, Weather.INITIAL_WEATHER_STATE),
  }))

export const WeatherServiceLayer = (
  initial: unknown = Weather.INITIAL_WEATHER_STATE,
): Layer.Layer<WeatherService> => Layer.effect(WeatherService, makeWeatherService(initial))
