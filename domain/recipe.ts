/**
 * Recipes as values, and the total function from a laid-out grid to a result.
 *
 * plan.md §7 assigns crafting to "mc-sim (recipes and state) + mx-ui (screens)",
 * and §2.3-1 puts state in the foundation tier. A recipe table is a NOUN — a
 * registry of what exists — so it lives here. "Right-clicking a crafting table
 * opens a screen" is a verb and is not in this repository.
 *
 * The immediate consequence of this file existing: mx-ui's crafting screen
 * currently projects `unknown` for every output square, because
 * `CraftingSnapshot.result` is three-valued and mc-sim had never answered
 * (mx-ui/domain/inventory-view-model.ts, `CraftingResultSnapshot`). It was right
 * not to invent an answer — that is what §2.3-1 forbids. `matchRecipe` is the
 * answer, and `RecipeMatch` is deliberately shaped so that the projection is a
 * rename rather than a derivation.
 *
 * Everything here is pure and TOTAL: `matchRecipe` has no failure channel, no
 * throw and no dependence on table order. `domain/crafting.ts` is the part that
 * touches an inventory; `application/inventory-service.ts` is the Ref wrapper.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately NOT here, and how the types show it
 * ---------------------------------------------------------------------------
 *
 * - `Ingredient` is a tagged union with ONE member, `Exact`. Real crafting needs
 *   "any plank" / "any log" tags, and that arrives as a second member. The
 *   single-member union is not ceremony: every consumer already discriminates on
 *   `_tag`, so adding `Tag` is additive rather than a breaking change to a type
 *   that six repositories read (plan.md §8 risk 2). A bare `ItemType` here would
 *   have made the growth a breaking change and would have looked final.
 * - An ingredient occupies exactly one grid cell and costs exactly one item.
 *   Multi-item cells and remainder items (the bucket that survives a cake) are
 *   not representable and are not silently wrong — they are absent.
 * - Furnaces, brewing, anvils and enchanting are the rest of plan.md §7 and are
 *   not crafting-grid shaped. None of them is modelled here.
 */
import { ItemStack, itemStack, Slot } from './inventory'
import { ItemType } from './kernel-vocabulary'

/**
 * A recipe's identity, namespaced.
 *
 * A bare `string`, and it STAYS one now that `ItemType` has stopped being one.
 * The two are not the same question. An item is a thing the game has to know
 * how to render, stack and drop, so the roster is kernel's and is closed; a
 * recipe is a row in a table that a world may or may not have, and
 * `makeInventoryService` already takes the table per world (DN-09) precisely so
 * that a mod can supply ids at runtime. A literal union here would make the
 * modded world unrepresentable rather than merely unshipped.
 *
 * The asymmetry has a consequence worth stating plainly, because it is easy to
 * meet by accident: a mod can add a RECIPE, but it cannot add an ITEM. Its
 * recipe's output must already be in `ITEM_TYPES`, and putting a new item there
 * is a kernel release. `test/crafting.test.ts`'s world-scoped-table case is
 * written on exactly that boundary.
 *
 * The `mc-sim:` prefix mirrors vanilla's `minecraft:` namespacing and keeps a
 * mod's recipe for a stick distinguishable from this table's.
 *
 * The id is LOAD-BEARING, not decoration: it is the tie-break in the ambiguity
 * rule below, which is what makes matching independent of table order.
 */
export type RecipeId = string

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

/** What a single grid cell must contain. See the header on why this is a union. */
export type Ingredient = { readonly _tag: 'Exact'; readonly item: ItemType }

export const exactly = (item: ItemType): Ingredient => ({ _tag: 'Exact', item })

/** Total: an ingredient either accepts the item in the cell or it does not. */
export const ingredientMatches = (ingredient: Ingredient, item: ItemType): boolean =>
  ingredient._tag === 'Exact' && ingredient.item === item

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/** An empty cell inside a shaped pattern — a hole the player must leave empty. */
export type PatternCell = Ingredient | undefined

