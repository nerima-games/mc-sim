import { Context, Effect, Layer, Ref } from 'effect'
import { EMPTY_FISHING_STATE, type FishingState } from '../domain/fishing-state.js'

export type FishingServiceApi = {
  readonly snapshot: Effect.Effect<FishingState>
  readonly update: (change: (state: FishingState) => FishingState) => Effect.Effect<FishingState>
  readonly restore: (state: FishingState) => Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

const FishingServiceBase: Context.TagClass<FishingService, '@nerima-games/mc-sim/FishingService', FishingServiceApi> =
  Context.Tag('@nerima-games/mc-sim/FishingService')<FishingService, FishingServiceApi>()

export class FishingService extends FishingServiceBase {}

export const makeFishingService = (
  initial: FishingState = EMPTY_FISHING_STATE,
): Effect.Effect<FishingServiceApi> =>
  Effect.map(Ref.make(initial), (state) => ({
    snapshot: Ref.get(state),
    update: (change) => Ref.modify(state, (current) => {
      const next = change(current)
      return [next, next]
    }),
    restore: (next) => Ref.modify(state, () => [undefined, next]),
    reset: Ref.modify(state, () => [undefined, EMPTY_FISHING_STATE]),
  }))

export const FishingServiceLayer = (
  initial: FishingState = EMPTY_FISHING_STATE,
): Layer.Layer<FishingService> => Layer.effect(FishingService, makeFishingService(initial))
