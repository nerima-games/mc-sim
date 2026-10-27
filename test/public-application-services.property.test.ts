import fc from 'fast-check'
import { Duration, Effect, Layer, Result, Schedule, Schema } from 'effect'
import { expect, it } from 'vitest'
import { BlockAddressSchema, DomainEventSchema, isItemStack, WorldIdSchema } from '@nerima-games/mc-kernel'
import * as App from '../src/index.js'
import {
  assertEffectOutcome,
  finiteTree,
  hostileScalarInput,
  isRecord,
  invokeEffect,
  structuredInput,
} from './public-property-helpers.js'

const hostileScalar = hostileScalarInput({
  numbers: fc.oneof(
    fc.double(),
    fc.constantFrom<unknown>(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      -1,
      0,
      1,
      1_000_000_000_000,
    ),
  ),
  includeNullish: true,
})

const hostileValue = structuredInput(hostileScalar)

const hasAllowedTag = (value: unknown, tags: ReadonlyArray<string>): boolean =>
  isRecord(value) && typeof value['_tag'] === 'string' && tags.includes(value['_tag']) && finiteTree(value)

const checks = { numRuns: 100 }

const ownerId = Schema.decodeUnknownSync(App.ReplicatedOwnerIdSchema)('public-application-services-property')
const worldId = Schema.decodeUnknownSync(WorldIdSchema)('public-application-services-property')
const capacity = Schema.decodeUnknownSync(App.EventSubscriberCapacitySchema)(8)

const makeCoordinator = (
  owners: ReadonlyArray<App.ReplicatedOwnerRegistration<Schema.Codec<any, any>>>,
) => App.makeWorldCommitCoordinator({ world: worldId, owners })

const makeBrewingFixture = Effect.gen(function* () {
  const registration = Result.getOrThrow(App.makeBrewingServiceRegistration(ownerId))
  const coordinator = yield* makeCoordinator([registration])
  const brewing = yield* App.makeBrewingService(ownerId)
  return { brewing, coordinator }
})

const runBrewing = <A, E>(
  fixture: Readonly<{ brewing: App.BrewingServiceApi; coordinator: App.WorldCommitCoordinatorApi }>,
  effect: Effect.Effect<A, E, App.WorldCommitCoordinator>,
) => Effect.runPromise(Effect.provide(effect, Layer.succeed(App.WorldCommitCoordinator, fixture.coordinator)))

const makeFurnaceFixture = Effect.gen(function* () {
  const registration = Result.getOrThrow(App.makeFurnaceServiceRegistration(ownerId))
  const coordinator = yield* makeCoordinator([registration])
  const furnace = yield* App.makeFurnaceService(ownerId)
  return { furnace, coordinator }
})

const runFurnace = <A, E>(
  fixture: Readonly<{ furnace: App.FurnaceServiceApi; coordinator: App.WorldCommitCoordinatorApi }>,
  effect: Effect.Effect<A, E, App.WorldCommitCoordinator>,
) => Effect.runPromise(Effect.provide(effect, Layer.succeed(App.WorldCommitCoordinator, fixture.coordinator)))

const containerAddress = (x: number) => Schema.decodeUnknownSync(BlockAddressSchema)({
  dimension: 'overworld',
  position: { x, y: 64, z: 3 },
})

const makeContainerFixture = Effect.gen(function* () {
  const playerOwnerId = Schema.decodeUnknownSync(App.ReplicatedOwnerIdSchema)('public-application-player')
  const coordinator = yield* App.makeWorldCommitCoordinator({
    world: worldId,
    owners: [
      App.containerStorageOwnerRegistration(),
      App.playerStorageOwnerRegistration(playerOwnerId),
    ],
  })
  const service = yield* App.makeContainerStorageService().pipe(
    Effect.provide(Layer.succeed(App.WorldCommitCoordinator, coordinator)),
  )
  return { coordinator, playerOwnerId, service }
})