/**
 * A shaped recipe's pattern, row-major, with the empty border already trimmed.
 *
 * TRIMMED IS AN INVARIANT, and it is what makes translation cheap. `shapedRecipe`
 * is the only sanctioned constructor and it trims; matching then compares the
 * pattern against the grid's tight occupied bounding box, so a 2x2 pattern is
 * tried at exactly one offset in a 3x3 grid rather than at four. Untrimmed
 * patterns would make "same recipe, drawn with a spare column" a different
 * recipe, which is the classic silent duplicate.
 */
export type RecipePattern = {
  readonly width: number
  readonly height: number
  readonly cells: ReadonlyArray<PatternCell>
}

export type ShapedRecipe = {
  readonly _tag: 'Shaped'
  readonly id: RecipeId
  readonly pattern: RecipePattern
  readonly output: ItemStack
}

export type ShapelessRecipe = {
  readonly _tag: 'Shapeless'
  readonly id: RecipeId
  readonly ingredients: ReadonlyArray<Ingredient>
  readonly output: ItemStack
}

export type Recipe = ShapedRecipe | ShapelessRecipe

/**
 * A recipe registry.
 *
 * An array, not a Map keyed by id: matching is a scan by shape, never a lookup
 * by id, and a Map would suggest otherwise. Order is irrelevant — see
 * `matchRecipe`, and `conflictsIn`, which is how the table proves it.
 */
export type RecipeTable = ReadonlyArray<Recipe>

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

/**
 * A crafting grid as laid out by the player, row-major.
 *
 * `width` is carried rather than assumed so that a player's 2x2 and a crafting
 * table's 3x3 are ONE type with a different number in it. mx-ui's
 * `CraftingSnapshot` already carries `gridWidth` for the same reason.
 *
 * Cells are `Slot` (a stack), not `ItemType`, because that is what a grid actually
 * holds — the player drops a stack of 12 planks into a cell and one is spent.
 * Matching reads only `slot.item`; the count is the caller's, and
 * `domain/crafting.ts` charges one per occupied cell.
 *
 * A grid is a VALUE handed to mc-sim, not state mc-sim keeps. See
 * `docs/responsibility.md` §3.1 for why, and for what that costs.
 */
export type CraftGrid = {
  readonly width: number
  readonly height: number
  readonly cells: ReadonlyArray<Slot>
}

/**
 * Build a grid from item ids, one item per cell.
 *
 * Short input is padded with empty cells, so `craftGrid(3, 3, [])` is an empty
 * 3x3. Long input is ignored past `width * height`. Neither is an error: this is
 * a test and table convenience, and every consumer of `CraftGrid` reads it
 * through `cellAt`, which is bounded.
 */
export const craftGrid = (
  width: number,
  height: number,
  items: ReadonlyArray<ItemType | undefined>,
): CraftGrid => ({
  width,
  height,
  cells: Array.from({ length: Math.max(0, width * height) }, (_unused, index) => {
    const item = items[index]
    return item === undefined ? undefined : itemStack(item, 1)
  }),
})

/**
 * The cell at (x, y), or empty.
 *
 * Out-of-range coordinates and a short `cells` array both read as empty rather
 * than as a crash. That is what "matching is total" means in practice: mx-ui
 * builds these from screen state and a ragged one must produce `NoMatch`, not a
 * defect inside a frame.
 */
export const cellAt = (grid: CraftGrid, x: number, y: number): Slot =>
  x < 0 || y < 0 || x >= grid.width || y >= grid.height ? undefined : grid.cells[y * grid.width + x]

