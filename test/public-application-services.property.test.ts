import fc from 'fast-check'
import { Duration, Effect, Layer, Result, Schedule, Schema } from 'effect'
import { expect, it } from 'vitest'
import { BlockAddressSchema, DomainEventSchema, RecipeGroup, WorldIdSchema } from '@nerima-games/mc-kernel'
import * as App from '../src/index.js'
import {
  assertEffectOutcome,
  hostileScalarInput,
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

it('public result schemas validate branded recipes, stored stacks, and container counts', () => {
  const outputResult = App.itemStack('stick', 1)
  const output = Result.getOrThrow(outputResult)
  const exact = Result.getOrThrow(App.exactly('oak_log', 2))
  const shaped = Result.getOrThrow(App.shapedRecipe(
    'coverage:grouped-recipe',
    ['LL'],
    { L: exact },
    outputResult,
    {
      group: RecipeGroup('coverage-planks'),
      priority: App.RecipePriority(1),
      tags: [App.RecipeStationTag('minecraft:crafting_table')],
    },
  ))
  const itemTag = Result.getOrThrow(App.tagged('#coverage:items', 2))
  const tagged = Result.getOrThrow(App.shapelessRecipe('coverage:tagged-recipe', [itemTag], outputResult))
  const matched = (recipe: unknown) => ({ _tag: 'Match', recipe, output })

  expect(Schema.is(App.RecipeMatchSchema)(matched(shaped))).toBe(true)
  expect(Schema.is(App.RecipeMatchSchema)(matched(tagged))).toBe(true)
  const malformedRecipes = [
    { ...shaped, id: 7 },
    { ...shaped, id: '' },
    { ...shaped, pattern: { ...shaped.pattern, width: 4 } },
    {
      ...shaped,
      pattern: {
        ...shaped.pattern,
        cells: [{ ...shaped.pattern.cells[0], count: 0 }, shaped.pattern.cells[1]],
      },
    },
    { ...shaped, priority: Number.NaN },
    { ...shaped, group: null },
    { ...shaped, tags: [''] },
    {
      ...tagged,
      ingredients: [{ ...tagged.ingredients[0], tag: 'missing-hash-prefix' }],
    },
  ]
  for (const [index, recipe] of malformedRecipes.entries()) {
    expect(Schema.is(App.RecipeMatchSchema)(matched(recipe)), `malformed recipe ${index}`).toBe(false)
  }

  const emptyInventory = App.emptyInventory()
  expect(Schema.is(App.InventorySnapshotSchema)(emptyInventory)).toBe(true)
  expect(Schema.is(App.InventorySnapshotSchema)({
    slots: [null, ...emptyInventory.slots.slice(1)],
  })).toBe(false)
  expect(Schema.is(App.ItemStackFailureSchema)({
    _tag: 'ItemComponentPatchConflictError',
    componentKey: 'minecraft:custom_name',
  })).toBe(true)
  expect(Schema.is(App.ItemStackFailureSchema)({
    _tag: 'ItemComponentPatchConflictError',
    componentKey: '',
  })).toBe(false)

  const stack = Result.getOrThrow(App.itemStack('stone', 1))
  const storedStack = { ...stack, durability: null }
  expect(Schema.is(App.ContainerStoredStackSchema)(storedStack)).toBe(true)
  expect(Schema.is(App.ContainerStoredStackSchema)(null)).toBe(false)
  expect(Schema.is(App.InventoryCarriedSlotSchema)(stack)).toBe(true)
  expect(Schema.is(App.InventoryCarriedSlotSchema)({ ...stack, durability: { current: 1, max: 1 } })).toBe(false)

  const container = App.emptyContainer('schema-result-test', 'chest')
  expect(Schema.is(App.CreateContainerResultSchema)({ _tag: 'Created', container })).toBe(true)
  expect(Schema.is(App.CreateContainerResultSchema)({
    _tag: 'Created',
    container: { ...container, slots: [] },
  })).toBe(false)
  expect(Schema.is(App.ContainerTransferResultSchema)({
    _tag: 'Transferred', item: 'stone', count: 1, direction: 'PlayerToContainer',
  })).toBe(true)
  expect(Schema.is(App.ContainerTransferResultSchema)({
    _tag: 'Transferred', item: 'stone', count: 0, direction: 'PlayerToContainer',
  })).toBe(false)
  expect(Schema.is(App.ContainerTransferResultSchema)({
    _tag: 'Transferred', item: 'stone', count: Number.MAX_SAFE_INTEGER + 1,
    direction: 'PlayerToContainer',
  })).toBe(false)
  expect(Schema.is(App.ContainerTransferResultSchema)({
    _tag: 'InsufficientSource', available: -1,
  })).toBe(true)

  const helmet = {
    ...Result.getOrThrow(App.itemStack('iron_helmet', 1)),
    durability: App.durabilityForItem('iron_helmet'),
  }
  const damageResult = (item: unknown) => ({
    _tag: 'Applied',
    consumed: 0,
    damage: { _tag: 'Damaged', item, applied: 1 },
  })
  expect(Schema.is(App.ConsumeAndDamageAtResultSchema)(damageResult(helmet))).toBe(true)
  expect(Schema.is(App.ConsumeAndDamageAtResultSchema)(damageResult(null))).toBe(false)
  expect(Schema.is(App.ConsumeAndDamageAtResultSchema)(damageResult({ ...helmet, extra: true }))).toBe(false)
  expect(Schema.is(App.ConsumeAndDamageAtResultSchema)(damageResult({ ...helmet, item: 'unknown' }))).toBe(false)
  expect(Schema.is(App.ConsumeAndDamageAtResultSchema)(damageResult({
    ...helmet,
    durability: { current: 0, max: helmet.durability?.max },
  }))).toBe(false)
})

it('WorldCommitCoordinator.snapshot returns schema-valid snapshots and typed failures for hostile IDs', async () => {
  const snapshotSchema = Schema.Struct({ count: Schema.Int })
  const resultSchema = App.replicatedSnapshotSchema(snapshotSchema)
  const errorSchema = App.WorldCommitCoordinatorSnapshotErrorSchema
  const registeredOwnerId = Schema.decodeUnknownSync(App.ReplicatedOwnerIdSchema)('snapshot-property-owner')
  const coordinator = await Effect.runPromise(makeCoordinator([
    { ownerId: registeredOwnerId, schema: snapshotSchema, initialState: { count: 1 } },
  ]))

  const validOutcome = await Effect.runPromise(Effect.result(
    coordinator.snapshot(registeredOwnerId, snapshotSchema),
  ))
  assertEffectOutcome('WorldCommitCoordinator.snapshot success', () => validOutcome, resultSchema, errorSchema)
  expect(Result.isSuccess(validOutcome)).toBe(true)
  if (Result.isSuccess(validOutcome)) {
    const decoded = Schema.decodeUnknownSync(resultSchema, { onExcessProperty: 'error' })(validOutcome.success)
    expect(decoded).toStrictEqual({ world: worldId, revision: 0, state: { count: 1 } })
  }

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
        assertEffectOutcome('WorldCommitCoordinator.snapshot hostile owner', () => outcome, resultSchema, errorSchema)
        expect(Result.isFailure(outcome)).toBe(true)
        if (Result.isFailure(outcome)) {
          const decodedFailure = Schema.decodeUnknownSync(errorSchema, { onExcessProperty: 'error' })(outcome.failure)
          if (typeof candidate === 'string' && candidate.length > 0) {
            expect(decodedFailure).toBeInstanceOf(App.ReplicatedOwnerUnknown)
          } else {
            expect(decodedFailure._tag).toBe('SchemaError')
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
      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(Schema.is(App.InventoryServiceConstructorErrorSchema)(outcome.failure)).toBe(true)
      }
    }),
    checks,
  )
})

