import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  makeStatisticsService,
  StatisticsService,
  StatisticsServiceLayer,
} from '../src/application/statistics-service'
import {
  counterOf,
  EMPTY_STATISTICS,
  isUnlocked,
  isValidStatistics,
  normaliseStatistics,
  record,
  unlock,
  type Statistics,
} from '../src/domain/statistics'

describe('counting', () => {
  it.effect('a counter starts at zero and is never undefined', () =>
    Effect.sync(() => {
      expect(counterOf(EMPTY_STATISTICS, 'blocks.mined')).toBe(0)
    }),
  )

  it.effect('record defaults to one and accumulates', () =>
    Effect.sync(() => {
      const mined = record(record(record(EMPTY_STATISTICS, 'blocks.mined'), 'blocks.mined'), 'blocks.mined', 8)

      expect(counterOf(mined, 'blocks.mined')).toBe(10)
    }),
  )

  it.effect('mc-sim never interprets a key: any string counts, and none is special', () =>
    Effect.sync(() => {
      // The point of `StatisticKey = string`. mx-gameplay can start counting
      // boats without a change here — and mc-sim cannot tell that
      // `blocks.mined` and `blocks.mined.stone` are related, which is the
      // accepted cost stated in the module header.
      const stats = record(record(EMPTY_STATISTICS, 'blocks.mined.stone'), 'mobs.killed.creeper')

      expect(counterOf(stats, 'blocks.mined.stone')).toBe(1)
      expect(counterOf(stats, 'mobs.killed.creeper')).toBe(1)
      expect(counterOf(stats, 'blocks.mined')).toBe(0)
    }),
  )

  it.effect('a counter floors at zero rather than going negative', () =>
    Effect.sync(() => {
      const overSubtracted = record(record(EMPTY_STATISTICS, 'deaths', 2), 'deaths', -5)

      expect(counterOf(overSubtracted, 'deaths')).toBe(0)
    }),
  )

  it.effect('REGRESSION: a NaN amount must not disable a counter for the rest of the world', () =>
    Effect.sync(() => {
      // `10 + NaN` is `NaN`, and every later `NaN + 1` is `NaN` too — one bad
      // call and the tally never moves again, silently, for the life of the
      // save. The same shape as the immortality defect in `domain/vitals.ts`.
      const stats = record(EMPTY_STATISTICS, 'blocks.mined', 10)
      const poisoned = record(stats, 'blocks.mined', Number.NaN)

      expect(counterOf(poisoned, 'blocks.mined')).toBe(10)
      expect(counterOf(record(poisoned, 'blocks.mined'), 'blocks.mined')).toBe(11)
    }),
  )

  it.effect('an infinite amount is refused too — a tally has no direction to follow', () =>
    Effect.sync(() => {
      const stats = record(EMPTY_STATISTICS, 'blocks.mined', Number.POSITIVE_INFINITY)

      expect(counterOf(stats, 'blocks.mined')).toBe(0)
    }),
  )
})

describe('achievements are recorded, never decided', () => {
  it.effect('unlock is idempotent, in value and in identity', () =>
    Effect.sync(() => {
      // An achievement stage re-evaluating a registry every frame would append
      // once per frame otherwise, and the first symptom would be a save file
      // growing without bound rather than a wrong screen.
      const once = unlock(EMPTY_STATISTICS, 'time-to-mine')
      const twice = unlock(once, 'time-to-mine')

      expect(twice.unlocked).toEqual(['time-to-mine'])
      expect(twice).toBe(once)
    }),
  )

  it.effect('unlock order is kept, because a toast needs to know what was just earned', () =>
    Effect.sync(() => {
      const earned = unlock(unlock(unlock(EMPTY_STATISTICS, 'a'), 'b'), 'c')

      expect(earned.unlocked).toEqual(['a', 'b', 'c'])
      expect(isUnlocked(earned, 'b')).toBe(true)
      expect(isUnlocked(earned, 'd')).toBe(false)
    }),
  )

  it.effect('no registry and no predicate live here', () =>
    Effect.sync(() => {
      // The reference evaluates `isUnlocked: (stats) => boolean` entries over a
      // registry (achievement/achievement.ts:24-44). mc-sim holds neither: a
      // record with a hundred blocks mined has unlocked nothing until somebody
      // says so.
      const mined = record(EMPTY_STATISTICS, 'blocks.mined', 100)

      expect(mined.unlocked).toEqual([])
    }),
  )
})

