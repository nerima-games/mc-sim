import { Effect } from 'effect'
import { describe, expect, it, vi } from '@effect/vitest'
import {
  applyExplosionPlan,
  DEFAULT_EXPLOSION_LIMITS,
  planExplosion,
  type ExplosionBlockPosition,
} from '../src/domain/explosion'
import { EntityId, EntityKind, type Entity } from '../src/domain/entity'
import { position } from '@nerima-games/mc-kernel'

const key = ({ x, y, z }: ExplosionBlockPosition): string => `${x},${y},${z}`
const air = () => ({ resistance: 0, destructible: false })
const world = (entries: ReadonlyArray<readonly [string, number]>, unloaded: ReadonlyArray<string> = []) => {
  const cells = new Map(entries)
  const absent = new Set(unloaded)
  return (cell: ExplosionBlockPosition) => absent.has(key(cell))
    ? undefined
    : cells.has(key(cell))
      ? { resistance: cells.get(key(cell)) ?? 0, destructible: true }
      : air()
}
const entity = (id: string, x: number, y: number, z: number): Entity<null> => ({
  id: EntityId(id),
  kind: EntityKind('test'),
  feetPosition: position(x, y, z),
  healthPoints: 20,
  behaviour: null,
})

describe('planExplosion', () => {
  it('is deterministic for a seed and lets the seed vary marginal blocks', () => {
    const blocks = world([['2,0,0', 1]])
    const request = { center: position(0.5, 0.5, 0.5), radius: 4, seed: 7, blocks, entities: [] }
    expect(planExplosion(request)).toStrictEqual(planExplosion(request))
    const outcomes = new Set(Array.from({ length: 32 }, (_, seed) =>
      JSON.stringify(planExplosion({ ...request, seed }).destroyedBlocks),
    ))
    expect(outcomes.size).toBeGreaterThan(1)
  })

  it('applies distance falloff and resistance', () => {
    const plan = planExplosion({
      center: position(0.5, 0.5, 0.5), radius: 3, seed: 1,
      blocks: world([['0,0,0', 0], ['2,0,0', 100]]), entities: [],
    })
    expect(plan.destroyedBlocks).toContainEqual({ x: 0, y: 0, z: 0 })
    expect(plan.destroyedBlocks).not.toContainEqual({ x: 2, y: 0, z: 0 })
  })

  it('uses solid cells as shielding', () => {
    const open = planExplosion({ center: position(0.5, 0.5, 0.5), radius: 5, seed: 2, blocks: world([['3,0,0', 0]]), entities: [] })
    const shielded = planExplosion({ center: position(0.5, 0.5, 0.5), radius: 5, seed: 2, blocks: world([['1,0,0', 20], ['3,0,0', 0]]), entities: [] })
    expect(open.destroyedBlocks).toContainEqual({ x: 3, y: 0, z: 0 })
    expect(shielded.destroyedBlocks).not.toContainEqual({ x: 3, y: 0, z: 0 })
  })

  it('damages and knocks entities away with partial cover reducing exposure', () => {
    const target = entity('e:1', 2.5, 0, 0.5)
    const open = planExplosion({ center: position(0.5, 0.5, 0.5), radius: 4, seed: 3, blocks: world([]), entities: [target] })
    const covered = planExplosion({ center: position(0.5, 0.5, 0.5), radius: 4, seed: 3, blocks: world([['1,0,0', 20]]), entities: [target] })
    expect(open.entityEffects[0]?.damage).toBeGreaterThan(0)
    expect(open.entityEffects[0]?.knockback.x).toBeGreaterThan(0)
    expect(covered.entityEffects[0]?.exposure ?? 0).toBeLessThan(open.entityEffects[0]?.exposure ?? 0)
  })

  it('never crosses or destroys unloaded cells', () => {
    const plan = planExplosion({
      center: position(0.5, 0.5, 0.5), radius: 5, seed: 4,
      blocks: world([['2,0,0', 0]], ['1,0,0']), entities: [entity('e:1', 2.5, 0, 0.5)],
    })
    expect(plan.destroyedBlocks).not.toContainEqual({ x: 2, y: 0, z: 0 })
    expect(plan.entityEffects).toHaveLength(0)
  })

  it('bounds block, ray, and entity work and reports truncation', () => {
    const plan = planExplosion({
      center: position(0.5, 0.5, 0.5), radius: 20, seed: 5, blocks: world([]),
      entities: [entity('e:1', 1, 0, 0), entity('e:2', 2, 0, 0)],
      limits: { maxVisitedBlocks: 7, maxRaySteps: 2, maxAffectedEntities: 1 },
    })
    expect(plan.visitedBlocks).toBe(7)
    expect(plan.entityEffects.length).toBeLessThanOrEqual(1)
    expect(plan.truncated).toBe(true)
  })

  it('bounds entity traversal even when early entities are outside the blast', () => {
    const plan = planExplosion({
      center: position(0.5, 0.5, 0.5), radius: 4, seed: 5, blocks: world([]),
      entities: [entity('outside', 100, 0, 0), entity('inside', 1, 0, 0)],
      limits: { maxAffectedEntities: 1 },
    })
    expect(plan.entityEffects).toHaveLength(0)
    expect(plan.truncated).toBe(true)
  })

  it('shares block reads for a large explosion instead of tracing every target independently', () => {
    let blockReads = 0
    const plan = planExplosion({
      center: position(0.5, 0.5, 0.5), radius: 16, seed: 7,
      blocks: () => {
        blockReads += 1
        return { resistance: 0, destructible: true }
      },
      entities: [],
    })
    expect(plan.visitedBlocks).toBe(DEFAULT_EXPLOSION_LIMITS.maxVisitedBlocks)
    expect(blockReads).toBeLessThanOrEqual(plan.visitedBlocks + 32)
  })

  it('keeps large explosions deterministic and respects radial shielding', () => {
    const request = {
      center: position(0.5, 0.5, 0.5), radius: 16, seed: 11,
      blocks: world([['8,0,0', 0]]), entities: [],
    }
    const open = planExplosion(request)
    const shielded = planExplosion({ ...request, blocks: world([['4,0,0', 20], ['8,0,0', 0]]) })
    expect(open).toStrictEqual(planExplosion(request))
    expect(open.destroyedBlocks).toContainEqual({ x: 8, y: 0, z: 0 })
    expect(shielded.destroyedBlocks).not.toContainEqual({ x: 8, y: 0, z: 0 })
  })

  it('treats a non-finite center, radius, or seed as zero instead of propagating NaN', () => {
    const plan = planExplosion({
      center: { x: Number.NaN, y: 0.5, z: 0.5 }, radius: Number.NaN, seed: Number.NaN,
      blocks: world([]), entities: [],
    })
    expect(plan.center).toStrictEqual({ x: 0, y: 0.5, z: 0.5 })
    expect(plan.radius).toBe(0)
    expect(plan.seed).toBe(0)
  })

  it('never crosses an unloaded cell when a large explosion shares radial traces', () => {
    const plan = planExplosion({
      center: position(0.5, 0.5, 0.5), radius: 12, seed: 9,
      blocks: world([['5,0,0', 0]], ['3,0,0']), entities: [],
    })
    expect(plan.destroyedBlocks).not.toContainEqual({ x: 5, y: 0, z: 0 })
  })

  it('reports truncation when a radial trace target exceeds the ray-step budget', () => {
    const plan = planExplosion({
      center: position(0.5, 0.5, 0.5), radius: 12, seed: 10,
      blocks: world([['10,0,0', 0]]), entities: [],
      limits: { maxRaySteps: 4 },
    })
    expect(plan.destroyedBlocks).not.toContainEqual({ x: 10, y: 0, z: 0 })
    expect(plan.truncated).toBe(true)
  })

  it('skips a hole in a sparse entities array instead of throwing', () => {
    const entities: Array<Entity<null>> = [entity('e:1', 1, 0, 0)]
    entities.length = 2 // introduces a hole at index 1: entities[1] is undefined, unlike a missing tail element
    const plan = planExplosion({
      center: position(0.5, 0.5, 0.5), radius: 4, seed: 12, blocks: world([]),
      entities,
    })
    expect(plan.entityEffects).toHaveLength(1)
    expect(plan.entityEffects[0]?.id).toBe('e:1')
  })

  it('does not let an entity standing exactly at the blast center divide by zero', () => {
    const plan = planExplosion({
      center: position(0, 0, 0), radius: 4, seed: 13, blocks: world([]),
      entities: [entity('center', 0, -0.9, 0)],
    })
    expect(plan.entityEffects).toHaveLength(1)
    expect(plan.entityEffects[0]?.knockback).toStrictEqual({ x: 0, y: 0, z: 0 })
  })

  it.effect('hands one immutable mutation to the host transaction', () =>
    Effect.gen(function* () {
      const plan = planExplosion({ center: position(0.5, 0.5, 0.5), radius: 2, seed: 6, blocks: world([['0,0,0', 0]]), entities: [] })
      const commit = vi.fn(() => Effect.void)
      yield* applyExplosionPlan(plan, commit)
      expect(commit).toHaveBeenCalledOnce()
      expect(commit).toHaveBeenCalledWith({ destroyedBlocks: plan.destroyedBlocks, entityEffects: plan.entityEffects })
    }),
  )
})
