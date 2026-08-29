/**
 * REGRESSION: the delta-time clamp is exactly
 * `Math.min(Math.max(0.001, raw), 0.05)`.
 *
 * `domain/frame-timing.ts` now forwards these three numbers and the clamp
 * function from `@nerima-games/mc-physics` rather than hand-copying them, so
 * this pins the CONSUMED values rather than a reimplementation — it fails if
 * the physics dependency ever ships a different clamp.
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
  frameDeltaLossBetween,
  frameDeltaLossSecs,
  MAX_FRAME_DELTA_SECS,
  MIN_FRAME_DELTA_SECS,
} from '../src/domain/frame-timing'

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

/**
 * The time the upper clamp throws away is a QUANTITY, and it is computed here.
 *
 * The clamp itself stays exactly as it is — the tests above pin it. What these
 * add is that the discarded amount can be named: it was previously derivable
 * from nothing a caller had, so a session could not say how far behind the
 * driving clock it had fallen and a 30-second background tab cost 29.95 s of
 * in-game time that appeared in no number anywhere.
 */
describe('frameDeltaLossSecs', () => {
  it.effect('a 30-second background tab costs 29.95 s of simulated time, and says so', () =>
    Effect.sync(() => {
      // The literal from apps/preview-sim `--stats`, FRAME-CLAMP: raw 30
      // becomes an applied 0.05, and the remaining 29.95 is never delivered.
      expect(frameDeltaLossSecs(30)).toBeCloseTo(29.95, 12)
      expect(frameDeltaLossSecs(0.051)).toBeCloseTo(0.001, 12)
    }),
  )

  it.effect('an ordinary frame loses nothing at all', () =>
    Effect.sync(() => {
      expect(frameDeltaLossSecs(1 / 60)).toBe(0)
      expect(frameDeltaLossSecs(0.05)).toBe(0)
      expect(frameDeltaLossSecs(0.001)).toBe(0)
    }),
  )

  it.effect('the LOWER clamp is not a loss — it hands the world more time, not less', () =>
    Effect.sync(() => {
      // Reporting these as a negative loss would let them cancel a real
      // background-tab gap and make the total read zero. They are bounded by
      // one frame and cannot accumulate into a visible drift; the upper clamp
      // can, which is the whole reason the counter exists.
      expect(frameDeltaLossSecs(0)).toBe(0)
      expect(frameDeltaLossSecs(-30)).toBe(0)
      expect(frameDeltaLossSecs(Number.NaN)).toBe(0)
    }),
  )

  it.effect('loss and applied delta always add back up to the raw interval', () =>
    Effect.sync(() => {
      for (const raw of [0.008, 0.05, 0.0501, 0.2, 1, 30, 1e6]) {
        expect(clampFrameDelta(raw) + frameDeltaLossSecs(raw)).toBeCloseTo(raw, 9)
      }
    }),
  )
})

describe('frameDeltaLossBetween', () => {
  it.effect('measures the loss of the same two readings frameDeltaBetween used', () =>
    Effect.sync(() => {
      expect(frameDeltaBetween(100, 130)).toBe(0.05)
      expect(frameDeltaLossBetween(100, 130)).toBeCloseTo(29.95, 12)
    }),
  )

  it.effect('a first frame loses nothing, because no interval elapsed to clamp', () =>
    Effect.sync(() => {
      expect(frameDeltaLossBetween(undefined, 1e9)).toBe(0)
    }),
  )

  it.effect('a clock that ran BACKWARDS is not counted as lost time', () =>
    Effect.sync(() => {
      expect(frameDeltaBetween(10, 5)).toBe(0.001)
      expect(frameDeltaLossBetween(10, 5)).toBe(0)
    }),
  )
})
