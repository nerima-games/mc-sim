import fc from 'fast-check'
import { expect, it } from 'vitest'
import { Effect, Result, Schema } from 'effect'
import * as StatisticsService from '../src/application/statistics-service.js'
import * as Statistics from '../src/domain/statistics.js'
import { assertEffectOutcome, assertResultContract, hostileValue, invoke, invokeEffect, isRecord } from './public-property-helpers.js'

const statisticsInput: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(Statistics.EMPTY_STATISTICS),
  fc.constantFrom<unknown>(null, undefined, Number.NaN),
  fc.record({
    counters: fc.dictionary(fc.string(), hostileValue),
    unlocked: fc.array(hostileValue),
  }),
)

const containsOnlyFiniteNumbers = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(containsOnlyFiniteNumbers)
  if (isRecord(value)) return Object.values(value).every(containsOnlyFiniteNumbers)
  return true
}

const checks = { numRuns: 100 }

it('statistics record decodes every Result branch for arbitrary state, keys, and amounts', () => {
  fc.assert(
    fc.property(fc.tuple(statisticsInput, hostileValue, hostileValue), ([statistics, key, amount]) => {
      const result = invoke(Statistics.record, [statistics, key, amount]) as Result.Result<unknown, unknown>
      assertResultContract(
        'Statistics.record',
        () => result,
        Statistics.StatisticsSchema,
        Statistics.StatisticsRecordFailureSchema,
      )
    }),
    checks,
  )
})

it('statistics zero records decode as a no-op success', () => {
  const zeroRecord = invoke(Statistics.record, [Statistics.EMPTY_STATISTICS, 'test.zero', 0]) as Result.Result<unknown, unknown>
  assertResultContract(
    'Statistics.record zero amount',
    () => zeroRecord,
    Statistics.StatisticsSchema,
    Statistics.StatisticsRecordFailureSchema,
  )
  expect(Result.isSuccess(zeroRecord)).toBe(true)
  if (Result.isSuccess(zeroRecord)) expect(zeroRecord.success).toBe(Statistics.EMPTY_STATISTICS)
})

it('StatisticsService record and snapshot decode their Effect results', async () => {
  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileValue, hostileValue), async ([key, amount]) => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* StatisticsService.makeStatisticsService()
          const recorded = yield* Effect.result(invokeEffect(service.record, [key, amount]))
          const snapshot = yield* Effect.result(service.snapshot)
          return { recorded, snapshot }
        }),
      )
      assertEffectOutcome(
        'StatisticsService.record',
        () => result.recorded,
        StatisticsService.StatisticsServiceRecordSuccessSchema,
        StatisticsService.StatisticsServiceRecordErrorSchema,
      )
      assertEffectOutcome('StatisticsService.snapshot', () => result.snapshot, Statistics.StatisticsSchema, Schema.Never)
      const snapshot = Result.getOrThrow(result.snapshot)
      expect(Statistics.isValidStatistics(snapshot)).toBe(true)
      expect(containsOnlyFiniteNumbers(snapshot)).toBe(true)
    }),
    checks,
  )
})
