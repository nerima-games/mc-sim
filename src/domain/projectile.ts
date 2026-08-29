import { voxelRaycast } from '@nerima-games/mc-physics'
import { Option } from 'effect'
import type { Position } from '@nerima-games/mc-kernel'

/** Projectile physics exposed through the simulation package's public API. */
export {
  ARROW_PROFILE,
  EGG_PROFILE,
  launchProjectile,
  SNOWBALL_PROFILE,
  stepProjectile,
  TRIDENT_PROFILE,
} from '@nerima-games/mc-physics'
export type {
  Projectile,
  ProjectileEntity,
  ProjectileHit,
  ProjectileLaunch,
  ProjectileProfile,
  ProjectileStep,
  ProjectileWorld,
} from '@nerima-games/mc-physics'

export type ArrowBlockImpact = {
  readonly distance: number
  readonly point: Position
}

export type IsArrowBlocker = (x: number, y: number, z: number) => boolean

/** Resolve the first blocking voxel on an arrow segment without exposing DDA details. */
export const raycastArrowBlock = (
  from: Position,
  to: Position,
  isBlocking: IsArrowBlocker,
): Option.Option<ArrowBlockImpact> => {
  const travel = {
    x: to.x - from.x,
    y: to.y - from.y,
    z: to.z - from.z,
  }
  const maxDistance = Math.hypot(travel.x, travel.y, travel.z)

  return Option.map(voxelRaycast(from, travel, maxDistance, isBlocking), (hit) => ({
    distance: hit.distance,
    point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
  }))
}
