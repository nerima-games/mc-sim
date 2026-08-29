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
import * as Container from '../domain/container-storage'
import * as Craft from '../domain/crafting'
import * as Eq from '../domain/equipment'
import * as Hotbar from '../domain/hotbar'
import * as Inv from '../domain/inventory'
import type { ItemType } from '@nerima-games/mc-kernel'
import * as Storage from '../domain/player-storage'
import * as Recipe from '../domain/recipe'
import { STARTER_RECIPES } from '../domain/recipe-data'
import {
  carriedAt,
  carriedWithCount,
  clickInventory,
  copyCarried,
  isValidSlotIndex,
  sameCarried,
  sameDurability,
  validCarried,
  withCarriedSlots,
} from './inventory-interaction'
import type {
  InventoryCarriedSlot,
  InventoryCarriedStack,
  InventoryClick,
  InventoryClickResult,
} from './inventory-interaction'

export type {
  InventoryCarriedSlot,
  InventoryCarriedStack,
  InventoryClick,
  InventoryClickResult,
} from './inventory-interaction'

export type InventorySetSlotResult =
  | { readonly _tag: 'Updated'; readonly slot: InventoryCarriedSlot }
  | { readonly _tag: 'InvalidSlot' }
  | { readonly _tag: 'InvalidStack' }

export type InventoryMoveResult =
  | {
      readonly _tag: 'Moved' | 'Merged' | 'Swapped'
      readonly moved: number
      readonly source: InventoryCarriedSlot
      readonly target: InventoryCarriedSlot
    }
  | { readonly _tag: 'InvalidSlot' }
  | { readonly _tag: 'EmptySlot' }
  | { readonly _tag: 'NoChange' }

export type InventoryQuickMoveResult =
  | {
      readonly _tag: 'Moved'
      readonly moved: number
      readonly source: InventoryCarriedSlot
    }
  | { readonly _tag: 'InvalidSlot' }
  | { readonly _tag: 'EmptySlot' }
  | { readonly _tag: 'NoChange' }

export type InventorySortResult =
  | { readonly _tag: 'Sorted' }
  | { readonly _tag: 'NoChange' }

/** A world-container address owned by the host's dimension and block coordinates. */
export type ContainerPositionAddress = {
  readonly dimension: string
  readonly position: Container.ContainerPosition
}

