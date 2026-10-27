import { Result } from 'effect'
import * as Eq from '../domain/equipment.js'
import * as Inv from '../domain/inventory.js'
import { itemStackWithCount } from '../domain/item-stack.js'
import * as Storage from '../domain/player-storage.js'
import { isItemStack, itemStackEqualsIgnoringCount } from '@nerima-games/mc-kernel'

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

export const carriedWithCount = (
  carried: InventoryCarriedStack,
  count: number,
): Result.Result<InventoryCarriedStack, Inv.ItemStackFailure> =>
  Result.map(Inv.itemStack(carried.item, count, { components: carried.components }), (stack) => ({
    ...stack,
    ...(carried.durability === undefined ? {} : { durability: { ...carried.durability } }),
  }))

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
): Result.Result<Storage.PlayerStorage, Inv.ItemStackFailure> => {
  const inventorySlots = Result.all(slots.map((slot) =>
    slot === undefined ? Result.succeed(undefined) : Inv.itemStack(slot.item, slot.count, { components: slot.components })))
  return Result.map(inventorySlots, (inventory) => ({
    ...player,
    inventory: { slots: inventory },
    inventoryDurability: slots.map(durabilityForCarried),
  }))
}

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
): Result.Result<InventoryClickOutcome, Inv.ItemStackFailure> => {
  if (click.carried === undefined) {
    if (slot === undefined) {
      return Result.succeed({ inventory, result: { _tag: 'NoChange', carried: undefined } })
    }
    const slots = [...inventory.slots]
    slots[click.slotIndex] = undefined
    return Result.succeed({ inventory: { slots }, result: { _tag: 'PickedUp', carried: slot } })
  }
  const carried = click.carried
  if (slot === undefined) {
    const slots = [...inventory.slots]
    return Result.map(Inv.itemStack(carried.item, carried.count, { components: carried.components }), (stack) => {
      slots[click.slotIndex] = stack
      return { inventory: { slots }, result: { _tag: 'Placed', carried: undefined } }
    })
  }
  if (slot.item !== carried.item) {
    const slots = [...inventory.slots]
    return Result.map(Inv.itemStack(carried.item, carried.count, { components: carried.components }), (stack) => {
      slots[click.slotIndex] = stack
      return { inventory: { slots }, result: { _tag: 'Swapped', carried: slot } }
    })
  }

  if (!itemStackEqualsIgnoringCount(slot, {
    item: carried.item, count: carried.count, components: carried.components,
  })) {
    const slots = [...inventory.slots]
    return Result.map(Inv.itemStack(carried.item, carried.count, { components: carried.components }), (stack) => {
      slots[click.slotIndex] = stack
      return { inventory: { slots }, result: { _tag: 'Swapped', carried: slot } }
    })
  }
  const accepted = Math.min(slot.components.maxStackSize - slot.count, carried.count)
  if (accepted <= 0) {
    return Result.succeed({ inventory, result: { _tag: 'NoChange', carried } })
  }
  const slots = [...inventory.slots]
  const remaining = carried.count - accepted
  return Result.flatMap(itemStackWithCount(slot, slot.count + accepted), (updatedSlot) =>
    Result.map(remaining === 0
      ? Result.succeed(undefined)
      : carriedWithCount(carried, remaining), (nextCarried) => {
      slots[click.slotIndex] = updatedSlot
      return { inventory: { slots }, result: { _tag: 'Merged', carried: nextCarried } }
    }))
}

const clickInventoryRight = (
  inventory: Inv.Inventory,
  click: Extract<InventoryClick, { readonly _tag: 'RightClick' }>,
  slot: Inv.Slot,
): Result.Result<InventoryClickOutcome, Inv.ItemStackFailure> => {
  if (click.carried === undefined) {
    if (slot === undefined) {
      return Result.succeed({ inventory, result: { _tag: 'NoChange', carried: undefined } })
    }
    const pickedUp = Math.ceil(slot.count / 2)
    const remaining = slot.count - pickedUp
    const slots = [...inventory.slots]
    const updatedSlot = remaining === 0 ? Result.succeed(undefined) : itemStackWithCount(slot, remaining)
    return Result.flatMap(updatedSlot, (nextSlot) =>
      Result.map(itemStackWithCount(slot, pickedUp), (pickedUpStack) => {
        slots[click.slotIndex] = nextSlot
        return { inventory: { slots }, result: { _tag: 'PickedUp', carried: pickedUpStack } }
      }))
  }
  const carried = click.carried

  if (slot !== undefined &&
      (!itemStackEqualsIgnoringCount(slot, {
        item: carried.item, count: carried.count, components: carried.components,
      }) || slot.count >= slot.components.maxStackSize)) {
    return Result.succeed({ inventory, result: { _tag: 'NoChange', carried } })
  }
  const slots = [...inventory.slots]
  const remaining = carried.count - 1
  return Result.flatMap(Inv.itemStack(carried.item, (slot?.count ?? 0) + 1, { components: carried.components }), (updatedSlot) =>
    Result.map(remaining === 0
      ? Result.succeed(undefined)
      : carriedWithCount(carried, remaining), (nextCarried) => {
      slots[click.slotIndex] = updatedSlot
      return {
        inventory: { slots },
        result: { _tag: slot === undefined ? 'Placed' : 'Merged', carried: nextCarried },
      }
    }))
}

/** Apply one Minecraft-style slot click without exposing an intermediate inventory. */
export const clickInventory = (
  inventory: Inv.Inventory,
  click: InventoryClick,
): Result.Result<InventoryClickOutcome, Inv.ItemStackFailure> => {
  if (
    !Number.isInteger(click.slotIndex) ||
    click.slotIndex < 0 ||
    click.slotIndex >= Inv.INVENTORY_SLOT_COUNT
  ) {
    return Result.succeed({ inventory, result: { _tag: 'InvalidSlot', carried: click.carried } })
  }
  if (!validCarried(click.carried)) {
    return Result.succeed({ inventory, result: { _tag: 'InvalidCount', carried: click.carried } })
  }

  const slot = inventory.slots[click.slotIndex]
  return click._tag === 'LeftClick'
    ? clickInventoryLeft(inventory, click, slot)
    : clickInventoryRight(inventory, click, slot)
}
