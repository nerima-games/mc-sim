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

      const snapshot = yield* service.storageSnapshot
      expect(snapshot.inventory.slots.slice(0, 2)).toStrictEqual([
        { item: 'flint_and_steel', count: 1 },
        { item: 'flint_and_steel', count: 1 },
      ])
      expect(snapshot.inventoryDurability.slice(0, 2)).toStrictEqual([
        { current: FLINT_AND_STEEL_MAX_DURABILITY, max: FLINT_AND_STEEL_MAX_DURABILITY },
        { current: FLINT_AND_STEEL_MAX_DURABILITY, max: FLINT_AND_STEEL_MAX_DURABILITY },
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

  it.effect('leaves the complete storage byte-identical on transition failures', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('stone', 1)
      const before = bytes(yield* service.storageSnapshot)

      expect(yield* service.equipFromInventory(0, 'head')).toMatchObject({ _tag: 'Incompatible' })
      expect(yield* service.damageAt({ _tag: 'Inventory', slotIndex: 0 }, 1)).toMatchObject({
        _tag: 'NotDamageable',
      })
      expect(yield* service.click({
        _tag: 'LeftClick',
        slotIndex: 1,
        carried: {
          ...itemStack('flint_and_steel', 1),
          durability: { current: 1, max: 3 },
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

  it.effect('carries durability through inventory clicks', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('flint_and_steel', 1)
      yield* service.damageAt({ _tag: 'Inventory', slotIndex: 0 }, 7)
      const picked = yield* service.click({ _tag: 'LeftClick', slotIndex: 0, carried: undefined })
      expect(picked).toMatchObject({ _tag: 'PickedUp', carried: { durability: { current: 57, max: 64 } } })
      if (picked._tag !== 'PickedUp') return
      yield* service.click({ _tag: 'LeftClick', slotIndex: 3, carried: picked.carried })
      expect((yield* service.storageSnapshot).inventoryDurability[3]).toStrictEqual({ current: 57, max: 64 })
    }),
  )
})
