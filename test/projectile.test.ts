import { describe, expect, it } from '@effect/vitest'
import { Option, Result } from 'effect'
import { AngleRadians, DeltaTimeSecs, PositionAxis, position } from '@nerima-games/mc-kernel'
import { BlocksPerSecond } from '@nerima-games/mc-physics'
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
  bounds: {
    maxX: PositionAxis(10), maxY: PositionAxis(10), maxZ: PositionAxis(10),
    minX: PositionAxis(-10), minY: PositionAxis(-10), minZ: PositionAxis(-10),
  },
  entities: [],
  isInWater: () => false,
}

describe('projectile facade', () => {
  it('publishes arrow physics values and types from mc-sim', () => {
    const launch: ProjectileLaunch = {
      pitchRadians: AngleRadians(0),
      position: position(PositionAxis(0), PositionAxis(0), PositionAxis(0)),
      speed: BlocksPerSecond(3),
      yawRadians: AngleRadians(0),
    }
    const arrow: Projectile = launchProjectile(launch)
    const step: ProjectileStep = stepProjectile(arrow, DeltaTimeSecs(0.05), world, ARROW_PROFILE)
    const hit: ProjectileHit | undefined = step.hit

    expect(arrow.state).toBe('flying')
    expect(hit).toBeUndefined()
    expect(step.projectile.state).toBe('flying')
  })

  it('resolves the first blocking voxel on an arrow segment', () => {
    const impact = raycastArrowBlock(
      position(PositionAxis(0.5), PositionAxis(0.5), PositionAxis(2.5)),
      position(PositionAxis(0.5), PositionAxis(0.5), PositionAxis(-0.5)),
      (x, y, z) => x === 0 && y === 0 && z === 0,
    )

    expect(Option.getOrThrow(Result.getOrThrow(impact))).toStrictEqual({ distance: 1.5, point: { x: 0.5, y: 0.5, z: 1 } })
  })
})
