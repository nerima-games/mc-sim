/**
 * Frame timing: the delta-time clamp.
 *
 * The three bounds and the clamp/first-frame logic are physics-domain
 * invariants (they encode how far a body may move in one integration step
 * before the AABB resolver can no longer see a floor it should have collided
 * with), not something mc-sim decides independently. `@nerima-games/mc-physics`
 * owns that definition (`domain/delta-time.ts`, `MIN_DELTA_SECS` /
 * `MAX_DELTA_SECS` / `FIRST_FRAME_DELTA_SECS` / `clampDeltaTime` /
 * `deltaTimeBetween`); this module forwards to it instead of keeping a
 * hand-copied second definition in sync, which is the manual-sync obligation
 * docs/design-notes.md DN-03 recorded and this change retires.
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
 * The names below (`clampFrameDelta`, `frameDeltaBetween`, `MIN_FRAME_DELTA_SECS`,
 * `MAX_FRAME_DELTA_SECS`, `FIRST_FRAME_DELTA_SECS`) are mc-sim's established
 * public surface — consumed by apps/preview-sim outside this change's scope —
 * so they stay, now as direct forwards to physics rather than reimplementations.
 */
import { DeltaTimeSecs } from "@nerima-games/mc-kernel"
import {
  clampDeltaTime,
  deltaTimeBetween,
  FIRST_FRAME_DELTA_SECS as PHYSICS_FIRST_FRAME_DELTA_SECS,
  MAX_DELTA_SECS,
  MIN_DELTA_SECS,
} from "@nerima-games/mc-physics"

/** Lower clamp bound, seconds. Below this, rate computations divide by ~zero. */
export const MIN_FRAME_DELTA_SECS = MIN_DELTA_SECS

/** Upper clamp bound, seconds. A 20 fps floor; protects against tab-refocus jumps. */
export const MAX_FRAME_DELTA_SECS = MAX_DELTA_SECS

/** Delta used for the first frame, when no previous timestamp exists. One frame at 60 Hz. */
export const FIRST_FRAME_DELTA_SECS: DeltaTimeSecs = DeltaTimeSecs(PHYSICS_FIRST_FRAME_DELTA_SECS)

/**
 * Clamp a raw inter-frame interval into the simulable range.
 *
 * Forwards to physics's `clampDeltaTime`, byte-for-byte the expression mc-sim
 * used to maintain by hand: `rawDeltaSecs` is a plain `number`, not a
 * `DeltaTimeSecs`, because the input may be out of range (negative under clock
 * skew, enormous after a tab refocus, NaN if a timestamp was missing).
 *
 * NaN maps to `FIRST_FRAME_DELTA_SECS` rather than propagating, because a NaN
 * delta silently turns every downstream position into NaN and the resulting bug
 * surfaces thousands of frames later as an invisible player.
 */
export const clampFrameDelta = clampDeltaTime

/**
 * Delta between two monotonic readings, clamped.
 *
 * Forwards to physics's `deltaTimeBetween`. `previousSecs === undefined` means
 * "this is the first frame". A real monotonic clock may legitimately read 0.
 */
export const frameDeltaBetween = deltaTimeBetween

/**
 * Simulated time the upper clamp threw away, in seconds. Never negative.
 *
 * mc-sim-specific: physics has no equivalent, since "what happened to the time
 * the clamp discarded" is frame-loop bookkeeping, not a physics primitive. Built
 * on `clampFrameDelta` above, which is now physics's `clampDeltaTime`.
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
