import * as Eq from './equipment.js'
import * as Inv from './inventory.js'
import { itemStackWithCount } from './item-stack.js'
import { Result } from 'effect'
import { isItemStack, isItemType, itemStackEqualsIgnoringCount, itemStacksCanMerge, maxStackCountForStack } from '@nerima-games/mc-kernel'
import type { ContainerStoredStack } from './container-storage.js'

export const FLINT_AND_STEEL_MAX_DURABILITY: number =
  Eq.ITEM_DURABILITY_CATALOG.flint_and_steel.maxDurability

export type PlayerStorage = {
  readonly inventory: Inv.Inventory
  readonly equipment: Eq.Equipment
  readonly inventoryDurability: ReadonlyArray<Eq.Durability | null>
}

export type StorageLocation =
  | { readonly _tag: 'Inventory'; readonly slotIndex: number }
  | { readonly _tag: 'Equipment'; readonly slot: Eq.EquipmentSlot }

export type PlayerStorageValidationError = {
  readonly _tag: 'PlayerStorageValidationError'
  readonly path: string
  readonly reason: string
}

export type PlayerStorageValidationResult =
  | { readonly _tag: 'Valid'; readonly storage: PlayerStorage }
  | { readonly _tag: 'Invalid'; readonly error: PlayerStorageValidationError }
  | { readonly _tag: 'ItemStackFailure'; readonly error: Inv.ItemStackFailure }

export type AddStoredStackResult =
  | {
      readonly _tag: 'Added'
      /** Number inserted; zero means that the inventory had no compatible capacity. */
      readonly added: number
      /** Null after a full insert, otherwise the exact stack still available for pickup. */
      readonly leftover: ContainerStoredStack | null
    }
  | { readonly _tag: 'InvalidStack' }
  | { readonly _tag: 'ItemStackFailure'; readonly error: Inv.ItemStackFailure }

export type EquipFromInventoryResult =
  | { readonly _tag: 'Equipped'; readonly item: Eq.EquipmentItem }
  | { readonly _tag: 'EquipmentFailure'; readonly error: Eq.EquipmentItemFailure }
  | { readonly _tag: 'InvalidDurability'; readonly item: Inv.ItemStack }
  | { readonly _tag: 'InvalidInventorySlot' }
  | { readonly _tag: 'InvalidEquipmentSlot' }
  | { readonly _tag: 'Empty' }
  | { readonly _tag: 'Occupied'; readonly item: Eq.EquipmentItem }
  | { readonly _tag: 'Incompatible'; readonly item: Inv.ItemStack }

export type UnequipToInventoryResult =
  | { readonly _tag: 'Unequipped'; readonly item: Eq.EquipmentItem; readonly slotIndex: number }
  | { readonly _tag: 'InvalidEquipmentSlot' }
  | { readonly _tag: 'InvalidInventorySlot' }
  | { readonly _tag: 'Empty' }
  | { readonly _tag: 'OccupiedInventorySlot' }
  | { readonly _tag: 'InventoryFull' }
  | { readonly _tag: 'ItemStackFailure'; readonly error: Inv.ItemStackFailure }

export type DamageAtResult =
  | Eq.DamageEquipmentResult
  | { readonly _tag: 'InvalidLocation' }
  | { readonly _tag: 'InvalidDurability'; readonly item: Inv.ItemStack }

export type ConsumeAndDamageAtRequest = {
  readonly consume: {
    readonly item: Inv.ItemStack['item']
    readonly count: number
  }
  readonly damage: {
    readonly location: StorageLocation
    readonly expectedItem: Inv.ItemStack['item']
    readonly amount: number
  }
}

export type AppliedDamageResult = Extract<
  Eq.DamageEquipmentResult,
  { readonly _tag: 'Damaged' | 'Broken' }
>

export type ConsumeAndDamageAtResult =
  | {
      readonly _tag: 'Applied'
      readonly consumed: number
      readonly damage: AppliedDamageResult
    }
  | { readonly _tag: 'InvalidConsumableCount'; readonly count: number }
  | { readonly _tag: 'InvalidDamageAmount'; readonly amount: number }
  | { readonly _tag: 'InvalidLocation' }
  | {
      readonly _tag: 'DamageTargetMismatch'
      readonly actualItem: Inv.ItemStack['item'] | null
    }
  | { readonly _tag: 'NotDamageable'; readonly item: Inv.ItemStack }
  | { readonly _tag: 'InvalidDurability'; readonly item: Inv.ItemStack }
  | { readonly _tag: 'EquipmentFailure'; readonly error: Eq.EquipmentItemFailure }
  | { readonly _tag: 'StorageFailure'; readonly error: PlayerStorageFailure }
  | { readonly _tag: 'DamageRejected'; readonly damage: Exclude<DamageAtResult, AppliedDamageResult> }
  | { readonly _tag: 'InsufficientConsumable'; readonly available: number }
  | { readonly _tag: 'ItemStackFailure'; readonly error: Inv.ItemStackFailure }

