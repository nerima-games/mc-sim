import fc from 'fast-check'
import { AchievementIdSchema } from '@nerima-games/mc-kernel'
import { Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { finiteTree, hostileNumber, hostileValue, isRecord, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 40, seed: 0x53544154 }

const hostileStatistics: fc.Arbitrary<unknown> = fc.oneof(
  unknownValue,
  fc.record({
    counters: fc.oneof(
      unknownValue,
      fc.dictionary(fc.string({ maxLength: 12 }), hostileNumber, { maxKeys: 6 }),
    ),
    unlocked: fc.oneof(unknownValue, fc.array(hostileValue, { maxLength: 6 })),
  }),
)

const assertValidStatistics = (value: unknown): void => {
  expect(finiteTree(value)).toBe(true)
  expect(Sim.isValidStatistics(value)).toBe(true)
  expect(isRecord(value)).toBe(true)
}

it('statistics normalization repairs hostile records without mutating their input', () => {
  fc.assert(
    fc.property(hostileStatistics, (input) => {
      expect(typeof Sim.isValidStatistics(input)).toBe('boolean')
      const before = JSON.stringify(input)
      const normalized = Sim.normaliseStatistics(input)
      assertValidStatistics(normalized)
      expect(JSON.stringify(input)).toBe(before)
      expect(new Set(normalized.unlocked).size).toBe(normalized.unlocked.length)
    }),
    checks,
  )
})

it('statistics record returns typed failures or valid finite results and leaves its input unchanged', () => {
  const amount = fc.oneof(
    hostileValue,
    fc.constantFrom<unknown>(0, 1, -2, Number.MAX_VALUE),
  )
  const key = fc.oneof(fc.string({ maxLength: 12 }), hostileValue)

  fc.assert(
    fc.property(fc.tuple(hostileStatistics, key, amount), ([input, keyValue, amountValue]) => {
      const statistics = Sim.normaliseStatistics(input)
      const before = JSON.stringify(statistics)
      const outcome = Sim.record(statistics, keyValue as never, amountValue)
      if (Result.isFailure(outcome)) {
        expect(outcome.failure._tag).toBe('StatisticsRecordFailure')
      } else {
        assertValidStatistics(outcome.success)
      }
      expect(JSON.stringify(statistics)).toBe(before)
    }),
    checks,
  )
})

it('counterOf handles hostile string keys with a finite non-negative count', () => {
  const statisticKey = fc.oneof(
    fc.string({ maxLength: 64 }),
    fc.constantFrom('__proto__', 'constructor', 'toString', '', 'blocks.mined'),
  )

  fc.assert(
    fc.property(fc.tuple(hostileStatistics, statisticKey), ([input, key]) => {
      const statistics = Sim.normaliseStatistics(input)
      const count = Sim.counterOf(statistics, key)

      expect(Number.isFinite(count)).toBe(true)
      expect(count).toBeGreaterThanOrEqual(0)
      if (Object.hasOwn(statistics.counters, key)) {
        expect(count).toBe(statistics.counters[key])
      } else {
        expect(count).toBe(0)
      }
    }),
    checks,
  )
})

it('isUnlocked and unlock stay valid and idempotent for generated AchievementIds', () => {
  const achievementId = fc.string({ minLength: 1, maxLength: 48 }).map(
    Schema.decodeUnknownSync(AchievementIdSchema),
  )

  fc.assert(
    fc.property(fc.tuple(hostileStatistics, achievementId), ([input, id]) => {
      const statistics = Sim.normaliseStatistics(input)
      const before = JSON.stringify(statistics)
      const wasUnlocked = Sim.isUnlocked(statistics, id)
      const unlocked = Sim.unlock(statistics, id)

      expect(Sim.isUnlocked(statistics, id)).toBe(wasUnlocked)
      expect(JSON.stringify(statistics)).toBe(before)
      expect(Sim.isValidStatistics(unlocked)).toBe(true)
      expect(finiteTree(unlocked)).toBe(true)
      expect(Sim.isUnlocked(unlocked, id)).toBe(true)
      if (wasUnlocked) {
        expect(unlocked).toBe(statistics)
      } else {
        expect(unlocked.unlocked).toHaveLength(statistics.unlocked.length + 1)
        expect(unlocked.unlocked.slice(0, -1)).toEqual(statistics.unlocked)
        expect(unlocked.unlocked.at(-1)).toBe(id)
      }
      expect(Sim.unlock(unlocked, id)).toBe(unlocked)
    }),
    checks,
  )
})
