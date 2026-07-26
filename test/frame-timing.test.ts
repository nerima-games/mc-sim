/**
 * REGRESSION: the delta-time clamp is exactly
 * `Math.min(Math.max(0.001, raw), 0.05)`.
 *
 * Verified against the reference at
 * ts-minecraft/packages/game/application/game-loop.ts:119, with the first-frame
 * value at ts-minecraft/packages/core/domain/constants.ts:9.
 *
 * The bounds are asserted as literals, not as arithmetic on the constants,
 * because the point is that these three numbers were measured rather than
 * derived. A test that reads `MAX_FRAME_DELTA_SECS` on both sides would go
 * green after someone "tidied" the upper bound to 0.1 and re-introduced
 * tunnelling through walls on tab refocus.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  clampFrameDelta,
  FIRST_FRAME_DELTA_SECS,
  frameDeltaBetween,
  MAX_FRAME_DELTA_SECS,
  MIN_FRAME_DELTA_SECS,
} from '../domain/frame-timing'

describe('clampFrameDelta', () => {
  it.effect('the three constants are the reference implementation values, literally', () =>
    Effect.sync(() => {
      expect(MIN_FRAME_DELTA_SECS).toBe(0.001)
      expect(MAX_FRAME_DELTA_SECS).toBe(0.05)
      expect(FIRST_FRAME_DELTA_SECS).toBe(0.016)
    }),
  )

  it.effect('passes an ordinary 60 Hz frame straight through', () =>
    Effect.sync(() => {
      expect(clampFrameDelta(1 / 60)).toBeCloseTo(0.016_666, 5)
      expect(clampFrameDelta(0.02)).toBe(0.02)
    }),
  )

  it.effect('clamps a tab-refocus jump to 0.05 — the simulation runs slow, never wrong', () =>
    Effect.sync(() => {
      // Thirty seconds in one integration step would step the player straight
      // through every collider between here and there.
      expect(clampFrameDelta(30)).toBe(0.05)
      expect(clampFrameDelta(0.05001)).toBe(0.05)
      expect(clampFrameDelta(Number.POSITIVE_INFINITY)).toBe(0.05)
    }),
  )

  it.effect('clamps a denormal or negative delta up to 0.001, so no rate divides by zero', () =>
    Effect.sync(() => {
      expect(clampFrameDelta(0)).toBe(0.001)
      expect(clampFrameDelta(1e-9)).toBe(0.001)
      expect(clampFrameDelta(-5)).toBe(0.001)
      expect(clampFrameDelta(Number.NEGATIVE_INFINITY)).toBe(0.001)
    }),
  )

  it.effect('leaves the boundary values themselves alone', () =>
    Effect.sync(() => {
      expect(clampFrameDelta(0.001)).toBe(0.001)
      expect(clampFrameDelta(0.05)).toBe(0.05)
    }),
  )

  it.effect('maps NaN to the first-frame delta rather than poisoning every later position', () =>
    Effect.sync(() => {
      // Math.min/Math.max propagate NaN, so the reference's expression would
      // have returned NaN here. A NaN position is invisible and the bug
      // surfaces thousands of frames from its cause.
      expect(clampFrameDelta(Number.NaN)).toBe(FIRST_FRAME_DELTA_SECS)
    }),
  )

  it.effect('the result is always inside the clamp range, for any input at all', () =>
    Effect.sync(() => {
      const inputs = [-1e9, -1, -0, 0, 1e-12, 0.0009, 0.001, 0.0167, 0.049, 0.05, 0.051, 1, 1e9]
      for (const raw of inputs) {
        const clamped = clampFrameDelta(raw)
        expect(clamped).toBeGreaterThanOrEqual(MIN_FRAME_DELTA_SECS)
        expect(clamped).toBeLessThanOrEqual(MAX_FRAME_DELTA_SECS)
      }
    }),
  )
})

describe('frameDeltaBetween', () => {
  it.effect('uses the first-frame delta when there is no previous timestamp', () =>
    Effect.sync(() => {
      expect(frameDeltaBetween(undefined, 1000)).toBe(FIRST_FRAME_DELTA_SECS)
    }),
  )

  it.effect('treats a monotonic reading of exactly 0 as a real timestamp, not as "no frame yet"', () =>
    Effect.sync(() => {
      // The reference used `lastTimestamp === 0` as its sentinel. A monotonic
      // clock is allowed to read 0, so the sentinel and a legitimate reading
      // are indistinguishable there; `undefined` cannot collide with a value.
      expect(frameDeltaBetween(0, 0.02)).toBe(0.02)
    }),
  )

  it.effect('clamps the computed interval, not just the raw one', () =>
    Effect.sync(() => {
      expect(frameDeltaBetween(100, 130)).toBe(MAX_FRAME_DELTA_SECS)
      expect(frameDeltaBetween(100, 99)).toBe(MIN_FRAME_DELTA_SECS)
    }),
  )
})
