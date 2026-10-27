import {
  AchievementIdSchema,
  EntityIdSchema,
  SimulationTickSchema,
  WorldIdSchema,
  WorldRevisionSchema,
} from '@nerima-games/mc-kernel'
import type {
  DomainEvent,
  DomainEventAchievementId,
  EntityId,
  SimulationTick,
  WorldId,
  WorldRevision,
} from '@nerima-games/mc-kernel'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import type { YieldableError } from 'effect/Cause'
import * as Statistics from '../domain/statistics.js'
import { DomainEventBus } from './domain-event-bus.js'
import {
  makeReplicatedOwnerId,
  ReplicatedOwnerIdSchema,
  type ReplicatedOwnerChange,
  type ReplicatedOwnerId,
  type ReplicatedWorldDelta,
} from './replicated-state.js'
import { StatisticsService } from './statistics-service.js'
import {
  WorldCommitCoordinator,
  type ReplicatedOwnerCandidate,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'

export const ACHIEVEMENT_REPLICATED_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('achievement')

type AchievementStatisticsFields = {
  counters: Schema.$Record<typeof Schema.String, typeof Schema.Finite>
  unlocked: Schema.$Array<typeof AchievementIdSchema>
}

export const AchievementStatisticsSchema: Schema.Struct<AchievementStatisticsFields> = Schema.Struct({
  counters: Schema.Record(Schema.String, Schema.Finite),
  unlocked: Schema.Array(AchievementIdSchema),
})

export type AchievementStatistics = Schema.Schema.Type<typeof AchievementStatisticsSchema>

export const EMPTY_ACHIEVEMENT_STATISTICS: AchievementStatistics = {
  counters: {},
  unlocked: [],
}

export const ACHIEVEMENT_OWNER_REGISTRATION: ReplicatedOwnerRegistration<typeof AchievementStatisticsSchema> = {
  ownerId: ACHIEVEMENT_REPLICATED_OWNER_ID,
  schema: AchievementStatisticsSchema,
  initialState: EMPTY_ACHIEVEMENT_STATISTICS,
}

export type AchievementUnlockRequest = Readonly<{
  achievement: DomainEventAchievementId
  player: EntityId
  tick: SimulationTick
}>

export type AchievementUnlockEvent = Extract<DomainEvent, { readonly _tag: 'AchievementUnlocked' }>

export type AchievementOwnerCandidate = Readonly<{
  ownerId: ReplicatedOwnerId
  state: Statistics.Statistics
}>

export type PendingAchievementUnlock = Readonly<{
  _tag: 'PendingAchievementUnlock'
  world: WorldId
  expectedRevision: WorldRevision
  candidate: AchievementOwnerCandidate
  event: AchievementUnlockEvent
}>

export type AchievementUnlockStage =
  | PendingAchievementUnlock
  | Readonly<{ _tag: 'AchievementAlreadyUnlocked'; achievement: DomainEventAchievementId }>

export type AchievementCommitMismatchReason = 'world' | 'revision' | 'owner-state'

type AchievementCommitMismatchFields = Readonly<{
  expectedWorld: WorldId
  actualWorld: WorldId
  expectedRevision: number
  actualRevision: WorldRevision
  ownerId: typeof ACHIEVEMENT_REPLICATED_OWNER_ID
  reason: AchievementCommitMismatchReason
}>

const AchievementCommitMismatchBase: new (
  args: AchievementCommitMismatchFields,
) => YieldableError &
  { readonly _tag: 'AchievementCommitMismatch' } &
  AchievementCommitMismatchFields = Schema.TaggedError<AchievementCommitMismatch>()(
  'AchievementCommitMismatch',
  {
    expectedWorld: WorldIdSchema,
    actualWorld: WorldIdSchema,
    expectedRevision: Schema.Finite,
    actualRevision: WorldRevisionSchema,
    ownerId: ReplicatedOwnerIdSchema,
    reason: Schema.Literals(['world', 'revision', 'owner-state']),
  },
)

export class AchievementCommitMismatch extends AchievementCommitMismatchBase {}

export type AchievementServiceError =
  | Schema.SchemaError
  | WorldCommitCoordinatorError
  | AchievementCommitMismatch

export type AchievementServiceApi = Readonly<{
  /** Prepare one unlock from the current statistics without changing local state. */
  readonly stageUnlock: (
    request: AchievementUnlockRequest,
  ) => Effect.Effect<AchievementUnlockStage, Schema.SchemaError | WorldCommitCoordinatorError>
  /** Apply local state and publish only when the exact candidate is in the successful delta. */
  readonly finalizeCommittedUnlock: (
    pending: PendingAchievementUnlock,
    delta: ReplicatedWorldDelta<ReplicatedOwnerChange>,
  ) => Effect.Effect<void, AchievementCommitMismatch | Schema.SchemaError>
  /** Standalone transaction for callers that do not group this candidate with other owners. */
  readonly unlock: (request: AchievementUnlockRequest) => Effect.Effect<void, AchievementServiceError>
}>

const AchievementServiceBase: Context.ServiceClass<
  AchievementService,
  '@nerima-games/mc-sim/AchievementService',
  AchievementServiceApi
> = Context.Service<AchievementService, AchievementServiceApi>()(
  '@nerima-games/mc-sim/AchievementService',
)

export class AchievementService extends AchievementServiceBase {}

const mergeStatistics = (
  local: Statistics.Statistics,
  persisted: AchievementStatistics,
): Statistics.Statistics => {
  const counters: Record<Statistics.StatisticKey, number> = {}
  const keys = new Set([...Object.keys(local.counters), ...Object.keys(persisted.counters)])
  for (const key of keys) {
    const count = Math.max(Statistics.counterOf(local, key), persisted.counters[key] ?? 0)
    if (count > 0) counters[key] = count
  }

  const unlocked = [...local.unlocked]
  for (const id of persisted.unlocked) {
    if (!unlocked.includes(id)) unlocked.push(id)
  }
  return { counters, unlocked }
}

const statisticsEqual = (
  actual: AchievementStatistics,
  expected: Statistics.Statistics,
): boolean => {
  const actualKeys = Object.keys(actual.counters)
  const expectedKeys = Object.keys(expected.counters)
  if (actualKeys.length !== expectedKeys.length) return false
  if (expectedKeys.some((key) => actual.counters[key] !== expected.counters[key])) return false
  return (
    actual.unlocked.length === expected.unlocked.length &&
    actual.unlocked.every((id, index) => id === expected.unlocked[index])
  )
}

const matchesCandidate = (
  value: unknown,
  expected: Statistics.Statistics,
): boolean => {
  const decoded = Schema.decodeUnknownResult(AchievementStatisticsSchema)(value)
  return decoded._tag === 'Success' && statisticsEqual(decoded.success, expected)
}

const AchievementUnlockRequestSchema = Schema.Struct({
  achievement: AchievementIdSchema,
  player: EntityIdSchema,
  tick: SimulationTickSchema,
})

export const makeAchievementService = (): Effect.Effect<
  AchievementServiceApi,
  never,
  StatisticsService | DomainEventBus | WorldCommitCoordinator
> =>
  Effect.gen(function* () {
    const statistics = yield* StatisticsService
    const eventBus = yield* DomainEventBus
    const coordinator = yield* WorldCommitCoordinator
    const finalizedRevisions = yield* Ref.make(new Set<WorldRevision>())

    const stageUnlock: AchievementServiceApi['stageUnlock'] = (request) =>
      Effect.gen(function* () {
        const validRequest = yield* Schema.decodeUnknownEffect(AchievementUnlockRequestSchema)(request)
        const persisted = yield* coordinator.snapshot(
          ACHIEVEMENT_REPLICATED_OWNER_ID,
          AchievementStatisticsSchema,
        )
        const local = yield* statistics.snapshot
        const current = mergeStatistics(local, persisted.state)
        if (Statistics.isUnlocked(current, validRequest.achievement)) {
          return {
            _tag: 'AchievementAlreadyUnlocked',
            achievement: validRequest.achievement,
          }
        }

        return {
          _tag: 'PendingAchievementUnlock',
          world: persisted.world,
          expectedRevision: persisted.revision,
          candidate: {
            ownerId: ACHIEVEMENT_REPLICATED_OWNER_ID,
            state: Statistics.unlock(current, validRequest.achievement),
          },
          event: {
            _tag: 'AchievementUnlocked',
            tick: validRequest.tick,
            player: validRequest.player,
            achievement: validRequest.achievement,
          },
        }
      })

    const finalizeCommittedUnlock: AchievementServiceApi['finalizeCommittedUnlock'] = (
      pending,
      delta,
    ) => {
      const reason: AchievementCommitMismatchReason | undefined =
        delta.world !== pending.world
          ? 'world'
          : delta.revision !== pending.expectedRevision + 1
            ? 'revision'
            : delta.changes.filter((change) => change.owner === pending.candidate.ownerId).length !== 1 ||
                !delta.changes.some(
                  (change) =>
                    change.owner === pending.candidate.ownerId &&
                    matchesCandidate(change.state, pending.candidate.state),
                )
              ? 'owner-state'
              : undefined

      if (reason !== undefined) {
        return Effect.fail(
          new AchievementCommitMismatch({
            expectedWorld: pending.world,
            actualWorld: delta.world,
            expectedRevision: pending.expectedRevision + 1,
            actualRevision: delta.revision,
            ownerId: ACHIEVEMENT_REPLICATED_OWNER_ID,
            reason,
          }),
        )
      }

      return Effect.flatMap(
        Ref.modify(finalizedRevisions, (current) => {
          if (current.has(delta.revision)) return [false, current]
          const next = new Set(current)
          next.add(delta.revision)
          return [true, next]
        }),
        (shouldFinalize) =>
          shouldFinalize
            ? Effect.uninterruptible(
                Effect.andThen(
                  statistics.restore(pending.candidate.state),
                  eventBus.publish(pending.event),
                ),
              )
            : Effect.succeed(undefined),
      )
    }

    const unlock: AchievementServiceApi['unlock'] = (request) =>
      Effect.flatMap(stageUnlock(request), (staged) => {
        if (staged._tag === 'AchievementAlreadyUnlocked') return Effect.succeed(undefined)
        return Effect.flatMap(
          coordinator.commit({
            expectedRevision: staged.expectedRevision,
            expectedDimensions: [],
            changes: [staged.candidate satisfies ReplicatedOwnerCandidate],
          }),
          (delta) => finalizeCommittedUnlock(staged, delta),
        )
      })

    return { stageUnlock, finalizeCommittedUnlock, unlock }
  })

export const AchievementServiceLayer: Layer.Layer<
  AchievementService,
  never,
  StatisticsService | DomainEventBus | WorldCommitCoordinator
> = Layer.effect(AchievementService, makeAchievementService())
