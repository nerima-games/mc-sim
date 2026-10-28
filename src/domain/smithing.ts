import { Result } from 'effect'
import {
  RecipeId,
  RecipePriority,
  RecipeStationTag,
  isCraftingIngredient,
  isItemStack,
  type CraftingIngredient,
  type ItemStack,
  type RecipeId as RecipeIdValue,
  type RecipeMatchContext,
  type RecipePriority as RecipePriorityValue,
  type RecipeStationTag as RecipeStationTagValue,
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

export const SMITHING_STATION_TAG = 'smithing_table'

type SmithingRecipeBase = Readonly<{
  readonly id: RecipeIdValue
  readonly template: CraftingIngredient
  readonly base: CraftingIngredient
  readonly addition: CraftingIngredient
  readonly priority: RecipePriorityValue
  readonly showNotification?: boolean
  readonly tags: ReadonlyArray<RecipeStationTagValue>
}>

export type SmithingTransformRecipe = SmithingRecipeBase & Readonly<{
  readonly _tag: 'SmithingTransform'
  readonly output: ItemStack
}>
export type SmithingTrimRecipe = SmithingRecipeBase & Readonly<{ readonly _tag: 'SmithingTrim' }>
export type SmithingRecipe = SmithingTransformRecipe | SmithingTrimRecipe
export type SmithingRecipeTable = ReadonlyArray<SmithingRecipe>
export type SmithingInput = Readonly<{ readonly template: Slot; readonly base: Slot; readonly addition: Slot }>
export type SmithingInputInput = Partial<SmithingInput>
export type SmithingOperation =
  | { readonly _tag: 'NoMatch' }
  | { readonly _tag: 'Transform'; readonly recipe: SmithingTransformRecipe; readonly output: ItemStack; readonly remaining: SmithingInput }
  | { readonly _tag: 'Trim'; readonly recipe: SmithingTrimRecipe; readonly base: ItemStack; readonly remaining: SmithingInput }

type CompleteSmithingInput = Readonly<{ readonly template: ItemStack; readonly base: ItemStack; readonly addition: ItemStack }>

const completeSmithingInput = (input: SmithingInput): CompleteSmithingInput | undefined =>
  input.template !== undefined && input.base !== undefined && input.addition !== undefined
    ? { template: input.template, base: input.base, addition: input.addition }
    : undefined

const isSmithingRecipe = (value: unknown): value is SmithingRecipe =>
  isRecord(value) &&
  (value['_tag'] === 'SmithingTransform' || value['_tag'] === 'SmithingTrim') &&
  typeof value['id'] === 'string' && Result.isSuccess(RecipeId.result(value['id'])) &&
  isCraftingIngredient(value['template']) &&
  isCraftingIngredient(value['base']) &&
  isCraftingIngredient(value['addition']) &&
  (value['_tag'] !== 'SmithingTransform' || isItemStack(value['output'])) &&
  typeof value['priority'] === 'number' && Result.isSuccess(RecipePriority.result(value['priority'])) &&
  (value['showNotification'] === undefined || typeof value['showNotification'] === 'boolean') &&
  Array.isArray(value['tags']) && value['tags'].every((tag) =>
    typeof tag === 'string' && Result.isSuccess(RecipeStationTag.result(tag)),
  )

const recipeFailure = (path: string): StationRecipeFailure =>
  stationRecipeFailure(path, 'expected a valid smithing recipe')

const validateSmithingInput = (value: unknown): Result.Result<SmithingInput, StationRecipeFailure> => {
  if (!isRecord(value)) return Result.fail(stationRecipeFailure('input', 'expected a smithing input object'))
  const template = validateSlot(value['template'], 'template')
  const base = validateSlot(value['base'], 'base')
  const addition = validateSlot(value['addition'], 'addition')
  return Result.map(Result.all([template, base, addition]), ([validTemplate, validBase, validAddition]) => ({
    template: validTemplate,
    base: validBase,
    addition: validAddition,
  }))
}

export const smithingInput = (
  input: unknown = {},
): Result.Result<SmithingInput, StationRecipeFailure> => validateSmithingInput(input)

const stationMatches = (recipe: SmithingRecipe, context: RecipeMatchContext): boolean => {
  const station = context.station ?? SMITHING_STATION_TAG
  return recipe.tags.length === 0 || recipe.tags.some((tag) => tag === station)
}

const recipeMatches = (
  recipe: SmithingRecipe,
  input: SmithingInput,
  context: RecipeMatchContext,
): Result.Result<boolean, StationRecipeFailure> => {
  if (!stationMatches(recipe, context)) return Result.succeed(false)
  const checks = [
    matchesIngredient(recipe.template, input.template, context),
    matchesIngredient(recipe.base, input.base, context),
    matchesIngredient(recipe.addition, input.addition, context),
  ]
  return Result.map(Result.all(checks), (matches) => matches.every(Boolean))
}

export const matchesSmithingRecipe = (
  recipe: unknown,
  input: unknown,
  context: unknown = {},
): Result.Result<boolean, StationRecipeFailure> => {
  if (!isSmithingRecipe(recipe)) return Result.fail(recipeFailure('recipe'))
  return Result.flatMap(validateSmithingInput(input), (validInput) =>
    Result.flatMap(validateContext(context), (validContext) =>
      recipeMatches(recipe, validInput, validContext),
    ),
  )
}

export const matchSmithingRecipe = (
  input: unknown,
  context: unknown,
  recipes: unknown,
): Result.Result<SmithingRecipe | undefined, StationRecipeFailure> =>
  Result.flatMap(validateSmithingInput(input), (validInput) =>
    Result.flatMap(validateContext(context), (validContext) =>
      Result.flatMap(validateRecipeTable(recipes, isSmithingRecipe, 'recipes'), (table) =>
        Result.flatMap(
          Result.all(table.map((recipe) => Result.map(recipeMatches(recipe, validInput, validContext), (matches) => ({ recipe, matches })))),
          (evaluated) => Result.succeed(evaluated
            .filter((entry) => entry.matches)
            .map((entry) => entry.recipe)
            .sort(comparePriorityAndId)[0]),
        ),
      ),
    ),
  )

const consumeSlot = (
  slot: ItemStack,
  ingredient: CraftingIngredient,
): Result.Result<Slot, StationRecipeFailure> => consumeIngredient(slot, ingredient)

export const applySmithing = (
  input: unknown,
  context: unknown,
  recipes: unknown,
): Result.Result<SmithingOperation, StationRecipeFailure> =>
  Result.flatMap(validateSmithingInput(input), (validInput) =>
    Result.flatMap(validateContext(context), (validContext) =>
      Result.flatMap(matchSmithingRecipe(validInput, validContext, recipes), (recipe): Result.Result<SmithingOperation, StationRecipeFailure> => {
        const completeInput = completeSmithingInput(validInput)
        if (completeInput === undefined || recipe === undefined) return Result.succeed<SmithingOperation>({ _tag: 'NoMatch' })
        const remaining = Result.all([
          consumeSlot(completeInput.template, recipe.template),
          consumeSlot(completeInput.base, recipe.base),
          consumeSlot(completeInput.addition, recipe.addition),
        ])
        return Result.flatMap(remaining, ([template, remainingBase, addition]): Result.Result<SmithingOperation, StationRecipeFailure> => {
          const nextInput = { template, base: remainingBase, addition }
          if (recipe._tag === 'SmithingTransform') {
            return Result.succeed<SmithingOperation>({ _tag: 'Transform', recipe, output: recipe.output, remaining: nextInput })
          }
          return Result.succeed<SmithingOperation>({ _tag: 'Trim', recipe, base: completeInput.base, remaining: nextInput })
        })
      }),
    ),
  )

export const matchSmithingRecipes = (
  input: unknown,
  context: unknown,
  recipes: unknown,
): Result.Result<SmithingRecipeTable, StationRecipeFailure> =>
  Result.flatMap(validateSmithingInput(input), (validInput) =>
    Result.flatMap(validateContext(context), (validContext) =>
      Result.flatMap(validateRecipeTable(recipes, isSmithingRecipe, 'recipes'), (table) =>
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