export type StorageOutcome<A> = { readonly storage: PlayerStorage; readonly result: A }

export type InvalidInventoryDurability = {
  readonly _tag: 'InvalidInventoryDurability'
  readonly slotIndex: number
  readonly item: Inv.ItemStack['item']
}

export type PlayerStorageFailure = Eq.EquipmentItemFailure | InvalidInventoryDurability

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const copyDurability = (value: Eq.Durability | null): Eq.Durability | null =>
  value === null ? null : { ...value }

const sameDurability = (
  left: Eq.Durability | null | undefined,
  right: Eq.Durability | null,
): boolean => left === null
  ? right === null
  : right !== null && left !== undefined && left.current === right.current && left.max === right.max

const isValidStoredStack = (value: unknown): value is ContainerStoredStack => {
  if (!isRecord(value) || !hasExactKeys(value, ['item', 'count', 'components', 'durability'])) return false
  const durability = value['durability']
  const candidate = { item: value['item'], count: value['count'], components: value['components'] }
  if (!isItemStack(candidate) || !isItemType(candidate.item)) return false
  return Eq.isDamageableItemType(candidate.item)
    ? candidate.count === 1 && Eq.isValidDurabilityForItem(candidate.item, durability)
    : durability === null
}

export const emptyPlayerStorage = (): PlayerStorage => ({
  inventory: Inv.emptyInventory(),
  equipment: Eq.emptyEquipment(),
  inventoryDurability: Array.from({ length: Inv.INVENTORY_SLOT_COUNT }, () => null),
})

export const storageFromInventory = (inventory: Inv.Inventory): PlayerStorage => ({
  inventory,
  equipment: Eq.emptyEquipment(),
  inventoryDurability: inventory.slots.map((slot) =>
    slot === undefined ? null : Eq.durabilityForItem(slot.item),
  ),
})

/** Preserve durability for unchanged slots and initialise newly inserted tools. */
export const withInventory = (
  storage: PlayerStorage,
  inventory: Inv.Inventory,
): Result.Result<PlayerStorage, PlayerStorageFailure> => {
  const durabilityResults = inventory.slots.map((slot, index) => {
    if (slot === undefined) return Result.succeed(null)
    const previous = storage.inventory.slots[index]
    const previousDurability = storage.inventoryDurability[index]
    if (previous !== undefined && itemStackEqualsIgnoringCount(previous, slot)) {
      if (Eq.isDamageableItemType(slot.item)) {
        return Eq.isValidDurabilityForItem(slot.item, previousDurability)
          ? Result.succeed(copyDurability(previousDurability))
          : Result.fail<InvalidInventoryDurability>({
              _tag: 'InvalidInventoryDurability', slotIndex: index, item: slot.item,
            })
      }
      return previousDurability === null
        ? Result.succeed(null)
        : Result.fail<InvalidInventoryDurability>({
            _tag: 'InvalidInventoryDurability', slotIndex: index, item: slot.item,
          })
    }
    return Result.succeed(Eq.durabilityForItem(slot.item))
  })
  return Result.map(Result.all(durabilityResults), (inventoryDurability) => ({
    ...storage,
    inventory,
    inventoryDurability,
  }))
}

