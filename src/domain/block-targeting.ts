import { BlockLength, type IsTargetable, voxelRaycast } from '@nerima-games/mc-physics'
import { Brand, Option, Result } from 'effect'
import { EYE_LEVEL_OFFSET, forwardVector, type PlayerPose } from './camera-pose.js'
import {
  AngleRadians,
  PositionAxis,
  position,
  type CameraPoseSnapshot,
  type Position,
} from '@nerima-games/mc-kernel'

export type BlockTarget = {
  readonly position: Position
  readonly adjacentPosition: Position
  readonly distance: number
}

type BlockAim = Pick<CameraPoseSnapshot, 'position' | 'yawRadians' | 'pitchRadians'>

const targetBlockFromAim = (
  aim: BlockAim,
  maxDistance: number,
  isTargetable: IsTargetable,
): Result.Result<Option.Option<BlockTarget>, Brand.BrandError | RangeError> =>
  Result.gen(function* () {
    const distance = yield* BlockLength.result(maxDistance)
    const originX = yield* PositionAxis.result(aim.position.x)
    const originY = yield* PositionAxis.result(aim.position.y)
    const originZ = yield* PositionAxis.result(aim.position.z)
    const yawRadians = yield* AngleRadians.result(aim.yawRadians)
    const pitchRadians = yield* AngleRadians.result(aim.pitchRadians)
    const validAim: BlockAim = {
      position: position(originX, originY, originZ),
      yawRadians,
      pitchRadians,
    }
    const direction = yield* forwardVector(validAim)
    const hit = yield* voxelRaycast(validAim.position, direction, distance, isTargetable)
    if (Option.isNone(hit)) return Option.none()

    const positionX = yield* PositionAxis.result(hit.value.bx)
    const positionY = yield* PositionAxis.result(hit.value.by)
    const positionZ = yield* PositionAxis.result(hit.value.bz)
    const adjacentX = yield* PositionAxis.result(hit.value.bx + hit.value.normal.x)
    const adjacentY = yield* PositionAxis.result(hit.value.by + hit.value.normal.y)
    const adjacentZ = yield* PositionAxis.result(hit.value.bz + hit.value.normal.z)

    return Option.some({
      position: position(positionX, positionY, positionZ),
      adjacentPosition: position(adjacentX, adjacentY, adjacentZ),
      distance: hit.value.distance,
    })
  })

/** Resolve the first targetable voxel along the simulation-owned camera pose. */
export const targetBlockFromCamera = (
  camera: CameraPoseSnapshot,
  maxDistance: number,
  isTargetable: IsTargetable,
): Result.Result<Option.Option<BlockTarget>, Brand.BrandError | RangeError> =>
  targetBlockFromAim(camera, maxDistance, isTargetable)

/** Resolve a block target from the authoritative player pose without requiring a clock snapshot. */
export const targetBlockFromPlayerPose = (
  playerPose: PlayerPose,
  maxDistance: number,
  isTargetable: IsTargetable,
): Result.Result<Option.Option<BlockTarget>, Brand.BrandError | RangeError> =>
  Result.gen(function* () {
    const feetX = yield* PositionAxis.result(playerPose.feetPosition.x)
    const feetY = yield* PositionAxis.result(playerPose.feetPosition.y)
    const feetZ = yield* PositionAxis.result(playerPose.feetPosition.z)
    const eyeY = yield* PositionAxis.result(feetY + EYE_LEVEL_OFFSET)
    const yawRadians = yield* AngleRadians.result(playerPose.yawRadians)
    const pitchRadians = yield* AngleRadians.result(playerPose.pitchRadians)

    return yield* targetBlockFromAim(
      {
        position: position(feetX, eyeY, feetZ),
        yawRadians,
        pitchRadians,
      },
      maxDistance,
      isTargetable,
    )
  })
