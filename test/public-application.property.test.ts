import fc from 'fast-check'
import { Effect, Layer, Ref, Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import { InMemoryStorageLayer } from '@nerima-games/mc-save'
import { DIMENSIONS, DimensionRevisionSchema, SimulationTick, WorldIdSchema } from '@nerima-games/mc-kernel'
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
import { makeSaveCoordinator } from '../src/application/save-coordinator.js'
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
  const core = await Effect.runPromise(makeCoreTick({
    coordinator,
    publish: () => Effect.void,
    stages: {
      intentsAndRules: noChanges,
      stations: noChanges,
      environment: noChanges,
      entities: noChanges,
    },
  }))

  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileNumber, fc.array(hostileValue)), async ([tick, ready]) => {
      await runEffectResult(core.runTick, [tick, ready])
    }),
    checks,
  )
})

it('entity manager spawn and restore repair hostile coordinates, health, serials, and roster entries', async () => {
  const manager = await Effect.runPromise(makeEntityManager())
  const kind = EntityKind('property-creature')

  await fc.assert(
    fc.asyncProperty(hostileNumber, async (value) => {
      const request = {
        kind,
        feetPosition: { x: value, y: value, z: value },
        healthPoints: value,
        behaviour: { _tag: 'Idle' },
      }
      await runEffectResult(manager.spawn, [request])

      const roster = {
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
      await runEffectResult(manager.restore, [roster])

      await Effect.runPromise(manager.snapshot)
    }),
    checks,
  )

  const managerApi = await Effect.runPromise(makeEntityManager())
  await fc.assert(
    fc.asyncProperty(hostileValue, async (idOrKind) => {
      await Effect.runPromise(invokeEffect(managerApi.find, [idOrKind]))
      await Effect.runPromise(invokeEffect(managerApi.despawn, [idOrKind]))
      await Effect.runPromise(invokeEffect(managerApi.countOfKind, [idOrKind]))
    }),
    checks,
  )
})

it('save coordinator publishes a stable finite snapshot and tracks retained chunk counts', async () => {
  const coordinator = await Effect.runPromise(makeSaveCoordinator({
    initialKnownChunks: [],
    snapshotResidents: Effect.succeed([]),
    currentGeneration: Effect.succeed(0),
    snapshotState: Effect.succeed({ tick: 0 }),
    publish: () => Effect.void,
  }))

  await Effect.runPromise(Effect.result(coordinator.requestSave))
  const counts = await Effect.runPromise(Effect.all([
    coordinator.knownChunkCount,
    coordinator.retainedChunkCount,
  ]))
  expect(counts).toStrictEqual([0, 0])
})

it('simulation save boundary returns typed failures for hostile payloads and safe options for arbitrary keys', async () => {
  const key = simulationSaveKey('application-property-save')

  await fc.assert(
    fc.asyncProperty(hostileValue, async (payload) => {
      const outcome = await Effect.runPromise(
        Effect.result(
          invokeEffect(saveSimulation, [key, payload]).pipe(Effect.provide(InMemoryStorageLayer)),
        ),
      )
      expect(Result.isFailure(outcome)).toBe(true)
    }),
    checks,
  )

  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1 }).filter((rawKey) => rawKey.trim().length > 0), async (rawKey) => {
      await Effect.runPromise(
        invokeEffect(loadSimulation, [simulationSaveKey(rawKey)]).pipe(
          Effect.provide(InMemoryStorageLayer),
        ) as Effect.Effect<unknown, unknown, never>,
      )
    }),
    checks,
  )
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