const patternCellAt = (pattern: RecipePattern, x: number, y: number): PatternCell =>
  pattern.cells[y * pattern.width + x]

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * A shaped recipe written the way vanilla's recipe JSON writes one: rows of
 * single-character keys, a legend, and an output.
 *
 * ```ts
 * shapedRecipe('mc-sim:wooden-pickaxe', ['PPP', ' S ', ' S '],
 *   { P: 'oak_planks', S: 'stick' }, itemStack('wooden_pickaxe', 1))
 * ```
 *
 * A space is empty. A character absent from `key` is ALSO empty — the
 * alternative would be a throwing constructor in a pure domain module, and the
 * miskeyed character cannot hide: `test/recipe.test.ts` asserts every recipe in
 * `STARTER_RECIPES` matches its own canonical grid, which a dropped cell breaks
 * immediately.
 *
 * The empty border is trimmed here, which is the invariant `RecipePattern`
 * documents.
 */
export const shapedRecipe = (
  id: RecipeId,
  rows: ReadonlyArray<string>,
  key: Readonly<Record<string, ItemType>>,
  output: ItemStack,
): ShapedRecipe => ({ _tag: 'Shaped', id, pattern: trimPattern(rows, key), output })

const trimPattern = (rows: ReadonlyArray<string>, key: Readonly<Record<string, ItemType>>): RecipePattern => {
  const rawHeight = rows.length
  const rawWidth = rows.reduce((widest, row) => Math.max(widest, row.length), 0)

  const rawCellAt = (x: number, y: number): PatternCell => {
    const character = (rows[y] ?? '')[x]
    const item = character === undefined ? undefined : key[character]
    return item === undefined ? undefined : exactly(item)
  }

  let minX = rawWidth
  let minY = rawHeight
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < rawHeight; y += 1) {
    for (let x = 0; x < rawWidth; x += 1) {
      if (rawCellAt(x, y) === undefined) {
        continue
      }
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < 0) {
    return { width: 0, height: 0, cells: [] }
  }

  const width = maxX - minX + 1
  const height = maxY - minY + 1

  return {
    width,
    height,
    cells: Array.from({ length: width * height }, (_unused, index) =>
      rawCellAt(minX + (index % width), minY + Math.floor(index / width)),
    ),
  }
}

export const shapelessRecipe = (
  id: RecipeId,
  items: ReadonlyArray<ItemType>,
  output: ItemStack,
): ShapelessRecipe => ({ _tag: 'Shapeless', id, ingredients: items.map(exactly), output })

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

type Bounds = {
  readonly minX: number
  readonly minY: number
  readonly width: number
  readonly height: number
}

/** The tight box around the occupied cells, or undefined when the grid is empty. */
const occupiedBounds = (grid: CraftGrid): Bounds | undefined => {
  let minX = grid.width
  let minY = grid.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (cellAt(grid, x, y) === undefined) {
        continue
      }
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  return maxX < 0 ? undefined : { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

const shapedFitsAt = (
  pattern: RecipePattern,
  grid: CraftGrid,
  bounds: Bounds,
  mirrored: boolean,
): boolean => {
  for (let y = 0; y < pattern.height; y += 1) {
    for (let x = 0; x < pattern.width; x += 1) {
      const ingredient = patternCellAt(pattern, mirrored ? pattern.width - 1 - x : x, y)
      const slot = cellAt(grid, bounds.minX + x, bounds.minY + y)

      if (ingredient === undefined) {
        // A hole in the pattern is a REQUIREMENT that the cell be empty, not an
        // absence of one. Without this the pickaxe pattern would be satisfied by
        // a grid that also has a plank in the middle row.
        if (slot !== undefined) {
          return false
        }
        continue
      }
      if (slot === undefined || !ingredientMatches(ingredient, slot.item)) {
        return false
      }
    }
  }
  return true
}

/**
 * A shaped recipe matches under TRANSLATION, and under horizontal MIRRORING.
 *
 * Translation: the pattern is trimmed and the grid's occupied cells are boxed,
 * so "the same 2x2 square anywhere in a 3x3 grid" reduces to comparing two
 * equally-sized rectangles. If the boxes differ in size, nothing can match, and
 * that single check is also what stops a 3x3 recipe from being craftable in the
 * player's 2x2 grid — no separate rule is needed for it.
 *
 * Mirroring: vanilla accepts a shaped recipe and its left-right mirror, which is
 * why a right-handed player and a left-handed one both get a flint and steel.
 * The mirror is horizontal ONLY. A vertical flip is not a mirror of anything —
 * a torch is coal above a stick and never a stick above coal — and accepting one
 * would silently create recipes nobody wrote.
 *
 * NOTE that `STARTER_RECIPES` no longer contains an asymmetric shaped recipe, so
 * nothing in the shipped table can tell the two halves of this function apart:
 * every pattern in it is its own mirror. The rule is exercised by a local table
 * in `test/recipe.test.ts` instead, and the table header explains why the recipe
 * that used to do it (vanilla's diagonal flint and steel) could not be kept.
 * A rule with no case in the shipped data is a rule that silently stops working,
 * so this note is load-bearing: if the mirror is ever deleted as unused, that
 * test is the only thing standing between here and a recipe nobody can craft
 * left-handed.
 */
const matchesShaped = (recipe: ShapedRecipe, grid: CraftGrid): boolean => {
  const bounds = occupiedBounds(grid)
  if (bounds === undefined) {
    return false
  }
  if (bounds.width !== recipe.pattern.width || bounds.height !== recipe.pattern.height) {
    return false
  }
  return (
    shapedFitsAt(recipe.pattern, grid, bounds, false) || shapedFitsAt(recipe.pattern, grid, bounds, true)
  )
}

const occupiedItems = (grid: CraftGrid): ReadonlyArray<ItemType> => {
  const items: Array<ItemType> = []
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const slot = cellAt(grid, x, y)
      if (slot !== undefined) {
        items.push(slot.item)
      }
    }
  }
  return items
}

