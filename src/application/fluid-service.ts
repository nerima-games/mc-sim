import { Context, Effect, Layer, Ref } from 'effect'
import { EMPTY_FLUID_STATE, type FluidState } from '../domain/fluid-state.js'

export type FluidServiceApi = {
  readonly snapshot: Effect.Effect<FluidState>
  readonly update: (change: (state: FluidState) => FluidState) => Effect.Effect<FluidState>
  readonly restore: (state: FluidState) => Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

const FluidServiceBase: Context.TagClass<FluidService, '@nerima-games/mc-sim/FluidService', FluidServiceApi> =
  Context.Tag('@nerima-games/mc-sim/FluidService')<FluidService, FluidServiceApi>()

export class FluidService extends FluidServiceBase {}

export const makeFluidService = (
  initial: FluidState = EMPTY_FLUID_STATE,
): Effect.Effect<FluidServiceApi> =>
  Effect.map(Ref.make(initial), (state) => ({
    snapshot: Ref.get(state),
    update: (change) => Ref.modify(state, (current) => {
      const next = change(current)
      return [next, next]
    }),
    restore: (next) => Ref.modify(state, () => [undefined, next]),
    reset: Ref.modify(state, () => [undefined, EMPTY_FLUID_STATE]),
  }))

export const FluidServiceLayer = (
  initial: FluidState = EMPTY_FLUID_STATE,
): Layer.Layer<FluidService> => Layer.effect(FluidService, makeFluidService(initial))