/** One fixed-count hopper-style transfer between two world-container positions. */
export type MoveOneContainerItemAtRequest = {
  readonly source: ContainerPositionAddress
  readonly sourceSlot: number
  readonly destination: ContainerPositionAddress
  readonly destinationSlot: number
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
  /** Insert one exact item stack, preserving durability and returning anything that did not fit. */
  readonly addStoredStack: (
    stack: Container.ContainerStoredStack,
  ) => Effect.Effect<Storage.AddStoredStackResult>
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
  /** Read one slot including tool durability without exposing mutable state. */
  readonly getSlot: (slotIndex: number) => Effect.Effect<InventoryCarriedSlot>
  /** Read the nine hotbar slots in their player-inventory order. */
  readonly getHotbarSlots: Effect.Effect<ReadonlyArray<InventoryCarriedSlot>>
  /** Replace one slot atomically, validating the stack before mutation. */
  readonly setSlot: (
    slotIndex: number,
    slot: InventoryCarriedSlot,
  ) => Effect.Effect<InventorySetSlotResult>
  /** Move, merge, or exchange two player inventory slots atomically. */
  readonly moveStack: (
    sourceIndex: number,
    targetIndex: number,
  ) => Effect.Effect<InventoryMoveResult>
  /** Shift-click a stack between the main inventory and hotbar. */
  readonly quickMove: (slotIndex: number) => Effect.Effect<InventoryQuickMoveResult>
  /** Canonically sort inventory stacks while keeping durability attached. */
  readonly sortInventory: Effect.Effect<InventorySortResult>
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
  /** Atomically consume inventory items and damage the expected item at a captured location. */
  readonly consumeAndDamageAt: (
    request: Storage.ConsumeAndDamageAtRequest,
  ) => Effect.Effect<Storage.ConsumeAndDamageAtResult>
  /** Create one fixed-capacity container under a stable host-defined id. */
  readonly createContainer: (
    id: Container.ContainerId,
    kind?: Container.ContainerKind,
  ) => Effect.Effect<Container.CreateContainerResult>
  /** Create one fixed-capacity container at a dimension-qualified block position. */
  readonly createContainerAt: (
    dimension: string,
    position: Container.ContainerPosition,
    kind?: Container.ContainerKind,
  ) => Effect.Effect<Container.CreateContainerResult>
  /** Read one container without exposing the service's mutable state. */
  readonly containerSnapshot: (
    id: Container.ContainerId,
  ) => Effect.Effect<Container.Container | null>
  /** Resolve a stable block id and read one container without exposing service state. */
  readonly containerSnapshotAt: (
    dimension: string,
    position: Container.ContainerPosition,
  ) => Effect.Effect<Container.Container | null>
  /** JSON-safe, versioned snapshot of all containers. */
  readonly containerStorageSnapshot: Effect.Effect<Container.ContainerStorageSnapshot>
  /** Strictly restore all containers, leaving current state intact on validation failure. */
  readonly restoreContainerStorage: (
    snapshot: unknown,
  ) => Effect.Effect<void, Container.ContainerStorageValidationError>
  /** Atomically move items between a player slot and a chest slot. */
  readonly transferContainerItem: (
    request: Container.ContainerTransferRequest,
  ) => Effect.Effect<Container.ContainerTransferResult>
  /** Atomically remove items for a machine action such as dispenser output. */
  readonly extractContainerItem: (
    request: Container.ContainerExtractRequest,
  ) => Effect.Effect<Container.ContainerExtractResult>
  /** Atomically remove exactly one item at a dimension-qualified block position. */
  readonly extractOneContainerItemAt: (
    dimension: string,
    position: Container.ContainerPosition,
    containerSlot: number,
  ) => Effect.Effect<Container.ContainerExtractResult>
  /** Atomically move items between world containers for machine automation. */
  readonly moveContainerItem: (
    request: Container.ContainerMoveRequest,
  ) => Effect.Effect<Container.ContainerMoveResult>
  /** Atomically move exactly one item between dimension-qualified block positions. */
  readonly moveOneContainerItemAt: (
    request: MoveOneContainerItemAtRequest,
  ) => Effect.Effect<Container.ContainerMoveResult>
  /** Remove a broken chest and return its contents exactly once. */
  readonly drainContainer: (
    id: Container.ContainerId,
  ) => Effect.Effect<Container.DrainContainerResult>
  /**
   * Install a saved inventory. THE WORLD-LOAD PATH. Resolves to the number of
   * items the repaired inventory had no room for — same currency as `add`.
   *
   * The snapshot is repaired by `Inv.normaliseInventory` before it is
   * installed, and the reason is the version boundary a save crosses: this used
   * to install whatever it was handed, so a two-slot save turned a 36-slot
   * player into a two-slot one and the next 872 mined blocks went on the floor
   * with no symptom but a full inventory. The result now always has exactly
   * `INVENTORY_SLOT_COUNT` slots and no stack outside the item's kernel limit,
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

type InventoryServiceState = {
  readonly player: Storage.PlayerStorage
  readonly containers: Container.ContainerStorage
}

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
  recipeTable: Recipe.RecipeTable = STARTER_RECIPES,
): Effect.Effect<InventoryServiceApi> =>
  Effect.map(
    Ref.make<InventoryServiceState>({
      player: Storage.storageFromInventory(Inv.normaliseInventory(initial).inventory),
      containers: Container.emptyContainerStorage(),
    }),
    (state) => ({
    add: (item, count) =>
      Ref.modify(state, (current) => {
        const outcome = Inv.addItem(current.player.inventory, item, count)
        return [outcome.leftover, {
          ...current,
          player: Storage.withInventory(current.player, outcome.inventory),
        }]
      }),
    addStoredStack: (stack) =>
      Ref.modify(state, (current) => {
        const outcome = Storage.addStoredStack(current.player, stack)
        return [outcome.result, { ...current, player: outcome.storage }]
      }),
    remove: (item, count) =>
      Ref.modify(state, (current) => {
        const outcome = Inv.removeItem(current.player.inventory, item, count)
        return [outcome.removed, {
          ...current,
          player: Storage.withInventory(current.player, outcome.inventory),
        }]
      }),
    removeAt: (slotIndex, expectedItem, count) =>
      Ref.modify(state, (current) => {
        const outcome = Inv.removeItemAt(current.player.inventory, slotIndex, expectedItem, count)
        return [outcome.result, {
          ...current,
          player: Storage.withInventory(current.player, outcome.inventory),
        }]
      }),
    click: (click) =>
      Ref.modify(state, (current) => {
        const beforeDurability = current.player.inventoryDurability[click.slotIndex]
        const outcome = clickInventory(current.player.inventory, click)
        let next = Storage.withInventory(current.player, outcome.inventory)
        if ((outcome.result._tag === 'Placed' || outcome.result._tag === 'Swapped' ||
             outcome.result._tag === 'Merged') && click.carried !== undefined &&
            Eq.isDamageableItemType(click.carried.item)) {
          const durability = click.carried.durability ?? Eq.durabilityForItem(click.carried.item)
          const values = [...next.inventoryDurability]
          values[click.slotIndex] = { ...durability }
          next = { ...next, inventoryDurability: values }
        }
        const result = (outcome.result._tag === 'PickedUp' || outcome.result._tag === 'Swapped') &&
          Eq.isDamageableItemType(outcome.result.carried.item) && beforeDurability !== null &&
          beforeDurability !== undefined
          ? { ...outcome.result, carried: { ...outcome.result.carried, durability: beforeDurability } }
          : outcome.result
        return [result, { ...current, player: next }]
      }),
    getSlot: (slotIndex) => Ref.get(state).pipe(
      Effect.map((current) => isValidSlotIndex(slotIndex) ? carriedAt(current.player, slotIndex) : undefined),
    ),
    getHotbarSlots: Ref.get(state).pipe(
      Effect.map((current) => Array.from(
        { length: Hotbar.HOTBAR_SIZE },
        (_, offset) => carriedAt(current.player, Hotbar.HOTBAR_START + offset),
      )),
    ),
    setSlot: (slotIndex, slot) =>
      Ref.modify(state, (current): readonly [InventorySetSlotResult, InventoryServiceState] => {
        if (!isValidSlotIndex(slotIndex)) {
          return [{ _tag: 'InvalidSlot' }, current]
        }
        if (!validCarried(slot)) {
          return [{ _tag: 'InvalidStack' }, current]
        }
        const carriedSlots = current.player.inventory.slots.map((_, index) =>
          index === slotIndex ? copyCarried(slot) : carriedAt(current.player, index))
        return [{ _tag: 'Updated', slot: copyCarried(slot) }, {
          ...current,
          player: withCarriedSlots(current.player, carriedSlots),
        }]
      }),
    moveStack: (sourceIndex, targetIndex) =>
      Ref.modify(state, (current): readonly [InventoryMoveResult, InventoryServiceState] => {
        if (!isValidSlotIndex(sourceIndex) || !isValidSlotIndex(targetIndex)) {
          return [{ _tag: 'InvalidSlot' }, current]
        }
        if (sourceIndex === targetIndex) return [{ _tag: 'NoChange' }, current]
        const carriedSlots = current.player.inventory.slots.map((_, index) => carriedAt(current.player, index))
        const source = carriedSlots[sourceIndex]
        const target = carriedSlots[targetIndex]
        if (source === undefined) return [{ _tag: 'EmptySlot' }, current]

        if (target === undefined) {
          carriedSlots[targetIndex] = source
          carriedSlots[sourceIndex] = undefined
          return [{
            _tag: 'Moved', moved: source.count,
            source: undefined, target: copyCarried(source),
          }, { ...current, player: withCarriedSlots(current.player, carriedSlots) }]
        }

        if (source.item === target.item &&
            sameDurability(source.durability, target.durability) &&
            target.count < Inv.maxStackCountForItem(target.item)) {
          const moved = Math.min(source.count, Inv.maxStackCountForItem(target.item) - target.count)
          const remaining = source.count - moved
          carriedSlots[targetIndex] = carriedWithCount(target, target.count + moved)
          carriedSlots[sourceIndex] = remaining === 0 ? undefined : carriedWithCount(source, remaining)
          return [{
            _tag: 'Merged', moved,
            source: copyCarried(carriedSlots[sourceIndex]), target: copyCarried(carriedSlots[targetIndex]),
          }, { ...current, player: withCarriedSlots(current.player, carriedSlots) }]
        }

        carriedSlots[sourceIndex] = target
        carriedSlots[targetIndex] = source
        return [{
          _tag: 'Swapped', moved: source.count,
          source: copyCarried(target), target: copyCarried(source),
        }, { ...current, player: withCarriedSlots(current.player, carriedSlots) }]
      }),
    quickMove: (slotIndex) =>
      Ref.modify(state, (current): readonly [InventoryQuickMoveResult, InventoryServiceState] => {
        if (!isValidSlotIndex(slotIndex)) return [{ _tag: 'InvalidSlot' }, current]
        const carriedSlots = current.player.inventory.slots.map((_, index) => carriedAt(current.player, index))
        const source = carriedSlots[slotIndex]
        if (source === undefined) return [{ _tag: 'EmptySlot' }, current]
        const first = slotIndex < Hotbar.HOTBAR_START ? Hotbar.HOTBAR_START : 0
        const last = slotIndex < Hotbar.HOTBAR_START ? Inv.INVENTORY_SLOT_COUNT : Hotbar.HOTBAR_START
        let remaining = Number(source.count)
        for (let index = first; index < last && remaining > 0; index += 1) {
          const target = carriedSlots[index]
          if (target?.item !== source.item || !sameDurability(target.durability, source.durability)) continue
          const accepted = Math.min(remaining, Inv.maxStackCountForItem(source.item) - target.count)
          if (accepted <= 0) continue
          carriedSlots[index] = carriedWithCount(target, target.count + accepted)
          remaining -= accepted
        }
        for (let index = first; index < last && remaining > 0; index += 1) {
          if (carriedSlots[index] !== undefined) continue
          const accepted = Math.min(remaining, Inv.maxStackCountForItem(source.item))
          carriedSlots[index] = carriedWithCount(source, accepted)
          remaining -= accepted
        }
        const moved = source.count - remaining
        if (moved === 0) return [{ _tag: 'NoChange' }, current]
        carriedSlots[slotIndex] = remaining === 0 ? undefined : carriedWithCount(source, remaining)
        return [{
          _tag: 'Moved', moved, source: copyCarried(carriedSlots[slotIndex]),
        }, { ...current, player: withCarriedSlots(current.player, carriedSlots) }]
      }),
    sortInventory: Ref.modify(state, (current): readonly [InventorySortResult, InventoryServiceState] => {
      const carriedSlots = current.player.inventory.slots.map((_, index) => carriedAt(current.player, index))
      const sorted = carriedSlots
        .filter((slot): slot is InventoryCarriedStack => slot !== undefined)
        .sort((left, right) => left.item < right.item ? -1 : left.item > right.item ? 1 : right.count - left.count)
      const nextSlots = [...sorted, ...Array.from({ length: Inv.INVENTORY_SLOT_COUNT - sorted.length }, () => undefined)]
      if (carriedSlots.every((slot, index) => sameCarried(slot, nextSlots[index]))) {
        return [{ _tag: 'NoChange' }, current]
      }
      return [{ _tag: 'Sorted' }, { ...current, player: withCarriedSlots(current.player, nextSlots) }]
    }),
    countOf: (item) => Ref.get(state).pipe(
      Effect.map((current) => Inv.countOf(current.player.inventory, item)),
    ),
    snapshot: Ref.get(state).pipe(Effect.map((current) => current.player.inventory)),
    equipmentSnapshot: Ref.get(state).pipe(Effect.map((current) => current.player.equipment)),
    storageSnapshot: Ref.get(state).pipe(Effect.map((current) => current.player)),
    restoreStorage: (snapshot) => {
      const validated = Storage.validatePlayerStorageSnapshot(snapshot)
      return validated._tag === 'Invalid'
        ? Effect.fail(validated.error)
        : Ref.update(state, (current) => ({ ...current, player: validated.storage }))
    },
    equipFromInventory: (inventorySlot, equipmentSlot) =>
      Ref.modify(state, (current) => {
        const outcome = Storage.equipFromInventory(current.player, inventorySlot, equipmentSlot)
        return [outcome.result, { ...current, player: outcome.storage }]
      }),
    unequipToInventory: (equipmentSlot, inventorySlot) =>
      Ref.modify(state, (current) => {
        const outcome = Storage.unequipToInventory(current.player, equipmentSlot, inventorySlot)
        return [outcome.result, { ...current, player: outcome.storage }]
      }),
    damageAt: (location, amount) =>
      Ref.modify(state, (current) => {
        const outcome = Storage.damageAt(current.player, location, amount)
        return [outcome.result, { ...current, player: outcome.storage }]
      }),
    consumeAndDamageAt: (request) =>
      Ref.modify(state, (current) => {
        const outcome = Storage.consumeAndDamageAt(current.player, request)
        return [outcome.result, { ...current, player: outcome.storage }]
      }),
    createContainer: (id, kind) =>
      Ref.modify(state, (current) => {
        const outcome = Container.createContainer(current.containers, id, kind)
        return [outcome.result, { ...current, containers: outcome.storage }]
      }),
    createContainerAt: (dimension, position, kind) =>
      Ref.modify(state, (current) => {
        const outcome = Container.createContainer(
          current.containers,
          Container.containerIdAt(dimension, position),
          kind,
        )
        return [outcome.result, { ...current, containers: outcome.storage }]
      }),
    containerSnapshot: (id) => Ref.get(state).pipe(
      Effect.map((current) => Container.findContainer(current.containers, id) ?? null),
    ),
    containerSnapshotAt: (dimension, position) => Ref.get(state).pipe(
      Effect.map((current) => Container.findContainer(
        current.containers,
        Container.containerIdAt(dimension, position),
      ) ?? null),
    ),
    containerStorageSnapshot: Ref.get(state).pipe(
      Effect.map((current) => Container.snapshotContainerStorage(current.containers)),
    ),
    restoreContainerStorage: (snapshot) => {
      const validated = Container.validateContainerStorageSnapshot(snapshot)
      return validated._tag === 'Invalid'
        ? Effect.fail(validated.error)
        : Ref.update(state, (current) => ({ ...current, containers: validated.storage }))
    },
    transferContainerItem: (request) =>
      Ref.modify(state, (current) => {
        const outcome = Container.transferContainerItem(
          current.player,
          current.containers,
          request,
        )
        return [outcome.result, {
          player: outcome.playerStorage,
          containers: outcome.containerStorage,
        }]
      }),
    extractContainerItem: (request) =>
      Ref.modify(state, (current) => {
        const outcome = Container.extractContainerItem(current.containers, request)
        return [outcome.result, { ...current, containers: outcome.storage }]
      }),
    extractOneContainerItemAt: (dimension, position, containerSlot) =>
      Ref.modify(state, (current) => {
        const outcome = Container.extractContainerItem(current.containers, {
          containerId: Container.containerIdAt(dimension, position),
          containerSlot,
          count: 1,
        })
        return [outcome.result, { ...current, containers: outcome.storage }]
      }),
    moveContainerItem: (request) =>
      Ref.modify(state, (current) => {
        const outcome = Container.moveContainerItem(current.containers, request)
        return [outcome.result, { ...current, containers: outcome.storage }]
      }),
    moveOneContainerItemAt: (request) =>
      Ref.modify(state, (current) => {
        const outcome = Container.moveContainerItem(current.containers, {
          sourceContainerId: Container.containerIdAt(
            request.source.dimension,
            request.source.position,
          ),
          sourceSlot: request.sourceSlot,
          destinationContainerId: Container.containerIdAt(
            request.destination.dimension,
            request.destination.position,
          ),
          destinationSlot: request.destinationSlot,
          count: 1,
        })
        return [outcome.result, { ...current, containers: outcome.storage }]
      }),
    drainContainer: (id) =>
      Ref.modify(state, (current) => {
        const outcome = Container.drainContainer(current.containers, id)
        return [outcome.result, { ...current, containers: outcome.storage }]
      }),
    restore: (inventory) =>
      Ref.modify(state, (current) => {
        const outcome = Inv.normaliseInventory(inventory)
        return [outcome.leftover, {
          ...current,
          player: Storage.withInventory(current.player, outcome.inventory),
        }]
      }),
    reset: Ref.set(state, {
      player: Storage.emptyPlayerStorage(),
      containers: Container.emptyContainerStorage(),
    }),
    recipes: Effect.succeed(recipeTable),
    previewCraft: (grid) => Effect.sync(() => Recipe.matchRecipe(recipeTable, grid)),
    craft: (grid) =>
      Ref.modify(state, (current) => {
        const outcome = Craft.craftFromGrid(current.player.inventory, recipeTable, grid)
        return [outcome.result, {
          ...current,
          player: Storage.withInventory(current.player, outcome.inventory),
        }]
      }),
    }),
  )

export const InventoryServiceLayer = (
  initial: Inv.Inventory = Inv.emptyInventory(),
  recipeTable: Recipe.RecipeTable = STARTER_RECIPES,
): Layer.Layer<InventoryService> =>
  Layer.effect(InventoryService, makeInventoryService(initial, recipeTable))
