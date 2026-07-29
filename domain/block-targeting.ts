import { type IsTargetable, voxelRaycast } from '@nerima-games/mc-physics'
import { Option } from 'effect'
import { forwardVector } from './camera-pose'
import type { CameraPoseSnapshot, Position } from './kernel-vocabulary'
import { position } from './kernel-vocabulary'

export type BlockTarget = {
  readonly position: Position
  readonly adjacentPosition: Position
  readonly distance: number
}

/** Resolve the first targetable voxel along the simulation-owned camera pose. */
export const targetBlockFromCamera = (
  camera: CameraPoseSnapshot,
  maxDistance: number,
  isTargetable: IsTargetable,
): Option.Option<BlockTarget> =>
  Option.map(voxelRaycast(camera.position, forwardVector(camera), maxDistance, isTargetable), (hit) => ({
    position: position(hit.bx, hit.by, hit.bz),
    adjacentPosition: position(hit.bx + hit.normal.x, hit.by + hit.normal.y, hit.bz + hit.normal.z),
    distance: hit.distance,
  }))
