import { describe, expect, it } from '@effect/vitest'
import { Option } from 'effect'
import { targetBlockFromCamera, targetBlockFromPlayerPose } from '../src/domain/block-targeting'
import { cameraPoseOf, INITIAL_PLAYER_POSE, withFeetPosition } from '../src/domain/camera-pose'
import { MonotonicTimeSecs, position } from '../src/domain/kernel-vocabulary'

const cameraAt = (x: number, y: number, z: number) =>
  cameraPoseOf(withFeetPosition(INITIAL_PLAYER_POSE, position(x, y, z)), MonotonicTimeSecs(0))

describe('targetBlockFromCamera', () => {
  it('returns the aimed block and the empty cell on the entered face', () => {
    const target = targetBlockFromCamera(cameraAt(0.5, 0, 2.5), 5, (x, y, z) => x === 0 && y === 1 && z === 0)

    expect(Option.getOrThrow(target)).toStrictEqual({
      position: position(0, 1, 0),
      adjacentPosition: position(0, 1, 1),
      distance: 1.5,
    })
  })

  it('does not target the cell containing the camera', () => {
    const target = targetBlockFromCamera(cameraAt(0.5, 0, 0.5), 5, (x, y, z) => x === 0 && y === 1 && z === 0)

    expect(Option.isNone(target)).toBe(true)
  })

  it('returns none when the first targetable block is beyond reach', () => {
    const target = targetBlockFromCamera(cameraAt(0.5, 0, 3.5), 2, (x, y, z) => x === 0 && y === 1 && z === 0)

    expect(Option.isNone(target)).toBe(true)
  })
})

describe('targetBlockFromPlayerPose', () => {
  it('applies the simulation-owned eye height before raycasting', () => {
    const playerPose = withFeetPosition(INITIAL_PLAYER_POSE, position(0.5, 0, 2.5))
    const target = targetBlockFromPlayerPose(playerPose, 5, (x, y, z) => x === 0 && y === 1 && z === 0)

    expect(Option.getOrThrow(target).position).toStrictEqual(position(0, 1, 0))
  })
})
