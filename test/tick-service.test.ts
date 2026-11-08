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
