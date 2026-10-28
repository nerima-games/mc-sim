import { Effect, Layer, Result, Schema } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import * as fc from 'fast-check'
import {
  BrewingService,
  BrewingServiceLayer,
  BrewingBottleIndexSchema,
  BrewingElapsedSecsSchema,
  BrewingServicePlanSnapshotSchema,
  BrewingServiceStateSchema,
  PotionDrinkFailureSchema,
  PotionDrinkIntentSchema,
  PotionDrinkInventorySnapshotSchema,
  PotionDrinkOutcomeSchema,
  PotionDrinkPlanSchema,
  PotionEffectApplicationSchema,
  PotionEffectAmplifierSchema,
  PotionDrinkSlotIndexSchema,
  makeBrewingService,
  makeBrewingServiceRegistration,
  type BrewingServiceApi,
} from '../src/application/brewing-service.js'
import { ReplicatedOwnerIdSchema } from '../src/application/replicated-state.js'
import {
  makeWorldCommitCoordinator,
  WorldCommitCoordinator,
  WorldRevisionConflict,
  type WorldCommitCoordinatorApi,
} from '../src/application/world-commit-coordinator.js'
import { BREWING_FUEL_ITEM, BREWING_MAX_FUEL_CHARGES, BREWING_TIME_SECS } from '../src/domain/brewing.js'
import { itemStack } from '../src/domain/inventory.js'
import { EntityIdSchema, SimulationTickSchema, WorldIdSchema, WorldRevisionSchema } from '@nerima-games/mc-kernel'
import * as Inventory from '../src/domain/inventory.js'
import * as PlayerStorage from '../src/domain/player-storage.js'

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const brewingOwnerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('test:brewing')
const potionOwnerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('test:potion-owner')
const potionActor = Schema.decodeUnknownSync(EntityIdSchema)('player-drinking')
const potionTick = Schema.decodeUnknownSync(SimulationTickSchema)(12)

const makeBrewingFixture = Effect.gen(function* () {
  const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('brewing-service-test')
  const registration = must(makeBrewingServiceRegistration(brewingOwnerId))
  const coordinator = yield* makeWorldCommitCoordinator({ world, owners: [registration] })
  const brewing = yield* makeBrewingService(brewingOwnerId)
  return { brewing, coordinator }
})

type BrewingFixture = Readonly<{
  brewing: BrewingServiceApi
  coordinator: WorldCommitCoordinatorApi
}>

const withBrewing = <A, E, R>(
  run: (fixture: BrewingFixture) => Effect.Effect<A, E, R>,
) =>
  Effect.flatMap(makeBrewingFixture, (fixture) =>
    Effect.provide(run(fixture), Layer.succeed(WorldCommitCoordinator, fixture.coordinator)),
  )

const expectRequiredFields = (
  decode: (input: unknown) => unknown,
  example: Readonly<Record<string, unknown>>,
  fields: ReadonlyArray<string>,
) => {
  expect(() => decode(example)).not.toThrow()
  for (const field of fields) {
    const missing = { ...example }
    delete missing[field]
    expect(() => decode(missing), `missing ${field}`).toThrow()
    expect(() => decode({ ...example, [field]: null }), `null ${field}`).toThrow()
  }
}

