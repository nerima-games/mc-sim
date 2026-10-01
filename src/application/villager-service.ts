import { Context, Effect, Layer, Ref } from 'effect'
import { EMPTY_VILLAGER_TRADE_STATE, type VillagerTradeState } from '../domain/villager-state.js'

export type VillagerServiceApi = {
  readonly snapshot: Effect.Effect<VillagerTradeState>
  readonly update: (change: (state: VillagerTradeState) => VillagerTradeState) => Effect.Effect<VillagerTradeState>
  readonly restore: (state: VillagerTradeState) => Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

const VillagerServiceBase: Context.TagClass<VillagerService, '@nerima-games/mc-sim/VillagerService', VillagerServiceApi> =
  Context.Tag('@nerima-games/mc-sim/VillagerService')<VillagerService, VillagerServiceApi>()

export class VillagerService extends VillagerServiceBase {}

export const makeVillagerService = (
  initial: VillagerTradeState = EMPTY_VILLAGER_TRADE_STATE,
): Effect.Effect<VillagerServiceApi> =>
  Effect.map(Ref.make(initial), (state) => ({
    snapshot: Ref.get(state),
    update: (change) => Ref.modify(state, (current) => {
      const next = change(current)
      return [next, next]
    }),
    restore: (next) => Ref.modify(state, () => [undefined, next]),
    reset: Ref.modify(state, () => [undefined, EMPTY_VILLAGER_TRADE_STATE]),
  }))

export const VillagerServiceLayer = (
  initial: VillagerTradeState = EMPTY_VILLAGER_TRADE_STATE,
): Layer.Layer<VillagerService> => Layer.effect(VillagerService, makeVillagerService(initial))
