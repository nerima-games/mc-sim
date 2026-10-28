import { describe, expect, it } from '@effect/vitest'
import { enchantmentsComponent } from '@nerima-games/mc-kernel/domain/item-enchantments'
import { Effect, Layer, Result, Schema } from 'effect'
import { WorldIdSchema } from '@nerima-games/mc-kernel'
import { EnchantmentTableService, EnchantmentTableServiceLayer } from '../src/application/enchantment-table-service.js'
import {
  PlayerStorageSnapshotSchema,
  playerStorageOwnerRegistration,
} from '../src/application/container-service.js'
import {
  makeReplicatedOwnerId,
  ReplicatedOwnerIdSchema,
} from '../src/application/replicated-state.js'
import {
  WorldCommitCoordinator,
  WorldCommitCoordinatorLayer,
} from '../src/application/world-commit-coordinator.js'
import {
  EnchantmentTableApplyRequestSchema,
  EnchantmentTableApplyStateSchema,
  EnchantmentTableInventorySlotSchema,
  EnchantmentTableOfferSchema,
} from '../src/application/enchantment-table-service.js'
import * as Inventory from '../src/domain/inventory.js'
import * as PlayerStorage from '../src/domain/player-storage.js'
import * as Vitals from '../src/domain/vitals.js'

const world = Schema.decodeUnknownSync(WorldIdSchema)('enchantment-table-apply-test')
const playerOwnerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('enchantment-player')
const vitalsOwnerId = makeReplicatedOwnerId('enchantment-vitals')

