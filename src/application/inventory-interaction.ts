import * as Eq from '../domain/equipment.js'
import * as Inv from '../domain/inventory.js'
import * as Storage from '../domain/player-storage.js'

export type InventoryCarriedStack = Inv.ItemStack & {
  readonly durability?: Eq.Durability | undefined
}
export type InventoryCarriedSlot = InventoryCarriedStack | undefined

export type InventoryClick =
  | {
      readonly _tag: 'LeftClick'
      readonly slotIndex: number
      readonly carried: InventoryCarriedSlot
    }
  | {
      readonly _tag: 'RightClick'
      readonly slotIndex: number
      readonly carried: InventoryCarriedSlot
    }

export type InventoryClickResult =
  | { readonly _tag: 'PickedUp'; readonly carried: InventoryCarriedStack }
  | { readonly _tag: 'Placed'; readonly carried: InventoryCarriedSlot }
  | { readonly _tag: 'Merged'; readonly carried: InventoryCarriedSlot }
  | { readonly _tag: 'Swapped'; readonly carried: InventoryCarriedStack }
  | { readonly _tag: 'NoChange'; readonly carried: InventoryCarriedSlot }
  | { readonly _tag: 'InvalidSlot'; readonly carried: InventoryCarriedSlot }
  | { readonly _tag: 'InvalidCount'; readonly carried: InventoryCarriedSlot }

export type InventoryClickOutcome = {
  readonly inventory: Inv.Inventory
  readonly result: InventoryClickResult
}

export const validCarried = (carried: InventoryCarriedSlot): boolean =>
  carried === undefined ||
  (Number.isInteger(carried.count) && carried.count > 0 &&
    carried.count <= Inv.maxStackCountForItem(carried.item) &&
    (Eq.isDamageableItemType(carried.item)
      ? carried.durability === undefined ||
        Eq.isValidDurabilityForItem(carried.item, carried.durability)
      : carried.durability === undefined))

export const sameDurability = (
  left: Eq.Durability | null | undefined,
  right: Eq.Durability | null | undefined,
): boolean => left === right || (left !== null && left !== undefined && right !== null && right !== undefined &&
  left.current === right.current && left.max === right.max)

export const copyCarried = (carried: InventoryCarriedSlot): InventoryCarriedSlot => carried === undefined
  ? undefined
  : {
      ...carried,
      ...(carried.durability === undefined ? {} : { durability: { ...carried.durability } }),
    }

export const carriedWithCount = (carried: InventoryCarriedStack, count: number): InventoryCarriedStack => ({
  ...Inv.itemStack(carried.item, count),
  ...(carried.durability === undefined ? {} : { durability: { ...carried.durability } }),
})

export const carriedAt = (player: Storage.PlayerStorage, index: number): InventoryCarriedSlot => {
  const slot = player.inventory.slots[index]
  if (slot === undefined) return undefined
  const durability = player.inventoryDurability[index]
  return Eq.isDamageableItemType(slot.item) && Eq.isValidDurabilityForItem(slot.item, durability)
    ? {
        ...slot,
        durability: { ...durability },
      }
    : { ...slot }
}

const durabilityForCarried = (carried: InventoryCarriedSlot): Eq.Durability | null => {
  if (carried === undefined || !Eq.isDamageableItemType(carried.item)) return null
  return carried.durability === undefined
    ? Eq.durabilityForItem(carried.item)
    : { ...carried.durability }
}

export const withCarriedSlots = (
  player: Storage.PlayerStorage,
  slots: ReadonlyArray<InventoryCarriedSlot>,
): Storage.PlayerStorage => ({
  ...player,
  inventory: { slots: slots.map((slot) => slot === undefined ? undefined : { item: slot.item, count: slot.count }) },
  inventoryDurability: slots.map(durabilityForCarried),
})

