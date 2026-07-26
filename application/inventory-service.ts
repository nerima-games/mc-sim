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
import * as Inv from '../domain/inventory'
import * as Recipe from '../domain/recipe'

export type InventoryServiceApi = {
  /**
   * Insert items. Resolves to the number that did NOT fit.
   *
   * A non-zero leftover is not an error — see `domain/inventory.ts`. The caller
   * in mx-gameplay turns it into a dropped-item entity.
   */
  readonly add: (item: Inv.ItemId, count: number) => Effect.Effect<number>
  /** Take items. Resolves to the number actually taken. */
  readonly remove: (item: Inv.ItemId, count: number) => Effect.Effect<number>
  readonly countOf: (item: Inv.ItemId) => Effect.Effect<number>
  readonly snapshot: Effect.Effect<Inv.Inventory>
  readonly restore: (inventory: Inv.Inventory) => Effect.Effect<void>
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

export const makeInventoryService = (
  initial: Inv.Inventory = Inv.emptyInventory(),
  recipeTable: Recipe.RecipeTable = Recipe.STARTER_RECIPES,
): Effect.Effect<InventoryServiceApi> =>
  Effect.map(Ref.make(initial), (state) => ({
    add: (item, count) =>
      Ref.modify(state, (current) => {
        const outcome = Inv.addItem(current, item, count)
        return [outcome.leftover, outcome.inventory]
      }),
    remove: (item, count) =>
      Ref.modify(state, (current) => {
        const outcome = Inv.removeItem(current, item, count)
        return [outcome.removed, outcome.inventory]
      }),
    countOf: (item) => Ref.get(state).pipe(Effect.map((current) => Inv.countOf(current, item))),
    snapshot: Ref.get(state),
    restore: (inventory) => Ref.set(state, inventory),
    reset: Ref.set(state, Inv.emptyInventory()),
    recipes: Effect.succeed(recipeTable),
    previewCraft: (grid) => Effect.sync(() => Recipe.matchRecipe(recipeTable, grid)),
    craft: (grid) =>
      Ref.modify(state, (current) => {
        const outcome = Craft.craftFromGrid(current, recipeTable, grid)
        return [outcome.result, outcome.inventory]
      }),
  }))

export const InventoryServiceLayer = (
  initial: Inv.Inventory = Inv.emptyInventory(),
  recipeTable: Recipe.RecipeTable = Recipe.STARTER_RECIPES,
): Layer.Layer<InventoryService> =>
  Layer.effect(InventoryService, makeInventoryService(initial, recipeTable))
