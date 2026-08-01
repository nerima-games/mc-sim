import * as Eq from './equipment'
import * as Inv from './inventory'
import { isItemType, StackCount } from './kernel-vocabulary'
import type { ContainerStoredStack } from './container-storage'

export const FLINT_AND_STEEL_MAX_DURABILITY =
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

export type AddStoredStackResult =
  | {
      readonly _tag: 'Added'
      /** Number inserted; zero means that the inventory had no compatible capacity. */
      readonly added: number
      /** Null after a full insert, otherwise the exact stack still available for pickup. */
      readonly leftover: ContainerStoredStack | null
    }
  | { readonly _tag: 'InvalidStack' }

export type EquipFromInventoryResult =
  | { readonly _tag: 'Equipped'; readonly item: Eq.EquipmentItem }
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

export type DamageAtResult =
  | Eq.DamageEquipmentResult
  | { readonly _tag: 'InvalidLocation' }

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
  | { readonly _tag: 'InsufficientConsumable'; readonly available: number }

export type StorageOutcome<A> = { readonly storage: PlayerStorage; readonly result: A }

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
  if (!isRecord(value) || !hasExactKeys(value, ['item', 'count', 'durability'])) return false
  if (typeof value['item'] !== 'string' || !isItemType(value['item']) ||
      !Number.isSafeInteger(value['count']) || (value['count'] as number) <= 0 ||
      (value['count'] as number) > Inv.maxStackCountForItem(value['item'])) return false
  return Eq.isDamageableItemType(value['item'])
    ? (value['count'] as number) === 1 && Eq.isValidDurabilityForItem(value['item'], value['durability'])
    : value['durability'] === null
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
export const withInventory = (storage: PlayerStorage, inventory: Inv.Inventory): PlayerStorage => ({
  ...storage,
  inventory,
  inventoryDurability: inventory.slots.map((slot, index) => {
    if (slot === undefined) return null
    const previous = storage.inventory.slots[index]
    const previousDurability = storage.inventoryDurability[index]
    return previous?.item === slot.item && Eq.isValidDurabilityForItem(slot.item, previousDurability)
      ? copyDurability(previousDurability)
      : Eq.durabilityForItem(slot.item)
  }),
})