describe('BrewingService', () => {
  it.effect('commits bottles, ingredient, fuel and brew progress through the world coordinator', () =>
    withBrewing(({ brewing, coordinator }) =>
      Effect.gen(function* () {
        yield* brewing.setBottle(0, must(itemStack('water_bottle', 1)))
        yield* brewing.setBottle(1, must(itemStack('water_bottle', 1)))
        yield* brewing.setIngredient(must(itemStack('nether_wart', 1)))
        yield* brewing.setFuel(must(itemStack(BREWING_FUEL_ITEM, 1)))
        yield* brewing.addFuel

        const outcome = yield* brewing.advance(BREWING_TIME_SECS)
        expect(outcome.brewedCount).toBe(1)
        expect((yield* brewing.snapshot).bottles).toEqual([
          must(itemStack('awkward_potion', 1)),
          must(itemStack('awkward_potion', 1)),
          undefined,
        ])

        const committed = yield* coordinator.snapshot(brewingOwnerId, BrewingServiceStateSchema)
        expect(committed.state.bottles[0]?.item).toBe('awkward_potion')
        expect(committed.state.ingredient).toBeUndefined()
      }),
    ),
  )

  it.effect('rejects malformed replicated service states', () =>
    Effect.gen(function* () {
      const malformedStates: ReadonlyArray<unknown> = [
        1,
        null,
        [],
        {},
        { bottles: null, ingredient: undefined, fuel: undefined, fuelCharges: 0, brewProgressSecs: 0 },
        { bottles: [] },
        {
          bottles: [undefined, undefined, undefined],
          fuelCharges: 0,
          brewProgressSecs: 0,
          fuel: undefined,
          extra: undefined,
        },
        {
          bottles: [],
          ingredient: undefined,
          fuel: undefined,
          fuelCharges: 0,
          brewProgressSecs: 0,
        },
      ]

      for (const state of malformedStates) {
        const decoded = yield* Effect.result(
          Schema.decodeUnknownEffect(BrewingServiceStateSchema)(state),
        )
        expect(Result.isFailure(decoded)).toBe(true)
      }
    }),
  )

  it.effect('preserves committed state after invalid commands and failed restore', () =>
    withBrewing(({ brewing }) =>
      Effect.gen(function* () {
        yield* brewing.setBottle(0, must(itemStack('water_bottle', 1)))
        const before = yield* brewing.snapshot

        const invalidBottle = yield* Effect.result(brewing.setBottle(3, undefined))
        expect(Result.isFailure(invalidBottle)).toBe(true)
        const invalidAdvance = yield* Effect.result(brewing.advance(-1))
        expect(Result.isFailure(invalidAdvance)).toBe(true)
        const invalidRestore = yield* Effect.result(brewing.restore({ bottles: [] }))
        expect(Result.isFailure(invalidRestore)).toBe(true)
        expect(yield* brewing.snapshot).toStrictEqual(before)
      }),
    ),
  )

  it.effect('leaves owner state unchanged when the coordinator rejects a commit', () =>
    withBrewing(({ brewing, coordinator }) =>
      Effect.gen(function* () {
        const before = yield* coordinator.snapshot(brewingOwnerId, BrewingServiceStateSchema)
        const rejectingCoordinator: WorldCommitCoordinatorApi = {
          ...coordinator,
          commit: (request) =>
            Effect.flatMap(
              Schema.decodeUnknownEffect(WorldRevisionSchema)(request.expectedRevision + 1),
              (actual) => Effect.fail(new WorldRevisionConflict({
                expected: request.expectedRevision,
                actual,
              })),
            ),
        }

        const rejected = yield* Effect.result(
          brewing.setBottle(0, must(itemStack('water_bottle', 1))).pipe(
            Effect.provide(Layer.succeed(WorldCommitCoordinator, rejectingCoordinator)),
          ),
        )
        expect(Result.isFailure(rejected)).toBe(true)

        const after = yield* coordinator.snapshot(brewingOwnerId, BrewingServiceStateSchema)
        expect(after).toStrictEqual(before)
      }),
    ),
  )

  it.effect('caps fuel, restores a snapshot and resets through the coordinator', () =>
    withBrewing(({ brewing }) =>
      Effect.gen(function* () {
        yield* brewing.setFuel(must(itemStack(BREWING_FUEL_ITEM, 64)))
        for (let charge = 0; charge < 21; charge += 1) yield* brewing.addFuel
        expect((yield* brewing.snapshot).fuelCharges).toBe(20)

        const saved = yield* brewing.snapshot
        yield* brewing.reset
        expect((yield* brewing.snapshot).fuelCharges).toBe(0)
        yield* brewing.restore(saved)
        expect((yield* brewing.snapshot).fuelCharges).toBe(20)
      }),
    ),
  )

  it.effect('validates owner initialization and provides a fresh service layer', () =>
    withBrewing(({ coordinator }) =>
      Effect.gen(function* () {
        expect(Result.isFailure(makeBrewingServiceRegistration(brewingOwnerId, { bottles: [] }))).toBe(true)

        const brewing = yield* BrewingService
        expect((yield* brewing.snapshot).fuelCharges).toBe(0)
      }).pipe(
        Effect.provide(
          Layer.merge(
            BrewingServiceLayer(brewingOwnerId),
            Layer.succeed(WorldCommitCoordinator, coordinator),
          ),
        ),
      ),
    ),
  )

  it.effect('builds every brewing state plan from the supplied snapshot without committing', () =>
    withBrewing(({ brewing, coordinator }) =>
      Effect.gen(function* () {
        const expectedRevision = yield* coordinator.revision
        let snapshot = {
          world: coordinator.worldId,
          expectedRevision,
          expectedDimensions: [],
          state: yield* brewing.snapshot,
        }
        const bottleIndex = Schema.decodeUnknownSync(BrewingBottleIndexSchema)(0)
        const bottlePlan = yield* brewing.planSetBottle(snapshot, bottleIndex, must(itemStack('water_bottle', 1)))
        snapshot = { ...snapshot, state: bottlePlan.result }
        const ingredientPlan = yield* brewing.planSetIngredient(snapshot, must(itemStack('nether_wart', 1)))
        snapshot = { ...snapshot, state: ingredientPlan.result }
        const fuelPlan = yield* brewing.planSetFuel(snapshot, must(itemStack(BREWING_FUEL_ITEM, 1)))
        snapshot = { ...snapshot, state: fuelPlan.result }
        const addedFuelPlan = yield* brewing.planAddFuel(snapshot)
        snapshot = { ...snapshot, state: addedFuelPlan.result }
        const elapsedSecs = Schema.decodeUnknownSync(BrewingElapsedSecsSchema)(BREWING_TIME_SECS)
        const advancePlan = yield* brewing.planAdvance(snapshot, elapsedSecs)
        const advancedState = Schema.decodeUnknownSync(BrewingServiceStateSchema)(advancePlan.changes[0]?.state)
        const restoredPlan = yield* brewing.planRestore({ ...snapshot, state: advancedState }, snapshot.state)
        const invalidRestorePlan = yield* Effect.result(
          brewing.planRestore({ ...snapshot, state: advancedState }, { bottles: [] }),
        )
        const resetPlan = yield* brewing.planReset({ ...snapshot, state: advancedState })

        expect(bottlePlan.changes[0]?.state).toEqual(bottlePlan.result)
        expect(ingredientPlan.changes[0]?.state).toEqual(ingredientPlan.result)
        expect(fuelPlan.changes[0]?.state).toEqual(fuelPlan.result)
        expect(addedFuelPlan.result.fuelCharges).toBe(BREWING_MAX_FUEL_CHARGES)
        expect(advancePlan.result.brewedCount).toBe(1)
        expect(advancedState.bottles[0]?.item).toBe('awkward_potion')
        expect(restoredPlan.result).toBeUndefined()
        expect(Result.isFailure(invalidRestorePlan)).toBe(true)
        expect(resetPlan.result).toBeUndefined()
        expect(Schema.decodeUnknownSync(BrewingServiceStateSchema)(restoredPlan.changes[0]?.state)).toEqual(snapshot.state)
        expect(Schema.decodeUnknownSync(BrewingServiceStateSchema)(resetPlan.changes[0]?.state).fuelCharges).toBe(0)
        expect(yield* coordinator.revision).toBe(expectedRevision)
      }),
    ),
  )

  it.effect('plans potion consumption with the player owner candidate, effect and post-commit event', () =>
    withBrewing(({ brewing, coordinator }) =>
      Effect.gen(function* () {
        const expectedRevision = yield* coordinator.revision
        // Minecraft Java Edition 1.21.4 base potions: Swiftness 3:00; Poison and
        // Regeneration 0:45. Sources: https://minecraft.wiki/w/Potion_of_Swiftness,
        // https://minecraft.wiki/w/Poison, https://minecraft.wiki/w/Regeneration.
        const examples = [
          { item: 'potion_of_swiftness', effect: { type: 'speed', durationSecs: 180, amplifier: 0 } },
          { item: 'potion_of_poison', effect: { type: 'poison', durationSecs: 45, amplifier: 0 } },
          { item: 'potion_of_regeneration', effect: { type: 'regeneration', durationSecs: 45, amplifier: 0 } },
        ] as const

        for (const { item, effect } of examples) {
          const inventory = must(Inventory.addItem(Inventory.emptyInventory(), item, 1)).inventory
          const state = PlayerStorage.storageFromInventory(inventory)
          const snapshot = {
            world: coordinator.worldId,
            expectedRevision,
            expectedDimensions: [],
            state,
          }
          const plan = yield* brewing.planDrinkPotion(snapshot, {
            inventoryOwnerId: potionOwnerId,
            actor: potionActor,
            slotIndex: Schema.decodeUnknownSync(PotionDrinkSlotIndexSchema)(0),
            tick: potionTick,
          })
          expect(plan.changes[0]).toMatchObject({ ownerId: potionOwnerId })
          const candidate = plan.changes[0]
          if (candidate === undefined) throw new Error('potion plan omitted its owner candidate')
          expect((candidate.state as PlayerStorage.PlayerStorage).inventory.slots[0]?.item).toBe('glass_bottle')
          expect(plan.result).toEqual({ _tag: 'Consumed', item, effect })
          expect(plan.postCommitEvents).toMatchObject([{
            _tag: 'ItemConsumed',
            tick: potionTick,
            actor: potionActor,
            use: 'potion',
          }])
        }

        for (const item of ['water_bottle', 'awkward_potion'] as const) {
          const inventory = must(Inventory.addItem(Inventory.emptyInventory(), item, 1)).inventory
          const plan = yield* brewing.planDrinkPotion({
            world: coordinator.worldId,
            expectedRevision,
            expectedDimensions: [],
            state: PlayerStorage.storageFromInventory(inventory),
          }, {
            inventoryOwnerId: potionOwnerId,
            actor: potionActor,
            slotIndex: Schema.decodeUnknownSync(PotionDrinkSlotIndexSchema)(0),
            tick: potionTick,
          })
          expect(plan.result).toEqual({ _tag: 'ConsumedWithoutEffect', item })
          expect(plan.postCommitEvents).toHaveLength(1)
        }

        const emptyInventory = Inventory.emptyInventory()
        const emptySlot = yield* Effect.result(brewing.planDrinkPotion({
          world: coordinator.worldId,
          expectedRevision,
          expectedDimensions: [],
          state: PlayerStorage.storageFromInventory(emptyInventory),
        }, {
          inventoryOwnerId: potionOwnerId,
          actor: potionActor,
          slotIndex: Schema.decodeUnknownSync(PotionDrinkSlotIndexSchema)(0),
          tick: potionTick,
        }))
        expect(Result.isFailure(emptySlot)).toBe(true)
        if (Result.isFailure(emptySlot)) expect(emptySlot.failure._tag).toBe('PotionDrinkEmptySlot')

        const notDrinkable = yield* Effect.result(brewing.planDrinkPotion({
          world: coordinator.worldId,
          expectedRevision,
          expectedDimensions: [],
          state: PlayerStorage.storageFromInventory(must(Inventory.addItem(emptyInventory, 'cod', 1)).inventory),
        }, {
          inventoryOwnerId: potionOwnerId,
          actor: potionActor,
          slotIndex: Schema.decodeUnknownSync(PotionDrinkSlotIndexSchema)(0),
          tick: potionTick,
        }))
        expect(Result.isFailure(notDrinkable)).toBe(true)
        if (Result.isFailure(notDrinkable)) expect(notDrinkable.failure._tag).toBe('PotionDrinkNotDrinkable')
        expect(yield* coordinator.revision).toBe(expectedRevision)
      }),
    ),
  )

  it('validates potion schemas as complete, required public values', () => {
    const revision = Schema.decodeUnknownSync(WorldRevisionSchema)(0)
    const emptyInventory = PlayerStorage.emptyPlayerStorage()
    const world = Schema.decodeUnknownSync(WorldIdSchema)('potion-schema-world')
    const drinkIntent = {
      inventoryOwnerId: potionOwnerId,
      actor: potionActor,
      slotIndex: Schema.decodeUnknownSync(PotionDrinkSlotIndexSchema)(0),
      tick: potionTick,
    }
    const outcome = {
      _tag: 'Consumed',
      item: 'potion_of_swiftness',
      effect: { type: 'speed', durationSecs: 180, amplifier: 0 },
    }
    const drinkPlan = {
      world,
      expectedRevision: revision,
      expectedDimensions: [],
      changes: [{ ownerId: potionOwnerId, state: emptyInventory }],
      result: outcome,
      postCommitEvents: [],
    }
    const decode = <A>(schema: Schema.Codec<A, unknown>) => (value: unknown) =>
      Schema.decodeUnknownSync(schema)(value)

    const emptyBrewing = Schema.decodeUnknownSync(BrewingServiceStateSchema)({
      bottles: [undefined, undefined, undefined],
      ingredient: undefined,
      fuel: undefined,
      fuelCharges: 0,
      brewProgressSecs: 0,
    })
    const validBrewingSnapshot = { world, expectedRevision: revision, expectedDimensions: [], state: emptyBrewing }
    const inventorySnapshot = { ...validBrewingSnapshot, state: emptyInventory }
    expectRequiredFields(decode(BrewingServicePlanSnapshotSchema), validBrewingSnapshot, [
      'world', 'expectedRevision', 'expectedDimensions', 'state',
    ])
    expectRequiredFields(decode(PotionDrinkInventorySnapshotSchema), inventorySnapshot, [
      'world', 'expectedRevision', 'expectedDimensions', 'state',
    ])
    expectRequiredFields(decode(PotionEffectApplicationSchema), outcome.effect, ['type', 'durationSecs', 'amplifier'])
    expectRequiredFields(decode(PotionDrinkOutcomeSchema), outcome, ['_tag', 'item', 'effect'])
    expectRequiredFields(decode(PotionDrinkOutcomeSchema), { _tag: 'ConsumedWithoutEffect', item: 'water_bottle' }, [
      '_tag', 'item',
    ])
    expectRequiredFields(decode(PotionDrinkIntentSchema), drinkIntent, [
      'inventoryOwnerId', 'actor', 'slotIndex', 'tick',
    ])
    expectRequiredFields(decode(PotionDrinkFailureSchema), { _tag: 'PotionDrinkEmptySlot', slotIndex: 0 }, [
      '_tag', 'slotIndex',
    ])
    expectRequiredFields(decode(PotionDrinkFailureSchema), {
      _tag: 'PotionDrinkNotDrinkable', slotIndex: Schema.decodeUnknownSync(PotionDrinkSlotIndexSchema)(0), item: 'cod',
    }, ['_tag', 'slotIndex', 'item'])
    expectRequiredFields(decode(PotionDrinkPlanSchema), drinkPlan, [
      'world', 'expectedRevision', 'expectedDimensions', 'changes', 'result', 'postCommitEvents',
    ])

    for (const invalid of [undefined, null, -1, 3, 0.5]) {
      expect(() => Schema.decodeUnknownSync(BrewingBottleIndexSchema)(invalid)).toThrow()
    }
    expect(Schema.decodeUnknownSync(BrewingBottleIndexSchema)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(BrewingBottleIndexSchema)(2)).toBe(2)
    for (const invalid of [undefined, null, -1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => Schema.decodeUnknownSync(BrewingElapsedSecsSchema)(invalid)).toThrow()
    }
    expect(Schema.decodeUnknownSync(BrewingElapsedSecsSchema)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(BrewingElapsedSecsSchema)(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
    for (const invalid of [undefined, null, -1, Number.MAX_SAFE_INTEGER + 1, 0.5]) {
      expect(() => Schema.decodeUnknownSync(PotionEffectAmplifierSchema)(invalid)).toThrow()
    }
    expect(Schema.decodeUnknownSync(PotionEffectAmplifierSchema)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(PotionEffectAmplifierSchema)(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
    for (const invalid of [undefined, null, -1, Inventory.INVENTORY_SLOT_COUNT, 0.5]) {
      expect(() => Schema.decodeUnknownSync(PotionDrinkSlotIndexSchema)(invalid)).toThrow()
    }
    expect(Schema.decodeUnknownSync(PotionDrinkSlotIndexSchema)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(PotionDrinkSlotIndexSchema)(Inventory.INVENTORY_SLOT_COUNT - 1))
      .toBe(Inventory.INVENTORY_SLOT_COUNT - 1)
  })

  it('accepts generated potion slots through the inventory boundary', () => {
    const base = {
      inventoryOwnerId: potionOwnerId,
      actor: potionActor,
      tick: potionTick,
    }
    fc.assert(fc.property(fc.integer({ min: 0, max: Inventory.INVENTORY_SLOT_COUNT - 1 }), (slotIndex) =>
      Result.isSuccess(Schema.decodeUnknownResult(PotionDrinkIntentSchema)({ ...base, slotIndex })),
    ))
    for (const slotIndex of [-1, Inventory.INVENTORY_SLOT_COUNT, 0.5]) {
      expect(Result.isFailure(Schema.decodeUnknownResult(PotionDrinkIntentSchema)({ ...base, slotIndex }))).toBe(true)
    }
  })
})