const validDomainEvent = (value: unknown): boolean =>
  Result.isSuccess(Schema.decodeUnknownResult(DomainEventSchema)(value))

it('autoSaveSchedule returns typed failures for invalid or overflowing Duration magnitudes', () => {
  fc.assert(
    fc.property(hostileScalar, (millis) => {
      if (typeof millis !== 'number') return
      const outcome = Effect.runSync(Effect.result(App.autoSaveSchedule(Duration.millis(millis))))
      assertEffectOutcome(
        'autoSaveSchedule',
        () => outcome,
        App.AutoSaveScheduleSchema,
        App.InvalidAutoSaveIntervalSchema,
      )
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
      assertEffectOutcome(
        'DomainEventBus.publish',
        () => outcome,
        Schema.Undefined,
        App.DomainEventBusErrorSchema,
      )
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
      if (Schema.is(App.EventSubscriberCapacitySchema)(rawCapacity)) {
        expect(Result.isSuccess(outcome)).toBe(true)
        if (Result.isSuccess(outcome)) {
          expect(typeof outcome.success.publish).toBe('function')
          expect(outcome.success.events).toBeDefined()
        }
      } else {
        expect(Result.isFailure(outcome)).toBe(true)
        if (Result.isFailure(outcome)) {
          expect(Schema.is(App.DomainEventBusErrorSchema)(outcome.failure)).toBe(true)
        }
      }
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
      assertEffectOutcome(
        'AchievementService.stageUnlock',
        () => staged,
        App.AchievementUnlockStageSchema,
        App.AchievementUnlockStageErrorSchema,
      )

      const unlocked = await Effect.runPromise(Effect.result(invokeEffect(service.unlock, [request])))
      assertEffectOutcome(
        'AchievementService.unlock',
        () => unlocked,
        Schema.Undefined,
        App.AchievementServiceErrorSchema,
      )
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
      assertEffectOutcome(
        'ContainerStorageService.createContainerAt',
        () => outcome,
        App.CreateContainerResultSchema,
        App.ContainerStorageServiceErrorSchema,
      )
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
      assertEffectOutcome(
        'ContainerStorageService.transferContainerItem',
        () => transfer,
        App.ContainerTransferResultSchema,
        App.ContainerStorageServiceErrorSchema,
      )

      const extracted = await Effect.runPromise(Effect.result(invokeEffect(fixture.service.extractContainerItem, [{
        address: source,
        containerSlot: slot,
        count,
      }])))
      assertEffectOutcome(
        'ContainerStorageService.extractContainerItem',
        () => extracted,
        App.ContainerExtractResultSchema,
        App.ContainerStorageServiceErrorSchema,
      )

      const moved = await Effect.runPromise(Effect.result(invokeEffect(fixture.service.moveContainerItem, [{
        sourceAddress: source,
        sourceSlot: slot,
        destinationAddress: destination,
        destinationSlot,
        count,
      }])))
      assertEffectOutcome(
        'ContainerStorageService.moveContainerItem',
        () => moved,
        App.ContainerMoveResultSchema,
        App.ContainerStorageServiceErrorSchema,
      )

      expect(App.validateContainerStorageSnapshot(await Effect.runPromise(fixture.service.snapshot))._tag).toBe('Valid')
      const playerSnapshotSchema = App.replicatedSnapshotSchema(App.PlayerStorageSnapshotSchema)
      const playerSnapshotOutcome = await Effect.runPromise(Effect.result(
        fixture.coordinator.snapshot(fixture.playerOwnerId, App.PlayerStorageSnapshotSchema),
      ))
      assertEffectOutcome(
        'WorldCommitCoordinator.snapshot after container transfer',
        () => playerSnapshotOutcome,
        playerSnapshotSchema,
        App.WorldCommitCoordinatorSnapshotErrorSchema,
      )
      expect(Result.isSuccess(playerSnapshotOutcome)).toBe(true)
      if (Result.isSuccess(playerSnapshotOutcome)) {
        const playerSnapshot = Schema.decodeUnknownSync(
          playerSnapshotSchema,
          { onExcessProperty: 'error' },
        )(playerSnapshotOutcome.success)
        expect(playerSnapshot.world).toBe(worldId)
        expect(playerSnapshot.revision).toBe(await Effect.runPromise(fixture.coordinator.revision))
        expect(App.validatePlayerStorageSnapshot(playerSnapshot.state)._tag).toBe('Valid')
      }
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
      assertEffectOutcome(
        'BrewingService.setBottle',
        () => bottle,
        App.BrewingServiceStateSchema,
        App.BrewingServiceErrorSchema,
      )

      const ingredient = await runBrewing(fixture, Effect.result(invokeEffect(fixture.brewing.setIngredient, [stackValue])))
      assertEffectOutcome(
        'BrewingService.setIngredient',
        () => ingredient,
        App.BrewingServiceStateSchema,
        App.BrewingServiceErrorSchema,
      )

      const fuel = await runBrewing(fixture, Effect.result(invokeEffect(fixture.brewing.setFuel, [stackValue])))
      assertEffectOutcome(
        'BrewingService.setFuel',
        () => fuel,
        App.BrewingServiceStateSchema,
        App.BrewingServiceErrorSchema,
      )

      const restored = await runBrewing(fixture, Effect.result(invokeEffect(fixture.brewing.restore, [snapshot])))
      assertEffectOutcome(
        'BrewingService.restore',
        () => restored,
        Schema.Undefined,
        App.BrewingServiceErrorSchema,
      )
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
      assertEffectOutcome(
        'FurnaceService.setInput',
        () => input,
        Schema.Undefined,
        App.FurnaceServiceErrorSchema,
      )

      const fuel = await runFurnace(fixture, Effect.result(invokeEffect(fixture.furnace.setFuel, [stackValue])))
      assertEffectOutcome(
        'FurnaceService.setFuel',
        () => fuel,
        Schema.Undefined,
        App.FurnaceServiceErrorSchema,
      )

      const restored = await runFurnace(fixture, Effect.result(invokeEffect(fixture.furnace.restore, [snapshot])))
      assertEffectOutcome(
        'FurnaceService.restore',
        () => restored,
        Schema.Undefined,
        App.FurnaceServiceErrorSchema,
      )

      const collected = await runFurnace(fixture, Effect.result(invokeEffect(fixture.furnace.prepareCollectOutput, [inventory])))
      assertEffectOutcome(
        'FurnaceService.prepareCollectOutput',
        () => collected,
        App.FurnaceCollectionCandidateSchema,
        App.FurnaceServiceErrorSchema,
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
      assertEffectOutcome(
        'InventoryService.add',
        () => add,
        App.InventoryAddLeftoverSchema,
        App.InventoryMutationErrorSchema,
      )

      const remove = await Effect.runPromise(Effect.result(invokeEffect(service.remove, [item, count])))
      assertEffectOutcome(
        'InventoryService.remove',
        () => remove,
        App.InventoryCountSchema,
        App.InventoryMutationErrorSchema,
      )

      const removeAt = await Effect.runPromise(Effect.result(invokeEffect(service.removeAt, [slot, item, count])))
      assertEffectOutcome(
        'InventoryService.removeAt',
        () => removeAt,
        App.InventoryRemoveAtResultSchema,
        App.InventoryMutationErrorSchema,
      )

      const stack = { ...Result.getOrThrow(App.itemStack('stone', 1)), count, durability: null }
      const inserted = await Effect.runPromise(Effect.result(invokeEffect(service.addStoredStack, [stack])))
      assertEffectOutcome(
        'InventoryService.addStoredStack',
        () => inserted,
        App.AddStoredStackResultSchema,
        Schema.Never,
      )

      expect(Schema.is(App.InventorySnapshotSchema)(await Effect.runPromise(service.snapshot))).toBe(true)
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
      assertEffectOutcome(
        'InventoryService.click',
        () => click,
        App.InventoryClickResultSchema,
        App.InventoryMutationErrorSchema,
      )

      const slot = await Effect.runPromise(Effect.result(invokeEffect(service.setSlot, [index, stackValue])))
      assertEffectOutcome(
        'InventoryService.setSlot',
        () => slot,
        App.InventorySetSlotResultSchema,
        App.InventoryMutationErrorSchema,
      )

      const moved = await Effect.runPromise(Effect.result(invokeEffect(service.moveStack, [index, otherIndex])))
      assertEffectOutcome(
        'InventoryService.moveStack',
        () => moved,
        App.InventoryMoveResultSchema,
        App.InventoryMutationErrorSchema,
      )

      const quickMoved = await Effect.runPromise(Effect.result(invokeEffect(service.quickMove, [index])))
      assertEffectOutcome(
        'InventoryService.quickMove',
        () => quickMoved,
        App.InventoryQuickMoveResultSchema,
        App.InventoryMutationErrorSchema,
      )
      expect(Schema.is(App.InventorySnapshotSchema)(await Effect.runPromise(service.snapshot))).toBe(true)
    }),
    checks,
  )
})

it('InventoryService.setSlot rejects a non-record stack without changing state', async () => {
  const service = await makeInventory()
  const outcome = await Effect.runPromise(service.setSlot(0, 'not-a-stack' as never))

  expect(outcome).toStrictEqual({ _tag: 'InvalidStack' })
  expect(Schema.is(App.InventorySnapshotSchema)(await Effect.runPromise(service.snapshot))).toBe(true)
})

it('InventoryService restore and restoreStorage reject malformed snapshots or leave valid normalized storage', async () => {
  await fc.assert(
    fc.asyncProperty(hostileValue, async (snapshot) => {
      const service = await makeInventory()
      const restoredInventory = await Effect.runPromise(Effect.result(invokeEffect(service.restore, [snapshot])))
      assertEffectOutcome(
        'InventoryService.restore',
        () => restoredInventory,
        App.InventoryCountSchema,
        App.InventoryMutationErrorSchema,
      )
      expect(Schema.is(App.InventorySnapshotSchema)(await Effect.runPromise(service.snapshot))).toBe(true)

      const restoredStorage = await Effect.runPromise(Effect.result(invokeEffect(service.restoreStorage, [snapshot])))
      assertEffectOutcome(
        'InventoryService.restoreStorage',
        () => restoredStorage,
        Schema.Undefined,
        App.InventoryRestoreStorageErrorSchema,
      )
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
      assertEffectOutcome(
        'InventoryService.consumeAndDamageAt',
        () => consumeAndDamage,
        App.ConsumeAndDamageAtResultSchema,
        App.InventoryConsumeAndDamageErrorSchema,
      )

      const grid = { width: dimension, height: 1, cells: [] }
      const preview = await Effect.runPromise(Effect.result(invokeEffect(service.previewCraft, [grid])))
      assertEffectOutcome(
        'InventoryService.previewCraft',
        () => preview,
        App.RecipeMatchSchema,
        Schema.Never,
      )

      const crafted = await Effect.runPromise(Effect.result(invokeEffect(service.craft, [grid])))
      assertEffectOutcome(
        'InventoryService.craft',
        () => crafted,
        App.CraftResultSchema,
        App.InventoryCraftErrorSchema,
      )
      expect(Schema.is(App.InventorySnapshotSchema)(await Effect.runPromise(service.snapshot))).toBe(true)
    }),
    checks,
  )
})
