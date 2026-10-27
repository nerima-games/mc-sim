import fc from 'fast-check'
import { Deferred, Effect, Layer, Option, Ref, Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import {
  failingStorageLayer,
  makeInMemoryStorage,
  StorageOperation,
  StoragePort,
} from '@nerima-games/mc-save'
import {
  AngleRadians,
  ChunkAxis,
  DeltaTimeSecs,
  DIMENSIONS,
  EntityIdSchema,
  DimensionRevisionSchema,
  PositionAxis,
  ProjectileIdSchema,
  SaveSliceIdSchema,
  SaveVersionSchema,
  SimulationTick,
  SimulationTickSchema,
  WorldIdSchema,
  chunkCoord,
  position,
} from '@nerima-games/mc-kernel'
import * as Physics from '@nerima-games/mc-physics'
import type { Chunk } from '@nerima-games/mc-worldgen'
import * as PublicApplication from '../src/index.js'
import * as Camera from '../src/domain/camera-pose.js'
import { EntityKind } from '../src/domain/entity.js'
import { makeCoreTick } from '../src/application/core.js'
import { makeEntityManager } from '../src/application/entity-manager.js'
import {
  makeReplicatedOwnerId,
  replicatedOwnerChangeSchema,
  replicatedWorldDeltaSchema,
} from '../src/application/replicated-state.js'
import {
  makeWorldCommitCoordinator,
  WorldCommitCoordinatorErrorSchema,
} from '../src/application/world-commit-coordinator.js'
import {
  makeSaveCoordinator,
  type DimensionChunk,
  type SaveCoordinatorApi,
  type SaveCoordinatorPublication,
} from '../src/application/save-coordinator.js'
import { loadSimulation, saveSimulation, simulationSaveKey } from '../src/application/save-service.js'
import {
  migrateSimulationSaveV3,
  type SimulationSaveV3Registrations,
} from '../src/application/save-v3-migration.js'
import { makePlayerService } from '../src/application/player-service.js'
import { makeSettingsService } from '../src/application/settings-service.js'
import { makeWeatherService } from '../src/application/weather-service.js'
import type { FishingState } from '../src/domain/fishing.js'
import { makeSimFrameState, makeSimInputPort, makeSimStagesWithPhysics } from '../src/stages/registration.js'
import {
  assertEffectOutcome,
  hostileNumberOrNullish,
  hostileValue as sharedHostileValue,
  isRecord,
  invoke,
  invokeEffect,
} from './public-property-helpers.js'

const hostileNumber = hostileNumberOrNullish
const hostileValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.anything({ maxDepth: 3 }),
  sharedHostileValue,
)

const runEffectResult = async (
  operation: (...args: never[]) => Effect.Effect<unknown, unknown, never>,
  args: ReadonlyArray<unknown>,
): Promise<Result.Result<unknown, unknown>> =>
  Effect.runPromise(Effect.result(invokeEffect(operation, args)))

const assertEffectResult = async (
  propertyName: string,
  operation: (...args: never[]) => Effect.Effect<unknown, unknown, never>,
  args: ReadonlyArray<unknown>,
  successSchema: Schema.Schema<unknown>,
  failureSchema: Schema.Schema<unknown>,
): Promise<Result.Result<unknown, unknown>> => {
  const result = await runEffectResult(operation, args)
  assertEffectOutcome(propertyName, () => result, successSchema, failureSchema)
  return result
}

const checks = { numRuns: 100 }

const makeIntentQueue = async (capacity: number) => {
  const queueCapacity = Schema.decodeUnknownSync(PublicApplication.IntentQueueCapacitySchema)(capacity)
  const layer = PublicApplication.IntentQueueLayer({ capacity: queueCapacity })
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* PublicApplication.IntentQueue
    }).pipe(Effect.provide(layer)),
  )
}

const queuedIntentKeys = (value: unknown): ReadonlyArray<readonly [number, string]> =>
  Schema.decodeUnknownSync(Schema.Array(PublicApplication.QueuedIntentSchema))(value)
    .map(({ sequence, intent }) => [sequence, intent.id] as const)

it('IntentQueue assigns sequences, orders ready intents, and preserves future entries', async () => {
  const queuedIntentSchema = Schema.Array(PublicApplication.QueuedIntentSchema)

  await fc.assert(
    fc.asyncProperty(
      fc.record({ targetTicks: fc.array(fc.nat(8), { minLength: 1, maxLength: 5 }), readyTick: fc.nat(8) }),
      async ({ targetTicks, readyTick }) => {
        const queue = await makeIntentQueue(targetTicks.length)
        const admitted: Array<{ readonly sequence: number; readonly targetTick: number; readonly id: string }> = []

        for (const [index, targetTick] of targetTicks.entries()) {
          const intent = Schema.decodeUnknownSync(PublicApplication.IntentSchema)({
            id: `property-intent-${index}`,
            targetTick,
            source: 'local',
            payload: { _tag: 'MeleeAttack', actor: `property-actor-${index}` },
          })
          const outcome = await assertEffectResult(
            'IntentQueue.enqueue', queue.enqueue, [intent], PublicApplication.IntentSequenceSchema,
            PublicApplication.IntentQueueEnqueueFailureSchema,
          )
          expect(Result.isSuccess(outcome)).toBe(true)
          if (Result.isSuccess(outcome)) {
            const sequence = Schema.decodeUnknownSync(PublicApplication.IntentSequenceSchema)(outcome.success)
            expect(sequence).toBe(index)
            admitted.push({ sequence, targetTick, id: intent.id })
          }
        }

        const readyOutcome = await assertEffectResult(
          'IntentQueue.takeReady ready tick', queue.takeReady, [readyTick],
          queuedIntentSchema, PublicApplication.SchemaErrorSchema,
        )
        expect(Result.isSuccess(readyOutcome)).toBe(true)
        const ready = admitted
          .filter(({ targetTick }) => targetTick <= readyTick)
          .sort((left, right) => left.targetTick - right.targetTick || left.sequence - right.sequence)
        if (Result.isSuccess(readyOutcome)) {
          expect(queuedIntentKeys(readyOutcome.success)).toStrictEqual(ready.map(({ sequence, id }) => [sequence, id]))
        }

        const repeatedReadyOutcome = await assertEffectResult(
          'IntentQueue.takeReady repeated tick', queue.takeReady, [readyTick],
          queuedIntentSchema, PublicApplication.SchemaErrorSchema,
        )
        expect(Result.isSuccess(repeatedReadyOutcome)).toBe(true)
        if (Result.isSuccess(repeatedReadyOutcome)) expect(queuedIntentKeys(repeatedReadyOutcome.success)).toStrictEqual([])

        const pending = admitted.filter(({ targetTick }) => targetTick > readyTick)
        const futureTick = pending.reduce((maximum, entry) => Math.max(maximum, entry.targetTick), readyTick)
        const futureOutcome = await assertEffectResult(
          'IntentQueue.takeReady future tick', queue.takeReady, [futureTick],
          queuedIntentSchema, PublicApplication.SchemaErrorSchema,
        )
        expect(Result.isSuccess(futureOutcome)).toBe(true)
        const future = [...pending].sort((left, right) => left.targetTick - right.targetTick || left.sequence - right.sequence)
        if (Result.isSuccess(futureOutcome)) {
          expect(queuedIntentKeys(futureOutcome.success)).toStrictEqual(future.map(({ sequence, id }) => [sequence, id]))
        }

        const drainedOutcome = await assertEffectResult(
          'IntentQueue.takeReady drained queue', queue.takeReady, [futureTick],
          queuedIntentSchema, PublicApplication.SchemaErrorSchema,
        )
        expect(Result.isSuccess(drainedOutcome)).toBe(true)
        if (Result.isSuccess(drainedOutcome)) expect(queuedIntentKeys(drainedOutcome.success)).toStrictEqual([])
      },
    ),
    checks,
  )
})

it('IntentQueue reports a typed full failure and preserves the queued entry', async () => {
  await fc.assert(
    fc.asyncProperty(fc.nat(8), async (targetTick) => {
      const queue = await makeIntentQueue(1)
      const first = Schema.decodeUnknownSync(PublicApplication.IntentSchema)({
        id: 'full-queue-first', targetTick, source: 'local',
        payload: { _tag: 'MeleeAttack', actor: 'full-queue-actor' },
      })
      const second = Schema.decodeUnknownSync(PublicApplication.IntentSchema)({
        id: 'full-queue-second', targetTick, source: 'local',
        payload: { _tag: 'MeleeAttack', actor: 'full-queue-actor' },
      })

      const accepted = await assertEffectResult(
        'IntentQueue.enqueue accepted', queue.enqueue, [first], PublicApplication.IntentSequenceSchema,
        PublicApplication.IntentQueueEnqueueFailureSchema,
      )
      expect(Result.isSuccess(accepted)).toBe(true)
      if (Result.isSuccess(accepted)) {
        expect(Schema.decodeUnknownSync(PublicApplication.IntentSequenceSchema)(accepted.success)).toBe(0)
      }

      const rejected = await assertEffectResult(
        'IntentQueue.enqueue full', queue.enqueue, [second], PublicApplication.IntentSequenceSchema,
        PublicApplication.IntentQueueEnqueueFailureSchema,
      )
      expect(Result.isFailure(rejected)).toBe(true)
      if (Result.isFailure(rejected)) {
        expect(rejected.failure).toBeInstanceOf(PublicApplication.IntentQueueFull)
      }

      const preserved = await assertEffectResult(
        'IntentQueue.takeReady after full failure', queue.takeReady, [targetTick],
        Schema.Array(PublicApplication.QueuedIntentSchema), PublicApplication.SchemaErrorSchema,
      )
      expect(Result.isSuccess(preserved)).toBe(true)
      if (Result.isSuccess(preserved)) {
        expect(queuedIntentKeys(preserved.success)).toStrictEqual([[0, first.id]])
      }
    }),
    checks,
  )
})

it('world commit coordinator accepts only typed, finite candidate outcomes for hostile revisions and states', async () => {
  const world = Schema.decodeUnknownSync(WorldIdSchema)('application-property-world')
  const ownerId = makeReplicatedOwnerId('application-property-owner')
  const schema = Schema.Struct({ value: Schema.Finite })
  const changeSchema = replicatedOwnerChangeSchema(ownerId, schema)
  const deltaSchema = replicatedWorldDeltaSchema(changeSchema)

  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileNumber, hostileNumber), async ([expectedRevision, value]) => {
      const coordinator = await Effect.runPromise(makeWorldCommitCoordinator({
        world,
        owners: [{ ownerId, schema, initialState: { value: 0 } }],
      }))
      const request = {
        expectedRevision,
        expectedDimensions: [],
        changes: [{ ownerId, state: { value } }],
      }
      await assertEffectResult(
        'WorldCommitCoordinator.commit', coordinator.commit, [request], deltaSchema,
        WorldCommitCoordinatorErrorSchema,
      )
    }),
    checks,
  )
})

it('world commit coordinator returns typed failures for malformed request envelopes', async () => {
  const world = Schema.decodeUnknownSync(WorldIdSchema)('malformed-commit-envelope-world')
  const ownerId = makeReplicatedOwnerId('malformed-commit-envelope-owner')
  const deltaSchema = replicatedWorldDeltaSchema(
    replicatedOwnerChangeSchema(ownerId, Schema.Struct({ value: Schema.Finite })),
  )
  const coordinator = await Effect.runPromise(makeWorldCommitCoordinator({
    world,
    owners: [{ ownerId, schema: Schema.Struct({ value: Schema.Finite }), initialState: { value: 0 } }],
  }))

  await fc.assert(
    fc.asyncProperty(fc.constantFrom<unknown>(null, undefined, false, 0, 'invalid', [], {}), async (request) => {
      const outcome = await assertEffectResult(
        'WorldCommitCoordinator.commit malformed request', coordinator.commit, [request],
        deltaSchema, WorldCommitCoordinatorErrorSchema,
      )
      expect(Result.isFailure(outcome)).toBe(true)
    }),
    checks,
  )
})

it('core ticks reject or safely process hostile tick values and queued-intent contents', async () => {
  const world = Schema.decodeUnknownSync(WorldIdSchema)('core-property-world')
  const coordinator = await Effect.runPromise(makeWorldCommitCoordinator({ world, owners: [] }))
  const noChanges = () => Effect.succeed({ changes: [], expectedDimensions: [], events: [] })
  const makeCore = () => makeCoreTick({
    coordinator,
    publish: () => Effect.void,
    stages: {
      intentsAndRules: noChanges,
      stations: noChanges,
      environment: noChanges,
      entities: noChanges,
    },
  })
  const successSchema = PublicApplication.CoreTickRunTickSuccessSchema
  const failureSchema = PublicApplication.makeCoreTickErrorSchema(Schema.Never)
  const validIntent = Schema.decodeUnknownSync(PublicApplication.QueuedIntentSchema)({
    sequence: 0,
    intent: {
      id: 'core-property-valid-intent',
      targetTick: 2,
      source: 'local',
      payload: { _tag: 'MeleeAttack', actor: 'core-property-player' },
    },
  })

  const validCore = await Effect.runPromise(makeCore())
  const firstTick = await assertEffectResult(
    'CoreTick.runTick valid empty input', validCore.runTick, [1, []], successSchema, failureSchema,
  )
  expect(Result.isSuccess(firstTick)).toBe(true)
  const secondTick = await assertEffectResult(
    'CoreTick.runTick valid queued intent', validCore.runTick, [2, [validIntent]], successSchema, failureSchema,
  )
  expect(Result.isSuccess(secondTick)).toBe(true)

  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileNumber, fc.array(hostileValue)), async ([tick, ready]) => {
      const core = await Effect.runPromise(makeCore())
      await assertEffectResult('CoreTick.runTick hostile input', core.runTick, [tick, ready], successSchema, failureSchema)
    }),
    checks,
  )
})

