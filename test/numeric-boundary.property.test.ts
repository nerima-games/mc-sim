import fc from 'fast-check'
import { expect, it } from 'vitest'
import { Effect, Result, Schema } from 'effect'
import { PositionAxis, position } from '@nerima-games/mc-kernel'
import * as StatisticsService from '../src/application/statistics-service.js'
import * as TimeService from '../src/application/time-service.js'
import * as VitalsService from '../src/application/vitals-service.js'
import * as Statistics from '../src/domain/statistics.js'
import * as Time from '../src/domain/time-of-day.js'
import * as Vitals from '../src/domain/vitals.js'
import * as Wither from '../src/domain/wither.js'
import { BrandErrorSchema } from '../src/domain/inventory.js'
import { assertEffectOutcome, assertResultContract, hostileValue, invoke, invokeEffect, isRecord } from './public-property-helpers.js'

const timeStateInput: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(Time.INITIAL_TIME_STATE),
  fc.record({ ticks: hostileValue, dayLengthTicks: fc.constant(Time.INITIAL_TIME_STATE.dayLengthTicks) }),
)

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

it('vitals normalizer and pure mutators preserve valid state for arbitrary numeric inputs', async () => {
  await fc.assert(
    fc.asyncProperty(hostileValue, async (value) => {
      const normalized = Vitals.normaliseVitals(value)
      expect(Vitals.isValidVitals(normalized)).toBe(true)
      expect(containsOnlyFiniteNumbers(normalized)).toBe(true)

      const operations = [
        invoke(Vitals.applyDamage, [Vitals.SPAWN_VITALS, { amount: value, cause: 'property-test' }]),
        invoke(Vitals.heal, [Vitals.SPAWN_VITALS, value]),
        invoke(Vitals.addExhaustion, [Vitals.SPAWN_VITALS, value]),
        invoke(Vitals.eat, [Vitals.SPAWN_VITALS, value, value]),
        invoke(Vitals.advanceFoodTimer, [Vitals.SPAWN_VITALS, value]),
        invoke(Vitals.addExperience, [Vitals.SPAWN_VITALS, value]),
      ]

      for (const operation of operations) {
        const state = Array.isArray(operation) ? operation[1] : operation
        expect(Vitals.isValidVitals(state)).toBe(true)
        expect(containsOnlyFiniteNumbers(state)).toBe(true)
      }

      const serviceResults = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* VitalsService.makeVitalsService()
          const snapshot = yield* Effect.result(service.snapshot)
          const view = yield* Effect.result(service.view)
          const damage = yield* Effect.result(invokeEffect(service.damage, [{ amount: value, cause: 'property-test' }]))
          const healed = yield* Effect.result(invokeEffect(service.heal, [value]))
          const exhausted = yield* Effect.result(invokeEffect(service.addExhaustion, [value]))
          const eaten = yield* Effect.result(invokeEffect(service.eat, [value, value]))
          const foodTick = yield* Effect.result(invokeEffect(service.advanceFoodTimer, [value]))
          const experience = yield* Effect.result(invokeEffect(service.addExperience, [value]))
          const restored = yield* Effect.result(service.restore(value))
          const respawned = yield* Effect.result(service.respawn)
          const reset = yield* Effect.result(service.reset)
          return {
            snapshot, view, damage, healed, exhausted, eaten, foodTick, experience,
            restored, respawned, reset, finalSnapshot: yield* Effect.result(service.snapshot),
          }
        }),
      )
      assertEffectOutcome('VitalsService.snapshot', () => serviceResults.snapshot, Vitals.VitalsSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.view', () => serviceResults.view, Vitals.VitalsViewSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.damage', () => serviceResults.damage, VitalsService.DamageOutcomeSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.heal', () => serviceResults.healed, Vitals.VitalsSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.addExhaustion', () => serviceResults.exhausted, VitalsService.VitalsServiceVoidSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.eat', () => serviceResults.eaten, VitalsService.VitalsServiceVoidSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.advanceFoodTimer', () => serviceResults.foodTick, Vitals.FoodTickSignalSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.addExperience', () => serviceResults.experience, Vitals.VitalsSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.restore', () => serviceResults.restored, VitalsService.VitalsServiceVoidSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.respawn', () => serviceResults.respawned, VitalsService.VitalsServiceVoidSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.reset', () => serviceResults.reset, VitalsService.VitalsServiceVoidSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.snapshot after reset', () => serviceResults.finalSnapshot, Vitals.VitalsSchema, VitalsService.VitalsServiceNoErrorSchema)
      const finalSnapshot = Result.getOrThrow(serviceResults.finalSnapshot)
      expect(Vitals.isValidVitals(finalSnapshot)).toBe(true)
      expect(containsOnlyFiniteNumbers(finalSnapshot)).toBe(true)
    }),
    checks,
  )
})

it('wither stepping and damage decode every Result branch for arbitrary scalar inputs', () => {
  const initial = Wither.createWither(position(PositionAxis(0), PositionAxis(64), PositionAxis(0)))
  fc.assert(
    fc.property(hostileValue, (value) => {
      const stepped = invoke(Wither.stepWither, [initial, value]) as Result.Result<unknown, unknown>
      assertResultContract('Wither.stepWither', () => stepped, Wither.WitherStepSchema, Wither.WitherStepFailureSchema)

      const damaged = invoke(Wither.damageWither, [initial, value, 'melee']) as Result.Result<unknown, unknown>
      assertResultContract(
        'Wither.damageWither',
        () => damaged,
        Wither.WitherDamageResultSchema,
        Wither.WitherStepFailureSchema,
      )
    }),
    checks,
  )
})
