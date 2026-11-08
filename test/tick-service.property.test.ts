import fc from 'fast-check'
import {
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  MonotonicTimeSecs,
  NonNegativeTickCount,
  StageId,
} from '@nerima-games/mc-kernel'
import { Effect, Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { assertEffectOutcome, hostileNumberOrNullish, invokeEffect } from './public-property-helpers.js'

const checks = { numRuns: 100 }
const fixedFrameLayer = FixedClockLayer({
  monotonicSecs: MonotonicTimeSecs(1_000),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
})
const runSequence = async (deltas: ReadonlyArray<number>) => {
  const service = await Effect.runPromise(Sim.makeTickService())
  const outcomes = await Effect.runPromise(Effect.forEach(deltas, (delta) =>
    Effect.result(invokeEffect(service.advanceFrame, [delta])),
  ))
  return outcomes.map((outcome) => {
    if (Result.isFailure(outcome)) throw outcome.failure
    return outcome.success
  })
}

const adjacentFloat = (value: number, direction: 'down' | 'up'): number => {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  const bits = view.getBigUint64(0)
  view.setBigUint64(0, direction === 'down' ? bits - 1n : bits + 1n)
  return view.getFloat64(0)
}

it('returns schema-valid fixed-step output or a typed failure for hostile frame deltas', async () => {
  await fc.assert(
    fc.asyncProperty(hostileNumberOrNullish, async (delta) => {
      const service = await Effect.runPromise(Sim.makeTickService())
      const outcome = await Effect.runPromise(
        Effect.result(invokeEffect(service.advanceFrame, [delta])),
      )
      assertEffectOutcome(
        'TickService.advanceFrame',
        () => outcome,
        Sim.FixedStepAdvanceSchema,
        Sim.FixedStepFailureSchema,
      )
      if (Result.isFailure(outcome)) {
        const next = await Effect.runPromise(service.advanceFrame(DeltaTimeSecs(0.05)))
        expect(next.state.tick).toBe(1)
      }
    }),
    checks,
  )
})

it('returns schema-valid output or a typed failure for hostile initial ticks', async () => {
  await fc.assert(
    fc.asyncProperty(hostileNumberOrNullish, async (initialTick) => {
      const service = await Effect.runPromise(
        invokeEffect(Sim.makeTickService, [initialTick]),
      )
      const outcome = await Effect.runPromise(
        Effect.result(service.advanceFrame(DeltaTimeSecs(0.05))),
      )
      assertEffectOutcome(
        'makeTickService.advanceFrame',
        () => outcome,
        Sim.FixedStepAdvanceSchema,
        Sim.FixedStepFailureSchema,
      )
    }),
    checks,
  )
})

it('matches the theoretical 20 TPS tick total for non-overloaded varied frame sequences', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 300 }), async (milliseconds) => {
      const deltas = milliseconds.map((value) => value / 1000)
      const frames = await runSequence(deltas)
      const actualTicks = frames.reduce((total, frame) => total + Number(frame.ticks), 0)
      const theoreticalTicks = Math.floor(milliseconds.reduce((total, value) => total + value, 0) / 50)

      let cumulativeMilliseconds = 0
      let cumulativeTicks = 0
      const elapsedFrames = milliseconds[Symbol.iterator]()
      for (const frame of frames) {
        const elapsed = elapsedFrames.next()
        if (elapsed.done) throw new Error('Tick service returned more frames than inputs')
        cumulativeMilliseconds += elapsed.value
        cumulativeTicks += Number(frame.ticks)
        expect(cumulativeTicks).toBeLessThanOrEqual(Math.floor(cumulativeMilliseconds / 50))
      }
      expect(elapsedFrames.next().done).toBe(true)

      expect(actualTicks).toBe(theoreticalTicks)
      expect(frames.every((frame) => frame.ticks <= NonNegativeTickCount(5))).toBe(true)
      expect(frames.every((frame) => frame.interpolationFraction >= 0 && frame.interpolationFraction < 1)).toBe(true)
    }),
    checks,
  )
})