it('entity manager spawn and restore repair hostile coordinates, health, serials, and roster entries', async () => {
  type EntityBehaviour = { readonly _tag: 'Idle' } | { readonly _tag: 'Restored' }
  const behaviourSchema = Schema.Union([
    Schema.TaggedStruct('Idle', {}),
    Schema.TaggedStruct('Restored', {}),
  ])
  const entitySchema = PublicApplication.EntitySchema(behaviourSchema)
  const rosterSchema = PublicApplication.EntityRosterSchema(behaviourSchema)
  const entityOrUndefinedSchema = Schema.Union([entitySchema, Schema.Undefined])
  const serialExhaustedSchema = PublicApplication.EntitySerialExhaustedSchema
  const rosterRepairSchema = PublicApplication.RosterRepairSchema
  const kind = EntityKind('property-creature')

  await fc.assert(
    fc.asyncProperty(hostileNumber, async (value) => {
      const manager = await Effect.runPromise(makeEntityManager<EntityBehaviour>())
      const request = {
        kind,
        feetPosition: { x: value, y: value, z: value },
        healthPoints: value,
        behaviour: { _tag: 'Idle' },
      }
      const spawnResult = await assertEffectResult(
        'EntityManager.spawn hostile numeric fields', manager.spawn, [request], entitySchema, serialExhaustedSchema,
      )
      if (Result.isFailure(spawnResult)) {
        expect(Schema.decodeUnknownSync(serialExhaustedSchema)(spawnResult.failure)).toStrictEqual({
          _tag: 'EntitySerialExhausted',
        })
      }
      expect(Result.isSuccess(spawnResult)).toBe(true)
      if (Result.isFailure(spawnResult)) return

      const spawned = Schema.decodeUnknownSync(entitySchema)(spawnResult.success)
      const spawnedRoster = Schema.decodeUnknownSync(rosterSchema)(await Effect.runPromise(manager.snapshot))
      const spawnedEntities = Schema.decodeUnknownSync(Schema.Array(entitySchema))(
        await Effect.runPromise(manager.entities),
      )
      expect(spawnedRoster.entities).toContainEqual(spawned)
      expect(spawnedEntities).toContainEqual(spawned)
      expect(await Effect.runPromise(manager.count)).toBe(1)
      expect(await Effect.runPromise(manager.countOfKind(kind))).toBe(1)

      const foundValue = await Effect.runPromise(invokeEffect(manager.find, [spawned.id]))
      const found = Schema.decodeUnknownSync(entityOrUndefinedSchema)(foundValue)
      expect(found).toStrictEqual(spawned)
      expect(foundValue).toBe(spawnResult.success)

      const despawned = Schema.decodeUnknownSync(Schema.Boolean)(
        await Effect.runPromise(manager.despawn(spawned.id)),
      )
      expect(despawned).toBe(true)
      const afterDespawn = Schema.decodeUnknownSync(rosterSchema)(await Effect.runPromise(manager.snapshot))
      expect(afterDespawn.entities).toHaveLength(0)
      expect(await Effect.runPromise(manager.count)).toBe(0)
      expect(await Effect.runPromise(manager.countOfKind(kind))).toBe(0)
      expect(Schema.decodeUnknownSync(entityOrUndefinedSchema)(
        await Effect.runPromise(invokeEffect(manager.find, [spawned.id])),
      )).toBeUndefined()

      const beforeRestore = afterDespawn
      const roster: unknown = {
        nextSerial: value,
        entities: [
          null,
          {
            id: value,
            kind,
            feetPosition: { x: value, y: value, z: value },
            healthPoints: value,
            behaviour: { _tag: 'Restored' },
          },
        ],
      }
      const restoreResult = await assertEffectResult(
        'EntityManager.restore hostile roster', manager.restore, [roster], rosterRepairSchema, serialExhaustedSchema,
      )
      if (Result.isFailure(restoreResult)) {
        expect(Schema.decodeUnknownSync(serialExhaustedSchema)(restoreResult.failure)).toStrictEqual({
          _tag: 'EntitySerialExhausted',
        })
        const unchanged = Schema.decodeUnknownSync(rosterSchema)(await Effect.runPromise(manager.snapshot))
        expect(unchanged).toStrictEqual(beforeRestore)
      } else {
        const repair = Schema.decodeUnknownSync(rosterRepairSchema)(restoreResult.success)
        expect(repair).toStrictEqual({ discarded: 1, reidentified: 1 })
        const installed = Schema.decodeUnknownSync(rosterSchema)(await Effect.runPromise(manager.snapshot))
        expect(installed.entities).toHaveLength(1)
        expect(installed.entities[0]?.id).not.toBe(value)
        expect(await Effect.runPromise(manager.count)).toBe(installed.entities.length)
        expect(await Effect.runPromise(manager.countOfKind(kind))).toBe(installed.entities.length)
        const restored = installed.entities[0]
        if (restored !== undefined) {
          expect(Schema.decodeUnknownSync(entityOrUndefinedSchema)(
            await Effect.runPromise(invokeEffect(manager.find, [restored.id])),
          )).toStrictEqual(restored)
        }
      }
    }),
    checks,
  )

  const exhaustedSpawnManager = await Effect.runPromise(makeEntityManager<EntityBehaviour>({
    entities: [],
    nextSerial: PublicApplication.EntitySerial(Number.MAX_SAFE_INTEGER),
  }))
  const exhaustedSpawnResult = await assertEffectResult(
    'EntityManager.spawn serial exhaustion', exhaustedSpawnManager.spawn,
    [{ kind, feetPosition: { x: 1, y: 64, z: 0 }, healthPoints: 20, behaviour: { _tag: 'Idle' } }],
    entitySchema, serialExhaustedSchema,
  )
  if (Result.isFailure(exhaustedSpawnResult)) {
    expect(Schema.decodeUnknownSync(serialExhaustedSchema)(exhaustedSpawnResult.failure)).toStrictEqual({
      _tag: 'EntitySerialExhausted',
    })
  } else {
    Schema.decodeUnknownSync(entitySchema)(exhaustedSpawnResult.success)
  }
  expect(Result.isFailure(exhaustedSpawnResult)).toBe(true)

  const exhaustedSerial = PublicApplication.EntitySerial(Number.MAX_SAFE_INTEGER)
  const duplicateId = PublicApplication.mintEntityId(exhaustedSerial)
  const exhaustedRestoreManager = await Effect.runPromise(makeEntityManager<EntityBehaviour>())
  const exhaustedRestoreResult = await assertEffectResult(
    'EntityManager.restore serial exhaustion', exhaustedRestoreManager.restore,
    [{
      nextSerial: exhaustedSerial,
      entities: [0, 1].map(() => ({
        id: duplicateId,
        kind,
        feetPosition: { x: 0, y: 64, z: 0 },
        healthPoints: 20,
        behaviour: { _tag: 'Restored' },
      })),
    }],
    rosterRepairSchema, serialExhaustedSchema,
  )
  if (Result.isFailure(exhaustedRestoreResult)) {
    expect(Schema.decodeUnknownSync(serialExhaustedSchema)(exhaustedRestoreResult.failure)).toStrictEqual({
      _tag: 'EntitySerialExhausted',
    })
  } else {
    Schema.decodeUnknownSync(rosterRepairSchema)(exhaustedRestoreResult.success)
  }
  expect(Result.isFailure(exhaustedRestoreResult)).toBe(true)

  const managerApi = await Effect.runPromise(makeEntityManager<EntityBehaviour>())
  await fc.assert(
    fc.asyncProperty(hostileValue, async (idOrKind) => {
      const found = Schema.decodeUnknownSync(entityOrUndefinedSchema)(
        await Effect.runPromise(invokeEffect(managerApi.find, [idOrKind])),
      )
      const despawned = Schema.decodeUnknownSync(Schema.Boolean)(
        await Effect.runPromise(invokeEffect(managerApi.despawn, [idOrKind])),
      )
      const count = await Effect.runPromise(invokeEffect(managerApi.countOfKind, [idOrKind]))
      expect(found).toBeUndefined()
      expect(despawned).toBe(false)
      expect(count).toBe(0)
    }),
    checks,
  )
})

const saveCoordinatorChunk = (cx: number, cz: number): DimensionChunk => {
  const chunk: Chunk = {
    coord: chunkCoord(Result.getOrThrow(ChunkAxis.result(cx)), Result.getOrThrow(ChunkAxis.result(cz))),
    blocks: new Uint16Array(1),
    biomes: [],
  }
  return { dimension: 'overworld', chunk }
}

it('save coordinator decodes requestSave outcomes and publishes the known, retained, resident snapshot', async () => {
  type State = { readonly tick: number }
  const publications = await Effect.runPromise(Ref.make<ReadonlyArray<SaveCoordinatorPublication<State>>>([]))
  const coordinator = await Effect.runPromise(makeSaveCoordinator<State, never>({
    initialKnownChunks: [saveCoordinatorChunk(0, 0)],
    snapshotResidents: Effect.succeed([saveCoordinatorChunk(1, 0)]),
    currentGeneration: Effect.succeed(7),
    snapshotState: Effect.succeed({ tick: 42 }),
    publish: (publication) => Ref.update(publications, (all) => [...all, publication]),
  }))
  await Effect.runPromise(coordinator.retainChunk(saveCoordinatorChunk(2, 0)))

  const successSchema = PublicApplication.SaveCoordinatorRequestSaveSuccessSchema
  const errorSchema = PublicApplication.saveCoordinatorRequestSaveErrorSchema(Schema.Never)
  const outcome = await assertEffectResult(
    'SaveCoordinator.requestSave stable publication', () => coordinator.requestSave, [], successSchema, errorSchema,
  )
  expect(Result.isSuccess(outcome)).toBe(true)
  if (Result.isSuccess(outcome)) {
    expect(Schema.decodeUnknownSync(successSchema)(outcome.success)).toBeUndefined()
  }

  const [publication] = await Effect.runPromise(Ref.get(publications))
  expect(publication?.state).toStrictEqual({ tick: 42 })
  expect(publication?.chunks.map(({ dimension, chunk }) =>
    `${dimension}:${String(chunk.coord.cx)},${String(chunk.coord.cz)}`,
  ).sort()).toStrictEqual(['overworld:0,0', 'overworld:1,0', 'overworld:2,0'])
  expect(await Effect.runPromise(coordinator.knownChunkCount)).toBe(3)
  expect(await Effect.runPromise(coordinator.retainedChunkCount)).toBe(0)
})

it('save coordinator decodes caller publish errors through the declared error union', async () => {
  const coordinator = await Effect.runPromise(makeSaveCoordinator<{ readonly tick: number }, string>({
    initialKnownChunks: [],
    snapshotResidents: Effect.succeed([]),
    currentGeneration: Effect.succeed(1),
    snapshotState: Effect.succeed({ tick: 1 }),
    publish: () => Effect.fail('storage quota exceeded'),
  }))
  const successSchema = PublicApplication.SaveCoordinatorRequestSaveSuccessSchema
  const errorSchema = PublicApplication.saveCoordinatorRequestSaveErrorSchema(Schema.String)
  const outcome = await assertEffectResult(
    'SaveCoordinator.requestSave caller publication failure', () => coordinator.requestSave, [], successSchema,
    errorSchema,
  )
  expect(Result.isFailure(outcome)).toBe(true)
  if (Result.isFailure(outcome)) {
    expect(Schema.decodeUnknownSync(errorSchema)(outcome.failure)).toBe('storage quota exceeded')
  }
})

it('save coordinator decodes the typed failure after every snapshot generation remains unstable', async () => {
  type State = { readonly tick: number }
  const coordinatorDeferred = await Effect.runPromise(Deferred.make<SaveCoordinatorApi<never>>())
  const retainViaCoordinator = (chunk: DimensionChunk): Effect.Effect<void> =>
    Effect.flatMap(Deferred.await(coordinatorDeferred), (api) => api.retainChunk(chunk))
  let attempts = 0
  const snapshotResidents = Effect.suspend((): Effect.Effect<ReadonlyArray<DimensionChunk>> => {
    attempts += 1
    return Effect.andThen(
      retainViaCoordinator(saveCoordinatorChunk(attempts, 0)),
      Effect.succeed<ReadonlyArray<DimensionChunk>>([]),
    )
  })
  const publicationCount = await Effect.runPromise(Ref.make(0))
  const coordinator = await Effect.runPromise(makeSaveCoordinator<State, never>({
    initialKnownChunks: [],
    snapshotResidents,
    currentGeneration: Effect.succeed(1),
    snapshotState: Effect.succeed({ tick: 1 }),
    publish: () => Ref.update(publicationCount, (count) => count + 1),
  }))
  await Effect.runPromise(Deferred.succeed(coordinatorDeferred, coordinator))

  const successSchema = PublicApplication.SaveCoordinatorRequestSaveSuccessSchema
  const errorSchema = PublicApplication.saveCoordinatorRequestSaveErrorSchema(Schema.Never)
  const outcome = await assertEffectResult(
    'SaveCoordinator.requestSave unstable generation', () => coordinator.requestSave, [], successSchema, errorSchema,
  )
  expect(Result.isFailure(outcome)).toBe(true)
  if (Result.isFailure(outcome)) {
    const error = Schema.decodeUnknownSync(errorSchema)(outcome.failure)
    expect(error).toBeInstanceOf(PublicApplication.SaveSnapshotConsistencyError)
    expect(error).toMatchObject({ _tag: 'SaveSnapshotConsistencyError', attempts: 8 })
  }
  expect(attempts).toBe(8)
  expect(await Effect.runPromise(Ref.get(publicationCount))).toBe(0)
  expect(await Effect.runPromise(coordinator.knownChunkCount)).toBe(0)
  expect(await Effect.runPromise(coordinator.retainedChunkCount)).toBe(8)
})

const applicationPropertySimulationSave = Schema.decodeUnknownSync(PublicApplication.SIMULATION_SAVE_SCHEMA)({
  dimension: 'overworld',
  tick: 7,
  player: {
    position: { x: 3.5, y: 64, z: -7.25 },
    inventory: [],
    selectedHotbarSlot: 0,
  },
  statistics: { counters: {}, unlocked: [] },
})

it('simulation save boundary decodes void and Option outcomes while preserving stored state', async () => {
  const storage = await Effect.runPromise(makeInMemoryStorage)
  const storageLayer = Layer.succeed(StoragePort, storage)
  const key = simulationSaveKey('application-property-save-roundtrip')
  const saveSuccessSchema = PublicApplication.SaveSimulationSuccessSchema
  const loadSuccessSchema = PublicApplication.LoadSimulationSuccessSchema
  const errorSchema = PublicApplication.SimulationSaveErrorSchema

  const saveOutcome = await assertEffectResult(
    'saveSimulation valid save',
    () => invokeEffect(saveSimulation, [key, applicationPropertySimulationSave]).pipe(Effect.provide(storageLayer)),
    [], saveSuccessSchema, errorSchema,
  )
  expect(Result.isSuccess(saveOutcome)).toBe(true)
  if (Result.isSuccess(saveOutcome)) {
    expect(Schema.decodeUnknownSync(saveSuccessSchema)(saveOutcome.success)).toBeUndefined()
  }

  const stored = await Effect.runPromise(storage.get(key))
  expect(Option.isSome(stored)).toBe(true)
  expect(await Effect.runPromise(storage.keys)).toStrictEqual([key])

  const loadOutcome = await assertEffectResult(
    'loadSimulation saved value', () => invokeEffect(loadSimulation, [key]).pipe(Effect.provide(storageLayer)),
    [], loadSuccessSchema, errorSchema,
  )
  expect(Result.isSuccess(loadOutcome)).toBe(true)
  if (Result.isSuccess(loadOutcome)) {
    const loaded = Schema.decodeUnknownSync(loadSuccessSchema)(loadOutcome.success)
    expect(Option.isSome(loaded)).toBe(true)
    if (Option.isSome(loaded)) expect(loaded.value).toStrictEqual(applicationPropertySimulationSave)
  }
})

it('saveSimulation decodes hostile save failures and leaves storage unchanged', async () => {
  const saveSuccessSchema = PublicApplication.SaveSimulationSuccessSchema
  const errorSchema = PublicApplication.SimulationSaveErrorSchema

  await fc.assert(
    fc.asyncProperty(hostileValue, async (value) => {
      const storage = await Effect.runPromise(makeInMemoryStorage)
      const storageLayer = Layer.succeed(StoragePort, storage)
      const key = simulationSaveKey('application-property-invalid-save')
      const malformedPayload = { _tag: 'HostileSaveCandidate', value }
      const outcome = await assertEffectResult(
        'saveSimulation malformed payload',
        () => invokeEffect(saveSimulation, [key, malformedPayload]).pipe(Effect.provide(storageLayer)),
        [], saveSuccessSchema, errorSchema,
      )
      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        const error = Schema.decodeUnknownSync(errorSchema)(outcome.failure)
        expect(error._tag).toBe('SaveDecodeError')
      }
      expect(await Effect.runPromise(storage.keys)).toStrictEqual([])
    }),
    checks,
  )
})

it('loadSimulation returns the declared Option.none for arbitrary non-blank missing keys', async () => {
  const loadSuccessSchema = PublicApplication.LoadSimulationSuccessSchema
  const errorSchema = PublicApplication.SimulationSaveErrorSchema

  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1 }).filter((rawKey) => rawKey.trim().length > 0), async (rawKey) => {
      const storage = await Effect.runPromise(makeInMemoryStorage)
      const storageLayer = Layer.succeed(StoragePort, storage)
      const key = simulationSaveKey(rawKey)
      const outcome = await assertEffectResult(
        'loadSimulation missing key', () => invokeEffect(loadSimulation, [key]).pipe(Effect.provide(storageLayer)),
        [], loadSuccessSchema, errorSchema,
      )
      expect(Result.isSuccess(outcome)).toBe(true)
      if (Result.isSuccess(outcome)) {
        expect(Option.isNone(Schema.decodeUnknownSync(loadSuccessSchema)(outcome.success))).toBe(true)
      }
      expect(await Effect.runPromise(storage.keys)).toStrictEqual([])
    }),
    checks,
  )
})

