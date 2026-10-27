import { describe, expect, it } from 'vitest'
import { Result } from 'effect'
import { PositionAxis, position as coordinatePosition } from '@nerima-games/mc-kernel'
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

const position = (x: number, y: number, z: number) =>
  coordinatePosition(PositionAxis(x), PositionAxis(y), PositionAxis(z))
const step = (...args: Parameters<typeof stepWither>) => Result.getOrThrow(stepWither(...args))

describe('wither summon', () => {
  it.each(['soul_sand', 'soul_soil'] as const)('matches a complete T made from %s', (material) => {
    const blocks = new Map<string, string>()
    const put = (x: number, y: number, z: number, block: string) => blocks.set(`${x},${y},${z}`, block)
    put(0, 0, 0, material)
    for (const x of [-1, 0, 1]) {
      put(x, 1, 0, material)
      put(x, 2, 0, 'wither_skeleton_skull')
    }

    const result = matchWitherSummon(
      { x: 0, y: 0, z: 0 },
      ({ x, y, z }) => blocks.get(`${x},${y},${z}`),
    )

    expect(Result.getOrThrow(result)).toEqual({
      axis: 'x',
      spawnPosition: { x: 0.5, y: 1, z: 0.5 },
      consumedBlocks: [
        { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 },
        { x: -1, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 1, y: 2, z: 0 },
      ],
    })
  })

  it('rejects an incomplete skull row', () => {
    const result = matchWitherSummon(
      { x: 0, y: 0, z: 0 },
      ({ y }) => y < 2 ? 'soul_sand' : 'air',
    )

    expect(Result.getOrThrow(result)).toBeUndefined()
  })

  it('returns BrandError for a non-finite base before querying blocks', () => {
    let blockLookupCalled = false
    const result = matchWitherSummon({ x: Number.NaN, y: 0, z: 0 }, () => {
      blockLookupCalled = true
      return undefined
    })

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) expect(result.failure._tag).toBe('BrandError')
    expect(blockLookupCalled).toBe(false)
  })
})
describe('wither lifecycle', () => {
  it('charges invulnerably, then emits its spawn blast exactly once', () => {
    const spawned = createWither(position(0, 10, 0))
    expect(damageWither(spawned, 100, 'melee')).toMatchObject({ state: spawned, ignored: true })

    const charging = step(spawned, 9)
    const activated = step(charging.state, 1)
    const later = step(activated.state, 1)
    expect(charging.state.phase).toBe('charging')
    expect(activated).toMatchObject({ state: { phase: 'airborne' }, spawnExplosion: { power: 7 } })
    expect(later.spawnExplosion).toBeUndefined()
  })

  it('tracks a target in three dimensions, caps speed, and regenerates', () => {
    const active = step(createWither(position(0, 0, 0)), 10).state
    const hurt = damageWither(active, 10, 'melee').state
    const moved = step(hurt, 1, position(100, 100, 0)).state
    expect(moved.healthPoints).toBe(291)
    expect(Math.hypot(moved.velocity.x, moved.velocity.y, moved.velocity.z)).toBeCloseTo(5)
    expect(moved.feetPosition.y).toBeGreaterThan(0)

    expect(step(active, 0, position(100, 100, 0)).state).toEqual(active)
    expect(step(active, 1, active.feetPosition).state.velocity).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('preserves velocity below the speed cap when acceleration stays within it', () => {
    const active = step(createWither(position(0, 0, 0)), 10).state
    const state = { ...active, velocity: position(1, 0, 0) }

    expect(step(state, 1, state.feetPosition).state.velocity).toEqual(position(1, 0, 0))
  })

  it('enters permanent armour at half health and ignores ranged damage', () => {
    const active = step(createWither(position(0, 0, 0)), 10).state
    const armoured = damageWither(active, WITHER_ARMOUR_THRESHOLD, 'melee').state
    expect(armoured.phase).toBe('armoured')
    expect(damageWither(armoured, 20, 'ranged')).toMatchObject({ state: armoured, ignored: true, appliedDamage: 0 })
    expect(damageWither(armoured, 20, 'melee').state.healthPoints).toBe(130)
    expect(step(armoured, 200).state.phase).toBe('armoured')
  })

  it('dies once with a nether star drop and a despawn descriptor', () => {
    const active = step(createWither(position(2, 3, 4)), 10).state
    const killed = damageWither(active, 500, 'void')
    expect(killed.death).toEqual({
      despawn: { kind: 'wither', reason: 'killed' },
      drop: { item: 'nether_star', count: 1, position: { x: 2, y: 3, z: 4 } },
    })
    expect(damageWither(killed.state, 1, 'melee').death).toBeUndefined()
    expect(step(killed.state, 1)).toStrictEqual({
      state: killed.state,
      spawnExplosion: undefined,
    })
  })

  it('round-trips a versioned snapshot and repairs invalid restored magnitudes', () => {
    const state = damageWither(step(createWither(position(1, 2, 3)), 10).state, 160, 'melee').state
    expect(restoreWither(serializeWither(state))).toEqual(state)
    const invalidFeetPosition = JSON.parse('{"x":0,"y":2,"z":3}')
    invalidFeetPosition.x = Number.NaN
    expect(restoreWither({
      kind: 'wither', version: 1,
      state: { ...state, healthPoints: Number.NaN, feetPosition: invalidFeetPosition },
    })).toMatchObject({ phase: 'dead', healthPoints: 0, feetPosition: { x: 0, y: 2, z: 3 } })

    const airborne = step(createWither(position(1, 2, 3)), 10).state
    expect(restoreWither({ ...serializeWither(airborne), state: { ...airborne, phase: 'airborne' } })).toEqual(airborne)
    expect(restoreWither({
      ...serializeWither(airborne),
      state: { ...airborne, phase: 'charging', chargeRemainingSecs: 2 },
    })).toMatchObject({ phase: 'charging', chargeRemainingSecs: 2 })
    expect(restoreWither({
      ...serializeWither(airborne),
      state: { ...airborne, phase: 'charging', chargeRemainingSecs: 0 },
    })).toMatchObject({ phase: 'airborne', chargeRemainingSecs: 0 })
  })

  it('steps toward an opposite extreme without overflowing the direction subtraction', () => {
    const extreme = position(Number.MAX_VALUE, 0, 0)
    const spawned = createWither(extreme)
    const charged = step(spawned, 10).state

    const result = stepWither(charged, 1, position(-Number.MAX_VALUE, 0, 0))

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success.state.velocity).toEqual(position(-5, 0, 0))
      expect(Number.isFinite(result.success.state.feetPosition.x)).toBe(true)
    }
  })

  it('clamps velocity before integrating a very large finite timestep', () => {
    const airborne = step(createWither(position(0, 0, 0)), 10).state
    const delta = 3.1e307

    const result = stepWither(airborne, delta, position(1, 0, 0))

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.success.state.velocity).toEqual(position(5, 0, 0))
      expect(result.success.state.feetPosition).toEqual(position(1.55e308, 0, 0))
    }
  })

  it('returns a BrandError when the next position is not finite', () => {
    const feetPosition = position(Number.MAX_VALUE, 0, 0)
    const state = {
      ...createWither(feetPosition),
      phase: 'airborne' as const,
      chargeRemainingSecs: 0,
      velocity: position(Number.MAX_VALUE, 0, 0),
    }

    const result = stepWither(state, Number.MAX_VALUE, feetPosition)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) expect(result.failure._tag).toBe('BrandError')
  })
})

describe('wither skull descriptors', () => {
  it('distinguishes ordinary and blue skull block behaviour', () => {
    const normal = witherSkullProjectile(position(0, 0, 0), position(0, 0, 4), 'normal')
    const blue = witherSkullProjectile(position(0, 0, 0), position(0, 3, 4), 'blue')
    expect(normal).toMatchObject({ variant: 'normal', direction: { x: 0, y: 0, z: 1 }, destroysResistantBlocks: false })
    expect(blue).toMatchObject({ variant: 'blue', direction: { x: 0, y: 0.6, z: 0.8 }, destroysResistantBlocks: true })
  })
})
