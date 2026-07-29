import * as Eq from './equipment'
import * as Inv from './inventory'
import { isItemType, StackCount } from './kernel-vocabulary'

export const FLINT_AND_STEEL_MAX_DURABILITY =
  Eq.EQUIPMENT_CATALOG.flint_and_steel.maxDurability

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

export type StorageOutcome<A> = { readonly storage: PlayerStorage; readonly result: A }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const copyDurability = (value: Eq.Durability | null): Eq.Durability | null =>
  value === null ? null : { ...value }

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
    if (Eq.isEquippableItemType(slot['item'])) {
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