it('save and load decode storage failures through their declared error union', async () => {
  const storageFailureLayer = failingStorageLayer(StorageOperation('simulation-property-storage-failure'))
  const saveSuccessSchema = PublicApplication.SaveSimulationSuccessSchema
  const loadSuccessSchema = PublicApplication.LoadSimulationSuccessSchema
  const errorSchema = PublicApplication.SimulationSaveErrorSchema
  const key = simulationSaveKey('application-property-storage-failure')

  const saveOutcome = await assertEffectResult(
    'saveSimulation storage failure',
    () => invokeEffect(saveSimulation, [key, applicationPropertySimulationSave]).pipe(
      Effect.provide(storageFailureLayer),
    ),
    [], saveSuccessSchema, errorSchema,
  )
  expect(Result.isFailure(saveOutcome)).toBe(true)
  if (Result.isFailure(saveOutcome)) {
    expect(Schema.decodeUnknownSync(errorSchema)(saveOutcome.failure)._tag).toBe('StorageError')
  }

  const loadOutcome = await assertEffectResult(
    'loadSimulation storage failure',
    () => invokeEffect(loadSimulation, [key]).pipe(Effect.provide(storageFailureLayer)),
    [], loadSuccessSchema, errorSchema,
  )
  expect(Result.isFailure(loadOutcome)).toBe(true)
  if (Result.isFailure(loadOutcome)) {
    expect(Schema.decodeUnknownSync(errorSchema)(loadOutcome.failure)._tag).toBe('StorageError')
  }
})

const propertyMigrationRegistrations = (
  restored: Array<readonly [string, unknown]>,
  failOn?: string,
): SimulationSaveV3Registrations<string, never> => {
  const registration = (id: 'player' | 'time' | 'inventory' | 'statistics') => ({
    id: Schema.decodeUnknownSync(SaveSliceIdSchema)(id),
    version: Schema.decodeUnknownSync(SaveVersionSchema)(1),
    schema: Schema.Unknown,
    snapshot: Effect.succeed(undefined),
    restore: (state: unknown): Effect.Effect<void, string> => Effect.suspend(() => {
      restored.push([id, state])
      return failOn === id ? Effect.fail(`restore failed: ${id}`) : Effect.void
    }),
    migrations: [],
  })
  return {
    player: registration('player'),
    time: registration('time'),
    inventory: registration('inventory'),
    statistics: registration('statistics'),
  }
}

const propertyLegacySimulationSave = (tick: number) => ({
  dimension: 'overworld',
  tick,
  player: {
    position: { x: 0, y: 64, z: 0 },
    inventory: [],
    selectedHotbarSlot: 0,
  },
  statistics: { counters: {}, unlocked: [] },
})

it('legacy migration decodes void success after restoring all four slices without discard', async () => {
  const successSchema = PublicApplication.SimulationSaveV3MigrationSuccessSchema
  const errorSchema = PublicApplication.simulationSaveV3MigrationErrorSchema(Schema.String)

  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 100_000 }), async (tick) => {
      const restored: Array<readonly [string, unknown]> = []
      let discarded = 0
      const outcome = await assertEffectResult(
        'migrateSimulationSaveV3 valid legacy payload',
        () => invokeEffect(migrateSimulationSaveV3<string, never>, [
          propertyLegacySimulationSave(tick),
          propertyMigrationRegistrations(restored),
          () => Effect.sync(() => { discarded += 1 }),
        ]),
        [], successSchema, errorSchema,
      )
      expect(Result.isSuccess(outcome)).toBe(true)
      if (Result.isSuccess(outcome)) {
        expect(Schema.decodeUnknownSync(successSchema)(outcome.success)).toBeUndefined()
      }
      expect(restored.map(([id]) => id)).toEqual(['player', 'time', 'inventory', 'statistics'])
      expect(restored[0]?.[1]).toStrictEqual({
        dimension: 'overworld',
        pose: { feetPosition: { x: 0, y: 64, z: 0 }, yawRadians: 0, pitchRadians: 0 },
      })
      expect(restored[1]?.[1]).toStrictEqual({ ticks: tick, dayLengthTicks: 24000 })
      expect(restored[2]?.[1]).toStrictEqual({ inventory: { slots: [] }, selectedHotbarSlot: 0 })
      expect(restored[3]?.[1]).toStrictEqual({ counters: {}, unlocked: [] })
      expect(discarded).toBe(0)
    }),
    checks,
  )
})

it('legacy migration decodes invalid V3 payloads and discards before any restore', async () => {
  const successSchema = PublicApplication.SimulationSaveV3MigrationSuccessSchema
  const errorSchema = PublicApplication.simulationSaveV3MigrationErrorSchema(Schema.String)

  await fc.assert(
    fc.asyncProperty(hostileValue, async (value) => {
      const restored: Array<readonly [string, unknown]> = []
      let discarded = 0
      const malformedPayload = { _tag: 'HostileV3Payload', value }
      const outcome = await assertEffectResult(
        'migrateSimulationSaveV3 invalid V3 payload',
        () => invokeEffect(migrateSimulationSaveV3<string, never>, [
          malformedPayload,
          null,
          () => Effect.sync(() => { discarded += 1 }),
        ]),
        [], successSchema, errorSchema,
      )
      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(Schema.decodeUnknownSync(errorSchema)(outcome.failure)).toBeInstanceOf(Schema.SchemaError)
      }
      expect(restored).toEqual([])
      expect(discarded).toBe(1)
    }),
    checks,
  )
})

it('legacy migration decodes RestoreError and discards a partially restored session', async () => {
  const successSchema = PublicApplication.SimulationSaveV3MigrationSuccessSchema
  const errorSchema = PublicApplication.simulationSaveV3MigrationErrorSchema(Schema.String)
  const restored: Array<readonly [string, unknown]> = []
  let discarded = 0
  const outcome = await assertEffectResult(
    'migrateSimulationSaveV3 restore failure',
    () => invokeEffect(migrateSimulationSaveV3<string, never>, [
      propertyLegacySimulationSave(42),
      propertyMigrationRegistrations(restored, 'inventory'),
      () => Effect.sync(() => { discarded += 1 }),
    ]),
    [], successSchema, errorSchema,
  )
  expect(Result.isFailure(outcome)).toBe(true)
  if (Result.isFailure(outcome)) {
    expect(Schema.decodeUnknownSync(errorSchema)(outcome.failure)).toBe('restore failed: inventory')
  }
  expect(restored.map(([id]) => id)).toEqual(['player', 'time', 'inventory'])
  expect(discarded).toBe(1)
})

it('player, settings, and weather services preserve valid finite snapshots after hostile inputs', async () => {
  const player = await Effect.runPromise(makePlayerService())
  const settings = await Effect.runPromise(makeSettingsService())
  const weather = await Effect.runPromise(makeWeatherService())
  const lookSuccessSchema = PublicApplication.PlayerServiceLookSuccessSchema
  const lookErrorSchema = PublicApplication.PlayerServiceLookErrorSchema
  const weatherSuccessSchema = PublicApplication.WeatherStateSchema
  const weatherErrorSchema = PublicApplication.WeatherValidationFailureSchema
  const decodeWeatherState = (value: unknown) =>
    Schema.decodeUnknownSync(weatherSuccessSchema, { onExcessProperty: 'error' })(value)
  const decodeWeatherError = (value: unknown) =>
    Schema.decodeUnknownSync(weatherErrorSchema, { onExcessProperty: 'error' })(value)

  await fc.assert(
    fc.asyncProperty(hostileNumber, async (value) => {
      const poseBeforeLook = await Effect.runPromise(player.pose)
      const lookOutcome = await assertEffectResult(
        'PlayerService.look hostile deltas', player.look, [value, value],
        lookSuccessSchema, lookErrorSchema,
      )
      if (Result.isSuccess(lookOutcome)) {
        const pose = Schema.decodeUnknownSync(lookSuccessSchema)(lookOutcome.success)
        expect(await Effect.runPromise(player.pose)).toEqual(pose)
      } else {
        expect(Schema.decodeUnknownSync(lookErrorSchema)(lookOutcome.failure)).toEqual(lookOutcome.failure)
        expect(await Effect.runPromise(player.pose)).toEqual(poseBeforeLook)
      }

      await Effect.runPromise(invokeEffect(settings.restore, [value]))
      await Effect.runPromise(settings.snapshot)

      const stateBeforeCandidate = decodeWeatherState(await Effect.runPromise(weather.snapshot))
      const candidateOutcome = await assertEffectResult(
        'WeatherService.candidateTransition hostile input', weather.candidateTransition, [value, value],
        weatherSuccessSchema, weatherErrorSchema,
      )
      if (Result.isSuccess(candidateOutcome)) {
        decodeWeatherState(candidateOutcome.success)
      } else {
        expect(decodeWeatherError(candidateOutcome.failure)).toEqual({
          _tag: 'WeatherValidationFailure', field: 'weather', reason: 'unknown-weather',
        })
      }
      expect(Result.isFailure(candidateOutcome)).toBe(true)
      expect(decodeWeatherState(await Effect.runPromise(weather.snapshot))).toEqual(stateBeforeCandidate)

      const stateBeforeApply = decodeWeatherState(await Effect.runPromise(weather.snapshot))
      const applyOutcome = await assertEffectResult(
        'WeatherService.applyTransition hostile input', weather.applyTransition, [value],
        weatherSuccessSchema, weatherErrorSchema,
      )
      if (Result.isSuccess(applyOutcome)) {
        decodeWeatherState(applyOutcome.success)
      } else {
        expect(decodeWeatherError(applyOutcome.failure)).toEqual({
          _tag: 'WeatherValidationFailure', field: 'state', reason: 'not-object',
        })
      }
      expect(Result.isFailure(applyOutcome)).toBe(true)
      expect(decodeWeatherState(await Effect.runPromise(weather.snapshot))).toEqual(stateBeforeApply)

      const restoreOutcome = await assertEffectResult(
        'WeatherService.restore normalized hostile input', weather.restore, [value],
        Schema.Undefined, Schema.Never,
      )
      if (Result.isSuccess(restoreOutcome)) {
        expect(Schema.decodeUnknownSync(Schema.Undefined)(restoreOutcome.success)).toBeUndefined()
      }
      expect(Result.isSuccess(restoreOutcome)).toBe(true)
      expect(decodeWeatherState(await Effect.runPromise(weather.snapshot))).toEqual(
        PublicApplication.normaliseWeatherState(value),
      )
    }),
    checks,
  )

  await fc.assert(
    fc.asyncProperty(
      fc.tuple(
        fc.constantFrom(...PublicApplication.WEATHERS),
        fc.integer({ min: 1, max: 1_000_000 }).map((tenths) => tenths / 10),
      ),
      async ([nextWeather, remainingSecs]) => {
        const service = await Effect.runPromise(makeWeatherService({ weather: 'thunder', remainingSecs: 17 }))
        const stateBeforeCandidate = decodeWeatherState(await Effect.runPromise(service.snapshot))
        const candidateOutcome = await assertEffectResult(
          'WeatherService.candidateTransition valid input', service.candidateTransition, [nextWeather, remainingSecs],
          weatherSuccessSchema, weatherErrorSchema,
        )
        let candidate: unknown
        if (Result.isSuccess(candidateOutcome)) {
          candidate = decodeWeatherState(candidateOutcome.success)
          expect(candidate).toEqual({ weather: nextWeather, remainingSecs })
        } else {
          expect(decodeWeatherError(candidateOutcome.failure)).toBeDefined()
        }
        expect(Result.isSuccess(candidateOutcome)).toBe(true)
        expect(decodeWeatherState(await Effect.runPromise(service.snapshot))).toEqual(stateBeforeCandidate)

        if (Result.isSuccess(candidateOutcome)) {
          const applyOutcome = await assertEffectResult(
            'WeatherService.applyTransition valid candidate', service.applyTransition, [candidate],
            weatherSuccessSchema, weatherErrorSchema,
          )
          if (Result.isSuccess(applyOutcome)) {
            const applied = decodeWeatherState(applyOutcome.success)
            expect(applied).toEqual(candidate)
            expect(decodeWeatherState(await Effect.runPromise(service.snapshot))).toEqual(applied)
          } else {
            expect(decodeWeatherError(applyOutcome.failure)).toBeDefined()
            expect(decodeWeatherState(await Effect.runPromise(service.snapshot))).toEqual(stateBeforeCandidate)
          }
          expect(Result.isSuccess(applyOutcome)).toBe(true)
        }
      },
    ),
    checks,
  )

  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom<unknown>(
        null,
        undefined,
        false,
        [],
        {},
        { weather: 'snow', remainingSecs: 30 },
        { weather: 'rain', remainingSecs: 0 },
        { weather: 'thunder', remainingSecs: Number.NaN },
        { weather: 'clear', remainingSecs: Number.POSITIVE_INFINITY },
      ),
      async (invalidTransition) => {
        const service = await Effect.runPromise(makeWeatherService({ weather: 'thunder', remainingSecs: 17 }))
        const stateBefore = decodeWeatherState(await Effect.runPromise(service.snapshot))
        const outcome = await assertEffectResult(
          'WeatherService.applyTransition invalid state', service.applyTransition, [invalidTransition],
          weatherSuccessSchema, weatherErrorSchema,
        )
        if (Result.isSuccess(outcome)) {
          decodeWeatherState(outcome.success)
        } else {
          decodeWeatherError(outcome.failure)
        }
        expect(Result.isFailure(outcome)).toBe(true)
        expect(decodeWeatherState(await Effect.runPromise(service.snapshot))).toEqual(stateBefore)
      },
    ),
    checks,
  )

  await fc.assert(
    fc.asyncProperty(
      fc.tuple(
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
      ),
      async ([deltaYaw, deltaPitch]) => {
        const validPlayer = await Effect.runPromise(makePlayerService())
        const poseBeforeLook = await Effect.runPromise(validPlayer.pose)
        const outcome = await assertEffectResult(
          'PlayerService.look valid deltas', validPlayer.look, [deltaYaw, deltaPitch],
          lookSuccessSchema, lookErrorSchema,
        )
        if (Result.isSuccess(outcome)) {
          const pose = Schema.decodeUnknownSync(lookSuccessSchema)(outcome.success)
          expect(pose.yawRadians).toBe(poseBeforeLook.yawRadians + deltaYaw)
          expect(pose.pitchRadians).toBe(
            Math.max(
              Camera.PITCH_MIN_RADIANS,
              Math.min(Camera.PITCH_MAX_RADIANS, poseBeforeLook.pitchRadians + deltaPitch),
            ),
          )
          expect(pose.feetPosition).toEqual(Camera.INITIAL_PLAYER_POSE.feetPosition)
          expect(await Effect.runPromise(validPlayer.pose)).toEqual(pose)
        } else {
          expect(Schema.decodeUnknownSync(lookErrorSchema)(outcome.failure)).toEqual(outcome.failure)
          expect(await Effect.runPromise(validPlayer.pose)).toEqual(poseBeforeLook)
        }
        expect(Result.isSuccess(outcome)).toBe(true)
      },
    ),
    checks,
  )

  await fc.assert(
    fc.asyncProperty(hostileNumber, async (value) => {
      const pose = {
        ...Camera.INITIAL_PLAYER_POSE,
        yawRadians: value,
        pitchRadians: value,
      }
      await assertEffectResult(
        'PlayerService.restore', player.restore, [pose, 'overworld'],
        Schema.Undefined, PublicApplication.PlayerServiceInputErrorSchema,
      )
    }),
    checks,
  )
})

