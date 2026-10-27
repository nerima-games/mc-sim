import { Result } from 'effect'
import {
  RecipeId,
  RecipePriority,
  isCraftingIngredient,
  isItemStack,
  type CraftingIngredient,
  type ItemStack,
  type RecipeId as RecipeIdValue,
  type RecipeMatchContext,
  type RecipePriority as RecipePriorityValue,
  type Slot,
} from '@nerima-games/mc-kernel'
import {
  comparePriorityAndId,
  consumeIngredient,
  isRecord,
  matchesIngredient,
  stationRecipeFailure,
  validateContext,
  validateRecipeTable,
  validateSlot,
  type StationRecipeFailure,
} from './station-recipe-support.js'

export const STONECUTTING_STATION_TAG = 'stonecutter'

export type StonecuttingRecipe = Readonly<{
  readonly _tag: 'Stonecutting'
  readonly id: RecipeIdValue
  readonly ingredient: CraftingIngredient
  readonly output: ItemStack
  readonly priority: RecipePriorityValue
  readonly showNotification?: boolean
}>
export type StonecuttingRecipeTable = ReadonlyArray<StonecuttingRecipe>
export type StonecuttingMatch =
  | { readonly _tag: 'Match'; readonly recipe: StonecuttingRecipe; readonly output: ItemStack }
  | { readonly _tag: 'NoMatch' }
export type StonecuttingApplyResult =
  | { readonly _tag: 'Applied'; readonly recipe: StonecuttingRecipe; readonly output: ItemStack; readonly remainingInput: Slot }
  | { readonly _tag: 'NoMatch' }

const isStonecuttingRecipe = (value: unknown): value is StonecuttingRecipe =>
  isRecord(value) &&
  value['_tag'] === 'Stonecutting' &&
  typeof value['id'] === 'string' && Result.isSuccess(RecipeId.result(value['id'])) &&
  isCraftingIngredient(value['ingredient']) &&
  isItemStack(value['output']) &&
  typeof value['priority'] === 'number' && Result.isSuccess(RecipePriority.result(value['priority'])) &&
  (value['showNotification'] === undefined || typeof value['showNotification'] === 'boolean')

const recipeFailure = (path: string): StationRecipeFailure =>
  stationRecipeFailure(path, 'expected a valid stonecutting recipe')

const stationMatches = (context: RecipeMatchContext): boolean =>
  context.station === undefined || context.station === STONECUTTING_STATION_TAG

const recipeMatches = (
  recipe: StonecuttingRecipe,
  input: Slot,
  context: RecipeMatchContext,
): Result.Result<boolean, StationRecipeFailure> =>
  input === undefined || !stationMatches(context)
    ? Result.succeed(false)
    : matchesIngredient(recipe.ingredient, input, context)

export const matchesStonecuttingRecipe = (
  recipe: unknown,
  input: unknown,
  context: unknown = {},
): Result.Result<boolean, StationRecipeFailure> => {
  if (!isStonecuttingRecipe(recipe)) return Result.fail(recipeFailure('recipe'))
  return Result.flatMap(validateSlot(input, 'input'), (validInput) =>
    Result.flatMap(validateContext(context), (validContext) =>
      recipeMatches(recipe, validInput, validContext),
    ),
  )
}

export const matchStonecuttingRecipes = (
  input: unknown,
  context: unknown,
  recipes: unknown,
): Result.Result<StonecuttingRecipeTable, StationRecipeFailure> =>
  Result.flatMap(validateSlot(input, 'input'), (validInput) =>
    Result.flatMap(validateContext(context), (validContext) =>
      Result.flatMap(validateRecipeTable(recipes, isStonecuttingRecipe, 'recipes'), (table) =>
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

export const matchStonecuttingRecipe = (
  input: unknown,
  context: unknown,
  recipes: unknown,
): Result.Result<StonecuttingMatch, StationRecipeFailure> =>
  Result.map(matchStonecuttingRecipes(input, context, recipes), (matches) => {
    const recipe = matches[0]
    return recipe === undefined ? { _tag: 'NoMatch' } : { _tag: 'Match', recipe, output: recipe.output }
  })

export const applyStonecutting = (
  recipe: unknown,
  input: unknown,
  context: unknown = {},
): Result.Result<StonecuttingApplyResult, StationRecipeFailure> => {
  if (!isStonecuttingRecipe(recipe)) return Result.fail(recipeFailure('recipe'))
  return Result.flatMap(validateSlot(input, 'input'), (validInput) =>
    Result.flatMap(validateContext(context), (validContext) =>
      Result.flatMap(recipeMatches(recipe, validInput, validContext), (matches): Result.Result<StonecuttingApplyResult, StationRecipeFailure> => {
        if (!matches || validInput === undefined) return Result.succeed<StonecuttingApplyResult>({ _tag: 'NoMatch' })
        return Result.map(consumeIngredient(validInput, recipe.ingredient), (remainingInput): StonecuttingApplyResult => ({
          _tag: 'Applied',
          recipe,
          output: recipe.output,
          remainingInput,
        }))
      }),
    ),
  )
}