/**
 * A shapeless recipe matches when its ingredients can be paired one-to-one with
 * the occupied cells — i.e. under every PERMUTATION of the layout.
 *
 * Implemented as backtracking assignment rather than as "sort both and compare",
 * which would be equivalent today (`Exact` ingredients are comparable) and wrong
 * the day `Ingredient` grows a `Tag` member: with overlapping predicates,
 * greedy or sorted pairing rejects assignable grids. The grid is at most nine
 * cells, so the general algorithm costs nothing worth measuring, and choosing it
 * now means the deferred feature is a new union member and not a rewrite.
 */
const matchesShapeless = (recipe: ShapelessRecipe, grid: CraftGrid): boolean => {
  const items = occupiedItems(grid)
  if (items.length === 0 || items.length !== recipe.ingredients.length) {
    return false
  }

  const taken: Array<boolean> = items.map(() => false)

  const assign = (index: number): boolean => {
    const ingredient = recipe.ingredients[index]
    if (ingredient === undefined) {
      return true
    }
    for (let candidate = 0; candidate < items.length; candidate += 1) {
      const item = items[candidate]
      if (taken[candidate] === true || item === undefined || !ingredientMatches(ingredient, item)) {
        continue
      }
      taken[candidate] = true
      if (assign(index + 1)) {
        return true
      }
      taken[candidate] = false
    }
    return false
  }

  return assign(0)
}

/**
 * Not exported, and neither are the two above it.
 *
 * `matchRecipe` subsumes all three, and plan.md §8 names this repository's
 * public surface the second project risk: three more names would be three more
 * things six repositories could come to depend on, for no answer they cannot
 * already get. They stay separate functions because the two algorithms are
 * genuinely different, not because anyone outside needs to choose between them.
 */
const matchesGrid = (recipe: Recipe, grid: CraftGrid): boolean =>
  recipe._tag === 'Shaped' ? matchesShaped(recipe, grid) : matchesShapeless(recipe, grid)

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export type RecipeMatch =
  | { readonly _tag: 'Match'; readonly recipe: Recipe; readonly output: ItemStack }
  | { readonly _tag: 'NoMatch' }

/**
 * How specific a recipe is. Higher wins. See `matchRecipe`.
 *
 * Shaped outranks shapeless because its match set is a strict SUBSET: every grid
 * a shaped recipe accepts is also accepted by the shapeless recipe over the same
 * items, and not conversely. Preferring the smaller set is the ordinary meaning
 * of "more specific", and it is a property of the two forms rather than a taste.
 */
