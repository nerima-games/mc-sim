import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import { AchievementIdSchema } from '@nerima-games/mc-kernel'
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

const achievementId = Schema.decodeUnknownSync(AchievementIdSchema)

const recorded = (statistics: Statistics, key: string, amount?: unknown): Statistics =>
  Result.getOrThrow(record(statistics, key, amount))

describe('counting', () => {
  it.effect('a counter starts at zero and is never undefined', () =>
    Effect.sync(() => {
      expect(counterOf(EMPTY_STATISTICS, 'blocks.mined')).toBe(0)
      expect(Reflect.apply(counterOf, undefined, [{ counters: { 'blocks.mined': Number.POSITIVE_INFINITY }, unlocked: [] }, 'blocks.mined'])).toBe(0)

      const incremented = recorded(EMPTY_STATISTICS, 'blocks.mined', 1)
      expect(counterOf(incremented, 'blocks.mined')).toBe(1)
    }),
  )

  it.effect('record defaults to one and accumulates', () =>
    Effect.sync(() => {
      const mined = recorded(recorded(recorded(EMPTY_STATISTICS, 'blocks.mined'), 'blocks.mined'), 'blocks.mined', 8)

      expect(counterOf(mined, 'blocks.mined')).toBe(10)
    }),
  )

  it.effect('mc-sim never interprets a key: any string counts, and none is special', () =>
    Effect.sync(() => {
      // The point of `StatisticKey = string`. mx-gameplay can start counting
      // boats without a change here — and mc-sim cannot tell that
      // `blocks.mined` and `blocks.mined.stone` are related, which is the
      // accepted cost stated in the module header.
      const stats = recorded(recorded(EMPTY_STATISTICS, 'blocks.mined.stone'), 'mobs.killed.creeper')

      expect(counterOf(stats, 'blocks.mined.stone')).toBe(1)
      expect(counterOf(stats, 'mobs.killed.creeper')).toBe(1)
      expect(counterOf(stats, 'blocks.mined')).toBe(0)
    }),
  )

  it.effect('a counter floors at zero rather than going negative', () =>
    Effect.sync(() => {
      const overSubtracted = recorded(recorded(EMPTY_STATISTICS, 'deaths', 2), 'deaths', -5)

      expect(counterOf(overSubtracted, 'deaths')).toBe(0)
    }),
  )

  it.effect('non-finite and null amounts fail without changing the counter', () =>
    Effect.sync(() => {
      const stats = recorded(EMPTY_STATISTICS, 'blocks.mined', 10)
      const nan = record(stats, 'blocks.mined', Number.NaN)
      const infinite = record(stats, 'blocks.mined', Number.POSITIVE_INFINITY)
      const nullAmount = record(stats, 'blocks.mined', null)

      expect(nan).toMatchObject({ _tag: 'Failure', failure: { _tag: 'StatisticsRecordFailure' } })
      expect(infinite).toMatchObject({ _tag: 'Failure', failure: { _tag: 'StatisticsRecordFailure' } })
      expect(nullAmount).toMatchObject({ _tag: 'Failure', failure: { _tag: 'StatisticsRecordFailure' } })
      expect(counterOf(stats, 'blocks.mined')).toBe(10)
    }),
  )

  it.effect('finite additions that overflow fail and preserve the prior record', () =>
    Effect.sync(() => {
      const stats: Statistics = { counters: { 'blocks.mined': Number.MAX_VALUE }, unlocked: [] }
      const overflow = record(stats, 'blocks.mined', Number.MAX_VALUE)

      expect(overflow).toMatchObject({ _tag: 'Failure', failure: { _tag: 'StatisticsRecordFailure' } })
      expect(stats.counters['blocks.mined']).toBe(Number.MAX_VALUE)
    }),
  )
})

