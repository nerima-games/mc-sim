import { Context, Effect, Layer, Ref } from 'effect'
import { EMPTY_END_STATE, type EndState } from '../domain/end-state.js'

export type EndStateServiceApi = {
  readonly snapshot: Effect.Effect<EndState>
  readonly update: (change: (state: EndState) => EndState) => Effect.Effect<EndState>
  readonly restore: (state: EndState) => Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

const EndStateServiceBase: Context.TagClass<EndStateService, '@nerima-games/mc-sim/EndStateService', EndStateServiceApi> =
  Context.Tag('@nerima-games/mc-sim/EndStateService')<EndStateService, EndStateServiceApi>()

export class EndStateService extends EndStateServiceBase {}

export const makeEndStateService = (
  initial: EndState = EMPTY_END_STATE,
): Effect.Effect<EndStateServiceApi> =>
  Effect.map(Ref.make(initial), (state) => ({
    snapshot: Ref.get(state),
    update: (change) => Ref.modify(state, (current) => {
      const next = change(current)
      return [next, next]
    }),
    restore: (next) => Ref.modify(state, () => [undefined, next]),
    reset: Ref.modify(state, () => [undefined, EMPTY_END_STATE]),
  }))

export const EndStateServiceLayer = (
  initial: EndState = EMPTY_END_STATE,
): Layer.Layer<EndStateService> => Layer.effect(EndStateService, makeEndStateService(initial))
