/**
 * The kernel mirror is pinned against kernel's documented shape.
 *
 * ---------------------------------------------------------------------------
 * What this file is defending against
 * ---------------------------------------------------------------------------
 *
 * `domain/kernel-vocabulary.ts` is a temporary local copy of
 * `@nerima-games/mc-kernel`, and its header promises that deleting it and
 * repointing every import at the published package will typecheck. Nothing
 * enforced that promise, and it had already been broken: this repository's
 * `ClockService` carried ONE field (`monotonicSecs`) where kernel's
 * (`mc-kernel/domain/clock.ts:43-48`) carries two, and `FixedClockLayer` took a
 * bare `MonotonicTimeSecs` where kernel's takes an object.
 *
 * The divergence was invisible to `tsc` and fatal at runtime, because
 * `ClockPort` is a `Context.Tag` and Effect resolves Tags BY THEIR TEXTUAL KEY.
 * All three copies of the tag use `'@nerima-games/mc-kernel/ClockPort'`, so in
 * any bundle that contains two of them — mc-playground-kit depends on mc-sim —
 * the narrow mirror's `Layer` satisfies the wide mirror's tag and
 * `wallClockEpochMillis` is `undefined` at the point of use. TypeScript cannot
 * see it: the two classes are nominally distinct types that denote one service.
 *
 * So the shape is asserted here in both directions, at compile time and at
 * runtime, and the tag key is asserted literally. A future narrowing OR
 * widening of the mirror fails CI instead of a frame.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  ClockPort,
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  fixedClock,
  MonotonicTimeSecs,
  monotonicSecs,
  wallClockEpochMillis,
  type ClockService,
} from '../domain/kernel-vocabulary'

/**
 * Kernel's `ClockService`, restated from `mc-kernel/domain/clock.ts:43-48`.
 *
 * Written out rather than imported because mc-kernel is not published — which
 * is the same reason the mirror exists at all. When it is published, this alias
 * becomes `import type { ClockService } from '@nerima-games/mc-kernel'` and the
 * assertions below keep their meaning unchanged.
 */
type KernelClockService = {
  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>
  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>
}

/** Kernel's documented `FixedClockLayer` signature, same source, lines 68-71. */
type KernelFixedClockLayer = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}) => Layer.Layer<ClockPort>

const instant = {
  monotonicSecs: MonotonicTimeSecs(1_234.5),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
}

const CLOCK_SERVICE_FIELDS = ['monotonicSecs', 'wallClockEpochMillis'] as const

describe('the ClockPort mirror is kernel’s ClockPort', () => {
  // REGRESSION: the tag key is the whole hazard. Two classes with this string
  // are one service at runtime, so the mirrors must agree on the SHAPE too —
  // which is what the rest of this block checks.
  it.effect('uses kernel’s tag key verbatim, which is why the shape has to match', () =>
    Effect.sync(() => {
      expect(ClockPort.key).toBe('@nerima-games/mc-kernel/ClockPort')
    }),
  )

  it.effect('REGRESSION: the mirrored ClockService is not NARROWER than kernel’s', () =>
    Effect.sync(() => {
      // Compile-time half: a mirror value must be usable where kernel's service
      // is wanted. Dropping a field breaks this line.
      const asKernel: KernelClockService = fixedClock(instant)
      // Runtime half: the fields must actually be there, not merely typed.
      expect(Object.keys(asKernel).sort()).toStrictEqual([...CLOCK_SERVICE_FIELDS])
    }),
  )

  it.effect('REGRESSION: the mirrored ClockService is not WIDER than kernel’s', () =>
    Effect.sync(() => {
      // An object literal, so excess-property checking applies: a field kernel
      // does not have breaks this line, and a field kernel has that the mirror
      // has dropped breaks it too.
      const asMirror: ClockService = {
        monotonicSecs: Effect.succeed(instant.monotonicSecs),
        wallClockEpochMillis: Effect.succeed(instant.wallClockEpochMillis),
      }
      expect(Object.keys(asMirror).sort()).toStrictEqual([...CLOCK_SERVICE_FIELDS])
    }),
  )

  it.effect('REGRESSION: FixedClockLayer takes kernel’s object argument, not a bare reading', () =>
    Effect.gen(function* () {
      // Assigning in both directions pins the signature exactly: a bare
      // `(at: MonotonicTimeSecs)` — what this mirror used to declare — fails.
      const asKernel: KernelFixedClockLayer = FixedClockLayer
      const asMirror: typeof FixedClockLayer = asKernel

      const readings = yield* Effect.all({
        monotonic: monotonicSecs,
        wall: wallClockEpochMillis,
      }).pipe(Effect.provide(asMirror(instant)))

      expect(readings.monotonic).toBe(1_234.5)
      expect(readings.wall).toBe(1_700_000_000_000)
    }),
  )
})

describe('the mirrored brands are kernel’s brands', () => {
  // plan.md §3.4's [0.001, 0.05] clamp is a FRAME-LOOP concern and is applied
  // at the boundary by `domain/frame-timing.ts`. Kernel's brand stays loose, so
  // this mirror's must too: a stricter mirror would reject values kernel calls
  // valid while being nominally indistinguishable from kernel's own brand.
  it.effect('DeltaTimeSecs is finite and non-negative — kernel’s refinement, not the clamp', () =>
    Effect.sync(() => {
      expect(DeltaTimeSecs(0)).toBe(0)
      expect(DeltaTimeSecs(0.0001)).toBe(0.0001)
      expect(DeltaTimeSecs(30)).toBe(30)
      expect(() => DeltaTimeSecs(-0.000_001)).toThrow()
      expect(() => DeltaTimeSecs(Number.NaN)).toThrow()
      expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )

  it.effect('MonotonicTimeSecs is finite and non-negative', () =>
    Effect.sync(() => {
      expect(MonotonicTimeSecs(0)).toBe(0)
      expect(() => MonotonicTimeSecs(-1)).toThrow()
      expect(() => MonotonicTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )

  it.effect('EpochMillis is a safe integer, so a fractional millisecond cannot be persisted', () =>
    Effect.sync(() => {
      expect(EpochMillis(0)).toBe(0)
      expect(EpochMillis(1_700_000_000_000)).toBe(1_700_000_000_000)
      expect(() => EpochMillis(1.5)).toThrow()
      expect(() => EpochMillis(Number.MAX_SAFE_INTEGER + 2)).toThrow()
    }),
  )
})
