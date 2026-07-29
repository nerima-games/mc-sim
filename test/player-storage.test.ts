import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeInventoryService } from '../application/inventory-service'
import { emptyInventory, itemStack } from '../domain/inventory'
import { FLINT_AND_STEEL_MAX_DURABILITY } from '../domain/player-storage'

const bytes = (value: unknown): string => JSON.stringify(value)

describe('player storage', () => {
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
