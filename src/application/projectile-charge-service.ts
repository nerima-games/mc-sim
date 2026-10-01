import { Context, Effect, Layer, Ref } from 'effect'
import { EMPTY_PROJECTILE_STATE, type ProjectileState } from '../domain/projectile-state.js'

export type ProjectileChargeServiceApi = {
  readonly snapshot: Effect.Effect<ProjectileState>
  readonly update: (change: (state: ProjectileState) => ProjectileState) => Effect.Effect<ProjectileState>
  readonly restore: (state: ProjectileState) => Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}

const ProjectileChargeServiceBase: Context.TagClass<ProjectileChargeService, '@nerima-games/mc-sim/ProjectileChargeService', ProjectileChargeServiceApi> =
  Context.Tag('@nerima-games/mc-sim/ProjectileChargeService')<ProjectileChargeService, ProjectileChargeServiceApi>()

export class ProjectileChargeService extends ProjectileChargeServiceBase {}

export const makeProjectileChargeService = (
  initial: ProjectileState = EMPTY_PROJECTILE_STATE,
): Effect.Effect<ProjectileChargeServiceApi> =>
  Effect.map(Ref.make(initial), (state) => ({
    snapshot: Ref.get(state),
    update: (change) => Ref.modify(state, (current) => {
      const next = change(current)
      return [next, next]
    }),
    restore: (next) => Ref.modify(state, () => [undefined, next]),
    reset: Ref.modify(state, () => [undefined, EMPTY_PROJECTILE_STATE]),
  }))

export const ProjectileChargeServiceLayer = (
  initial: ProjectileState = EMPTY_PROJECTILE_STATE,
): Layer.Layer<ProjectileChargeService> => Layer.effect(ProjectileChargeService, makeProjectileChargeService(initial))