describe('achievements are recorded, never decided', () => {
  it.effect('unlock is idempotent, in value and in identity', () =>
    Effect.sync(() => {
      // An achievement stage re-evaluating a registry every frame would append
      // once per frame otherwise, and the first symptom would be a save file
      // growing without bound rather than a wrong screen.
      const once = unlock(EMPTY_STATISTICS, achievementId('minecraft:story/mine_stone'))
      const twice = unlock(once, achievementId('minecraft:story/mine_stone'))

      expect(twice.unlocked).toEqual(['minecraft:story/mine_stone'])
      expect(twice).toBe(once)
    }),
  )

  it.effect('unlock order is kept, because a toast needs to know what was just earned', () =>
    Effect.sync(() => {
      const earned = unlock(
        unlock(
          unlock(EMPTY_STATISTICS, achievementId('minecraft:story/mine_stone')),
          achievementId('minecraft:story/obtain_armor'),
        ),
        achievementId('minecraft:story/form_obsidian'),
      )

      expect(earned.unlocked).toEqual([
        'minecraft:story/mine_stone',
        'minecraft:story/obtain_armor',
        'minecraft:story/form_obsidian',
      ])
      expect(isUnlocked(earned, achievementId('minecraft:story/obtain_armor'))).toBe(true)
      expect(isUnlocked(earned, achievementId('minecraft:story/mine_diamond'))).toBe(false)
    }),
  )

  it.effect('no registry and no predicate live here', () =>
    Effect.sync(() => {
      // The reference evaluates `isUnlocked: (stats) => boolean` entries over a
      // registry (achievement/achievement.ts:24-44). mc-sim holds neither: a
      // record with a hundred blocks mined has unlocked nothing until somebody
      // says so.
      const mined = recorded(EMPTY_STATISTICS, 'blocks.mined', 100)

      expect(mined.unlocked).toEqual([])
    }),
  )
})

describe('normaliseStatistics is total over what a save can contain', () => {
  it.effect('non-record save values normalize to empty statistics', () =>
    Effect.sync(() => {
      expect(normaliseStatistics(null)).toStrictEqual({ counters: {}, unlocked: [] })
      expect(normaliseStatistics('corrupt statistics')).toStrictEqual({ counters: {}, unlocked: [] })
    }),
  )

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
        { counters: {}, unlocked: ['', 'a'] },
        { counters: {}, unlocked: [null as unknown as string, 'a'] },
      ]

      for (const stats of malformed) {
        expect(isValidStatistics(normaliseStatistics(stats))).toBe(true)
      }
    }),
  )

  it.effect('an id rejected by the kernel schema is DROPPED, not coerced', () =>
    Effect.sync(() => {
      // Save compatibility keeps IDs encoded as strings, so the event schema
      // must validate them before they enter the branded application model.
      const repaired = normaliseStatistics({
        counters: {},
        unlocked: [
          '',
          null as unknown as string,
          'minecraft:story/obtain_obsidian',
          'minecraft:story/form_obsidian',
          7 as unknown as string,
        ],
      })

      expect(repaired.unlocked).toEqual(['minecraft:story/form_obsidian'])
    }),
  )

  it.effect('duplicates that a bad writer produced are collapsed', () =>
    Effect.sync(() => {
      const repaired = normaliseStatistics({
        counters: {},
        unlocked: [
          'minecraft:story/form_obsidian',
          'minecraft:story/obtain_armor',
          'minecraft:story/form_obsidian',
        ],
      })

      expect(repaired.unlocked).toEqual(['minecraft:story/form_obsidian', 'minecraft:story/obtain_armor'])
    }),
  )

  it.effect('a genuinely positive counter survives repair rather than only the broken ones', () =>
    Effect.sync(() => {
      // Every case above is a counter being DROPPED. Without this one, nothing
      // proves a legitimate value is actually kept rather than the function
      // happening to drop everything it is ever handed.
      const repaired = normaliseStatistics({ counters: { 'blocks.mined': 5 }, unlocked: [] })

      expect(repaired.counters).toEqual({ 'blocks.mined': 5 })
    }),
  )
})

describe('isValidStatistics rejects what normaliseStatistics repairs', () => {
  it.effect('a non-object counters map is invalid', () =>
    Effect.sync(() => {
      expect(isValidStatistics({ counters: null as unknown as Record<string, number>, unlocked: [] })).toBe(
        false,
      )
      expect(
        isValidStatistics({ counters: 'nope' as unknown as Record<string, number>, unlocked: [] }),
      ).toBe(false)
    }),
  )

  it.effect('an unlocked that is not an array is invalid', () =>
    Effect.sync(() => {
      expect(
        isValidStatistics({ counters: {}, unlocked: 'time-to-mine' as unknown as ReadonlyArray<string> }),
      ).toBe(false)
    }),
  )

  it.effect('an empty persisted ID is invalid under the kernel event schema', () =>
    Effect.sync(() => {
      expect(isValidStatistics({ counters: {}, unlocked: [''] })).toBe(false)
    }),
  )
})

