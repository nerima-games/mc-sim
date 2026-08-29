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
  isDamageableItemType,
  isEquippableItemType,
  itemDurabilityDefinitionFor,
  swapEquipment,
  unequip,
  validateEquipmentSnapshot,
  type EquipmentItem,
} from '../src/domain/equipment'
import { itemStack } from '../src/domain/inventory'

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

  it.effect('defines slot compatibility separately from item durability', () =>
    Effect.sync(() => {
      expect(equipmentDefinitionFor('iron_helmet')).toStrictEqual({ slot: 'head' })
      expect(equipmentDefinitionFor('iron_chestplate')).toStrictEqual({ slot: 'chest' })
      expect(equipmentDefinitionFor('iron_leggings')).toStrictEqual({ slot: 'legs' })
      expect(equipmentDefinitionFor('iron_boots')).toStrictEqual({ slot: 'feet' })
      expect(equipmentDefinitionFor('flint_and_steel')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('shears')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('wooden_pickaxe')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('stone_pickaxe')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('iron_pickaxe')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('diamond_pickaxe')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('wooden_hoe')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('stone_hoe')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('iron_hoe')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('diamond_hoe')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('wooden_sword')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('stone_sword')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('iron_sword')).toStrictEqual({ slot: 'offhand' })
      expect(equipmentDefinitionFor('diamond_sword')).toStrictEqual({ slot: 'offhand' })
      expect(itemDurabilityDefinitionFor('iron_helmet')).toStrictEqual({ maxDurability: 165 })
      expect(durabilityForItem('shears')).toStrictEqual({ current: 238, max: 238 })
      expect(durabilityForItem('wooden_pickaxe')).toStrictEqual({ current: 59, max: 59 })
      expect(durabilityForItem('stone_pickaxe')).toStrictEqual({ current: 131, max: 131 })
      expect(durabilityForItem('iron_pickaxe')).toStrictEqual({ current: 250, max: 250 })
      expect(durabilityForItem('diamond_pickaxe')).toStrictEqual({ current: 1561, max: 1561 })
      expect(durabilityForItem('wooden_hoe')).toStrictEqual({ current: 59, max: 59 })
      expect(durabilityForItem('stone_hoe')).toStrictEqual({ current: 131, max: 131 })
      expect(durabilityForItem('iron_hoe')).toStrictEqual({ current: 250, max: 250 })
      expect(durabilityForItem('diamond_hoe')).toStrictEqual({ current: 1561, max: 1561 })
      expect(durabilityForItem('wooden_sword')).toStrictEqual({ current: 59, max: 59 })
      expect(durabilityForItem('stone_sword')).toStrictEqual({ current: 131, max: 131 })
      expect(durabilityForItem('iron_sword')).toStrictEqual({ current: 250, max: 250 })
      expect(durabilityForItem('diamond_sword')).toStrictEqual({ current: 1561, max: 1561 })
      expect(durabilityForItem('iron_boots')).toStrictEqual({ current: 195, max: 195 })
      expect(itemDurabilityDefinitionFor('bow')).toStrictEqual({ maxDurability: 384 })
      expect(durabilityForItem('bow')).toStrictEqual({ current: 384, max: 384 })
      expect(isDamageableItemType('bow')).toBe(true)
      expect(isEquippableItemType('bow')).toBe(false)
      expect(equipmentDefinitionFor('bow')).toBeUndefined()
      expect(itemDurabilityDefinitionFor('fishing_rod')).toStrictEqual({ maxDurability: 64 })
      expect(durabilityForItem('fishing_rod')).toStrictEqual({ current: 64, max: 64 })
      expect(isDamageableItemType('fishing_rod')).toBe(true)
      expect(isEquippableItemType('fishing_rod')).toBe(false)
      expect(durabilityForItem('stone')).toBeNull()
    }),
  )

  it.effect('constructs only valid catalog equipment with canonical durability', () =>
    Effect.sync(() => {
      expect(equipmentItem(itemStack('iron_boots', 1))).toStrictEqual({
        item: 'iron_boots', count: 1, durability: { current: 195, max: 195 },
      })
      expect(() => equipmentItem(itemStack('stone', 1))).toThrow(RangeError)
      expect(equipmentItem(itemStack('bow', 1))).toStrictEqual({
        item: 'bow', count: 1, durability: { current: 384, max: 384 },
      })
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

  it.effect('no-ops on identical slots, rejects when either side is incompatible, and otherwise swaps', () =>
    Effect.sync(() => {
      const withHelmet = equip(emptyEquipment(), 'head', helmet()).equipment
      expect(swapEquipment(withHelmet, 'head', 'head')).toBe(withHelmet)

      // secondItem (flint, offhand-only) is incompatible with 'head' -> rejected before the second clause
      const withHelmetAndFlint = equip(withHelmet, 'offhand', flint()).equipment
      expect(swapEquipment(withHelmetAndFlint, 'head', 'offhand')).toBe(withHelmetAndFlint)

      // target slot is empty, but firstItem (helmet, head-only) is incompatible with 'chest'
      expect(swapEquipment(withHelmet, 'head', 'chest')).toBe(withHelmet)

      // both slots empty -> swap succeeds, producing a new but structurally-equal equipment value
      const bothEmpty = emptyEquipment()
      const swapped = swapEquipment(bothEmpty, 'legs', 'feet')
      expect(swapped).not.toBe(bothEmpty)
      expect(swapped).toStrictEqual(bothEmpty)
    }),
  )

  it.effect('unequipping an empty slot returns the same equipment reference and a null result', () =>
    Effect.sync(() => {
      const initial = emptyEquipment()
      const outcome = unequip(initial, 'head')
      expect(outcome.result).toBeNull()
      expect(outcome.equipment).toBe(initial)
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

  it.effect('reports Empty for an empty slot and NotDamageable for a non-damageable item', () =>
    Effect.sync(() => {
      const empty = emptyEquipment()
      const emptyOutcome = damageEquipment(empty, 'head', 1)
      expect(emptyOutcome.result).toStrictEqual({ _tag: 'Empty' })
      expect(emptyOutcome.equipment).toBe(empty)

      // A durability-less item can only arise outside the validated equip() path; damageEquipment
      // is a pure function over Equipment and must handle it defensively regardless.
      const nonDamageable = {
        slots: { ...empty.slots, offhand: { ...itemStack('flint_and_steel', 1), durability: null } },
      }
      const nonDamageableOutcome = damageEquipment(nonDamageable, 'offhand', 1)
      expect(nonDamageableOutcome.result).toMatchObject({ _tag: 'NotDamageable' })
      expect(nonDamageableOutcome.equipment).toBe(nonDamageable)
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

  it.effect('rejects malformed top-level and slots shapes before inspecting any item', () =>
    Effect.sync(() => {
      expect(validateEquipmentSnapshot(null)._tag).toBe('Invalid')
      expect(validateEquipmentSnapshot('not an object')._tag).toBe('Invalid')
      expect(validateEquipmentSnapshot({ slots: emptyEquipment().slots, extra: true })._tag).toBe('Invalid')
      expect(
        validateEquipmentSnapshot({ slots: { head: null, chest: null, legs: null, feet: null } })._tag,
      ).toBe('Invalid')
      expect(validateEquipmentSnapshot({ slots: 'not an object' })._tag).toBe('Invalid')
    }),
  )

  it.effect('accepts a fully equipped snapshot across every slot', () =>
    Effect.sync(() => {
      const step1 = equip(emptyEquipment(), 'head', helmet()).equipment
      const step2 = equip(step1, 'chest', equipmentItem(itemStack('iron_chestplate', 1))).equipment
      const step3 = equip(step2, 'legs', equipmentItem(itemStack('iron_leggings', 1))).equipment
      const step4 = equip(step3, 'feet', equipmentItem(itemStack('iron_boots', 1))).equipment
      const fullyEquipped = equip(step4, 'offhand', flint()).equipment

      expect(validateEquipmentSnapshot(JSON.parse(JSON.stringify(fullyEquipped)))).toStrictEqual({
        _tag: 'Valid',
        equipment: fullyEquipped,
      })
    }),
  )
})