/** Insert one validated stack while preserving its exact durability. */
export const addStoredStack = (
  storage: PlayerStorage,
  stack: ContainerStoredStack,
): StorageOutcome<AddStoredStackResult> => {
  if (!isValidStoredStack(stack)) return { storage, result: { _tag: 'InvalidStack' } }

  const slots = [...storage.inventory.slots]
  const inventoryDurability = [...storage.inventoryDurability]
  const maxStackCount = Inv.maxStackCountForItem(stack.item)
  let remaining = stack.count as number

  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    const slot = slots[index]
    if (slot === undefined || slot.item !== stack.item ||
        !sameDurability(inventoryDurability[index], stack.durability) ||
        !Number.isSafeInteger(slot.count) || slot.count <= 0 || slot.count >= maxStackCount) continue
    const accepted = Math.min(maxStackCount - slot.count, remaining)
    slots[index] = { item: stack.item, count: StackCount(slot.count + accepted) }
    inventoryDurability[index] = copyDurability(stack.durability)
    remaining -= accepted
  }

  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    if (slots[index] !== undefined) continue
    const accepted = Math.min(maxStackCount, remaining)
    slots[index] = { item: stack.item, count: StackCount(accepted) }
    inventoryDurability[index] = copyDurability(stack.durability)
    remaining -= accepted
  }

  const added = stack.count - remaining
  const leftover = remaining === 0
    ? null
    : { item: stack.item, count: StackCount(remaining), durability: copyDurability(stack.durability) }
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
  if (definition?.slot !== equipmentSlot || stack.count !== 1)
    return { storage, result: { _tag: 'Incompatible', item: stack } }
  const occupied = storage.equipment.slots[equipmentSlot]
  if (occupied !== null) return { storage, result: { _tag: 'Occupied', item: occupied } }

  const storedDurability = storage.inventoryDurability[inventorySlot]
  const durability = Eq.isValidDurabilityForItem(stack.item, storedDurability)
    ? storedDurability
    : Eq.durabilityForItem(stack.item)
  if (durability === null) return { storage, result: { _tag: 'Incompatible', item: stack } }
  const item = Eq.equipmentItem(stack, durability)
  const slots = [...storage.inventory.slots]
  slots[inventorySlot] = undefined
  const inventoryDurability = [...storage.inventoryDurability]
  inventoryDurability[inventorySlot] = null
  return {
    storage: {
      inventory: { slots },
      equipment: Eq.equip(storage.equipment, equipmentSlot, item).equipment,
      inventoryDurability,
    },
    result: { _tag: 'Equipped', item },
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
  slots[slotIndex] = { item: item.item, count: item.count }
  const inventoryDurability = [...storage.inventoryDurability]
  inventoryDurability[slotIndex] = copyDurability(item.durability)
  return {
    storage: {
      inventory: { slots },
      equipment: Eq.unequip(storage.equipment, equipmentSlot).equipment,
      inventoryDurability,
    },
    result: { _tag: 'Unequipped', item, slotIndex },
  }
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
  if (durability === null || durability === undefined) {
    return { storage, result: { _tag: 'NotDamageable', item: { ...item, durability: null } } }
  }
  const applied = Math.min(amount, durability.current)
  const equippedItem = Eq.equipmentItem(item, durability)
  const slots = [...storage.inventory.slots]
  const inventoryDurability = [...storage.inventoryDurability]
  if (applied === durability.current) {
    slots[location.slotIndex] = undefined
    inventoryDurability[location.slotIndex] = null
    return {
      storage: { ...storage, inventory: { slots }, inventoryDurability },
      result: { _tag: 'Broken', item: equippedItem, applied },
    }
  }
  const damaged = { ...durability, current: durability.current - applied }
  inventoryDurability[location.slotIndex] = damaged
  return {
    storage: { ...storage, inventoryDurability },
    result: { _tag: 'Damaged', item: Eq.equipmentItem(item, damaged), applied },
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

  const targetDurability = request.damage.location._tag === 'Inventory'
    ? storage.inventoryDurability[request.damage.location.slotIndex]
    : storage.equipment.slots[request.damage.location.slot]?.durability
  if (targetDurability === null || targetDurability === undefined) {
    return { storage, result: { _tag: 'NotDamageable', item: target } }
  }

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
  if (available < request.consume.count) {
    return { storage, result: { _tag: 'InsufficientConsumable', available } }
  }

  let inventory = storage.inventory
  let remaining = request.consume.count
  for (let index = 0; index < inventory.slots.length && remaining > 0; index += 1) {
    const slot = inventory.slots[index]
    if (index === excludedSlot || slot?.item !== request.consume.item) continue
    const count = Math.min(slot.count, remaining)
    const outcome = Inv.removeItemAt(inventory, index, request.consume.item, count)
    inventory = outcome.inventory
    remaining -= count
  }

  const damaged = damageAt(
    withInventory(storage, inventory),
    request.damage.location,
    request.damage.amount,
  )
  if (damaged.result._tag !== 'Damaged' && damaged.result._tag !== 'Broken') {
    return { storage, result: { _tag: 'NotDamageable', item: target } }
  }
  return {
    storage: damaged.storage,
    result: {
      _tag: 'Applied',
      consumed: request.consume.count,
      damage: damaged.result,
    },
  }
}

const invalid = (path: string, reason: string): PlayerStorageValidationResult => ({
  _tag: 'Invalid', error: { _tag: 'PlayerStorageValidationError', path, reason },
})

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
    const slot = inventory['slots'][index]
    const durability = durabilityValues[index]
    if (slot === null || slot === undefined) {
      if (durability !== null) return invalid(`storage.inventoryDurability.${index}`, 'empty slot requires null')
      slots.push(undefined); inventoryDurability.push(null); continue
    }
    if (!isRecord(slot) || !hasExactKeys(slot, ['item', 'count']) ||
        typeof slot['item'] !== 'string' || !isItemType(slot['item']) ||
        !Number.isSafeInteger(slot['count']) || (slot['count'] as number) <= 0 ||
        (slot['count'] as number) > Inv.maxStackCountForItem(slot['item']))
      return invalid(`storage.inventory.slots.${index}`, 'expected a valid item stack')
    if (Eq.isDamageableItemType(slot['item'])) {
      if (!Eq.isValidDurabilityForItem(slot['item'], durability))
        return invalid(
          `storage.inventoryDurability.${index}`,
          `${slot['item']} requires its exact durability range`,
        )
      inventoryDurability.push({ ...durability })
    } else {
      if (durability !== null) return invalid(`storage.inventoryDurability.${index}`, 'non-durable item requires null')
      inventoryDurability.push(null)
    }
    slots.push({ item: slot['item'], count: StackCount(slot['count'] as number) })
  }

  const validatedEquipment = Eq.validateEquipmentSnapshot(value['equipment'])
  if (validatedEquipment._tag === 'Invalid')
    return invalid(`storage.${validatedEquipment.error.path}`, validatedEquipment.error.reason)
  return {
    _tag: 'Valid',
    storage: { inventory: { slots }, equipment: validatedEquipment.equipment, inventoryDurability },
  }
}
