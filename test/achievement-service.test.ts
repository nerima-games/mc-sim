import { describe, expect, it } from '@effect/vitest'
import {
  AchievementIdSchema,
  DomainEventSchema,
  EntityIdSchema,
  SimulationTickSchema,
  WorldIdSchema,
  WorldRevisionSchema,
} from '@nerima-games/mc-kernel'
import { Effect, Fiber, Layer, Schema, Stream } from 'effect'
import {
  ACHIEVEMENT_OWNER_REGISTRATION,
  ACHIEVEMENT_REPLICATED_OWNER_ID,
  AchievementCommitMismatch,
  AchievementService,
  AchievementServiceLayer,
  type AchievementServiceError,
  type AchievementStatistics,
} from '../src/application/achievement-service'
import {
  DomainEventBus,
  DomainEventBusLayer,
  EventSubscriberCapacitySchema,
} from '../src/application/domain-event-bus'
import { StatisticsService, StatisticsServiceLayer } from '../src/application/statistics-service'
import { makeCoreTick } from '../src/application/core'
import {
  WorldCommitCoordinator,
  WorldCommitCoordinatorLayer,
  WorldRevisionConflict,
} from '../src/application/world-commit-coordinator'

const achievementId = Schema.decodeUnknownSync(AchievementIdSchema)
const playerId = Schema.decodeUnknownSync(EntityIdSchema)
const simulationTick = Schema.decodeUnknownSync(SimulationTickSchema)
const worldId = Schema.decodeUnknownSync(WorldIdSchema)
const worldRevision = Schema.decodeUnknownSync(WorldRevisionSchema)
const capacity = Schema.decodeUnknownSync(EventSubscriberCapacitySchema)(16)
const world = worldId('achievement-test-world')
const request = {
  achievement: achievementId('minecraft:story/mine_stone'),
  player: playerId('player-1'),
  tick: simulationTick(12),
}
const probeEvent = Schema.decodeUnknownSync(DomainEventSchema)({
  _tag: 'LevelUp',
  tick: 13,
  entity: 'player-1',
  position: { dimension: 'overworld', x: 0, y: 64, z: 0 },
  level: 2,
})

const coordinatorLayerWithCommitFailure = () =>
  Layer.effect(
    WorldCommitCoordinator,
    Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const expected = yield* coordinator.revision
      return {
        ...coordinator,
        commit: () => Effect.fail(new WorldRevisionConflict({
          expected,
          actual: worldRevision(Number(expected) + 1),
        })),
      }
    }),
  ).pipe(Layer.provide(WorldCommitCoordinatorLayer({
    world,
    dimensions: [],
    owners: [ACHIEVEMENT_OWNER_REGISTRATION],
  })))

const achievementLayer = (
  initial: AchievementStatistics = { counters: {}, unlocked: [] },
  localInitial: AchievementStatistics = initial,
  coordinatorLayer = WorldCommitCoordinatorLayer({
    world,
    dimensions: [],
    owners: [{ ...ACHIEVEMENT_OWNER_REGISTRATION, initialState: initial }],
  }),
) =>
  Layer.provideMerge(
    Layer.mergeAll(
      StatisticsServiceLayer(localInitial),
      DomainEventBusLayer(capacity),
      coordinatorLayer,
    ),
  )(AchievementServiceLayer)

