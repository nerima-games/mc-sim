import { Effect } from 'effect'
import { describe, expect, it, vi } from '@effect/vitest'
import { position } from '../src/domain/kernel-vocabulary'
import {
  applyPrimedTntPlan,
  MAX_TNT_FUSE_ADVANCE_SECS,
  planPrimedTnt,
  primeTnt,
} from '../src/domain/primed-tnt'

const air = () => ({ resistance: 0, destructible: false })
const request = (state = primeTnt(4), deltaTimeSecs = 4) => ({
  state,
  deltaTimeSecs,
  center: position(0.5, 0.5, 0.5),
  radius: 4,
  seed: 17,
  blocks: air,
  entities: [],
})

describe('primed TNT', () => {
  it('advances without producing a blast before the fuse expires', () => {
    const plan = planPrimedTnt(request(primeTnt(4), 1.5))

    expect(plan).toMatchObject({
      after: { _tag: 'Primed', remainingFuseSecs: 2.5 },
      advancedSecs: 1.5,
      deferredSecs: 0,
      explosion: undefined,
    })
  })

  it('detonates once and reuses the deterministic bounded explosion planner', () => {
    const first = planPrimedTnt({
      ...request(),
      limits: { maxVisitedBlocks: 3, maxRaySteps: 4, maxAffectedEntities: 0 },
    })
    const terminal = planPrimedTnt(request(first.after, 4))

    expect(first.after).toStrictEqual({ _tag: 'Detonated' })
    expect(first.explosion).toMatchObject({
      seed: 17,
      visitedBlocks: 3,
      truncated: true,
    })
    expect(terminal).toMatchObject({
      after: { _tag: 'Detonated' },
      advancedSecs: 0,
      explosion: undefined,
    })
  })

  it('does not cross an unloaded cell while planning the TNT blast', () => {
    const plan = planPrimedTnt({
      ...request(),
      blocks: ({ x, y, z }) => {
        if (x === 1 && y === 0 && z === 0) return undefined
        return x === 2 && y === 0 && z === 0
          ? { resistance: 0, destructible: true }
          : air()
      },
    })

    expect(plan.explosion?.destroyedBlocks).not.toContainEqual({ x: 2, y: 0, z: 0 })
  })

  it('caps oversized frame work and reports time that must be retried', () => {
    const plan = planPrimedTnt(request(primeTnt(30), 25))

    expect(plan).toMatchObject({
      after: { _tag: 'Primed', remainingFuseSecs: 20 },
      advancedSecs: MAX_TNT_FUSE_ADVANCE_SECS,
      deferredSecs: 15,
    })
  })

  it.effect('commits fuse and blast as one host-owned mutation', () =>
    Effect.gen(function* () {
      const plan = planPrimedTnt(request())
      const commit = vi.fn(() => Effect.void)

      yield* applyPrimedTntPlan(plan, commit)

      expect(commit).toHaveBeenCalledOnce()
      expect(commit).toHaveBeenCalledWith({
        expected: plan.before,
        next: plan.after,
        explosion: {
          destroyedBlocks: plan.explosion?.destroyedBlocks,
          entityEffects: plan.explosion?.entityEffects,
        },
      })
    }),
  )
})
