/**
 * StatisticsService — the Ref wrapper around `domain/statistics.ts`.
 *
 * Every mutator is `Ref.update` or `Ref.modify` (DN-07). `unlock` is the one
 * that needs the atomicity most: it is idempotent by construction, but "is it
 * already unlocked, and if not append it" is a read-decide-write, and an
 * achievement stage that evaluates its registry every frame would be running it
 * every frame. Two fibers interleaving there append the same id twice, and the
 * first symptom is a save file growing without bound rather than a wrong screen.
 *
 * ---------------------------------------------------------------------------
 * Why this is a service of its own and not a field on VitalsService
 * ---------------------------------------------------------------------------
 *
 * They have different lifetimes, and the lifetime is what a service is FOR.
 * `VitalsService.respawn` restores health and hunger; `deaths` must survive that
 * — it is counting the respawns. `reset` means "a new world" for both, but a
 * player's record and a player's health do not reset together on any other
 * occasion, and a single Ref holding both would make the frequent operation
 * (respawn) rewrite the value that must not change. `SettingsService` is
 * separate again, and for a stronger version of the same reason: it survives the
 * world entirely.
 *
 * This is the same argument `application/inventory-service.ts` makes in the
 * opposite direction — `craft` lives THERE because atomicity needs one Ref and
 * the inventory has it. Fewer services when the state is shared; separate
 * services when the resets differ.
 */
import { Context, Effect, Layer, Ref } from 'effect'
import * as Statistics from '../domain/statistics.js'

export type StatisticsServiceApi = {
  /** Whole record, for persistence and for mx-ui's statistics screen. */
  readonly snapshot: Effect.Effect<Statistics.Statistics>
  /**
   * Count something. `amount` defaults to one.
   *
   * WHAT counts as an event is the caller's — mc-sim never decides that a block
   * was mined, only that somebody said so. See `domain/statistics.ts`.
   */
  readonly record: (key: Statistics.StatisticKey, amount?: number) => Effect.Effect<void>
  readonly counterOf: (key: Statistics.StatisticKey) => Effect.Effect<number>
  /**
   * Mark an achievement earned. Idempotent.
   *
   * mc-sim holds no registry and evaluates no predicate: the reference's
   * `evaluateUnlocks` sweep over `isUnlocked: (stats) => boolean` entries
   * (ts-minecraft/packages/entity/domain/achievement/achievement.ts:24-44) is a
   * rule table and stays in the rules tier.
   */
  readonly unlock: (id: Statistics.AchievementId) => Effect.Effect<void>
  readonly isUnlocked: (id: Statistics.AchievementId) => Effect.Effect<boolean>
  /**
   * THE WORLD-LOAD PATH. Repaired by `normaliseStatistics` on the way in, with
   * no error channel, for the reason `TimeService.restore` has none.
   */
  readonly restore: (statistics: Statistics.Statistics) => Effect.Effect<void>
  /** Back to an empty record. Required for re-entrant world loads (DN-09). */
  readonly reset: Effect.Effect<void>
}

const StatisticsServiceBase: Context.TagClass<
  StatisticsService,
  '@nerima-games/mc-sim/StatisticsService',
  StatisticsServiceApi
> = Context.Tag('@nerima-games/mc-sim/StatisticsService')<StatisticsService, StatisticsServiceApi>()

export class StatisticsService extends StatisticsServiceBase {}

/**
 * Build a StatisticsService over a fresh Ref.
 *
 * `initial` is normalised for the same reason `restore`'s argument is: a layer
 * built with a loaded world is the other way a foreign state gets in.
 */
export const makeStatisticsService = (
  initial: Statistics.Statistics = Statistics.EMPTY_STATISTICS,
): Effect.Effect<StatisticsServiceApi> =>
  Effect.map(Ref.make(Statistics.normaliseStatistics(initial)), (state) => ({
    snapshot: Ref.get(state),
    record: (key, amount) => Ref.update(state, (current) => Statistics.record(current, key, amount)),
    counterOf: (key) => Ref.get(state).pipe(Effect.map((current) => Statistics.counterOf(current, key))),
    unlock: (id) => Ref.update(state, (current) => Statistics.unlock(current, id)),
    isUnlocked: (id) => Ref.get(state).pipe(Effect.map((current) => Statistics.isUnlocked(current, id))),
    restore: (next) => Ref.set(state, Statistics.normaliseStatistics(next)),
    reset: Ref.set(state, Statistics.EMPTY_STATISTICS),
  }))

export const StatisticsServiceLayer = (
  initial: Statistics.Statistics = Statistics.EMPTY_STATISTICS,
): Layer.Layer<StatisticsService> =>
  Layer.effect(StatisticsService, makeStatisticsService(initial))
