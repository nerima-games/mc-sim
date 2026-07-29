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
 * IT IS ALSO TOTAL, INCLUDING ON AN `Inventory` IT DID NOT BUILD. That claim
 * used to be false and expensively so: `removeItem` wrote `StackCount(left)`,
 * `StackCount` is `Brand.refined`, and a slot restored from another build's
 * save made it THROW. A throw from a pure domain function is a `Cause.Die` in
 * the frame loop, which `application/game-loop.ts` logs and swallows, so mining
 * and crafting simply stopped working while nothing failed.
 *
 * Two private helpers hold the line — `heldCount` guards every READ of a slot
 * count and `derivedStackCount` clamps every WRITE derived from one. Repair is
 * a separate concern from totality: `normaliseInventory` is the one function
 * that repairs a whole inventory and it ACCOUNTS for what it cannot place,
 * which is what `InventoryService.restore` runs on the world-load path.
 *
 * PRE-AUDIT FIRST CUT. The real model needs durability, enchantments, NBT-ish
 * per-item state and armour slots; the reference's InventoryService has 14
 * methods (ts-minecraft/packages/inventory/application/inventory-service.ts:22-101).
 * What is here is the part the mining scenario test needs, plus the stacking
 * rule, which is the part that is easy to get subtly wrong.
 */
import { isItemType, ItemType, MAX_STACK_COUNT, StackCount } from "@nerima-games/mc-kernel"

/*
 * THERE IS NO `ItemId` HERE ANY MORE.
 *
 * It was `export type ItemId = string`, provisional, with a comment promising to
 * repoint when mc-kernel published its half of plan.md §3.1's two vocabularies.
 * Kernel published it (`mc-kernel/domain/item-type.ts`) and the promise is kept:
 * every signature below takes `ItemType`, the mirrored closed union.
 *
 * The alias is GONE rather than retargeted to `= ItemType`, and that is the
 * point of the exercise. Kernel's header names the defect precisely — mc-sim,
 * mc-playground-kit and mx-ui each invented `type ItemId = string`, three names
 * for one missing type — and an alias that survives the publication leaves
 * mc-sim's signatures saying `ItemId` where six consumers read `ItemType` from
 * kernel, which is the same confusion one indirection deeper. Deleting a
 * published name is a breaking change and is recorded as one (`api-lock.md`,
 * docs/versioning.md); it is the smaller of the two costs.
 */

/** Number of slots in the player's main inventory, hotbar included. */
export const INVENTORY_SLOT_COUNT = 36

export type ItemStack = {
  readonly item: ItemType
  readonly count: StackCount
}

/**
 * Build a stack, branding the count.
 *
 * The brand is applied HERE rather than at every literal, so an out-of-range
 * count fails at the place that names it (a recipe output of 65, say) instead of
 * flowing into a slot as a bare number. Contrast `addItem(count: number)`, which
 * deliberately does NOT brand: see DN-06 in docs/design-notes.md.
 */
export const itemStack = (item: ItemType, count: number): ItemStack => ({
  item,
  count: StackCount(count),
})

/**
 * How many items a slot holds, as a plain number, for a slot that may itself be
 * out of range.
 *
 * Every read of `slot.count` inside this module goes through here. A slot that
 * arrived from `restore` can hold 200, or a fraction, or `NaN`, and arithmetic
 * on those quietly poisons the outcome: `Math.min(NaN, remaining)` is `NaN`,
 * `remaining -= NaN` ends the loop, and `removed` comes back `NaN`.
 */
const heldCount = (stack: ItemStack): number =>
  Number.isFinite(stack.count) && stack.count > 0 ? Math.floor(stack.count) : 0

