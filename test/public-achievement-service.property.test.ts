import { describe, expect, it } from '@effect/vitest'
import * as fc from 'fast-check'
import {
  AchievementIdSchema,
  DomainEventSchema,
  EntityIdSchema,
  SimulationTickSchema,
  WorldIdSchema,
} from '@nerima-games/mc-kernel'
import { Effect, Fiber, Layer, Result, Schema, Stream } from 'effect'
import {
  ACHIEVEMENT_OWNER_REGISTRATION,
  ACHIEVEMENT_REPLICATED_OWNER_ID,
  AchievementService,
  AchievementServiceErrorSchema,
  AchievementServiceLayer,
} from '../src/application/achievement-service'
import { DomainEventBus, DomainEventBusLayer, EventSubscriberCapacitySchema } from '../src/application/domain-event-bus'
import { StatisticsService, StatisticsServiceLayer } from '../src/application/statistics-service'
import { WorldCommitCoordinator, WorldCommitCoordinatorLayer } from '../src/application/world-commit-coordinator'
import {
  assertEffectOutcome,
  hostileValue,
  invokeEffect,
} from './public-property-helpers'

const achievementId = Schema.decodeUnknownSync(AchievementIdSchema)('first-steps')
const playerId = Schema.decodeUnknownSync(EntityIdSchema)('player-1')
const simulationTick = Schema.decodeUnknownSync(SimulationTickSchema)(12)
const worldId = Schema.decodeUnknownSync(WorldIdSchema)('achievement-property-world')
const capacity = Schema.decodeUnknownSync(EventSubscriberCapacitySchema)(8)
const request = { achievement: achievementId, player: playerId, tick: simulationTick }
const probeEvent = Schema.decodeUnknownSync(DomainEventSchema)({
  _tag: 'LevelUp',
  tick: 13,
  entity: 'player-1',
  position: { dimension: 'overworld', x: 0, y: 64, z: 0 },
  level: 2,
})
const initial = { counters: {}, unlocked: [] }
const checks = { numRuns: 100 }
const invalidRevision = fc.constantFrom<unknown>(
  null,
  undefined,
  'revision',
  Number.NaN,
  Number.POSITIVE_INFINITY,
  -1,
  1.5,
)

const layer = Layer.provideMerge(
  Layer.mergeAll(
    StatisticsServiceLayer(initial),
    DomainEventBusLayer(capacity),
    WorldCommitCoordinatorLayer({
      world: worldId,
      dimensions: [],
      owners: [ACHIEVEMENT_OWNER_REGISTRATION],
    }),
  ),
)(AchievementServiceLayer)

describe('public AchievementService finalization properties', () => {
  it.effect('rejects hostile finalization envelopes without synchronous throws or side effects', () =>
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

      const reject = async (
        pending: unknown,
        committedDelta: unknown,
        expectedErrorTag?: string,
      ): Promise<void> => {
        let operation: Effect.Effect<void, unknown, never> | undefined
        expect(() => {
          operation = invokeEffect(service.finalizeCommittedUnlock, [pending, committedDelta])
        }).not.toThrow()
        expect(operation).toBeDefined()
        if (operation === undefined) return

        const outcome = await Effect.runPromise(Effect.result(operation))
        assertEffectOutcome(
          'AchievementService.finalizeCommittedUnlock',
          () => outcome,
          Schema.Void,
          AchievementServiceErrorSchema,
        )
        expect(Result.isFailure(outcome)).toBe(true)
        if (expectedErrorTag !== undefined && Result.isFailure(outcome)) {
          expect((outcome.failure as { _tag?: unknown })._tag).toBe(expectedErrorTag)
        }
        expect(await Effect.runPromise(statistics.snapshot)).toStrictEqual(initial)
      }

      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(
            fc.tuple(hostileValue, hostileValue, invalidRevision),
            async ([hostile, hostileState, revision]) => {
              await reject(hostile, delta)
              await reject(staged, {
                world: null,
                revision,
                changes: hostile,
              })
              await reject(staged, { ...delta, revision })
              await reject(
                { ...staged, expectedRevision: Number.MAX_SAFE_INTEGER },
                delta,
                'SchemaError',
              )
              await reject(staged, {
                ...delta,
                changes: [{
                  owner: ACHIEVEMENT_REPLICATED_OWNER_ID,
                  state: { counters: null, unlocked: hostileState },
                }],
              })
              await reject({
                ...staged,
                candidate: {
                  ...staged.candidate,
                  state: { counters: null, unlocked: [] },
                },
              }, delta)
              await reject({
                ...staged,
                candidate: {
                  ...staged.candidate,
                  ownerId: 'another-owner',
                },
              }, delta)
            },
          ),
          checks,
        ),
      )

      yield* bus.publish(probeEvent)
      expect(yield* Fiber.join(collectOne)).toStrictEqual([probeEvent])
    }).pipe(Effect.provide(layer)),
  )
})