const specificity = (recipe: Recipe): number => (recipe._tag === 'Shaped' ? 1 : 0)

/**
 * The one function mx-ui's output square is a projection of. TOTAL and
 * INDEPENDENT OF TABLE ORDER.
 *
 * ---------------------------------------------------------------------------
 * The ambiguity rule
 * ---------------------------------------------------------------------------
 *
 * Two recipes matching one grid is a real situation, not a pathology: a modpack
 * adds a loose shapeless recipe next to a specific shaped one, and both fire.
 * Vanilla resolves this by registry iteration order, which means the answer
 * depends on load order and changes when somebody reorders a file. This
 * repository refuses that, for the same reason `docs/testing.md` §4.6 refuses
 * tests that read a constant on both sides: a rule nobody wrote is a rule
 * nobody can keep.
 *
 * The rule, in two steps:
 *
 *   1. MORE SPECIFIC WINS — shaped beats shapeless (see `specificity`).
 *   2. Among equally specific matches, the LOWEST `RecipeId` wins.
 *
 * Step 2 is arbitrary and is meant to be: at that point the table itself is
 * wrong, and the value of the rule is only that the wrongness is reproducible
 * rather than dependent on which file loaded first. `conflictsIn` is what turns
 * "reproducible" into "reported", and `test/recipe.test.ts` runs it over
 * `STARTER_RECIPES`.
 *
 * Note what step 1 does NOT need to do. Every recipe matching a given grid
 * consumes exactly the grid's occupied cells — a shaped pattern's box equals the
 * occupied box, and a shapeless recipe's ingredient count equals the occupied
 * count — so "prefer the recipe that uses more ingredients" is vacuous here and
 * is deliberately absent rather than present and never firing.
 */
export const matchRecipe = (table: RecipeTable, grid: CraftGrid): RecipeMatch => {
  let best: Recipe | undefined

  for (const recipe of table) {
    if (!matchesGrid(recipe, grid)) {
      continue
    }
    if (best === undefined) {
      best = recipe
      continue
    }
    const bySpecificity = specificity(recipe) - specificity(best)
    if (bySpecificity > 0 || (bySpecificity === 0 && recipe.id < best.id)) {
      best = recipe
    }
  }

  return best === undefined ? { _tag: 'NoMatch' } : { _tag: 'Match', recipe: best, output: best.output }
}

// ---------------------------------------------------------------------------
// Table hygiene
// ---------------------------------------------------------------------------

export type RecipeConflict = {
  readonly reason: 'duplicate-id' | 'same-shape' | 'same-ingredients'
  readonly recipeIds: readonly [RecipeId, RecipeId]
}

const ingredientKey = (ingredient: Ingredient): string => `${ingredient._tag}:${ingredient.item}`

const patternKey = (pattern: RecipePattern): string =>
  `${String(pattern.width)}x${String(pattern.height)}:${pattern.cells
    .map((cell) => (cell === undefined ? '' : ingredientKey(cell)))
    .join(',')}`

const mirroredPattern = (pattern: RecipePattern): RecipePattern => ({
  width: pattern.width,
  height: pattern.height,
  cells: Array.from({ length: pattern.width * pattern.height }, (_unused, index) =>
    patternCellAt(
      pattern,
      pattern.width - 1 - (index % pattern.width),
      Math.floor(index / pattern.width),
    ),
  ),
})

const shapelessKey = (recipe: ShapelessRecipe): string =>
  recipe.ingredients.map(ingredientKey).sort().join(',')

const overlaps = (left: Recipe, right: Recipe): RecipeConflict['reason'] | undefined => {
  if (left._tag === 'Shaped' && right._tag === 'Shaped') {
    const key = patternKey(left.pattern)
    return key === patternKey(right.pattern) || key === patternKey(mirroredPattern(right.pattern))
      ? 'same-shape'
      : undefined
  }
  if (left._tag === 'Shapeless' && right._tag === 'Shapeless') {
    return shapelessKey(left) === shapelessKey(right) ? 'same-ingredients' : undefined
  }
  // Shaped vs shapeless CAN both match, and that is not a conflict: step 1 of
  // the ambiguity rule decides it on a property of the forms, not on a tie-break.
  return undefined
}

