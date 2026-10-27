import fc from 'fast-check'
import { Effect, Layer, Ref, Schema } from 'effect'
import { expect, it } from 'vitest'
import { InMemoryStorageLayer } from '@nerima-games/mc-save'
import { DIMENSIONS, DimensionRevisionSchema, SimulationTick, WorldIdSchema } from '@nerima-games/mc-kernel'
import * as PublicApplication from '../src/index.js'
import * as Camera from '../src/domain/camera-pose.js'
import * as Settings from '../src/domain/settings.js'
import * as Weather from '../src/domain/weather.js'
import { EntityKind } from '../src/domain/entity.js'
import { makeCoreTick } from '../src/application/core.js'
import { makeEntityManager } from '../src/application/entity-manager.js'
import { makeReplicatedOwnerId } from '../src/application/replicated-state.js'
import { makeWorldCommitCoordinator } from '../src/application/world-commit-coordinator.js'
import { makeSaveCoordinator } from '../src/application/save-coordinator.js'
import { loadSimulation, saveSimulation, simulationSaveKey } from '../src/application/save-service.js'
import { migrateSimulationSaveV3 } from '../src/application/save-v3-migration.js'
import { makePlayerService } from '../src/application/player-service.js'
import { makeSettingsService } from '../src/application/settings-service.js'
import { makeWeatherService } from '../src/application/weather-service.js'
import { makeSimFrameState, makeSimInputPort, makeSimStagesWithPhysics } from '../src/stages/registration.js'
import {
  finiteTree,
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

const successValue = (value: Readonly<Record<string, unknown>>): unknown =>
  value['success'] ?? value['value']

const assertSafeOutcome = (outcome: unknown, validSuccess: (success: unknown) => boolean): void => {
  expect(isRecord(outcome)).toBe(true)
  if (!isRecord(outcome)) return
  if (outcome['_tag'] === 'Failure') {
    const failure = outcome['failure'] ?? outcome['error']
    expect(isRecord(failure) && typeof failure['_tag'] === 'string').toBe(true)
    return
  }
  expect(outcome['_tag']).toBe('Success')
  const success = successValue(outcome)
  expect(finiteTree(success)).toBe(true)
  expect(validSuccess(success)).toBe(true)
}


const effectOutcome = async (
  operation: (...args: never[]) => Effect.Effect<unknown, unknown, never>,
  args: ReadonlyArray<unknown>,
  validSuccess: (success: unknown) => boolean = finiteTree,
): Promise<unknown> => {
  const outcome = await Effect.runPromise(Effect.result(invokeEffect(operation, args)))
  assertSafeOutcome(outcome, validSuccess)
  return outcome
}

const checks = { numRuns: 100 }

it('world commit coordinator accepts only typed, finite candidate outcomes for hostile revisions and states', async () => {
  const world = Schema.decodeUnknownSync(WorldIdSchema)('application-property-world')
  const ownerId = makeReplicatedOwnerId('application-property-owner')
  const schema = Schema.Struct({ value: Schema.Finite })

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
      const outcome = await Effect.runPromise(
        Effect.result(invokeEffect(coordinator.commit, [request])),
      )
      assertSafeOutcome(outcome, (success) =>
        isRecord(success) && typeof success['world'] === 'string' &&
        Array.isArray(success['changes']) && typeof success['revision'] === 'number',
      )
    }),
    checks,
  )
})