it('stage movement inputs stay bounded and invalid physics configuration is a typed failure', async () => {
  const state = await Effect.runPromise(makeSimFrameState)
  const input = makeSimInputPort(state)

  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileNumber, hostileNumber), async ([forward, strafe]) => {
      await Effect.runPromise(invokeEffect(input.setMovementIntent, [{ forward, strafe }]))
      const movement = await Effect.runPromise(Ref.get(state.movementIntent))
      expect(Number.isFinite(movement.forward)).toBe(true)
      expect(Number.isFinite(movement.strafe)).toBe(true)
      expect(movement.forward).toBeGreaterThanOrEqual(-1)
      expect(movement.forward).toBeLessThanOrEqual(1)
      expect(movement.strafe).toBeGreaterThanOrEqual(-1)
      expect(movement.strafe).toBeLessThanOrEqual(1)
    }),
    checks,
  )

  await fc.assert(
    fc.asyncProperty(hostileNumber, async (walkSpeed) => {
      if (typeof walkSpeed === 'number' && Number.isFinite(walkSpeed) && walkSpeed >= 0) return
      const effect = invoke(makeSimStagesWithPhysics, [{
        resolve: {},
        walkSpeed,
        jumpSpeed: 0,
      }]) as Effect.Effect<unknown, unknown, never>
      const outcome = await Effect.runPromise(Effect.result(effect))
      assertEffectOutcome(
        'makeSimStagesWithPhysics invalid walkSpeed',
        () => outcome,
        PublicApplication.SimPhysicsStagesSchema,
        PublicApplication.SimPhysicsConfigErrorSchema,
      )
      expect(Result.isFailure(outcome)).toBe(true)
    }),
    checks,
  )
})


it('world commits validate hostile dimension expectation collections before conflict construction', async () => {
  const world = Schema.decodeUnknownSync(WorldIdSchema)('dimension-expectation-property-world')
  const coordinator = await Effect.runPromise(makeWorldCommitCoordinator({ world, owners: [] }))
  const deltaSchema = replicatedWorldDeltaSchema(
    replicatedOwnerChangeSchema(makeReplicatedOwnerId('dimension-expectation-owner'), Schema.Struct({ value: Schema.Finite })),
  )
  const malformedDimensions = fc.oneof(
    fc.constantFrom<unknown>(null, undefined, 0, 'overworld', {}),
    fc.array(
      fc.oneof(
        hostileValue,
        fc.record({ dimension: hostileValue, expectedRevision: hostileNumber }),
      ),
      { maxLength: 3 },
    ),
  )

  await fc.assert(
    fc.asyncProperty(malformedDimensions, async (expectedDimensions) => {
      const outcome = await Effect.runPromise(
        Effect.result(invokeEffect(coordinator.commit, [{
          expectedRevision: 0,
          expectedDimensions,
          changes: [],
        }])),
      )
      const validCollection = Array.isArray(expectedDimensions) && expectedDimensions.every((entry) => {
        if (!isRecord(entry) || !DIMENSIONS.some((dimension) => dimension === entry['dimension'])) return false
        return Schema.decodeUnknownResult(DimensionRevisionSchema)(entry['expectedRevision'])._tag === 'Success'
      })

      if (!validCollection) {
        expect(outcome._tag).toBe('Failure')
        if (outcome._tag === 'Failure') {
          expect(Schema.is(PublicApplication.SchemaErrorSchema)(outcome.failure)).toBe(true)
        }
      }
      assertEffectOutcome(
        'WorldCommitCoordinator.commit dimension expectations', () => outcome,
        deltaSchema, WorldCommitCoordinatorErrorSchema,
      )
    }),
    checks,
  )
})

