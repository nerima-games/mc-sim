/**
 * InventoryService — the Ref wrapper around `domain/inventory.ts`.
 *
 * `add` and `remove` are `Ref.modify`, not get-then-set. Two mining stages, a
 * network item-sync and an autosave read can all be in flight at once; a
 * read-modify-write split across two Effects loses one of them. This is the
 * TOCTOU convention from plan.md §3.8, and it is the reason the domain
 * functions return `{ inventory, leftover }` rather than mutating: the tuple is
 * exactly what `Ref.modify` wants.
 */
import { Context, Effect, Layer, Ref } from 'effect'
import * as Craft from '../domain/crafting'
import * as Eq from '../domain/equipment'
import * as Inv from '../domain/inventory'
import type { ItemType } from '@nerima-games/mc-kernel'
import * as Storage from '../domain/player-storage'
import * as Recipe from '../domain/recipe'

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

type InventoryClickOutcome = {
  readonly inventory: Inv.Inventory
  readonly result: InventoryClickResult
}

const validCarried = (carried: InventoryCarriedSlot): boolean =>
  carried === undefined ||
  (Number.isInteger(carried.count) && carried.count > 0 &&
    carried.count <= Inv.maxStackCountForItem(carried.item) &&
    (Eq.isEquippableItemType(carried.item)
      ? carried.durability === undefined ||
        Eq.isValidDurabilityForItem(carried.item, carried.durability)
      : carried.durability === undefined))

