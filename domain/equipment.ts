import type { ItemStack } from './inventory'
import { isItemType, MAX_STACK_COUNT, type ItemType } from './kernel-vocabulary'

export const EQUIPMENT_SLOTS = ['head', 'chest', 'legs', 'feet', 'offhand'] as const

export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number]

export type EquipmentDefinition = {
  readonly slot: EquipmentSlot
}

export type ItemDurabilityDefinition = {
  readonly maxDurability: number
}

/** The single source of truth for item/slot compatibility. */
export const EQUIPMENT_CATALOG = {
  iron_helmet: { slot: 'head' },
  iron_chestplate: { slot: 'chest' },
  iron_leggings: { slot: 'legs' },
  iron_boots: { slot: 'feet' },
  flint_and_steel: { slot: 'offhand' },
  wooden_pickaxe: { slot: 'offhand' },
  stone_pickaxe: { slot: 'offhand' },
  iron_pickaxe: { slot: 'offhand' },
  diamond_pickaxe: { slot: 'offhand' },
  wooden_hoe: { slot: 'offhand' },
  stone_hoe: { slot: 'offhand' },
  iron_hoe: { slot: 'offhand' },
  diamond_hoe: { slot: 'offhand' },
  wooden_sword: { slot: 'offhand' },
  stone_sword: { slot: 'offhand' },
  iron_sword: { slot: 'offhand' },
  diamond_sword: { slot: 'offhand' },
} as const satisfies Partial<Record<ItemType, EquipmentDefinition>>

/** The single source of truth for per-item durability, independent of equipment slots. */
export const ITEM_DURABILITY_CATALOG = {
  iron_helmet: { maxDurability: 165 },
  iron_chestplate: { maxDurability: 240 },
  iron_leggings: { maxDurability: 225 },
  iron_boots: { maxDurability: 195 },
  flint_and_steel: { maxDurability: 64 },
  wooden_pickaxe: { maxDurability: 59 },
  stone_pickaxe: { maxDurability: 131 },
  iron_pickaxe: { maxDurability: 250 },
  diamond_pickaxe: { maxDurability: 1561 },
  wooden_hoe: { maxDurability: 59 },
  stone_hoe: { maxDurability: 131 },
  iron_hoe: { maxDurability: 250 },
  diamond_hoe: { maxDurability: 1561 },
  wooden_sword: { maxDurability: 59 },
  stone_sword: { maxDurability: 131 },
  iron_sword: { maxDurability: 250 },
  diamond_sword: { maxDurability: 1561 },
  bow: { maxDurability: 384 },
} as const satisfies Partial<Record<ItemType, ItemDurabilityDefinition>>

export type EquippableItemType = keyof typeof EQUIPMENT_CATALOG
export type DamageableItemType = keyof typeof ITEM_DURABILITY_CATALOG

export const isEquippableItemType = (item: ItemType): item is EquippableItemType =>
  Object.hasOwn(EQUIPMENT_CATALOG, item)

export const equipmentDefinitionFor = (item: ItemType): EquipmentDefinition | undefined =>
  isEquippableItemType(item) ? EQUIPMENT_CATALOG[item] : undefined

export const isDamageableItemType = (item: ItemType): item is DamageableItemType =>
  Object.hasOwn(ITEM_DURABILITY_CATALOG, item)

export const itemDurabilityDefinitionFor = (item: ItemType): ItemDurabilityDefinition | undefined =>
  isDamageableItemType(item) ? ITEM_DURABILITY_CATALOG[item] : undefined

export type Durability = {
  readonly current: number
  readonly max: number
}

/** An inventory-compatible stack with optional per-item durability state. */
export type EquipmentItem = ItemStack & {
  readonly durability: Durability | null
}

export type EquipmentSlots = Readonly<Record<EquipmentSlot, EquipmentItem | null>>

export type Equipment = {
  readonly slots: EquipmentSlots
}

export type EquipmentValidationError = {
  readonly _tag: 'EquipmentValidationError'
  readonly path: string
  readonly reason: string
}