it('crop, equipment, and vehicle services keep hostile requests and snapshots safe', async () => {
  const crops = await Effect.runPromise(PublicApplication.makeCropService())
  const equipment = await Effect.runPromise(PublicApplication.makeEquipmentService())

  const captureCropOutcome = async (
    propertyName: string,
    effect: Effect.Effect<unknown, unknown, never>,
    successSchema: Schema.ConstraintDecoder<unknown>,
    failureSchema: Schema.ConstraintDecoder<unknown>,
  ): Promise<Result.Result<unknown, unknown>> => {
    const outcome = await Effect.runPromise(Effect.result(effect))
    const conforms = Result.isFailure(outcome)
      ? Schema.is(failureSchema)(outcome.failure)
      : Schema.is(successSchema)(outcome.success)
    expect(conforms, propertyName + ' runtime Schema').toBe(true)
    const decoded = Result.isFailure(outcome)
      ? Schema.decodeUnknownResult(failureSchema, { onExcessProperty: 'error' })(outcome.failure)
      : Schema.decodeUnknownResult(successSchema, { onExcessProperty: 'error' })(outcome.success)
    expect(decoded._tag, propertyName).toBe('Success')
    return outcome
  }

  const assertCropOperation = async (
    propertyName: string,
    effect: Effect.Effect<unknown, unknown, never>,
    successSchema: Schema.ConstraintDecoder<unknown>,
    failureSchema: Schema.ConstraintDecoder<unknown>,
  ): Promise<Result.Result<unknown, unknown>> => {
    const before = await captureCropOutcome(
      propertyName + ' snapshot before',
      crops.snapshot,
      PublicApplication.CropServiceSnapshotSuccessSchema,
      PublicApplication.CropServiceNoFailureSchema,
    )
    const outcome = await captureCropOutcome(propertyName, effect, successSchema, failureSchema)
    const after = await captureCropOutcome(
      propertyName + ' snapshot after',
      crops.snapshot,
      PublicApplication.CropServiceSnapshotSuccessSchema,
      PublicApplication.CropServiceNoFailureSchema,
    )
    if (Result.isFailure(outcome) && Result.isSuccess(before) && Result.isSuccess(after)) {
      expect(after.success).toEqual(before.success)
    }
    return outcome
  }

  const captureEquipmentOutcome = async (
    propertyName: string,
    effect: Effect.Effect<unknown, unknown, never>,
    successSchema: Schema.ConstraintDecoder<unknown>,
    failureSchema: Schema.ConstraintDecoder<unknown>,
  ): Promise<Result.Result<unknown, unknown>> => {
    const outcome = await Effect.runPromise(Effect.result(effect))
    const decoded = Result.isFailure(outcome)
      ? Schema.decodeUnknownResult(failureSchema, { onExcessProperty: 'error' })(outcome.failure)
      : Schema.decodeUnknownResult(successSchema, { onExcessProperty: 'error' })(outcome.success)
    expect(decoded._tag, propertyName).toBe('Success')
    return outcome
  }

  const assertEquipmentOperation = async (
    propertyName: string,
    effect: Effect.Effect<unknown, unknown, never>,
    successSchema: Schema.ConstraintDecoder<unknown>,
    failureSchema: Schema.ConstraintDecoder<unknown>,
  ): Promise<Result.Result<unknown, unknown>> => {
    const before = await captureEquipmentOutcome(
      propertyName + ' snapshot before',
      equipment.snapshot,
      PublicApplication.EquipmentServiceSnapshotSuccessSchema,
      PublicApplication.EquipmentServiceNoFailureSchema,
    )
    const outcome = await captureEquipmentOutcome(propertyName, effect, successSchema, failureSchema)
    const after = await captureEquipmentOutcome(
      propertyName + ' snapshot after',
      equipment.snapshot,
      PublicApplication.EquipmentServiceSnapshotSuccessSchema,
      PublicApplication.EquipmentServiceNoFailureSchema,
    )
    if (Result.isFailure(outcome) && Result.isSuccess(before) && Result.isSuccess(after)) {
      expect(after.success).toEqual(before.success)
    }
    return outcome
  }

  let vehicles: PublicApplication.VehicleServiceApi | undefined

  const captureVehicleOutcome = async (
    propertyName: string,
    effect: Effect.Effect<unknown, unknown, never>,
    successSchema: Schema.ConstraintDecoder<unknown>,
    failureSchema: Schema.ConstraintDecoder<unknown>,
  ): Promise<Result.Result<unknown, unknown>> => {
    const outcome = await Effect.runPromise(Effect.result(effect))
    const decoded = Result.isFailure(outcome)
      ? Schema.decodeUnknownResult(failureSchema, { onExcessProperty: 'error' })(outcome.failure)
      : Schema.decodeUnknownResult(successSchema, { onExcessProperty: 'error' })(outcome.success)
    expect(decoded._tag, propertyName).toBe('Success')
    return outcome
  }

  const requireVehicleSuccess = <A>(
    outcome: Result.Result<unknown, unknown>,
    schema: Schema.ConstraintDecoder<A>,
  ): A => {
    if (Result.isFailure(outcome)) throw outcome.failure
    const decoded = Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(outcome.success)
    expect(decoded._tag, 'Vehicle success decoding').toBe('Success')
    if (Result.isFailure(decoded)) throw decoded.failure
    return decoded.success
  }

  const assertVehicleOperation = async (
    propertyName: string,
    effect: Effect.Effect<unknown, unknown, never>,
    successSchema: Schema.ConstraintDecoder<unknown>,
    failureSchema: Schema.ConstraintDecoder<unknown>,
  ): Promise<Result.Result<unknown, unknown>> => {
    if (vehicles === undefined) throw new Error('VehicleService must be initialized before its operations are checked')
    const before = await captureVehicleOutcome(
      propertyName + ' snapshot before',
      vehicles.snapshot,
      PublicApplication.VehicleServiceSnapshotSuccessSchema,
      PublicApplication.VehicleServiceNoFailureSchema,
    )
    const outcome = await captureVehicleOutcome(propertyName, effect, successSchema, failureSchema)
    const after = await captureVehicleOutcome(
      propertyName + ' snapshot after',
      vehicles.snapshot,
      PublicApplication.VehicleServiceSnapshotSuccessSchema,
      PublicApplication.VehicleServiceNoFailureSchema,
    )
    if (Result.isFailure(outcome) && Result.isSuccess(before) && Result.isSuccess(after)) {
      expect(after.success).toEqual(before.success)
    }
    return outcome
  }

  const initialVehicleService = await Effect.runPromise(Effect.result(PublicApplication.makeVehicleService()))
  if (Result.isFailure(initialVehicleService)) {
    expect(Schema.is(PublicApplication.VehicleServiceValidationErrorSchema)(initialVehicleService.failure)).toBe(true)
    const decoded = Schema.decodeUnknownResult(PublicApplication.VehicleServiceValidationErrorSchema, {
      onExcessProperty: 'error',
    })(initialVehicleService.failure)
    expect(decoded._tag, 'VehicleService factory failure').toBe('Success')
    throw new Error('default VehicleService factory unexpectedly failed')
  }
  vehicles = initialVehicleService.success
  const vehicleService = vehicles
  const initialVehicleSnapshot = await captureVehicleOutcome(
    'VehicleService.snapshot initial state',
    vehicleService.snapshot,
    PublicApplication.VehicleServiceSnapshotSuccessSchema,
    PublicApplication.VehicleServiceNoFailureSchema,
  )
  const initialVehicleList = await captureVehicleOutcome(
    'VehicleService.vehicles initial state',
    vehicleService.vehicles,
    PublicApplication.VehicleServiceVehiclesSuccessSchema,
    PublicApplication.VehicleServiceNoFailureSchema,
  )
  expect(Result.isSuccess(initialVehicleSnapshot)).toBe(true)
  expect(Result.isSuccess(initialVehicleList)).toBe(true)
  if (Result.isSuccess(initialVehicleSnapshot) && Result.isSuccess(initialVehicleList)) {
    const decodedSnapshot = requireVehicleSuccess(initialVehicleSnapshot, PublicApplication.VehicleSnapshotSchema)
    const decodedVehicles = requireVehicleSuccess(initialVehicleList, PublicApplication.VehicleServiceVehiclesSuccessSchema)
    expect(decodedSnapshot).toEqual({ vehicles: [], nextSerial: 0 })
    expect(decodedVehicles).toEqual(decodedSnapshot.vehicles)
  }

  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileValue, hostileNumber), async ([value, amount]) => {
      const resetEquipment = await assertEquipmentOperation(
        'EquipmentService.reset',
        equipment.reset,
        PublicApplication.EquipmentServiceResetSuccessSchema,
        PublicApplication.EquipmentServiceNoFailureSchema,
      )
      expect(Result.isSuccess(resetEquipment)).toBe(true)
      const initialEquipment = await captureEquipmentOutcome(
        'EquipmentService.snapshot initial',
        equipment.snapshot,
        PublicApplication.EquipmentServiceSnapshotSuccessSchema,
        PublicApplication.EquipmentServiceNoFailureSchema,
      )
      expect(Result.isSuccess(initialEquipment)).toBe(true)
      if (Result.isSuccess(initialEquipment)) {
        expect(initialEquipment.success).toEqual({
          slots: { head: null, chest: null, legs: null, feet: null, offhand: null },
        })
      }
      const reset = await assertCropOperation(
        'CropService.reset',
        crops.reset,
        PublicApplication.CropServiceResetSuccessSchema,
        PublicApplication.CropServiceNoFailureSchema,
      )
      expect(Result.isSuccess(reset)).toBe(true)

      const location = {
        dimension: value,
        position: { x: amount, y: value, z: amount },
      }
      await assertCropOperation(
        'CropService.plant',
        invokeEffect(crops.plant, [location, value, value]),
        PublicApplication.CropServicePlantSuccessSchema,
        PublicApplication.CropServiceValidationErrorSchema,
      )
      await assertCropOperation(
        'CropService.cropAt',
        invokeEffect(crops.cropAt, [location]),
        PublicApplication.CropServiceCropAtSuccessSchema,
        PublicApplication.CropServiceValidationErrorSchema,
      )
      await assertCropOperation(
        'CropService.matureYieldsAt',
        invokeEffect(crops.matureYieldsAt, [location]),
        PublicApplication.CropServiceMatureYieldsSuccessSchema,
        PublicApplication.CropServiceMatureYieldsErrorSchema,
      )
      await assertCropOperation(
        'CropService.remove',
        invokeEffect(crops.remove, [location]),
        PublicApplication.CropServiceRemoveSuccessSchema,
        PublicApplication.CropServiceValidationErrorSchema,
      )
      await assertCropOperation(
        'CropService.advance',
        invokeEffect(crops.advance, [amount]),
        PublicApplication.CropServiceAdvanceSuccessSchema,
        PublicApplication.CropServiceNoFailureSchema,
      )
      await assertCropOperation(
        'CropService.advanceByBoneMeal',
        invokeEffect(crops.advanceByBoneMeal, [location]),
        PublicApplication.CropServiceAdvanceByBoneMealSuccessSchema,
        PublicApplication.CropServiceValidationErrorSchema,
      )
      await assertCropOperation(
        'CropService.restore',
        invokeEffect(crops.restore, [value]),
        PublicApplication.CropServiceRestoreSuccessSchema,
        PublicApplication.CropServiceValidationErrorSchema,
      )
      const snapshot = await captureCropOutcome(
        'CropService.snapshot',
        crops.snapshot,
        PublicApplication.CropServiceSnapshotSuccessSchema,
        PublicApplication.CropServiceNoFailureSchema,
      )
      expect(Result.isSuccess(snapshot)).toBe(true)

      await assertEquipmentOperation(
        'EquipmentService.equip',
        invokeEffect(equipment.equip, [value, value]),
        PublicApplication.EquipmentServiceEquipSuccessSchema,
        PublicApplication.EquipmentServiceValidationErrorSchema,
      )
      await assertEquipmentOperation(
        'EquipmentService.unequip',
        invokeEffect(equipment.unequip, [value]),
        PublicApplication.EquipmentServiceUnequipSuccessSchema,
        PublicApplication.EquipmentServiceValidationErrorSchema,
      )
      await assertEquipmentOperation(
        'EquipmentService.swap',
        invokeEffect(equipment.swap, [value, value]),
        PublicApplication.EquipmentServiceSwapSuccessSchema,
        PublicApplication.EquipmentServiceValidationErrorSchema,
      )
      await assertEquipmentOperation(
        'EquipmentService.damage',
        invokeEffect(equipment.damage, [value, amount]),
        PublicApplication.EquipmentServiceDamageSuccessSchema,
        PublicApplication.EquipmentServiceValidationErrorSchema,
      )
      await assertEquipmentOperation(
        'EquipmentService.restore',
        invokeEffect(equipment.restore, [value]),
        PublicApplication.EquipmentServiceRestoreSuccessSchema,
        PublicApplication.EquipmentServiceValidationErrorSchema,
      )
      const equipmentSnapshot = await captureEquipmentOutcome(
        'EquipmentService.snapshot after hostile requests',
        equipment.snapshot,
        PublicApplication.EquipmentServiceSnapshotSuccessSchema,
        PublicApplication.EquipmentServiceNoFailureSchema,
      )
      expect(Result.isSuccess(equipmentSnapshot)).toBe(true)

      const factoryOutcome = await Effect.runPromise(
        Effect.result(invokeEffect(PublicApplication.makeVehicleService, [value])),
      )
      if (Result.isFailure(factoryOutcome)) {
        expect(Schema.is(PublicApplication.VehicleServiceValidationErrorSchema)(factoryOutcome.failure)).toBe(true)
        const decoded = Schema.decodeUnknownResult(PublicApplication.VehicleServiceValidationErrorSchema, {
          onExcessProperty: 'error',
        })(factoryOutcome.failure)
        expect(decoded._tag, 'VehicleService factory hostile failure').toBe('Success')
      } else {
        const factorySnapshot = await captureVehicleOutcome(
          'VehicleService factory hostile snapshot',
          factoryOutcome.success.snapshot,
          PublicApplication.VehicleServiceSnapshotSuccessSchema,
          PublicApplication.VehicleServiceNoFailureSchema,
        )
        const factoryVehicles = await captureVehicleOutcome(
          'VehicleService factory hostile vehicles',
          factoryOutcome.success.vehicles,
          PublicApplication.VehicleServiceVehiclesSuccessSchema,
          PublicApplication.VehicleServiceNoFailureSchema,
        )
        expect(Result.isSuccess(factorySnapshot)).toBe(true)
        expect(Result.isSuccess(factoryVehicles)).toBe(true)
        if (Result.isSuccess(factorySnapshot) && Result.isSuccess(factoryVehicles)) {
          const decodedSnapshot = requireVehicleSuccess(factorySnapshot, PublicApplication.VehicleSnapshotSchema)
          const decodedVehicles = requireVehicleSuccess(factoryVehicles, PublicApplication.VehicleServiceVehiclesSuccessSchema)
          expect(decodedVehicles).toEqual(decodedSnapshot.vehicles)
        }
      }

      const emptyVehicleState = await assertVehicleOperation(
        'VehicleService.restore empty baseline',
        vehicleService.restore(PublicApplication.emptyVehicleSnapshot()),
        PublicApplication.VehicleServiceRestoreSuccessSchema,
        PublicApplication.VehicleServiceValidationErrorSchema,
      )
      expect(Result.isSuccess(emptyVehicleState)).toBe(true)
      const emptyVehicleSnapshot = await captureVehicleOutcome(
        'VehicleService.snapshot empty baseline',
        vehicleService.snapshot,
        PublicApplication.VehicleServiceSnapshotSuccessSchema,
        PublicApplication.VehicleServiceNoFailureSchema,
      )
      expect(Result.isSuccess(emptyVehicleSnapshot)).toBe(true)
      if (Result.isSuccess(emptyVehicleSnapshot)) {
        expect(emptyVehicleSnapshot.success).toEqual({ vehicles: [], nextSerial: 0 })
      }

      const vector = { x: amount, y: value, z: amount }
      await assertVehicleOperation(
        'VehicleService.spawn hostile',
        invokeEffect(vehicleService.spawn, [value, value, vector, amount]),
        PublicApplication.VehicleServiceSpawnSuccessSchema,
        PublicApplication.VehicleServiceOperationErrorSchema,
      )
      const despawn = await assertVehicleOperation(
        'VehicleService.despawn hostile',
        invokeEffect(vehicleService.despawn, [value]),
        PublicApplication.VehicleServiceDespawnSuccessSchema,
        PublicApplication.VehicleServiceNoFailureSchema,
      )
      expect(Result.isSuccess(despawn)).toBe(true)
      await assertVehicleOperation(
        'VehicleService.mount hostile',
        invokeEffect(vehicleService.mount, [value, value]),
        PublicApplication.VehicleServiceMountSuccessSchema,
        PublicApplication.VehicleServiceOperationErrorSchema,
      )
      await assertVehicleOperation(
        'VehicleService.dismount hostile',
        invokeEffect(vehicleService.dismount, [value, value]),
        PublicApplication.VehicleServiceDismountSuccessSchema,
        PublicApplication.VehicleServiceOperationErrorSchema,
      )
      await assertVehicleOperation(
        'VehicleService.updateVelocity hostile',
        invokeEffect(vehicleService.updateVelocity, [value, vector]),
        PublicApplication.VehicleServiceUpdateVelocitySuccessSchema,
        PublicApplication.VehicleServiceOperationErrorSchema,
      )
      await assertVehicleOperation(
        'VehicleService.updateTransform hostile',
        invokeEffect(vehicleService.updateTransform, [value, value, vector, amount]),
        PublicApplication.VehicleServiceUpdateTransformSuccessSchema,
        PublicApplication.VehicleServiceOperationErrorSchema,
      )
      await assertVehicleOperation(
        'VehicleService.updateState hostile',
        invokeEffect(vehicleService.updateState, [value, {
        dimension: value,
        position: vector,
        velocity: vector,
        yawRadians: amount,
        }]),
        PublicApplication.VehicleServiceUpdateStateSuccessSchema,
        PublicApplication.VehicleServiceOperationErrorSchema,
      )
      await assertVehicleOperation(
        'VehicleService.restore hostile',
        invokeEffect(vehicleService.restore, [value]),
        PublicApplication.VehicleServiceRestoreSuccessSchema,
        PublicApplication.VehicleServiceValidationErrorSchema,
      )
      await captureVehicleOutcome(
        'VehicleService.snapshot after hostile requests',
        vehicleService.snapshot,
        PublicApplication.VehicleServiceSnapshotSuccessSchema,
        PublicApplication.VehicleServiceNoFailureSchema,
      )
      await captureVehicleOutcome(
        'VehicleService.vehicles after hostile requests',
        vehicleService.vehicles,
        PublicApplication.VehicleServiceVehiclesSuccessSchema,
        PublicApplication.VehicleServiceNoFailureSchema,
      )
    }),
    checks,
  )

  const validVehicleBaseline = await assertVehicleOperation(
    'VehicleService.restore lifecycle baseline',
    vehicleService.restore(PublicApplication.emptyVehicleSnapshot()),
    PublicApplication.VehicleServiceRestoreSuccessSchema,
    PublicApplication.VehicleServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(validVehicleBaseline)).toBe(true)
  const vehiclePosition = Schema.decodeUnknownSync(PublicApplication.VehiclePositionSchema)({
    x: 1,
    y: 64,
    z: 2,
  })
  const secondPosition = Schema.decodeUnknownSync(PublicApplication.VehiclePositionSchema)({
    x: 3,
    y: 64,
    z: 4,
  })
  const vehicleVelocity = Schema.decodeUnknownSync(PublicApplication.VehicleVelocitySchema)({
    x: 0.5,
    y: -1,
    z: 2,
  })

  const spawnedVehicle = await assertVehicleOperation(
    'VehicleService.spawn valid boat',
    invokeEffect(vehicleService.spawn, ['boat', 'overworld', vehiclePosition, Math.PI / 2]),
    PublicApplication.VehicleServiceSpawnSuccessSchema,
    PublicApplication.VehicleServiceOperationErrorSchema,
  )
  const firstVehicle = requireVehicleSuccess(spawnedVehicle, PublicApplication.VehicleSchema)
  expect(firstVehicle).toMatchObject({ id: 'v:0', type: 'boat', dimension: 'overworld' })
  const spawnedCart = await assertVehicleOperation(
    'VehicleService.spawn valid minecart',
    invokeEffect(vehicleService.spawn, ['minecart', 'overworld', secondPosition, 0]),
    PublicApplication.VehicleServiceSpawnSuccessSchema,
    PublicApplication.VehicleServiceOperationErrorSchema,
  )
  const secondVehicle = requireVehicleSuccess(spawnedCart, PublicApplication.VehicleSchema)
  expect(secondVehicle.id).toBe('v:1')

  const mounted = await assertVehicleOperation(
    'VehicleService.mount valid occupant',
    vehicleService.mount(firstVehicle.id, PublicApplication.OccupantId('rider')),
    PublicApplication.VehicleServiceMountSuccessSchema,
    PublicApplication.VehicleServiceOperationErrorSchema,
  )
  expect(Result.isSuccess(mounted)).toBe(true)
  const duplicateOccupant = await assertVehicleOperation(
    'VehicleService.mount duplicate occupant',
    vehicleService.mount(secondVehicle.id, PublicApplication.OccupantId('rider')),
    PublicApplication.VehicleServiceMountSuccessSchema,
    PublicApplication.VehicleServiceOperationErrorSchema,
  )
  expect(Result.isFailure(duplicateOccupant)).toBe(true)
  if (Result.isFailure(duplicateOccupant)) expect(duplicateOccupant.failure).toMatchObject({ reason: 'duplicate-occupant' })
  const mountedSecond = await assertVehicleOperation(
    'VehicleService.mount second occupant',
    vehicleService.mount(secondVehicle.id, PublicApplication.OccupantId('passenger')),
    PublicApplication.VehicleServiceMountSuccessSchema,
    PublicApplication.VehicleServiceOperationErrorSchema,
  )
  expect(Result.isSuccess(mountedSecond)).toBe(true)
  const snapshotAfterMounts = await captureVehicleOutcome(
    'VehicleService.snapshot after mounts',
    vehicleService.snapshot,
    PublicApplication.VehicleServiceSnapshotSuccessSchema,
    PublicApplication.VehicleServiceNoFailureSchema,
  )
  expect(requireVehicleSuccess(snapshotAfterMounts, PublicApplication.VehicleSnapshotSchema).vehicles).toMatchObject([
    { id: 'v:0', occupant: 'rider' },
    { id: 'v:1', occupant: 'passenger' },
  ])

  const velocityUpdate = await assertVehicleOperation(
    'VehicleService.updateVelocity valid',
    vehicleService.updateVelocity(firstVehicle.id, vehicleVelocity),
    PublicApplication.VehicleServiceUpdateVelocitySuccessSchema,
    PublicApplication.VehicleServiceOperationErrorSchema,
  )
  expect(Result.isSuccess(velocityUpdate)).toBe(true)
  const transformUpdate = await assertVehicleOperation(
    'VehicleService.updateTransform valid',
    invokeEffect(vehicleService.updateTransform, [firstVehicle.id, 'nether', secondPosition, Math.PI]),
    PublicApplication.VehicleServiceUpdateTransformSuccessSchema,
    PublicApplication.VehicleServiceOperationErrorSchema,
  )
  expect(Result.isSuccess(transformUpdate)).toBe(true)
  const stateUpdate = await assertVehicleOperation(
    'VehicleService.updateState valid',
    invokeEffect(vehicleService.updateState, [firstVehicle.id, {
      dimension: 'end',
      position: vehiclePosition,
      velocity: vehicleVelocity,
      yawRadians: 0.25,
      occupant: PublicApplication.OccupantId('rider'),
    }]),
    PublicApplication.VehicleServiceUpdateStateSuccessSchema,
    PublicApplication.VehicleServiceOperationErrorSchema,
  )
  expect(Result.isSuccess(stateUpdate)).toBe(true)
  const duplicateStateOccupant = await assertVehicleOperation(
    'VehicleService.updateState duplicate occupant',
    invokeEffect(vehicleService.updateState, [secondVehicle.id, {
      dimension: 'overworld',
      position: secondPosition,
      velocity: vehicleVelocity,
      yawRadians: 0,
      occupant: PublicApplication.OccupantId('rider'),
    }]),
    PublicApplication.VehicleServiceUpdateStateSuccessSchema,
    PublicApplication.VehicleServiceOperationErrorSchema,
  )
  expect(Result.isFailure(duplicateStateOccupant)).toBe(true)
  if (Result.isFailure(duplicateStateOccupant)) {
    expect(duplicateStateOccupant.failure).toMatchObject({ reason: 'duplicate-occupant' })
  }

  const validVehicleSnapshotOutcome = await captureVehicleOutcome(
    'VehicleService.snapshot after updates',
    vehicleService.snapshot,
    PublicApplication.VehicleServiceSnapshotSuccessSchema,
    PublicApplication.VehicleServiceNoFailureSchema,
  )
  const validVehicleSnapshot = requireVehicleSuccess(
    validVehicleSnapshotOutcome,
    PublicApplication.VehicleSnapshotSchema,
  )
  expect(validVehicleSnapshot.vehicles).toMatchObject([
    { id: 'v:0', dimension: 'end', velocity: { x: 0.5, y: -1, z: 2 }, occupant: 'rider' },
    { id: 'v:1', dimension: 'overworld', occupant: 'passenger' },
  ])
  const dismounted = await assertVehicleOperation(
    'VehicleService.dismount valid occupant',
    vehicleService.dismount(secondVehicle.id, PublicApplication.OccupantId('passenger')),
    PublicApplication.VehicleServiceDismountSuccessSchema,
    PublicApplication.VehicleServiceOperationErrorSchema,
  )
  expect(Result.isSuccess(dismounted)).toBe(true)
  const snapshotAfterDismount = await captureVehicleOutcome(
    'VehicleService.snapshot after dismount',
    vehicleService.snapshot,
    PublicApplication.VehicleServiceSnapshotSuccessSchema,
    PublicApplication.VehicleServiceNoFailureSchema,
  )
  expect(requireVehicleSuccess(snapshotAfterDismount, PublicApplication.VehicleSnapshotSchema).vehicles).toMatchObject([
    { id: 'v:0', occupant: 'rider' },
    { id: 'v:1' },
  ])
  const vehicleValidRestore = await assertVehicleOperation(
    'VehicleService.restore valid snapshot',
    vehicleService.restore(validVehicleSnapshot),
    PublicApplication.VehicleServiceRestoreSuccessSchema,
    PublicApplication.VehicleServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(vehicleValidRestore)).toBe(true)
  const snapshotAfterRestore = await captureVehicleOutcome(
    'VehicleService.snapshot after valid restore',
    vehicleService.snapshot,
    PublicApplication.VehicleServiceSnapshotSuccessSchema,
    PublicApplication.VehicleServiceNoFailureSchema,
  )
  expect(requireVehicleSuccess(snapshotAfterRestore, PublicApplication.VehicleSnapshotSchema)).toEqual(validVehicleSnapshot)
  const vehicleInvalidRestore = await assertVehicleOperation(
    'VehicleService.restore malformed snapshot',
    vehicleService.restore({ vehicles: [{ _tag: 'Vehicle' }], nextSerial: -1 }),
    PublicApplication.VehicleServiceRestoreSuccessSchema,
    PublicApplication.VehicleServiceValidationErrorSchema,
  )
  expect(Result.isFailure(vehicleInvalidRestore)).toBe(true)

  const firstDespawn = await assertVehicleOperation(
    'VehicleService.despawn first vehicle',
    vehicleService.despawn(firstVehicle.id),
    PublicApplication.VehicleServiceDespawnSuccessSchema,
    PublicApplication.VehicleServiceNoFailureSchema,
  )
  expect(Result.isSuccess(firstDespawn) && firstDespawn.success).toBe(true)
  const secondDespawn = await assertVehicleOperation(
    'VehicleService.despawn second vehicle',
    vehicleService.despawn(secondVehicle.id),
    PublicApplication.VehicleServiceDespawnSuccessSchema,
    PublicApplication.VehicleServiceNoFailureSchema,
  )
  expect(Result.isSuccess(secondDespawn) && secondDespawn.success).toBe(true)
  const repeatedDespawn = await assertVehicleOperation(
    'VehicleService.despawn missing vehicle',
    vehicleService.despawn(firstVehicle.id),
    PublicApplication.VehicleServiceDespawnSuccessSchema,
    PublicApplication.VehicleServiceNoFailureSchema,
  )
  expect(Result.isSuccess(repeatedDespawn) && repeatedDespawn.success).toBe(false)
  const finalVehicleSnapshot = await captureVehicleOutcome(
    'VehicleService.snapshot after despawn',
    vehicleService.snapshot,
    PublicApplication.VehicleServiceSnapshotSuccessSchema,
    PublicApplication.VehicleServiceNoFailureSchema,
  )
  expect(Result.isSuccess(finalVehicleSnapshot)).toBe(true)
  if (Result.isSuccess(finalVehicleSnapshot)) {
    expect(finalVehicleSnapshot.success).toMatchObject({ vehicles: [], nextSerial: 2 })
  }

  const location = Schema.decodeUnknownSync(PublicApplication.CropLocationSchema)({
    dimension: DIMENSIONS[0],
    position: { x: 7, y: 64, z: -3 },
  })
  const plant = await assertCropOperation(
    'CropService.plant valid potato',
    crops.plant(location, 'potato_crop'),
    PublicApplication.CropServicePlantSuccessSchema,
    PublicApplication.CropServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(plant) && plant.success).toBe(true)

  const plantedSnapshot = await captureCropOutcome(
    'CropService.snapshot after plant',
    crops.snapshot,
    PublicApplication.CropServiceSnapshotSuccessSchema,
    PublicApplication.CropServiceNoFailureSchema,
  )
  expect(Result.isSuccess(plantedSnapshot)).toBe(true)
  if (Result.isSuccess(plantedSnapshot)) {
    expect(plantedSnapshot.success).toMatchObject({
      crops: [{ crop: 'potato_crop', growthSecs: 0 }],
    })
  }

  const duplicatePlant = await assertCropOperation(
    'CropService.plant duplicate location',
    crops.plant(location, 'potato_crop'),
    PublicApplication.CropServicePlantSuccessSchema,
    PublicApplication.CropServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(duplicatePlant)).toBe(true)
  if (Result.isSuccess(duplicatePlant)) expect(duplicatePlant.success).toBe(false)

  const immatureYields = await assertCropOperation(
    'CropService.matureYieldsAt before maturity',
    crops.matureYieldsAt(location),
    PublicApplication.CropServiceMatureYieldsSuccessSchema,
    PublicApplication.CropServiceMatureYieldsErrorSchema,
  )
  expect(Result.isSuccess(immatureYields) && immatureYields.success).toBeNull()

  for (let growth = 0; growth < 16; growth += 1) {
    const advanced = await assertCropOperation(
      'CropService.advanceByBoneMeal',
      crops.advanceByBoneMeal(location),
      PublicApplication.CropServiceAdvanceByBoneMealSuccessSchema,
      PublicApplication.CropServiceValidationErrorSchema,
    )
    expect(Result.isSuccess(advanced) && advanced.success).toBe(true)
  }

  const matureCrop = await assertCropOperation(
    'CropService.cropAt after bone meal',
    crops.cropAt(location),
    PublicApplication.CropServiceCropAtSuccessSchema,
    PublicApplication.CropServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(matureCrop) && matureCrop.success).toMatchObject({
    crop: 'potato_crop',
    growthSecs: PublicApplication.POTATO_MATURITY_SECS,
  })
  const matureYields = await assertCropOperation(
    'CropService.matureYieldsAt at maturity',
    crops.matureYieldsAt(location),
    PublicApplication.CropServiceMatureYieldsSuccessSchema,
    PublicApplication.CropServiceMatureYieldsErrorSchema,
  )
  expect(Result.isSuccess(matureYields) && Array.isArray(matureYields.success)).toBe(true)
  const matureBoneMeal = await assertCropOperation(
    'CropService.advanceByBoneMeal at maturity',
    crops.advanceByBoneMeal(location),
    PublicApplication.CropServiceAdvanceByBoneMealSuccessSchema,
    PublicApplication.CropServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(matureBoneMeal)).toBe(true)
  if (Result.isSuccess(matureBoneMeal)) expect(matureBoneMeal.success).toBe(false)

  const validRestore = await assertCropOperation(
    'CropService.restore valid snapshot',
    crops.restore(Result.isSuccess(plantedSnapshot) ? plantedSnapshot.success : undefined),
    PublicApplication.CropServiceRestoreSuccessSchema,
    PublicApplication.CropServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(validRestore)).toBe(true)

  const invalidRestore = await assertCropOperation(
    'CropService.restore malformed snapshot',
    crops.restore({ crops: [{ dimension: 'moon' }] }),
    PublicApplication.CropServiceRestoreSuccessSchema,
    PublicApplication.CropServiceValidationErrorSchema,
  )
  expect(Result.isFailure(invalidRestore)).toBe(true)

  const removed = await assertCropOperation(
    'CropService.remove planted crop',
    crops.remove(location),
    PublicApplication.CropServiceRemoveSuccessSchema,
    PublicApplication.CropServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(removed)).toBe(true)
  if (Result.isSuccess(removed)) expect(removed.success).not.toBeNull()
  const emptyCropAt = await assertCropOperation(
    'CropService.cropAt after remove',
    crops.cropAt(location),
    PublicApplication.CropServiceCropAtSuccessSchema,
    PublicApplication.CropServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(emptyCropAt) && emptyCropAt.success).toBeNull()
  const missingYields = await assertCropOperation(
    'CropService.matureYieldsAt after remove',
    crops.matureYieldsAt(location),
    PublicApplication.CropServiceMatureYieldsSuccessSchema,
    PublicApplication.CropServiceMatureYieldsErrorSchema,
  )
  expect(Result.isSuccess(missingYields) && missingYields.success).toBeNull()
  const removedSnapshot = await captureCropOutcome(
    'CropService.snapshot after remove',
    crops.snapshot,
    PublicApplication.CropServiceSnapshotSuccessSchema,
    PublicApplication.CropServiceNoFailureSchema,
  )
  expect(Result.isSuccess(removedSnapshot)).toBe(true)
  if (Result.isSuccess(removedSnapshot)) expect(removedSnapshot.success).toMatchObject({ crops: [] })
  const reset = await assertCropOperation(
    'CropService.reset after lifecycle',
    crops.reset,
    PublicApplication.CropServiceResetSuccessSchema,
    PublicApplication.CropServiceNoFailureSchema,
  )
  expect(Result.isSuccess(reset)).toBe(true)
  const resetSnapshot = await captureCropOutcome(
    'CropService.snapshot after reset',
    crops.snapshot,
    PublicApplication.CropServiceSnapshotSuccessSchema,
    PublicApplication.CropServiceNoFailureSchema,
  )
  expect(Result.isSuccess(resetSnapshot)).toBe(true)
  if (Result.isSuccess(resetSnapshot)) expect(resetSnapshot.success).toMatchObject({ crops: [] })

  const requireValue = <A, E>(result: Result.Result<A, E>): A => {
    if (Result.isFailure(result)) throw result.failure
    return result.success
  }
  const helmet = requireValue(PublicApplication.equipmentItem(
    requireValue(PublicApplication.itemStack('iron_helmet', 1)),
    requireValue(PublicApplication.durability(165, 165)),
  ))
  const flint = requireValue(PublicApplication.equipmentItem(
    requireValue(PublicApplication.itemStack('flint_and_steel', 1)),
    requireValue(PublicApplication.durability(64, 64)),
  ))

  const clearEquipment = await assertEquipmentOperation(
    'EquipmentService.reset before lifecycle',
    equipment.reset,
    PublicApplication.EquipmentServiceResetSuccessSchema,
    PublicApplication.EquipmentServiceNoFailureSchema,
  )
  expect(Result.isSuccess(clearEquipment)).toBe(true)
  const emptyEquipment = await captureEquipmentOutcome(
    'EquipmentService.snapshot after reset',
    equipment.snapshot,
    PublicApplication.EquipmentServiceSnapshotSuccessSchema,
    PublicApplication.EquipmentServiceNoFailureSchema,
  )
  expect(Result.isSuccess(emptyEquipment)).toBe(true)
  if (Result.isSuccess(emptyEquipment)) {
    expect(emptyEquipment.success).toEqual({
      slots: { head: null, chest: null, legs: null, feet: null, offhand: null },
    })
  }

  const equippedHelmet = await assertEquipmentOperation(
    'EquipmentService.equip helmet',
    equipment.equip('head', helmet),
    PublicApplication.EquipmentServiceEquipSuccessSchema,
    PublicApplication.EquipmentServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(equippedHelmet)).toBe(true)
  if (Result.isSuccess(equippedHelmet)) expect(equippedHelmet.success).toBeNull()
  const equippedFlint = await assertEquipmentOperation(
    'EquipmentService.equip flint',
    equipment.equip('offhand', flint),
    PublicApplication.EquipmentServiceEquipSuccessSchema,
    PublicApplication.EquipmentServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(equippedFlint)).toBe(true)
  if (Result.isSuccess(equippedFlint)) expect(equippedFlint.success).toBeNull()

  const savedEquipment = await captureEquipmentOutcome(
    'EquipmentService.snapshot before damage',
    equipment.snapshot,
    PublicApplication.EquipmentServiceSnapshotSuccessSchema,
    PublicApplication.EquipmentServiceNoFailureSchema,
  )
  expect(Result.isSuccess(savedEquipment)).toBe(true)
  if (Result.isSuccess(savedEquipment)) {
    expect(savedEquipment.success).toMatchObject({
      slots: { head: { item: 'iron_helmet' }, offhand: { item: 'flint_and_steel' } },
    })
  }

  const swap = await assertEquipmentOperation(
    'EquipmentService.swap incompatible slots',
    equipment.swap('head', 'offhand'),
    PublicApplication.EquipmentServiceSwapSuccessSchema,
    PublicApplication.EquipmentServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(swap)).toBe(true)
  const afterSwap = await captureEquipmentOutcome(
    'EquipmentService.snapshot after incompatible swap',
    equipment.snapshot,
    PublicApplication.EquipmentServiceSnapshotSuccessSchema,
    PublicApplication.EquipmentServiceNoFailureSchema,
  )
  if (Result.isSuccess(savedEquipment) && Result.isSuccess(afterSwap)) {
    expect(afterSwap.success).toEqual(savedEquipment.success)
  }

  const damaged = await assertEquipmentOperation(
    'EquipmentService.damage',
    equipment.damage('head', 10),
    PublicApplication.EquipmentServiceDamageSuccessSchema,
    PublicApplication.EquipmentServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(damaged)).toBe(true)
  if (Result.isSuccess(damaged)) {
    expect(damaged.success).toMatchObject({
      _tag: 'Damaged',
      item: { item: 'iron_helmet', durability: { current: 155, max: 165 } },
      applied: 10,
    })
  }

  const broken = await assertEquipmentOperation(
    'EquipmentService.damage to break',
    equipment.damage('head', 155),
    PublicApplication.EquipmentServiceDamageSuccessSchema,
    PublicApplication.EquipmentServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(broken)).toBe(true)
  if (Result.isSuccess(broken)) expect(broken.success).toMatchObject({ _tag: 'Broken', applied: 155 })
  const afterBreak = await captureEquipmentOutcome(
    'EquipmentService.snapshot after break',
    equipment.snapshot,
    PublicApplication.EquipmentServiceSnapshotSuccessSchema,
    PublicApplication.EquipmentServiceNoFailureSchema,
  )
  expect(Result.isSuccess(afterBreak)).toBe(true)
  if (Result.isSuccess(afterBreak)) {
    expect(afterBreak.success).toMatchObject({
      slots: { head: null, offhand: { item: 'flint_and_steel' } },
    })
  }

  const restored = await assertEquipmentOperation(
    'EquipmentService.restore valid snapshot',
    equipment.restore(Result.isSuccess(savedEquipment) ? savedEquipment.success : undefined),
    PublicApplication.EquipmentServiceRestoreSuccessSchema,
    PublicApplication.EquipmentServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(restored)).toBe(true)
  const malformedRestore = await assertEquipmentOperation(
    'EquipmentService.restore malformed snapshot',
    equipment.restore({ slots: {} }),
    PublicApplication.EquipmentServiceRestoreSuccessSchema,
    PublicApplication.EquipmentServiceValidationErrorSchema,
  )
  expect(Result.isFailure(malformedRestore)).toBe(true)

  const unequippedHelmet = await assertEquipmentOperation(
    'EquipmentService.unequip helmet',
    equipment.unequip('head'),
    PublicApplication.EquipmentServiceUnequipSuccessSchema,
    PublicApplication.EquipmentServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(unequippedHelmet)).toBe(true)
  if (Result.isSuccess(unequippedHelmet)) {
    expect(unequippedHelmet.success).toMatchObject({ item: 'iron_helmet' })
  }
  const stateBeforeInvalidDamage = await captureEquipmentOutcome(
    'EquipmentService.snapshot before invalid damage',
    equipment.snapshot,
    PublicApplication.EquipmentServiceSnapshotSuccessSchema,
    PublicApplication.EquipmentServiceNoFailureSchema,
  )
  const invalidDamage = await assertEquipmentOperation(
    'EquipmentService.damage invalid amount',
    equipment.damage('head', Number.POSITIVE_INFINITY),
    PublicApplication.EquipmentServiceDamageSuccessSchema,
    PublicApplication.EquipmentServiceValidationErrorSchema,
  )
  expect(Result.isSuccess(invalidDamage)).toBe(true)
  if (Result.isSuccess(invalidDamage)) {
    expect(invalidDamage.success).toMatchObject({ _tag: 'InvalidAmount', amount: Number.POSITIVE_INFINITY })
  }
  const stateAfterInvalidDamage = await captureEquipmentOutcome(
    'EquipmentService.snapshot after invalid damage',
    equipment.snapshot,
    PublicApplication.EquipmentServiceSnapshotSuccessSchema,
    PublicApplication.EquipmentServiceNoFailureSchema,
  )
  if (Result.isSuccess(stateBeforeInvalidDamage) && Result.isSuccess(stateAfterInvalidDamage)) {
    expect(stateAfterInvalidDamage.success).toEqual(stateBeforeInvalidDamage.success)
  }

  const finalReset = await assertEquipmentOperation(
    'EquipmentService.reset after lifecycle',
    equipment.reset,
    PublicApplication.EquipmentServiceResetSuccessSchema,
    PublicApplication.EquipmentServiceNoFailureSchema,
  )
  expect(Result.isSuccess(finalReset)).toBe(true)
  const finalEquipment = await captureEquipmentOutcome(
    'EquipmentService.snapshot after lifecycle reset',
    equipment.snapshot,
    PublicApplication.EquipmentServiceSnapshotSuccessSchema,
    PublicApplication.EquipmentServiceNoFailureSchema,
  )
  expect(Result.isSuccess(finalEquipment)).toBe(true)
  if (Result.isSuccess(finalEquipment)) {
    expect(finalEquipment.success).toEqual({
      slots: { head: null, chest: null, legs: null, feet: null, offhand: null },
    })
  }
})