it('world commit coordinator returns typed failures for malformed request envelopes', async () => {
  const world = Schema.decodeUnknownSync(WorldIdSchema)('malformed-commit-envelope-world')
  const ownerId = makeReplicatedOwnerId('malformed-commit-envelope-owner')
  const coordinator = await Effect.runPromise(makeWorldCommitCoordinator({
    world,
    owners: [{ ownerId, schema: Schema.Struct({ value: Schema.Finite }), initialState: { value: 0 } }],
  }))

  await fc.assert(
    fc.asyncProperty(fc.constantFrom<unknown>(null, undefined, false, 0, 'invalid', [], {}), async (request) => {
      const outcome = await Effect.runPromise(
        Effect.result(invokeEffect(coordinator.commit, [request])),
      )
      assertSafeOutcome(outcome, () => false)
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
      const outcome = await Effect.runPromise(
        Effect.result(invokeEffect(core.runTick, [tick, ready])),
      )
      assertSafeOutcome(outcome, (success) => success === undefined)
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
      const spawned = await Effect.runPromise(
        Effect.result(invokeEffect(manager.spawn, [request])),
      )
      assertSafeOutcome(spawned, (success) => isRecord(success) && typeof success['id'] === 'string')

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
      const restored = await Effect.runPromise(
        Effect.result(invokeEffect(manager.restore, [roster])),
      )
      assertSafeOutcome(restored, (success) => isRecord(success))

      const entitySnapshot = await Effect.runPromise(manager.snapshot)
      expect(finiteTree(entitySnapshot)).toBe(true)
      expect(Array.isArray(entitySnapshot.entities)).toBe(true)
    }),
    checks,
  )

  const managerApi = await Effect.runPromise(makeEntityManager())
  await fc.assert(
    fc.asyncProperty(hostileValue, async (idOrKind) => {
      const found = await Effect.runPromise(invokeEffect(managerApi.find, [idOrKind]))
      const despawned = await Effect.runPromise(invokeEffect(managerApi.despawn, [idOrKind]))
      const count = await Effect.runPromise(invokeEffect(managerApi.countOfKind, [idOrKind]))
      expect(found === undefined || (isRecord(found) && finiteTree(found))).toBe(true)
      expect(typeof despawned).toBe('boolean')
      expect(typeof count).toBe('number')
      expect(Number.isFinite(count)).toBe(true)
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

  const outcome = await Effect.runPromise(Effect.result(coordinator.requestSave))
  assertSafeOutcome(outcome, (success) => success === undefined)
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
      assertSafeOutcome(outcome, () => false)
    }),
    checks,
  )

  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1 }).filter((rawKey) => rawKey.trim().length > 0), async (rawKey) => {
      const loaded = await Effect.runPromise(
        invokeEffect(loadSimulation, [simulationSaveKey(rawKey)]).pipe(
          Effect.provide(InMemoryStorageLayer),
        ) as Effect.Effect<unknown, unknown, never>,
      )
      expect(isRecord(loaded)).toBe(true)
      if (!isRecord(loaded)) return
      expect(loaded['_tag'] === 'None' || loaded['_tag'] === 'Some').toBe(true)
      expect(finiteTree(loaded)).toBe(true)
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
      assertSafeOutcome(outcome, () => false)
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
      const look = await Effect.runPromise(
        Effect.result(invokeEffect(player.look, [value, value])),
      )
      assertSafeOutcome(look, (success) => isRecord(success))
      const pose = await Effect.runPromise(player.pose)
      expect(finiteTree(pose)).toBe(true)

      await Effect.runPromise(invokeEffect(settings.restore, [value]))
      const settingSnapshot = await Effect.runPromise(settings.snapshot)
      expect(Settings.isValidSettings(settingSnapshot)).toBe(true)
      expect(finiteTree(settingSnapshot)).toBe(true)

      const transition = await Effect.runPromise(
        Effect.result(invokeEffect(weather.candidateTransition, [value, value])),
      )
      assertSafeOutcome(transition, (success) => Weather.isValidWeatherState(success))
      const applied = await Effect.runPromise(
        Effect.result(invokeEffect(weather.applyTransition, [value])),
      )
      assertSafeOutcome(applied, (success) => Weather.isValidWeatherState(success))
      await Effect.runPromise(invokeEffect(weather.restore, [value]))
      const weatherSnapshot = await Effect.runPromise(weather.snapshot)
      expect(Weather.isValidWeatherState(weatherSnapshot)).toBe(true)
      expect(finiteTree(weatherSnapshot)).toBe(true)
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
      const restored = await Effect.runPromise(
        Effect.result(invokeEffect(player.restore, [pose, 'overworld'])),
      )
      assertSafeOutcome(restored, (success) =>
        isRecord(success) && isRecord(success['current']) && isRecord(success['current']['pose']),
      )
      expect(finiteTree(await Effect.runPromise(player.pose))).toBe(true)
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
      assertSafeOutcome(outcome, () => false)
    }),
    checks,
  )
})