const makeInventory = () => Effect.runPromise(App.makeInventoryService())

it('WorldCommitCoordinator.snapshot returns a typed unknown-owner failure for hostile IDs', async () => {
  const snapshotSchema = Schema.Struct({ count: Schema.Int })
  const registeredOwnerId = Schema.decodeUnknownSync(App.ReplicatedOwnerIdSchema)('snapshot-property-owner')
  const coordinator = await Effect.runPromise(makeCoordinator([
    { ownerId: registeredOwnerId, schema: snapshotSchema, initialState: { count: 1 } },
  ]))
  const validSnapshot = await Effect.runPromise(coordinator.snapshot(registeredOwnerId, snapshotSchema))
  expect(validSnapshot).toStrictEqual({ world: worldId, revision: 0, state: { count: 1 } })

  const hostileOwnerIds = fc.tuple(
    fc.constant<unknown>(null),
    fc.constantFrom<unknown>(false, true),
    fc.double(),
    fc.constantFrom<unknown>(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    fc.constant<unknown>(''),
    fc.oneof(fc.constant<unknown>({}), fc.record({ unexpected: fc.string() })),
    fc.string({ minLength: 1 }).filter((candidate) => candidate !== registeredOwnerId),
  )

  await fc.assert(
    fc.asyncProperty(hostileOwnerIds, async (candidates) => {
      await Promise.all(candidates.map(async (candidate) => {
        const snapshot = () => coordinator.snapshot(candidate as App.ReplicatedOwnerId, snapshotSchema)
        expect(snapshot).not.toThrow()

        const outcome = await Effect.runPromise(Effect.result(snapshot()))
        expect(Result.isFailure(outcome)).toBe(true)
        if (Result.isFailure(outcome)) {
          if (typeof candidate === 'string' && candidate.length > 0) {
            expect(outcome.failure).toBeInstanceOf(App.ReplicatedOwnerUnknown)
          } else {
            expect(outcome.failure._tag).toBe('SchemaError')
          }
        }
      }))
    }),
    checks,
  )
})

it('makeInventoryService returns its typed failure for a null constructor envelope', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constant(null), async (initial) => {
      const outcome = await Effect.runPromise(Effect.result(invokeEffect(App.makeInventoryService, [initial])))
      assertEffectOutcome(outcome)
      expect(Result.isFailure(outcome)).toBe(true)
    }),
    checks,
  )
})

const validInventory = (value: unknown): boolean => {
  if (!isRecord(value) || !Array.isArray(value['slots']) || value['slots'].length !== App.INVENTORY_SLOT_COUNT) return false
  if (!value['slots'].every((slot) => slot === undefined || isItemStack(slot))) return false
  const normalized = App.normaliseInventory(value as App.Inventory)
  return Result.isSuccess(normalized)
}

const validDomainEvent = (value: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(DomainEventSchema)(value))

it('autoSaveSchedule returns typed failures for invalid or overflowing Duration magnitudes', () => {
  fc.assert(
    fc.property(hostileScalar, (millis) => {
      if (typeof millis !== 'number') return
      const outcome = Effect.runSync(Effect.result(App.autoSaveSchedule(Duration.millis(millis))))
      if (Number.isFinite(millis) && millis >= 1 && millis <= Number.MAX_SAFE_INTEGER) {
        expect(Result.isSuccess(outcome)).toBe(true)
        if (Result.isSuccess(outcome)) expect(Schedule.isSchedule(outcome.success)).toBe(true)
      } else {
        expect(Result.isFailure(outcome)).toBe(true)
        if (Result.isFailure(outcome)) {
          expect(outcome.failure).toMatchObject({ _tag: 'InvalidAutoSaveInterval' })
        }
      }
    }),
    checks,
  )
})

