/**
 * Inventory as a value.
 *
 * plan.md §2.3-1: the foundation tier owns NOUNS, the experience tier owns
 * VERBS. `InventoryService` — a place where stacks live — is a noun and belongs
 * here. "Mining a block drops an item into your inventory" is a verb and
 * belongs in mx-gameplay, which reaches this service through mc-sim's public
 * API. That is how mx-gameplay and mx-redstone stay ignorant of one another.
 *
 * The whole module is pure. Every transition returns the resulting inventory
 * plus whatever the caller has to know about it (typically the leftover that
 * did not fit), and nothing here reads a clock, a random source, or a Ref.
 * `application/inventory-service.ts` is the thin Ref wrapper.
 *
 * PRE-AUDIT FIRST CUT. The real model needs durability, enchantments, NBT-ish
 * per-item state and armour slots; the reference's InventoryService has 14
 * methods (ts-minecraft/packages/inventory/application/inventory-service.ts:22-101).
 * What is here is the part the mining scenario test needs, plus the stacking
 * rule, which is the part that is easy to get subtly wrong.
 */
import { MAX_STACK_COUNT, StackCount } from './kernel-vocabulary'

/**
 * Item identity.
 *
 * A bare `string` on purpose, and PROVISIONAL. `ItemType` is mc-kernel's
 * vocabulary (plan.md §3.1) and will be a literal union with exhaustiveness
 * checking. Mirroring an invented union here would be worse than mirroring
 * nothing: it would look authoritative.
 */
export type ItemId = string

/** Number of slots in the player's main inventory, hotbar included. */
export const INVENTORY_SLOT_COUNT = 36

export type ItemStack = {
  readonly item: ItemId
  readonly count: StackCount
}

/** A slot is either empty (`undefined`) or holds a stack. */
export type Slot = ItemStack | undefined

export type Inventory = {
  readonly slots: ReadonlyArray<Slot>
}

export const emptyInventory = (): Inventory => ({
  slots: Array.from({ length: INVENTORY_SLOT_COUNT }, () => undefined),
})

export const slotAt = (inventory: Inventory, index: number): Slot => inventory.slots[index]

/** Total count of an item across every slot. */
export const countOf = (inventory: Inventory, item: ItemId): number =>
  inventory.slots.reduce((total, slot) => (slot?.item === item ? total + slot.count : total), 0)

/** True when no slot holds anything. */
export const isEmpty = (inventory: Inventory): boolean => inventory.slots.every((slot) => slot === undefined)

export type AddOutcome = {
  readonly inventory: Inventory
  /**
   * How many items could not be placed. Zero on full success.
   *
   * Returned rather than raised. A full inventory is an ordinary game state,
   * not an error: the caller (mx-gameplay) turns a non-zero leftover into a
   * dropped-item entity on the ground, which is what the player expects.
   */
  readonly leftover: number
}

/**
 * Insert items, topping up partial stacks before opening new slots.
 *
 * The top-up-first order is not cosmetic. Filling empty slots first fragments
 * an inventory into many partial stacks of the same item, and the player then
 * finds their 36 slots full while holding barely any material. Vanilla tops up
 * first, and so does the reference
 * (ts-minecraft/packages/inventory/application/inventory-service.ts:63 `addBlock`).
 *
 * `count` is a plain number, not a `StackCount`: an incoming quantity may
 * legitimately exceed one stack (a creative-mode give, a large loot drop) and
 * branding the input would reject the very case this function exists to spread
 * across slots.
 */
export const addItem = (inventory: Inventory, item: ItemId, count: number): AddOutcome => {
  if (!Number.isInteger(count) || count <= 0) {
    return { inventory, leftover: Math.max(0, count) }
  }

  const slots = [...inventory.slots]
  let remaining = count

  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    const slot = slots[index]
    if (slot === undefined || slot.item !== item || slot.count >= MAX_STACK_COUNT) {
      continue
    }
    const accepted = Math.min(MAX_STACK_COUNT - slot.count, remaining)
    slots[index] = { item, count: StackCount(slot.count + accepted) }
    remaining -= accepted
  }

  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    if (slots[index] !== undefined) {
      continue
    }
    const accepted = Math.min(MAX_STACK_COUNT, remaining)
    slots[index] = { item, count: StackCount(accepted) }
    remaining -= accepted
  }

  return { inventory: { slots }, leftover: remaining }
}

export type RemoveOutcome = {
  readonly inventory: Inventory
  /** How many were actually taken. Less than requested when stock ran out. */
  readonly removed: number
}

/**
 * Take items, draining the LAST matching slots first.
 *
 * Last-first mirrors vanilla consumption order and, more usefully, means that
 * `addItem` followed by `removeItem` of the same amount restores the original
 * slot layout rather than leaving a hole earlier in the inventory.
 */
export const removeItem = (inventory: Inventory, item: ItemId, count: number): RemoveOutcome => {
  if (!Number.isInteger(count) || count <= 0) {
    return { inventory, removed: 0 }
  }

  const slots = [...inventory.slots]
  let remaining = count

  for (let index = slots.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const slot = slots[index]
    if (slot === undefined || slot.item !== item) {
      continue
    }
    const taken = Math.min(slot.count, remaining)
    const left = slot.count - taken
    slots[index] = left === 0 ? undefined : { item, count: StackCount(left) }
    remaining -= taken
  }

  return { inventory: { slots }, removed: count - remaining }
}
