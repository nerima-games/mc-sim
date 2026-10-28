/**
 * REGRESSION: mc-sim owns the camera pose; nothing reads it back from a
 * renderer.
 *
 * plan.md §3.8 / §5.1-2. In the reference the THREE camera was the authority
 * and thirteen simulation-side call sites read `camera.position` /
 * `camera.getWorldDirection(...)` out of it — see the citations in
 * domain/camera-pose.ts. The structural fix is the dependency direction
 * (mc-render -> mc-sim, never the reverse), which the dependency policy enforces.
 * These tests pin the behavioural half: everything a consumer could want from a
 * camera is computable HERE, in Node, with no renderer in the process.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import {
  applyLook,
  cameraPoseOf as cameraPoseOfResult,
  clampPitch,
  EYE_LEVEL_OFFSET,
  forwardVector as forwardVectorResult,
  INITIAL_PLAYER_POSE,
  PITCH_EPSILON,
  PITCH_MAX_RADIANS,
  PITCH_MIN_RADIANS,
  snapshotAgeSecs,
  withFeetPosition,
} from '../src/domain/camera-pose'
import { MonotonicTimeSecs, PositionAxis, position as coordinatePosition } from '@nerima-games/mc-kernel'

const AT = MonotonicTimeSecs(500)
const position = (x: number, y: number, z: number) =>
  coordinatePosition(PositionAxis(x), PositionAxis(y), PositionAxis(z))
const success = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw new Error('expected a valid camera pose result')
  return result.success
}
const cameraPoseOf = (pose: Parameters<typeof cameraPoseOfResult>[0], capturedAtSecs: Parameters<typeof cameraPoseOfResult>[1]) =>
  success(cameraPoseOfResult(pose, capturedAtSecs))
const forwardVector = (orientation: Parameters<typeof forwardVectorResult>[0]) =>
  success(forwardVectorResult(orientation))

describe('pitch clamping', () => {
  it.effect('stops just short of vertical, so yaw never becomes unrecoverable', () =>
    Effect.sync(() => {
      // At exactly +-pi/2 the forward vector is parallel to up and the heading
      // is lost — the player sees the view snap to an arbitrary direction.
      expect(PITCH_MAX_RADIANS).toBeCloseTo(Math.PI / 2 - PITCH_EPSILON, 12)
      expect(PITCH_MIN_RADIANS).toBe(-PITCH_MAX_RADIANS)
      expect(PITCH_MAX_RADIANS).toBeLessThan(Math.PI / 2)
    }),
  )

  it.effect('clamps both directions and leaves in-range pitches alone', () =>
    Effect.sync(() => {
      expect(success(clampPitch(Math.PI))).toBe(PITCH_MAX_RADIANS)
      expect(success(clampPitch(-Math.PI))).toBe(PITCH_MIN_RADIANS)
      expect(success(clampPitch(Math.PI / 2))).toBe(PITCH_MAX_RADIANS)
      expect(success(clampPitch(0.3))).toBe(0.3)
    }),
  )

  it.effect('returns typed failures for non-finite angle inputs', () =>
    Effect.sync(() => {
      expect(Result.isFailure(clampPitch(Number.NaN))).toBe(true)
      expect(Result.isFailure(applyLook(INITIAL_PLAYER_POSE, Number.NaN, 0))).toBe(true)
    }),
  )

  it.effect('returns typed failures for malformed pose fields and delta types', () =>
    Effect.sync(() => {
      const malformedPoses: ReadonlyArray<readonly [unknown, string]> = [
        [null, 'pose'],
        [{ ...INITIAL_PLAYER_POSE, feetPosition: null }, 'pose.feetPosition'],
        [{ ...INITIAL_PLAYER_POSE, feetPosition: { x: '0', y: 0, z: 0 } }, 'pose.feetPosition.x'],
        [{ ...INITIAL_PLAYER_POSE, feetPosition: { x: 0, y: '0', z: 0 } }, 'pose.feetPosition.y'],
        [{ ...INITIAL_PLAYER_POSE, feetPosition: { x: 0, y: 0, z: '0' } }, 'pose.feetPosition.z'],
        [{ ...INITIAL_PLAYER_POSE, yawRadians: '0' }, 'pose.yawRadians'],
        [{ ...INITIAL_PLAYER_POSE, pitchRadians: '0' }, 'pose.pitchRadians'],
      ]
      for (const [pose, field] of malformedPoses) {
        const result = applyLook(pose as never, 0, 0)
        expect(result).toMatchObject({
          _tag: 'Failure',
          failure: { _tag: 'CameraPoseInputError', field },
        })
      }
      expect(applyLook(INITIAL_PLAYER_POSE, null as never, 0)).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'CameraPoseInputError', field: 'deltaYaw' },
      })
      expect(applyLook(INITIAL_PLAYER_POSE, 0, null as never)).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'CameraPoseInputError', field: 'deltaPitch' },
      })
    }),
  )

  it.effect('repeatedly looking up saturates rather than wrapping the view upside down', () =>
    Effect.sync(() => {
      const looked = [1, 2, 3, 4, 5].reduce((pose) => success(applyLook(pose, 0, 1)), INITIAL_PLAYER_POSE)

      expect(looked.pitchRadians).toBe(PITCH_MAX_RADIANS)
    }),
  )

  it.effect('yaw is NOT wrapped, so turn deltas stay measurable across the seam', () =>
    Effect.sync(() => {
      const spun = [1, 2, 3].reduce((pose) => success(applyLook(pose, Math.PI, 0)), INITIAL_PLAYER_POSE)

      expect(spun.yawRadians).toBeCloseTo(3 * Math.PI, 12)
      expect(spun.yawRadians).toBeGreaterThan(2 * Math.PI)
    }),
  )
})

describe('CameraPoseSnapshot production', () => {
  it.effect('returns typed failures for malformed pose field and capture-time types', () =>
    Effect.sync(() => {
      const malformedPoses: ReadonlyArray<readonly [unknown, string]> = [
        [null, 'pose'],
        [{ ...INITIAL_PLAYER_POSE, feetPosition: null }, 'pose.feetPosition'],
        [{ ...INITIAL_PLAYER_POSE, feetPosition: { x: '0', y: 0, z: 0 } }, 'pose.feetPosition.x'],
        [{ ...INITIAL_PLAYER_POSE, feetPosition: { x: 0, y: '0', z: 0 } }, 'pose.feetPosition.y'],
        [{ ...INITIAL_PLAYER_POSE, feetPosition: { x: 0, y: 0, z: '0' } }, 'pose.feetPosition.z'],
        [{ ...INITIAL_PLAYER_POSE, yawRadians: '0' }, 'pose.yawRadians'],
        [{ ...INITIAL_PLAYER_POSE, pitchRadians: '0' }, 'pose.pitchRadians'],
      ]
      for (const [pose, field] of malformedPoses) {
        expect(cameraPoseOfResult(pose as never, AT)).toMatchObject({
          _tag: 'Failure',
          failure: { _tag: 'CameraPoseInputError', field },
        })
      }
      expect(cameraPoseOfResult(INITIAL_PLAYER_POSE, null as never)).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'CameraPoseInputError', field: 'capturedAtSecs' },
      })
    }),
  )

  it.effect('returns a typed failure for invalid runtime pose values', () =>
    Effect.sync(() => {
      const invalid = cameraPoseOfResult({ ...INITIAL_PLAYER_POSE, yawRadians: Number.NaN }, AT)

      expect(Result.isFailure(invalid)).toBe(true)
    }),
  )

  it.effect('applies the eye offset HERE, not in the renderer', () =>
    Effect.sync(() => {
      // If the renderer applied it, "which block am I targeting" and "which
      // block is highlighted" would be two implementations of one rule.
      const pose = withFeetPosition(INITIAL_PLAYER_POSE, position(3, 64, -7))
      const snapshot = cameraPoseOf(pose, AT)

      expect(snapshot.position).toStrictEqual(position(3, 64 + EYE_LEVEL_OFFSET, -7))
      expect(EYE_LEVEL_OFFSET).toBe(1.62)
    }),
  )

  it.effect('carries the instant the SIMULATION produced it', () =>
    Effect.sync(() => {
      expect(cameraPoseOf(INITIAL_PLAYER_POSE, AT).capturedAtSecs).toBe(500)
    }),
  )

  it.effect('is a value: producing a second snapshot cannot mutate the first', () =>
    Effect.sync(() => {
      const first = cameraPoseOf(INITIAL_PLAYER_POSE, AT)
      const moved = success(applyLook(withFeetPosition(INITIAL_PLAYER_POSE, position(9, 9, 9)), 1, 1))
      const second = cameraPoseOf(moved, MonotonicTimeSecs(501))

      expect(first.position).toStrictEqual(position(0, EYE_LEVEL_OFFSET, 0))
      expect(first.yawRadians).toBe(0)
      expect(second.yawRadians).toBe(1)
    }),
  )
})

describe('forwardVector — the sanctioned replacement for camera.getWorldDirection()', () => {
  it.effect('returns a typed failure for invalid runtime angles', () =>
    Effect.sync(() => {
      const invalid = forwardVectorResult({ yawRadians: Number.NaN, pitchRadians: 0 })

      expect(Result.isFailure(invalid)).toBe(true)
    }),
  )

  it.effect('yaw 0 looks down -Z', () =>
    Effect.sync(() => {
      const forward = forwardVector(cameraPoseOf(INITIAL_PLAYER_POSE, AT))

      expect(forward.x).toBeCloseTo(0, 12)
      expect(forward.y).toBeCloseTo(0, 12)
      expect(forward.z).toBeCloseTo(-1, 12)
    }),
  )

  it.effect('yaw pi/2 looks down -X, matching the YXZ Euler order the renderer will mirror', () =>
    Effect.sync(() => {
      const forward = forwardVector(cameraPoseOf(success(applyLook(INITIAL_PLAYER_POSE, Math.PI / 2, 0)), AT))

      expect(forward.x).toBeCloseTo(-1, 12)
      expect(forward.z).toBeCloseTo(0, 12)
    }),
  )

  it.effect('positive pitch looks up', () =>
    Effect.sync(() => {
      const forward = forwardVector(cameraPoseOf(success(applyLook(INITIAL_PLAYER_POSE, 0, 0.5)), AT))

      expect(forward.y).toBeCloseTo(Math.sin(0.5), 12)
      expect(forward.y).toBeGreaterThan(0)
    }),
  )

  it.effect('is a unit vector at every reachable pitch, so a raycast needs no renormalisation', () =>
    Effect.sync(() => {
      const pitches = [PITCH_MIN_RADIANS, -1, -0.01, 0, 0.01, 1, PITCH_MAX_RADIANS]
      for (const pitch of pitches) {
        const forward = forwardVector(cameraPoseOf(success(applyLook(INITIAL_PLAYER_POSE, 2.3, pitch)), AT))
        const length = Math.hypot(forward.x, forward.y, forward.z)
        expect(length).toBeCloseTo(1, 12)
      }
    }),
  )
})

describe('snapshotAgeSecs', () => {
  it.effect('lets a renderer measure how stale the pose it is mirroring has become', () =>
    Effect.sync(() => {
      const snapshot = cameraPoseOf(INITIAL_PLAYER_POSE, AT)

      expect(snapshotAgeSecs(snapshot, MonotonicTimeSecs(500.25))).toBeCloseTo(0.25, 10)
      expect(snapshotAgeSecs(snapshot, AT)).toBe(0)
    }),
  )

  it.effect('goes negative under clock skew rather than hiding the problem', () =>
    Effect.sync(() => {
      const snapshot = cameraPoseOf(INITIAL_PLAYER_POSE, AT)

      expect(snapshotAgeSecs(snapshot, MonotonicTimeSecs(499.5))).toBeCloseTo(-0.5, 10)
    }),
  )
})