describe('StatisticsService', () => {
  it.effect('records and reads through the Ref', () =>
    Effect.gen(function* () {
      const statistics = yield* makeStatisticsService()

      yield* statistics.record('blocks.mined')
      yield* statistics.record('blocks.mined', 4)
      yield* statistics.unlock(achievementId('minecraft:story/mine_stone'))

      expect(yield* statistics.counterOf('blocks.mined')).toBe(5)
      expect(yield* statistics.isUnlocked(achievementId('minecraft:story/mine_stone'))).toBe(true)
      expect(yield* statistics.isUnlocked(achievementId('minecraft:story/obtain_armor'))).toBe(false)
    }),
  )

  it.effect('record rejects overflow atomically with a typed failure', () =>
    Effect.gen(function* () {
      const statistics = yield* makeStatisticsService({
        counters: { 'blocks.mined': Number.MAX_VALUE },
        unlocked: [],
      })
      const outcome = yield* Effect.result(statistics.record('blocks.mined', Number.MAX_VALUE))

      expect(outcome._tag).toBe('Failure')
      expect(outcome._tag === 'Failure' && outcome.failure._tag).toBe('StatisticsRecordFailure')
      expect(yield* statistics.snapshot).toEqual({
        counters: { 'blocks.mined': Number.MAX_VALUE },
        unlocked: [],
      })
    }),
  )

  it.effect('a hundred concurrent unlocks of the same id append it once', () =>
    Effect.gen(function* () {
      const statistics = yield* makeStatisticsService()

      yield* Effect.all(
        Array.from({ length: 100 }, () => statistics.unlock(achievementId('minecraft:story/mine_stone'))),
        { concurrency: 'unbounded' },
      )

      expect((yield* statistics.snapshot).unlocked).toEqual(['minecraft:story/mine_stone'])
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

  it.effect('restore repairs a stored record rather than refusing it', () =>
    Effect.gen(function* () {
      // The second entry point. `makeStatisticsService`'s header records why
      // both `restore` and the layer's initial value are normalised: a save
      // reaches this service through either one.
      const statistics = yield* makeStatisticsService()

      yield* statistics.record('deaths', 3)
      yield* statistics.restore({
        counters: { 'blocks.mined': 12 },
        unlocked: ['minecraft:story/form_obsidian', 'minecraft:story/form_obsidian'],
      })

      const restored = yield* statistics.snapshot

      expect(isValidStatistics(restored)).toBe(true)
      // restore REPLACES the record rather than merging into it.
      expect(restored.counters).toEqual({ 'blocks.mined': 12 })
      expect(restored.unlocked).toEqual(['minecraft:story/form_obsidian'])
    }),
  )

  it.effect('a layer built from a corrupt record is repaired on the way in', () =>
    Effect.gen(function* () {
      const restored = yield* Effect.flatMap(StatisticsService, (service) => service.snapshot).pipe(
        Effect.provide(
          StatisticsServiceLayer({
            counters: { mined: Number.NaN },
            unlocked: ['minecraft:story/form_obsidian', 'minecraft:story/form_obsidian'],
          }),
        ),
      )

      expect(isValidStatistics(restored)).toBe(true)
      expect(restored.unlocked).toEqual(['minecraft:story/form_obsidian'])
    }),
  )

  it.effect('reset empties the record, so a second world inherits nothing (DN-09)', () =>
    Effect.gen(function* () {
      const statistics = yield* makeStatisticsService()

      yield* statistics.record('deaths', 12)
      yield* statistics.unlock(achievementId('minecraft:story/mine_stone'))
      yield* statistics.reset

      expect(yield* statistics.snapshot).toEqual(EMPTY_STATISTICS)
    }),
  )
})