it('keeps the same six-second tick total at 20, 60, and 120 frames per second', async () => {
  const schedules = [
    { frames: 120, delta: 1 / 20 },
    { frames: 360, delta: 1 / 60 },
    { frames: 720, delta: 1 / 120 },
  ]

  await Promise.all(schedules.map(async ({ frames: frameCount, delta }) => {
    const result = await runSequence(Array.from({ length: frameCount }, () => delta))
    expect(result.reduce((total, frame) => total + Number(frame.ticks), 0)).toBe(120)
  }))
})

it('produces the same tick and interpolation sequence for identical frame deltas', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 100 }), async (values) => {
      const deltas = values.map((value) => value / 1000)
      const first = await runSequence(deltas)
      const second = await runSequence(deltas)
      expect(first.map(({ ticks, interpolationFraction, overloaded }) => [ticks, interpolationFraction, overloaded]))
        .toStrictEqual(second.map(({ ticks, interpolationFraction, overloaded }) => [ticks, interpolationFraction, overloaded]))
    }),
    checks,
  )
})

it('caps large jumps, discards excess time, and handles zero and boundary deltas', async () => {
  const boundaries = [
    { delta: 0, ticks: 0 },
    { delta: 0.049999, ticks: 0 },
    { delta: adjacentFloat(0.05, 'down'), ticks: 0 },
    { delta: 0.04999999999999999, ticks: 0 },
    { delta: 0.05, ticks: 1 },
    { delta: adjacentFloat(0.05, 'up'), ticks: 1 },
    { delta: 0.050001, ticks: 1 },
    { delta: 0.249999, ticks: 4 },
    { delta: 0.25, ticks: 5 },
    { delta: 0.250001, ticks: 5 },
    { delta: 1, ticks: 5 },
  ]

  await Promise.all(boundaries.map(async (row) => {
    const service = await Effect.runPromise(Sim.makeTickService())
    const outcome = await Effect.runPromise(
      Effect.result(invokeEffect(service.advanceFrame, [row.delta])),
    )
    expect(Result.isSuccess(outcome)).toBe(true)
    if (Result.isSuccess(outcome)) {
      expect(outcome.success.ticks).toBe(row.ticks)
      expect(outcome.success.ticks).toBeLessThanOrEqual(5)
      expect(outcome.success.interpolationFraction).toBeGreaterThanOrEqual(0)
      expect(outcome.success.interpolationFraction).toBeLessThan(1)
      if (row.delta === 0.25) {
        expect(outcome.success.overloaded).toBe(false)
        expect(outcome.success.state.accumulator).toBe(0)
        expect(outcome.success.interpolationFraction).toBe(0)
      } else if (row.delta > 0.25) {
        expect(outcome.success.overloaded).toBe(true)
        expect(outcome.success.state.accumulator).toBe(0)
      }
    }
  }))
})

it('returns a typed failure for malformed tick counts without running stages', async () => {
  await fc.assert(
    fc.asyncProperty(fc.oneof(
      fc.double({ max: -Number.MIN_VALUE }),
      fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
      fc.integer({ min: 6, max: 100 }),
      fc.constantFrom(1.5, Number.MAX_SAFE_INTEGER + 1),
      fc.string(),
      fc.constantFrom(null, undefined),
    ), async (ticks) => {
      const calls = { count: 0 }
      const stage = {
        id: StageId('test:property'),
        run: () => Effect.sync(() => { calls.count += 1 }),
      }
      const outcome = await Effect.runPromise(
        Effect.result(
          invokeEffect(Sim.runStagesForTicks, [[stage], ticks]).pipe(Effect.provide(fixedFrameLayer)),
        ),
      )
      assertEffectOutcome(
        'runStagesForTicks',
        () => outcome,
        Schema.Void,
        Sim.RunStagesForTicksFailureSchema,
      )
      expect(calls.count).toBe(0)
    }),
    checks,
  )
})