/** Insert one validated stack while preserving its exact durability. */
export const addStoredStack = (
  storage: PlayerStorage,
  stack: ContainerStoredStack,
): StorageOutcome<AddStoredStackResult> => {
  if (!isValidStoredStack(stack)) return { storage, result: { _tag: 'InvalidStack' } }

  const slots = [...storage.inventory.slots]
  const inventoryDurability = [...storage.inventoryDurability]
  const maxStackCount = maxStackCountForStack(stack)
  let remaining: number = stack.count

  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    const slot = slots[index]
    if (slot === undefined || !itemStacksCanMerge(slot, {
      item: stack.item, count: stack.count, components: stack.components,
    }) ||
        !sameDurability(inventoryDurability[index], stack.durability) ||
        !Number.isSafeInteger(slot.count) || slot.count <= 0 || slot.count >= maxStackCount) continue
    const accepted = Math.min(maxStackCount - slot.count, remaining)
    const updated = itemStackWithCount(slot, slot.count + accepted)
    if (Result.isFailure(updated))
      return { storage, result: { _tag: 'ItemStackFailure', error: updated.failure } }
    slots[index] = updated.success
    inventoryDurability[index] = copyDurability(stack.durability)
    remaining -= accepted
  }

  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    if (slots[index] !== undefined) continue
    const accepted = Math.min(maxStackCount, remaining)
    const added = Inv.itemStack(stack.item, accepted, { components: stack.components })
    if (Result.isFailure(added))
      return { storage, result: { _tag: 'ItemStackFailure', error: added.failure } }
    slots[index] = added.success
    inventoryDurability[index] = copyDurability(stack.durability)
    remaining -= accepted
  }

  const added = stack.count - remaining
  let leftover: ContainerStoredStack | null = null
  if (remaining > 0) {
    const leftoverResult = Inv.itemStack(stack.item, remaining, { components: stack.components })
    if (Result.isFailure(leftoverResult))
      return { storage, result: { _tag: 'ItemStackFailure', error: leftoverResult.failure } }
    leftover = { ...leftoverResult.success, durability: copyDurability(stack.durability) }
  }
  return {
    storage: added === 0
      ? storage
      : { ...storage, inventory: { slots }, inventoryDurability },
    result: { _tag: 'Added', added, leftover },
  }
}

export const equipFromInventory = (
  storage: PlayerStorage,
  inventorySlot: number,
  equipmentSlot: Eq.EquipmentSlot,
): StorageOutcome<EquipFromInventoryResult> => {
  if (!Number.isInteger(inventorySlot) || inventorySlot < 0 || inventorySlot >= Inv.INVENTORY_SLOT_COUNT)
    return { storage, result: { _tag: 'InvalidInventorySlot' } }
  if (!Eq.isEquipmentSlot(equipmentSlot))
    return { storage, result: { _tag: 'InvalidEquipmentSlot' } }
  const stack = storage.inventory.slots[inventorySlot]
  if (stack === undefined) return { storage, result: { _tag: 'Empty' } }
  const definition = Eq.equipmentDefinitionFor(stack.item)
  if (definition?.slot !== equipmentSlot || stack.count !== 1 || !Eq.isDamageableItemType(stack.item))
    return { storage, result: { _tag: 'Incompatible', item: stack } }
  const occupied = storage.equipment.slots[equipmentSlot]
  if (occupied !== null) return { storage, result: { _tag: 'Occupied', item: occupied } }

  const storedDurability = storage.inventoryDurability[inventorySlot]
  if (!Eq.isValidDurabilityForItem(stack.item, storedDurability)) {
    return { storage, result: { _tag: 'InvalidDurability', item: stack } }
  }
  const item = Eq.equipmentItem(stack, storedDurability)
  if (Result.isFailure(item)) {
    return { storage, result: { _tag: 'EquipmentFailure', error: item.failure } }
  }
  const slots = [...storage.inventory.slots]
  slots[inventorySlot] = undefined
  const inventoryDurability = [...storage.inventoryDurability]
  inventoryDurability[inventorySlot] = null
  return {
    storage: {
      inventory: { slots },
      equipment: Eq.equip(storage.equipment, equipmentSlot, item.success).equipment,
      inventoryDurability,
    },
    result: { _tag: 'Equipped', item: item.success },
  }
}

export const unequipToInventory = (
  storage: PlayerStorage,
  equipmentSlot: Eq.EquipmentSlot,
  requestedSlot?: number,
): StorageOutcome<UnequipToInventoryResult> => {
  if (!Eq.isEquipmentSlot(equipmentSlot))
    return { storage, result: { _tag: 'InvalidEquipmentSlot' } }
  const item = storage.equipment.slots[equipmentSlot]
  if (item === null) return { storage, result: { _tag: 'Empty' } }
  if (requestedSlot !== undefined &&
      (!Number.isInteger(requestedSlot) || requestedSlot < 0 || requestedSlot >= Inv.INVENTORY_SLOT_COUNT))
    return { storage, result: { _tag: 'InvalidInventorySlot' } }
  const slotIndex = requestedSlot ?? storage.inventory.slots.findIndex((slot) => slot === undefined)
  if (slotIndex < 0) return { storage, result: { _tag: 'InventoryFull' } }
  if (storage.inventory.slots[slotIndex] !== undefined)
    return { storage, result: { _tag: 'OccupiedInventorySlot' } }

  const slots = [...storage.inventory.slots]
  const stack = Inv.itemStack(item.item, item.count, { components: item.components })
  if (Result.isFailure(stack)) return { storage, result: { _tag: 'ItemStackFailure', error: stack.failure } }
  slots[slotIndex] = stack.success
  const inventoryDurability = [...storage.inventoryDurability]
  inventoryDurability[slotIndex] = copyDurability(item.durability)
  const nextStorage = {
    inventory: { slots }, equipment: Eq.unequip(storage.equipment, equipmentSlot).equipment, inventoryDurability,
  }
  const result: UnequipToInventoryResult = { _tag: 'Unequipped', item, slotIndex }
  return { storage: nextStorage, result }
}

