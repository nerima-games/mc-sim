import fc from 'fast-check'
import { expect, it } from 'vitest'
import { Effect, Result, Schema } from 'effect'
import { NonNegativeTickCount } from '@nerima-games/mc-kernel'
import * as TimeService from '../src/application/time-service.js'
import * as Time from '../src/domain/time-of-day.js'
import { BrandErrorSchema } from '../src/domain/inventory.js'
import { assertEffectOutcome, assertResultContract, hostileValue, invoke, invokeEffect, isRecord } from './public-property-helpers.js'

const timeStateInput: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(Time.INITIAL_TIME_STATE),
  fc.record({ ticks: hostileValue, dayLengthTicks: fc.constant(Time.INITIAL_TIME_STATE.dayLengthTicks) }),
)

const containsOnlyFiniteNumbers = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(containsOnlyFiniteNumbers)
  if (isRecord(value)) return Object.values(value).every(containsOnlyFiniteNumbers)
  return true
}

const checks = { numRuns: 100 }

it('time advance adds generated simulation ticks using absolute tick arithmetic', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1_000_000 }),
      fc.integer({
        min: Time.MIN_DAY_LENGTH_SECS * Time.TICKS_PER_SECOND,
        max: Time.MAX_DAY_LENGTH_SECS * Time.TICKS_PER_SECOND,
      }),
      fc.integer({ min: 0, max: 1_000_000 }),
      (startingTicks, dayLengthTicks, elapsedTicks) => {
        const start = Time.normaliseTimeState({ ticks: startingTicks, dayLengthTicks })
        const outcome = Time.advance(start, NonNegativeTickCount(elapsedTicks))
        const expectedTicks = startingTicks + elapsedTicks

        expect(Result.isSuccess(outcome)).toBe(true)
        if (Result.isSuccess(outcome)) {
          expect(outcome.success.ticks).toBe(expectedTicks)
          expect(outcome.success.dayLengthTicks).toBe(dayLengthTicks)
          expect(Time.timeOfDay(outcome.success)).toBeCloseTo((expectedTicks % dayLengthTicks) / dayLengthTicks, 12)
        }
      },
    ),
    checks,
  )
})

it('time advance decodes every Result branch for arbitrary states and tick counts', () => {
  fc.assert(
    fc.property(fc.tuple(timeStateInput, hostileValue), ([state, elapsedTicks]) => {
      const result = invoke(Time.advance, [state, elapsedTicks]) as Result.Result<unknown, unknown>
      assertResultContract('Time.advance', () => result, Time.TimeStateSchema, BrandErrorSchema)
    }),
    checks,
  )
})

it('TimeService advance decodes its Effect result and preserves a valid snapshot for arbitrary tick counts', async () => {
  await fc.assert(
    fc.asyncProperty(hostileValue, async (elapsedTicks) => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* TimeService.makeTimeService()
          const advanced = yield* Effect.result(invokeEffect(service.advance, [elapsedTicks]))
          const snapshot = yield* Effect.result(service.snapshot)
          return { advanced, snapshot }
        }),
      )
      assertEffectOutcome('TimeService.advance', () => result.advanced, Schema.Undefined, BrandErrorSchema)
      assertEffectOutcome('TimeService.snapshot', () => result.snapshot, Time.TimeStateSchema, Schema.Never)
      const snapshot = Result.getOrThrow(result.snapshot)
      expect(Time.isValidTimeState(snapshot)).toBe(true)
      expect(containsOnlyFiniteNumbers(snapshot)).toBe(true)
    }),
    checks,
  )
})
