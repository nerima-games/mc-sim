import { BlockLength, voxelRaycast } from '@nerima-games/mc-physics'
import { Brand, Option, Result } from 'effect'
import { PositionAxis, position, type Position } from '@nerima-games/mc-kernel'

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

const MAX_ARROW_RAYCAST_DISTANCE = 64

/** Resolve the first blocking voxel on an arrow segment without exposing DDA details. */
export const raycastArrowBlock = (
  from: Position,
  to: Position,
  isBlocking: IsArrowBlocker,
): Result.Result<Option.Option<ArrowBlockImpact>, Brand.BrandError | RangeError> => {
  const travelX = to.x - from.x
  const travelY = to.y - from.y
  const travelZ = to.z - from.z
  const maxDistance = Math.hypot(travelX, travelY, travelZ)
  // DDA traversal scales with segment length, so reject distant endpoints first.
  if (maxDistance > MAX_ARROW_RAYCAST_DISTANCE) {
    return Result.fail(new RangeError(`Arrow raycast distance exceeds ${MAX_ARROW_RAYCAST_DISTANCE} blocks`))
  }
  const travel = Result.all([
    PositionAxis.result(travelX),
    PositionAxis.result(travelY),
    PositionAxis.result(travelZ),
    BlockLength.result(maxDistance),
  ])

  return Result.flatMap(travel, ([x, y, z, distance]) =>
    Result.map(voxelRaycast(from, position(x, y, z), distance, isBlocking), (hit) =>
      Option.map(hit, (value) => ({
        distance: value.distance,
        point: value.point,
      })),
    ),
  )
}