it('world commits validate hostile dimension expectation collections before conflict construction', async () => {
  const world = Schema.decodeUnknownSync(WorldIdSchema)('dimension-expectation-property-world')
  const coordinator = await Effect.runPromise(makeWorldCommitCoordinator({ world, owners: [] }))
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
        if (outcome._tag === 'Failure') expect(outcome.failure._tag).toBe('SchemaError')
      }
      assertSafeOutcome(outcome, (success) =>
        isRecord(success) && Number.isSafeInteger(success['revision']) && Array.isArray(success['changes']),
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
      await effectOutcome(crops.plant, [location, value, value], (success) => typeof success === 'boolean')
      await effectOutcome(crops.cropAt, [location], (success) =>
        success === null || (isRecord(success) && finiteTree(success)),
      )
      await effectOutcome(crops.matureYieldsAt, [location], (success) =>
        success === null || (Array.isArray(success) && finiteTree(success)),
      )
      await effectOutcome(crops.remove, [location], (success) =>
        success === null || (isRecord(success) && finiteTree(success)),
      )
      await effectOutcome(crops.advance, [amount], (success) => success === undefined)
      await effectOutcome(crops.advanceByBoneMeal, [location], (success) => typeof success === 'boolean')
      await effectOutcome(crops.restore, [value], (success) => success === undefined)
      expect(finiteTree(await Effect.runPromise(crops.snapshot))).toBe(true)

      await effectOutcome(equipment.equip, [value, value])
      await effectOutcome(equipment.unequip, [value])
      await effectOutcome(equipment.swap, [value, value], (success) => success === undefined)
      await effectOutcome(equipment.damage, [value, amount])
      await effectOutcome(equipment.restore, [value], (success) => success === undefined)
      expect(finiteTree(await Effect.runPromise(equipment.snapshot))).toBe(true)

      const vector = { x: amount, y: value, z: amount }
      await effectOutcome(vehicles.spawn, [value, value, vector, amount])
      await effectOutcome(vehicles.despawn, [value], (success) => typeof success === 'boolean')
      await effectOutcome(vehicles.mount, [value, value], (success) => success === undefined)
      await effectOutcome(vehicles.dismount, [value, value], (success) => success === undefined)
      await effectOutcome(vehicles.updateVelocity, [value, vector], (success) => success === undefined)
      await effectOutcome(vehicles.updateTransform, [value, value, vector, amount], (success) => success === undefined)
      await effectOutcome(vehicles.updateState, [value, {
        dimension: value,
        position: vector,
        velocity: vector,
        yawRadians: amount,
      }], (success) => success === undefined)
      await effectOutcome(vehicles.restore, [value], (success) => success === undefined)
      expect(finiteTree(await Effect.runPromise(vehicles.snapshot))).toBe(true)

      const constructed = await Effect.runPromise(
        Effect.result(invokeEffect(PublicApplication.makeVehicleService, [value])),
      )
      expect(isRecord(constructed)).toBe(true)
      if (constructed._tag === 'Success') {
        expect(isRecord(constructed.success)).toBe(true)
        if (isRecord(constructed.success)) {
          expect(typeof constructed.success['spawn']).toBe('function')
          expect(typeof constructed.success['restore']).toBe('function')
        }
      } else {
        expect(typeof constructed.failure._tag).toBe('string')
      }
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
      await effectOutcome(services.fishing.cast, [value, value])
      await effectOutcome(services.fishing.bite, [value])
      await effectOutcome(services.fishing.reel, [value, amount])

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
      await effectOutcome(services.projectiles.launch, [launch])
      await effectOutcome(services.projectiles.step, [{
        projectileId: value,
        tick: amount,
        expectedRevision: amount,
        expectedDimensionRevision: amount,
        deltaTime: amount,
        world: {},
        blockAddressOfHit: () => undefined,
      }])

      await effectOutcome(services.tnt.prime, [{
        id: value,
        dimension: value,
        center: { x: amount, y: value, z: amount },
        fuseSecs: amount,
        expectedRevision: amount,
        expectedDimensionRevision: amount,
      }])
      await effectOutcome(services.tnt.advance, [{
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
      await effectOutcome(hotbar.setSelectedSlot, [value], (success) => success === undefined)
      await effectOutcome(hotbar.scroll, [amount], (success) => success === undefined)
      await effectOutcome(hotbar.update, [{
        selectedSlot: value,
        wheelDelta: amount,
      }], (success) => success === undefined)
      const selectedSlot = await Effect.runPromise(hotbar.getSelectedSlot)
      expect(Number.isInteger(selectedSlot)).toBe(true)
      expect(selectedSlot).toBeGreaterThanOrEqual(0)
      expect(selectedSlot).toBeLessThan(9)
      expect(finiteTree(await Effect.runPromise(hotbar.getSlots))).toBe(true)
      expect(finiteTree(await Effect.runPromise(hotbar.getSelectedItem))).toBe(true)

      const readyTick = SimulationTick.result(amount as never)
      const readyOutcome = await effectOutcome(queue.takeReady, [amount], (success) =>
        Array.isArray(success) && finiteTree(success),
      )
      if (readyTick._tag === 'Failure') {
        expect(isRecord(readyOutcome) && readyOutcome['_tag'] === 'Failure').toBe(true)
        if (isRecord(readyOutcome) && readyOutcome['_tag'] === 'Failure') {
          const failure = readyOutcome['failure']
          expect(isRecord(failure) && failure['_tag'] === 'SchemaError').toBe(true)
        }
      }

      const candidateIntent = {
        id: value,
        targetTick: amount,
        source: 'local',
        payload: value,
      }
      const intentValidation = Schema.decodeUnknownResult(PublicApplication.IntentSchema)(candidateIntent)
      const enqueueOutcome = await effectOutcome(queue.enqueue, [candidateIntent], (success) =>
        Number.isSafeInteger(success) && Number(success) >= 0,
      )
      if (intentValidation._tag === 'Failure') {
        expect(isRecord(enqueueOutcome) && enqueueOutcome['_tag'] === 'Failure').toBe(true)
        if (isRecord(enqueueOutcome) && enqueueOutcome['_tag'] === 'Failure') {
          const failure = enqueueOutcome['failure']
          expect(isRecord(failure) && failure['_tag'] === 'SchemaError').toBe(true)
        }
      }

      await Effect.runPromise(loop.start(() => Effect.void))
      try {
        await effectOutcome(loop.advanceFrame, [amount], (success) => isRecord(success) && finiteTree(success))
        await effectOutcome(loop.submitFrame, [value], (success) => success === undefined)
      } finally {
        await Effect.runPromise(loop.stop)
      }

      const initialTick = await Effect.runPromise(PublicApplication.makeGameLoop(value as never))
      const started = await Effect.runPromise(Effect.result(initialTick.start(() => Effect.void)))
      const validation = SimulationTick.result(value as never)
      if (value !== undefined && validation._tag === 'Failure') {
        expect(started._tag).toBe('Failure')
        if (started._tag === 'Failure') expect(started.failure._tag).toBe('BrandError')
      } else {
        expect(started._tag).toBe('Success')
        await Effect.runPromise(initialTick.stop)
      }
    }),
    checks,
  )
})