it('DomainEventBus.publish rejects malformed fields or publishes schema-valid events', async () => {
  const bus = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* App.DomainEventBus
      return service
    }).pipe(Effect.provide(App.DomainEventBusLayer(capacity))),
  )

  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileScalar, hostileScalar, hostileScalar), async ([tick, player, achievement]) => {
      const event = { _tag: 'AchievementUnlocked', tick, player, achievement }
      const outcome = await Effect.runPromise(Effect.result(invokeEffect(bus.publish, [event])))
      assertEffectOutcome(outcome)
      if (validDomainEvent(event)) {
        expect(Result.isSuccess(outcome)).toBe(true)
        if (Result.isSuccess(outcome)) expect(outcome.success).toBeUndefined()
      } else {
        expect(Result.isFailure(outcome)).toBe(true)
      }
    }),
    checks,
  )
})

it('DomainEventBusLayer rejects invalid capacities or provides a usable bus', async () => {
  await fc.assert(
    fc.asyncProperty(hostileScalar, async (rawCapacity) => {
      const makeLayer = App.DomainEventBusLayer as unknown as (
        capacity: unknown,
      ) => Layer.Layer<App.DomainEventBus, Schema.SchemaError>
      const layer = makeLayer(rawCapacity)
      const outcome = await Effect.runPromise(Effect.result(
        Effect.gen(function* () { return yield* App.DomainEventBus }).pipe(Effect.provide(layer)),
      ))
      assertEffectOutcome(outcome, (bus) =>
        isRecord(bus) && typeof bus['publish'] === 'function' && bus['events'] !== undefined,
      )
    }),
    checks,
  )
})

it('AchievementService stageUnlock and unlock reject malformed requests as typed failures', async () => {
  const layer = Layer.provideMerge(
    Layer.mergeAll(
      App.StatisticsServiceLayer(),
      App.DomainEventBusLayer(capacity),
      App.WorldCommitCoordinatorLayer({ world: worldId, dimensions: [], owners: [App.ACHIEVEMENT_OWNER_REGISTRATION] }),
    ),
  )(App.AchievementServiceLayer)
  const service = await Effect.runPromise(
    Effect.gen(function* () { return yield* App.AchievementService }).pipe(Effect.provide(layer)),
  )

  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileScalar, hostileScalar), async ([player, tick]) => {
      const request = { achievement: null, player, tick }
      const staged = await Effect.runPromise(Effect.result(invokeEffect(service.stageUnlock, [request])))
      assertEffectOutcome(staged, (value) =>
        isRecord(value) && (
          value['_tag'] === 'AchievementAlreadyUnlocked' ||
          (value['_tag'] === 'PendingAchievementUnlock' &&
            validDomainEvent(value['event']) &&
            Result.isSuccess(Schema.decodeUnknownResult(App.AchievementStatisticsSchema)(value['candidate']?.state)))
        ),
      )

      const unlocked = await Effect.runPromise(Effect.result(invokeEffect(service.unlock, [request])))
      assertEffectOutcome(unlocked, (value) => value === undefined)
    }),
    checks,
  )
})

it('ContainerStorageService validates hostile create kinds and revision expectations', async () => {
  const fixture = await Effect.runPromise(makeContainerFixture)
  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileValue, hostileScalar), async ([kind, expectedRevision]) => {
      const outcome = await Effect.runPromise(Effect.result(invokeEffect(
        fixture.service.createContainerAt,
        [containerAddress(40), kind, { expectedRevision }],
      )))
      assertEffectOutcome(outcome, (value) => hasAllowedTag(value, ['Created', 'AlreadyExists', 'InvalidContainerId']))
      const snapshot = await Effect.runPromise(fixture.service.snapshot)
      expect(App.validateContainerStorageSnapshot(snapshot)._tag).toBe('Valid')
    }),
    checks,
  )
})

