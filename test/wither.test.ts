import { describe, expect, it } from 'vitest'
import {
  WITHER_ARMOUR_THRESHOLD,
  createWither,
  damageWither,
  matchWitherSummon,
  restoreWither,
  serializeWither,
  stepWither,
  witherSkullProjectile,
} from '../src/domain/wither'

describe('wither summon', () => {
  it.each(['soul_sand', 'soul_soil'] as const)('matches a complete T made from %s', (material) => {
    const blocks = new Map<string, string>()
    const put = (x: number, y: number, z: number, block: string) => blocks.set(`${x},${y},${z}`, block)
    put(0, 0, 0, material)
    for (const x of [-1, 0, 1]) {
      put(x, 1, 0, material)
      put(x, 2, 0, 'wither_skeleton_skull')
    }

    expect(matchWitherSummon({ x: 0, y: 0, z: 0 }, ({ x, y, z }) => blocks.get(`${x},${y},${z}`))).toEqual({
      axis: 'x',
      spawnPosition: { x: 0.5, y: 1, z: 0.5 },
      consumedBlocks: [
        { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 },
        { x: -1, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 1, y: 2, z: 0 },
      ],
    })
  })

  it('rejects an incomplete skull row', () => {
    expect(matchWitherSummon({ x: 0, y: 0, z: 0 }, ({ y }) => y < 2 ? 'soul_sand' : 'air')).toBeUndefined()
  })
})
describe('wither lifecycle', () => {
  it('charges invulnerably, then emits its spawn blast exactly once', () => {
    const spawned = createWither({ x: 0, y: 10, z: 0 })
    expect(damageWither(spawned, 100, 'melee')).toMatchObject({ state: spawned, ignored: true })

    const charging = stepWither(spawned, 9)
    const activated = stepWither(charging.state, 1)
    const later = stepWither(activated.state, 1)
    expect(charging.state.phase).toBe('charging')
    expect(activated).toMatchObject({ state: { phase: 'airborne' }, spawnExplosion: { power: 7 } })
    expect(later.spawnExplosion).toBeUndefined()
  })

  it('tracks a target in three dimensions, caps speed, and regenerates', () => {
    const active = stepWither(createWither({ x: 0, y: 0, z: 0 }), 10).state
    const hurt = damageWither(active, 10, 'melee').state
    const moved = stepWither(hurt, 1, { x: 100, y: 100, z: 0 }).state
    expect(moved.healthPoints).toBe(291)
    expect(Math.hypot(moved.velocity.x, moved.velocity.y, moved.velocity.z)).toBeCloseTo(5)
    expect(moved.feetPosition.y).toBeGreaterThan(0)
  })

  it('enters permanent armour at half health and ignores ranged damage', () => {
    const active = stepWither(createWither({ x: 0, y: 0, z: 0 }), 10).state
    const armoured = damageWither(active, WITHER_ARMOUR_THRESHOLD, 'melee').state
    expect(armoured.phase).toBe('armoured')
    expect(damageWither(armoured, 20, 'ranged')).toMatchObject({ state: armoured, ignored: true, appliedDamage: 0 })
    expect(damageWither(armoured, 20, 'melee').state.healthPoints).toBe(130)
    expect(stepWither(armoured, 200).state.phase).toBe('armoured')
  })

  it('dies once with a nether star drop and a despawn descriptor', () => {
    const active = stepWither(createWither({ x: 2, y: 3, z: 4 }), 10).state
    const killed = damageWither(active, 500, 'void')
    expect(killed.death).toEqual({
      despawn: { kind: 'wither', reason: 'killed' },
      drop: { item: 'nether_star', count: 1, position: { x: 2, y: 3, z: 4 } },
    })
    expect(damageWither(killed.state, 1, 'melee').death).toBeUndefined()
  })

  it('round-trips a versioned snapshot and repairs invalid restored magnitudes', () => {
    const state = damageWither(stepWither(createWither({ x: 1, y: 2, z: 3 }), 10).state, 160, 'melee').state
    expect(restoreWither(serializeWither(state))).toEqual(state)
    expect(restoreWither({
      kind: 'wither', version: 1,
      state: { ...state, healthPoints: Number.NaN, feetPosition: { x: Number.NaN, y: 2, z: 3 } },
    })).toMatchObject({ phase: 'dead', healthPoints: 0, feetPosition: { x: 0, y: 2, z: 3 } })
  })
})

describe('wither skull descriptors', () => {
  it('distinguishes ordinary and blue skull block behaviour', () => {
    const normal = witherSkullProjectile({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 4 }, 'normal')
    const blue = witherSkullProjectile({ x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 4 }, 'blue')
    expect(normal).toMatchObject({ variant: 'normal', direction: { x: 0, y: 0, z: 1 }, destroysResistantBlocks: false })
    expect(blue).toMatchObject({ variant: 'blue', direction: { x: 0, y: 0.6, z: 0.8 }, destroysResistantBlocks: true })
  })
})
