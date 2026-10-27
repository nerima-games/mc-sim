import { Brand, Result } from 'effect'
import {
  RecipeId,
  RecipePriority,
  StackCount,
  craftGrid,
  isCraftingIngredient,
  isItemStack,
  itemStackWithCount,
  transmuteItemStack,
  type CraftGrid,
  type CraftingIngredient,
  type ItemStack,
  type RecipeCategory,
  type RecipeGroup as RecipeGroupValue,
  type RecipeId as RecipeIdValue,
  type RecipeMatchContext,
  type RecipePriority as RecipePriorityValue,
  type Slot,
} from '@nerima-games/mc-kernel'
import {
  comparePriorityAndId,
  isRecord,
  matchesIngredient,
  stationRecipeFailure,
  validateContext,
  validateRecipeTable,
  type StationRecipeFailure,
} from './station-recipe-support.js'

export const TRANSMUTE_MAX_MATERIAL_SLOTS = 8
export type TransmuteMaterialSlotCount = number & Brand.Brand<'TransmuteMaterialSlotCount'>
export type TransmuteMaterialCount = Readonly<{
  readonly min: TransmuteMaterialSlotCount
  readonly max: TransmuteMaterialSlotCount
}>
export type TransmuteRecipe = Readonly<{
  readonly _tag: 'Transmute'
  readonly id: RecipeIdValue
  readonly source: CraftingIngredient
  readonly material: CraftingIngredient
  readonly output: ItemStack
  readonly materialCount: TransmuteMaterialCount
  readonly addMaterialCountToResult: boolean
  readonly category?: RecipeCategory
  readonly group?: RecipeGroupValue
  readonly priority: RecipePriorityValue
  readonly showNotification?: boolean
}>
export type TransmuteRecipeTable = ReadonlyArray<TransmuteRecipe>
export type TransmuteInput = CraftGrid
export type TransmuteMatch =
  | {
      readonly _tag: 'Match'
      readonly recipe: TransmuteRecipe
      readonly sourceSlotIndex: number
      readonly materialSlotIndexes: ReadonlyArray<number>
      readonly output: ItemStack
    }
  | { readonly _tag: 'NoMatch' }
export type TransmuteApplyResult =
  | {
      readonly _tag: 'Applied'
      readonly recipe: TransmuteRecipe
      readonly sourceSlotIndex: number
      readonly materialSlotIndexes: ReadonlyArray<number>
      readonly output: ItemStack
      readonly remainingGrid: CraftGrid
    }
  | { readonly _tag: 'NoMatch' }

const isMaterialCount = (value: unknown): value is TransmuteMaterialCount =>
  isRecord(value) &&
  typeof value['min'] === 'number' && Number.isSafeInteger(value['min']) &&
  typeof value['max'] === 'number' && Number.isSafeInteger(value['max']) &&
  value['min'] >= 0 && value['min'] <= value['max'] && value['max'] <= TRANSMUTE_MAX_MATERIAL_SLOTS

const isCategory = (value: unknown): value is RecipeCategory =>
  value === 'building' || value === 'equipment' || value === 'misc' || value === 'redstone'

const isTransmuteRecipe = (value: unknown): value is TransmuteRecipe =>
  isRecord(value) &&
  value['_tag'] === 'Transmute' &&
  typeof value['id'] === 'string' && Result.isSuccess(RecipeId.result(value['id'])) &&
  isCraftingIngredient(value['source']) &&
  isCraftingIngredient(value['material']) &&
  isItemStack(value['output']) &&
  isMaterialCount(value['materialCount']) &&
  typeof value['addMaterialCountToResult'] === 'boolean' &&
  (value['category'] === undefined || isCategory(value['category'])) &&
  (value['group'] === undefined || typeof value['group'] === 'string') &&
  typeof value['priority'] === 'number' && Result.isSuccess(RecipePriority.result(value['priority'])) &&
  (value['showNotification'] === undefined || typeof value['showNotification'] === 'boolean')

const isCraftGrid = (value: unknown): value is TransmuteInput => {
  if (!isRecord(value)) return false
  const width = value['width']
  const height = value['height']
  const cells = value['cells']
  return typeof width === 'number' && Number.isSafeInteger(width) && width >= 0 && width <= 3 &&
    typeof height === 'number' && Number.isSafeInteger(height) && height >= 0 && height <= 3 &&
    Array.isArray(cells) && cells.length === width * height &&
    cells.every((slot) => slot === undefined || isItemStack(slot))
}

const recipeFailure = (path: string): StationRecipeFailure =>
  stationRecipeFailure(path, 'expected a valid transmute recipe')

const validateGrid = (value: unknown): Result.Result<TransmuteInput, StationRecipeFailure> =>
  isCraftGrid(value)
    ? Result.succeed(value)
    : Result.fail(stationRecipeFailure('grid', 'expected a valid craft grid'))

const ingredientMatchesSlot = (
  ingredient: CraftingIngredient,
  slot: Slot,
  context: RecipeMatchContext,
): Result.Result<boolean, StationRecipeFailure> =>
  matchesIngredient(ingredient, slot, context)

const outputFor = (
  recipe: TransmuteRecipe,
  source: ItemStack,
  materialSlotCount: number,
): Result.Result<ItemStack, StationRecipeFailure> => {
  const count = recipe.addMaterialCountToResult
    ? recipe.output.count + materialSlotCount
    : recipe.output.count
  return Result.flatMap(StackCount.result(count), (validCount) =>
    transmuteItemStack(source, recipe.output, validCount),
  )
}