describe('normaliseStatistics is total over what a save can contain', () => {
  it.effect('malformed shapes become records isValidStatistics accepts', () =>
    Effect.sync(() => {
      const malformed: ReadonlyArray<Statistics> = [
        { counters: null as unknown as Record<string, number>, unlocked: [] },
        { counters: {}, unlocked: 'time-to-mine' as unknown as ReadonlyArray<string> },
        { counters: { mined: Number.NaN }, unlocked: [] },
        { counters: { mined: Number.POSITIVE_INFINITY }, unlocked: [] },
        { counters: { mined: -4 }, unlocked: [] },
        { counters: { mined: '9' as unknown as number }, unlocked: [] },
        { counters: {}, unlocked: ['a', 'a', 'a'] },
        { counters: {}, unlocked: [null as unknown as string, 'a'] },
      ]

      for (const stats of malformed) {
        expect(isValidStatistics(normaliseStatistics(stats))).toBe(true)
      }
    }),
  )

  it.effect('a non-string id is DROPPED, not coerced', () =>
    Effect.sync(() => {
      // Coercing `null` to `'null'` would unlock an achievement that does not
      // exist and that no screen could remove. A vital has a meaningful nearest
      // legal value; an identity does not.
      const repaired = normaliseStatistics({
        counters: {},
        unlocked: [null as unknown as string, 'time-to-mine', 7 as unknown as string],
      })

      expect(repaired.unlocked).toEqual(['time-to-mine'])
    }),
  )

  it.effect('duplicates that a bad writer produced are collapsed', () =>
    Effect.sync(() => {
      const repaired = normaliseStatistics({ counters: {}, unlocked: ['a', 'b', 'a'] })

      expect(repaired.unlocked).toEqual(['a', 'b'])
    }),
  )
})

describe('StatisticsService', () => {
  it.effect('records and reads through the Ref', () =>
    Effect.gen(function* () {
      const statistics = yield* makeStatisticsService()

      yield* statistics.record('blocks.mined')
      yield* statistics.record('blocks.mined', 4)
      yield* statistics.unlock('time-to-mine')

      expect(yield* statistics.counterOf('blocks.mined')).toBe(5)
      expect(yield* statistics.isUnlocked('time-to-mine')).toBe(true)
      expect(yield* statistics.isUnlocked('acquire-hardware')).toBe(false)
    }),
  )

  it.effect('a hundred concurrent unlocks of the same id append it once', () =>
    Effect.gen(function* () {
      const statistics = yield* makeStatisticsService()

      yield* Effect.all(
        Array.from({ length: 100 }, () => statistics.unlock('time-to-mine')),
        { concurrency: 'unbounded' },
      )

      expect((yield* statistics.snapshot).unlocked).toEqual(['time-to-mine'])
    }),
  )

  it.effect('a hundred concurrent records lose none of them', () =>
    Effect.gen(function* () {
      const statistics = yield* makeStatisticsService()

      yield* Effect.all(
        Array.from({ length: 100 }, () => statistics.record('blocks.mined')),
        { concurrency: 'unbounded' },
      )

      expect(yield* statistics.counterOf('blocks.mined')).toBe(100)
    }),
  )

  it.effect('a layer built from a corrupt record is repaired on the way in', () =>
    Effect.gen(function* () {
      const restored = yield* Effect.flatMap(StatisticsService, (service) => service.snapshot).pipe(
        Effect.provide(
          StatisticsServiceLayer({
            counters: { mined: Number.NaN },
            unlocked: ['a', 'a'],
          }),
        ),
      )

      expect(isValidStatistics(restored)).toBe(true)
      expect(restored.unlocked).toEqual(['a'])
    }),
  )

  it.effect('reset empties the record, so a second world inherits nothing (DN-09)', () =>
    Effect.gen(function* () {
      const statistics = yield* makeStatisticsService()

      yield* statistics.record('deaths', 12)
      yield* statistics.unlock('time-to-mine')
      yield* statistics.reset

      expect(yield* statistics.snapshot).toEqual(EMPTY_STATISTICS)
    }),
  )
})
