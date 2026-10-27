import fc from 'fast-check'
import { expect, it } from 'vitest'
import { Effect } from 'effect'
import * as StatisticsService from '../src/application/statistics-service.js'
import * as TimeService from '../src/application/time-service.js'
import * as Statistics from '../src/domain/statistics.js'
import * as Time from '../src/domain/time-of-day.js'
import * as Vitals from '../src/domain/vitals.js'
import * as VitalsService from '../src/application/vitals-service.js'

const hostileValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.double(),
  fc.string(),
  fc.boolean(),
  fc.constantFrom<unknown>(
    null,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
    -1,
    0,
  ),
)

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const containsOnlyFiniteNumbers = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(containsOnlyFiniteNumbers)
  if (isRecord(value)) return Object.values(value).every(containsOnlyFiniteNumbers)
  return true
}

const failureValue = (value: Readonly<Record<string, unknown>>): unknown =>
  value['failure'] ?? value['error']

const successValue = (value: Readonly<Record<string, unknown>>): unknown =>
  value['success'] ?? value['value']

const isTypedFailure = (value: unknown): boolean => {
  if (!isRecord(value) || value['_tag'] !== 'Failure') return false
  const failure = failureValue(value)
  return isRecord(failure) && typeof failure['_tag'] === 'string'
}

const isSafeResult = (value: unknown, isValidSuccess: (success: unknown) => boolean): boolean => {
  if (!isRecord(value)) return false
  if (value['_tag'] === 'Failure') return isTypedFailure(value)
  return value['_tag'] === 'Success' &&
    containsOnlyFiniteNumbers(successValue(value)) &&
    isValidSuccess(successValue(value))
}

const invoke = (operation: (...args: never[]) => unknown, args: ReadonlyArray<unknown>): unknown =>
  Reflect.apply(operation, undefined, args)

const invokeEffect = <A, E>(
  operation: (...args: never[]) => Effect.Effect<A, E>,
  args: ReadonlyArray<unknown>,
): Effect.Effect<A, E> => Reflect.apply(operation, undefined, args)

const isValidTimeState = (value: unknown): boolean => invoke(Time.isValidTimeState, [value]) === true

const checks = { numRuns: 100 }

it('time advance returns a typed failure or a valid finite clock for arbitrary deltas', () => {
  fc.assert(
    fc.property(hostileValue, (delta) => {
      const result = invoke(Time.advance, [Time.INITIAL_TIME_STATE, delta])
      expect(isSafeResult(result, isValidTimeState)).toBe(true)
    }),
    checks,
  )
})

it('TimeService advance preserves a valid snapshot for arbitrary deltas', async () => {
  await fc.assert(
    fc.asyncProperty(hostileValue, async (delta) => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* TimeService.makeTimeService()
          const advanced = yield* Effect.result(invokeEffect(service.advance, [delta]))
          const snapshot = yield* service.snapshot
          return { advanced, snapshot }
        }),
      )
      expect(isSafeResult(result.advanced, () => true)).toBe(true)
      expect(Time.isValidTimeState(result.snapshot)).toBe(true)
      expect(containsOnlyFiniteNumbers(result.snapshot)).toBe(true)
    }),
    checks,
  )
})

it('statistics record returns a typed failure or a valid finite snapshot for arbitrary keys and amounts', () => {
  fc.assert(
    fc.property(fc.tuple(hostileValue, hostileValue), ([key, amount]) => {
      const result = invoke(Statistics.record, [Statistics.EMPTY_STATISTICS, key, amount])
      expect(isSafeResult(result, Statistics.isValidStatistics)).toBe(true)
    }),
    checks,
  )
})

it('StatisticsService record returns a typed failure or preserves a valid finite snapshot', async () => {
  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileValue, hostileValue), async ([key, amount]) => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* StatisticsService.makeStatisticsService()
          const recorded = yield* Effect.result(invokeEffect(service.record, [key, amount]))
          const snapshot = yield* service.snapshot
          return { recorded, snapshot }
        }),
      )
      expect(isSafeResult(result.recorded, () => true)).toBe(true)
      expect(Statistics.isValidStatistics(result.snapshot)).toBe(true)
      expect(containsOnlyFiniteNumbers(result.snapshot)).toBe(true)
    }),
    checks,
  )
})

it('vitals normalization, mutators, and restore never return invalid or non-finite state', async () => {
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
          const damage = yield* Effect.result(
            invokeEffect(service.damage, [{ amount: value, cause: 'property-test' }]),
          )
          const healed = yield* Effect.result(invokeEffect(service.heal, [value]))
          const exhausted = yield* Effect.result(invokeEffect(service.addExhaustion, [value]))
          const eaten = yield* Effect.result(invokeEffect(service.eat, [value, value]))
          const foodTick = yield* Effect.result(invokeEffect(service.advanceFoodTimer, [value]))
          const experience = yield* Effect.result(invokeEffect(service.addExperience, [value]))
          yield* service.restore(value)
          return { damage, healed, exhausted, eaten, foodTick, experience, snapshot: yield* service.snapshot }
        }),
      )
      expect(isSafeResult(serviceResults.damage, (success) =>
        isRecord(success) && Vitals.isValidVitals(success['vitals']),
      )).toBe(true)
      expect(isSafeResult(serviceResults.healed, Vitals.isValidVitals)).toBe(true)
      expect(isSafeResult(serviceResults.exhausted, (success) => success === undefined)).toBe(true)
      expect(isSafeResult(serviceResults.eaten, (success) => success === undefined)).toBe(true)
      expect(isSafeResult(serviceResults.foodTick, (success) =>
        success === 'none' || success === 'regen' || success === 'starve',
      )).toBe(true)
      expect(isSafeResult(serviceResults.experience, Vitals.isValidVitals)).toBe(true)
      expect(Vitals.isValidVitals(serviceResults.snapshot)).toBe(true)
      expect(containsOnlyFiniteNumbers(serviceResults.snapshot)).toBe(true)
    }),
    checks,
  )
})