export const damageAt = (
  storage: PlayerStorage,
  location: StorageLocation,
  amount: number,
): StorageOutcome<DamageAtResult> => {
  if (!Number.isSafeInteger(amount) || amount <= 0)
    return { storage, result: { _tag: 'InvalidAmount', amount } }
  if (!isRecord(location)) return { storage, result: { _tag: 'InvalidLocation' } }
  if (location._tag === 'Equipment' && Eq.isEquipmentSlot(location.slot)) {
    const outcome = Eq.damageEquipment(storage.equipment, location.slot, amount)
    return outcome.equipment === storage.equipment
      ? { storage, result: outcome.result }
      : { storage: { ...storage, equipment: outcome.equipment }, result: outcome.result }
  }
  if (location._tag !== 'Inventory' || !Number.isInteger(location.slotIndex) ||
      location.slotIndex < 0 || location.slotIndex >= Inv.INVENTORY_SLOT_COUNT)
    return { storage, result: { _tag: 'InvalidLocation' } }
  const item = storage.inventory.slots[location.slotIndex]
  if (item === undefined) return { storage, result: { _tag: 'Empty' } }
  const durability = storage.inventoryDurability[location.slotIndex]
  if (!Eq.isDamageableItemType(item.item)) {
    return { storage, result: { _tag: 'NotDamageable', item: { ...item, durability: null } } }
  }
  if (!Eq.isValidDurabilityForItem(item.item, durability)) {
    return { storage, result: { _tag: 'InvalidDurability', item } }
  }
  const applied = Math.min(amount, durability.current)
  const equippedItem = Eq.equipmentItem(item, durability)
  if (Result.isFailure(equippedItem)) {
    return { storage, result: { _tag: 'EquipmentFailure', error: equippedItem.failure } }
  }
  const slots = [...storage.inventory.slots]
  const inventoryDurability = [...storage.inventoryDurability]
  if (applied === durability.current) {
    slots[location.slotIndex] = undefined
    inventoryDurability[location.slotIndex] = null
    return {
      storage: { ...storage, inventory: { slots }, inventoryDurability },
      result: { _tag: 'Broken', item: equippedItem.success, applied },
    }
  }
  const damaged = Eq.durability(durability.current - applied, durability.max)
  if (Result.isFailure(damaged)) {
    return { storage, result: { _tag: 'EquipmentFailure', error: damaged.failure } }
  }
  const damagedItem = Eq.equipmentItem(item, damaged.success)
  if (Result.isFailure(damagedItem)) {
    return { storage, result: { _tag: 'EquipmentFailure', error: damagedItem.failure } }
  }
  inventoryDurability[location.slotIndex] = damaged.success
  return {
    storage: { ...storage, inventoryDurability },
    result: { _tag: 'Damaged', item: damagedItem.success, applied },
  }
}

const itemAtLocation = (
  storage: PlayerStorage,
  location: StorageLocation,
): Inv.ItemStack | null | undefined => {
  if (!isRecord(location)) return undefined
  if (location._tag === 'Equipment') {
    if (!Eq.isEquipmentSlot(location.slot)) return undefined
    return storage.equipment.slots[location.slot]
  }
  if (location._tag !== 'Inventory' || !Number.isInteger(location.slotIndex) ||
      location.slotIndex < 0 || location.slotIndex >= Inv.INVENTORY_SLOT_COUNT)
    return undefined
  return storage.inventory.slots[location.slotIndex] ?? null
}

const targetDurabilityAt = (
  storage: PlayerStorage, location: StorageLocation,
): Eq.Durability | null | undefined =>
  location._tag === 'Inventory'
    ? storage.inventoryDurability[location.slotIndex]
    : storage.equipment.slots[location.slot]?.durability