const transmuteMatch = (
  recipe: TransmuteRecipe,
  grid: TransmuteInput,
  context: RecipeMatchContext,
): Result.Result<TransmuteMatch, StationRecipeFailure> => {
  if (grid.width !== 3 || grid.height !== 3) return Result.succeed({ _tag: 'NoMatch' })
  const candidates: Array<Result.Result<TransmuteMatch, StationRecipeFailure>> = grid.cells.map((source, sourceSlotIndex) => {
    if (source === undefined) return Result.succeed<TransmuteMatch>({ _tag: 'NoMatch' })
    return Result.flatMap(ingredientMatchesSlot(recipe.source, source, context), (sourceMatches) => {
      if (!sourceMatches) return Result.succeed<TransmuteMatch>({ _tag: 'NoMatch' })
      const materials = grid.cells.map((slot, slotIndex) =>
        slot === undefined || slotIndex === sourceSlotIndex
          ? Result.succeed({ slotIndex, matches: true, occupied: false })
          : Result.map(ingredientMatchesSlot(recipe.material, slot, context), (matches) => ({ slotIndex, matches, occupied: true })),
      )
      return Result.flatMap(Result.all(materials), (checked) => {
        const occupied = checked.filter((entry) => entry.occupied)
        const materialSlotIndexes = occupied.filter((entry) => entry.matches).map((entry) => entry.slotIndex)
        const validCount = materialSlotIndexes.length >= recipe.materialCount.min && materialSlotIndexes.length <= recipe.materialCount.max
        if (!validCount || occupied.some((entry) => !entry.matches)) return Result.succeed<TransmuteMatch>({ _tag: 'NoMatch' })
        return Result.map(outputFor(recipe, source, materialSlotIndexes.length), (output): TransmuteMatch => ({
          _tag: 'Match',
          recipe,
          sourceSlotIndex,
          materialSlotIndexes,
          output,
        }))
      })
    })
  })
  return Result.map(Result.all(candidates), (matches) => matches.find((match) => match._tag === 'Match') ?? { _tag: 'NoMatch' })
}

export const matchesTransmuteRecipe = (
  recipe: unknown,
  grid: unknown,
  context: unknown = {},
): Result.Result<boolean, StationRecipeFailure> => {
  if (!isTransmuteRecipe(recipe)) return Result.fail(recipeFailure('recipe'))
  return Result.flatMap(validateGrid(grid), (validGrid) =>
    Result.flatMap(validateContext(context), (validContext) =>
      Result.map(transmuteMatch(recipe, validGrid, validContext), (match) => match._tag === 'Match'),
    ),
  )
}

export const matchTransmuteRecipes = (
  grid: unknown,
  context: unknown = {},
  recipes: unknown = [],
): Result.Result<ReadonlyArray<TransmuteMatch>, StationRecipeFailure> =>
  Result.flatMap(validateGrid(grid), (validGrid) =>
    Result.flatMap(validateContext(context), (validContext) =>
      Result.flatMap(validateRecipeTable(recipes, isTransmuteRecipe, 'recipes'), (table) =>
        Result.map(
          Result.all(table.slice().sort(comparePriorityAndId).map((recipe) => transmuteMatch(recipe, validGrid, validContext))),
          (matches) => matches.filter((match) => match._tag === 'Match'),
        ),
      ),
    ),
  )

export const matchTransmuteRecipe = (
  grid: unknown,
  context: unknown = {},
  recipes: unknown = [],
): Result.Result<TransmuteMatch, StationRecipeFailure> =>
  Result.map(matchTransmuteRecipes(grid, context, recipes), (matches): TransmuteMatch => {
    const first = matches[0]
    return first === undefined ? { _tag: 'NoMatch' } : first
  })

export const applyTransmute = (
  recipe: unknown,
  grid: unknown,
  context: unknown = {},
): Result.Result<TransmuteApplyResult, StationRecipeFailure> => {
  if (!isTransmuteRecipe(recipe)) return Result.fail(recipeFailure('recipe'))
  return Result.flatMap(validateGrid(grid), (validGrid) =>
    Result.flatMap(validateContext(context), (validContext) =>
      Result.flatMap(transmuteMatch(recipe, validGrid, validContext), (match): Result.Result<TransmuteApplyResult, StationRecipeFailure> => {
        if (match._tag === 'NoMatch') return Result.succeed<TransmuteApplyResult>(match)
        const consumed = new Map<number, CraftingIngredient>([
          [match.sourceSlotIndex, recipe.source],
          ...match.materialSlotIndexes.map((index) => [index, recipe.material] as const),
        ])
        const remaining = validGrid.cells.map((slot, index) => {
          const ingredient = consumed.get(index)
          if (slot === undefined || ingredient === undefined) return Result.succeed(slot)
          const count = slot.count - ingredient.count
          return count === 0
            ? Result.succeed<Slot>(undefined)
            : Result.flatMap(StackCount.result(count), (validCount) => itemStackWithCount(slot, validCount))
        })
        return Result.flatMap(Result.all(remaining), (cells) =>
          Result.map(craftGrid(validGrid.width, validGrid.height, cells), (remainingGrid): TransmuteApplyResult => ({
            _tag: 'Applied',
            recipe,
            sourceSlotIndex: match.sourceSlotIndex,
            materialSlotIndexes: match.materialSlotIndexes,
            output: match.output,
            remainingGrid,
          })),
        )
      }),
    ),
  )
}