it('ContainerStorageService transfer, extract and move return tagged outcomes and keep snapshots valid', async () => {
  const fixture = await Effect.runPromise(makeContainerFixture)
  const source = containerAddress(41)
  const destination = containerAddress(42)
  await Effect.runPromise(fixture.service.createContainerAt(source, 'chest'))
  await Effect.runPromise(fixture.service.createContainerAt(destination, 'chest'))

  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileScalar, hostileScalar, hostileScalar, hostileScalar), async ([slot, count, direction, destinationSlot]) => {
      const transfer = await Effect.runPromise(Effect.result(invokeEffect(fixture.service.transferContainerItem, [{
        playerOwnerId: fixture.playerOwnerId,
        address: source,
        direction,
        playerSlot: slot,
        containerSlot: slot,
        count,
      }])))
      assertEffectOutcome(transfer, (value) => hasAllowedTag(value, [
        'Transferred', 'ContainerNotFound', 'InvalidPlayerSlot', 'InvalidContainerSlot', 'InvalidCount',
        'EmptySource', 'InsufficientSource', 'DestinationMismatch', 'DestinationFull', 'InvalidDirection',
        'InvalidSourceStack', 'InvalidDestinationStack', 'InvalidSourceDurability', 'ItemStackFailure',
      ]))

      const extracted = await Effect.runPromise(Effect.result(invokeEffect(fixture.service.extractContainerItem, [{
        address: source,
        containerSlot: slot,
        count,
      }])))
      assertEffectOutcome(extracted, (value) => hasAllowedTag(value, [
        'Extracted', 'ContainerNotFound', 'InvalidContainerSlot', 'InvalidCount', 'EmptySource',
        'InsufficientSource', 'InvalidSourceStack', 'InvalidSourceDurability', 'ItemStackFailure',
      ]))

      const moved = await Effect.runPromise(Effect.result(invokeEffect(fixture.service.moveContainerItem, [{
        sourceAddress: source,
        sourceSlot: slot,
        destinationAddress: destination,
        destinationSlot,
        count,
      }])))
      assertEffectOutcome(moved, (value) => hasAllowedTag(value, [
        'Moved', 'SourceContainerNotFound', 'DestinationContainerNotFound', 'InvalidSourceSlot',
        'InvalidDestinationSlot', 'InvalidCount', 'EmptySource', 'InsufficientSource', 'DestinationMismatch',
        'DestinationFull', 'InvalidSourceStack', 'InvalidDestinationStack', 'InvalidSourceDurability',
        'ItemStackFailure',
      ]))

      expect(App.validateContainerStorageSnapshot(await Effect.runPromise(fixture.service.snapshot))._tag).toBe('Valid')
      expect(App.validatePlayerStorageSnapshot(await Effect.runPromise(
        fixture.coordinator.snapshot(fixture.playerOwnerId, App.PlayerStorageSnapshotSchema),
      ).then((snapshot) => snapshot.state))._tag).toBe('Valid')
    }),
    checks,
  )
})

it('BrewingService setters and restore reject hostile bottle indices, stacks, and snapshots', async () => {
  const fixture = await Effect.runPromise(makeBrewingFixture)
  const validBottle = Result.getOrThrow(App.itemStack('water_bottle', 1))
  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileScalar, hostileValue, hostileValue), async ([index, stackValue, snapshot]) => {
      const bottle = await runBrewing(fixture, Effect.result(invokeEffect(fixture.brewing.setBottle, [index, validBottle])))
      assertEffectOutcome(bottle, (value) => Result.isSuccess(Schema.decodeUnknownResult(App.BrewingServiceStateSchema)(value)))

      const ingredient = await runBrewing(fixture, Effect.result(invokeEffect(fixture.brewing.setIngredient, [stackValue])))
      assertEffectOutcome(ingredient, (value) => Result.isSuccess(Schema.decodeUnknownResult(App.BrewingServiceStateSchema)(value)))

      const fuel = await runBrewing(fixture, Effect.result(invokeEffect(fixture.brewing.setFuel, [stackValue])))
      assertEffectOutcome(fuel, (value) => Result.isSuccess(Schema.decodeUnknownResult(App.BrewingServiceStateSchema)(value)))

      const restored = await runBrewing(fixture, Effect.result(invokeEffect(fixture.brewing.restore, [snapshot])))
      assertEffectOutcome(restored, (value) => value === undefined)
      expect(Schema.decodeUnknownResult(App.BrewingServiceStateSchema)(await runBrewing(fixture, fixture.brewing.snapshot))._tag).toBe('Success')
    }),
    checks,
  )
})

