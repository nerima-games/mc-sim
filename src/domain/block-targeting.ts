import { type IsTargetable, voxelRaycast } from '@nerima-games/mc-physics'
import { Option } from 'effect'
import { EYE_LEVEL_OFFSET, forwardVector, type PlayerPose } from './camera-pose'
import type { CameraPoseSnapshot, Position } from './kernel-vocabulary'
import { position } from './kernel-vocabulary'

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
): Option.Option<BlockTarget> =>
  Option.map(voxelRaycast(aim.position, forwardVector(aim), maxDistance, isTargetable), (hit) => ({
    position: position(hit.bx, hit.by, hit.bz),
    adjacentPosition: position(hit.bx + hit.normal.x, hit.by + hit.normal.y, hit.bz + hit.normal.z),
    distance: hit.distance,
  }))

/** Resolve the first targetable voxel along the simulation-owned camera pose. */
export const targetBlockFromCamera = (
  camera: CameraPoseSnapshot,
  maxDistance: number,
  isTargetable: IsTargetable,
): Option.Option<BlockTarget> =>
  targetBlockFromAim(camera, maxDistance, isTargetable)

/** Resolve a block target from the authoritative player pose without requiring a clock snapshot. */
export const targetBlockFromPlayerPose = (
  playerPose: PlayerPose,
  maxDistance: number,
  isTargetable: IsTargetable,
): Option.Option<BlockTarget> =>
  targetBlockFromAim(
    {
      position: position(
        playerPose.feetPosition.x,
        playerPose.feetPosition.y + EYE_LEVEL_OFFSET,
        playerPose.feetPosition.z,
      ),
      yawRadians: playerPose.yawRadians,
      pitchRadians: playerPose.pitchRadians,
    },
    maxDistance,
    isTargetable,
  )
