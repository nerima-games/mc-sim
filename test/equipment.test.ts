import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  damageEquipment,
  durability,
  emptyEquipment,
  equip,
  equipmentItem,
  equippedAt,
  swapEquipment,
  unequip,
  validateEquipmentSnapshot,
  type EquipmentItem,
} from '../domain/equipment'
import { itemStack, type ItemStack } from '../domain/inventory'

const pickaxe = (current = 3): EquipmentItem =>
  equipmentItem(itemStack('wooden_pickaxe', 1), durability(current, 3))

const torch = (): EquipmentItem => equipmentItem(itemStack('torch', 1))

describe('equipment domain', () => {
  it.effect('starts with the five explicit equipment slots empty', () =>
    Effect.sync(() => {
      expect(emptyEquipment()).toStrictEqual({
        slots: { head: null, chest: null, legs: null, feet: null, offhand: null },
      })
    }),
  )

  it.effect('keeps equipment items structurally compatible with ItemStack', () =>
    Effect.sync(() => {
      const item = pickaxe()
      const acceptsItemStack = (stack: ItemStack): ItemStack => stack

      expect(acceptsItemStack(item)).toMatchObject({ item: 'wooden_pickaxe', count: 1 })
      expect(item.durability).toStrictEqual({ current: 3, max: 3 })
    }),
  )

  it.effect('does not impose an item-by-slot equipability whitelist', () =>
    Effect.sync(() => {
      const first = equip(emptyEquipment(), 'head', torch())
      const second = equip(first.equipment, 'offhand', pickaxe())

      expect(equippedAt(second.equipment, 'head')?.item).toBe('torch')
      expect(equippedAt(second.equipment, 'offhand')?.item).toBe('wooden_pickaxe')
    }),
  )

  it.effect('equips, replaces, unequips, and swaps without mutating prior state', () =>
    Effect.sync(() => {
      const initial = emptyEquipment()
      const withHead = equip(initial, 'head', torch())
      const replaced = equip(withHead.equipment, 'head', pickaxe())
      const withOffhand = equip(replaced.equipment, 'offhand', torch())
      const swapped = swapEquipment(withOffhand.equipment, 'head', 'offhand')
      const removed = unequip(swapped, 'offhand')

      expect(replaced.result?.item).toBe('torch')
      expect(equippedAt(swapped, 'head')?.item).toBe('torch')
      expect(equippedAt(swapped, 'offhand')?.item).toBe('wooden_pickaxe')
      expect(removed.result?.item).toBe('wooden_pickaxe')
      expect(equippedAt(removed.equipment, 'offhand')).toBeNull()
      expect(equippedAt(initial, 'head')).toBeNull()
      expect(equippedAt(withOffhand.equipment, 'head')?.item).toBe('wooden_pickaxe')
    }),
  )

  it.effect('applies damage and removes an item atomically when it breaks', () =>
    Effect.sync(() => {
      const equipped = equip(emptyEquipment(), 'offhand', pickaxe()).equipment
      const damaged = damageEquipment(equipped, 'offhand', 1)
      const broken = damageEquipment(damaged.equipment, 'offhand', 9)

      expect(damaged.result).toMatchObject({
        _tag: 'Damaged',
        applied: 1,
        item: { durability: { current: 2, max: 3 } },
      })
      expect(broken.result).toMatchObject({ _tag: 'Broken', applied: 2 })
      expect(equippedAt(broken.equipment, 'offhand')).toBeNull()
      expect(equippedAt(equipped, 'offhand')?.durability?.current).toBe(3)
    }),
  )

  it.effect('leaves state unchanged for invalid damage and non-damageable items', () =>
    Effect.sync(() => {
      const equipped = equip(emptyEquipment(), 'head', torch()).equipment
      const invalid = damageEquipment(equipped, 'head', 0)
      const notDamageable = damageEquipment(equipped, 'head', 1)

      expect(invalid.result).toStrictEqual({ _tag: 'InvalidAmount', amount: 0 })
      expect(invalid.equipment).toBe(equipped)
      expect(notDamageable.result._tag).toBe('NotDamageable')
      expect(notDamageable.equipment).toBe(equipped)
    }),
  )

  it.effect('rejects zero, excessive, and non-integral durability', () =>
    Effect.sync(() => {
      expect(() => durability(0, 3)).toThrow(RangeError)
      expect(() => durability(4, 3)).toThrow(RangeError)
      expect(() => durability(1.5, 3)).toThrow(RangeError)
      expect(() => durability(1, Number.POSITIVE_INFINITY)).toThrow(RangeError)
    }),
  )

  it.effect('strictly validates the persistence shape', () =>
    Effect.sync(() => {
      const valid = equip(emptyEquipment(), 'feet', pickaxe()).equipment
      expect(validateEquipmentSnapshot(JSON.parse(JSON.stringify(valid)))._tag).toBe('Valid')

      const malformed: ReadonlyArray<unknown> = [
        { slots: { ...valid.slots, feet: { item: 'wooden_pickaxe', count: 0, durability: null } } },
        { slots: { ...valid.slots, feet: { item: 'wooden_pickaxe', count: 1, durability: { current: 0, max: 3 } } } },
        { slots: { ...valid.slots, helmet: null } },
        { slots: valid.slots, extra: true },
      ]

      for (const snapshot of malformed) {
        expect(validateEquipmentSnapshot(snapshot)._tag).toBe('Invalid')
      }
    }),
  )
})