it('FurnaceService setters, restore, and output collection reject invalid values or preserve valid state', async () => {
  const fixture = await Effect.runPromise(makeFurnaceFixture)
  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileValue, hostileValue, hostileValue), async ([stackValue, snapshot, inventory]) => {
      const input = await runFurnace(fixture, Effect.result(invokeEffect(fixture.furnace.setInput, [stackValue])))
      assertEffectOutcome(input, (value) => value === undefined)

      const fuel = await runFurnace(fixture, Effect.result(invokeEffect(fixture.furnace.setFuel, [stackValue])))
      assertEffectOutcome(fuel, (value) => value === undefined)

      const restored = await runFurnace(fixture, Effect.result(invokeEffect(fixture.furnace.restore, [snapshot])))
      assertEffectOutcome(restored, (value) => value === undefined)

      const collected = await runFurnace(fixture, Effect.result(invokeEffect(fixture.furnace.prepareCollectOutput, [inventory])))
      assertEffectOutcome(collected, (value) =>
        isRecord(value) && isRecord(value['outcome']) &&
        typeof value['outcome']['result'] === 'object' && value['outcome']['result'] !== null &&
        validInventory(value['outcome']['inventory']) &&
        App.validateFurnaceSnapshot(value['outcome']['furnace'])._tag === 'Valid',
      )
      expect(App.validateFurnaceSnapshot(await runFurnace(fixture, fixture.furnace.snapshot))._tag).toBe('Valid')
    }),
    checks,
  )
})

it('InventoryService add, remove, removeAt, and stored-stack insertion remain typed and finite', async () => {
  const service = await makeInventory()
  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileScalar, hostileScalar, hostileScalar), async ([item, count, slot]) => {
      const add = await Effect.runPromise(Effect.result(invokeEffect(service.add, [item, count])))
      assertEffectOutcome(add, (value) => typeof value === 'number' && Number.isFinite(value))

      const remove = await Effect.runPromise(Effect.result(invokeEffect(service.remove, [item, count])))
      assertEffectOutcome(remove, (value) => typeof value === 'number' && Number.isFinite(value))

      const removeAt = await Effect.runPromise(Effect.result(invokeEffect(service.removeAt, [slot, item, count])))
      assertEffectOutcome(removeAt, (value) => hasAllowedTag(value, [
        'Removed', 'InvalidSlot', 'InvalidCount', 'EmptySlot', 'ItemMismatch', 'Insufficient',
      ]))

      const stack = { ...Result.getOrThrow(App.itemStack('stone', 1)), count, durability: null }
      const inserted = await Effect.runPromise(Effect.result(invokeEffect(service.addStoredStack, [stack])))
      assertEffectOutcome(inserted, (value) => hasAllowedTag(value, ['Added', 'InvalidStack', 'ItemStackFailure']))

      expect(validInventory(await Effect.runPromise(service.snapshot))).toBe(true)
    }),
    checks,
  )
})

