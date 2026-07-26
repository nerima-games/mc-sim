/**
 * Crafting against an inventory: the transition, as a pure value-to-value step.
 *
 * `domain/recipe.ts` answers "what does this grid make". This module answers
 * "what happens to the 36 slots when the player takes it", and it answers in the
 * shape `Ref.modify` wants — `{ inventory, result }` — because
 * `application/inventory-service.ts` is a one-line wrapper around it and the
 * whole decision has to happen inside a single atomic step (DN-07).
 *
 * ---------------------------------------------------------------------------
 * Why the ingredients come out of the INVENTORY and not out of the grid
 * ---------------------------------------------------------------------------
 *
 * A `CraftGrid` is a value the caller hands in, not state this repository keeps.
 * The grid exists only while a screen is open, a screen is mx-ui's (plan.md
 * §3.13), and mc-sim owning a second item store that has to be kept in step with
 * the 36 slots — and emptied onto the ground when the screen closes — is a
 * second source of truth for "where is the player's stuff".
 *
 * So the grid is read as a SPECIFICATION: it says which recipe and, cell by
 * cell, what it costs. The charge is made against the inventory, once, atomically.
 *
 * What that costs, stated plainly: while a screen is open the items shown in the
 * grid are still in the inventory, so mx-ui is displaying a reservation rather
 * than a move, and two screens open on one inventory could each be shown items
 * the other is about to spend. The second case is not reachable today (there is
 * one local player) and the first is a rendering decision mx-ui already makes
 * for the carried stack. A grid that OWNS its items is the deferred design, and
 * it arrives as inventory state with its own drop-on-close rule — not as a
 * change to this function.
 */
import { addItem, countOf, Inventory, ItemStack, removeItem } from './inventory'
import { ItemType } from './kernel-vocabulary'
import { CraftGrid, cellAt, matchRecipe, RecipeId, RecipeTable } from './recipe'

/**
 * What one craft costs: one item per occupied cell, summed per item id.
 *
 * Insertion order is the grid's reading order, so iteration — and therefore the
 * order ingredients are debited and the order `MissingIngredients` reports them —
 * is deterministic.
 */
export const ingredientCost = (grid: CraftGrid): ReadonlyMap<ItemType, number> => {
  const cost = new Map<ItemType, number>()
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const slot = cellAt(grid, x, y)
      if (slot !== undefined) {
        cost.set(slot.item, (cost.get(slot.item) ?? 0) + 1)
      }
    }
  }
  return cost
}

export type MissingIngredient = {
  readonly item: ItemType
  /** How many more are needed than the inventory holds. Always positive. */
  readonly short: number
}

/**
 * Why a craft did or did not happen.
 *
 * Four cases, and the three failures are distinct on purpose. `NoMatch` is
 * "this layout makes nothing" and belongs to the recipe table; the other two are
 * "it makes something and you cannot have it", which the screen must say
 * differently — an output square greyed for want of a plank and one greyed for
 * want of a slot are different instructions to the player.
 *
 * A failure is a RESULT, not an error channel, for the same reason a full
 * inventory returns `leftover` rather than failing (docs/public-api.md §4): a
 * craft the player cannot complete is an ordinary game state, and putting it in
 * the error channel would make every call site swallow it.
 */
export type CraftResult =
  | { readonly _tag: 'Crafted'; readonly recipeId: RecipeId; readonly output: ItemStack }
  | { readonly _tag: 'NoMatch' }
  | { readonly _tag: 'MissingIngredients'; readonly missing: ReadonlyArray<MissingIngredient> }
  | { readonly _tag: 'NoRoom' }

export type CraftOutcome = {
  readonly inventory: Inventory
  readonly result: CraftResult
}

/**
 * Take one craft from `grid`, charged to `inventory`.
 *
 * ALL-OR-NOTHING. Every failure path returns the inventory it was given, by
 * reference, so a half-applied craft is not merely unlikely but unrepresentable:
 * there is one place where a modified inventory is returned and it is the last
 * line.
 *
 * The order matters and is not cosmetic. Ingredients are removed BEFORE the
 * output is offered, because removing them can free the slot the output needs —
 * checking for room first would refuse the last craft in a full inventory, which
 * is exactly when a player crafts to make room.
 */
export const craftFromGrid = (inventory: Inventory, table: RecipeTable, grid: CraftGrid): CraftOutcome => {
  const match = matchRecipe(table, grid)
  if (match._tag === 'NoMatch') {
    return { inventory, result: { _tag: 'NoMatch' } }
  }

  const cost = ingredientCost(grid)

  const missing = [...cost].flatMap(([item, needed]) => {
    const held = countOf(inventory, item)
    return held >= needed ? [] : [{ item, short: needed - held }]
  })
  if (missing.length > 0) {
    return { inventory, result: { _tag: 'MissingIngredients', missing } }
  }

  let charged = inventory
  for (const [item, needed] of cost) {
    charged = removeItem(charged, item, needed).inventory
  }

  const produced = addItem(charged, match.output.item, match.output.count)
  if (produced.leftover > 0) {
    return { inventory, result: { _tag: 'NoRoom' } }
  }

  return {
    inventory: produced.inventory,
    result: { _tag: 'Crafted', recipeId: match.recipe.id, output: match.output },
  }
}