/**
 * Brand a count DERIVED from a slot that may itself be out of range.
 *
 * `StackCount` is `Brand.refined` and THROWS outside [0, 64]. That is right for
 * `itemStack`, where the number is a literal a human wrote (DN-06: a recipe
 * output of 65 should fail at the place that names it). It is wrong here: the
 * number is whatever was left after taking from a slot that may already have
 * been corrupt, and a throw from a pure domain function becomes a `Cause.Die`
 * in the frame loop, which `application/game-loop.ts` logs and SWALLOWS. The
 * observable result was that mining and crafting stopped working, with a line
 * in a log nobody reads, and this module's header claims to be pure and total.
 *
 * Repairing to the representable range keeps that claim true. It also loses the
 * surplus of an over-full slot, which is why it is not the sanctioned way to
 * handle a corrupt inventory: `normaliseInventory` is, and it accounts for
 * every item instead of dropping it. Nothing mc-sim itself produces can reach
 * this clamp — `emptyInventory`, `addItem` and `normaliseInventory` are the
 * only constructors, and all three respect `MAX_STACK_COUNT`.
 */
const derivedStackCount = (count: number): StackCount =>
  StackCount(Number.isFinite(count) ? Math.min(MAX_STACK_COUNT, Math.max(0, Math.floor(count))) : 0)

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
export const countOf = (inventory: Inventory, item: ItemType): number =>
  inventory.slots.reduce((total, slot) => (slot?.item === item ? total + heldCount(slot) : total), 0)

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
export const addItem = (inventory: Inventory, item: ItemType, count: number): AddOutcome => {
  if (!Number.isInteger(count) || count <= 0) {
    // A rejected quantity is reported as leftover, because the caller turns
    // leftover into dropped-item entities and 2.5 items asked for is 2.5 items
    // not placed. `Math.max(0, NaN)` is NaN, though, and a NaN leftover is a
    // number every caller downstream would believe — so a quantity that is not
    // a quantity leaves nothing behind.
    return { inventory, leftover: Number.isFinite(count) ? Math.max(0, count) : 0 }
  }

  const slots = [...inventory.slots]
  let remaining = count

  for (let index = 0; index < slots.length && remaining > 0; index += 1) {
    const slot = slots[index]
    if (slot === undefined || slot.item !== item) {
      continue
    }
    const held = heldCount(slot)
    if (held >= MAX_STACK_COUNT) {
      continue
    }
    const accepted = Math.min(MAX_STACK_COUNT - held, remaining)
    slots[index] = { item, count: StackCount(held + accepted) }
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
 *
 * TOTAL, including on an inventory this module did not build. See
 * `derivedStackCount` and `heldCount` for what an out-of-range slot does here
 * and why it cannot be allowed to throw.
 */
export const removeItem = (inventory: Inventory, item: ItemType, count: number): RemoveOutcome => {
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
    const held = heldCount(slot)
    const taken = Math.min(held, remaining)
    const left = held - taken
    slots[index] = left === 0 ? undefined : { item, count: derivedStackCount(left) }
    remaining -= taken
  }

  return { inventory: { slots }, removed: count - remaining }
}

export type NormaliseOutcome = {
  readonly inventory: Inventory
  /**
   * How many items the repaired inventory had no room for. Zero on a save that
   * only needed padding.
   *
   * The same currency as `AddOutcome.leftover`, and for the same reason: the
   * caller turns it into dropped-item entities on the ground. Reported rather
   * than discarded so that a shrinking slot count is a visible quantity instead
   * of items that evaporate on load.
   */
  readonly leftover: number
  /**
   * How many items were dropped because their name is not an `ItemType`.
   *
   * A SEPARATE NUMBER FROM `leftover`, because the caller does something
   * different with it. A leftover is a real item with nowhere to go, and
   * mx-gameplay spawns it on the ground; a discard is a name this build has no
   * item for, and there is nothing to spawn. Folding the two together would ask
   * a host to drop `'diamond'` into a world whose item vocabulary has never
   * heard of it.
   *
   * Non-zero means the save came from a build with a different `ITEM_TYPES`
   * roster — which is exactly what a MINOR kernel release produces in the other
   * direction, and what `docs/versioning.md` says a save may cross.
   */
  readonly discarded: number
}

/**
 * Repair an inventory read from persistence into one this module's invariants
 * hold for. The world-load counterpart of `emptyInventory`.
 *
 * `InventoryService.restore` used to install whatever it was handed, so a save
 * written by a build with a different slot count silently RESIZED the player:
 * a two-slot save turned a 36-slot player into a two-slot one, and the next
 * 1000 mined blocks became 128 accepted and 872 on the floor with no symptom
 * beyond a full inventory. A snapshot crosses a version boundary, which is
 * exactly the moment a slot count changes, so the load path is where the length
 * has to be re-established.
 *
 * Four repairs, and none of them destroys an item it does not report:
 *
 *   1. LENGTH. The result is always exactly `INVENTORY_SLOT_COUNT` slots. A
 *      short save is padded; a long one has its tail re-inserted rather than
 *      truncated away.
 *   2. OVER-FULL SLOTS. A slot holding more than `MAX_STACK_COUNT` keeps a full
 *      stack and the surplus is re-inserted. This is what makes `removeItem`'s
 *      clamp unreachable for anything that came through here.
 *   3. EMPTY AND NON-NUMERIC STACKS. A slot holding 0, a fraction or `NaN`
 *      becomes an empty slot; a fraction is floored first, so the whole part of
 *      it survives.
 *   4. ITEMS THAT ARE NOT ITEMS. A slot whose name is not in kernel's
 *      `ITEM_TYPES` is removed and counted in `discarded`. See below.
 *
 * Everything re-inserted goes back through `addItem`, so the top-up-first rule
 * and `MAX_STACK_COUNT` apply to a repaired inventory exactly as they do to a
 * mined one, and whatever still does not fit is returned as `leftover`.
 *
 * ---------------------------------------------------------------------------
 * Why repair 4 exists, and why it looks like dead code
 * ---------------------------------------------------------------------------
 *
 * `Slot.item` is typed `ItemType`, so `isItemType` cannot fail on a value this
 * repository produced, and TypeScript narrows the rejecting branch to `never`.
 * That is precisely the argument for testing it: THE VALUES THIS FUNCTION
 * EXISTS FOR DO NOT COME FROM THIS REPOSITORY. A saved inventory is item names
 * in a file, parsed by mc-save and handed back through `restore`, and JSON is
 * not checked by anything. Kernel's own header makes the point — `isItemType`
 * is for "values arriving from outside the type system (save files, network
 * frames, developer consoles)", and a save file is the one such boundary mc-sim
 * has.
 *
 * Before the repoint this could not go wrong: `ItemId` was `string`, so a save
 * naming `'DIAMOND'` produced a slot that was odd but legal. Closing the union
 * is what turns it into a value that disagrees with its own type — held by
 * `countOf`, invisible to every recipe, undroppable, and permanent. The repoint
 * created this hole and closes it in the same commit.
 */
export const normaliseInventory = (inventory: Inventory): NormaliseOutcome => {
  const slots: Array<Slot> = Array.from({ length: INVENTORY_SLOT_COUNT }, () => undefined)
  // A plain count, NOT a `StackCount`: a spilled quantity may legitimately
  // exceed one stack, which is precisely the input `addItem` takes unbranded.
  const spilled: Array<{ readonly item: ItemType; readonly count: number }> = []
  let discarded = 0

  inventory.slots.forEach((slot, index) => {
    if (slot === undefined) {
      return
    }
    const held = heldCount(slot)
    if (held === 0) {
      return
    }
    if (!isItemType(slot.item)) {
      discarded += held
      return
    }
    if (index >= INVENTORY_SLOT_COUNT) {
      spilled.push({ item: slot.item, count: held })
      return
    }
    slots[index] = { item: slot.item, count: derivedStackCount(held) }
    if (held > MAX_STACK_COUNT) {
      spilled.push({ item: slot.item, count: held - MAX_STACK_COUNT })
    }
  })

  return spilled.reduce<NormaliseOutcome>(
    (carried, stack) => {
      const outcome = addItem(carried.inventory, stack.item, stack.count)
      return {
        inventory: outcome.inventory,
        leftover: carried.leftover + outcome.leftover,
        discarded: carried.discarded,
      }
    },
    { inventory: { slots }, leftover: 0, discarded },
  )
}
