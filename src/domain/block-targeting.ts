import { BlockLength, type IsTargetable, voxelRaycast } from '@nerima-games/mc-physics'
import { Option, Result } from 'effect'
import { EYE_LEVEL_OFFSET, forwardVector, type CameraPoseError, type PlayerPose } from './camera-pose.js'
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

export type BlockTargetInputError = Readonly<{
  _tag: 'BlockTargetInputError'
  field: 'aim' | 'aim.position' | 'aim.position.x' | 'aim.position.y' | 'aim.position.z' | 'aim.yawRadians' | 'aim.pitchRadians' | 'playerPose' | 'playerPose.feetPosition' | 'isTargetable'
}>

type BlockAim = Pick<CameraPoseSnapshot, 'position' | 'yawRadians' | 'pitchRadians'>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isBlockAim = (value: unknown): value is BlockAim => {
  if (!isRecord(value)) return false
  const positionValue = value['position']
  return isRecord(positionValue) &&
    typeof positionValue['x'] === 'number' &&
    typeof positionValue['y'] === 'number' &&
    typeof positionValue['z'] === 'number' &&
    typeof value['yawRadians'] === 'number' &&
    typeof value['pitchRadians'] === 'number'
}

const targetBlockFromAim = (
  aim: BlockAim,
  maxDistance: number,
  isTargetable: IsTargetable,
): Result.Result<Option.Option<BlockTarget>, CameraPoseError | RangeError | BlockTargetInputError> =>
  !isBlockAim(aim)
    ? Result.fail({ _tag: 'BlockTargetInputError', field: 'aim' })
    : typeof isTargetable !== 'function'
      ? Result.fail({ _tag: 'BlockTargetInputError', field: 'isTargetable' })
      : Result.gen(function* () {
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
): Result.Result<Option.Option<BlockTarget>, CameraPoseError | RangeError | BlockTargetInputError> =>
  targetBlockFromAim(camera, maxDistance, isTargetable)

/** Resolve a block target from the authoritative player pose without requiring a clock snapshot. */
export const targetBlockFromPlayerPose = (
  playerPose: PlayerPose,
  maxDistance: number,
  isTargetable: IsTargetable,
): Result.Result<Option.Option<BlockTarget>, CameraPoseError | RangeError | BlockTargetInputError> =>
  !isRecord(playerPose)
    ? Result.fail({ _tag: 'BlockTargetInputError', field: 'playerPose' })
    : !isRecord(playerPose['feetPosition'])
      ? Result.fail({ _tag: 'BlockTargetInputError', field: 'playerPose.feetPosition' })
      : typeof isTargetable !== 'function'
        ? Result.fail({ _tag: 'BlockTargetInputError', field: 'isTargetable' })
      : Result.gen(function* () {
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