const makeVitalsAt = (level: number, progress: number): Vitals.Vitals => {
  const experienceLevel = Vitals.ExperienceLevel(level)
  const totalExperience = Number(Vitals.totalExperienceAtLevel(experienceLevel)) +
    Number(Vitals.experienceCostOfLevel(experienceLevel)) * progress
  return { ...Vitals.SPAWN_VITALS, totalExperience: Vitals.TotalExperience(totalExperience) }
}

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const mustStack = (
  item: Inventory.ItemStack['item'],
  count: number,
  options?: Parameters<typeof Inventory.itemStack>[2],
): Inventory.ItemStack => {
  const result = Inventory.itemStack(item, count, options)
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const storageWith = (item: Inventory.ItemStack, lapisCount = 5): PlayerStorage.PlayerStorage => {
  const slots: Array<Inventory.ItemStack | undefined> = Array.from({ length: Inventory.INVENTORY_SLOT_COUNT }, () => undefined)
  slots[0] = item
  const lapis = Inventory.itemStack('lapis_lazuli', lapisCount)
  if (Result.isFailure(lapis)) throw lapis.failure
  slots[1] = lapis.success
  return PlayerStorage.storageFromInventory({ slots })
}

const storageWithItemOnly = (item: Inventory.ItemStack): PlayerStorage.PlayerStorage => {
  const slots: Array<Inventory.ItemStack | undefined> = Array.from({ length: Inventory.INVENTORY_SLOT_COUNT }, () => undefined)
  slots[0] = item
  return PlayerStorage.storageFromInventory({ slots })
}

const fullBookStorage = (): PlayerStorage.PlayerStorage => {
  const slots = Array.from({ length: Inventory.INVENTORY_SLOT_COUNT }, () => mustStack('stone', 64))
  slots[0] = mustStack('book', 64)
  slots[1] = mustStack('lapis_lazuli', 5)
  return PlayerStorage.storageFromInventory({ slots })
}

const makeServiceLayer = (storage: PlayerStorage.PlayerStorage, vitals: Vitals.Vitals) =>
  Layer.provideMerge(WorldCommitCoordinatorLayer({
    world,
    dimensions: [],
    owners: [
      playerStorageOwnerRegistration(playerOwnerId, storage),
      { ownerId: vitalsOwnerId, schema: Vitals.VitalsSchema, initialState: vitals },
    ],
  }))(EnchantmentTableServiceLayer)

// Java fixture: the first table row requires the offer's level cost and consumes one level and one lapis.
// https://minecraft.wiki/w/Enchanting_table
// https://minecraft.wiki/w/Lapis_lazuli
const request = (levelCost = 30) => Schema.decodeUnknownSync(EnchantmentTableApplyRequestSchema)({
  playerStorageOwnerId: playerOwnerId,
  vitalsOwnerId,
  itemSlot: 0,
  lapisSlot: 1,
  tableSlot: 0,
  offer: {
    levelCost,
    lapisCost: 1,
    enchantments: [{ id: 'sharpness', level: 3 }],
  },
})

describe('EnchantmentTableService plan-first apply', () => {
  it.effect('plans both owner updates from the supplied common snapshot', () =>
    Effect.gen(function* () {
      const service = yield* EnchantmentTableService
      const coordinator = yield* WorldCommitCoordinator
      const player = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
      const vitals = yield* coordinator.snapshot(vitalsOwnerId, Vitals.VitalsSchema)
      const fragment = yield* service.planApply({
        world: player.world,
        expectedRevision: player.revision,
        expectedDimensions: [],
        state: { playerStorage: player.state, vitals: vitals.state },
      }, request())

      expect(fragment.changes.map(({ ownerId }) => ownerId)).toEqual([playerOwnerId, vitalsOwnerId])
      expect(fragment.result.item.item).toBe('iron_sword')
      expect(fragment.result.item.components.enchantments?.['minecraft:sharpness']).toBe(3)
      const nextStorage = Schema.decodeUnknownSync(PlayerStorageSnapshotSchema)(fragment.changes[0]?.state)
      expect(nextStorage.inventory.slots[0]?.components.enchantments?.['minecraft:sharpness']).toBe(3)
      expect(nextStorage.inventory.slots[1]?.count).toBe(4)
      const nextVitals = Schema.decodeUnknownSync(Vitals.VitalsSchema)(fragment.changes[1]?.state)
      expect(Number(Vitals.experienceLevel(nextVitals))).toBe(29)
      expect(Number(Vitals.experienceProgress(nextVitals))).toBeCloseTo(0.5)
      expect(fragment.postCommitEvents).toEqual([])
    }).pipe(Effect.provide(makeServiceLayer(storageWith(mustStack('iron_sword', 1)), makeVitalsAt(30, 0.5))))
  )

  it.effect('rejects invalid offers, sources, storage, and insufficient lapis', () =>
    Effect.gen(function* () {
      const service = yield* EnchantmentTableService
      const coordinator = yield* WorldCommitCoordinator
      const player = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
      const vitals = yield* coordinator.snapshot(vitalsOwnerId, Vitals.VitalsSchema)
      const snapshot = {
        world: player.world,
        expectedRevision: player.revision,
        expectedDimensions: [],
        state: { playerStorage: player.state, vitals: vitals.state },
      }
      const valid = request()
      const invalidOffers: ReadonlyArray<typeof valid.offer> = [
        { ...valid.offer, enchantments: [] },
        { ...valid.offer, enchantments: [{ id: 'sharpness', level: 6 }] },
        { ...valid.offer, enchantments: [{ id: 'sharpness', level: 3 }, { id: 'sharpness', level: 3 }] },
        { ...valid.offer, enchantments: [{ id: 'sharpness', level: 3 }, { id: 'smite', level: 3 }] },
      ]
      for (const offer of invalidOffers) {
        const result = yield* Effect.result(service.planApply(snapshot, { ...valid, offer }))
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) expect(result.failure).toMatchObject({ reason: 'invalid-offer' })
      }

      const sameOwner = yield* Effect.result(service.planApply(snapshot, {
        ...valid,
        vitalsOwnerId: playerOwnerId,
      }))
      const sameSlot = yield* Effect.result(service.planApply(snapshot, {
        ...valid,
        itemSlot: valid.lapisSlot,
      }))
      const badLapisCost = yield* Effect.result(service.planApply(snapshot, {
        ...valid,
        offer: { ...valid.offer, lapisCost: 2 },
      }))
      expect(Result.isFailure(sameOwner)).toBe(true)
      if (Result.isFailure(sameOwner)) expect(sameOwner.failure._tag).toBe('WorldCommitPlanOwnerConflict')
      expect(Result.isFailure(sameSlot)).toBe(true)
      if (Result.isFailure(sameSlot)) expect(sameSlot.failure).toMatchObject({ reason: 'invalid-storage' })
      expect(Result.isFailure(badLapisCost)).toBe(true)
      if (Result.isFailure(badLapisCost)) expect(badLapisCost.failure).toMatchObject({ reason: 'invalid-offer' })

      const emptySource = yield* Effect.result(service.planApply({
        ...snapshot,
        state: { ...snapshot.state, playerStorage: PlayerStorage.emptyPlayerStorage() },
      }, valid))
      const unenchantedBread = yield* Effect.result(service.planApply({
        ...snapshot,
        state: { ...snapshot.state, playerStorage: storageWith(mustStack('bread', 1)) },
      }, valid))
      const enchantments = must(enchantmentsComponent({ 'minecraft:sharpness': 1 }))
      const sword = mustStack('iron_sword', 1)
      const alreadyEnchanted = yield* Effect.result(service.planApply({
        ...snapshot,
        state: {
          ...snapshot.state,
          playerStorage: storageWith(mustStack('iron_sword', 1, {
            components: { ...sword.components, enchantments },
          })),
        },
      }, valid))
      const incompatibleOffer = yield* Effect.result(service.planApply(snapshot, {
        ...valid,
        offer: { ...valid.offer, enchantments: [{ id: 'silk_touch', level: 1 }] },
      }))
      const noLapis = yield* Effect.result(service.planApply({
        ...snapshot,
        state: { ...snapshot.state, playerStorage: storageWithItemOnly(mustStack('iron_sword', 1)) },
      }, valid))
      for (const [result, reason] of [
        [emptySource, 'empty-item-slot'],
        [unenchantedBread, 'not-enchantable'],
        [alreadyEnchanted, 'already-enchanted'],
        [incompatibleOffer, 'invalid-offer'],
        [noLapis, 'insufficient-lapis'],
      ] as const) {
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) expect(result.failure).toMatchObject({ reason })
      }
    }).pipe(Effect.provide(makeServiceLayer(storageWith(mustStack('iron_sword', 1)), makeVitalsAt(30, 0.5))))
  )

  it.effect('preserves book outputs and reports a full inventory without a partial candidate', () =>
    Effect.gen(function* () {
      const service = yield* EnchantmentTableService
      const coordinator = yield* WorldCommitCoordinator
      const player = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
      const vitals = yield* coordinator.snapshot(vitalsOwnerId, Vitals.VitalsSchema)
      const snapshot = {
        world: player.world,
        expectedRevision: player.revision,
        expectedDimensions: [],
        state: { playerStorage: player.state, vitals: vitals.state },
      }
      const bookPlan = yield* service.planApply({
        ...snapshot,
        state: { ...snapshot.state, playerStorage: storageWith(mustStack('book', 1)) },
      }, request())
      expect(bookPlan.result.item.item).toBe('enchanted_book')
      expect(bookPlan.result.item.components.storedEnchantments?.['minecraft:sharpness']).toBe(3)

      const fullInventory = yield* Effect.result(service.planApply({
        ...snapshot,
        state: { ...snapshot.state, playerStorage: fullBookStorage() },
      }, request()))
      expect(Result.isFailure(fullInventory)).toBe(true)
      if (Result.isFailure(fullInventory)) expect(fullInventory.failure).toMatchObject({ reason: 'invalid-storage' })
    }).pipe(Effect.provide(makeServiceLayer(storageWith(mustStack('book', 1)), makeVitalsAt(30, 0.5))))
  )

  it.effect('commits the item, lapis, and experience candidates together', () =>
    Effect.gen(function* () {
      const service = yield* EnchantmentTableService
      const coordinator = yield* WorldCommitCoordinator
      const applied = yield* service.apply(request())
      const player = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
      const vitals = yield* coordinator.snapshot(vitalsOwnerId, Vitals.VitalsSchema)

      expect(applied.result.item.components.enchantments?.['minecraft:sharpness']).toBe(3)
      expect(applied.delta.changes).toHaveLength(2)
      expect(player.state.inventory.slots[0]?.components.enchantments?.['minecraft:sharpness']).toBe(3)
      expect(player.state.inventory.slots[1]?.count).toBe(4)
      expect(Number(Vitals.experienceLevel(vitals.state))).toBe(29)
    }).pipe(Effect.provide(makeServiceLayer(storageWith(mustStack('iron_sword', 1)), makeVitalsAt(30, 0))))
  )

  it.effect('leaves both owners and the world revision unchanged when requirements fail', () =>
    Effect.gen(function* () {
      const service = yield* EnchantmentTableService
      const coordinator = yield* WorldCommitCoordinator
      const beforePlayer = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
      const beforeVitals = yield* coordinator.snapshot(vitalsOwnerId, Vitals.VitalsSchema)
      const beforeRevision = yield* coordinator.revision
      const result = yield* Effect.result(service.apply(request()))
      const afterPlayer = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
      const afterVitals = yield* coordinator.snapshot(vitalsOwnerId, Vitals.VitalsSchema)

      expect(Result.isFailure(result)).toBe(true)
      expect(afterPlayer).toEqual(beforePlayer)
      expect(afterVitals).toEqual(beforeVitals)
      expect(yield* coordinator.revision).toBe(beforeRevision)
    }).pipe(Effect.provide(makeServiceLayer(storageWith(mustStack('iron_sword', 1)), makeVitalsAt(29, 0))))
  )

  it('requires every offer, request, snapshot, and slot schema field', () => {
    const offer = { levelCost: 30, lapisCost: 1, enchantments: [{ id: 'sharpness', level: 3 }] }
    const applyRequest = {
      playerStorageOwnerId: playerOwnerId,
      vitalsOwnerId,
      itemSlot: 0,
      lapisSlot: 1,
      tableSlot: 0,
      offer,
    }
    const state = { playerStorage: storageWith(mustStack('iron_sword', 1)), vitals: makeVitalsAt(30, 0) }
    for (const [schema, value] of [
      [EnchantmentTableOfferSchema, offer],
      [EnchantmentTableApplyRequestSchema, applyRequest],
      [EnchantmentTableApplyStateSchema, state],
    ] as const) {
      for (const field of Object.keys(value)) {
        const omitted = Object.fromEntries(Object.entries(value).filter(([key]) => key !== field))
        expect(Schema.decodeUnknownResult(schema)(omitted)._tag, `${field} omission`).toBe('Failure')
        expect(Schema.decodeUnknownResult(schema)({ ...value, [field]: null })._tag, `${field} null`).toBe('Failure')
      }
    }
    expect(Schema.decodeUnknownResult(EnchantmentTableInventorySlotSchema)(-1)._tag).toBe('Failure')
    expect(Schema.decodeUnknownResult(EnchantmentTableInventorySlotSchema)(Inventory.INVENTORY_SLOT_COUNT)._tag).toBe('Failure')
  })
})
