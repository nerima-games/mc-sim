import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  damageEquipment,
  durability,
  durabilityForItem,
  emptyEquipment,
  equip,
  equipmentDefinitionFor,
  equipmentItem,
  equippedAt,
  swapEquipment,
  unequip,
  validateEquipmentSnapshot,
  type EquipmentItem,
} from '../domain/equipment'
import { itemStack } from '../domain/inventory'

const helmet = (current = 165): EquipmentItem =>
  equipmentItem(itemStack('iron_helmet', 1), durability(current, 165))

const flint = (current = 64): EquipmentItem =>
  equipmentItem(itemStack('flint_and_steel', 1), durability(current, 64))

describe('equipment domain', () => {
  it.effect('starts with the five explicit equipment slots empty', () =>
    Effect.sync(() => {
      expect(emptyEquipment()).toStrictEqual({
        slots: { head: null, chest: null, legs: null, feet: null, offhand: null },
      })
    }),
  )

  it.effect('defines slot compatibility and default durability in one catalog', () =>
    Effect.sync(() => {
      expect(equipmentDefinitionFor('iron_helmet')).toStrictEqual({ slot: 'head', maxDurability: 165 })
      expect(equipmentDefinitionFor('iron_chestplate')).toStrictEqual({ slot: 'chest', maxDurability: 240 })
      expect(equipmentDefinitionFor('iron_leggings')).toStrictEqual({ slot: 'legs', maxDurability: 225 })
      expect(equipmentDefinitionFor('iron_boots')).toStrictEqual({ slot: 'feet', maxDurability: 195 })
      expect(equipmentDefinitionFor('flint_and_steel')).toStrictEqual({ slot: 'offhand', maxDurability: 64 })
      expect(equipmentDefinitionFor('wooden_pickaxe')).toStrictEqual({ slot: 'offhand', maxDurability: 59 })
      expect(equipmentDefinitionFor('stone_pickaxe')).toStrictEqual({ slot: 'offhand', maxDurability: 131 })
      expect(durabilityForItem('wooden_pickaxe')).toStrictEqual({ current: 59, max: 59 })
      expect(durabilityForItem('stone_pickaxe')).toStrictEqual({ current: 131, max: 131 })
      expect(durabilityForItem('iron_boots')).toStrictEqual({ current: 195, max: 195 })
      expect(durabilityForItem('stone')).toBeNull()
    }),
  )

  it.effect('constructs only valid catalog equipment with canonical durability', () =>
    Effect.sync(() => {
      expect(equipmentItem(itemStack('iron_boots', 1))).toStrictEqual({
        item: 'iron_boots', count: 1, durability: { current: 195, max: 195 },
      })
      expect(() => equipmentItem(itemStack('stone', 1))).toThrow(RangeError)
      expect(() => equipmentItem({ ...itemStack('stone', 2), item: 'iron_helmet' })).toThrow(RangeError)
      expect(() => equipmentItem(itemStack('iron_helmet', 1), null)).toThrow(RangeError)
      expect(() => equipmentItem(itemStack('iron_helmet', 1), durability(64, 64))).toThrow(RangeError)
    }),
  )

  it.effect('rejects arbitrary items and slot mismatches without changing equipment', () =>
    Effect.sync(() => {
      const initial = emptyEquipment()
      const arbitrary = { ...itemStack('torch', 1), durability: null } as EquipmentItem

      expect(equip(initial, 'head', arbitrary).equipment).toBe(initial)
      expect(equip(initial, 'chest', helmet()).equipment).toBe(initial)
    }),
  )

  it.effect('equips, replaces, and unequips while preserving durability', () =>
    Effect.sync(() => {
      const initial = emptyEquipment()
      const first = equip(initial, 'head', helmet(120))
      const replacement = equip(first.equipment, 'head', helmet(80))
      const removed = unequip(replacement.equipment, 'head')

      expect(first.result).toBeNull()
      expect(replacement.result?.durability).toStrictEqual({ current: 120, max: 165 })
      expect(removed.result?.durability).toStrictEqual({ current: 80, max: 165 })
      expect(equippedAt(removed.equipment, 'head')).toBeNull()
      expect(equippedAt(initial, 'head')).toBeNull()
    }),
  )

  it.effect('does not swap items into incompatible slots', () =>
    Effect.sync(() => {
      const withHelmet = equip(emptyEquipment(), 'head', helmet()).equipment
      const equipped = equip(withHelmet, 'offhand', flint()).equipment
      expect(swapEquipment(equipped, 'head', 'offhand')).toBe(equipped)
    }),
  )

  it.effect('applies damage and removes an item atomically when it breaks', () =>
    Effect.sync(() => {
      const equipped = equip(emptyEquipment(), 'head', helmet(3)).equipment
      const damaged = damageEquipment(equipped, 'head', 1)
      const broken = damageEquipment(damaged.equipment, 'head', 9)

      expect(damaged.result).toMatchObject({
        _tag: 'Damaged', applied: 1, item: { durability: { current: 2, max: 165 } },
      })
      expect(broken.result).toMatchObject({ _tag: 'Broken', applied: 2 })
      expect(equippedAt(broken.equipment, 'head')).toBeNull()
      expect(equippedAt(equipped, 'head')?.durability?.current).toBe(3)
    }),
  )

  it.effect('leaves state unchanged for invalid damage', () =>
    Effect.sync(() => {
      const equipped = equip(emptyEquipment(), 'offhand', flint()).equipment
      const invalid = damageEquipment(equipped, 'offhand', 0)
      expect(invalid.result).toStrictEqual({ _tag: 'InvalidAmount', amount: 0 })
      expect(invalid.equipment).toBe(equipped)
    }),
  )

  it.effect('rejects zero, excessive, and non-integral durability', () =>
    Effect.sync(() => {
      expect(() => durability(0, 1)).toThrow(RangeError)
      expect(() => durability(2, 1)).toThrow(RangeError)
      expect(() => durability(0.5, 1)).toThrow(RangeError)
    }),
  )

  it.effect('strictly validates item, slot, count, current, max, and shape', () =>
    Effect.sync(() => {
      const valid = equip(emptyEquipment(), 'feet', equipmentItem(itemStack('iron_boots', 1))).equipment
      expect(validateEquipmentSnapshot(JSON.parse(JSON.stringify(valid)))._tag).toBe('Valid')

      const invalidItems = [
        { item: 'stone', count: 1, durability: null },
        { item: 'iron_helmet', count: 1, durability: { current: 165, max: 165 } },
        { item: 'iron_boots', count: 2, durability: { current: 195, max: 195 } },
        { item: 'iron_boots', count: 1, durability: { current: 0, max: 195 } },
        { item: 'iron_boots', count: 1, durability: { current: 194, max: 194 } },
        { item: 'iron_boots', count: 1, durability: { current: 195, max: 195 }, extra: true },
      ]
      for (const item of invalidItems) {
        const snapshot = { slots: { ...valid.slots, feet: item } }
        expect(validateEquipmentSnapshot(snapshot)._tag).toBe('Invalid')
      }
    }),
  )
})