/** Apply one Minecraft-style slot click without exposing an intermediate inventory. */
const clickInventory = (inventory: Inv.Inventory, click: InventoryClick): InventoryClickOutcome => {
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
  if (click._tag === 'LeftClick') {
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

export type InventoryServiceApi = {
  /**
   * Insert items. Resolves to the number that did NOT fit.
   *
   * A non-zero leftover is not an error — see `domain/inventory.ts`. The caller
   * in mx-gameplay turns it into a dropped-item entity.
   *
   * ---------------------------------------------------------------------------
   * THIS IS THE MINING SEAM, and it did not need a new method
   * ---------------------------------------------------------------------------
   *
   * "Mining a block puts an item in your inventory" is the join mc-compose could
   * not write, and the reason was never a missing method here: it was that
   * kernel's `dropOfBlockId(id, context?)` answers with a `BlockDrop` whose
   * `item` is an `ItemType`, and this signature took a `string`, so the two ends
   * met at a type that could not be wrong and therefore could not be right
   * either. Now they are the same type, and the host's half is
   *
   *   const drop = dropOfBlockId(brokenBlockId, { heldTier })
   *   if (drop !== undefined) yield* inventory.add(drop.item, drop.count)
   *
   * which typechecks end to end with no adapter and no cast.
   *
   * NOTHING WAS ADDED HERE FOR IT, deliberately. An `addDrop(drop: BlockDrop)`
   * would put the verb in the noun tier (plan.md §2.3-1 gives mining to
   * mx-gameplay), would make mc-sim mirror `BlockDrop`, `HarvestContext` and the
   * tool gate it has no other use for, and would grow the surface plan.md §8
   * names as this repository's top risk — all to save a host one `if`. The
   * fortune roll, the tool gate and the "did it drop at all" decision are
   * gameplay's, and `BlockDrop.affectedByFortune` exists so gameplay can make
   * them. mc-sim's part is to be told a number.
   */
  readonly add: (item: ItemType, count: number) => Effect.Effect<number>
  /** Take items. Resolves to the number actually taken. */
  readonly remove: (item: ItemType, count: number) => Effect.Effect<number>
  /** Remove exactly `count` items from the selected slot when its item still matches. */
  readonly removeAt: (
    slotIndex: number,
    expectedItem: ItemType,
    count: number,
  ) => Effect.Effect<Inv.RemoveAtResult>
  /** Atomically apply one left or right slot click and return the new carried stack. */
  readonly click: (click: InventoryClick) => Effect.Effect<InventoryClickResult>
  readonly countOf: (item: ItemType) => Effect.Effect<number>
  readonly snapshot: Effect.Effect<Inv.Inventory>
  readonly equipmentSnapshot: Effect.Effect<Eq.Equipment>
  readonly storageSnapshot: Effect.Effect<Storage.PlayerStorage>
  readonly restoreStorage: (
    snapshot: unknown,
  ) => Effect.Effect<void, Storage.PlayerStorageValidationError>
  readonly equipFromInventory: (
    inventorySlot: number,
    equipmentSlot: Eq.EquipmentSlot,
  ) => Effect.Effect<Storage.EquipFromInventoryResult>
  readonly unequipToInventory: (
    equipmentSlot: Eq.EquipmentSlot,
    inventorySlot?: number,
  ) => Effect.Effect<Storage.UnequipToInventoryResult>
  readonly damageAt: (
    location: Storage.StorageLocation,
    amount: number,
  ) => Effect.Effect<Storage.DamageAtResult>
  /**
   * Install a saved inventory. THE WORLD-LOAD PATH. Resolves to the number of
   * items the repaired inventory had no room for — same currency as `add`.
   *
   * The snapshot is repaired by `Inv.normaliseInventory` before it is
   * installed, and the reason is the version boundary a save crosses: this used
   * to install whatever it was handed, so a two-slot save turned a 36-slot
   * player into a two-slot one and the next 872 mined blocks went on the floor
   * with no symptom but a full inventory. The result now always has exactly
   * `INVENTORY_SLOT_COUNT` slots and no stack outside [0, `MAX_STACK_COUNT`],
   * which is also what makes `Inv.removeItem` unable to meet a count it has to
   * repair.
   *
   * Resolving to the leftover rather than `void` is the same decision `add`
   * makes: a shrinking slot count is an ordinary game state whose consequence
   * is items on the ground, and swallowing the number here would delete them.
   *
   * WHAT THIS NUMBER IS NOT. `Inv.normaliseInventory` now also DISCARDS slots
   * whose item is not in kernel's `ITEM_TYPES` — a save from a build with a
   * different roster — and reports them as `NormaliseOutcome.discarded`. That
   * count is not folded in here and not returned, because the two numbers ask
   * the caller for different things: a leftover becomes an entity on the
   * ground, and a discard cannot, since there is no such item to spawn. A host
   * that wants to tell the player is not blocked — `normaliseInventory` is
   * public, pure, and returns both numbers, so calling it before `restore`
   * gives the full accounting and costs one repair that is idempotent.
   */
  readonly restore: (inventory: Inv.Inventory) => Effect.Effect<number>
  /**
   * Empty the inventory.
   *
   * Present from day one because this service is reused across world loads.
   * The reference's equivalent omission is documented at
   * ts-minecraft/packages/game/application/game-state-service.ts:87-92: the
   * second world inherited the first world's state and `player.create` failed
   * with "Player already exists", killing session init.
   */
  readonly reset: Effect.Effect<void>
  /**
   * The recipes this world knows. Read-only, and world-scoped rather than
   * global so that two `makeInventoryService` calls are two worlds with two
   * tables (DN-09), which is what a preview harness and a modded session need.
   *
   * Published because mx-ui's recipe book has to list something, and the only
   * alternative is mx-ui keeping its own copy — which is plan.md §2.3-1's
   * failure mode with a table instead of a rule.
   */
  readonly recipes: Effect.Effect<Recipe.RecipeTable>
  /**
   * What `grid` would make, without making it.
   *
   * This is the value mx-ui's `CraftingSnapshot.result` is a projection of. It
   * is deliberately the SAME answer `craft` computes, from the same table, so
   * the output square cannot promise something the click will not deliver.
   */
  readonly previewCraft: (grid: Recipe.CraftGrid) => Effect.Effect<Recipe.RecipeMatch>
  /**
   * Take one craft: charge the ingredients, credit the result.
   *
   * ONE `Ref.modify`, and it is on this service rather than on a separate
   * CraftingService for exactly that reason. A crafting service holding its own
   * Ref would have to read this inventory, decide, and write it back, and the
   * window between the read and the write is the TOCTOU hazard DN-07 exists to
   * close — with a worse payload than a lost stack, because the ingredients and
   * the result are two writes and losing either one duplicates or deletes items.
   *
   * Every failure leaves the inventory byte-identical; see
   * `domain/crafting.ts`.
   */
  readonly craft: (grid: Recipe.CraftGrid) => Effect.Effect<Craft.CraftResult>
}

export class InventoryService extends Context.Tag('@nerima-games/mc-sim/InventoryService')<
  InventoryService,
  InventoryServiceApi
>() {}

/**
 * Build an InventoryService over a fresh Ref.
 *
 * `initial` goes through `Inv.normaliseInventory` for the same reason
 * `restore` does — it is the other way an inventory this module did not build
 * gets in, and a service that starts life with two slots is the SIM-2 defect
 * with a different entry point. The constructor drops the leftover on the floor
 * because a world that does not exist yet has no floor to drop onto; a caller
 * that needs the number loads through `restore`, which is the world-load path
 * and returns it.
 */
export const makeInventoryService = (
  initial: Inv.Inventory = Inv.emptyInventory(),
  recipeTable: Recipe.RecipeTable = Recipe.STARTER_RECIPES,
): Effect.Effect<InventoryServiceApi> =>
  Effect.map(
    Ref.make(Storage.storageFromInventory(Inv.normaliseInventory(initial).inventory)),
    (state) => ({
    add: (item, count) =>
      Ref.modify(state, (current) => {
        const outcome = Inv.addItem(current.inventory, item, count)
        return [outcome.leftover, Storage.withInventory(current, outcome.inventory)]
      }),
    remove: (item, count) =>
      Ref.modify(state, (current) => {
        const outcome = Inv.removeItem(current.inventory, item, count)
        return [outcome.removed, Storage.withInventory(current, outcome.inventory)]
      }),
    removeAt: (slotIndex, expectedItem, count) =>
      Ref.modify(state, (current) => {
        const outcome = Inv.removeItemAt(current.inventory, slotIndex, expectedItem, count)
        return [outcome.result, Storage.withInventory(current, outcome.inventory)]
      }),
    click: (click) =>
      Ref.modify(state, (current) => {
        const beforeDurability = current.inventoryDurability[click.slotIndex]
        const outcome = clickInventory(current.inventory, click)
        let next = Storage.withInventory(current, outcome.inventory)
        if ((outcome.result._tag === 'Placed' || outcome.result._tag === 'Swapped' ||
             outcome.result._tag === 'Merged') && click.carried !== undefined &&
            Eq.isEquippableItemType(click.carried.item)) {
          const durability = click.carried.durability ?? Eq.durabilityForItem(click.carried.item)
          const values = [...next.inventoryDurability]
          values[click.slotIndex] = durability === null ? null : { ...durability }
          next = { ...next, inventoryDurability: values }
        }
        const result = (outcome.result._tag === 'PickedUp' || outcome.result._tag === 'Swapped') &&
          Eq.isEquippableItemType(outcome.result.carried.item) && beforeDurability !== null &&
          beforeDurability !== undefined
          ? { ...outcome.result, carried: { ...outcome.result.carried, durability: beforeDurability } }
          : outcome.result
        return [result, next]
      }),
    countOf: (item) => Ref.get(state).pipe(Effect.map((current) => Inv.countOf(current.inventory, item))),
    snapshot: Ref.get(state).pipe(Effect.map((current) => current.inventory)),
    equipmentSnapshot: Ref.get(state).pipe(Effect.map((current) => current.equipment)),
    storageSnapshot: Ref.get(state),
    restoreStorage: (snapshot) => {
      const validated = Storage.validatePlayerStorageSnapshot(snapshot)
      return validated._tag === 'Invalid'
        ? Effect.fail(validated.error)
        : Ref.set(state, validated.storage)
    },
    equipFromInventory: (inventorySlot, equipmentSlot) =>
      Ref.modify(state, (current) => {
        const outcome = Storage.equipFromInventory(current, inventorySlot, equipmentSlot)
        return [outcome.result, outcome.storage]
      }),
    unequipToInventory: (equipmentSlot, inventorySlot) =>
      Ref.modify(state, (current) => {
        const outcome = Storage.unequipToInventory(current, equipmentSlot, inventorySlot)
        return [outcome.result, outcome.storage]
      }),
    damageAt: (location, amount) =>
      Ref.modify(state, (current) => {
        const outcome = Storage.damageAt(current, location, amount)
        return [outcome.result, outcome.storage]
      }),
    restore: (inventory) =>
      Ref.modify(state, (current) => {
        const outcome = Inv.normaliseInventory(inventory)
        return [outcome.leftover, Storage.withInventory(current, outcome.inventory)]
      }),
    reset: Ref.set(state, Storage.emptyPlayerStorage()),
    recipes: Effect.succeed(recipeTable),
    previewCraft: (grid) => Effect.sync(() => Recipe.matchRecipe(recipeTable, grid)),
    craft: (grid) =>
      Ref.modify(state, (current) => {
        const outcome = Craft.craftFromGrid(current.inventory, recipeTable, grid)
        return [outcome.result, Storage.withInventory(current, outcome.inventory)]
      }),
    }),
  )

export const InventoryServiceLayer = (
  initial: Inv.Inventory = Inv.emptyInventory(),
  recipeTable: Recipe.RecipeTable = Recipe.STARTER_RECIPES,
): Layer.Layer<InventoryService> =>
  Layer.effect(InventoryService, makeInventoryService(initial, recipeTable))