/**
 * Pairs in a table that the ambiguity rule can only separate by id — that is,
 * the ones where the tie-break is doing the work and the table is the bug.
 *
 * Deciding "could these two ever match the same grid" is only this cheap because
 * `Ingredient` has a single, exact member: two shaped recipes overlap iff their
 * trimmed patterns are equal up to the mirror, and two shapeless ones iff their
 * ingredient multisets are equal. Give `Ingredient` a `Tag` member and this
 * becomes a containment question between predicates; the type will say so,
 * because the two key functions below stop being total descriptions.
 *
 * Result order is deterministic (sorted), so it can be asserted directly.
 */
export const conflictsIn = (table: RecipeTable): ReadonlyArray<RecipeConflict> => {
  const conflicts: Array<RecipeConflict> = []

  for (let left = 0; left < table.length; left += 1) {
    for (let right = left + 1; right < table.length; right += 1) {
      const first = table[left]
      const second = table[right]
      if (first === undefined || second === undefined) {
        continue
      }
      const ids: readonly [RecipeId, RecipeId] =
        first.id <= second.id ? [first.id, second.id] : [second.id, first.id]

      if (first.id === second.id) {
        conflicts.push({ reason: 'duplicate-id', recipeIds: ids })
        continue
      }
      const reason = overlaps(first, second)
      if (reason !== undefined) {
        conflicts.push({ reason, recipeIds: ids })
      }
    }
  }

  return conflicts.sort((a, b) =>
    a.recipeIds[0] === b.recipeIds[0]
      ? a.recipeIds[1].localeCompare(b.recipeIds[1], 'en')
      : a.recipeIds[0].localeCompare(b.recipeIds[0], 'en'),
  )
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * A deliberately small table, and SMALLER THAN IT WAS.
 *
 * It is here to exercise the MODEL and not to be a content database. A large
 * invented table would be content, and content belongs next to the block table
 * discussion in mc-kernel (docs/design-notes.md DN-11), not in the module that
 * decides how matching works.
 *
 * Item ids are now members of kernel's `ITEM_TYPES` (mirrored in
 * `./kernel-vocabulary`), so a misspelled row does not compile. They are still
 * DATA, not behaviour: nothing in this file branches on a literal item id, which
 * is the trap DN-11 records.
 *
 * ---------------------------------------------------------------------------
 * What the repoint cost, and why the answer was to trim rather than to ask
 * ---------------------------------------------------------------------------
 *
 * Seven of these rows named items kernel's roster does not have: `IRON_INGOT`,
 * `FLINT`, `FLINT_AND_STEEL`, `GUNPOWDER`, `BLAZE_POWDER`, `COAL`,
 * `FIRE_CHARGE` and `CRAFTING_TABLE`. Kernel declined to add them and said why:
 * guessing eight items into the tier-1 vocabulary to spare a consumer a decision
 * is the guessed-roster failure the organisation has argued against twice.
 *
 * Asking anyway was not available in the same commit either — `ITEM_TYPES` is
 * mirrored here, mc-dev-meta's `pnpm check:mirrors` compares the mirror against
 * kernel's real module, and a mirror that runs ahead of its source is the exact
 * hazard the mirror exists to prevent. So the table lives inside the sixteen
 * items that exist, and the request to kernel is a request, recorded below.
 *
 * The trim was not uniform, because the three rows were not worth the same:
 *
 *   - `mc-sim:crafting-table` (2x2 symmetric, the translation case) cost
 *     NOTHING. Vanilla's glowstone block is the same shape over items kernel
 *     already has, so the demonstration survives with a different output and one
 *     fewer item to ask for. A row whose only distinction was its output was a
 *     row that was content.
 *   - `mc-sim:fire-charge` (shapeless, three DISTINCT ingredients) and
 *     `mc-sim:flint-and-steel` (shaped, ASYMMETRIC, so its mirror is a different
 *     layout) cost something real: nothing in kernel's sixteen items is a
 *     vanilla recipe of either shape, and both are rules `matchRecipe`
 *     implements. They now live in `test/recipe.test.ts` as local tables.
 *
 * That relocation is the honest place for them rather than a consolation prize.
 * `STARTER_RECIPES` is PUBLISHED — `InventoryService.recipes` hands it to mx-ui's
 * recipe book — so a row in it is a claim about what this game can make, and
 * inventing an asymmetric recipe out of `torch` and `gravel` to keep a matcher
 * property on display would be inventing content to test a function. Permutation
 * and mirroring are properties of the MATCHER and can be demonstrated on any
 * table; the one non-vanilla row that remains is here because its property —
 * that the SHIPPED table resolves an ambiguity without leaning on the id
 * tie-break — is a property of this table and of nothing else.
 *
 * ---------------------------------------------------------------------------
 * The request to kernel, costed
 * ---------------------------------------------------------------------------
 *
 * Restoring the two rows needs seven literals in `ITEM_TYPES`: `iron_ingot`,
 * `flint`, `flint_and_steel`, `coal`, `gunpowder`, `blaze_powder`,
 * `fire_charge`. NOT `crafting_table`, which is replaced above and should stay
 * out. It is additive and MINOR (kernel's docs/versioning.md §6), and mc-sim's
 * side of it is two `shapelessRecipe`/`shapedRecipe` calls.
 *
 * But it should not land on mc-sim's say-so. `coal`, `iron_ingot` and `flint`
 * have kernel-side reasons coming — they are what `coal_ore`, `iron_ore` and
 * `gravel` drop, and `BlockDropRule.item` is `ItemType | 'self'` — and arriving
 * with a drop rule behind them is the difference between a roster and a guess.
 * A recipe table in a tier-2 repository is not evidence about kernel's
 * vocabulary; a block that has to drop something is.
 */
export const STARTER_RECIPES: RecipeTable = [
  // Shapeless, one ingredient: the log that becomes four planks.
  shapelessRecipe('mc-sim:oak-planks', ['oak_log'], itemStack('oak_planks', 4)),

  // Shaped 1x2: the smallest shape there is, and the one that translates to the
  // most places in a 3x3 grid (six).
  shapedRecipe('mc-sim:stick', ['P', 'P'], { P: 'oak_planks' }, itemStack('stick', 4)),

  /*
   * THE AMBIGUITY. This entry is not vanilla and is not content: it exists so
   * that `STARTER_RECIPES` contains the situation the rule was written for, and
   * so that a test can observe the resolution rather than assume it.
   *
   * It is the exact shape of a real modpack conflict — a loose shapeless recipe
   * added beside a specific shaped one — and the outputs differ (2 sticks, not
   * 4) precisely so that picking the wrong one is VISIBLE. Under the rule the
   * shaped `mc-sim:stick` wins for two planks in a column, and this recipe wins
   * for two planks side by side, which the shaped one does not accept.
   */
  shapelessRecipe('mc-sim:stick-from-loose-planks', ['oak_planks', 'oak_planks'], itemStack('stick', 2)),

  // Shaped 2x2, symmetric: the translation case. Four dust anywhere in a 3x3.
  // Vanilla, and the replacement for the crafting table discussed above.
  shapedRecipe('mc-sim:glowstone', ['DD', 'DD'], { D: 'glowstone_dust' }, itemStack('glowstone', 1)),

  // Shaped 3x3 with holes: the pattern that fills the grid, so it translates
  // nowhere, and whose empty cells must stay empty.
  shapedRecipe(
    'mc-sim:wooden-pickaxe',
    ['PPP', ' S ', ' S '],
    { P: 'oak_planks', S: 'stick' },
    itemStack('wooden_pickaxe', 1),
  ),
]
