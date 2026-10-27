import { AchievementIdSchema } from '@nerima-games/mc-kernel'
import { Result, Schema } from 'effect'
import type { DomainEventAchievementId } from '@nerima-games/mc-kernel'

export type StatisticKey = string
export type AchievementId = DomainEventAchievementId
export type Statistics = Readonly<{
  counters: Readonly<Record<StatisticKey, number>>
  unlocked: ReadonlyArray<string>
}>

export type StatisticsRecordFailure = Readonly<{
  readonly _tag: 'StatisticsRecordFailure'
  readonly path: string
  readonly reason: string
}>

export const EMPTY_STATISTICS: Statistics = { counters: {}, unlocked: [] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isValidStatisticsRecord = (statistics: unknown): boolean => {
  if (!isRecord(statistics) || !isRecord(statistics['counters']) || !Array.isArray(statistics['unlocked'])) {
    return false
  }

  return (
    Object.values(statistics['counters']).every(
      (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
    ) &&
    statistics['unlocked'].every((value, index, all) => {
      const decoded = Schema.decodeUnknownResult(AchievementIdSchema)(value)
      return decoded._tag === 'Success' && all.indexOf(decoded.success) === index
    })
  )
}

/**
 * Statistics and achievements: the RECORD, and nothing that decides what to
 * record.
 *
 * docs/responsibility.md §2:
 *
 *   > 実績 / 統計 | **記録**（画面は mx-ui）
 *
 * The word doing the work is 記録. Three things live in this row and only the
 * first is here:
 *
 *   1. WHAT HAS HAPPENED SO FAR — tallies, and the set of achievements already
 *      unlocked. State, saved, one owner. Here.
 *   2. WHAT COUNTS AS AN EVENT — that breaking a block is a mining event, that a
 *      creeper dying to a player is a kill and dying to sunlight is not. A rule.
 *      mx-gameplay's.
 *   3. WHAT AN ACHIEVEMENT REQUIRES, and its name and its prerequisite. The
 *      reference makes this an `isUnlocked: (stats) => boolean` per achievement
 *      plus a fixed-point sweep over a registry
 *      (ts-minecraft/packages/entity/domain/achievement/achievement.ts:10-44).
 *      That is a table of predicates over the world, which is a rule table; and
 *      the strings beside it are a screen's. NOT here — mc-sim is told to
 *      `unlock`, and does.
 *
 * ---------------------------------------------------------------------------
 * Why the counters are an open map and not the reference's struct
 * ---------------------------------------------------------------------------
 *
 * The reference declares eight named fields — `blocksMinedTotal`,
 * `mobsKilledByType`, `itemsCraftedByType`, `dimensionsVisited` and so on
 * (statistics/statistics.ts:9-18). Copying that shape here fails twice.
 *
 * Its per-type breakdowns are `Partial<Record<InventoryItem, number>>` and
 * `Partial<Record<EntityType, number>>`. `EntityType` is a roster of MOBS, and
 * mc-sim is forbidden to hold one: 「kind ごとの定数はルール層のものであり、
 * その表をミラーすれば mc-sim が「クリーパーとは何か」を知ることになる」
 * (docs/responsibility.md §3.1). `domain/entity.ts` gets this right by making
 * `EntityKind` a branded string with no membership; a statistics module keyed by
 * a closed union would put the roster back, one map key at a time.
 *
 * And a named field per statistic means the ninth statistic is a change to the
 * published surface of a package six repositories consume — plan.md §8's second
 * risk, incurred to count something mc-sim does not understand. An open map
 * means mx-gameplay can start counting boats without asking anybody.
 *
 * The cost is real and is accepted: mc-sim cannot tell you that
 * `'blocks.mined'` ought to equal the sum of `'blocks.mined.stone'` and its
 * siblings, because it does not know that those keys are related. Whoever writes
 * the keys owns that relationship. The alternative buys the invariant by
 * learning the vocabulary, and this repository has twice decided that the
 * vocabulary is the more expensive thing to hold.
 */

/** How many times something has been counted. Never `undefined`, never negative. */
export const counterOf = (statistics: Statistics, key: StatisticKey): number => {
  const count = statistics['counters'][key]
  return typeof count === 'number' && Number.isFinite(count) ? Math.max(0, count) : 0
}

/**
 * Count something. `amount` defaults to one, which is the overwhelming case.
 *
 * Counters FLOOR AT ZERO rather than going negative. A tally is a record of
 * things that happened, and a negative one is a claim that fewer than nothing
 * did; mx-ui would print it, and nobody reading 「blocks mined: -3」 learns
 * anything except that a rule double-subtracted somewhere. Refusing to store it
 * keeps the defect at the caller rather than in the save file.
 *
 * Invalid amounts and additions that overflow are typed failures. They do not
 * become a successful no-op or an invalid persisted counter.
 */
export const record = (
  statistics: Statistics,
  key: StatisticKey,
  amount: unknown = 1,
): Result.Result<Statistics, StatisticsRecordFailure> => {
  if (!isValidStatisticsRecord(statistics)) {
    return Result.fail({ _tag: 'StatisticsRecordFailure', path: 'statistics', reason: 'invalid statistics record' })
  }
  if (typeof key !== 'string') {
    return Result.fail({ _tag: 'StatisticsRecordFailure', path: 'key', reason: 'expected a string key' })
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return Result.fail({ _tag: 'StatisticsRecordFailure', path: 'amount', reason: 'expected a finite number' })
  }

  const current = statistics['counters'][key] ?? 0
  const next = current + amount
  if (!Number.isFinite(next)) {
    return Result.fail({ _tag: 'StatisticsRecordFailure', path: `counters.${key}`, reason: 'counter addition overflowed' })
  }
  if (amount === 0) return Result.succeed(statistics)

  const counters: Record<string, number> = { ...statistics['counters'] }
  if (next <= 0) delete counters[key]
  else counters[key] = next
  return Result.succeed({ ...statistics, counters })
}

export const isUnlocked = (statistics: Statistics, id: AchievementId): boolean =>
  statistics['unlocked'].includes(id)

/**
 * Unlock an achievement. IDEMPOTENT.
 *
 * Returning the same value when nothing changed is not a micro-optimisation: an
 * achievement stage re-evaluating its registry every frame — which is what the
 * reference's `evaluateUnlocks` sweep does — would otherwise append a duplicate
 * per frame, and the first symptom would be a save file growing without bound
 * rather than a wrong screen.
 */
export const unlock = (statistics: Statistics, id: AchievementId): Statistics =>
  isUnlocked(statistics, id)
    ? statistics
    : { ...statistics, unlocked: [...statistics['unlocked'], id] }

/**
 * Repair a record read from persistence.
 *
 * Same contract as `normaliseTimeState` and `normaliseVitals`: TOTAL over any
 * runtime value, not merely over any `Statistics`, because the whole point of
 * the world-load boundary is that the declared type is what the value CLAIMS to
 * be. A counters map that arrives as `null`, an `unlocked` that arrives as a
 * string, an entry whose value is `NaN` — all of them satisfy the declaration at
 * the seam where the save was written by a different version.
 *
 * Values rejected by the kernel's `AchievementIdSchema` and non-countable
 * values are dropped. Kernel `Statistics.unlocked` remains a string array for
 * save compatibility; decoding here admits event-branded IDs into the
 * application model.
 */
const achievementIdOf = (value: unknown): AchievementId | undefined => {
  const decoded = Schema.decodeUnknownResult(AchievementIdSchema)(value)
  return decoded._tag === 'Success' ? decoded.success : undefined
}

export const normaliseStatistics = (statistics: unknown): Statistics => {
  const source: unknown = isRecord(statistics) ? statistics['counters'] : undefined
  const counters: Record<StatisticKey, number> = {}
  if (isRecord(source)) {
    for (const [key, value] of Object.entries(source)) {
      const count = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
      if (count > 0) {
        counters[key] = count
      }
    }
  }

  const unlocked: AchievementId[] = []
  const unlockedSource: unknown = isRecord(statistics) ? statistics['unlocked'] : undefined
  if (Array.isArray(unlockedSource)) {
    for (const value of unlockedSource) {
      const id = achievementIdOf(value)
      if (id !== undefined && !unlocked.includes(id)) unlocked.push(id)
    }
  }

  return { counters, unlocked }
}

/**
 * Would every reader above agree this record is intact?
 *
 * Exported for the reason `isValidTimeState` and `isValidVitals` are: mc-save
 * needs to distinguish a save it must repair from one it may load verbatim, and
 * `restore` has no error channel to tell it with.
 */
export const isValidStatistics: (statistics: unknown) => boolean = isValidStatisticsRecord