type ConsumablePlan = { readonly available: number; readonly excludedSlot: number }

/**
 * The slot excluded from the consumable count is the damage target itself,
 * when it is also the item being consumed — damaging a tool must not also
 * count it against its own consumption requirement.
 */
const planConsumable = (storage: PlayerStorage, request: ConsumeAndDamageAtRequest): ConsumablePlan => {
  const excludedSlot = request.damage.location._tag === 'Inventory' &&
      request.consume.item === request.damage.expectedItem
    ? request.damage.location.slotIndex
    : -1
  const available = storage.inventory.slots.reduce(
    (total, slot, index) => index !== excludedSlot && slot?.item === request.consume.item
      ? total + slot.count
      : total,
    0,
  )
  return { available, excludedSlot }
}

const consumeItems = (
  inventory: Inv.Inventory, item: Inv.ItemStack['item'], count: number, excludedSlot: number,
): Result.Result<Inv.Inventory, Inv.ItemStackFailure> => {
  let result = inventory
  let remaining = count
  for (let index = 0; index < result.slots.length && remaining > 0; index += 1) {
    const slot = result.slots[index]
    if (index === excludedSlot || slot?.item !== item) continue
    const removeCount = Math.min(slot.count, remaining)
    const outcome = Inv.removeItemAt(result, index, item, removeCount)
    if (Result.isFailure(outcome)) return Result.fail(outcome.failure)
    result = outcome.success.inventory
    remaining -= removeCount
  }
  return Result.succeed(result)
}

/** Validate, consume, and damage as one all-or-nothing storage transition. */
export const consumeAndDamageAt = (
  storage: PlayerStorage,
  request: ConsumeAndDamageAtRequest,
): StorageOutcome<ConsumeAndDamageAtResult> => {
  if (!Number.isSafeInteger(request.consume.count) || request.consume.count <= 0) {
    return {
      storage,
      result: { _tag: 'InvalidConsumableCount', count: request.consume.count },
    }
  }
  if (!Number.isSafeInteger(request.damage.amount) || request.damage.amount <= 0) {
    return { storage, result: { _tag: 'InvalidDamageAmount', amount: request.damage.amount } }
  }

  const target = itemAtLocation(storage, request.damage.location)
  if (target === undefined) return { storage, result: { _tag: 'InvalidLocation' } }
  if (target?.item !== request.damage.expectedItem) {
    return {
      storage,
      result: { _tag: 'DamageTargetMismatch', actualItem: target?.item ?? null },
    }
  }

  const targetDurability = targetDurabilityAt(storage, request.damage.location)
  if (!Eq.isDamageableItemType(target.item)) {
    return { storage, result: { _tag: 'NotDamageable', item: target } }
  }
  if (!Eq.isValidDurabilityForItem(target.item, targetDurability)) {
    return { storage, result: { _tag: 'InvalidDurability', item: target } }
  }

  const { available, excludedSlot } = planConsumable(storage, request)
  if (available < request.consume.count) {
    return { storage, result: { _tag: 'InsufficientConsumable', available } }
  }

  const inventoryResult = consumeItems(
    storage.inventory,
    request.consume.item,
    request.consume.count,
    excludedSlot,
  )
  if (Result.isFailure(inventoryResult)) {
    return { storage, result: { _tag: 'ItemStackFailure', error: inventoryResult.failure } }
  }

  const updatedInventory = withInventory(storage, inventoryResult.success)
  if (Result.isFailure(updatedInventory)) {
    return { storage, result: { _tag: 'StorageFailure', error: updatedInventory.failure } }
  }
  const damaged = damageAt(updatedInventory.success, request.damage.location, request.damage.amount)
  if (damaged.result._tag !== 'Damaged' && damaged.result._tag !== 'Broken') {
    if (damaged.result._tag === 'EquipmentFailure' || damaged.result._tag === 'InvalidDurability') {
      return { storage, result: damaged.result }
    }
    return { storage, result: { _tag: 'DamageRejected', damage: damaged.result } }
  }
  const appliedDamage: AppliedDamageResult = damaged.result
  return {
    storage: damaged.storage,
    result: {
      _tag: 'Applied',
      consumed: request.consume.count,
      damage: appliedDamage,
    },
  }
}