it('InventoryService click, setSlot, moveStack, and quickMove return valid tagged outcomes', async () => {
  const service = await makeInventory()
  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileScalar, hostileScalar, hostileValue), async ([index, otherIndex, stackValue]) => {
      const click = await Effect.runPromise(Effect.result(invokeEffect(service.click, [{
        _tag: 'LeftClick',
        slotIndex: index,
        carried: stackValue,
      }])))
      assertEffectOutcome(click, (value) => hasAllowedTag(value, [
        'PickedUp', 'Placed', 'Merged', 'Swapped', 'NoChange', 'InvalidSlot', 'InvalidCount',
      ]))

      const slot = await Effect.runPromise(Effect.result(invokeEffect(service.setSlot, [index, stackValue])))
      assertEffectOutcome(slot, (value) => isRecord(value) && ['Updated', 'InvalidSlot', 'InvalidStack'].includes(String(value['_tag'])))

      const moved = await Effect.runPromise(Effect.result(invokeEffect(service.moveStack, [index, otherIndex])))
      assertEffectOutcome(moved, (value) => hasAllowedTag(value, [
        'Moved', 'Merged', 'Swapped', 'InvalidSlot', 'EmptySlot', 'NoChange',
      ]))

      const quickMoved = await Effect.runPromise(Effect.result(invokeEffect(service.quickMove, [index])))
      assertEffectOutcome(quickMoved, (value) => hasAllowedTag(value, ['Moved', 'InvalidSlot', 'EmptySlot', 'NoChange']))
      expect(validInventory(await Effect.runPromise(service.snapshot))).toBe(true)
    }),
    checks,
  )
})

it('InventoryService restore and restoreStorage reject malformed snapshots or leave valid normalized storage', async () => {
  await fc.assert(
    fc.asyncProperty(hostileValue, async (snapshot) => {
      const service = await makeInventory()
      const restoredInventory = await Effect.runPromise(Effect.result(invokeEffect(service.restore, [snapshot])))
      assertEffectOutcome(restoredInventory, (value) => typeof value === 'number' && Number.isFinite(value))
      expect(validInventory(await Effect.runPromise(service.snapshot))).toBe(true)

      const restoredStorage = await Effect.runPromise(Effect.result(invokeEffect(service.restoreStorage, [snapshot])))
      assertEffectOutcome(restoredStorage, (value) => value === undefined)
      expect(App.validatePlayerStorageSnapshot(await Effect.runPromise(service.storageSnapshot))._tag).toBe('Valid')
    }),
    checks,
  )
})

it('InventoryService consume, previewCraft, and craft handle hostile request fields without invalid successes', async () => {
  const service = await makeInventory()
  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileScalar, hostileScalar, hostileScalar), async ([count, amount, dimension]) => {
      const consumeAndDamage = await Effect.runPromise(Effect.result(invokeEffect(service.consumeAndDamageAt, [{
        consume: { item: 'stone', count },
        damage: {
          location: { _tag: 'Inventory', slotIndex: amount },
          expectedItem: 'stone',
          amount,
        },
      }])))
      assertEffectOutcome(consumeAndDamage, (value) => hasAllowedTag(value, [
        'Applied', 'InvalidConsumableCount', 'InvalidDamageAmount', 'InvalidLocation', 'DamageTargetMismatch',
        'NotDamageable', 'InvalidDurability', 'EquipmentFailure', 'StorageFailure', 'DamageRejected',
        'InsufficientConsumable', 'ItemStackFailure',
      ]))

      const grid = { width: dimension, height: 1, cells: [] }
      const preview = await Effect.runPromise(Effect.result(invokeEffect(service.previewCraft, [grid])))
      assertEffectOutcome(preview, (value) =>
        isRecord(value) && (value['_tag'] === 'NoMatch' ||
          (value['_tag'] === 'Match' && isItemStack(value['output']))),
      )

      const crafted = await Effect.runPromise(Effect.result(invokeEffect(service.craft, [grid])))
      assertEffectOutcome(crafted, (value) =>
        isRecord(value) &&
        ['Crafted', 'NoMatch', 'MissingIngredients', 'NoRoom'].includes(String(value['_tag'])),
      )
      expect(validInventory(await Effect.runPromise(service.snapshot))).toBe(true)
    }),
    checks,
  )
})