it('fishing, projectile, and TNT coordinators return typed outcomes for hostile request fields', async () => {
  const fishOwner = makeReplicatedOwnerId('application-property-fishing')
  const world = Schema.decodeUnknownSync(WorldIdSchema)('application-property-services-world')
  const subscriberCapacity = Schema.decodeUnknownSync(PublicApplication.EventSubscriberCapacitySchema)(1)
  const coordinatorLayer = PublicApplication.WorldCommitCoordinatorLayer({
    world,
    owners: [
      PublicApplication.fishingOwnerRegistration(fishOwner),
      {
        ownerId: PublicApplication.PROJECTILE_REPLICATED_OWNER_ID,
        schema: PublicApplication.ProjectileServiceSnapshotSchema,
        initialState: PublicApplication.INITIAL_PROJECTILE_SERVICE_SNAPSHOT,
      },
      PublicApplication.tntOwnerRegistration(),
    ],
  })
  const environment = Layer.mergeAll(
    coordinatorLayer,
    PublicApplication.DomainEventBusLayer(subscriberCapacity),
  )
  const services = await Effect.runPromise(
    Effect.gen(function* () {
      const fishing = yield* Effect.result(PublicApplication.makeFishingService(fishOwner))
      const projectiles = yield* PublicApplication.makeProjectileService()
      const tnt = yield* PublicApplication.makeTntService()
      const coordinator = yield* PublicApplication.WorldCommitCoordinator
      return { fishing, projectiles, tnt, coordinator }
    }).pipe(Effect.provide(environment)),
  )
  if (Result.isFailure(services.fishing)) {
    const decoded = Schema.decodeUnknownResult(
      PublicApplication.FishingServiceErrorSchema,
      { onExcessProperty: 'error' },
    )(services.fishing.failure)
    expect(decoded._tag, 'FishingService construction error Schema').toBe('Success')
    throw services.fishing.failure
  }
  const fishing = services.fishing.success

  const captureFishingOutcome = async (
    propertyName: string,
    effect: Effect.Effect<unknown, unknown, never>,
    successSchema: Schema.ConstraintDecoder<unknown>,
  ): Promise<Result.Result<unknown, unknown>> => {
    const outcome = await Effect.runPromise(Effect.result(effect))
    const conforms = Result.isFailure(outcome)
      ? Schema.is(PublicApplication.FishingServiceErrorSchema)(outcome.failure)
      : Schema.is(successSchema)(outcome.success)
    expect(conforms, propertyName + ' runtime Schema').toBe(true)
    const decoded = Result.isFailure(outcome)
      ? Schema.decodeUnknownResult(PublicApplication.FishingServiceErrorSchema, { onExcessProperty: 'error' })(outcome.failure)
      : Schema.decodeUnknownResult(successSchema, { onExcessProperty: 'error' })(outcome.success)
    expect(decoded._tag, propertyName).toBe('Success')
    return outcome
  }

  const requireFishingSuccess = <A>(
    outcome: Result.Result<unknown, unknown>,
    schema: Schema.ConstraintDecoder<A>,
  ): A => {
    if (Result.isFailure(outcome)) throw outcome.failure
    const decoded = Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(outcome.success)
    expect(decoded._tag, 'Fishing success decoding').toBe('Success')
    if (Result.isFailure(decoded)) throw decoded.failure
    return decoded.success
  }

  const captureFishingState = async (propertyName: string): Promise<FishingState> => {
    const snapshot = await captureFishingOutcome(
      propertyName,
      fishing.snapshot,
      PublicApplication.FishingServiceSnapshotSuccessSchema,
    )
    return requireFishingSuccess(snapshot, PublicApplication.FishingStateSchema)
  }

  const assertFishingStateInvariants = (state: FishingState): void => {
    const actors = state.rods.map((rod) => rod.actor)
    expect(new Set(actors).size).toBe(actors.length)
  }

  const assertFishingOperation = async (
    propertyName: string,
    effect: Effect.Effect<unknown, unknown, never>,
    successSchema: Schema.ConstraintDecoder<unknown>,
  ): Promise<Readonly<{
    outcome: Result.Result<unknown, unknown>
    before: FishingState
    after: FishingState
  }>> => {
    const before = await captureFishingState(propertyName + ' snapshot before')
    const outcome = await captureFishingOutcome(propertyName, effect, successSchema)
    const after = await captureFishingState(propertyName + ' snapshot after')
    if (Result.isFailure(outcome)) expect(after).toEqual(before)
    else assertFishingStateInvariants(after)
    return { outcome, before, after }
  }

  expect(await captureFishingState('FishingService.snapshot initial')).toEqual({ rods: [] })

  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), async (index) => {
      const actor = Schema.decodeUnknownSync(EntityIdSchema)(`property-angler-${index}`)
      const bobber = Schema.decodeUnknownSync(ProjectileIdSchema)(`property-bobber-${index}`)
      const tick = Schema.decodeUnknownSync(SimulationTickSchema)(index)

      const cast = await assertFishingOperation(
        'FishingService.cast valid input',
        invokeEffect(fishing.cast, [actor, bobber]),
        PublicApplication.FishingServiceCastSuccessSchema,
      )
      expect(Result.isSuccess(cast.outcome)).toBe(true)
      if (Result.isSuccess(cast.outcome)) {
        expect(cast.after.rods).toContainEqual({ actor, bobber, phase: 'cast' })
      }

      const bite = await assertFishingOperation(
        'FishingService.bite valid input',
        invokeEffect(fishing.bite, [actor]),
        PublicApplication.FishingServiceBiteSuccessSchema,
      )
      expect(Result.isSuccess(bite.outcome)).toBe(true)
      if (Result.isSuccess(bite.outcome)) {
        expect(bite.after.rods.find((rod) => rod.actor === actor)?.phase).toBe('bite')
      }

      const reel = await assertFishingOperation(
        'FishingService.reel valid input',
        invokeEffect(fishing.reel, [actor, tick]),
        PublicApplication.FishingServiceReelSuccessSchema,
      )
      expect(Result.isSuccess(reel.outcome)).toBe(true)
      if (Result.isSuccess(reel.outcome)) {
        expect(reel.outcome.success).toMatchObject({ _tag: 'Caught' })
        expect(reel.after).toEqual({ rods: [] })
      }
    }),
    checks,
  )

  const captureProjectileOutcome = async (
    propertyName: string,
    effect: Effect.Effect<unknown, unknown, never>,
    successSchema: Schema.ConstraintDecoder<unknown>,
    failureSchema: Schema.ConstraintDecoder<unknown>,
  ): Promise<Result.Result<unknown, unknown>> => {
    const outcome = await Effect.runPromise(Effect.result(effect))
    const schema = Result.isFailure(outcome) ? failureSchema : successSchema
    const value = Result.isFailure(outcome) ? outcome.failure : outcome.success
    expect(Schema.is(schema)(value), propertyName + ' runtime Schema').toBe(true)
    const decoded = Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(value)
    expect(decoded._tag, propertyName + ' decoding').toBe('Success')
    return outcome
  }

  const requireProjectileSuccess = <A>(
    outcome: Result.Result<unknown, unknown>,
    schema: Schema.ConstraintDecoder<A>,
  ): A => {
    if (Result.isFailure(outcome)) throw outcome.failure
    const decoded = Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(outcome.success)
    expect(decoded._tag, 'Projectile success decoding').toBe('Success')
    if (Result.isFailure(decoded)) throw decoded.failure
    return decoded.success
  }

  const captureProjectileSnapshot = async (propertyName: string) => {
    const outcome = await captureProjectileOutcome(
      propertyName,
      services.projectiles.snapshot,
      PublicApplication.ProjectileServiceSnapshotSuccessSchema,
      PublicApplication.ProjectileServiceSnapshotErrorSchema,
    )
    const snapshot = requireProjectileSuccess(
      outcome,
      PublicApplication.ProjectileServiceSnapshotSuccessSchema,
    )
    const ids = snapshot.state.projectiles.map((projectile) => projectile.id)
    expect(new Set(ids).size).toBe(ids.length)
    return snapshot
  }

  const assertProjectileOperation = async (
    propertyName: string,
    effect: Effect.Effect<unknown, unknown, never>,
    successSchema: Schema.ConstraintDecoder<unknown>,
  ) => {
    const before = await captureProjectileSnapshot(propertyName + ' snapshot before')
    const outcome = await captureProjectileOutcome(
      propertyName,
      effect,
      successSchema,
      PublicApplication.ProjectileServiceErrorSchema,
    )
    const after = await captureProjectileSnapshot(propertyName + ' snapshot after')
    if (Result.isFailure(outcome)) expect(after).toEqual(before)
    return { outcome, before, after }
  }

  const captureTntOutcome = async (
    propertyName: string,
    effect: Effect.Effect<unknown, unknown, never>,
    successSchema: Schema.ConstraintDecoder<unknown>,
    failureSchema: Schema.ConstraintDecoder<unknown>,
  ): Promise<Result.Result<unknown, unknown>> => {
    const outcome = await Effect.runPromise(Effect.result(effect))
    const schema = Result.isFailure(outcome) ? failureSchema : successSchema
    const value = Result.isFailure(outcome) ? outcome.failure : outcome.success
    expect(Schema.is(schema)(value), propertyName + ' runtime Schema').toBe(true)
    const decoded = Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(value)
    expect(decoded._tag, propertyName + ' decoding').toBe('Success')
    return outcome
  }

  const requireTntSuccess = <A>(
    outcome: Result.Result<unknown, unknown>,
    schema: Schema.ConstraintDecoder<A>,
  ): A => {
    if (Result.isFailure(outcome)) throw outcome.failure
    const decoded = Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(outcome.success)
    expect(decoded._tag, 'TNT success decoding').toBe('Success')
    if (Result.isFailure(decoded)) throw decoded.failure
    return decoded.success
  }

  const captureTntSnapshot = async (propertyName: string) => {
    const outcome = await captureTntOutcome(
      propertyName,
      services.tnt.snapshot,
      PublicApplication.TntServiceSnapshotSuccessSchema,
      PublicApplication.TntServiceSnapshotErrorSchema,
    )
    return requireTntSuccess(outcome, PublicApplication.TntServiceSnapshotSuccessSchema)
  }

  const assertTntOperation = async (
    propertyName: string,
    effect: Effect.Effect<unknown, unknown, never>,
    successSchema: Schema.ConstraintDecoder<unknown>,
  ) => {
    const before = await captureTntSnapshot(propertyName + ' snapshot before')
    const outcome = await captureTntOutcome(
      propertyName,
      effect,
      successSchema,
      PublicApplication.TntServiceErrorSchema,
    )
    const after = await captureTntSnapshot(propertyName + ' snapshot after')
    const ids = after.state.tnts.map((tnt) => tnt.id)
    expect(new Set(ids).size).toBe(ids.length)
    if (Result.isFailure(outcome)) expect(after).toEqual(before)
    return { outcome, before, after }
  }

  const projectileBounds: Physics.AABB = {
    minX: PositionAxis(-100),
    minY: PositionAxis(-100),
    minZ: PositionAxis(-100),
    maxX: PositionAxis(100),
    maxY: PositionAxis(100),
    maxZ: PositionAxis(100),
  }
  const emptyProjectileWorld: Physics.ProjectileWorld = {
    blockBounds: () => [],
    bounds: projectileBounds,
    entities: [],
    isInWater: () => false,
  }

  expect((await captureProjectileSnapshot('ProjectileService.snapshot initial')).state.projectiles).toEqual([])

  let validProjectileTrial = 0
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), async (index) => {
      const trialId = validProjectileTrial++
      const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)(`property-projectile-${index}-${trialId}`)
      const shooter = Schema.decodeUnknownSync(EntityIdSchema)(`property-shooter-${index}-${trialId}`)
      const tick = Schema.decodeUnknownSync(SimulationTickSchema)(index)
      const expectedRevision = await Effect.runPromise(services.coordinator.revision)
      const expectedDimensionRevision = await Effect.runPromise(services.coordinator.dimensionRevision('overworld'))
      const launched = await assertProjectileOperation(
        'ProjectileService.launch valid input',
        invokeEffect(services.projectiles.launch, [{
          projectileId,
          dimension: 'overworld',
          shooter,
          tick,
          expectedRevision,
          expectedDimensionRevision,
          kind: 'projectile',
          position: position(PositionAxis(0), PositionAxis(0), PositionAxis(0)),
          yawRadians: AngleRadians(0),
          pitchRadians: AngleRadians(0),
          speed: Physics.BlocksPerSecond(30),
          profile: PublicApplication.SNOWBALL_PROFILE,
        }]),
        PublicApplication.ProjectileLaunchOutcomeSchema,
      )
      expect(Result.isSuccess(launched.outcome), JSON.stringify(launched.outcome)).toBe(true)
      if (Result.isSuccess(launched.outcome)) {
        const launch = requireProjectileSuccess(launched.outcome, PublicApplication.ProjectileLaunchOutcomeSchema)
        expect(launch.projectile.state).toBe('flying')
        expect(launched.after.revision).toEqual(launch.revision)
        expect(launched.after.state.projectiles).toHaveLength(launched.before.state.projectiles.length + 1)
        expect(launched.after.state.projectiles.find(({ id }) => id === projectileId)?.projectile).toEqual(launch.projectile)
      }

      const stepRevision = await Effect.runPromise(services.coordinator.revision)
      const stepDimensionRevision = await Effect.runPromise(services.coordinator.dimensionRevision('overworld'))
      const stepped = await assertProjectileOperation(
        'ProjectileService.step valid input',
        invokeEffect(services.projectiles.step, [{
          projectileId,
          tick,
          expectedRevision: stepRevision,
          expectedDimensionRevision: stepDimensionRevision,
          deltaTime: DeltaTimeSecs(0.01),
          world: emptyProjectileWorld,
          blockAddressOfHit: () => undefined,
        }]),
        PublicApplication.ProjectileStepOutcomeSchema,
      )
      expect(Result.isSuccess(stepped.outcome), JSON.stringify(stepped.outcome)).toBe(true)
      if (Result.isSuccess(stepped.outcome)) {
        const step = requireProjectileSuccess(stepped.outcome, PublicApplication.ProjectileStepOutcomeSchema)
        expect(step.hit).toBeUndefined()
        expect(step.enderPearlImpact).toBeUndefined()
        expect(stepped.after.revision).toEqual(step.revision)
        expect(stepped.after.state.projectiles).toHaveLength(stepped.before.state.projectiles.length)
        expect(stepped.after.state.projectiles.find(({ id }) => id === projectileId)?.projectile).toEqual(step.projectile)
      }
    }),
    checks,
  )

  const invalidTntPrimeRevision = await Effect.runPromise(services.coordinator.revision)
  const invalidTntPrimeDimensionRevision = await Effect.runPromise(services.coordinator.dimensionRevision('overworld'))
  const invalidTntPrime = await assertTntOperation(
    'TntService.prime invalid fuse',
    invokeEffect(services.tnt.prime, [{
      id: Schema.decodeUnknownSync(EntityIdSchema)('property-tnt-invalid-prime'),
      dimension: 'overworld',
      center: { x: 0, y: 64, z: 0 },
      fuseSecs: -1,
      expectedRevision: invalidTntPrimeRevision,
      expectedDimensionRevision: invalidTntPrimeDimensionRevision,
    }]),
    PublicApplication.TntPrimeOutcomeSchema,
  )
  expect(Result.isFailure(invalidTntPrime.outcome)).toBe(true)
  if (Result.isFailure(invalidTntPrime.outcome)) {
    expect(invalidTntPrime.outcome.failure).toMatchObject({ _tag: 'TntServiceFailure', reason: 'invalid-input' })
  }

  let validTntTrial = 0
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 1_000_000 }), async (index) => {
      const trialId = validTntTrial++
      const id = Schema.decodeUnknownSync(EntityIdSchema)(`property-tnt-${index}-${trialId}`)
      const initialRevision = await Effect.runPromise(services.coordinator.revision)
      const initialDimensionRevision = await Effect.runPromise(services.coordinator.dimensionRevision('overworld'))
      const primed = await assertTntOperation(
        'TntService.prime valid input',
        invokeEffect(services.tnt.prime, [{
          id,
          dimension: 'overworld',
          center: { x: 0, y: 64, z: 0 },
          fuseSecs: 2.5,
          expectedRevision: initialRevision,
          expectedDimensionRevision: initialDimensionRevision,
        }]),
        PublicApplication.TntPrimeOutcomeSchema,
      )
      expect(Result.isSuccess(primed.outcome), JSON.stringify(primed.outcome)).toBe(true)
      if (Result.isFailure(primed.outcome)) return
      const primeOutcome = requireTntSuccess(primed.outcome, PublicApplication.TntPrimeOutcomeSchema)
      expect(primeOutcome.revision).toEqual(primed.after.revision)
      expect(primed.after.state.tnts).toContainEqual({
        id,
        dimension: 'overworld',
        center: { x: 0, y: 64, z: 0 },
        state: { kind: 'primed', remainingFuseSecs: 2.5 },
      })
      expect(primed.after.revision).not.toEqual(primed.before.revision)

      const invalidAdvanceRevision = await Effect.runPromise(services.coordinator.revision)
      const invalidAdvanceDimensionRevision = await Effect.runPromise(services.coordinator.dimensionRevision('overworld'))
      const invalidAdvance = await assertTntOperation(
        'TntService.advance invalid delta',
        invokeEffect(services.tnt.advance, [{
          id,
          deltaTimeSecs: -1,
          expectedRevision: invalidAdvanceRevision,
          expectedDimensionRevision: invalidAdvanceDimensionRevision,
          radius: 1,
          seed: 17,
          blocks: () => undefined,
          entities: [],
        }]),
        PublicApplication.TntAdvanceOutcomeSchema,
      )
      expect(Result.isFailure(invalidAdvance.outcome)).toBe(true)
      if (Result.isFailure(invalidAdvance.outcome)) {
        expect(invalidAdvance.outcome.failure).toMatchObject({ _tag: 'TntServiceFailure', reason: 'invalid-input' })
      }

      const fuseRevision = await Effect.runPromise(services.coordinator.revision)
      const fuseDimensionRevision = await Effect.runPromise(services.coordinator.dimensionRevision('overworld'))
      const fuseAdvanced = await assertTntOperation(
        'TntService.advance valid fuse step',
        invokeEffect(services.tnt.advance, [{
          id,
          deltaTimeSecs: 1,
          expectedRevision: fuseRevision,
          expectedDimensionRevision: fuseDimensionRevision,
          radius: 1,
          seed: 17,
          blocks: () => undefined,
          entities: [],
        }]),
        PublicApplication.TntAdvanceOutcomeSchema,
      )
      expect(Result.isSuccess(fuseAdvanced.outcome), JSON.stringify(fuseAdvanced.outcome)).toBe(true)
      if (Result.isFailure(fuseAdvanced.outcome)) return
      const fuseOutcome = requireTntSuccess(fuseAdvanced.outcome, PublicApplication.TntAdvanceOutcomeSchema)
      expect(fuseOutcome._tag).toBe('FuseAdvanced')
      if (fuseOutcome._tag !== 'FuseAdvanced') return
      expect(fuseOutcome.plan.after).toEqual({ kind: 'primed', remainingFuseSecs: 1.5 })
      expect(fuseOutcome.revision).toEqual(fuseAdvanced.after.revision)
      expect(fuseAdvanced.after.state.tnts.find((tnt) => tnt.id === id)?.state).toEqual(fuseOutcome.plan.after)

      const detonationRevision = await Effect.runPromise(services.coordinator.revision)
      const detonationDimensionRevision = await Effect.runPromise(services.coordinator.dimensionRevision('overworld'))
      const detonation = await assertTntOperation(
        'TntService.advance detonation candidate',
        invokeEffect(services.tnt.advance, [{
          id,
          deltaTimeSecs: 1.5,
          expectedRevision: detonationRevision,
          expectedDimensionRevision: detonationDimensionRevision,
          radius: 1,
          seed: 23,
          blocks: () => undefined,
          entities: [],
        }]),
        PublicApplication.TntAdvanceOutcomeSchema,
      )
      expect(Result.isSuccess(detonation.outcome), JSON.stringify(detonation.outcome)).toBe(true)
      if (Result.isFailure(detonation.outcome)) return
      const detonationOutcome = requireTntSuccess(detonation.outcome, PublicApplication.TntAdvanceOutcomeSchema)
      expect(detonationOutcome._tag).toBe('DetonationPlanned')
      if (detonationOutcome._tag !== 'DetonationPlanned') return
      expect(detonationOutcome.plan.after).toEqual({ kind: 'detonated' })
      expect(detonationOutcome.ownerCandidate.state.tnts.find((tnt) => tnt.id === id)?.state)
        .toEqual({ kind: 'detonated' })
      expect(detonation.after).toEqual(detonation.before)
      expect(detonation.after.state.tnts.find((tnt) => tnt.id === id)?.state)
        .toEqual({ kind: 'primed', remainingFuseSecs: 1.5 })
    }),
    checks,
  )

  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileValue, hostileNumber), async ([value, amount]) => {
      const cast = await assertFishingOperation(
        'FishingService.cast',
        invokeEffect(fishing.cast, [value, value]),
        PublicApplication.FishingServiceCastSuccessSchema,
      )
      if (Result.isSuccess(cast.outcome)) {
        expect(cast.after.rods.length).toBe(cast.before.rods.length + 1)
        expect(cast.after.rods).toContainEqual({ actor: value, bobber: value, phase: 'cast' })
      }
      const bite = await assertFishingOperation(
        'FishingService.bite',
        invokeEffect(fishing.bite, [value]),
        PublicApplication.FishingServiceBiteSuccessSchema,
      )
      if (Result.isSuccess(bite.outcome)) {
        expect(bite.after.rods.find((rod) => rod.actor === value)?.phase).toBe('bite')
      }
      const reel = await assertFishingOperation(
        'FishingService.reel',
        invokeEffect(fishing.reel, [value, amount]),
        PublicApplication.FishingServiceReelSuccessSchema,
      )
      if (Result.isSuccess(reel.outcome)) {
        expect(reel.after.rods.some((rod) => rod.actor === value)).toBe(false)
        expect(reel.outcome.success).toMatchObject({ _tag: expect.stringMatching(/^(NoBite|Caught)$/) })
      }

      const launchRequest = {
        projectileId: value,
        dimension: value,
        shooter: value,
        tick: amount,
        expectedRevision: amount,
        expectedDimensionRevision: amount,
        kind: value,
        position: { x: amount, y: value, z: amount },
        yawRadians: amount,
        pitchRadians: amount,
        speed: amount,
        profile: value,
      }
      const projectileLaunch = await assertProjectileOperation(
        'ProjectileService.launch hostile input',
        invokeEffect(services.projectiles.launch, [launchRequest]),
        PublicApplication.ProjectileLaunchOutcomeSchema,
      )
      if (Result.isSuccess(projectileLaunch.outcome)) {
        const launch = requireProjectileSuccess(
          projectileLaunch.outcome,
          PublicApplication.ProjectileLaunchOutcomeSchema,
        )
        expect(projectileLaunch.after.state.projectiles).toHaveLength(
          projectileLaunch.before.state.projectiles.length + 1,
        )
        expect(projectileLaunch.after.state.projectiles.find(({ id }) => id === value)?.projectile)
          .toEqual(launch.projectile)
      }
      const projectileStep = await assertProjectileOperation(
        'ProjectileService.step hostile input',
        invokeEffect(services.projectiles.step, [{
          projectileId: value,
          tick: amount,
          expectedRevision: amount,
          expectedDimensionRevision: amount,
          deltaTime: amount,
          world: emptyProjectileWorld,
          blockAddressOfHit: () => undefined,
        }]),
        PublicApplication.ProjectileStepOutcomeSchema,
      )
      if (Result.isSuccess(projectileStep.outcome)) {
        const step = requireProjectileSuccess(
          projectileStep.outcome,
          PublicApplication.ProjectileStepOutcomeSchema,
        )
        expect(projectileStep.after.state.projectiles).toHaveLength(
          projectileStep.before.state.projectiles.length,
        )
        expect(projectileStep.after.state.projectiles.find(({ id }) => id === value)?.projectile)
          .toEqual(step.projectile)
      }

      const tntPrime = await assertTntOperation(
        'TntService.prime hostile input',
        invokeEffect(services.tnt.prime, [{
          id: value,
          dimension: value,
          center: { x: amount, y: value, z: amount },
          fuseSecs: amount,
          expectedRevision: amount,
          expectedDimensionRevision: amount,
        }]),
        PublicApplication.TntPrimeOutcomeSchema,
      )
      if (Result.isSuccess(tntPrime.outcome)) {
        const primeOutcome = requireTntSuccess(tntPrime.outcome, PublicApplication.TntPrimeOutcomeSchema)
        expect(tntPrime.after.state.tnts).toHaveLength(tntPrime.before.state.tnts.length + 1)
        expect(tntPrime.after.state.tnts.some((tnt) => tnt.id === value)).toBe(true)
        expect(tntPrime.after.revision).toEqual(primeOutcome.revision)
      }
      const tntAdvance = await assertTntOperation(
        'TntService.advance hostile input',
        invokeEffect(services.tnt.advance, [{
          id: value,
          deltaTimeSecs: amount,
          expectedRevision: amount,
          expectedDimensionRevision: amount,
          radius: amount,
          seed: amount,
          blocks: () => undefined,
          entities: [],
        }]),
        PublicApplication.TntAdvanceOutcomeSchema,
      )
      if (Result.isSuccess(tntAdvance.outcome)) {
        const advanceOutcome = requireTntSuccess(tntAdvance.outcome, PublicApplication.TntAdvanceOutcomeSchema)
        if (advanceOutcome._tag === 'FuseAdvanced') {
          expect(tntAdvance.after.revision).toEqual(advanceOutcome.revision)
          expect(tntAdvance.after.state.tnts.find((tnt) => tnt.id === value)?.state)
            .toEqual(advanceOutcome.plan.after)
        } else if (advanceOutcome._tag === 'AlreadyDetonated') {
          expect(tntAdvance.after).toEqual(tntAdvance.before)
        } else {
          expect(tntAdvance.after).toEqual(tntAdvance.before)
          expect(advanceOutcome.ownerCandidate.state.tnts.find((tnt) => tnt.id === value)?.state)
            .toEqual({ kind: 'detonated' })
        }
      }
    }),
    checks,
  )
})