const invalidError = (path: string, reason: string): PlayerStorageValidationError => ({
  _tag: 'PlayerStorageValidationError', path, reason,
})
const invalid = (path: string, reason: string): PlayerStorageValidationResult => ({
  _tag: 'Invalid', error: invalidError(path, reason),
})

type InventorySlotEntryValidation =
  | { readonly _tag: 'Invalid'; readonly error: PlayerStorageValidationError }
  | { readonly _tag: 'Slot'; readonly slot: Inv.Slot; readonly durability: Eq.Durability | null }
  | { readonly _tag: 'ItemStackFailure'; readonly error: Inv.ItemStackFailure }

const validateInventorySlotEntry = (
  slot: unknown, durability: unknown, index: number,
): InventorySlotEntryValidation => {
  if (slot === null || slot === undefined) {
    if (durability !== null)
      return { _tag: 'Invalid', error: invalidError(`storage.inventoryDurability.${index}`, 'empty slot requires null') }
    return { _tag: 'Slot', slot: undefined, durability: null }
  }
  if (!isRecord(slot) ||
      !hasExactKeys(slot, ['item', 'count', 'components']) ||
      typeof slot['item'] !== 'string' || !isItemType(slot['item']))
    return { _tag: 'Invalid', error: invalidError(`storage.inventory.slots.${index}`, 'expected a valid item stack') }
  const count = slot['count']
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0)
    return { _tag: 'Invalid', error: invalidError(`storage.inventory.slots.${index}`, 'expected a valid item stack') }
  const candidate = { item: slot['item'], count, components: slot['components'] }
  if (!isItemStack(candidate))
    return { _tag: 'Invalid', error: invalidError(`storage.inventory.slots.${index}`, 'expected a valid item stack') }
  const stack = Inv.itemStack(candidate.item, candidate.count, { components: candidate.components })
  if (Result.isFailure(stack)) return { _tag: 'ItemStackFailure', error: stack.failure }
  if (Eq.isDamageableItemType(slot['item'])) {
    if (!Eq.isValidDurabilityForItem(slot['item'], durability))
      return {
        _tag: 'Invalid',
        error: invalidError(
          `storage.inventoryDurability.${index}`,
          `${slot['item']} requires its exact durability range`,
        ),
      }
    return {
      _tag: 'Slot',
      slot: stack.success,
      durability: { ...durability },
    }
  }
  if (durability !== null)
    return { _tag: 'Invalid', error: invalidError(`storage.inventoryDurability.${index}`, 'non-durable item requires null') }
  return { _tag: 'Slot', slot: stack.success, durability: null }
}

/** Strictly validate persistence data, including item/slot compatibility. */
export const validatePlayerStorageSnapshot = (value: unknown): PlayerStorageValidationResult => {
  if (!isRecord(value) || !hasExactKeys(value, ['inventory', 'equipment', 'inventoryDurability']))
    return invalid('storage', 'expected exactly inventory, equipment, and inventoryDurability')
  const inventory = value['inventory']
  if (!isRecord(inventory) || !hasExactKeys(inventory, ['slots']) || !Array.isArray(inventory['slots']) ||
      inventory['slots'].length !== Inv.INVENTORY_SLOT_COUNT)
    return invalid('storage.inventory.slots', `expected exactly ${Inv.INVENTORY_SLOT_COUNT} slots`)
  const durabilityValues = value['inventoryDurability']
  if (!Array.isArray(durabilityValues) || durabilityValues.length !== Inv.INVENTORY_SLOT_COUNT)
    return invalid('storage.inventoryDurability', `expected exactly ${Inv.INVENTORY_SLOT_COUNT} entries`)

  const slots: Array<Inv.Slot> = []
  const inventoryDurability: Array<Eq.Durability | null> = []
  for (let index = 0; index < Inv.INVENTORY_SLOT_COUNT; index += 1) {
    const validated = validateInventorySlotEntry(inventory['slots'][index], durabilityValues[index], index)
    if (validated._tag === 'ItemStackFailure') return validated
    if (validated._tag === 'Invalid') return { _tag: 'Invalid', error: validated.error }
    slots.push(validated.slot)
    inventoryDurability.push(validated.durability)
  }

  const validatedEquipment = Eq.validateEquipmentSnapshot(value['equipment'])
  if (validatedEquipment._tag === 'Invalid')
    return invalid(`storage.${validatedEquipment.error.path}`, validatedEquipment.error.reason)
  return {
    _tag: 'Valid',
    storage: { inventory: { slots }, equipment: validatedEquipment.equipment, inventoryDurability },
  }
}
