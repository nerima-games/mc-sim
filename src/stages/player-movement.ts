import { Brand, Result } from 'effect'
import {
  BlocksPerSecondSquared,
  DEFAULT_MOVEMENT_CONFIG,
  entityAABB,
  sampleBlockHazards,
  type Body,
  type BlocksPerSecond,
  type MovementConfig,
  type MovementContext,
  type ResolveError,
  type ResolveOptions,
} from '@nerima-games/mc-physics'
import { BlockAxis, BlockId, PositionAxis } from '@nerima-games/mc-kernel'

/**
 * The steady-state walking speed `DEFAULT_MOVEMENT_CONFIG` produces on ordinary
 * ground. mc-physics keeps it as an unexported `WALK_SPEED`, so the coupling is
 * pinned by a test rather than imported.
 */
export const VANILLA_WALK_SPEED = 4.317

/**
 * How far below the feet the supporting block is sampled. Smaller than any
 * block-height step, so a body resting on a short block (soul sand is 0.875 tall)
 * still reads that block rather than the one beneath it.
 */
const SURFACE_PROBE_DEPTH = 0.001

/**
 * `walkSpeed` keeps its meaning as the steady speed on ordinary ground, so the
 * ground acceleration is scaled by the ratio to mc-physics's own default.
 * Air acceleration is not scaled: it does not depend on the walking speed.
 */
export const movementConfigFor = (
  walkSpeed: BlocksPerSecond,
  jumpSpeed: BlocksPerSecond,
): Result.Result<MovementConfig, Brand.BrandError | RangeError> =>
  Result.map(
    BlocksPerSecondSquared.result(
      Number(DEFAULT_MOVEMENT_CONFIG.groundAcceleration) * (Number(walkSpeed) / VANILLA_WALK_SPEED),
    ),
    (groundAcceleration): MovementConfig => ({
      ...DEFAULT_MOVEMENT_CONFIG,
      groundAcceleration,
      jumpVelocity: jumpSpeed,
    }),
  )

/** Integer cells a span overlaps; a face that only touches a cell does not count. */
const cellsOverlapping = (min: number, max: number): ReadonlyArray<number> => {
  const first = Math.floor(min)
  return Array.from({ length: Math.max(0, Math.ceil(max) - first) }, (_, offset) => first + offset)
}

/**
 * What mc-physics needs to know about the world around a body: the block it
 * stands on, the blocks it overlaps, and whether any of them is climbable.
 *
 * Block identity comes from `blockIdAt` (on the resolve options or on the
 * environment). Without it the surface and overlap blocks are unknown, so
 * ice, soul sand and ladders by identity do not apply, while `climbable` still
 * follows block capabilities. `inFluid` is always false: this stage has no fluid
 * state to ask.
 */
export const movementContextAt = (
  options: ResolveOptions,
  body: Body,
  isGrounded: boolean,
): Result.Result<MovementContext, ResolveError> => {
  const halfHeight = Number(options.halfHeight)
  const centreY = body.y
  const box = entityAABB(
    PositionAxis(Number(body.x)),
    centreY,
    PositionAxis(Number(body.z)),
    options.halfWidth,
    options.halfHeight,
  )
  return Result.flatMap(box, (aabb) =>
    Result.flatMap(sampleBlockHazards(aabb, options.environment), (hazards) => {
      const blockIdAt = options.blockIdAt ?? options.environment.blockIdAt
      if (blockIdAt === undefined) {
        return Result.succeed<MovementContext>({
          isGrounded,
          inFluid: false,
          climbable: hazards.climbable,
          surfaceBlockId: null,
          movementBlockIds: [],
        })
      }
      // `null` means the cell is not loaded, which is the same as no block here.
      const idAt = (bx: number, by: number, bz: number) =>
        Result.flatMap(
          Result.all([BlockAxis.result(bx), BlockAxis.result(by), BlockAxis.result(bz)]),
          ([ax, ay, az]) => {
            const id = blockIdAt(ax, ay, az)
            return id === null ? Result.succeed(null) : BlockId.result(id)
          },
        )
      const overlappingCells = cellsOverlapping(Number(aabb.minX), Number(aabb.maxX)).flatMap((bx) =>
        cellsOverlapping(Number(aabb.minY), Number(aabb.maxY)).flatMap((by) =>
          cellsOverlapping(Number(aabb.minZ), Number(aabb.maxZ)).map((bz) => idAt(bx, by, bz)),
        ),
      )

      return Result.map(
        Result.all([
          idAt(
            Math.floor(Number(body.x)),
            Math.floor(Number(centreY) - halfHeight - SURFACE_PROBE_DEPTH),
            Math.floor(Number(body.z)),
          ),
          Result.all(overlappingCells),
        ]),
        ([surfaceBlockId, overlappingIds]): MovementContext => ({
          isGrounded,
          inFluid: false,
          climbable: hazards.climbable,
          surfaceBlockId,
          movementBlockIds: overlappingIds.flatMap((id) => (id === null ? [] : [id])),
        }),
      )
    }),
  )
}
