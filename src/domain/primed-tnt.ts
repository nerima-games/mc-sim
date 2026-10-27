import { planExplosion, type ExplosionLimits, type ExplosionMutation, type ExplosionPlan, type ExplosionRequest } from './explosion.js'

export const DEFAULT_TNT_FUSE_SECS = 4
export const MAX_TNT_FUSE_ADVANCE_SECS = 10

export type PrimedTntState =
  | { readonly kind: 'primed'; readonly remainingFuseSecs: number }
  | { readonly kind: 'detonated' }

export type PrimedTntRequest = Omit<ExplosionRequest, 'limits'> & {
  readonly state: PrimedTntState
  readonly deltaTimeSecs: number
  readonly limits?: Partial<ExplosionLimits>
}

export type PrimedTntPlan = {
  readonly before: PrimedTntState
  readonly after: PrimedTntState
  readonly advancedSecs: number
  readonly deferredSecs: number
  readonly explosion: ExplosionPlan | undefined
}

export type PrimedTntMutation = {
  readonly expected: PrimedTntState
  readonly next: PrimedTntState
  readonly explosion: ExplosionMutation | undefined
}

export type PrimedTntCommit = (mutation: PrimedTntMutation) => void

const finiteNonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0

export const primeTnt = (fuseSecs: number = DEFAULT_TNT_FUSE_SECS): PrimedTntState => ({
  kind: 'primed',
  remainingFuseSecs: finiteNonNegative(fuseSecs),
})

/** Advance one primed TNT snapshot and plan its blast exactly once. */
export const planPrimedTnt = (
  request: PrimedTntRequest,
): PrimedTntPlan => {
  const requestedSecs = finiteNonNegative(request.deltaTimeSecs)
  const advancedSecs = Math.min(requestedSecs, MAX_TNT_FUSE_ADVANCE_SECS)
  const deferredSecs = requestedSecs - advancedSecs

  if (request.state.kind === 'detonated') {
    return {
      before: request.state,
      after: request.state,
      advancedSecs: 0,
      deferredSecs: 0,
      explosion: undefined,
    }
  }

  const remainingFuseSecs = finiteNonNegative(request.state.remainingFuseSecs)
  if (advancedSecs < remainingFuseSecs) {
    return {
      before: request.state,
      after: {
        kind: 'primed',
        remainingFuseSecs: remainingFuseSecs - advancedSecs,
      },
      advancedSecs,
      deferredSecs,
      explosion: undefined,
    }
  }

  return {
    before: request.state,
    after: { kind: 'detonated' },
    advancedSecs: remainingFuseSecs,
    deferredSecs,
    explosion: planExplosion(request),
  }
}

/** Hand fuse removal and blast effects to one host-owned atomic transaction. */
export const applyPrimedTntPlan = (
  plan: PrimedTntPlan,
  commit: PrimedTntCommit,
): void =>
  commit({
    expected: plan.before,
    next: plan.after,
    explosion:
      plan.explosion === undefined
        ? undefined
        : {
            destroyedBlocks: plan.explosion.destroyedBlocks,
            entityEffects: plan.explosion.entityEffects,
          },
  })
