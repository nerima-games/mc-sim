import { describe, expect, it } from '@effect/vitest'
import { vi } from 'vitest'
import { Effect, Result } from 'effect'
import { makeInventoryService } from '../src/application/inventory-service'
import type { ContainerStoredStack } from '../src/domain/container-storage'
import * as Eq from '../src/domain/equipment'
import { emptyInventory, itemStack as itemStackResult, type ItemStack } from '../src/domain/inventory'
import {
  addStoredStack,
  consumeAndDamageAt,
  damageAt,
  emptyPlayerStorage,
  equipFromInventory,
  FLINT_AND_STEEL_MAX_DURABILITY,
  storageFromInventory,
  unequipToInventory,
  validatePlayerStorageSnapshot,
  withInventory,
} from '../src/domain/player-storage'
import type { PlayerStorage, StorageLocation } from '../src/domain/player-storage'

const itemStack = (...args: Parameters<typeof itemStackResult>): ItemStack => {
  const result = itemStackResult(...args)
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const equipmentItem = (...args: Parameters<typeof Eq.equipmentItem>): Eq.EquipmentItem => {
  const result = Eq.equipmentItem(...args)
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const bytes = (value: unknown): string => JSON.stringify(value)

describe('player storage', () => {
  it('keeps the transition total when a location changes between boundary checks', () => {
    const storage = storageFromInventory({
      slots: [itemStack('bow', 1), itemStack('stone', 1), ...Array.from({ length: 34 }, () => undefined)],
    })
    let reads = 0
    const location = {
      get _tag(): 'Inventory' | 'Bogus' {
        reads += 1
        return reads >= 4 ? 'Bogus' : 'Inventory'
      },
      slotIndex: 0,
    } as unknown as StorageLocation
    const outcome = consumeAndDamageAt(storage, {
      consume: { item: 'stone', count: 1 },
      damage: { location, expectedItem: 'bow', amount: 1 },
    })
    expect(outcome.result).toStrictEqual({
      _tag: 'DamageRejected',
      damage: { _tag: 'InvalidLocation' },
    })
    expect(outcome.storage).toBe(storage)
  })

  it('rejects a malformed inventory slot at the persistence boundary', () => {
    const result = validatePlayerStorageSnapshot({
      inventory: { slots: [{}, ...Array.from({ length: 35 }, () => undefined)] },
      inventoryDurability: Array.from({ length: 36 }, () => null),
      equipment: { slots: { head: null, chest: null, legs: null, feet: null, offhand: null } },
    })
    expect(result._tag).toBe('Invalid')
  })
  it('rejects legacy inventory stacks and invalid resolved components', () => {
    const base = emptyPlayerStorage()
    const legacy = {
      ...base,
      inventory: { slots: [{ item: 'stone', count: 2 }, ...Array.from({ length: 35 }, () => undefined)] },
    }
    expect(validatePlayerStorageSnapshot(legacy)).toMatchObject({
      _tag: 'Invalid', error: { path: 'storage.inventory.slots.0' },
    })
    expect(validatePlayerStorageSnapshot({
      ...legacy,
      inventory: { slots: [{ item: 'stone', count: 65 }, ...Array.from({ length: 35 }, () => undefined)] },
    })).toMatchObject({ _tag: 'Invalid', error: { path: 'storage.inventory.slots.0' } })
    expect(validatePlayerStorageSnapshot({
      ...base,
      inventory: { slots: [{ ...itemStack('stone', 1), components: {} }, ...Array.from({ length: 35 }, () => undefined)] },
    })).toMatchObject({ _tag: 'Invalid', error: { path: 'storage.inventory.slots.0' } })
  })

  it('returns storage and equipment constructor failures without repairing corrupt state', () => {
    const stack = { ...itemStack('stone', 1) }
    const storage = storageFromInventory({ slots: [stack, ...Array.from({ length: 35 }, () => undefined)] })
    const corrupt = {
      ...storage,
      inventoryDurability: [{ current: 1, max: 1 }, ...storage.inventoryDurability.slice(1)],
    }

    expect(withInventory(corrupt, corrupt.inventory)).toMatchObject({
      _tag: 'Failure', failure: { _tag: 'InvalidInventoryDurability', slotIndex: 0, item: 'stone' },
    })

    const invalidComponents = {
      ...itemStack('flint_and_steel', 1), components: {},
    } as unknown as ItemStack
    const invalidStorage = storageFromInventory({
      slots: [invalidComponents, ...Array.from({ length: 35 }, () => undefined)],
    })
    expect(equipFromInventory(invalidStorage, 0, 'offhand')).toMatchObject({
      result: { _tag: 'EquipmentFailure', error: { _tag: 'EquipmentValidationError' } },
    })
    expect(damageAt(invalidStorage, { _tag: 'Inventory', slotIndex: 0 }, 1)).toMatchObject({
      result: { _tag: 'EquipmentFailure', error: { _tag: 'EquipmentValidationError' } },
    })
  })

  it('keeps consumed items untouched when an unrelated stored durability is invalid', () => {
    const inventory = {
      slots: [itemStack('bow', 1), itemStack('arrow', 1), itemStack('stone', 1),
        ...Array.from({ length: 33 }, () => undefined)],
    }
    const storage = storageFromInventory(inventory)
    const corrupt = {
      ...storage,
      inventoryDurability: [
        ...storage.inventoryDurability.slice(0, 2),
        { current: 1, max: 1 },
        ...storage.inventoryDurability.slice(3),
      ],
    }

    expect(consumeAndDamageAt(corrupt, {
      consume: { item: 'arrow', count: 1 },
      damage: { location: { _tag: 'Inventory', slotIndex: 0 }, expectedItem: 'bow', amount: 1 },
    })).toMatchObject({
      storage: corrupt,
      result: { _tag: 'StorageFailure', error: { _tag: 'InvalidInventoryDurability', slotIndex: 2 } },
    })
    expect(corrupt.inventory.slots[1]).toStrictEqual(itemStack('arrow', 1))
  })

  it('returns the second equipment constructor failure instead of keeping stale durability', () => {
    const base = itemStack('bow', 1)
    let componentReads = 0
    const changingStack = {
      ...base,
      get components() {
        componentReads += 1
        return componentReads === 1 ? base.components : {}
      },
    } as unknown as ItemStack
    const storage = storageFromInventory({
      slots: [changingStack, ...Array.from({ length: 35 }, () => undefined)],
    })

    expect(damageAt(storage, { _tag: 'Inventory', slotIndex: 0 }, 1)).toMatchObject({
      storage,
      result: { _tag: 'EquipmentFailure', error: { _tag: 'EquipmentValidationError' } },
    })
    expect(storage.inventoryDurability[0]).toStrictEqual(Eq.durabilityForItem('bow'))
  })

  it('returns the first equipment constructor failure from damageAt without changing storage', () => {
    const storage = storageFromInventory({
      slots: [itemStack('bow', 1), ...Array.from({ length: 35 }, () => undefined)],
    })
    const stack = storage.inventory.slots[0]
    const durability = storage.inventoryDurability[0]
    if (stack === undefined || durability === null) throw new Error('damageable stack is missing its durability')
    expect(Eq.isValidDurabilityForItem(stack.item, durability)).toBe(true)

    const failure = Eq.equipmentItem(itemStack('stone', 1), null)
    if (Result.isSuccess(failure)) throw new Error('non-damageable equipment unexpectedly passed')

    const equipmentItemSpy = vi.spyOn(Eq, 'equipmentItem').mockReturnValue(failure)
    try {
      const outcome = damageAt(storage, { _tag: 'Inventory', slotIndex: 0 }, 1)
      expect(outcome.result).toStrictEqual({ _tag: 'EquipmentFailure', error: failure.failure })
      expect(outcome.storage).toBe(storage)
      expect(equipmentItemSpy).toHaveBeenCalledTimes(1)
    } finally {
      equipmentItemSpy.mockRestore()
    }
  })

  it('adds a damaged tool with its exact durability and copies the input', () => {
    const durability = { current: 17, max: FLINT_AND_STEEL_MAX_DURABILITY }
    const outcome = addStoredStack(emptyPlayerStorage(), {
      ...itemStack('flint_and_steel', 1),
      durability,
    })

    expect(outcome.result).toStrictEqual({ _tag: 'Added', added: 1, leftover: null })
    expect(outcome.storage.inventory.slots[0]).toStrictEqual(itemStack('flint_and_steel', 1))
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
      leftover: { ...itemStack('stone', 6), durability: null },
    })
    expect(partial.storage.inventory.slots[0]).toStrictEqual(itemStack('stone', 64))

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
      leftover: { ...itemStack('stone', 10), durability: null },
    })
    expect(inventoryFull.storage).toBe(noCapacity)
  })

  it('rejects malformed stored stacks atomically', () => {
    const storage = emptyPlayerStorage()
    const durability = { current: 17, max: FLINT_AND_STEEL_MAX_DURABILITY }
    const malformed: ReadonlyArray<unknown> = [
      { ...itemStack('stone', 1), durability: null, extra: true },
      { ...itemStack('stone', 1), item: 'not_an_item', durability: null },
      { ...itemStack('stone', 1), count: 0, durability: null },
      { ...itemStack('stone', 1), count: 65, durability: null },
      { ...itemStack('flint_and_steel', 1), count: 2, durability },
      { ...itemStack('stone', 1), durability },
      { ...itemStack('flint_and_steel', 1), durability: null },
      { ...itemStack('flint_and_steel', 1), durability: { current: 17, max: 65 } },
      { ...itemStack('flint_and_steel', 1), durability: { ...durability, extra: true } },
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
        itemStack('flint_and_steel', 1),
        itemStack('flint_and_steel', 1),
        itemStack('iron_helmet', 1),
        itemStack('iron_helmet', 1),
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
        ...itemStack('flint_and_steel', 1), durability: { current: 64, max: 64 },
      })

      expect(yield* service.unequipToInventory('offhand', 4)).toMatchObject({
        _tag: 'Unequipped', slotIndex: 4,
      })
      const unequipped = yield* service.storageSnapshot
      expect(unequipped.equipment.slots.offhand).toBeNull()
      expect(unequipped.inventory.slots[4]).toStrictEqual(itemStack('flint_and_steel', 1))
      expect(unequipped.inventoryDurability[4]).toStrictEqual({ current: 64, max: 64 })
    }),
  )

  it.effect('equips matching armour with default durability and preserves damage when unequipped', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('iron_helmet', 1)

      expect(yield* service.equipFromInventory(0, 'head')).toMatchObject({ _tag: 'Equipped' })
      expect((yield* service.storageSnapshot).equipment.slots.head).toStrictEqual({
        ...itemStack('iron_helmet', 1),
        durability: { current: 165, max: 165 },
      })

      yield* service.damageAt({ _tag: 'Equipment', slot: 'head' }, 15)
      expect(yield* service.unequipToInventory('head', 4)).toMatchObject({
        _tag: 'Unequipped', slotIndex: 4,
      })
      const unequipped = yield* service.storageSnapshot
      expect(unequipped.inventory.slots[4]).toStrictEqual(itemStack('iron_helmet', 1))
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
      const invalidClick = yield* Effect.result(service.click({
        _tag: 'LeftClick', slotIndex: 2,
        carried: {
          ...itemStack('iron_boots', 1),
          durability: { current: 1, max: 64 },
        },
      }))
      expect(invalidClick._tag).toBe('Failure')
      if (invalidClick._tag === 'Failure') {
        expect(invalidClick.failure).toMatchObject({ _tag: 'ItemValidationFailure', field: 'click.carried' })
      }
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
      expect(after.inventory.slots[0]).toStrictEqual(itemStack('bow', 1))
      expect(after.inventoryDurability[0]).toStrictEqual({ current: 383, max: 384 })
      expect(after.inventory.slots[1]).toStrictEqual(itemStack('arrow', 1))
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

      const result = yield* Effect.result(service.restoreStorage(malformed))
      expect(result._tag).toBe('Failure')
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
      expect(after.inventory.slots[3]).toStrictEqual(itemStack('iron_boots', 1))
      expect(after.inventoryDurability[3]).toStrictEqual({ current: 188, max: 195 })
      expect((yield* Effect.result(service.restoreStorage(after)))._tag).toBe('Success')
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

  it.effect('inventory restore preserves equipment and unchanged durability', () =>
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
        ...itemStack('iron_helmet', 1), durability: { current: 165, max: 165 },
      })
      expect(after.inventoryDurability[0]).toStrictEqual({ current: 188, max: 195 })
      expect(after.inventoryDurability[1]).toStrictEqual({ current: 240, max: 240 })
    }),
  )

  it('does not merge a second damageable stack into the first even when durability matches exactly', () => {
    const durability = { current: 40, max: FLINT_AND_STEEL_MAX_DURABILITY }
    const first = addStoredStack(emptyPlayerStorage(), { ...itemStack('flint_and_steel', 1), durability }).storage
    const second = addStoredStack(first, { ...itemStack('flint_and_steel', 1), durability }).storage

    expect(second.inventory.slots[0]).toStrictEqual(itemStack('flint_and_steel', 1))
    expect(second.inventoryDurability[0]).toStrictEqual({ current: 40, max: FLINT_AND_STEEL_MAX_DURABILITY })
    expect(second.inventory.slots[1]).toStrictEqual(itemStack('flint_and_steel', 1))
    expect(second.inventoryDurability[1]).toStrictEqual({ current: 40, max: FLINT_AND_STEEL_MAX_DURABILITY })
  })

  it('rejects equip from an out-of-range inventory slot and leaves storage untouched', () => {
    const storage = emptyPlayerStorage()
    const negative = equipFromInventory(storage, -1, 'head')
    expect(negative.result).toStrictEqual({ _tag: 'InvalidInventorySlot' })
    expect(negative.storage).toBe(storage)
    const tooHigh = equipFromInventory(storage, 36, 'head')
    expect(tooHigh.result).toStrictEqual({ _tag: 'InvalidInventorySlot' })
    expect(tooHigh.storage).toBe(storage)
  })

  it('rejects equip into an invalid equipment slot string and leaves storage untouched', () => {
    const storage = addStoredStack(emptyPlayerStorage(), {
      ...itemStack('iron_helmet', 1),
      durability: { current: 165, max: 165 },
    }).storage
    const outcome = equipFromInventory(storage, 0, 'bogus' as unknown as Eq.EquipmentSlot)
    expect(outcome.result).toStrictEqual({ _tag: 'InvalidEquipmentSlot' })
    expect(outcome.storage).toBe(storage)
  })

  it('rejects equip from an empty inventory slot and leaves storage untouched', () => {
    const storage = emptyPlayerStorage()
    const outcome = equipFromInventory(storage, 0, 'head')
    expect(outcome.result).toStrictEqual({ _tag: 'Empty' })
    expect(outcome.storage).toBe(storage)
  })

  it('rejects equip into an already-occupied equipment slot and leaves storage untouched', () => {
    const withFirstHelmet = addStoredStack(emptyPlayerStorage(), {
      ...itemStack('iron_helmet', 1),
      durability: { current: 165, max: 165 },
    }).storage
    const equipped = equipFromInventory(withFirstHelmet, 0, 'head').storage
    const withSecondHelmet = addStoredStack(equipped, {
      ...itemStack('iron_helmet', 1),
      durability: { current: 165, max: 165 },
    }).storage

    const outcome = equipFromInventory(withSecondHelmet, 0, 'head')
    expect(outcome.result).toMatchObject({ _tag: 'Occupied', item: { item: 'iron_helmet' } })
    expect(outcome.storage).toBe(withSecondHelmet)
  })

  it('rejects equip when the stored durability entry is invalid without resetting it', () => {
    const base = addStoredStack(emptyPlayerStorage(), {
      ...itemStack('iron_helmet', 1),
      durability: { current: 165, max: 165 },
    }).storage
    const corrupted: PlayerStorage = {
      ...base,
      inventoryDurability: base.inventoryDurability.map((value, index) => (index === 0 ? null : value)),
    }

    const outcome = equipFromInventory(corrupted, 0, 'head')
    expect(outcome.result).toStrictEqual({ _tag: 'InvalidDurability', item: itemStack('iron_helmet', 1) })
    expect(outcome.storage).toBe(corrupted)
  })

  it('keeps invalid stored durability typed through damage and inventory updates', () => {
    const base = storageFromInventory({
      slots: [itemStack('bow', 1), itemStack('stone', 1), ...Array.from({ length: 34 }, () => undefined)],
    })
    const corrupted: PlayerStorage = {
      ...base,
      inventoryDurability: base.inventoryDurability.map((value, index) => index === 0 ? null : value),
    }
    const damaged = damageAt(corrupted, { _tag: 'Inventory', slotIndex: 0 }, 1)
    expect(damaged.result).toStrictEqual({ _tag: 'InvalidDurability', item: itemStack('bow', 1) })
    expect(damaged.storage).toBe(corrupted)

    const updated = withInventory(corrupted, corrupted.inventory)
    expect(Result.isFailure(updated)).toBe(true)
    if (Result.isFailure(updated)) expect(updated.failure).toMatchObject({
      _tag: 'InvalidInventoryDurability', slotIndex: 0, item: 'bow',
    })

    const consumed = consumeAndDamageAt(corrupted, {
      consume: { item: 'stone', count: 1 },
      damage: { location: { _tag: 'Inventory', slotIndex: 0 }, expectedItem: 'bow', amount: 1 },
    })
    expect(consumed.result).toStrictEqual({ _tag: 'InvalidDurability', item: itemStack('bow', 1) })
    expect(consumed.storage).toBe(corrupted)
  })

  it('rejects unequip from an invalid equipment slot string and leaves storage untouched', () => {
    const storage = emptyPlayerStorage()
    const outcome = unequipToInventory(storage, 'bogus' as unknown as Eq.EquipmentSlot)
    expect(outcome.result).toStrictEqual({ _tag: 'InvalidEquipmentSlot' })
    expect(outcome.storage).toBe(storage)
  })

  it('rejects unequip from an empty equipment slot and leaves storage untouched', () => {
    const storage = emptyPlayerStorage()
    const outcome = unequipToInventory(storage, 'head')
    expect(outcome.result).toStrictEqual({ _tag: 'Empty' })
    expect(outcome.storage).toBe(storage)
  })

  it('rejects an out-of-range explicit inventory slot when unequipping, leaving storage untouched', () => {
    const equipped = equipFromInventory(
      addStoredStack(emptyPlayerStorage(), {
        ...itemStack('iron_helmet', 1),
        durability: { current: 165, max: 165 },
      }).storage,
      0, 'head',
    ).storage
    const outcome = unequipToInventory(equipped, 'head', 36)
    expect(outcome.result).toStrictEqual({ _tag: 'InvalidInventorySlot' })
    expect(outcome.storage).toBe(equipped)
  })

  it('reports InventoryFull when unequipping into a completely full inventory with no explicit slot', () => {
    const full = storageFromInventory({ slots: Array.from({ length: 36 }, () => itemStack('dirt', 64)) })
    const withHeadEquipped: PlayerStorage = {
      ...full,
      equipment: {
        ...full.equipment,
        slots: {
          ...full.equipment.slots,
          head: equipmentItem(itemStack('iron_helmet', 1), { current: 165, max: 165 }),
        },
      },
    }
    const outcome = unequipToInventory(withHeadEquipped, 'head')
    expect(outcome.result).toStrictEqual({ _tag: 'InventoryFull' })
    expect(outcome.storage).toBe(withHeadEquipped)
  })

  it('rejects unequip into an already-occupied explicit inventory slot, leaving storage untouched', () => {
    const equipped = equipFromInventory(
      addStoredStack(emptyPlayerStorage(), {
        ...itemStack('iron_helmet', 1),
        durability: { current: 165, max: 165 },
      }).storage,
      0, 'head',
    ).storage
    const withStoneAtOne: PlayerStorage = {
      ...equipped,
      inventory: {
        slots: equipped.inventory.slots.map((slot, index) => (index === 1 ? itemStack('stone', 1) : slot)),
      },
      inventoryDurability: equipped.inventoryDurability.map((value, index) => (index === 1 ? null : value)),
    }

    const outcome = unequipToInventory(withStoneAtOne, 'head', 1)
    expect(outcome.result).toStrictEqual({ _tag: 'OccupiedInventorySlot' })
    expect(outcome.storage).toBe(withStoneAtOne)
  })

  it('returns the unequipped item when moving equipment into an empty slot', () => {
    const equipped = equipFromInventory(
      addStoredStack(emptyPlayerStorage(), {
        ...itemStack('iron_helmet', 1),
        durability: { current: 165, max: 165 },
      }).storage,
      0, 'head',
    ).storage

    expect(unequipToInventory(equipped, 'head', 1).result).toMatchObject({
      _tag: 'Unequipped', slotIndex: 1,
    })
  })

  it('rejects a non-integer or non-positive damage amount, leaving storage untouched', () => {
    const storage = addStoredStack(emptyPlayerStorage(), {
      ...itemStack('flint_and_steel', 1),
      durability: { current: 64, max: 64 },
    }).storage
    for (const amount of [0, -1, 1.5, Number.NaN]) {
      const outcome = damageAt(storage, { _tag: 'Inventory', slotIndex: 0 }, amount)
      expect(outcome.result).toStrictEqual({ _tag: 'InvalidAmount', amount })
      expect(outcome.storage).toBe(storage)
    }
  })

  it('reports InvalidLocation for a damage location that is not a record, leaving storage untouched', () => {
    const storage = emptyPlayerStorage()
    for (const location of [null, 'head', 42, ['Inventory']] as ReadonlyArray<unknown>) {
      const outcome = damageAt(storage, location as StorageLocation, 1)
      expect(outcome.result).toStrictEqual({ _tag: 'InvalidLocation' })
      expect(outcome.storage).toBe(storage)
    }
  })

  it('reports Empty and leaves storage untouched when damaging an unoccupied equipment slot', () => {
    const storage = emptyPlayerStorage()
    const outcome = damageAt(storage, { _tag: 'Equipment', slot: 'offhand' }, 1)
    expect(outcome.result).toStrictEqual({ _tag: 'Empty' })
    expect(outcome.storage).toBe(storage)
  })

  it('damages an equipped item through the pure storage transition', () => {
    const equipped = equipFromInventory(
      addStoredStack(emptyPlayerStorage(), {
        ...itemStack('iron_helmet', 1),
        durability: { current: 165, max: 165 },
      }).storage,
      0, 'head',
    ).storage

    expect(damageAt(equipped, { _tag: 'Equipment', slot: 'head' }, 15).result).toMatchObject({
      _tag: 'Damaged', applied: 15,
    })
  })

  it('reports InvalidLocation for an inventory location with a bad tag or an out-of-range slot index', () => {
    const storage = emptyPlayerStorage()
    const badTag = damageAt(storage, { _tag: 'Bogus', slotIndex: 0 } as unknown as StorageLocation, 1)
    expect(badTag.result).toStrictEqual({ _tag: 'InvalidLocation' })
    expect(badTag.storage).toBe(storage)
    const outOfRange = damageAt(storage, { _tag: 'Inventory', slotIndex: 36 }, 1)
    expect(outOfRange.result).toStrictEqual({ _tag: 'InvalidLocation' })
    expect(outOfRange.storage).toBe(storage)
  })

  it('reports Empty when damaging an unoccupied inventory slot', () => {
    const storage = emptyPlayerStorage()
    const outcome = damageAt(storage, { _tag: 'Inventory', slotIndex: 0 }, 1)
    expect(outcome.result).toStrictEqual({ _tag: 'Empty' })
    expect(outcome.storage).toBe(storage)
  })

  it.effect('rejects a non-integer or non-positive consumable count, leaving storage untouched', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('bow', 1)
      yield* service.add('arrow', 1)
      const before = yield* service.storageSnapshot

      for (const count of [0, -1, 1.5]) {
        expect(yield* service.consumeAndDamageAt({
          consume: { item: 'arrow', count },
          damage: { location: { _tag: 'Inventory', slotIndex: 0 }, expectedItem: 'bow', amount: 1 },
        })).toStrictEqual({ _tag: 'InvalidConsumableCount', count })
      }
      const nonFiniteCount = yield* Effect.result(service.consumeAndDamageAt({
        consume: { item: 'arrow', count: Number.NaN },
        damage: { location: { _tag: 'Inventory', slotIndex: 0 }, expectedItem: 'bow', amount: 1 },
      }))
      expect(nonFiniteCount._tag).toBe('Failure')
      if (nonFiniteCount._tag === 'Failure') {
        expect(nonFiniteCount.failure).toMatchObject({ _tag: 'ItemValidationFailure', reason: 'invalid-type' })
      }
      expect(yield* service.storageSnapshot).toStrictEqual(before)
    }),
  )

  it.effect('rejects a non-integer or non-positive damage amount, leaving storage untouched', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('bow', 1)
      yield* service.add('arrow', 1)
      const before = yield* service.storageSnapshot

      for (const amount of [0, -1, 1.5]) {
        expect(yield* service.consumeAndDamageAt({
          consume: { item: 'arrow', count: 1 },
          damage: { location: { _tag: 'Inventory', slotIndex: 0 }, expectedItem: 'bow', amount },
        })).toStrictEqual({ _tag: 'InvalidDamageAmount', amount })
      }
      const nonFiniteAmount = yield* Effect.result(service.consumeAndDamageAt({
        consume: { item: 'arrow', count: 1 },
        damage: { location: { _tag: 'Inventory', slotIndex: 0 }, expectedItem: 'bow', amount: Number.NaN },
      }))
      expect(nonFiniteAmount._tag).toBe('Failure')
      if (nonFiniteAmount._tag === 'Failure') {
        expect(nonFiniteAmount.failure).toMatchObject({ _tag: 'ItemValidationFailure', reason: 'invalid-type' })
      }
      expect(yield* service.storageSnapshot).toStrictEqual(before)
    }),
  )

  it.effect(
    'reports InvalidLocation when the damage location is not a record or names an out-of-range inventory slot',
    () =>
      Effect.gen(function* () {
        const service = yield* makeInventoryService()
        yield* service.add('bow', 1)
        yield* service.add('arrow', 1)
        const before = yield* service.storageSnapshot

        expect(yield* service.consumeAndDamageAt({
          consume: { item: 'arrow', count: 1 },
          damage: { location: null as unknown as StorageLocation, expectedItem: 'bow', amount: 1 },
        })).toStrictEqual({ _tag: 'InvalidLocation' })
        expect(yield* service.consumeAndDamageAt({
          consume: { item: 'arrow', count: 1 },
          damage: { location: { _tag: 'Inventory', slotIndex: 999 }, expectedItem: 'bow', amount: 1 },
        })).toStrictEqual({ _tag: 'InvalidLocation' })
        expect(yield* service.storageSnapshot).toStrictEqual(before)
      }),
  )

  it.effect('reports InvalidLocation for an unknown equipment slot', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const before = yield* service.storageSnapshot

      expect(yield* service.consumeAndDamageAt({
        consume: { item: 'arrow', count: 1 },
        damage: {
          location: { _tag: 'Equipment', slot: 'invalid' } as unknown as StorageLocation,
          expectedItem: 'bow',
          amount: 1,
        },
      })).toStrictEqual({ _tag: 'InvalidLocation' })
      expect(yield* service.storageSnapshot).toStrictEqual(before)
    }),
  )

  it.effect('reports DamageTargetMismatch with a null actualItem for an empty inventory slot', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('arrow', 1)
      const before = yield* service.storageSnapshot

      expect(yield* service.consumeAndDamageAt({
        consume: { item: 'arrow', count: 1 },
        damage: { location: { _tag: 'Inventory', slotIndex: 1 }, expectedItem: 'bow', amount: 1 },
      })).toStrictEqual({ _tag: 'DamageTargetMismatch', actualItem: null })
      expect(yield* service.storageSnapshot).toStrictEqual(before)
    }),
  )

  it.effect('reports DamageTargetMismatch with a null actualItem when the damage location is an empty equipment slot', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('arrow', 1)
      const before = yield* service.storageSnapshot

      expect(yield* service.consumeAndDamageAt({
        consume: { item: 'arrow', count: 1 },
        damage: { location: { _tag: 'Equipment', slot: 'offhand' }, expectedItem: 'bow', amount: 1 },
      })).toStrictEqual({ _tag: 'DamageTargetMismatch', actualItem: null })
      expect(yield* service.storageSnapshot).toStrictEqual(before)
    }),
  )

  it.effect('consumes ammunition and damages an EQUIPPED item, not only one sitting in inventory', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('iron_pickaxe', 1)
      yield* service.add('stone', 1)
      expect(yield* service.equipFromInventory(0, 'offhand')).toMatchObject({ _tag: 'Equipped' })

      expect(yield* service.consumeAndDamageAt({
        consume: { item: 'stone', count: 1 },
        damage: {
          location: { _tag: 'Equipment', slot: 'offhand' },
          expectedItem: 'iron_pickaxe',
          amount: 1,
        },
      })).toMatchObject({
        _tag: 'Applied',
        consumed: 1,
        damage: { _tag: 'Damaged', item: { item: 'iron_pickaxe', durability: { current: 249, max: 250 } } },
      })

      const after = yield* service.storageSnapshot
      expect(after.equipment.slots.offhand).toMatchObject({ durability: { current: 249, max: 250 } })
      expect(after.inventory.slots.every((slot) => slot === undefined)).toBe(true)
    }),
  )

  it.effect(
    'does not damage a non-damageable item even when it matches the expected item, leaving storage untouched',
    () =>
      Effect.gen(function* () {
        const service = yield* makeInventoryService()
        yield* service.add('stone', 5)
        yield* service.add('arrow', 1)
        const before = yield* service.storageSnapshot

        expect(yield* service.consumeAndDamageAt({
          consume: { item: 'arrow', count: 1 },
          damage: { location: { _tag: 'Inventory', slotIndex: 0 }, expectedItem: 'stone', amount: 1 },
        })).toStrictEqual({ _tag: 'NotDamageable', item: itemStack('stone', 5) })
        expect(yield* service.storageSnapshot).toStrictEqual(before)
      }),
  )

  it.effect('excludes the damage target\'s own slot from its own consumable count', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('bow', 2)

      expect(yield* service.consumeAndDamageAt({
        consume: { item: 'bow', count: 1 },
        damage: { location: { _tag: 'Inventory', slotIndex: 0 }, expectedItem: 'bow', amount: 1 },
      })).toMatchObject({
        _tag: 'Applied', consumed: 1,
        damage: { _tag: 'Damaged', item: { item: 'bow' } },
      })

      const after = yield* service.storageSnapshot
      expect(after.inventory.slots[0]).toStrictEqual(itemStack('bow', 1))
      expect(after.inventoryDurability[0]).toStrictEqual({ current: 383, max: 384 })
      expect(after.inventory.slots[1]).toBeUndefined()
    }),
  )

  it.effect('REGRESSION: a lone damage target cannot satisfy its own consumable requirement', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('bow', 1)

      expect(yield* service.consumeAndDamageAt({
        consume: { item: 'bow', count: 1 },
        damage: { location: { _tag: 'Inventory', slotIndex: 0 }, expectedItem: 'bow', amount: 1 },
      })).toStrictEqual({ _tag: 'InsufficientConsumable', available: 0 })
    }),
  )

  it.effect('rejects a restore snapshot with the wrong top-level or nested-array shape', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const snapshot = yield* service.storageSnapshot

      const missingKey = { inventory: snapshot.inventory, equipment: snapshot.equipment }
      const missingKeyResult = yield* Effect.result(service.restoreStorage(missingKey))
      expect(missingKeyResult._tag).toBe('Failure')
      if (missingKeyResult._tag === 'Failure') {
        expect(missingKeyResult.failure).toStrictEqual({
          _tag: 'PlayerStorageValidationError',
          path: 'storage',
          reason: 'expected exactly inventory, equipment, and inventoryDurability',
        })
      }

      const badSlotsLength = { ...snapshot, inventory: { slots: snapshot.inventory.slots.slice(0, 10) } }
      const badSlotsLengthResult = yield* Effect.result(service.restoreStorage(badSlotsLength))
      expect(badSlotsLengthResult._tag).toBe('Failure')
      if (badSlotsLengthResult._tag === 'Failure') {
        expect(badSlotsLengthResult.failure).toStrictEqual({
          _tag: 'PlayerStorageValidationError',
          path: 'storage.inventory.slots',
          reason: 'expected exactly 36 slots',
        })
      }

      const badDurabilityLength = { ...snapshot, inventoryDurability: snapshot.inventoryDurability.slice(0, 10) }
      const badDurabilityLengthResult = yield* Effect.result(service.restoreStorage(badDurabilityLength))
      expect(badDurabilityLengthResult._tag).toBe('Failure')
      if (badDurabilityLengthResult._tag === 'Failure') {
        expect(badDurabilityLengthResult.failure).toStrictEqual({
          _tag: 'PlayerStorageValidationError',
          path: 'storage.inventoryDurability',
          reason: 'expected exactly 36 entries',
        })
      }

      const badEquipment = {
        ...snapshot,
        equipment: { slots: { head: null, chest: null, legs: null, feet: null } },
      }
      const badEquipmentResult = yield* Effect.result(service.restoreStorage(badEquipment))
      expect(badEquipmentResult._tag).toBe('Failure')
      if (badEquipmentResult._tag === 'Failure') {
        expect(badEquipmentResult.failure).toStrictEqual({
          _tag: 'PlayerStorageValidationError',
          path: 'storage.equipment.slots',
          reason: 'expected exactly head, chest, legs, feet, and offhand',
        })
      }

      expect(yield* service.storageSnapshot).toStrictEqual(snapshot)
    }),
  )

  it.effect('rejects a restore snapshot with a non-null durability on an empty slot', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const valid = yield* service.storageSnapshot
      const corrupted = {
        ...valid,
        inventoryDurability: valid.inventoryDurability.map((value, index) =>
          (index === 5 ? { current: 1, max: 1 } : value)),
      }

      const result = yield* Effect.result(service.restoreStorage(corrupted))
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        expect(result.failure).toStrictEqual({
          _tag: 'PlayerStorageValidationError',
          path: 'storage.inventoryDurability.5',
          reason: 'empty slot requires null',
        })
      }
      expect(yield* service.storageSnapshot).toStrictEqual(valid)
    }),
  )

  it.effect('accepts explicit null empty slots during restore', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const valid = yield* service.storageSnapshot
      const explicitNull = {
        ...valid,
        inventory: {
          ...valid.inventory,
          slots: valid.inventory.slots.map((slot, index) => (index === 5 ? null : slot)),
        },
        inventoryDurability: valid.inventoryDurability.map((value, index) => (index === 5 ? null : value)),
      }

      expect((yield* Effect.result(service.restoreStorage(explicitNull)))._tag).toBe('Success')
      expect((yield* service.storageSnapshot).inventory.slots[5]).toBeUndefined()
    }),
  )

  it.effect('rejects an invalid item stack shape during restore', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const valid = yield* service.storageSnapshot
      const corrupted = {
        ...valid,
        inventory: {
          ...valid.inventory,
          slots: valid.inventory.slots.map((slot, index) =>
            (index === 0 ? { ...itemStack('stone', 1), count: 0 } : slot)),
        },
      }

      const result = yield* Effect.result(service.restoreStorage(corrupted))
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        expect(result.failure).toStrictEqual({
          _tag: 'PlayerStorageValidationError',
          path: 'storage.inventory.slots.0',
          reason: 'expected a valid item stack',
        })
      }
      expect(yield* service.storageSnapshot).toStrictEqual(valid)
    }),
  )

  it.effect('rejects legacy inventory stacks without resolved components', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const valid = yield* service.storageSnapshot
      const legacy = {
        ...valid,
        inventory: {
          ...valid.inventory,
          slots: valid.inventory.slots.map((slot, index) =>
            (index === 0 ? { item: 'stone', count: 1 } : slot)),
        },
      }

      const result = yield* Effect.result(service.restoreStorage(legacy))
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        expect(result.failure).toStrictEqual({
          _tag: 'PlayerStorageValidationError',
          path: 'storage.inventory.slots.0',
          reason: 'expected a valid item stack',
        })
      }
    }),
  )

  it.effect('rejects a restore snapshot with a non-null durability on a non-damageable item slot', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('stone', 3)
      const valid = yield* service.storageSnapshot
      const validResult = yield* Effect.result(service.restoreStorage(valid))
      expect(validResult._tag).toBe('Success')

      const corrupted = {
        ...valid,
        inventoryDurability: valid.inventoryDurability.map((value, index) =>
          (index === 0 ? { current: 1, max: 1 } : value)),
      }
      const result = yield* Effect.result(service.restoreStorage(corrupted))
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        expect(result.failure).toStrictEqual({
          _tag: 'PlayerStorageValidationError',
          path: 'storage.inventoryDurability.0',
          reason: 'non-durable item requires null',
        })
      }
      expect(yield* service.storageSnapshot).toStrictEqual(valid)
    }),
  )
})
