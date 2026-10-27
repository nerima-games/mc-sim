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
  ChunkAxis,
  DIMENSIONS,
  DimensionRevisionSchema,
  SimulationTick,
  WorldIdSchema,
  chunkCoord,
} from '@nerima-games/mc-kernel'
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
import { migrateSimulationSaveV3 } from '../src/application/save-v3-migration.js'
import { makePlayerService } from '../src/application/player-service.js'
import { makeSettingsService } from '../src/application/settings-service.js'
import { makeWeatherService } from '../src/application/weather-service.js'
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

it('legacy save migration rejects hostile payloads through its typed decode channel', async () => {
  await fc.assert(
    fc.asyncProperty(hostileValue, async (payload) => {
      const migration = invokeEffect(
        migrateSimulationSaveV3,
        [payload, null, () => Effect.void],
      ) as Effect.Effect<unknown, unknown, never>
      const outcome = await Effect.runPromise(Effect.result(migration))
      expect(Result.isFailure(outcome)).toBe(true)
    }),
    checks,
  )
})

it('player, settings, and weather services preserve valid finite snapshots after hostile inputs', async () => {
  const player = await Effect.runPromise(makePlayerService())
  const settings = await Effect.runPromise(makeSettingsService())
  const weather = await Effect.runPromise(makeWeatherService())

  await fc.assert(
    fc.asyncProperty(hostileNumber, async (value) => {
      await runEffectResult(player.look, [value, value])

      await Effect.runPromise(invokeEffect(settings.restore, [value]))
      await Effect.runPromise(settings.snapshot)

      await runEffectResult(weather.candidateTransition, [value, value])
      await runEffectResult(weather.applyTransition, [value])
      await Effect.runPromise(invokeEffect(weather.restore, [value]))
      await Effect.runPromise(weather.snapshot)
    }),
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
  const vehicles = await Effect.runPromise(PublicApplication.makeVehicleService())

  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileValue, hostileNumber), async ([value, amount]) => {
      const location = {
        dimension: value,
        position: { x: amount, y: value, z: amount },
      }
      await runEffectResult(crops.plant, [location, value, value])
      await runEffectResult(crops.cropAt, [location])
      await runEffectResult(crops.matureYieldsAt, [location])
      await runEffectResult(crops.remove, [location])
      await runEffectResult(crops.advance, [amount])
      await runEffectResult(crops.advanceByBoneMeal, [location])
      await runEffectResult(crops.restore, [value])
      await Effect.runPromise(crops.snapshot)

      await runEffectResult(equipment.equip, [value, value])
      await runEffectResult(equipment.unequip, [value])
      await runEffectResult(equipment.swap, [value, value])
      await runEffectResult(equipment.damage, [value, amount])
      await runEffectResult(equipment.restore, [value])
      await Effect.runPromise(equipment.snapshot)

      const vector = { x: amount, y: value, z: amount }
      await runEffectResult(vehicles.spawn, [value, value, vector, amount])
      await runEffectResult(vehicles.despawn, [value])
      await runEffectResult(vehicles.mount, [value, value])
      await runEffectResult(vehicles.dismount, [value, value])
      await runEffectResult(vehicles.updateVelocity, [value, vector])
      await runEffectResult(vehicles.updateTransform, [value, value, vector, amount])
      await runEffectResult(vehicles.updateState, [value, {
        dimension: value,
        position: vector,
        velocity: vector,
        yawRadians: amount,
      }])
      await runEffectResult(vehicles.restore, [value])
      await Effect.runPromise(vehicles.snapshot)

      await Effect.runPromise(
        Effect.result(invokeEffect(PublicApplication.makeVehicleService, [value])),
      )
    }),
    checks,
  )
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
      const fishing = yield* PublicApplication.makeFishingService(fishOwner)
      const projectiles = yield* PublicApplication.makeProjectileService()
      const tnt = yield* PublicApplication.makeTntService()
      return { fishing, projectiles, tnt }
    }).pipe(Effect.provide(environment)),
  )

  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileValue, hostileNumber), async ([value, amount]) => {
      await runEffectResult(services.fishing.cast, [value, value])
      await runEffectResult(services.fishing.bite, [value])
      await runEffectResult(services.fishing.reel, [value, amount])

      const launch = {
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
      await runEffectResult(services.projectiles.launch, [launch])
      await runEffectResult(services.projectiles.step, [{
        projectileId: value,
        tick: amount,
        expectedRevision: amount,
        expectedDimensionRevision: amount,
        deltaTime: amount,
        world: {},
        blockAddressOfHit: () => undefined,
      }])

      await runEffectResult(services.tnt.prime, [{
        id: value,
        dimension: value,
        center: { x: amount, y: value, z: amount },
        fuseSecs: amount,
        expectedRevision: amount,
        expectedDimensionRevision: amount,
      }])
      await runEffectResult(services.tnt.advance, [{
        id: value,
        deltaTimeSecs: amount,
        expectedRevision: amount,
        expectedDimensionRevision: amount,
        radius: amount,
        seed: amount,
        blocks: {},
        entities: [],
      }])
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
      }

      const candidateIntent = {
        id: value,
        targetTick: amount,
        source: 'local',
        payload: value,
      }
      const intentValidation = Schema.decodeUnknownResult(PublicApplication.IntentSchema)(candidateIntent)
      const enqueueOutcome = await runEffectResult(queue.enqueue, [candidateIntent])
      if (intentValidation._tag === 'Failure') {
        expect(Result.isFailure(enqueueOutcome)).toBe(true)
        if (Result.isFailure(enqueueOutcome)) {
          expect(Schema.is(PublicApplication.SchemaErrorSchema)(enqueueOutcome.failure)).toBe(true)
        }
      }

      await Effect.runPromise(loop.start(() => Effect.void))
      try {
        await runEffectResult(loop.advanceFrame, [amount])
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