export type EquipmentValidationResult =
  | { readonly _tag: 'Valid'; readonly equipment: Equipment }
  | { readonly _tag: 'Invalid'; readonly error: EquipmentValidationError }

export type EquipmentOutcome<A> = {
  readonly equipment: Equipment
  readonly result: A
}

export type DamageEquipmentResult =
  | { readonly _tag: 'InvalidAmount'; readonly amount: number }
  | { readonly _tag: 'Empty' }
  | { readonly _tag: 'NotDamageable'; readonly item: EquipmentItem }
  | {
      readonly _tag: 'Damaged'
      readonly item: EquipmentItem
      readonly applied: number
    }
  | {
      readonly _tag: 'Broken'
      readonly item: EquipmentItem
      readonly applied: number
    }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const validPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export const isEquipmentSlot = (value: unknown): value is EquipmentSlot =>
  typeof value === 'string' && EQUIPMENT_SLOTS.some((slot) => slot === value)

export const isDurability = (value: unknown): value is Durability => {
  if (!isRecord(value) || !hasExactKeys(value, ['current', 'max'])) return false
  return (
    validPositiveSafeInteger(value['current']) &&
    validPositiveSafeInteger(value['max']) &&
    value['current'] <= value['max']
  )
}

const isEquipmentItemShape = (value: unknown): value is EquipmentItem => {
  if (!isRecord(value) || !hasExactKeys(value, ['item', 'count', 'durability'])) return false
  return typeof value['item'] === 'string' && isItemType(value['item']) &&
    validPositiveSafeInteger(value['count']) && value['count'] <= MAX_STACK_COUNT &&
    (value['durability'] === null || isDurability(value['durability']))
}

export const isEquipmentItem = (value: unknown): value is EquipmentItem => {
  if (!isEquipmentItemShape(value)) return false
  const definition = itemDurabilityDefinitionFor(value['item'])
  return definition !== undefined && value['count'] === 1 && isDurability(value['durability']) &&
    value['durability'].max === definition.maxDurability
}

export const durabilityForItem = (item: ItemType): Durability | null => {
  const definition = itemDurabilityDefinitionFor(item)
  return definition === undefined
    ? null
    : { current: definition.maxDurability, max: definition.maxDurability }
}

export const isValidDurabilityForItem = (
  item: ItemType,
  value: unknown,
): value is Durability => {
  const definition = itemDurabilityDefinitionFor(item)
  return definition !== undefined && isDurability(value) && value.max === definition.maxDurability
}

export const isEquipmentItemForSlot = (
  slot: EquipmentSlot,
  item: EquipmentItem,
): boolean => equipmentDefinitionFor(item.item)?.slot === slot && isEquipmentItem(item)

export const durability = (current: number, max: number): Durability => {
  const value: Durability = { current, max }
  if (!isDurability(value)) {
    throw new RangeError('Durability requires positive safe integers with current <= max')
  }
  return value
}

/** Add equipment state without changing the ItemStack fields consumed by inventory code. */
export const equipmentItem = (
  stack: ItemStack,
  itemDurability: Durability | null = durabilityForItem(stack.item),
): EquipmentItem => {
  const value: EquipmentItem = {
    ...stack,
    durability: itemDurability === null ? null : { ...itemDurability },
  }
  if (!isEquipmentItem(value)) throw new RangeError('Invalid equipment item')
  return value
}

const copyEquipmentItem = (item: EquipmentItem): EquipmentItem => ({
  ...item,
  durability: item.durability === null ? null : { ...item.durability },
})

export const emptyEquipment = (): Equipment => ({
  slots: {
    head: null,
    chest: null,
    legs: null,
    feet: null,
    offhand: null,
  },
})

export const equippedAt = (equipment: Equipment, slot: EquipmentSlot): EquipmentItem | null =>
  equipment.slots[slot]