export const isValidSlotIndex = (index: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < Inv.INVENTORY_SLOT_COUNT

export const sameCarried = (left: InventoryCarriedSlot, right: InventoryCarriedSlot): boolean =>
  left?.item === right?.item && left?.count === right?.count &&
  sameDurability(left?.durability, right?.durability)

const clickInventoryLeft = (
  inventory: Inv.Inventory,
  click: Extract<InventoryClick, { readonly _tag: 'LeftClick' }>,
  slot: Inv.Slot,
): InventoryClickOutcome => {
  if (click.carried === undefined) {
    if (slot === undefined) {
      return { inventory, result: { _tag: 'NoChange', carried: undefined } }
    }
    const slots = [...inventory.slots]
    slots[click.slotIndex] = undefined
    return { inventory: { slots }, result: { _tag: 'PickedUp', carried: slot } }
  }
  if (slot === undefined) {
    const slots = [...inventory.slots]
    slots[click.slotIndex] = Inv.itemStack(click.carried.item, click.carried.count)
    return { inventory: { slots }, result: { _tag: 'Placed', carried: undefined } }
  }
  if (slot.item !== click.carried.item) {
    const slots = [...inventory.slots]
    slots[click.slotIndex] = Inv.itemStack(click.carried.item, click.carried.count)
    return { inventory: { slots }, result: { _tag: 'Swapped', carried: slot } }
  }

  const accepted = Math.min(Inv.maxStackCountForItem(slot.item) - slot.count, click.carried.count)
  if (accepted <= 0) {
    return { inventory, result: { _tag: 'NoChange', carried: click.carried } }
  }
  const slots = [...inventory.slots]
  slots[click.slotIndex] = Inv.itemStack(slot.item, slot.count + accepted)
  const remaining = click.carried.count - accepted
  return {
    inventory: { slots },
    result: {
      _tag: 'Merged',
      carried: remaining === 0 ? undefined : Inv.itemStack(click.carried.item, remaining),
    },
  }
}

const clickInventoryRight = (
  inventory: Inv.Inventory,
  click: Extract<InventoryClick, { readonly _tag: 'RightClick' }>,
  slot: Inv.Slot,
): InventoryClickOutcome => {
  if (click.carried === undefined) {
    if (slot === undefined) {
      return { inventory, result: { _tag: 'NoChange', carried: undefined } }
    }
    const pickedUp = Math.ceil(slot.count / 2)
    const remaining = slot.count - pickedUp
    const slots = [...inventory.slots]
    slots[click.slotIndex] = remaining === 0 ? undefined : Inv.itemStack(slot.item, remaining)
    return {
      inventory: { slots },
      result: { _tag: 'PickedUp', carried: Inv.itemStack(slot.item, pickedUp) },
    }
  }

  if (slot !== undefined &&
      (slot.item !== click.carried.item || slot.count >= Inv.maxStackCountForItem(slot.item))) {
    return { inventory, result: { _tag: 'NoChange', carried: click.carried } }
  }
  const slots = [...inventory.slots]
  slots[click.slotIndex] = Inv.itemStack(click.carried.item, (slot?.count ?? 0) + 1)
  const remaining = click.carried.count - 1
  return {
    inventory: { slots },
    result: {
      _tag: slot === undefined ? 'Placed' : 'Merged',
      carried: remaining === 0 ? undefined : Inv.itemStack(click.carried.item, remaining),
    },
  }
}

/** Apply one Minecraft-style slot click without exposing an intermediate inventory. */
export const clickInventory = (inventory: Inv.Inventory, click: InventoryClick): InventoryClickOutcome => {
  if (
    !Number.isInteger(click.slotIndex) ||
    click.slotIndex < 0 ||
    click.slotIndex >= Inv.INVENTORY_SLOT_COUNT
  ) {
    return { inventory, result: { _tag: 'InvalidSlot', carried: click.carried } }
  }
  if (!validCarried(click.carried)) {
    return { inventory, result: { _tag: 'InvalidCount', carried: click.carried } }
  }

  const slot = inventory.slots[click.slotIndex]
  return click._tag === 'LeftClick'
    ? clickInventoryLeft(inventory, click, slot)
    : clickInventoryRight(inventory, click, slot)
}
