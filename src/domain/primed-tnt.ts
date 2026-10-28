import { Result } from 'effect'
import { planExplosion, validateExplosionRequest, type ExplosionLimits, type ExplosionMutation, type ExplosionPlan, type ExplosionRequest, type ExplosionValidationFailure } from './explosion.js'

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

export type PrimedTntValidationFailure = Readonly<{
  readonly _tag: 'PrimedTntValidationFailure'
  readonly path: string
  readonly reason: string
}>

export type PrimedTntFailure = PrimedTntValidationFailure | ExplosionValidationFailure

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

const validationFailure = (path: string, reason: string): PrimedTntValidationFailure => ({
  _tag: 'PrimedTntValidationFailure',
  path,
  reason,
})

export const primeTnt = (
  fuseSecs: number = DEFAULT_TNT_FUSE_SECS,
): Result.Result<PrimedTntState, PrimedTntValidationFailure> => {
  if (!Number.isFinite(fuseSecs) || fuseSecs < 0) {
    return Result.fail(validationFailure('fuseSecs', 'must be finite and non-negative'))
  }
  return Result.succeed({ kind: 'primed', remainingFuseSecs: fuseSecs })
}

/** Advance one primed TNT snapshot and plan its blast exactly once. */
export const planPrimedTnt = (
  request: PrimedTntRequest,
): Result.Result<PrimedTntPlan, PrimedTntFailure> => {
  const explosionRequest = validateExplosionRequest(request)
  if (Result.isFailure(explosionRequest)) return Result.fail(explosionRequest.failure)
  if (!Number.isFinite(request.deltaTimeSecs) || request.deltaTimeSecs < 0) {
    return Result.fail(validationFailure('deltaTimeSecs', 'must be finite and non-negative'))
  }
  if (request.state === null || typeof request.state !== 'object') {
    return Result.fail(validationFailure('state', 'must be a primed TNT state'))
  }
  if (request.state.kind === 'detonated') {
    return Result.succeed({
      before: request.state,
      after: request.state,
      advancedSecs: 0,
      deferredSecs: 0,
      explosion: undefined,
    })
  }
  if (request.state.kind !== 'primed') {
    return Result.fail(validationFailure('state.kind', 'must be primed or detonated'))
  }
  if (!Number.isFinite(request.state.remainingFuseSecs) || request.state.remainingFuseSecs < 0) {
    return Result.fail(validationFailure('state.remainingFuseSecs', 'must be finite and non-negative'))
  }

  const requestedSecs = request.deltaTimeSecs
  const advancedSecs = Math.min(requestedSecs, MAX_TNT_FUSE_ADVANCE_SECS)
  const deferredSecs = requestedSecs - advancedSecs
  const remainingFuseSecs = request.state.remainingFuseSecs
  if (advancedSecs < remainingFuseSecs) {
    return Result.succeed({
      before: request.state,
      after: {
        kind: 'primed',
        remainingFuseSecs: remainingFuseSecs - advancedSecs,
      },
      advancedSecs,
      deferredSecs,
      explosion: undefined,
    })
  }

  const explosion = planExplosion(request)
  if (Result.isFailure(explosion)) return Result.fail(explosion.failure)
  return Result.succeed({
    before: request.state,
    after: { kind: 'detonated' },
    advancedSecs: remainingFuseSecs,
    deferredSecs,
    explosion: explosion.success,
  })
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