describe('AchievementService', () => {
  it.effect('stages the full candidate and only restores and publishes after its matching commit', () =>
    Effect.gen(function* () {
      const service = yield* AchievementService
      const statistics = yield* StatisticsService
      const coordinator = yield* WorldCommitCoordinator
      const bus = yield* DomainEventBus
      const collectTwo = yield* Effect.forkChild(bus.events.pipe(Stream.take(2), Stream.runCollect))
      yield* Effect.yieldNow

      const pending = yield* service.stageUnlock(request)
      expect(pending._tag).toBe('PendingAchievementUnlock')
      if (pending._tag === 'PendingAchievementUnlock') {
        expect(pending.candidate.state.counters).toEqual({ 'blocks.mined': 4 })
        expect(pending.candidate.state.unlocked).toEqual(['minecraft:story/mine_stone'])
        expect((yield* statistics.snapshot).unlocked).toEqual([])

        const delta = yield* coordinator.commit({
          expectedRevision: pending.expectedRevision,
          expectedDimensions: [],
          changes: [pending.candidate],
        })
        yield* service.finalizeCommittedUnlock(pending, delta)
      }

      expect(yield* statistics.snapshot).toStrictEqual({
        counters: { 'blocks.mined': 4 },
        unlocked: ['minecraft:story/mine_stone'],
      })
      yield* bus.publish(probeEvent)
      const events = yield* Fiber.join(collectTwo)
      expect(events.map((event) => event._tag)).toStrictEqual(['AchievementUnlocked', 'LevelUp'])
      expect(events[0]).toStrictEqual({
        _tag: 'AchievementUnlocked',
        tick: request.tick,
        player: request.player,
        achievement: request.achievement,
      })
    }).pipe(
      Effect.provide(
        achievementLayer({ counters: { 'blocks.mined': 4 }, unlocked: [] }),
      ),
    ),
  )

  it.effect('passes the successful core tick delta to achievement finalization', () =>
    Effect.gen(function* () {
      const service = yield* AchievementService
      const statistics = yield* StatisticsService
      const coordinator = yield* WorldCommitCoordinator
      const bus = yield* DomainEventBus
      const collectOne = yield* Effect.forkChild(bus.events.pipe(Stream.take(1), Stream.runCollect))
      yield* Effect.yieldNow

      const emptyCandidate = { changes: [], expectedDimensions: [], events: [] }
      const core = yield* makeCoreTick<AchievementServiceError>({
        coordinator,
        publish: bus.publish,
        stages: {
          intentsAndRules: (input) =>
            Effect.map(service.stageUnlock({ ...request, tick: input.tick }), (staged) => {
              if (staged._tag === 'AchievementAlreadyUnlocked') return emptyCandidate
              return {
                changes: [staged.candidate],
                expectedDimensions: [],
                events: [],
                restore: (delta) => service.finalizeCommittedUnlock(staged, delta),
              }
            }),
          stations: () => Effect.succeed(emptyCandidate),
          environment: () => Effect.succeed(emptyCandidate),
          entities: () => Effect.succeed(emptyCandidate),
        },
      })

      yield* core.runTick(simulationTick(1), [])

      expect((yield* statistics.snapshot).unlocked).toEqual(['minecraft:story/mine_stone'])
      expect(yield* Fiber.join(collectOne)).toStrictEqual([{
        _tag: 'AchievementUnlocked',
        tick: simulationTick(1),
        player: request.player,
        achievement: request.achievement,
      }])
    }).pipe(Effect.provide(achievementLayer({ counters: { 'blocks.mined': 4 }, unlocked: [] }))),
  )

  it.effect('a mismatched committed state is rejected without restoring or publishing', () =>
    Effect.gen(function* () {
      const initial: AchievementStatistics = { counters: { 'blocks.mined': 4 }, unlocked: [] }
      const service = yield* AchievementService
      const statistics = yield* StatisticsService
      const coordinator = yield* WorldCommitCoordinator
      const bus = yield* DomainEventBus
      const collectOne = yield* Effect.forkChild(bus.events.pipe(Stream.take(1), Stream.runCollect))
      yield* Effect.yieldNow

      const pending = yield* service.stageUnlock(request)
      if (pending._tag === 'AchievementAlreadyUnlocked') {
        expect(pending._tag).toBe('PendingAchievementUnlock')
      } else {
        const mismatchedDelta = yield* coordinator.commit({
          expectedRevision: pending.expectedRevision,
          expectedDimensions: [],
          changes: [
            {
              ownerId: ACHIEVEMENT_REPLICATED_OWNER_ID,
              state: { counters: { 'blocks.mined': 99, 'mobs.killed': 1 }, unlocked: [] },
            },
          ],
        })
        const result = yield* Effect.result(service.finalizeCommittedUnlock(pending, mismatchedDelta))
        expect(result._tag).toBe('Failure')
        if (result._tag === 'Failure') {
          expect(result.failure).toBeInstanceOf(AchievementCommitMismatch)
          if (result.failure instanceof AchievementCommitMismatch) {
            expect(result.failure.reason).toBe('owner-state')
          }
        }

        expect(mismatchedDelta.changes).toHaveLength(1)
        const mismatchedValueDelta = {
          ...mismatchedDelta,
          changes: mismatchedDelta.changes.map((change) => ({
            ...change,
            state: { counters: { 'blocks.mined': 99 }, unlocked: [] },
          })),
        }
        const mismatchedValueResult = yield* Effect.result(
          service.finalizeCommittedUnlock(pending, mismatchedValueDelta),
        )
        expect(mismatchedValueResult._tag).toBe('Failure')
        if (mismatchedValueResult._tag === 'Failure') {
          expect(mismatchedValueResult.failure).toBeInstanceOf(AchievementCommitMismatch)
          if (mismatchedValueResult.failure instanceof AchievementCommitMismatch) {
            expect(mismatchedValueResult.failure.reason).toBe('owner-state')
          }
        }
      }

      expect(yield* statistics.snapshot).toStrictEqual(initial)
      yield* bus.publish(probeEvent)
      expect(yield* Fiber.join(collectOne)).toStrictEqual([probeEvent])
    }).pipe(Effect.provide(achievementLayer({ counters: { 'blocks.mined': 4 }, unlocked: [] }))),
  )

  it.effect('merges local and persisted statistics without dropping local counters or duplicating unlocks', () =>
    Effect.gen(function* () {
      const service = yield* AchievementService
      const pending = yield* service.stageUnlock(request)
      expect(pending._tag).toBe('PendingAchievementUnlock')
      if (pending._tag === 'PendingAchievementUnlock') {
        expect(pending.candidate.state.counters).toStrictEqual({ 'local.only': 4 })
        expect(pending.candidate.state.unlocked).toStrictEqual([
          'minecraft:story/obtain_armor',
          'minecraft:story/form_obsidian',
          'minecraft:story/mine_stone',
        ])
      }
    }).pipe(Effect.provide(achievementLayer(
      {
        counters: { 'persisted.zero': 0 },
        unlocked: [achievementId('minecraft:story/obtain_armor'), achievementId('minecraft:story/form_obsidian')],
      },
      { counters: { 'local.only': 4 }, unlocked: [achievementId('minecraft:story/obtain_armor')] },
    ))),
  )

  it.effect('rejects deltas for another world or revision and finalizes one matching delta only once', () =>
    Effect.gen(function* () {
      const service = yield* AchievementService
      const statistics = yield* StatisticsService
      const coordinator = yield* WorldCommitCoordinator
      const bus = yield* DomainEventBus
      const collectTwo = yield* Effect.forkChild(bus.events.pipe(Stream.take(2), Stream.runCollect))
      yield* Effect.yieldNow

      const pending = yield* service.stageUnlock(request)
      if (pending._tag === 'AchievementAlreadyUnlocked') {
        expect(pending._tag).toBe('PendingAchievementUnlock')
        return
      }
      const delta = yield* coordinator.commit({
        expectedRevision: pending.expectedRevision,
        expectedDimensions: [],
        changes: [pending.candidate],
      })

      const wrongWorld = yield* Effect.result(service.finalizeCommittedUnlock(pending, {
        ...delta,
        world: worldId('another-achievement-world'),
      }))
      expect(wrongWorld._tag).toBe('Failure')
      if (wrongWorld._tag === 'Failure') {
        expect(wrongWorld.failure).toBeInstanceOf(AchievementCommitMismatch)
        if (wrongWorld.failure instanceof AchievementCommitMismatch) {
          expect(wrongWorld.failure.reason).toBe('world')
        }
      }

      const wrongRevision = yield* Effect.result(service.finalizeCommittedUnlock(pending, {
        ...delta,
        revision: worldRevision(Number(delta.revision) + 1),
      }))
      expect(wrongRevision._tag).toBe('Failure')
      if (wrongRevision._tag === 'Failure') {
        expect(wrongRevision.failure).toBeInstanceOf(AchievementCommitMismatch)
        if (wrongRevision.failure instanceof AchievementCommitMismatch) {
          expect(wrongRevision.failure.reason).toBe('revision')
        }
      }
      expect(yield* statistics.snapshot).toStrictEqual({ counters: {}, unlocked: [] })

      yield* service.finalizeCommittedUnlock(pending, delta)
      yield* service.finalizeCommittedUnlock(pending, delta)
      expect((yield* statistics.snapshot).unlocked).toEqual(['minecraft:story/mine_stone'])
      yield* bus.publish(probeEvent)
      const events = yield* Fiber.join(collectTwo)
      expect(events.map((event) => event._tag)).toStrictEqual(['AchievementUnlocked', 'LevelUp'])
    }).pipe(Effect.provide(achievementLayer())),
  )

  it.effect('a coordinator commit failure leaves the staged unlock unpublished', () =>
    Effect.gen(function* () {
      const service = yield* AchievementService
      const statistics = yield* StatisticsService
      const bus = yield* DomainEventBus
      const collectOne = yield* Effect.forkChild(bus.events.pipe(Stream.take(1), Stream.runCollect))
      yield* Effect.yieldNow

      const result = yield* Effect.result(service.unlock(request))
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') expect(result.failure).toBeInstanceOf(WorldRevisionConflict)

      expect(yield* statistics.snapshot).toStrictEqual({ counters: {}, unlocked: [] })
      yield* bus.publish(probeEvent)
      expect(yield* Fiber.join(collectOne)).toStrictEqual([probeEvent])
    }).pipe(Effect.provide(achievementLayer(
      { counters: {}, unlocked: [] },
      { counters: {}, unlocked: [] },
      coordinatorLayerWithCommitFailure(),
    ))),
  )

  it.effect('unlock is idempotent across commits and emits one event', () =>
    Effect.gen(function* () {
      const service = yield* AchievementService
      const statistics = yield* StatisticsService
      const bus = yield* DomainEventBus
      const collectTwo = yield* Effect.forkChild(bus.events.pipe(Stream.take(2), Stream.runCollect))
      yield* Effect.yieldNow

      yield* service.unlock(request)
      yield* service.unlock(request)
      expect((yield* statistics.snapshot).unlocked).toEqual(['minecraft:story/mine_stone'])

      yield* bus.publish(probeEvent)
      const events = yield* Fiber.join(collectTwo)
      expect(events.map((event) => event._tag)).toStrictEqual(['AchievementUnlocked', 'LevelUp'])
    }).pipe(Effect.provide(achievementLayer())),
  )

  it.effect('malformed finalization envelopes fail before restoring or publishing', () =>
    Effect.gen(function* () {
      const service = yield* AchievementService
      const statistics = yield* StatisticsService
      const coordinator = yield* WorldCommitCoordinator
      const bus = yield* DomainEventBus
      const collectOne = yield* Effect.forkChild(bus.events.pipe(Stream.take(1), Stream.runCollect))
      yield* Effect.yieldNow

      const staged = yield* service.stageUnlock(request)
      if (staged._tag === 'AchievementAlreadyUnlocked') {
        expect(staged._tag).toBe('PendingAchievementUnlock')
        return
      }
      const delta = yield* coordinator.commit({
        expectedRevision: staged.expectedRevision,
        expectedDimensions: [],
        changes: [staged.candidate],
      })
      const invalidArguments: ReadonlyArray<ReadonlyArray<unknown>> = [
        [null, delta],
        [{ ...staged, expectedRevision: -1 }, delta],
        [{ ...staged, expectedRevision: Number.MAX_SAFE_INTEGER }, delta],
        [staged, { ...delta, revision: Number.NaN }],
        [staged, { ...delta, changes: null }],
        [
          staged,
          {
            ...delta,
            changes: [{
              owner: ACHIEVEMENT_REPLICATED_OWNER_ID,
              state: { counters: null, unlocked: [] },
            }],
          },
        ],
        [{ ...staged, candidate: { ...staged.candidate, ownerId: 'another-owner' } }, delta],
      ]

      for (const args of invalidArguments) {
        const invoke = () => Reflect.apply(service.finalizeCommittedUnlock, undefined, args)
        expect(invoke).not.toThrow()
        const outcome = yield* Effect.result(invoke() as Effect.Effect<void, unknown>)
        expect(outcome._tag).toBe('Failure')
        if (outcome._tag === 'Failure') {
          expect(typeof (outcome.failure as { _tag?: unknown })._tag).toBe('string')
        }
      }

      const exhaustedRevision = yield* Effect.result(
        Reflect.apply(service.finalizeCommittedUnlock, undefined, [
          { ...staged, expectedRevision: Number.MAX_SAFE_INTEGER },
          delta,
        ]) as Effect.Effect<void, unknown>,
      )
      expect(exhaustedRevision._tag).toBe('Failure')
      if (exhaustedRevision._tag === 'Failure') {
        expect((exhaustedRevision.failure as { _tag?: unknown })._tag).toBe('SchemaError')
      }

      expect(yield* statistics.snapshot).toStrictEqual({ counters: {}, unlocked: [] })
      yield* bus.publish(probeEvent)
      expect(yield* Fiber.join(collectOne)).toStrictEqual([probeEvent])
    }).pipe(Effect.provide(achievementLayer())),
  )
})
