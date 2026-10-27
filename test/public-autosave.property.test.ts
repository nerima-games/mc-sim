import { it as effectIt } from '@effect/vitest'
import { Duration, Effect, Exit, Fiber, Ref, Result, Schedule, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { assertEffectOutcome, invokeEffect, hostileValue } from './public-property-helpers.js'

const checks = { numRuns: 32, seed: 0x4155544f }

const assertInvalidIntervalResult = (
  propertyName: string,
  result: Result.Result<unknown, unknown>,
): void => {
  expect(Result.isFailure(result), propertyName).toBe(true)
  if (Result.isFailure(result)) {
    expect(Schema.is(Sim.InvalidAutoSaveIntervalSchema)(result.failure), propertyName + ' runtime Schema').toBe(true)
    const decoded = Schema.decodeUnknownResult(
      Sim.InvalidAutoSaveIntervalSchema,
      { onExcessProperty: 'error' },
    )(result.failure)
    expect(decoded._tag, propertyName + ' failure decoding').toBe('Success')
  }
}

const assertAutoSaveScheduleOutcome = (
  propertyName: string,
  outcome: Result.Result<Schedule.Schedule<number>, unknown>,
): void => {
  assertEffectOutcome(
    propertyName,
    () => outcome,
    Sim.AutoSaveScheduleSchema,
    Sim.InvalidAutoSaveIntervalSchema,
  )
  if (Result.isFailure(outcome)) {
    assertInvalidIntervalResult(propertyName, outcome)
    return
  }
  expect(Schedule.isSchedule(outcome.success), propertyName + ' opaque schedule').toBe(true)
}

const assertAutoSaveDaemonOutcome = (
  propertyName: string,
  outcome: Result.Result<Fiber.Fiber<number, never>, unknown>,
): void => {
  assertEffectOutcome(
    propertyName,
    () => outcome,
    Sim.AutoSaveDaemonSchema,
    Sim.InvalidAutoSaveIntervalSchema,
  )
  if (Result.isFailure(outcome)) {
    assertInvalidIntervalResult(propertyName, outcome)
    return
  }
  expect(Fiber.isFiber(outcome.success), propertyName + ' opaque fiber').toBe(true)
}

const assertInvalidInterval = (interval: unknown): void => {
  const schedule = Effect.runSync(Effect.result(invokeEffect(Sim.autoSaveSchedule, [interval])))
  assertInvalidIntervalResult('autoSaveSchedule', schedule)

  const daemon = Effect.runSync(
    Effect.result(invokeEffect(Sim.startAutoSaveDaemon, [Effect.void, interval, undefined])),
  )
  assertInvalidIntervalResult('startAutoSaveDaemon', daemon)
}

it('autosave schedule constructors return typed failures for hostile intervals', () => {
  const invalidIntervals = [
    null,
    undefined,
    'not-a-duration',
    {},
    Duration.millis(Number.NaN),
    Duration.millis(Number.POSITIVE_INFINITY),
    Duration.millis(-1),
    Duration.millis(Number.MAX_VALUE),
  ] as const

  const defaultSchedule = Effect.runSync(Effect.result(Sim.autoSaveSchedule()))
  assertAutoSaveScheduleOutcome('autoSaveSchedule default', defaultSchedule)
  expect(Result.isSuccess(defaultSchedule)).toBe(true)
  const shortSchedule = Effect.runSync(Effect.result(Sim.autoSaveSchedule(Duration.millis(100))))
  assertAutoSaveScheduleOutcome('autoSaveSchedule custom interval', shortSchedule)
  expect(Result.isSuccess(shortSchedule)).toBe(true)
  const defaultDaemon = Effect.runSync(Effect.result(Sim.startAutoSaveDaemon(Effect.void)))
  assertAutoSaveDaemonOutcome('startAutoSaveDaemon default interval', defaultDaemon)
  expect(Result.isSuccess(defaultDaemon)).toBe(true)
  if (Result.isSuccess(defaultDaemon)) Effect.runSync(Fiber.interrupt(defaultDaemon.success))

  for (const interval of invalidIntervals) assertInvalidInterval(interval)

  fc.assert(fc.property(fc.constantFrom(...invalidIntervals), assertInvalidInterval), checks)
})

it('a hostile persistence effect is recovered and reported without a thrown exception', () => {
  fc.assert(fc.property(hostileValue, (persist) => {
    const statuses: Array<string> = []
    const reporter = (status: 'saving' | 'saved' | 'error') => Effect.sync(() => statuses.push(status))
    const tick = invokeEffect(Sim.performAutoSaveTick, [persist, reporter])
    const exit = Effect.runSyncExit(tick)

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(statuses).toStrictEqual(['saving', 'error'])
  }), checks)
})

effectIt.effect('an opaque autosave daemon waits for its first interval and stops on interruption', () =>
  Effect.gen(function* () {
    const saves = yield* Ref.make(0)
    const result = yield* Effect.result(Sim.startAutoSaveDaemon(
      Ref.update(saves, (count) => count + 1),
      Duration.millis(100),
    ))
    assertAutoSaveDaemonOutcome('startAutoSaveDaemon lifecycle', result)
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result)) throw result.failure
    const fiber = result.success

    yield* Effect.ensuring(
      Effect.gen(function* () {
        yield* TestClock.adjust(Duration.zero)
        expect(yield* Ref.get(saves)).toBe(0)
        yield* TestClock.adjust(Duration.millis(99))
        expect(yield* Ref.get(saves)).toBe(0)
        yield* TestClock.adjust(Duration.millis(1))
        expect(yield* Ref.get(saves)).toBe(1)
      }),
      Fiber.interrupt(fiber),
    )

    yield* TestClock.adjust(Duration.millis(100))
    expect(yield* Ref.get(saves)).toBe(1)
  }),
)

it('hostile reporter values cannot abort a valid persistence tick', () => {
  const invalidReporter = fc.constantFrom<unknown>(
    null,
    undefined,
    {},
    () => undefined,
    () => { throw new Error('reporter failed before returning an Effect') },
  )

  fc.assert(fc.property(invalidReporter, (reporter) => {
    let persisted = false
    const tick = invokeEffect(Sim.performAutoSaveTick, [Effect.sync(() => { persisted = true }), reporter])
    const exit = Effect.runSyncExit(tick)

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(persisted).toBe(true)
  }), checks)
})
