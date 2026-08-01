/**
 * REGRESSION: mc-sim owns the camera pose; nothing reads it back from a
 * renderer.
 *
 * plan.md §3.8 / §5.1-2. In the reference the THREE camera was the authority
 * and thirteen simulation-side call sites read `camera.position` /
 * `camera.getWorldDirection(...)` out of it — see the citations in
 * domain/camera-pose.ts. The structural fix is the dependency direction
 * (mc-render -> mc-sim, never the reverse), which `pnpm check:deps` enforces.
 * These tests pin the behavioural half: everything a consumer could want from a
 * camera is computable HERE, in Node, with no renderer in the process.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  applyLook,
  cameraPoseOf,
  clampPitch,
  EYE_LEVEL_OFFSET,
  forwardVector,
  INITIAL_PLAYER_POSE,
  PITCH_EPSILON,
  PITCH_MAX_RADIANS,
  PITCH_MIN_RADIANS,
  snapshotAgeSecs,
  withFeetPosition,
} from '../src/domain/camera-pose'
import { MonotonicTimeSecs, position } from '../src/domain/kernel-vocabulary'

const AT = MonotonicTimeSecs(500)

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
      expect(clampPitch(Math.PI)).toBe(PITCH_MAX_RADIANS)
      expect(clampPitch(-Math.PI)).toBe(PITCH_MIN_RADIANS)
      expect(clampPitch(Math.PI / 2)).toBe(PITCH_MAX_RADIANS)
      expect(clampPitch(0.3)).toBe(0.3)
    }),
  )

  it.effect('repeatedly looking up saturates rather than wrapping the view upside down', () =>
    Effect.sync(() => {
      const looked = [1, 2, 3, 4, 5].reduce((pose) => applyLook(pose, 0, 1), INITIAL_PLAYER_POSE)

      expect(looked.pitchRadians).toBe(PITCH_MAX_RADIANS)
    }),
  )

  it.effect('yaw is NOT wrapped, so turn deltas stay measurable across the seam', () =>
    Effect.sync(() => {
      const spun = [1, 2, 3].reduce((pose) => applyLook(pose, Math.PI, 0), INITIAL_PLAYER_POSE)

      expect(spun.yawRadians).toBeCloseTo(3 * Math.PI, 12)
      expect(spun.yawRadians).toBeGreaterThan(2 * Math.PI)
    }),
  )
})

describe('CameraPoseSnapshot production', () => {
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
      const moved = applyLook(withFeetPosition(INITIAL_PLAYER_POSE, position(9, 9, 9)), 1, 1)
      const second = cameraPoseOf(moved, MonotonicTimeSecs(501))

      expect(first.position).toStrictEqual(position(0, EYE_LEVEL_OFFSET, 0))
      expect(first.yawRadians).toBe(0)
      expect(second.yawRadians).toBe(1)
    }),
  )
})

describe('forwardVector — the sanctioned replacement for camera.getWorldDirection()', () => {
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
      const forward = forwardVector(cameraPoseOf(applyLook(INITIAL_PLAYER_POSE, Math.PI / 2, 0), AT))

      expect(forward.x).toBeCloseTo(-1, 12)
      expect(forward.z).toBeCloseTo(0, 12)
    }),
  )

  it.effect('positive pitch looks up', () =>
    Effect.sync(() => {
      const forward = forwardVector(cameraPoseOf(applyLook(INITIAL_PLAYER_POSE, 0, 0.5), AT))

      expect(forward.y).toBeCloseTo(Math.sin(0.5), 12)
      expect(forward.y).toBeGreaterThan(0)
    }),
  )

  it.effect('is a unit vector at every reachable pitch, so a raycast needs no renormalisation', () =>
    Effect.sync(() => {
      const pitches = [PITCH_MIN_RADIANS, -1, -0.01, 0, 0.01, 1, PITCH_MAX_RADIANS]
      for (const pitch of pitches) {
        const forward = forwardVector(cameraPoseOf(applyLook(INITIAL_PLAYER_POSE, 2.3, pitch), AT))
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