it('hotbar, intent queue, and game-loop inputs stay bounded or return typed outcomes', async () => {
  const inventoryLayer = PublicApplication.InventoryServiceLayer()
  const hotbar = await Effect.runPromise(
    PublicApplication.makeHotbarService().pipe(Effect.provide(inventoryLayer)),
  )
  const queueCapacity = Schema.decodeUnknownSync(PublicApplication.IntentQueueCapacitySchema)(1)
  const queueLayer = PublicApplication.IntentQueueLayer({ capacity: queueCapacity })
  const queue = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* PublicApplication.IntentQueue
    }).pipe(Effect.provide(queueLayer)),
  )
  const loop = await Effect.runPromise(PublicApplication.makeGameLoop())

  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileValue, hostileNumber), async ([value, amount]) => {
      await assertEffectResult(
        'HotbarService.setSelectedSlot', hotbar.setSelectedSlot, [value],
        Schema.Undefined, PublicApplication.SchemaErrorSchema,
      )
      await assertEffectResult(
        'HotbarService.scroll', hotbar.scroll, [amount],
        Schema.Undefined, PublicApplication.SchemaErrorSchema,
      )
      await assertEffectResult('HotbarService.update', hotbar.update, [{
        selectedSlot: value,
        wheelDelta: amount,
      }], Schema.Undefined, PublicApplication.SchemaErrorSchema)
      const selectedSlot = await Effect.runPromise(hotbar.getSelectedSlot)
      expect(Number.isInteger(selectedSlot)).toBe(true)
      expect(selectedSlot).toBeGreaterThanOrEqual(0)
      expect(selectedSlot).toBeLessThan(9)
      const hotbarSlots = await Effect.runPromise(hotbar.getSlots)
      expect(Schema.is(Schema.Array(PublicApplication.InventoryCarriedSlotSchema))(hotbarSlots)).toBe(true)
      const selectedItem = await Effect.runPromise(hotbar.getSelectedItem)
      expect(Schema.is(Schema.Union([PublicApplication.ItemStackSchema, Schema.Undefined]))(selectedItem)).toBe(true)

      const readyTick = SimulationTick.result(amount as never)
      const readyOutcome = await assertEffectResult(
        'IntentQueue.takeReady', queue.takeReady, [amount],
        Schema.Array(PublicApplication.QueuedIntentSchema), PublicApplication.SchemaErrorSchema,
      )
      if (readyTick._tag === 'Failure') {
        expect(Result.isFailure(readyOutcome)).toBe(true)
        if (Result.isFailure(readyOutcome)) {
          expect(Schema.is(PublicApplication.SchemaErrorSchema)(readyOutcome.failure)).toBe(true)
        }
      } else {
        expect(Result.isSuccess(readyOutcome)).toBe(true)
      }

      const candidateIntent = {
        id: value,
        targetTick: amount,
        source: 'local',
        payload: value,
      }
      const intentValidation = Schema.decodeUnknownResult(PublicApplication.IntentSchema)(candidateIntent)
      const enqueueOutcome = await assertEffectResult(
        'IntentQueue.enqueue', queue.enqueue, [candidateIntent], PublicApplication.IntentSequenceSchema,
        PublicApplication.IntentQueueEnqueueFailureSchema,
      )
      if (intentValidation._tag === 'Failure') {
        expect(Result.isFailure(enqueueOutcome)).toBe(true)
        if (Result.isFailure(enqueueOutcome)) {
          expect(Schema.is(PublicApplication.SchemaErrorSchema)(enqueueOutcome.failure)).toBe(true)
        }
      } else if (Result.isFailure(enqueueOutcome)) {
        expect(enqueueOutcome.failure).toBeInstanceOf(PublicApplication.IntentQueueFull)
      }

      await Effect.runPromise(loop.start(() => Effect.void))
      try {
        await assertEffectResult(
          'GameLoop.advanceFrame',
          loop.advanceFrame,
          [amount],
          PublicApplication.FixedStepAdvanceSchema,
          PublicApplication.FixedStepFailureSchema,
        )
        await assertEffectResult(
          'GameLoop.submitFrame', loop.submitFrame, [value], Schema.Undefined, Schema.Never,
        )
      } finally {
        await Effect.runPromise(loop.stop)
      }

      const initialTick = await Effect.runPromise(PublicApplication.makeGameLoop(value as never))
      const started = await Effect.runPromise(Effect.result(initialTick.start(() => Effect.void)))
      const validInitialTick = typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      assertEffectOutcome(
        'GameLoop.start', () => started, Schema.Undefined, PublicApplication.BrandErrorSchema,
      )
      if (value !== undefined && !validInitialTick) {
        expect(Result.isFailure(started)).toBe(true)
      } else {
        expect(Result.isSuccess(started)).toBe(true)
        await Effect.runPromise(initialTick.stop)
      }
    }),
    checks,
  )
})
