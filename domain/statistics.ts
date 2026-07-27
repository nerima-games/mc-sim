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

/**
 * What is being counted, as an opaque string.
 *
 * Not a union and not branded, for the reason `DamageCause` in
 * `domain/vitals.ts` is neither: a branded constructor would have to decide what
 * a valid key looks like, and mc-sim has no basis for that decision. Keys are
 * written by the tier that knows what happened and read by the screen that
 * displays it; mc-sim is the ledger in between and reads none of them.
 */
export type StatisticKey = string

/** An achievement's identity. Opaque here, for the same reason. */
export type AchievementId = string

export type Statistics = {
  readonly counters: Readonly<Record<StatisticKey, number>>
  /**
   * Unlocked achievements, in UNLOCK ORDER.
   *
   * An array rather than a `Set`, and the order is the point: 「what did I just
   * earn」 is what an achievement toast and a recently-unlocked list both need,
   * and a `Set` re-serialised through a save file has no order to give back.
   * Membership is therefore an O(n) scan, which is the right trade at this size
   * — the reference's whole registry is a handful of entries, and the scan runs
   * on unlock rather than per frame.
   */
  readonly unlocked: ReadonlyArray<AchievementId>
}

export const EMPTY_STATISTICS: Statistics = { counters: {}, unlocked: [] }

/** A value with no magnitude contributes nothing. `domain/vitals.ts` argues the case. */
const delta = (value: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/** How many times something has been counted. Never `undefined`, never negative. */
export const counterOf = (statistics: Statistics, key: StatisticKey): number =>
  Math.max(0, delta(statistics.counters[key] ?? 0))

/**
 * Count something. `amount` defaults to one, which is the overwhelming case.
 *
 * Counters FLOOR AT ZERO rather than going negative. A tally is a record of
 * things that happened, and a negative one is a claim that fewer than nothing
 * did; mx-ui would print it, and nobody reading 「blocks mined: -3」 learns
 * anything except that a rule double-subtracted somewhere. Refusing to store it
 * keeps the defect at the caller rather than in the save file.
 *
 * A non-finite amount is IGNORED, and an already non-finite stored value is
 * treated as zero by `counterOf`, so a single `NaN` cannot silently disable a
 * counter for the rest of a world's life.
 */
export const record = (statistics: Statistics, key: StatisticKey, amount = 1): Statistics => {
  const by = delta(amount)
  if (by === 0) {
    return statistics
  }

  return {
    ...statistics,
    counters: { ...statistics.counters, [key]: Math.max(0, counterOf(statistics, key) + by) },
  }
}

export const isUnlocked = (statistics: Statistics, id: AchievementId): boolean =>
  statistics.unlocked.includes(id)

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
    : { ...statistics, unlocked: [...statistics.unlocked, id] }

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
 * Non-string ids and non-countable values are DROPPED rather than coerced. That
 * is the opposite of what the vitals repair does, and the difference is that a
 * vital has a meaningful nearest legal value (zero health is a state a player
 * can be in) while an achievement id does not: coercing `null` to `'null'`
 * would unlock an achievement that does not exist and no screen could remove.
 */
export const normaliseStatistics = (statistics: Statistics): Statistics => {
  const source: unknown = statistics.counters
  const counters: Record<StatisticKey, number> = {}
  if (typeof source === 'object' && source !== null) {
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      const count = typeof value === 'number' ? Math.max(0, delta(value)) : 0
      if (count > 0) {
        counters[key] = count
      }
    }
  }

  const unlocked = Array.isArray(statistics.unlocked)
    ? statistics.unlocked.filter(
        (id, index, all): boolean => typeof id === 'string' && all.indexOf(id) === index,
      )
    : []

  return { counters, unlocked }
}

/**
 * Would every reader above agree this record is intact?
 *
 * Exported for the reason `isValidTimeState` and `isValidVitals` are: mc-save
 * needs to distinguish a save it must repair from one it may load verbatim, and
 * `restore` has no error channel to tell it with.
 */
export const isValidStatistics = (statistics: Statistics): boolean => {
  const counters: unknown = statistics.counters
  if (typeof counters !== 'object' || counters === null || !Array.isArray(statistics.unlocked)) {
    return false
  }

  return (
    Object.values(counters as Record<string, unknown>).every(
      (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
    ) &&
    statistics.unlocked.every(
      (id, index, all) => typeof id === 'string' && all.indexOf(id) === index,
    )
  )
}
