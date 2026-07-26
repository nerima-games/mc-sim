/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-kernel`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * plan.md §6 Step 3 publishes the repositories bottom-up: a repository is
 * published to GitHub Packages only once its interface has held still, and only
 * then may its consumers pin it. Nothing is published yet, so mc-sim cannot
 * `import ... from '@nerima-games/mc-kernel'` — there is no package to resolve,
 * and `scripts/check-dependency-whitelist.ts` would in any case reject an
 * import of something absent from `package.json#dependencies`.
 *
 * Rather than invent a different vocabulary that would have to be reconciled
 * later, this file mirrors the handful of kernel declarations mc-sim actually
 * uses, verbatim in shape and semantics, from
 * `mc-kernel/domain/{quantities,coordinates,clock,camera,identifiers}.ts`.
 *
 * WHEN mc-kernel IS PUBLISHED:
 *   1. add `@nerima-games/mc-kernel` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './kernel-vocabulary'` at `'@nerima-games/mc-kernel'`.
 * Nothing else should need to change. If step 3 turns out not to typecheck,
 * this file has drifted and the drift is the bug.
 *
 * The mirror is deliberately MINIMAL — only what mc-sim uses. A larger mirror
 * would be a larger thing to keep honest.
 *
 * ---------------------------------------------------------------------------
 * ONE EXCEPTION TO "MINIMAL": the Clock Port is mirrored WHOLE
 * ---------------------------------------------------------------------------
 *
 * `ClockPort` is a `Context.Tag`, and Effect resolves Tags by their TEXTUAL
 * KEY — here, `'@nerima-games/mc-kernel/ClockPort'`. Two classes built from the
 * same key are the same service at runtime and two unrelated nominal types to
 * TypeScript, so a NARROWER mirror of `ClockService` is not "less of the
 * vocabulary", it is a silent runtime hazard: a `Layer` built against a
 * one-field mirror satisfies a two-field tag, and the missing field reads
 * `undefined` in a repository that never saw this file.
 *
 * `EpochMillis`, `fixedClock`, `wallClockEpochMillis` and the object-shaped
 * `FixedClockLayer` are therefore mirrored even though nothing in mc-sim reads a
 * wall clock. `test/kernel-mirror.test.ts` pins the shape against kernel's, so
 * the next divergence fails CI rather than a frame.
 */
import { Brand, Context, Effect, Layer } from 'effect'

// ---------------------------------------------------------------------------
// Quantities — mirrors mc-kernel/domain/quantities.ts
// ---------------------------------------------------------------------------

/**
 * Elapsed simulation time for one frame, in seconds. Finite and non-negative.
 * A zero delta is legal: a frame may be scheduled twice inside one clock tick.
 */
export type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>

export const DeltaTimeSecs = Brand.refined<DeltaTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`DeltaTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * A reading from a monotonic clock, in seconds. Never decreases; the origin is
 * unspecified, so only differences are meaningful. Comes from `ClockPort`.
 */
export type MonotonicTimeSecs = number & Brand.Brand<'MonotonicTimeSecs'>

export const MonotonicTimeSecs = Brand.refined<MonotonicTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`MonotonicTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * A wall-clock reading: milliseconds since the Unix epoch. Only for values a
 * human reads or that must survive a save/load round trip — never for durations,
 * because it can jump in either direction.
 *
 * Mirrored solely so that `ClockService` below has kernel's real shape.
 */
export type EpochMillis = number & Brand.Brand<'EpochMillis'>

export const EpochMillis = Brand.refined<EpochMillis>(
  (value) => Number.isSafeInteger(value),
  (value) => Brand.error(`EpochMillis must be a safe integer number of milliseconds, received ${value}`),
)

/** Maximum items in one inventory stack. Kernel fixes the representable range only. */
export const MAX_STACK_COUNT = 64

/** Number of items in one inventory stack. Integer in [0, MAX_STACK_COUNT]. */
export type StackCount = number & Brand.Brand<'StackCount'>

export const StackCount = Brand.refined<StackCount>(
  (value) => Number.isInteger(value) && value >= 0 && value <= MAX_STACK_COUNT,
  (value) => Brand.error(`StackCount must be an integer in [0, ${MAX_STACK_COUNT}], received ${value}`),
)

// ---------------------------------------------------------------------------
// Coordinates — mirrors mc-kernel/domain/coordinates.ts (the continuous part)
// ---------------------------------------------------------------------------

/** A continuous world-space point. Y is up, 1 block = 1 unit. */
export type Position = {
  readonly x: number
  readonly y: number
  readonly z: number
}

export const position = (x: number, y: number, z: number): Position => ({ x, y, z })

// ---------------------------------------------------------------------------
// Clock Port — mirrors mc-kernel/domain/clock.ts
// ---------------------------------------------------------------------------

export type ClockService = {
  /** Monotonic reading. Only differences between readings are meaningful. */
  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>
  /** Wall-clock reading. Never use for durations. */
  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>
}

export class ClockPort extends Context.Tag('@nerima-games/mc-kernel/ClockPort')<ClockPort, ClockService>() {}

/** A clock frozen at one instant. Platform-independent, hence shippable by kernel. */
export const fixedClock = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}): ClockService => ({
  monotonicSecs: Effect.succeed(at.monotonicSecs),
  wallClockEpochMillis: Effect.succeed(at.wallClockEpochMillis),
})

/** `fixedClock` as a Layer, for deterministic tests and replays. */
export const FixedClockLayer = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}): Layer.Layer<ClockPort> => Layer.succeed(ClockPort, fixedClock(at))

/** Read the monotonic clock. The only sanctioned answer to "what time is it?". */
export const monotonicSecs: Effect.Effect<MonotonicTimeSecs, never, ClockPort> = Effect.flatMap(
  ClockPort,
  (clock) => clock.monotonicSecs,
)

/** Read the wall clock. Only for human-facing or persisted values. */
export const wallClockEpochMillis: Effect.Effect<EpochMillis, never, ClockPort> = Effect.flatMap(
  ClockPort,
  (clock) => clock.wallClockEpochMillis,
)

// ---------------------------------------------------------------------------
// Camera pose — mirrors mc-kernel/domain/camera.ts
// ---------------------------------------------------------------------------

/**
 * The camera pose, as a value.
 *
 * plan.md §4.3 / §5.1-2: mc-sim owns the truth and mc-render mirrors it. The
 * type deliberately has no setter and must never grow one — see
 * `domain/camera-pose.ts` in this repository, which owns the only sanctioned
 * ways to produce one.
 */
export type CameraPoseSnapshot = {
  readonly position: Position
  readonly yawRadians: number
  readonly pitchRadians: number
  readonly capturedAtSecs: MonotonicTimeSecs
}
