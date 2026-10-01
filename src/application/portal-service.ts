import { Context, Effect, Layer, Ref } from 'effect'
import { EMPTY_PORTAL_STATE, type PortalState } from '../domain/portal-state.js'

export type PortalServiceApi = {
  readonly snapshot: Effect.Effect<PortalState>
  readonly update: (change: (state: PortalState) => PortalState) => Effect.Effect<PortalState>
  readonly restore: (state: PortalState) => Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

const PortalServiceBase: Context.TagClass<PortalService, '@nerima-games/mc-sim/PortalService', PortalServiceApi> =
  Context.Tag('@nerima-games/mc-sim/PortalService')<PortalService, PortalServiceApi>()

export class PortalService extends PortalServiceBase {}

export const makePortalService = (
  initial: PortalState = EMPTY_PORTAL_STATE,
): Effect.Effect<PortalServiceApi> =>
  Effect.map(Ref.make(initial), (state) => ({
    snapshot: Ref.get(state),
    update: (change) => Ref.modify(state, (current) => {
      const next = change(current)
      return [next, next]
    }),
    restore: (next) => Ref.modify(state, () => [undefined, next]),
    reset: Ref.modify(state, () => [undefined, EMPTY_PORTAL_STATE]),
  }))

export const PortalServiceLayer = (
  initial: PortalState = EMPTY_PORTAL_STATE,
): Layer.Layer<PortalService> => Layer.effect(PortalService, makePortalService(initial))
