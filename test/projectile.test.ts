import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import {
  ARROW_PROFILE,
  launchProjectile,
  raycastArrowBlock,
  stepProjectile,
  type Projectile,
  type ProjectileHit,
  type ProjectileLaunch,
  type ProjectileStep,
  type ProjectileWorld,
} from '../src'

const world: ProjectileWorld = {
  blockBounds: () => [],
  bounds: { maxX: 10, maxY: 10, maxZ: 10, minX: -10, minY: -10, minZ: -10 },
  entities: [],
  isInWater: () => false,
}

describe('projectile facade', () => {
  it('publishes arrow physics values and types from mc-sim', () => {
    const launch: ProjectileLaunch = {
      pitchRadians: 0,
      position: { x: 0, y: 0, z: 0 },
      speed: 3,
      yawRadians: 0,
    }
    const arrow: Projectile = launchProjectile(launch)
    const step: ProjectileStep = stepProjectile(arrow, 0.05, world, ARROW_PROFILE)
    const hit: ProjectileHit | undefined = step.hit

    expect(arrow.state).toBe('flying')
    expect(hit).toBeUndefined()
    expect(step.projectile.state).toBe('flying')
  })

  it('resolves the first blocking voxel on an arrow segment', () => {
    const impact = raycastArrowBlock(
      { x: 0.5, y: 0.5, z: 2.5 },
      { x: 0.5, y: 0.5, z: -0.5 },
      (x, y, z) => x === 0 && y === 0 && z === 0,
    )

    expect(Option.getOrThrow(impact)).toStrictEqual({ distance: 1.5, point: { x: 0.5, y: 0.5, z: 1 } })
  })
})