export const equip = (
  equipment: Equipment,
  slot: EquipmentSlot,
  item: EquipmentItem,
): EquipmentOutcome<EquipmentItem | null> =>
  isEquipmentItemForSlot(slot, item)
    ? {
        equipment: { slots: { ...equipment.slots, [slot]: copyEquipmentItem(item) } },
        result: equipment.slots[slot],
      }
    : { equipment, result: item }

export const unequip = (
  equipment: Equipment,
  slot: EquipmentSlot,
): EquipmentOutcome<EquipmentItem | null> => {
  const item = equipment.slots[slot]
  if (item === null) return { equipment, result: null }
  return {
    equipment: { slots: { ...equipment.slots, [slot]: null } },
    result: item,
  }
}

export const swapEquipment = (
  equipment: Equipment,
  first: EquipmentSlot,
  second: EquipmentSlot,
): Equipment => {
  if (first === second) return equipment
  const firstItem = equipment.slots[first]
  const secondItem = equipment.slots[second]
  if ((secondItem !== null && !isEquipmentItemForSlot(first, secondItem)) ||
      (firstItem !== null && !isEquipmentItemForSlot(second, firstItem))) return equipment
  return {
    slots: {
      ...equipment.slots,
      [first]: equipment.slots[second],
      [second]: equipment.slots[first],
    },
  }
}

export const damageEquipment = (
  equipment: Equipment,
  slot: EquipmentSlot,
  amount: number,
): EquipmentOutcome<DamageEquipmentResult> => {
  if (!validPositiveSafeInteger(amount)) {
    return { equipment, result: { _tag: 'InvalidAmount', amount } }
  }

  const item = equipment.slots[slot]
  if (item === null) return { equipment, result: { _tag: 'Empty' } }
  if (item.durability === null) {
    return { equipment, result: { _tag: 'NotDamageable', item } }
  }

  const applied = Math.min(amount, item.durability.current)
  if (applied === item.durability.current) {
    return {
      equipment: { slots: { ...equipment.slots, [slot]: null } },
      result: { _tag: 'Broken', item, applied },
    }
  }

  const damaged: EquipmentItem = {
    ...item,
    durability: {
      current: item.durability.current - applied,
      max: item.durability.max,
    },
  }
  return {
    equipment: { slots: { ...equipment.slots, [slot]: damaged } },
    result: { _tag: 'Damaged', item: damaged, applied },
  }
}

const invalid = (path: string, reason: string): EquipmentValidationResult => ({
  _tag: 'Invalid',
  error: { _tag: 'EquipmentValidationError', path, reason },
})

/** Validate the exact persistence shape before any saved state reaches the Ref. */
export const validateEquipmentSnapshot = (value: unknown): EquipmentValidationResult => {
  if (!isRecord(value) || !hasExactKeys(value, ['slots'])) {
    return invalid('equipment', 'expected an object containing only slots')
  }
  const slots = value['slots']
  if (!isRecord(slots) || !hasExactKeys(slots, EQUIPMENT_SLOTS)) {
    return invalid('equipment.slots', 'expected exactly head, chest, legs, feet, and offhand')
  }

  for (const slot of EQUIPMENT_SLOTS) {
    const item = slots[slot]
    if (item !== null && (!isEquipmentItem(item) || !isEquipmentItemForSlot(slot, item))) {
      return invalid(
        `equipment.slots.${slot}`,
        'expected null or the slot-compatible item with count 1 and exact durability',
      )
    }
  }

  const validatedSlots = slots as EquipmentSlots

  return {
    _tag: 'Valid',
    equipment: {
      slots: {
        head: validatedSlots.head === null ? null : copyEquipmentItem(validatedSlots.head),
        chest: validatedSlots.chest === null ? null : copyEquipmentItem(validatedSlots.chest),
        legs: validatedSlots.legs === null ? null : copyEquipmentItem(validatedSlots.legs),
        feet: validatedSlots.feet === null ? null : copyEquipmentItem(validatedSlots.feet),
        offhand:
          validatedSlots.offhand === null ? null : copyEquipmentItem(validatedSlots.offhand),
      },
    },
  }
}
