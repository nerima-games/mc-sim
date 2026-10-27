import { Duration, Effect, Exit, Fiber, Result, Schedule } from 'effect'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { invokeEffect, hostileValue } from './public-property-helpers.js'

const checks = { numRuns: 32, seed: 0x4155544f }

const assertInvalidInterval = (interval: unknown): void => {
  const schedule = Effect.runSync(Effect.result(invokeEffect(Sim.autoSaveSchedule, [interval])))
  expect(Result.isFailure(schedule)).toBe(true)
  if (Result.isFailure(schedule)) {
    expect(schedule.failure).toMatchObject({ _tag: 'InvalidAutoSaveInterval' })
  }

  const daemon = Effect.runSync(
    Effect.result(invokeEffect(Sim.startAutoSaveDaemon, [Effect.void, interval, undefined])),
  )
  expect(Result.isFailure(daemon)).toBe(true)
  if (Result.isFailure(daemon)) {
    expect(daemon.failure).toMatchObject({ _tag: 'InvalidAutoSaveInterval' })
  }
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

  expect(Schedule.isSchedule(Effect.runSync(Sim.autoSaveSchedule()))).toBe(true)
  expect(Schedule.isSchedule(Effect.runSync(Sim.autoSaveSchedule(Duration.millis(100))))).toBe(true)
  const defaultDaemon = Effect.runSync(
    Effect.result(Effect.flatMap(Sim.startAutoSaveDaemon(Effect.void), Fiber.interrupt)),
  )
  expect(Result.isSuccess(defaultDaemon)).toBe(true)

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
