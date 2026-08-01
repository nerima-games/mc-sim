import type { Effect } from 'effect'
import {
  planExplosion,
  type ExplosionLimits,
  type ExplosionMutation,
  type ExplosionPlan,
  type ExplosionRequest,
} from './explosion'

export const MAX_TNT_FUSE_ADVANCE_SECS = 10

export type PrimedTntState =
  | { readonly _tag: 'Primed'; readonly remainingFuseSecs: number }
  | { readonly _tag: 'Detonated' }

export type PrimedTntRequest<S> = Omit<ExplosionRequest<S>, 'limits'> & {
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
  /** The host compares this snapshot inside the same transaction that applies the mutation. */
  readonly expected: PrimedTntState
  readonly next: PrimedTntState
  readonly explosion: ExplosionMutation | undefined
}

export type PrimedTntCommit<E = never, R = never> = (
  mutation: PrimedTntMutation,
) => Effect.Effect<void, E, R>

const finiteNonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0

export const primeTnt = (fuseSecs: number): PrimedTntState => ({
  _tag: 'Primed',
  remainingFuseSecs: finiteNonNegative(fuseSecs),
})

/** Advance one primed TNT snapshot and plan its blast exactly once. */
export const planPrimedTnt = <S>(
  request: PrimedTntRequest<S>,
): PrimedTntPlan => {
  const requestedSecs = finiteNonNegative(request.deltaTimeSecs)
  const advancedSecs = Math.min(requestedSecs, MAX_TNT_FUSE_ADVANCE_SECS)
  const deferredSecs = requestedSecs - advancedSecs

  if (request.state._tag === 'Detonated') {
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
        _tag: 'Primed',
        remainingFuseSecs: remainingFuseSecs - advancedSecs,
      },
      advancedSecs,
      deferredSecs,
      explosion: undefined,
    }
  }

  return {
    before: request.state,
    after: { _tag: 'Detonated' },
    advancedSecs: remainingFuseSecs,
    deferredSecs,
    explosion: planExplosion(request),
  }
}

/** Hand fuse removal and blast effects to one host-owned atomic transaction. */
export const applyPrimedTntPlan = <E, R>(
  plan: PrimedTntPlan,
  commit: PrimedTntCommit<E, R>,
): Effect.Effect<void, E, R> =>
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
