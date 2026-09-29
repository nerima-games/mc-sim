import * as Eq from '../domain/equipment.js'
import * as Inv from '../domain/inventory.js'
import * as Storage from '../domain/player-storage.js'
import { isItemStack, itemStackWithCount, itemStackEqualsIgnoringCount } from '@nerima-games/mc-kernel'

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
  (isItemStack({ item: carried.item, count: carried.count, components: carried.components }) &&
    (Eq.isDamageableItemType(carried.item)
      ? carried.durability === undefined ||
        Eq.isValidDurabilityForItem(carried.item, carried.durability)
      : carried.durability === undefined))

export const sameDurability = (
  left: Eq.Durability | null | undefined,
  right: Eq.Durability | null | undefined,
): boolean => left === right || (left !== null && left !== undefined && right !== null && right !== undefined &&
  left.current === right.current && left.max === right.max)

export const sameStackIgnoringCount = (
  left: InventoryCarriedStack,
  right: InventoryCarriedStack,
): boolean => itemStackEqualsIgnoringCount(
  { item: left.item, count: left.count, components: left.components },
  { item: right.item, count: right.count, components: right.components },
)

export const copyCarried = (carried: InventoryCarriedSlot): InventoryCarriedSlot => carried === undefined
  ? undefined
  : {
      ...carried,
      ...(carried.durability === undefined ? {} : { durability: { ...carried.durability } }),
    }

export const carriedWithCount = (carried: InventoryCarriedStack, count: number): InventoryCarriedStack => ({
  ...Inv.itemStack(carried.item, count, { components: carried.components }),
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
  inventory: { slots: slots.map((slot) => slot === undefined ? undefined : Inv.itemStack(slot.item, slot.count, { components: slot.components })) },
  inventoryDurability: slots.map(durabilityForCarried),
})

export const isValidSlotIndex = (index: number): boolean =>
  Number.isInteger(index) && index >= 0 && index < Inv.INVENTORY_SLOT_COUNT

export const sameCarried = (left: InventoryCarriedSlot, right: InventoryCarriedSlot): boolean =>
  (left === undefined || right === undefined
    ? left === right
    : left.count === right.count && sameStackIgnoringCount(left, right)) &&
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
    slots[click.slotIndex] = Inv.itemStack(click.carried.item, click.carried.count, { components: click.carried.components })
    return { inventory: { slots }, result: { _tag: 'Placed', carried: undefined } }
  }
  if (slot.item !== click.carried.item) {
    const slots = [...inventory.slots]
    slots[click.slotIndex] = Inv.itemStack(click.carried.item, click.carried.count, { components: click.carried.components })
    return { inventory: { slots }, result: { _tag: 'Swapped', carried: slot } }
  }

  if (!itemStackEqualsIgnoringCount(slot, {
    item: click.carried.item, count: click.carried.count, components: click.carried.components,
  })) {
    const slots = [...inventory.slots]
    slots[click.slotIndex] = Inv.itemStack(click.carried.item, click.carried.count, { components: click.carried.components })
    return { inventory: { slots }, result: { _tag: 'Swapped', carried: slot } }
  }
  const accepted = Math.min(slot.components.maxStackSize - slot.count, click.carried.count)
  if (accepted <= 0) {
    return { inventory, result: { _tag: 'NoChange', carried: click.carried } }
  }
  const slots = [...inventory.slots]
  slots[click.slotIndex] = itemStackWithCount(slot, slot.count + accepted)
  const remaining = click.carried.count - accepted
  return {
    inventory: { slots },
    result: {
      _tag: 'Merged',
      carried: remaining === 0 ? undefined : carriedWithCount(click.carried, remaining),
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
    slots[click.slotIndex] = remaining === 0 ? undefined : itemStackWithCount(slot, remaining)
    return {
      inventory: { slots },
      result: { _tag: 'PickedUp', carried: itemStackWithCount(slot, pickedUp) },
    }
  }

  if (slot !== undefined &&
      (!itemStackEqualsIgnoringCount(slot, {
        item: click.carried.item, count: click.carried.count, components: click.carried.components,
      }) || slot.count >= slot.components.maxStackSize)) {
    return { inventory, result: { _tag: 'NoChange', carried: click.carried } }
  }
  const slots = [...inventory.slots]
  slots[click.slotIndex] = Inv.itemStack(click.carried.item, (slot?.count ?? 0) + 1, { components: click.carried.components })
  const remaining = click.carried.count - 1
  return {
    inventory: { slots },
    result: {
      _tag: slot === undefined ? 'Placed' : 'Merged',
      carried: remaining === 0 ? undefined : carriedWithCount(click.carried, remaining),
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
