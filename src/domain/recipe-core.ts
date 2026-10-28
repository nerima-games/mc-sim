import { Result } from 'effect'
import {
  RecipeGridDimension as RecipeGridDimensionBrand,
  RecipeId as RecipeIdBrand,
  RecipeIngredientCount as RecipeIngredientCountBrand,
  RecipePatternRow as RecipePatternRowBrand,
  RecipePatternSymbol as RecipePatternSymbolBrand,
  TagLocation,
  VANILLA_ITEM_TAG_MEMBERSHIPS,
  anyOf as kernelAnyOf,
  exactly as kernelExactly,
  shapedRecipe as kernelShapedRecipe,
  shapelessRecipe as kernelShapelessRecipe,
  tagged as kernelTagged,
  craftGrid as kernelCraftGrid,
  type CraftingIngredientInput,
  type IngredientInput,
  type AnyOfIngredient,
  type CraftGrid,
  type CraftingIngredient,
  type ExactIngredient,
  type ItemTagMemberships,
  type RecipeFailure,
  type RecipeOptions,
  type ShapedRecipe,
  type ShapelessRecipe,
  isCraftingIngredient as kernelIsCraftingIngredient,
} from '@nerima-games/mc-kernel'
import type { ItemType } from '@nerima-games/mc-kernel'

import { type ItemStack, type ItemStackFailure, type Slot } from './inventory.js'

const typeFailure = (message: string): RecipeFailure => ({
  _tag: 'RecipeTypeFailure',
  name: 'TypeError',
  message,
})

const rangeFailure = (message: string): RecipeFailure => ({
  _tag: 'RecipeRangeFailure',
  name: 'RangeError',
  message,
})

const itemFailure = (failure: ItemStackFailure): RecipeFailure =>
  failure._tag === 'BrandError'
    ? rangeFailure(failure.message)
    : { _tag: 'RecipeItemFailure', failure }

const recipeId = (id: string) =>
  typeof id === 'string'
    ? Result.mapError(RecipeIdBrand.result(id), () => typeFailure('Recipe id must be a resource location'))
    : Result.fail(typeFailure('Recipe id must be a resource location'))

const ingredientCount = (count: number) =>
  Result.mapError(
    RecipeIngredientCountBrand.result(count),
    () => rangeFailure(`Ingredient count must be an integer in [1, 64], received ${String(count)}`),
  )

const patternKeyMap = (key: Readonly<Record<string, CraftingIngredientInput>>) => {
  if (key === null || typeof key !== 'object' || Array.isArray(key)) {
    return Result.fail(typeFailure('Shaped recipe keys must be a record'))
  }
  const entries = Result.all(
    Object.entries(key).map(([symbol, ingredient]) =>
      Result.mapError(
        Result.map(
          RecipePatternSymbolBrand.result(symbol),
          (validatedSymbol) => [validatedSymbol, ingredient] as const,
        ),
        () => typeFailure('Shaped recipe keys must use one non-space character'),
      ),
    ),
  )
  return Result.map(entries, (validatedEntries) => {
    const validated: Record<import('@nerima-games/mc-kernel').RecipePatternSymbol, CraftingIngredientInput> = {}
    for (const [symbol, ingredient] of validatedEntries) validated[symbol] = ingredient
    return validated
  })
}

const patternRows = (rows: ReadonlyArray<string>) => {
  if (!Array.isArray(rows)) return Result.fail(typeFailure('Shaped recipe rows must be an array'))
  for (let index = 0; index < rows.length; index += 1) {
    if (!(index in rows)) return Result.fail(typeFailure('Shaped recipe rows must not be sparse'))
  }
  return Result.mapError(
    Result.all(rows.map((row) => RecipePatternRowBrand.result(row))),
    () => rangeFailure('Shaped recipe rows must be strings no wider than 3 characters'),
  )
}

export const exactly: (
  item: ItemType,
  count?: number,
) => Result.Result<ExactIngredient, RecipeFailure> = (item, count = 1) =>
  Result.flatMap(ingredientCount(count), (validatedCount) => kernelExactly(item, validatedCount))

export const tagged: (tag: string, count?: number) => Result.Result<
  import('@nerima-games/mc-kernel').ItemTagIngredient,
  RecipeFailure
