import type { ItemStack } from './inventory.js'
import { Brand, Result, Schema } from 'effect'
import type {
  DamageableItemType as KernelDamageableItemType,
  EquippableItemType as KernelEquippableItemType,
  ItemDurabilityDefinition as KernelItemDurabilityDefinition,
} from '@nerima-games/mc-kernel/domain/equipment'
import {
  EQUIPMENT_CATALOG as KERNEL_EQUIPMENT_CATALOG,
  ITEM_DURABILITY_CATALOG as KERNEL_ITEM_DURABILITY_CATALOG,
} from '@nerima-games/mc-kernel/domain/equipment'
import {
  ITEM_TYPES,
  MAX_STACK_COUNT,
  ItemDamage,
  MaxDamage,
  isItemComponents,
  isItemStack,
  type ItemType,
} from '@nerima-games/mc-kernel'
import { buildRuntimeEquipmentCatalog } from './equipment-catalog.js'

export const EQUIPMENT_SLOTS = ['head', 'chest', 'legs', 'feet', 'offhand'] as const

export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number]

export type EquipmentDefinition = {
  readonly slot: EquipmentSlot
}

export type ItemDurabilityDefinition = KernelItemDurabilityDefinition

export type EquippableItemType =
  | 'iron_helmet'
  | 'iron_chestplate'
  | 'iron_leggings'
  | 'iron_boots'
  | 'flint_and_steel'
  | 'shears'
  | 'wooden_pickaxe'
  | 'stone_pickaxe'
  | 'iron_pickaxe'
  | 'diamond_pickaxe'
  | 'wooden_hoe'
  | 'stone_hoe'
  | 'iron_hoe'
  | 'diamond_hoe'
  | 'wooden_sword'
  | 'stone_sword'
  | 'iron_sword'
  | 'diamond_sword'

const RUNTIME_EQUIPPABLE_ITEMS: ReadonlyArray<EquippableItemType> = [
  'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
  'flint_and_steel', 'shears', 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe',
  'wooden_hoe', 'stone_hoe', 'iron_hoe', 'diamond_hoe',
  'wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword',
] satisfies ReadonlyArray<KernelEquippableItemType>

export type DamageableItemType = KernelDamageableItemType

export function isEquipmentSlot(value: unknown): value is EquipmentSlot {
  return typeof value === 'string' && EQUIPMENT_SLOTS.some((slot) => slot === value)
}

/** Runtime slot choices are restricted to the sim's supported subset of the kernel catalog. */
export const EQUIPMENT_CATALOG: Readonly<Partial<Record<EquippableItemType, EquipmentDefinition>>> =
  buildRuntimeEquipmentCatalog(RUNTIME_EQUIPPABLE_ITEMS, KERNEL_EQUIPMENT_CATALOG, isEquipmentSlot)

/** Static durability values are owned by the kernel catalog. */
export const ITEM_DURABILITY_CATALOG: Readonly<Record<DamageableItemType, ItemDurabilityDefinition>> =
  KERNEL_ITEM_DURABILITY_CATALOG

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

export type ValidEquipmentItem = EquipmentItem & {
  readonly durability: Durability
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

export type DurabilityFailure = Brand.BrandError | EquipmentValidationError
export type EquipmentItemFailure = DurabilityFailure

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
  | { readonly _tag: 'EquipmentFailure'; readonly error: EquipmentItemFailure }
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

const PositiveSafeIntegerSchema = Schema.Int.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0),
)

export const DurabilitySchema: Schema.Codec<Durability> = Schema.Struct({
  current: PositiveSafeIntegerSchema,
  max: PositiveSafeIntegerSchema,
}).check(Schema.makeFilter(({ current, max }) => current <= max))

const StackCountSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_STACK_COUNT }))
  .pipe(Schema.brand('StackCount')) as Schema.Codec<ItemStack['count'], number>

const ItemComponentsSchema = Schema.declare(isItemComponents)

export const EquipmentItemSchema: Schema.Codec<EquipmentItem, unknown> = Schema.Struct({
  item: Schema.Literals(ITEM_TYPES),
  count: StackCountSchema,
  components: ItemComponentsSchema,
  durability: Schema.NullOr(DurabilitySchema),
}).check(Schema.makeFilter(({ item, count, components }) => isItemStack({ item, count, components })))

const equipmentItemForSlotSchema = (slot: EquipmentSlot): Schema.Codec<EquipmentItem, unknown> =>
  EquipmentItemSchema.check(Schema.makeFilter((item) =>
    item.durability !== null && isEquipmentItemForSlot(slot, item)))

