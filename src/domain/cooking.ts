import { Result } from 'effect'
import {
  COOKING_STATIONS,
  PositiveTickCount,
  RecipeExperience,
  RecipeGroup,
  RecipeId,
  RecipePriority,
  isCraftingIngredient,
  isItemStack,
  type CookingStation,
  type CraftingIngredient,
  type ItemStack,
  type RecipeCategory,
  type PositiveTickCount as PositiveTickCountValue,
  type RecipeExperience as RecipeExperienceValue,
  type RecipeGroup as RecipeGroupValue,
  type RecipeId as RecipeIdValue,
  type RecipeMatchContext,
  type RecipePriority as RecipePriorityValue,
  type Slot,
} from '@nerima-games/mc-kernel'
import {
  comparePriorityAndId,
  isRecord,
  consumeIngredient,
  matchesIngredient,
  stationRecipeFailure,
  validateContext,
  validateRecipeTable,
  validateSlot,
  type StationRecipeFailure,
} from './station-recipe-support.js'

export type CookingRecipe = Readonly<{
  readonly _tag: 'Cooking'
  readonly id: RecipeIdValue
  readonly station: CookingStation
  readonly ingredient: CraftingIngredient
  readonly output: ItemStack
  readonly cookTimeTicks: PositiveTickCountValue
  readonly experience: RecipeExperienceValue
  readonly category?: RecipeCategory
  readonly group?: RecipeGroupValue
  readonly priority: RecipePriorityValue
  readonly showNotification?: boolean
}>

export type CookingRecipeTable = ReadonlyArray<CookingRecipe>
export type CookingInput = Slot
export type CookingMatch =
  | { readonly _tag: 'Match'; readonly recipe: CookingRecipe; readonly output: ItemStack }
  | { readonly _tag: 'NoMatch' }
export type CookingApplyResult =
  | { readonly _tag: 'Applied'; readonly recipe: CookingRecipe; readonly output: ItemStack; readonly remainingInput: CookingInput }
  | { readonly _tag: 'NoMatch' }

const isCookingStation = (value: unknown): value is CookingStation =>
  typeof value === 'string' && COOKING_STATIONS.some((station) => station === value)

const isCategory = (value: unknown): value is RecipeCategory =>
  value === 'building' || value === 'equipment' || value === 'misc' || value === 'redstone'

const isCookingRecipe = (value: unknown): value is CookingRecipe =>
  isRecord(value) &&
  value['_tag'] === 'Cooking' &&
  typeof value['id'] === 'string' && Result.isSuccess(RecipeId.result(value['id'])) &&
  isCookingStation(value['station']) &&
  isCraftingIngredient(value['ingredient']) &&
  isItemStack(value['output']) &&
  typeof value['cookTimeTicks'] === 'number' && Result.isSuccess(PositiveTickCount.result(value['cookTimeTicks'])) &&
  typeof value['experience'] === 'number' && Result.isSuccess(RecipeExperience.result(value['experience'])) &&
  (value['category'] === undefined || isCategory(value['category'])) &&
  (value['group'] === undefined || typeof value['group'] === 'string' && Result.isSuccess(RecipeGroup.result(value['group']))) &&
  typeof value['priority'] === 'number' && Result.isSuccess(RecipePriority.result(value['priority'])) &&
  (value['showNotification'] === undefined || typeof value['showNotification'] === 'boolean')

const recipeFailure = (path: string): StationRecipeFailure =>
  stationRecipeFailure(path, 'expected a valid cooking recipe')

const recipeMatches = (
  recipe: CookingRecipe,
  input: CookingInput,
  context: RecipeMatchContext,
): Result.Result<boolean, StationRecipeFailure> =>
  input === undefined || (context.station !== undefined && recipe.station !== context.station)
    ? Result.succeed(false)
    : matchesIngredient(recipe.ingredient, input, context)

export const matchesCookingRecipe = (
  recipe: unknown,
  input: unknown,
  context: unknown = {},
): Result.Result<boolean, StationRecipeFailure> => {
  if (!isCookingRecipe(recipe)) return Result.fail(recipeFailure('recipe'))
  return Result.flatMap(validateSlot(input, 'input'), (validInput) =>
    Result.flatMap(validateContext(context), (validContext) =>
      recipeMatches(recipe, validInput, validContext),
    ),
  )
}
export const matchCookingRecipes = (
  input: unknown,
  context: unknown = {},
  recipes: unknown = [],
): Result.Result<CookingRecipeTable, StationRecipeFailure> =>
  Result.flatMap(validateSlot(input, 'input'), (validInput) =>
    Result.flatMap(validateContext(context), (validContext) =>
      Result.flatMap(validateRecipeTable(recipes, isCookingRecipe, 'recipes'), (table) =>
        Result.map(
          Result.all(table.map((recipe) => Result.map(recipeMatches(recipe, validInput, validContext), (matches) => ({ recipe, matches })))),
          (evaluated) => evaluated
            .filter((entry) => entry.matches)
            .map((entry) => entry.recipe)
            .sort(comparePriorityAndId),
        ),
      ),
    ),
  )

export const matchCookingRecipe = (
  input: unknown,
  context: unknown = {},
  recipes: unknown = [],
): Result.Result<CookingMatch, StationRecipeFailure> =>
  Result.map(matchCookingRecipes(input, context, recipes), (matches) => {
    const recipe = matches[0]
    return recipe === undefined ? { _tag: 'NoMatch' } : { _tag: 'Match', recipe, output: recipe.output }
  })

export const applyCooking = (
  recipe: unknown,
  input: unknown,
  context: unknown = {},
): Result.Result<CookingApplyResult, StationRecipeFailure> => {
  if (!isCookingRecipe(recipe)) return Result.fail(recipeFailure('recipe'))
  return Result.flatMap(validateSlot(input, 'input'), (validInput) =>
    Result.flatMap(validateContext(context), (validContext) =>
      Result.flatMap(recipeMatches(recipe, validInput, validContext), (matches): Result.Result<CookingApplyResult, StationRecipeFailure> => {
        if (!matches || validInput === undefined) return Result.succeed<CookingApplyResult>({ _tag: 'NoMatch' })
        return Result.map(consumeIngredient(validInput, recipe.ingredient), (remainingInput): CookingApplyResult => ({
          _tag: 'Applied',
          recipe,
          output: recipe.output,
          remainingInput,
        }))
      }),
    ),
  )
}