> = (tag, count = 1) =>
  Result.flatMap(
    Result.mapError(TagLocation.result(tag), () => typeFailure('Recipe item tag must be a tag location')),
    (validatedTag) =>
      Result.flatMap(ingredientCount(count), (validatedCount) => kernelTagged(validatedTag, validatedCount)),
  )

export const anyOf: (
  options: ReadonlyArray<IngredientInput>,
  count?: number,
) => Result.Result<AnyOfIngredient, RecipeFailure> = (options, count = 1) =>
  Result.flatMap(ingredientCount(count), (validatedCount) => kernelAnyOf(options, validatedCount))

export const ingredientMatches: (
  ingredient: CraftingIngredient,
  item: ItemType,
  itemTags?: ItemTagMemberships,
) => boolean = (ingredient, item, itemTags = VANILLA_ITEM_TAG_MEMBERSHIPS) => {
  if (!kernelIsCraftingIngredient(ingredient)) return false
  if (ingredient._tag === 'AnyOf') {
    return ingredient.options.some((option) => ingredientMatches(option, item, itemTags))
  }
  if (ingredient._tag === 'Exact') return ingredient.item === item
  return itemTags.get(ingredient.tag)?.has(item) ?? false
}

export type {
  AnyOfIngredient,
  CraftGrid,
  CraftGridInput,
  CraftingIngredient,
  CraftingIngredientInput,
  ExactIngredient,
  Ingredient,
  IngredientInput,
  ItemTagIngredient,
  ItemTagMemberships,
  PatternCell,
  Recipe,
  RecipeCategory,
  RecipeFailure,
  RecipeGridIndex,
  RecipeItemTag,
  RecipeMatchContext,
  RecipeOptions,
  RecipePatternKeyMap,
  RecipePattern,
  RecipeTable,
  ShapedRecipe,
  ShapelessRecipe,
} from '@nerima-games/mc-kernel'

export {
  MAX_RECIPE_SIDE,
  craftingIngredient,
  isAnyOfIngredient,
  isCraftingIngredient,
  isCraftingIngredientInput,
} from '@nerima-games/mc-kernel'

export {
  RecipeGridDimension,
  RecipeId,
  RecipeIngredientCount,
  RecipePatternRow,
  RecipePatternSymbol,
  RecipePriority,
  RecipeStationTag,
} from '@nerima-games/mc-kernel'

export const craftGrid = (
  width: number,
  height: number,
  items: ReadonlyArray<ItemType | ItemStack | undefined>,
): Result.Result<CraftGrid, RecipeFailure> => {
  const dimensions = Result.all([
    Result.mapError(
      RecipeGridDimensionBrand.result(width),
      () => rangeFailure('Craft grid width must be an integer in [0, 3]'),
    ),
    Result.mapError(
      RecipeGridDimensionBrand.result(height),
      () => rangeFailure('Craft grid height must be an integer in [0, 3]'),
    ),
  ])
  return Result.flatMap(dimensions, ([validWidth, validHeight]) =>
    kernelCraftGrid(validWidth, validHeight, items),
  )
}

export const cellAt = (grid: CraftGrid, x: number, y: number): Slot =>
  !Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
  x < 0 || y < 0 || x >= grid.width || y >= grid.height
    ? undefined
    : grid.cells[y * grid.width + x]

export const shapedRecipe = (
  id: string,
  rows: ReadonlyArray<string>,
  key: Readonly<Record<string, CraftingIngredientInput>>,
  output: Result.Result<ItemStack, ItemStackFailure>,
  options?: RecipeOptions,
): Result.Result<ShapedRecipe, RecipeFailure> => {
  const prepared = Result.all([
    recipeId(id),
    patternRows(rows),
    patternKeyMap(key),
    Result.mapError(output, itemFailure),
  ])
  return Result.flatMap(prepared, ([validId, validRows, validKey, validOutput]) =>
    kernelShapedRecipe(validId, validRows, validKey, validOutput, options),
  )
}

export const shapelessRecipe = (
  id: string,
  ingredients: ReadonlyArray<CraftingIngredientInput>,
  output: Result.Result<ItemStack, ItemStackFailure>,
  options?: RecipeOptions,
): Result.Result<ShapelessRecipe, RecipeFailure> => {
  const prepared = Result.all([
    recipeId(id),
    Result.mapError(output, itemFailure),
  ])
  return Result.flatMap(prepared, ([validId, validOutput]) =>
    kernelShapelessRecipe(validId, ingredients, validOutput, options),
  )
}