export const EquipmentSlotsSchema: Schema.Codec<EquipmentSlots, unknown> = Schema.Struct({
  head: Schema.NullOr(equipmentItemForSlotSchema('head')),
  chest: Schema.NullOr(equipmentItemForSlotSchema('chest')),
  legs: Schema.NullOr(equipmentItemForSlotSchema('legs')),
  feet: Schema.NullOr(equipmentItemForSlotSchema('feet')),
  offhand: Schema.NullOr(equipmentItemForSlotSchema('offhand')),
})

export const EquipmentSchema: Schema.Codec<Equipment, unknown> = Schema.Struct({
  slots: EquipmentSlotsSchema,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const validPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export const isDurability = (value: unknown): value is Durability => {
  if (!isRecord(value) || !hasExactKeys(value, ['current', 'max'])) return false
  return (
    validPositiveSafeInteger(value['current']) &&
    validPositiveSafeInteger(value['max']) &&
    value['current'] <= value['max']
  )
}

const isEquipmentItemShape = (value: unknown): value is EquipmentItem => {
  if (!isRecord(value) || !hasExactKeys(value, ['item', 'count', 'components', 'durability'])) return false
  return isItemStack({ item: value['item'], count: value['count'], components: value['components'] }) &&
    value['count'] === 1 &&
    (value['durability'] === null || isDurability(value['durability']))
}

export const isEquipmentItem = (value: unknown): value is ValidEquipmentItem => {
  if (!isEquipmentItemShape(value)) return false
  const definition = itemDurabilityDefinitionFor(value['item'])
  return definition !== undefined && isDurability(value['durability']) &&
    value['durability'].max === definition.maxDurability
}

export function durabilityForItem(item: DamageableItemType): Durability
export function durabilityForItem(item: ItemType): Durability | null
export function durabilityForItem(item: ItemType): Durability | null {
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
): item is ValidEquipmentItem => equipmentDefinitionFor(item.item)?.slot === slot && isEquipmentItem(item)

export const durability = (current: number, max: number): Result.Result<Durability, DurabilityFailure> => {
  const currentResult = ItemDamage.result(current)
  if (Result.isFailure(currentResult)) return Result.fail(currentResult.failure)
  const maxResult = MaxDamage.result(max)
  if (Result.isFailure(maxResult)) return Result.fail(maxResult.failure)
  if (currentResult.success <= 0 || currentResult.success > maxResult.success) {
    return Result.fail({
      _tag: 'EquipmentValidationError',
      path: 'durability',
      reason: 'current must be positive and no greater than max',
    })
  }
  return Result.succeed({ current: currentResult.success, max: maxResult.success })
}

/** Add equipment state without changing the ItemStack fields consumed by inventory code. */
export const equipmentItem = (
  stack: ItemStack,
  itemDurability: Durability | null = durabilityForItem(stack.item),
): Result.Result<EquipmentItem, EquipmentItemFailure> => {
  const value: EquipmentItem = {
    ...stack,
    durability: itemDurability === null ? null : { ...itemDurability },
  }
  if (!isEquipmentItem(value)) {
    return Result.fail({
      _tag: 'EquipmentValidationError',
      path: 'item',
      reason: 'expected a damageable item stack with count 1 and exact durability',
    })
  }
  return Result.succeed(value)
}

const copyEquipmentItem = (item: ValidEquipmentItem): ValidEquipmentItem => ({
  ...item,
  durability: { ...item.durability },
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
  if (!isEquipmentSlot(slot)) return { equipment, result: null }
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

  const nextDurability = durability(item.durability.current - applied, item.durability.max)
  if (Result.isFailure(nextDurability)) {
    return { equipment, result: { _tag: 'EquipmentFailure', error: nextDurability.failure } }
  }
  const damaged: EquipmentItem = { ...item, durability: nextDurability.success }
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

  const validatedSlots: Record<EquipmentSlot, ValidEquipmentItem | null> = {
    head: null, chest: null, legs: null, feet: null, offhand: null,
  }
  for (const slot of EQUIPMENT_SLOTS) {
    const item = slots[slot]
    if (item === null) {
      validatedSlots[slot] = null
      continue
    }
    if (!isEquipmentItem(item) || !isEquipmentItemForSlot(slot, item)) {
      return invalid(
        `equipment.slots.${slot}`,
        'expected null or the slot-compatible item with count 1 and exact durability',
      )
    }
    validatedSlots[slot] = copyEquipmentItem(item)
  }

  return {
    _tag: 'Valid',
    equipment: {
      slots: validatedSlots,
    },
  }
}
