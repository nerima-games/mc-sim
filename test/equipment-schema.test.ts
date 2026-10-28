import { expect, it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import {
  DurabilitySchema,
  emptyEquipment,
  EquipmentItemSchema,
  EquipmentSchema,
  EquipmentSlotsSchema,
  equipmentItem as equipmentItemResult,
} from '../src/domain/equipment.js'
import { itemStack as itemStackResult } from '../src/domain/inventory.js'

const equipmentItem = () => {
  const stack = itemStackResult('iron_boots', 1)
  if (Result.isFailure(stack)) throw stack.failure
  const item = equipmentItemResult(stack.success)
  if (Result.isFailure(item)) throw item.failure
  return item.success
}

const decodeEquipment = Schema.decodeUnknownResult(EquipmentSchema)
const decodeEquipmentSlots = Schema.decodeUnknownResult(EquipmentSlotsSchema)
const decodeEquipmentItem = Schema.decodeUnknownResult(EquipmentItemSchema)
const decodeDurability = Schema.decodeUnknownResult(DurabilitySchema)

it('requires every equipment and durability field and rejects null for required values', () => {
  const empty = emptyEquipment()
  expect(Result.isSuccess(decodeEquipment(empty))).toBe(true)
  expect(Result.isFailure(decodeEquipment({}))).toBe(true)
  expect(Result.isFailure(decodeEquipment({ slots: null }))).toBe(true)

  const { offhand: _offhand, ...missingOffhand } = empty.slots
  expect(Result.isFailure(decodeEquipmentSlots(missingOffhand))).toBe(true)
  expect(Result.isFailure(decodeEquipmentSlots({ ...empty.slots, offhand: undefined }))).toBe(true)

  expect(Result.isFailure(decodeDurability(null))).toBe(true)
  expect(Result.isFailure(decodeDurability({ max: 195 }))).toBe(true)
  expect(Result.isFailure(decodeDurability({ current: 195 }))).toBe(true)
  expect(Result.isFailure(decodeDurability({ current: null, max: 195 }))).toBe(true)
  expect(Result.isFailure(decodeDurability({ current: 195, max: null }))).toBe(true)
})

it('requires all equipment item fields while preserving the declared nullable durability', () => {
  const valid = equipmentItem()
  expect(Result.isSuccess(decodeEquipmentItem(valid))).toBe(true)
  expect(Result.isSuccess(decodeEquipmentItem({ ...valid, durability: null }))).toBe(true)

  for (const key of ['item', 'count', 'components', 'durability'] as const) {
    const missing = { ...valid }
    delete missing[key]
    expect(Result.isFailure(decodeEquipmentItem(missing))).toBe(true)
  }

  for (const value of [
    { ...valid, item: null },
    { ...valid, count: null },
    { ...valid, components: null },
  ]) {
    expect(Result.isFailure(decodeEquipmentItem(value))).toBe(true)
  }
})
