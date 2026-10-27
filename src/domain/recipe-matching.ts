import { VANILLA_ITEM_TAG_MEMBERSHIPS, type ItemType } from '@nerima-games/mc-kernel'

import {
  cellAt,
  ingredientMatches,
  isCraftingIngredient,
  MAX_RECIPE_SIDE,
  type CraftGrid,
  type CraftingIngredient,
  type AnyOfIngredient,
  type ExactIngredient,
  type ItemTagMemberships,
  type Recipe,
  type RecipeMatchContext,
  type RecipeTable,
  type ShapedRecipe,
  type ShapelessRecipe,
} from './recipe-core.js'
import type { ItemStack } from './inventory.js'

export type RecipeMatch =
  | { readonly _tag: 'Match'; readonly recipe: Recipe; readonly output: ItemStack }
  | { readonly _tag: 'NoMatch' }

export type RecipeIngredientAssignment = {
  readonly slotIndex: number
  readonly item: ItemType
  readonly ingredient: CraftingIngredient
}

export type RecipeMatchWithAssignments =
  | {
      readonly _tag: 'Match'
      readonly recipe: Recipe
      readonly output: ItemStack
      readonly assignments: ReadonlyArray<RecipeIngredientAssignment>
    }
  | { readonly _tag: 'NoMatch' }

type MatchedRecipeWithAssignments = Extract<RecipeMatchWithAssignments, { readonly _tag: 'Match' }>

export type RecipeConflictReason = 'duplicate-id' | 'same-shape' | 'same-ingredients'

export type RecipeConflict = {
  readonly firstId: string
  readonly secondId: string
  readonly reason: RecipeConflictReason
}

type RecipeIndexes = {
  readonly exactByItem: ReadonlyMap<ItemType, ReadonlyArray<Recipe>>
  readonly tagged: ReadonlyArray<Recipe>
}

type ExactIndexIngredient =
  | ExactIngredient
  | (Omit<AnyOfIngredient, 'options'> & { readonly options: ReadonlyArray<ExactIngredient> })

const isExactIndexIngredient = (ingredient: CraftingIngredient): ingredient is ExactIndexIngredient =>
  ingredient._tag === 'Exact' ||
  (ingredient._tag === 'AnyOf' && ingredient.options.every((option) => option._tag === 'Exact'))

const exactItemsOf = (ingredient: ExactIndexIngredient): ReadonlyArray<ItemType> =>
  ingredient._tag === 'Exact' ? [ingredient.item] : ingredient.options.map((option) => option.item)

export const buildRecipeIndexes = (table: RecipeTable): RecipeIndexes => {
  const exactByItem = new Map<ItemType, ReadonlyArray<Recipe>>()
  const tagged: Array<Recipe> = []

  for (const recipe of table) {
    const ingredients = recipe._tag === 'Shaped' ? recipe.pattern.cells : recipe.ingredients
    const seenItems = new Set<ItemType>()
    for (const ingredient of ingredients) {
      if (ingredient === undefined) continue
      if (!isExactIndexIngredient(ingredient)) {
        tagged.push(recipe)
        break
      }
      for (const item of exactItemsOf(ingredient)) {
        if (seenItems.has(item)) continue
        seenItems.add(item)
        const recipes = exactByItem.get(item)
        exactByItem.set(item, recipes === undefined ? [recipe] : [...recipes, recipe])
      }
    }
  }

  return { exactByItem, tagged }
}

