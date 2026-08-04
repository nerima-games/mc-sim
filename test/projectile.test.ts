import { describe, expect, it } from '@effect/vitest'
import {
  launchArrow,
  stepArrow,
  type Arrow,
  type ArrowLaunch,
  type ProjectileHit,
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
    const launch: ArrowLaunch = {
      pitchRadians: 0,
      position: { x: 0, y: 0, z: 0 },
      speed: 3,
      yawRadians: 0,
    }
    const arrow: Arrow = launchArrow(launch)
    const step: ProjectileStep = stepArrow(arrow, world, 0.05)
    const hit: ProjectileHit | undefined = step.hit

    expect(arrow.state).toBe('flying')
    expect(hit).toBeUndefined()
    expect(step.arrow.state).toBe('flying')
  })
})
