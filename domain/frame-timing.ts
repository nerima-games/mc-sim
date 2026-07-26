/**
 * Frame timing: the delta-time clamp.
 *
 * Ported verbatim from the reference implementation, which arrived at these
 * three numbers empirically:
 *
 *   ts-minecraft/packages/game/application/game-loop.ts:116-119
 *     const rawDelta = lastTimestamp === 0
 *       ? FIRST_FRAME_DELTA_SECS
 *       : (timestamp - lastTimestamp) / 1000
 *     const deltaTime = DeltaTimeSecs.make(Math.min(Math.max(0.001, rawDelta), 0.05))
 *
 *   ts-minecraft/packages/core/domain/constants.ts:9
 *     export const FIRST_FRAME_DELTA_SECS: DeltaTimeSecs = DeltaTimeSecs.make(0.016)
 *
 * Why each bound exists — all three are load-bearing, none is a round number
 * chosen for tidiness:
 *
 * - UPPER 0.05 (a 20 fps floor). A tab that was backgrounded for thirty seconds
 *   delivers a thirty-second delta on the frame after refocus. Integrating that
 *   in one step teleports the player through the world: Euler integration plus
 *   AABB collision resolution cannot detect a collider it stepped straight
 *   over. Clamping means the simulation runs slow rather than wrong.
 *
 * - LOWER 0.001. A zero or denormal delta divides by zero in anything that
 *   computes a rate, and 240 Hz displays plus double-scheduled frames really do
 *   produce deltas at that scale.
 *
 * - FIRST FRAME 0.016. On frame one there is no previous timestamp to subtract,
 *   so there is no delta to compute. 0.016 is "one frame at 60 Hz" — a fiction,
 *   but a bounded and reproducible one. The alternative, a zero first frame,
 *   makes the first frame's behaviour differ from every later frame, which is
 *   precisely the kind of special case that hides in a scenario test.
 *
 * `clampFrameDelta` is a pure function, deliberately: the loop that calls it
 * (application/game-loop.ts) is concurrent and awkward to test, whereas the
 * arithmetic that decides whether the player teleports is not.
 */
import { DeltaTimeSecs } from './kernel-vocabulary'

/** Lower clamp bound, seconds. Below this, rate computations divide by ~zero. */
export const MIN_FRAME_DELTA_SECS = 0.001

/** Upper clamp bound, seconds. A 20 fps floor; protects against tab-refocus jumps. */
export const MAX_FRAME_DELTA_SECS = 0.05

/** Delta used for the first frame, when no previous timestamp exists. One frame at 60 Hz. */
export const FIRST_FRAME_DELTA_SECS: DeltaTimeSecs = DeltaTimeSecs(0.016)

/**
 * Clamp a raw inter-frame interval into the simulable range.
 *
 * `rawDeltaSecs` is a plain `number`, not a `DeltaTimeSecs`: the whole point is
 * that the input may be out of range (negative under clock skew, enormous after
 * a tab refocus, NaN if a timestamp was missing). Branding the input would move
 * the failure to a throw at the boundary; clamping is what the simulation
 * actually wants.
 *
 * NaN maps to `FIRST_FRAME_DELTA_SECS` rather than propagating, because a NaN
 * delta silently turns every downstream position into NaN and the resulting bug
 * surfaces thousands of frames later as an invisible player.
 */
export const clampFrameDelta = (rawDeltaSecs: number): DeltaTimeSecs =>
  Number.isNaN(rawDeltaSecs)
    ? FIRST_FRAME_DELTA_SECS
    : DeltaTimeSecs(Math.min(Math.max(MIN_FRAME_DELTA_SECS, rawDeltaSecs), MAX_FRAME_DELTA_SECS))

/**
 * Delta between two monotonic readings, clamped.
 *
 * `previous === undefined` means "this is the first frame", which is the
 * `lastTimestamp === 0` sentinel in the reference expressed as a type rather
 * than as a magic zero. A real monotonic clock may legitimately read 0.
 */
export const frameDeltaBetween = (previousSecs: number | undefined, nowSecs: number): DeltaTimeSecs =>
  previousSecs === undefined ? FIRST_FRAME_DELTA_SECS : clampFrameDelta(nowSecs - previousSecs)

/**
 * Simulated time the upper clamp threw away, in seconds. Never negative.
 *
 * The upper bound is deliberate and stays (see above): a thirty-second delta
 * integrated in one step teleports the player through the world. But the world
 * then never receives those 29.95 seconds and nothing repays them, so a session
 * falls quietly behind the clock that drives it, and until now the quantity was
 * computed nowhere — it could not be logged, shown, or put in a bug report.
 *
 * Only the UPPER clamp counts as loss. The lower bound and the NaN substitution
 * hand the simulation MORE time than elapsed rather than less, which is a
 * different phenomenon: it is bounded by one frame, it cannot accumulate into a
 * visible drift, and reporting it as a negative loss would let the two cancel
 * out and read as zero.
 *
 * `application/game-loop.ts` accumulates this across a generation and publishes
 * it as `secondsLostToClamp`.
 */
export const frameDeltaLossSecs = (rawDeltaSecs: number): number =>
  Number.isNaN(rawDeltaSecs) ? 0 : Math.max(0, rawDeltaSecs - clampFrameDelta(rawDeltaSecs))

/**
 * The loss `frameDeltaBetween` incurred on the same two readings.
 *
 * A first frame loses nothing: there is no elapsed interval to clamp, only the
 * `FIRST_FRAME_DELTA_SECS` fiction.
 */
export const frameDeltaLossBetween = (previousSecs: number | undefined, nowSecs: number): number =>
  previousSecs === undefined ? 0 : frameDeltaLossSecs(nowSecs - previousSecs)