type GridBounds = {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

const validGrid = (grid: CraftGrid): boolean =>
  Number.isSafeInteger(grid.width) &&
  Number.isSafeInteger(grid.height) &&
  grid.width >= 0 &&
  grid.height >= 0 &&
  grid.width <= MAX_RECIPE_SIDE &&
  grid.height <= MAX_RECIPE_SIDE &&
  grid.cells.length <= grid.width * grid.height

const occupiedBounds = (grid: CraftGrid): GridBounds | undefined => {
  let minX: number = grid.width
  let minY: number = grid.height
  let maxX = -1
  let maxY = -1

  for (let index = 0; index < grid.cells.length; index += 1) {
    const cell = grid.cells[index]
    if (cell === undefined) continue
    const x = index % grid.width
    const y = Math.floor(index / grid.width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  return maxX < 0 ? undefined : { minX, minY, maxX, maxY }
}

const shapedIngredientAssignmentsAt = (
  recipe: ShapedRecipe,
  grid: CraftGrid,
  offsetX: number,
  offsetY: number,
  mirrored: boolean,
  itemTags: ItemTagMemberships,
): ReadonlyArray<RecipeIngredientAssignment> | undefined => {
  const patternWidth = recipe.pattern.width
  const patternHeight = recipe.pattern.height
  const assignments: Array<RecipeIngredientAssignment> = []

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const patternX = x - offsetX
      const patternY = y - offsetY
      const expected =
        patternY < 0 ||
        patternY >= patternHeight ||
        patternX < 0 ||
        patternX >= patternWidth
          ? undefined
          : recipe.pattern.cells[
              patternY * patternWidth + (mirrored ? patternWidth - patternX - 1 : patternX)
            ]
      const actual = cellAt(grid, x, y)
      if (expected === undefined) {
        if (actual !== undefined) return undefined
        continue
      }
      if (
        actual === undefined ||
        !Number.isSafeInteger(actual.count) ||
        actual.count < expected.count ||
        !ingredientMatches(expected, actual.item, itemTags)
      ) {
        return undefined
      }
      assignments.push({ ingredient: expected, item: actual.item, slotIndex: y * grid.width + x })
    }
  }

  return assignments
}

const shapedIngredientAssignments = (
  recipe: ShapedRecipe,
  grid: CraftGrid,
  context: RecipeMatchContext,
): ReadonlyArray<RecipeIngredientAssignment> | undefined => {
  if (!validGrid(grid)) return undefined
  const bounds = occupiedBounds(grid)
  if (bounds === undefined) return undefined

  const itemTags = context.itemTags ?? VANILLA_ITEM_TAG_MEMBERSHIPS
  const lastOffsetX = bounds.maxX - recipe.pattern.width + 1
  const lastOffsetY = bounds.maxY - recipe.pattern.height + 1
  for (let offsetY = bounds.minY; offsetY <= lastOffsetY; offsetY += 1) {
    for (let offsetX = bounds.minX; offsetX <= lastOffsetX; offsetX += 1) {
      const assignments = shapedIngredientAssignmentsAt(recipe, grid, offsetX, offsetY, false, itemTags)
      if (assignments !== undefined) return assignments
      if (recipe.assumeSymmetry) {
        const mirrored = shapedIngredientAssignmentsAt(recipe, grid, offsetX, offsetY, true, itemTags)
        if (mirrored !== undefined) return mirrored
      }
    }
  }
  return undefined
}

export const matchesShaped = (
  recipe: ShapedRecipe,
  grid: CraftGrid,
  context: RecipeMatchContext = {},
): boolean => shapedIngredientAssignments(recipe, grid, context) !== undefined

const occupiedCount = (grid: CraftGrid): number => grid.cells.filter((cell) => cell !== undefined).length

const shapelessIngredientAssignments = (
  recipe: ShapelessRecipe,
  grid: CraftGrid,
  context: RecipeMatchContext,
): ReadonlyArray<RecipeIngredientAssignment> | undefined => {
  if (
    !validGrid(grid) ||
    !Array.isArray(recipe.ingredients) ||
    recipe.ingredients.length === 0 ||
    recipe.ingredients.length !== occupiedCount(grid)
  ) {
    return undefined
  }

  const itemTags = context.itemTags ?? VANILLA_ITEM_TAG_MEMBERSHIPS
  const assignments: Array<RecipeIngredientAssignment> = []
  const failedStates = new Set<number>()
  const stateStride = Math.pow(2, grid.cells.length)

  const visit = (ingredientIndex: number, usedMask: number): boolean => {
    if (ingredientIndex >= recipe.ingredients.length) return true
    const stateKey = ingredientIndex * stateStride + usedMask
    if (failedStates.has(stateKey)) return false
    const ingredient = recipe.ingredients[ingredientIndex]
    if (ingredient === undefined || !isCraftingIngredient(ingredient)) return false

    for (let slotIndex = 0; slotIndex < grid.cells.length; slotIndex += 1) {
      const slotBit = Math.pow(2, slotIndex)
      if (Math.floor(usedMask / slotBit) % 2 !== 0) continue
      const candidate = grid.cells[slotIndex]
      if (
        candidate === undefined ||
        !Number.isSafeInteger(candidate.count) ||
        candidate.count < ingredient.count ||
        !ingredientMatches(ingredient, candidate.item, itemTags)
      ) {
        continue
      }
      assignments.push({ ingredient, item: candidate.item, slotIndex })
      if (visit(ingredientIndex + 1, usedMask + slotBit)) return true
      assignments.pop()
    }

    failedStates.add(stateKey)
    return false
  }

  if (!visit(0, 0)) return undefined
  return [...assignments].sort((left, right) => left.slotIndex - right.slotIndex)
}

export const matchesShapeless = (
  recipe: ShapelessRecipe,
  grid: CraftGrid,
  context: RecipeMatchContext = {},
): boolean => shapelessIngredientAssignments(recipe, grid, context) !== undefined

const stationMatches = (recipe: Recipe, context: RecipeMatchContext): boolean =>
  recipe.tags.length === 0 ||
  (context.station !== undefined && recipe.tags.includes(context.station))

export const matchesRecipe = (
  recipe: Recipe,
  grid: CraftGrid,
  context: RecipeMatchContext = {},
): boolean => {
  if (!stationMatches(recipe, context)) return false
  return recipe._tag === 'Shaped'
    ? matchesShaped(recipe, grid, context)
    : matchesShapeless(recipe, grid, context)
}

const recipeOrder = (left: Recipe, right: Recipe): number => {
  if (left.priority !== right.priority) return left.priority - right.priority
  if (left._tag !== right._tag) return left._tag === 'Shaped' ? -1 : 1
  return left.id.localeCompare(right.id)
}

const shapedAssignments = (
  recipe: ShapedRecipe,
  grid: CraftGrid,
  context: RecipeMatchContext,
): ReadonlyArray<RecipeIngredientAssignment> | undefined =>
  stationMatches(recipe, context) ? shapedIngredientAssignments(recipe, grid, context) : undefined

const recipeAssignments = (
  recipe: Recipe,
  grid: CraftGrid,
  context: RecipeMatchContext,
): ReadonlyArray<RecipeIngredientAssignment> | undefined =>
  recipe._tag === 'Shaped'
    ? shapedAssignments(recipe, grid, context)
    : stationMatches(recipe, context)
      ? shapelessIngredientAssignments(recipe, grid, context)
      : undefined

const matchedRecipe = (
  recipe: Recipe,
  grid: CraftGrid,
  context: RecipeMatchContext,
): MatchedRecipeWithAssignments | undefined => {
  const assignments = recipeAssignments(recipe, grid, context)
  return assignments === undefined ? undefined : { _tag: 'Match', assignments, output: recipe.output, recipe }
}

const bestRecipeWithAssignments = (
  table: ReadonlyArray<Recipe>,
  grid: CraftGrid,
  context: RecipeMatchContext,
): MatchedRecipeWithAssignments | undefined => {
  let best: MatchedRecipeWithAssignments | undefined
  for (const recipe of table) {
    if (recipe === undefined) continue
    const match = matchedRecipe(recipe, grid, context)
    if (match !== undefined && (best === undefined || recipeOrder(match.recipe, best.recipe) < 0)) {
      best = match
    }
  }
  return best
}

const matchIndexedRecipeWithAssignments = (
  index: RecipeIndexes,
  grid: CraftGrid,
  context: RecipeMatchContext,
): MatchedRecipeWithAssignments | undefined => {
  if (!validGrid(grid)) return undefined
  let firstItem: ItemType | undefined
  for (const cell of grid.cells) {
    if (cell !== undefined) {
      firstItem = cell.item
      break
    }
  }

  const indexed = firstItem === undefined ? undefined : index.exactByItem.get(firstItem)
  let best = indexed === undefined ? undefined : bestRecipeWithAssignments(indexed, grid, context)
  const taggedMatch = bestRecipeWithAssignments(index.tagged, grid, context)
  if (taggedMatch !== undefined && (best === undefined || recipeOrder(taggedMatch.recipe, best.recipe) < 0)) {
    best = taggedMatch
  }
  return best
}

export const matchIndexedRecipe = (
  index: RecipeIndexes,
  grid: CraftGrid,
  context: RecipeMatchContext = {},
): Recipe | undefined => matchIndexedRecipeWithAssignments(index, grid, context)?.recipe

export const matchRecipeWithAssignments = (
  table: RecipeTable,
  grid: CraftGrid,
  context: RecipeMatchContext = {},
): RecipeMatchWithAssignments =>
  bestRecipeWithAssignments(table, grid, context) ?? { _tag: 'NoMatch' }

export const matchRecipe = (
  table: RecipeTable,
  grid: CraftGrid,
  context: RecipeMatchContext = {},
): RecipeMatch => {
  const match = matchRecipeWithAssignments(table, grid, context)
  return match._tag === 'NoMatch'
    ? { _tag: 'NoMatch' }
    : { _tag: 'Match', output: match.output, recipe: match.recipe }
}

const ingredientKey = (ingredient: CraftingIngredient): string => {
  if (ingredient._tag === 'Exact') return `item:${ingredient.item}:${ingredient.count}`
  if (ingredient._tag === 'AnyOf') return `any:${ingredient.count}:${ingredient.options.map(ingredientKey).sort().join(',')}`
  return `tag:${ingredient.tag}:${ingredient.count}`
}

const patternKey = (recipe: ShapedRecipe): string =>
  `${recipe.pattern.width}x${recipe.pattern.height}:${recipe.pattern.cells
    .map((cell) => (cell === undefined ? '_' : ingredientKey(cell)))
    .join('|')}`

const ingredientsKey = (recipe: ShapelessRecipe): string =>
  recipe.ingredients.map(ingredientKey).sort().join('|')

const conflictBetween = (first: Recipe, second: Recipe): RecipeConflict | undefined => {
  if (first.id === second.id) {
    return { firstId: first.id, reason: 'duplicate-id', secondId: second.id }
  }
  if (first._tag === 'Shaped' && second._tag === 'Shaped' && patternKey(first) === patternKey(second)) {
    return { firstId: first.id, reason: 'same-shape', secondId: second.id }
  }
  if (
    first._tag === 'Shapeless' &&
    second._tag === 'Shapeless' &&
    ingredientsKey(first) === ingredientsKey(second)
  ) {
    return { firstId: first.id, reason: 'same-ingredients', secondId: second.id }
  }
  return undefined
}

export const conflictsIn = (
  table: ReadonlyArray<Recipe | undefined>,
): ReadonlyArray<RecipeConflict> => {
  const conflicts: Array<RecipeConflict> = []
  for (let firstIndex = 0; firstIndex < table.length; firstIndex += 1) {
    const first = table[firstIndex]
    if (first === undefined) continue
    for (let secondIndex = firstIndex + 1; secondIndex < table.length; secondIndex += 1) {
      const second = table[secondIndex]
      if (second === undefined) continue
      const conflict = conflictBetween(first, second)
      if (conflict !== undefined) conflicts.push(conflict)
    }
  }
  return conflicts.sort(
    (left, right) => left.firstId.localeCompare(right.firstId) || left.secondId.localeCompare(right.secondId),
  )
}
