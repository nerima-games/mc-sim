import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeInventoryService } from '../application/inventory-service'
import type { ContainerStoredStack } from '../domain/container-storage'
import { emptyInventory, itemStack } from '../domain/inventory'
import {
  addStoredStack,
  emptyPlayerStorage,
  FLINT_AND_STEEL_MAX_DURABILITY,
  storageFromInventory,
} from '../domain/player-storage'

const bytes = (value: unknown): string => JSON.stringify(value)

describe('player storage', () => {
  it('adds a damaged tool with its exact durability and copies the input', () => {
    const durability = { current: 17, max: FLINT_AND_STEEL_MAX_DURABILITY }
    const outcome = addStoredStack(emptyPlayerStorage(), {
      ...itemStack('flint_and_steel', 1),
      durability,
    })

    expect(outcome.result).toStrictEqual({ _tag: 'Added', added: 1, leftover: null })
    expect(outcome.storage.inventory.slots[0]).toStrictEqual({ item: 'flint_and_steel', count: 1 })
    expect(outcome.storage.inventoryDurability[0]).toStrictEqual({
      current: 17,
      max: FLINT_AND_STEEL_MAX_DURABILITY,
    })
    durability.current = 1
    expect(outcome.storage.inventoryDurability[0]).toStrictEqual({
      current: 17,
      max: FLINT_AND_STEEL_MAX_DURABILITY,
    })
  })

  it('reports full, partial, and zero-capacity non-durable additions as Added', () => {
    const full = addStoredStack(emptyPlayerStorage(), {
      ...itemStack('stone', 10),
      durability: null,
    })
    expect(full.result).toStrictEqual({ _tag: 'Added', added: 10, leftover: null })

    const nearlyFull = storageFromInventory({
      slots: [
        itemStack('stone', 60),
        ...Array.from({ length: 35 }, () => itemStack('dirt', 64)),
      ],
    })
    const partial = addStoredStack(nearlyFull, { ...itemStack('stone', 10), durability: null })
    expect(partial.result).toStrictEqual({
      _tag: 'Added',
      added: 4,
      leftover: { item: 'stone', count: 6, durability: null },
    })
    expect(partial.storage.inventory.slots[0]).toStrictEqual({ item: 'stone', count: 64 })

    const noCapacity = storageFromInventory({
      slots: Array.from({ length: 36 }, () => itemStack('dirt', 64)),
    })
    const inventoryFull = addStoredStack(noCapacity, {
      ...itemStack('stone', 10),
      durability: null,
    })
    expect(inventoryFull.result).toStrictEqual({
      _tag: 'Added',
      added: 0,
      leftover: { item: 'stone', count: 10, durability: null },
    })
    expect(inventoryFull.storage).toBe(noCapacity)
  })

  it('rejects malformed stored stacks atomically', () => {
    const storage = emptyPlayerStorage()
    const durability = { current: 17, max: FLINT_AND_STEEL_MAX_DURABILITY }
    const malformed: ReadonlyArray<unknown> = [
      { item: 'stone', count: 1, durability: null, extra: true },
      { item: 'not_an_item', count: 1, durability: null },
      { item: 'stone', count: 0, durability: null },
      { item: 'stone', count: 65, durability: null },
      { item: 'flint_and_steel', count: 2, durability },
      { item: 'stone', count: 1, durability },
      { item: 'flint_and_steel', count: 1, durability: null },
      { item: 'flint_and_steel', count: 1, durability: { current: 17, max: 65 } },
      { item: 'flint_and_steel', count: 1, durability: { ...durability, extra: true } },
    ]

    for (const stack of malformed) {
      const outcome = addStoredStack(storage, stack as ContainerStoredStack)
      expect(outcome.result).toStrictEqual({ _tag: 'InvalidStack' })
      expect(outcome.storage).toBe(storage)
    }
  })

  it.effect('exposes exact stored-stack insertion through InventoryService', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      expect(yield* service.addStoredStack({
        ...itemStack('flint_and_steel', 1),
        durability: { current: 17, max: FLINT_AND_STEEL_MAX_DURABILITY },
      })).toStrictEqual({ _tag: 'Added', added: 1, leftover: null })
      expect((yield* service.storageSnapshot).inventoryDurability[0]).toStrictEqual({
        current: 17,
        max: FLINT_AND_STEEL_MAX_DURABILITY,
      })
    }),
  )

  it.effect('stores durable tools as individual inventory slots', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      expect(yield* service.add('flint_and_steel', 2)).toBe(0)
      expect(yield* service.add('iron_helmet', 2)).toBe(0)

      const snapshot = yield* service.storageSnapshot
      expect(snapshot.inventory.slots.slice(0, 4)).toStrictEqual([
        { item: 'flint_and_steel', count: 1 },
        { item: 'flint_and_steel', count: 1 },
        { item: 'iron_helmet', count: 1 },
        { item: 'iron_helmet', count: 1 },
      ])
      expect(snapshot.inventoryDurability.slice(0, 4)).toStrictEqual([
        { current: FLINT_AND_STEEL_MAX_DURABILITY, max: FLINT_AND_STEEL_MAX_DURABILITY },
        { current: FLINT_AND_STEEL_MAX_DURABILITY, max: FLINT_AND_STEEL_MAX_DURABILITY },
        { current: 165, max: 165 },
        { current: 165, max: 165 },
      ])
    }),
  )

  it.effect('moves one item between inventory and offhand without duplication', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('flint_and_steel', 1)
      expect(yield* service.equipFromInventory(0, 'offhand')).toMatchObject({ _tag: 'Equipped' })

      const equipped = yield* service.storageSnapshot
      expect(equipped.inventory.slots[0]).toBeUndefined()
      expect(equipped.equipment.slots.offhand).toMatchObject({
        item: 'flint_and_steel', count: 1, durability: { current: 64, max: 64 },
      })

      expect(yield* service.unequipToInventory('offhand', 4)).toMatchObject({
        _tag: 'Unequipped', slotIndex: 4,
      })
      const unequipped = yield* service.storageSnapshot
      expect(unequipped.equipment.slots.offhand).toBeNull()
      expect(unequipped.inventory.slots[4]).toStrictEqual({ item: 'flint_and_steel', count: 1 })
      expect(unequipped.inventoryDurability[4]).toStrictEqual({ current: 64, max: 64 })
    }),
  )

  it.effect('equips matching armour with default durability and preserves damage when unequipped', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('iron_helmet', 1)

      expect(yield* service.equipFromInventory(0, 'head')).toMatchObject({ _tag: 'Equipped' })
      expect((yield* service.storageSnapshot).equipment.slots.head).toStrictEqual({
        item: 'iron_helmet',
        count: 1,
        durability: { current: 165, max: 165 },
      })

      yield* service.damageAt({ _tag: 'Equipment', slot: 'head' }, 15)
      expect(yield* service.unequipToInventory('head', 4)).toMatchObject({
        _tag: 'Unequipped', slotIndex: 4,
      })
      const unequipped = yield* service.storageSnapshot
      expect(unequipped.inventory.slots[4]).toStrictEqual({ item: 'iron_helmet', count: 1 })
      expect(unequipped.inventoryDurability[4]).toStrictEqual({ current: 150, max: 165 })
    }),
  )

  it.effect('leaves the complete storage byte-identical on transition failures', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('iron_helmet', 1)
      yield* service.add('stone', 1)
      const before = bytes(yield* service.storageSnapshot)

      expect(yield* service.equipFromInventory(0, 'chest')).toMatchObject({ _tag: 'Incompatible' })
      expect(yield* service.damageAt({ _tag: 'Inventory', slotIndex: 1 }, 1)).toMatchObject({
        _tag: 'NotDamageable',
      })
      expect(yield* service.click({
        _tag: 'LeftClick', slotIndex: 2,
        carried: {
          ...itemStack('iron_boots', 1),
          durability: { current: 1, max: 64 },
        },
      })).toMatchObject({ _tag: 'InvalidCount' })
      expect(bytes(yield* service.storageSnapshot)).toBe(before)
    }),
  )

  it.effect('damages inventory and equipment locations and removes a broken tool', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('flint_and_steel', 1)
      expect(yield* service.damageAt({ _tag: 'Inventory', slotIndex: 0 }, 63)).toMatchObject({
        _tag: 'Damaged', item: { durability: { current: 1, max: 64 } },
      })
      yield* service.equipFromInventory(0, 'offhand')
      expect(yield* service.damageAt({ _tag: 'Equipment', slot: 'offhand' }, 1)).toMatchObject({
        _tag: 'Broken', applied: 1,
      })
      expect((yield* service.equipmentSnapshot).slots.offhand).toBeNull()
    }),
  )

  it.effect('consumes ammunition and damages the expected bow atomically', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('bow', 1)
      yield* service.add('arrow', 2)

      expect(yield* service.consumeAndDamageAt({
        consume: { item: 'arrow', count: 1 },
        damage: {
          location: { _tag: 'Inventory', slotIndex: 0 },
          expectedItem: 'bow',
          amount: 1,
        },
      })).toMatchObject({
        _tag: 'Applied',
        consumed: 1,
        damage: {
          _tag: 'Damaged',
          item: { item: 'bow', durability: { current: 383, max: 384 } },
        },
      })

      const after = yield* service.storageSnapshot
      expect(after.inventory.slots[0]).toStrictEqual({ item: 'bow', count: 1 })
      expect(after.inventoryDurability[0]).toStrictEqual({ current: 383, max: 384 })
      expect(after.inventory.slots[1]).toStrictEqual({ item: 'arrow', count: 1 })
    }),
  )

  it.effect('does not damage the bow when ammunition is insufficient', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('bow', 1)
      yield* service.add('arrow', 1)
      const before = yield* service.storageSnapshot

      expect(yield* service.consumeAndDamageAt({
        consume: { item: 'arrow', count: 2 },
        damage: {
          location: { _tag: 'Inventory', slotIndex: 0 },
          expectedItem: 'bow',
          amount: 1,
        },
      })).toStrictEqual({ _tag: 'InsufficientConsumable', available: 1 })
      expect(yield* service.storageSnapshot).toStrictEqual(before)
    }),
  )

  it.effect('does not consume ammunition after the captured bow slot is replaced', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('stone', 1)
      yield* service.add('arrow', 1)
      const before = yield* service.storageSnapshot

      expect(yield* service.consumeAndDamageAt({
        consume: { item: 'arrow', count: 1 },
        damage: {
          location: { _tag: 'Inventory', slotIndex: 0 },
          expectedItem: 'bow',
          amount: 1,
        },
      })).toStrictEqual({ _tag: 'DamageTargetMismatch', actualItem: 'stone' })
      expect(yield* service.storageSnapshot).toStrictEqual(before)
    }),
  )

  it.effect('consumes ammunition and removes a bow exactly at its durability limit', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('bow', 1)
      yield* service.add('arrow', 1)
      yield* service.damageAt({ _tag: 'Inventory', slotIndex: 0 }, 383)

      expect(yield* service.consumeAndDamageAt({
        consume: { item: 'arrow', count: 1 },
        damage: {
          location: { _tag: 'Inventory', slotIndex: 0 },
          expectedItem: 'bow',
          amount: 1,
        },
      })).toMatchObject({
        _tag: 'Applied',
        consumed: 1,
        damage: { _tag: 'Broken', applied: 1, item: { item: 'bow' } },
      })
      const after = yield* service.storageSnapshot
      expect(after.inventory.slots[0]).toBeUndefined()
      expect(after.inventory.slots[1]).toBeUndefined()
    }),
  )

  it.effect('settles only one of two concurrent shots competing for the last arrow', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('bow', 1)
      yield* service.add('arrow', 1)
      const shot = service.consumeAndDamageAt({
        consume: { item: 'arrow', count: 1 },
        damage: {
          location: { _tag: 'Inventory', slotIndex: 0 },
          expectedItem: 'bow',
          amount: 1,
        },
      })

      const results = yield* Effect.all([shot, shot], { concurrency: 'unbounded' })
      expect(results.map((result) => result._tag).sort()).toStrictEqual([
        'Applied', 'InsufficientConsumable',
      ])
      const after = yield* service.storageSnapshot
      expect(after.inventoryDurability[0]).toStrictEqual({ current: 383, max: 384 })
      expect(after.inventory.slots[1]).toBeUndefined()
    }),
  )

  it.effect('keeps bows out of equipment slots', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('bow', 1)

      expect(yield* service.equipFromInventory(0, 'offhand')).toMatchObject({
        _tag: 'Incompatible', item: { item: 'bow' },
      })
      expect((yield* service.storageSnapshot).inventoryDurability[0]).toStrictEqual({
        current: 384, max: 384,
      })
    }),
  )

  it.effect('initializes and damages wooden and stone pickaxes in inventory', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('wooden_pickaxe', 1)
      yield* service.add('stone_pickaxe', 1)

      expect(yield* service.damageAt({ _tag: 'Inventory', slotIndex: 0 }, 1)).toMatchObject({
        _tag: 'Damaged', item: { item: 'wooden_pickaxe', durability: { current: 58, max: 59 } },
      })
      expect(yield* service.damageAt({ _tag: 'Inventory', slotIndex: 1 }, 1)).toMatchObject({
        _tag: 'Damaged', item: { item: 'stone_pickaxe', durability: { current: 130, max: 131 } },
      })
    }),
  )

  it.effect('strict restore rejects malformed durability without changing state', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService(emptyInventory())
      yield* service.add('flint_and_steel', 1)
      const snapshot = yield* service.storageSnapshot
      const before = bytes(snapshot)
      const malformed = {
        ...snapshot,
        inventoryDurability: [{ current: 65, max: 64 }, ...snapshot.inventoryDurability.slice(1)],
      }

      const result = yield* Effect.either(service.restoreStorage(malformed))
      expect(result._tag).toBe('Left')
      expect(bytes(yield* service.storageSnapshot)).toBe(before)
    }),
  )

  it.effect('carries armour durability through inventory clicks', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('iron_boots', 1)
      yield* service.damageAt({ _tag: 'Inventory', slotIndex: 0 }, 7)
      const picked = yield* service.click({ _tag: 'LeftClick', slotIndex: 0, carried: undefined })
      expect(picked).toMatchObject({ _tag: 'PickedUp', carried: { durability: { current: 188, max: 195 } } })
      if (picked._tag !== 'PickedUp') return
      yield* service.click({ _tag: 'LeftClick', slotIndex: 3, carried: picked.carried })
      const after = yield* service.storageSnapshot
      expect(after.inventory.slots[3]).toStrictEqual({ item: 'iron_boots', count: 1 })
      expect(after.inventoryDurability[3]).toStrictEqual({ current: 188, max: 195 })
      expect((yield* Effect.either(service.restoreStorage(after)))._tag).toBe('Right')
    }),
  )

  it.effect('copies carried durability before storing it', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const durability = { current: 188, max: 195 }
      yield* service.click({
        _tag: 'LeftClick', slotIndex: 0,
        carried: { ...itemStack('iron_boots', 1), durability },
      })

      durability.current = 1
      expect((yield* service.storageSnapshot).inventoryDurability[0]).toStrictEqual({
        current: 188, max: 195,
      })
    }),
  )

  it.effect('legacy inventory restore preserves equipment and unchanged durability', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('iron_boots', 1)
      yield* service.damageAt({ _tag: 'Inventory', slotIndex: 0 }, 7)
      yield* service.add('iron_helmet', 1)
      yield* service.equipFromInventory(1, 'head')

      const before = yield* service.storageSnapshot
      const slots = [...before.inventory.slots]
      slots[1] = itemStack('iron_chestplate', 1)
      expect(yield* service.restore({ slots })).toBe(0)

      const after = yield* service.storageSnapshot
      expect(after.equipment.slots.head).toStrictEqual({
        item: 'iron_helmet', count: 1, durability: { current: 165, max: 165 },
      })
      expect(after.inventoryDurability[0]).toStrictEqual({ current: 188, max: 195 })
      expect(after.inventoryDurability[1]).toStrictEqual({ current: 240, max: 240 })
    }),
  )
})
