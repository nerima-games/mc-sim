import { describe, expect, it } from '@effect/vitest'
import { Option, Result } from 'effect'
import { targetBlockFromCamera, targetBlockFromPlayerPose } from '../src/domain/block-targeting'
import { cameraPoseOf as cameraPoseOfResult, INITIAL_PLAYER_POSE, withFeetPosition } from '../src/domain/camera-pose'
import { MonotonicTimeSecs, PositionAxis, position as kernelPosition } from '@nerima-games/mc-kernel'

const position = (x: number, y: number, z: number) =>
  kernelPosition(PositionAxis(x), PositionAxis(y), PositionAxis(z))

const cameraAt = (x: number, y: number, z: number) =>
  Result.getOrThrow(cameraPoseOfResult(withFeetPosition(INITIAL_PLAYER_POSE, position(x, y, z)), MonotonicTimeSecs(0)))

describe('targetBlockFromCamera', () => {
  it('returns the aimed block and the empty cell on the entered face', () => {
    const target = Result.getOrThrow(
      targetBlockFromCamera(cameraAt(0.5, 0, 2.5), 5, (x, y, z) => x === 0 && y === 1 && z === 0),
    )

    expect(Option.getOrThrow(target)).toStrictEqual({
      position: position(0, 1, 0),
      adjacentPosition: position(0, 1, 1),
      distance: 1.5,
    })
  })

  it('does not target the cell containing the camera', () => {
    const target = Result.getOrThrow(
      targetBlockFromCamera(cameraAt(0.5, 0, 0.5), 5, (x, y, z) => x === 0 && y === 1 && z === 0),
    )

    expect(Option.isNone(target)).toBe(true)
  })

  it('returns none when the first targetable block is beyond reach', () => {
    const target = Result.getOrThrow(
      targetBlockFromCamera(cameraAt(0.5, 0, 3.5), 2, (x, y, z) => x === 0 && y === 1 && z === 0),
    )

    expect(Option.isNone(target)).toBe(true)
  })

  it('propagates an invalid reach distance', () => {
    const target = targetBlockFromCamera(cameraAt(0.5, 0, 2.5), Number.NaN, () => true)

    expect(Result.isFailure(target)).toBe(true)
  })

  it('returns BrandError for a runtime NaN camera yaw before raycasting', () => {
    const malformedCamera = Object.assign(cameraAt(0.5, 0, 2.5), { yawRadians: Number.NaN })
    let raycastCalled = false
    const target = targetBlockFromCamera(malformedCamera, 5, () => {
      raycastCalled = true
      return true
    })

    expect(Result.isFailure(target)).toBe(true)
    if (Result.isFailure(target)) expect(target.failure).toHaveProperty('_tag', 'BrandError')
    expect(raycastCalled).toBe(false)
  })

  it('returns typed input failures for malformed aims and callbacks', () => {
    const malformedAim = targetBlockFromCamera(null as never, 5, () => true)
    const malformedCallback = targetBlockFromCamera(cameraAt(0.5, 0, 2.5), 5, null as never)

    expect(malformedAim).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'BlockTargetInputError', field: 'aim' },
    })
    expect(malformedCallback).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'BlockTargetInputError', field: 'isTargetable' },
    })
  })
})

describe('targetBlockFromPlayerPose', () => {
  it('applies the simulation-owned eye height before raycasting', () => {
    const playerPose = withFeetPosition(INITIAL_PLAYER_POSE, position(0.5, 0, 2.5))
    const target = Result.getOrThrow(
      targetBlockFromPlayerPose(playerPose, 5, (x, y, z) => x === 0 && y === 1 && z === 0),
    )

    expect(Option.getOrThrow(target).position).toStrictEqual(position(0, 1, 0))
  })

  it('returns BrandError for a runtime non-finite player x coordinate', () => {
    const malformedPosition = Object.assign(position(0.5, 0, 2.5), { x: Number.NaN })
    const playerPose = withFeetPosition(INITIAL_PLAYER_POSE, malformedPosition)
    const target = targetBlockFromPlayerPose(playerPose, 5, () => true)

    expect(Result.isFailure(target)).toBe(true)
    if (Result.isFailure(target)) expect(target.failure).toHaveProperty('_tag', 'BrandError')
  })

  it('returns BrandError for a runtime non-finite player z coordinate', () => {
    const malformedPosition = Object.assign(position(0.5, 0, 2.5), { z: Number.POSITIVE_INFINITY })
    const playerPose = withFeetPosition(INITIAL_PLAYER_POSE, malformedPosition)
    const target = targetBlockFromPlayerPose(playerPose, 5, () => true)

    expect(Result.isFailure(target)).toBe(true)
    if (Result.isFailure(target)) expect(target.failure).toHaveProperty('_tag', 'BrandError')
  })

  it('returns a typed input failure for a non-record player pose', () => {
    expect(targetBlockFromPlayerPose(null as never, 5, () => true)).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'BlockTargetInputError', field: 'playerPose' },
    })
  })

  it('returns typed input failures for a malformed feet position and callback', () => {
    expect(targetBlockFromPlayerPose({
      ...INITIAL_PLAYER_POSE,
      feetPosition: null,
    } as never, 5, () => true)).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'BlockTargetInputError', field: 'playerPose.feetPosition' },
    })
    expect(targetBlockFromPlayerPose(INITIAL_PLAYER_POSE, 5, null as never)).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'BlockTargetInputError', field: 'isTargetable' },
    })
  })
})
