import { ItemType } from '@nerima-games/mc-kernel'

import { type ItemStack } from './inventory'
import {
  cellAt,
  ingredientMatches,
  type CraftGrid,
  type Ingredient,
  type Recipe,
  type RecipeId,
  type RecipePattern,
  type RecipeTable,
  type ShapedRecipe,
  type ShapelessRecipe,
} from './recipe-core'

type Bounds = {
  readonly minX: number
  readonly minY: number
  readonly width: number
  readonly height: number
}

const patternCellAt = (pattern: RecipePattern, x: number, y: number): Ingredient | undefined =>
  pattern.cells[y * pattern.width + x]

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

const matchesShaped = (recipe: ShapedRecipe, grid: CraftGrid): boolean => {
  const bounds = occupiedBounds(grid)
  if (bounds === undefined) {
    return false
  }
  if (bounds.width !== recipe.pattern.width || bounds.height !== recipe.pattern.height) {
    return false
  }
  return shapedFitsAt(recipe.pattern, grid, bounds, false) || shapedFitsAt(recipe.pattern, grid, bounds, true)
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

const matchesShapeless = (recipe: ShapelessRecipe, grid: CraftGrid): boolean => {
  const items = occupiedItems(grid)
  if (items.length === 0 || items.length !== recipe.ingredients.length) {
    return false
  }

  const taken: Array<boolean> = items.map(() => false)
  const assign = (index: number): boolean => {
    if (index === recipe.ingredients.length) {
      return true
    }
    const ingredient = recipe.ingredients[index]!
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

const matchesGrid = (recipe: Recipe, grid: CraftGrid): boolean =>
  recipe._tag === 'Shaped' ? matchesShaped(recipe, grid) : matchesShapeless(recipe, grid)

export type RecipeMatch =
  | { readonly _tag: 'Match'; readonly recipe: Recipe; readonly output: ItemStack }
  | { readonly _tag: 'NoMatch' }

const specificity = (recipe: Recipe): number => (recipe._tag === 'Shaped' ? 1 : 0)

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
  return undefined
}

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
