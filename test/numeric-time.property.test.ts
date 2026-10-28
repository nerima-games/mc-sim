import fc from 'fast-check'
import { expect, it } from 'vitest'
import { Effect, Result, Schema } from 'effect'
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

it('time advance decodes every Result branch for arbitrary states and deltas', () => {
  fc.assert(
    fc.property(fc.tuple(timeStateInput, hostileValue), ([state, delta]) => {
      const result = invoke(Time.advance, [state, delta]) as Result.Result<unknown, unknown>
      assertResultContract('Time.advance', () => result, Time.TimeStateSchema, BrandErrorSchema)
    }),
    checks,
  )
})

it('TimeService advance decodes its Effect result and preserves a valid snapshot for arbitrary deltas', async () => {
  await fc.assert(
    fc.asyncProperty(hostileValue, async (delta) => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* TimeService.makeTimeService()
          const advanced = yield* Effect.result(invokeEffect(service.advance, [delta]))
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
