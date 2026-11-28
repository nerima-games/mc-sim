import { describe, expect, it } from '@effect/vitest'
import {
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  MonotonicTimeSecs,
  NonNegativeTickCount,
  SimulationTick,
  StageId,
} from '@nerima-games/mc-kernel'
import { Effect, Ref, Result } from 'effect'
import { makeTickService } from '../src/application/tick-service'
import { runStagesForTicks } from '../src/stages/tick-registration'

const FixedFrameLayer = FixedClockLayer({
  monotonicSecs: MonotonicTimeSecs(1_000),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
})

describe('tick service', () => {
  it.effect('accumulates elapsed time and returns ticks with the render fraction', () =>
    Effect.gen(function* () {
      const ticks = yield* makeTickService()
      const first = yield* ticks.advanceFrame(DeltaTimeSecs(0.025))
      const second = yield* ticks.advanceFrame(DeltaTimeSecs(0.025))

      expect(first.ticks).toBe(0)
      expect(first.interpolationFraction).toBeCloseTo(0.5)
      expect(second.ticks).toBe(1)
      expect(second.state.tick).toBe(SimulationTick(1))
      expect(second.interpolationFraction).toBe(0)
    }),
  )

  it.effect('uses the existing five-tick catch-up limit', () =>
    Effect.gen(function* () {
      const ticks = yield* makeTickService()
      const frame = yield* ticks.advanceFrame(DeltaTimeSecs(1))

      expect(frame.ticks).toBe(5)
      expect(frame.overloaded).toBe(true)
      expect(frame.state.accumulator).toBe(0)
    }),
  )

  it.effect('honours a configured catch-up limit below the default', () =>
    Effect.gen(function* () {
      const ticks = yield* makeTickService(SimulationTick(0), 1)

      const withinLimit = yield* ticks.advanceFrame(DeltaTimeSecs(0.05))
      expect(withinLimit.ticks).toBe(1)
      expect(withinLimit.overloaded).toBe(false)

      const beyondLimit = yield* ticks.advanceFrame(DeltaTimeSecs(1))
      expect(beyondLimit.ticks).toBe(1)
      expect(beyondLimit.overloaded).toBe(true)
      expect(beyondLimit.state.tick).toBe(SimulationTick(2))
      expect(beyondLimit.state.maxCatchUpTicks).toBe(1)
    }),
  )

  it.effect('honours a configured catch-up limit above the default', () =>
    Effect.gen(function* () {
      const ticks = yield* makeTickService(SimulationTick(0), 8)
      const frame = yield* ticks.advanceFrame(DeltaTimeSecs(1))

      expect(frame.ticks).toBe(8)
      expect(frame.overloaded).toBe(true)
    }),
  )

  it.effect('fails advanceFrame for an invalid catch-up limit instead of falling back to the default', () =>
    Effect.gen(function* () {
      for (const invalid of [-1, Number.NaN]) {
        const ticks = yield* makeTickService(SimulationTick(0), invalid)
        const result = yield* Effect.result(ticks.advanceFrame(DeltaTimeSecs(0.05)))
        expect(Result.isFailure(result)).toBe(true)
      }
    }),
  )

  it.effect('pauses progression and clears the remainder when resuming', () =>
    Effect.gen(function* () {
      const ticks = yield* makeTickService()
      yield* ticks.advanceFrame(DeltaTimeSecs(0.025))
      yield* ticks.pause

      const paused = yield* ticks.advanceFrame(DeltaTimeSecs(1))
      expect(paused.ticks).toBe(0)
      expect(paused.interpolationFraction).toBeCloseTo(0.5)

      yield* ticks.resume
      const resumed = yield* ticks.advanceFrame(DeltaTimeSecs(0.025))
      expect(resumed.ticks).toBe(0)
      expect(resumed.interpolationFraction).toBeCloseTo(0.5)
    }),
  )

  it.effect('runs resolved registrations in order for each tick', () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const first = {
        id: StageId('test:first'),
        run: (delta: DeltaTimeSecs) =>
          Ref.update(calls, (current) => [...current, `first:${Number(delta)}`]),
      }
      const second = {
        id: StageId('test:second'),
        after: [first.id],
        run: (delta: DeltaTimeSecs) =>
          Ref.update(calls, (current) => [...current, `second:${Number(delta)}`]),
      }
      const tickService = yield* makeTickService()
      const frame = yield* tickService.advanceFrame(DeltaTimeSecs(0.1))

      expect(frame.ticks).toBe(NonNegativeTickCount(2))
      yield* runStagesForTicks([first, second], frame.ticks).pipe(
        Effect.provide(FixedFrameLayer),
      )

      expect(yield* Ref.get(calls)).toStrictEqual([
        'first:0.05',
        'second:0.05',
        'first:0.05',
        'second:0.05',
      ])
    }),
  )

  it.effect('does not call registrations for zero ticks and rejects counts above the limit', () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const stage = {
        id: StageId('test:count'),
        run: () => Ref.update(calls, (count) => count + 1),
      }

      yield* runStagesForTicks([stage], NonNegativeTickCount(0)).pipe(
        Effect.provide(FixedFrameLayer),
      )
      expect(yield* Ref.get(calls)).toBe(0)

      const invalid = yield* Effect.result(
        runStagesForTicks([stage], NonNegativeTickCount(6)).pipe(Effect.provide(FixedFrameLayer)),
      )
      expect(Result.isFailure(invalid)).toBe(true)
      if (Result.isFailure(invalid)) expect(invalid.failure._tag).toBe('TickCountExceedsCatchUpLimit')
      expect(yield* Ref.get(calls)).toBe(0)
    }),
  )
})
