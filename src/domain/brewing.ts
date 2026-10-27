import { Brand, Result, Schema, SchemaIssue } from 'effect'
import {
  BREWING_BOTTLE_SLOTS,
  BREWING_FUEL_ITEM,
  BREWING_MAX_FUEL_CHARGES,
  BREWING_TIME_SECS,
  BrewingFuelCharges,
  FixedDurationSecs,
  RecipeCompletionCount,
  brewingOutput as kernelBrewingOutput,
  isItemStack,
  isItemType,
  itemStackFromUnknown,
  type BrewingAdvanceResult,
  type BrewingBottles,
  type BrewingRecipe,
  type BrewingState,
  type BrewingStateInput,
  type ItemStack,
  type RecipeFailure,
  type Slot,
} from '@nerima-games/mc-kernel'
import {
  BREWING_FUEL_CHARGES,
  STARTER_BREWING_RECIPES,
  VANILLA_BREWING_RECIPES,
  type BrewingRecipeInput,
} from './brewing-data.js'
import { itemStack } from './inventory.js'
import type { ItemStackFailure } from './inventory.js'
import { itemStackWithCount } from './item-stack.js'

export {
  BREWING_BOTTLE_SLOTS,
  BREWING_FUEL_ITEM,
  BREWING_FUEL_CHARGES,
  BREWING_MAX_FUEL_CHARGES,
  BREWING_TIME_SECS,
  VANILLA_BREWING_RECIPES,
}
export type {
  BrewingAdvanceResult,
  BrewingBottles,
  BrewingRecipe,
  BrewingState,
  BrewingStateInput,
}

export type BrewingValidationFailure = Readonly<{
  readonly _tag: 'BrewingValidationFailure'
  readonly path: string
  readonly reason: string
}>
export type BrewingFailure = Brand.BrandError | ItemStackFailure | RecipeFailure | BrewingValidationFailure
export type BrewingOutcome = BrewingAdvanceResult & Readonly<{ readonly brewed: number }>
export type BrewingBottleResult = Result.Result<BrewingState, BrewingFailure>
export type BrewingFuelResult = Result.Result<BrewingState, BrewingFailure>
export type BrewingSnapshotValidationResult =
  | { readonly _tag: 'Valid'; readonly state: BrewingState }
  | { readonly _tag: 'Invalid'; readonly error: BrewingValidationFailure }
  | { readonly _tag: 'Failure'; readonly error: Exclude<BrewingFailure, BrewingValidationFailure> }

type RecordValue = Readonly<Record<string, unknown>>
type SlotValue = ItemStack | undefined

const invalid = (path: string, reason: string): BrewingValidationFailure => ({
  _tag: 'BrewingValidationFailure',
  path,
  reason,
})
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const validateSlot = (
  value: unknown,
  path: string,
): Result.Result<SlotValue, BrewingFailure> =>
  value === undefined
    ? Result.succeed(undefined)
    : isRecord(value) && Object.keys(value).every((key) => ['item', 'count', 'components'].includes(key)) && isItemStack(value)
      ? itemStack(value.item, value.count, { components: value.components })
      : isRecord(value) && Object.keys(value).every((key) => ['item', 'count', 'components'].includes(key)) && isItemType(value['item'])
        ? Object.hasOwn(value, 'count') && Object.hasOwn(value, 'components')
          ? itemStackFromUnknown(value['item'], value['count'], { components: value['components'] })
          : Result.fail(invalid(path, 'expected an ItemStack or undefined'))
        : Result.fail(invalid(path, 'expected an ItemStack or undefined'))

export const brewingState = (
  input: unknown = {},
): Result.Result<BrewingState, BrewingFailure> => {
  if (!isRecord(input)) return Result.fail(invalid('state', 'expected an object'))
  const rawBottles = input['bottles'] ?? [undefined, undefined, undefined]
  if (!Array.isArray(rawBottles) || rawBottles.length !== BREWING_BOTTLE_SLOTS) {
    return Result.fail(invalid('bottles', 'expected exactly three bottle slots'))
  }
  const first = rawBottles[0]
  const second = rawBottles[1]
  const third = rawBottles[2]
  const firstBottle = validateSlot(first, 'bottles[0]')
  const secondBottle = validateSlot(second, 'bottles[1]')
  const thirdBottle = validateSlot(third, 'bottles[2]')
  const ingredient = validateSlot(input['ingredient'], 'ingredient')
  const fuel = validateSlot(input['fuel'], 'fuel')
  const rawCharges = Object.hasOwn(input, 'fuelCharges') ? input['fuelCharges'] : 0
  if (typeof rawCharges !== 'number' || !Number.isInteger(rawCharges)) {
    return Result.fail(invalid('fuelCharges', 'must be an integer'))
  }
  const charges = BrewingFuelCharges.result(rawCharges)
  const rawProgress = Object.hasOwn(input, 'brewProgressSecs') ? input['brewProgressSecs'] : 0
  if (!isFiniteNonNegative(rawProgress) || rawProgress >= BREWING_TIME_SECS) {
    return Result.fail(invalid('brewProgressSecs', 'must be finite and less than the brew duration'))
  }
  const progress = FixedDurationSecs.result(rawProgress)
  return Result.map(
    Result.all([firstBottle, secondBottle, thirdBottle, ingredient, fuel, charges, progress]),
    ([validFirstBottle, validSecondBottle, validThirdBottle, validIngredient, validFuel, validCharges, validProgress]) => ({
      bottles: [validFirstBottle, validSecondBottle, validThirdBottle],
      ingredient: validIngredient,
      fuel: validFuel,
      fuelCharges: validCharges,
      brewProgressSecs: validProgress,
    }),
  )
}

export const emptyBrewingState = (): Result.Result<BrewingState, BrewingFailure> => brewingState()

export const validateBrewingSnapshot = (value: unknown): BrewingSnapshotValidationResult => {
  if (!isRecord(value)) return { _tag: 'Invalid', error: invalid('snapshot', 'expected an object') }
  const requiredFields = ['bottles', 'fuelCharges', 'brewProgressSecs']
  const optionalFields = ['ingredient', 'fuel']
  const fields = [...requiredFields, ...optionalFields]
  if (
    requiredFields.some((field) => !Object.hasOwn(value, field)) ||
    Object.keys(value).some((field) => !fields.includes(field))
  ) {
    return { _tag: 'Invalid', error: invalid('snapshot', 'expected the complete brewing state') }
  }
  const bottles = value['bottles']
  const normalized = Array.isArray(bottles)
    ? { ...value, bottles: bottles.map((bottle) => bottle === null ? undefined : bottle) }
    : value
  const state = brewingState({
    ...normalized,
    ingredient: normalized['ingredient'] === null ? undefined : normalized['ingredient'],
    fuel: normalized['fuel'] === null ? undefined : normalized['fuel'],
  })
  if (Result.isFailure(state)) {
    return state.failure._tag === 'BrewingValidationFailure'
      ? { _tag: 'Invalid', error: state.failure }
      : { _tag: 'Failure', error: state.failure }
  }
  return { _tag: 'Valid', state: state.success }
}

const validRecipe = (value: unknown): value is BrewingRecipeInput =>
  isRecord(value) &&
  typeof value['id'] === 'string' &&
  value['id'].length > 0 &&
  isItemType(value['input']) &&
  isItemType(value['ingredient']) &&
  isItemType(value['output']) &&
  (value['_tag'] === undefined || value['_tag'] === 'Brewing')

const validateRecipe = (
  value: unknown,
): Result.Result<BrewingRecipeInput, BrewingFailure> =>
  validRecipe(value)
    ? Result.succeed(value)
    : Result.fail(invalid('recipe', 'invalid brewing recipe'))

const resolveRecipes = (
  recipes: unknown,
): Result.Result<ReadonlyArray<BrewingRecipeInput>, BrewingFailure> => {
  if (recipes === VANILLA_BREWING_RECIPES) return Result.succeed(VANILLA_BREWING_RECIPES)
  if (recipes === STARTER_BREWING_RECIPES) return Result.succeed(STARTER_BREWING_RECIPES)
  if (!Array.isArray(recipes)) return Result.fail(invalid('recipes', 'expected an array'))
  return Result.all(recipes.map(validateRecipe))
}

const matchRecipe = (
  bottles: BrewingBottles,
  ingredient: SlotValue,
  recipes: ReadonlyArray<BrewingRecipeInput>,
): BrewingRecipeInput | undefined => {
  if (ingredient === undefined) return undefined
  const occupiedBottle = bottles.find((bottle) => bottle !== undefined)
  if (occupiedBottle === undefined) return undefined
  return recipes.find((recipe) =>
    recipe.ingredient === ingredient.item &&
    bottles.some((bottle) => bottle?.item === recipe.input),
  )
}

export const matchBrewingRecipe = (
  bottles: BrewingBottles,
  ingredient: SlotValue,
  recipes: ReadonlyArray<BrewingRecipeInput> = VANILLA_BREWING_RECIPES,
): Result.Result<BrewingRecipeInput | undefined, BrewingFailure> => {
  const validBottles = brewingState({ bottles, ingredient, fuelCharges: 0 })
  if (Result.isFailure(validBottles)) return Result.fail(validBottles.failure)
  return Result.map(resolveRecipes(recipes), (table) => matchRecipe(bottles, ingredient, table))
}

export const brewingRecipeFor = (
  ingredient: SlotValue,
  bottle: SlotValue,
  recipes: ReadonlyArray<BrewingRecipeInput> = VANILLA_BREWING_RECIPES,
): Result.Result<BrewingRecipeInput | undefined, BrewingFailure> => {
  if (ingredient !== undefined && !isItemStack(ingredient)) return Result.fail(invalid('ingredient', 'expected an ItemStack'))
  if (bottle !== undefined && !isItemStack(bottle)) return Result.fail(invalid('bottle', 'expected an ItemStack'))
  if (ingredient === undefined || bottle === undefined) return Result.succeed(undefined)
  return Result.map(resolveRecipes(recipes), (table) =>
    table.find((recipe) => recipe.ingredient === ingredient.item && recipe.input === bottle.item),
  )
}

export const activeBrewingRecipe = (
  state: BrewingState,
  recipes: ReadonlyArray<BrewingRecipeInput> = VANILLA_BREWING_RECIPES,
): Result.Result<BrewingRecipeInput | undefined, BrewingFailure> => {
  const validated = brewingState(state)
  if (Result.isFailure(validated)) return Result.fail(validated.failure)
  if (validated.success.fuelCharges < 1) return Result.succeed(undefined)
  return matchBrewingRecipe(validated.success.bottles, validated.success.ingredient, recipes)
}

export const setBrewingBottle = (
  state: BrewingState,
  index: number,
  bottle: SlotValue,
): BrewingBottleResult => {
  const validated = brewingState(state)
  if (Result.isFailure(validated)) return Result.fail(validated.failure)
  if (!Number.isSafeInteger(index) || index < 0 || index >= BREWING_BOTTLE_SLOTS) {
    return Result.fail(invalid('index', 'must identify one of the three bottle slots'))
  }
  const validBottle = validateSlot(bottle, 'bottle')
  if (Result.isFailure(validBottle)) return Result.fail(validBottle.failure)
  const [first, second, third] = validated.success.bottles
  const bottles: BrewingBottles =
    index === 0 ? [validBottle.success, second, third] :
    index === 1 ? [first, validBottle.success, third] :
    [first, second, validBottle.success]
  return Result.succeed({ ...validated.success, bottles })
}

export const setBrewingIngredient = (
  state: BrewingState,
  ingredient: SlotValue,
): BrewingBottleResult => {
  const validated = brewingState(state)
  if (Result.isFailure(validated)) return Result.fail(validated.failure)
  const validIngredient = validateSlot(ingredient, 'ingredient')
  return Result.map(validIngredient, (value) => ({ ...validated.success, ingredient: value }))
}

export const consumeIngredient = (ingredient: ItemStack): Result.Result<Slot, ItemStackFailure> =>
  isItemStack(ingredient)
    ? ingredient.count === 1
      ? Result.succeed(undefined)
      : itemStackWithCount(ingredient, ingredient.count - 1)
    : Result.fail(new Brand.BrandError(new SchemaIssue.InvalidType(Schema.Unknown.ast, ingredient)))

const outputFor = (recipe: BrewingRecipeInput): Result.Result<ItemStack, BrewingFailure> =>
  '_tag' in recipe && recipe._tag === 'Brewing'
    ? kernelBrewingOutput(recipe)
    : itemStack(recipe.output, 1)

export const brewOnce = (
  state: BrewingState,
  ingredient: ItemStack,
  recipe: BrewingRecipeInput,
): Result.Result<BrewingState, BrewingFailure> => {
  if (!isRecord(state) || !['bottles', 'fuelCharges', 'brewProgressSecs'].every((field) => Object.hasOwn(state, field))) {
    return Result.fail(invalid('state', 'expected a complete brewing state'))
  }
  if (!isFiniteNonNegative(state['brewProgressSecs']) || state['brewProgressSecs'] > BREWING_TIME_SECS) {
    return Result.fail(invalid('brewProgressSecs', 'must be finite and no greater than the brew duration'))
  }
  const validatedState = brewingState({ ...state, brewProgressSecs: 0 })
  if (Result.isFailure(validatedState)) return Result.fail(validatedState.failure)
  const validatedIngredient = validateSlot(ingredient, 'ingredient')
  if (Result.isFailure(validatedIngredient)) return Result.fail(validatedIngredient.failure)
  if (validatedIngredient.success === undefined) {
    return Result.fail(invalid('ingredient', 'expected an ItemStack'))
  }
  const validatedRecipe = validateRecipe(recipe)
  if (Result.isFailure(validatedRecipe)) return Result.fail(validatedRecipe.failure)
  const validState = validatedState.success
  const validIngredient = validatedIngredient.success
  const validRecipe = validatedRecipe.success
  const output = outputFor(validRecipe)
  if (Result.isFailure(output)) return Result.fail(output.failure)
  const updateBottle = (bottle: SlotValue) =>
    bottle?.item === validRecipe.input ? output.success : bottle
  const updatedBottles = [
    updateBottle(validState.bottles[0]),
    updateBottle(validState.bottles[1]),
    updateBottle(validState.bottles[2]),
  ] as const
  const remainingIngredient = consumeIngredient(validIngredient)
  if (Result.isFailure(remainingIngredient)) return Result.fail(remainingIngredient.failure)
  const fuelCharges = BrewingFuelCharges.result(validState.fuelCharges - 1)
  if (Result.isFailure(fuelCharges)) return Result.fail(fuelCharges.failure)
  const progress = FixedDurationSecs.result(0)
  if (Result.isFailure(progress)) return Result.fail(progress.failure)
  return Result.succeed({
    ...validState,
    ingredient: remainingIngredient.success,
    fuelCharges: fuelCharges.success,
    brewProgressSecs: progress.success,
    bottles: updatedBottles,
  })
}

export const addBrewingFuel = (
  state: BrewingState,
): BrewingFuelResult => {
  const validated = brewingState(state)
  if (Result.isFailure(validated)) return Result.fail(validated.failure)
  if (
    validated.success.fuel === undefined ||
    validated.success.fuel.item !== BREWING_FUEL_ITEM ||
    validated.success.fuelCharges === BREWING_MAX_FUEL_CHARGES
  ) {
    return Result.succeed(validated.success)
  }
  const fuel = consumeIngredient(validated.success.fuel)
  if (Result.isFailure(fuel)) return Result.fail(fuel.failure)
  return Result.succeed({
    ...validated.success,
    fuel: fuel.success,
    fuelCharges: BREWING_MAX_FUEL_CHARGES,
  })
}

export const advanceBrewing = (
  state: BrewingState,
  elapsedSecs: number,
  recipes: ReadonlyArray<BrewingRecipeInput> = VANILLA_BREWING_RECIPES,
): Result.Result<BrewingOutcome, BrewingFailure> => {
  const validated = brewingState(state)
  if (Result.isFailure(validated)) return Result.fail(validated.failure)
  if (!isFiniteNonNegative(elapsedSecs)) {
    return Result.fail(invalid('elapsedSecs', 'must be finite and non-negative'))
  }
  const elapsed = FixedDurationSecs.result(elapsedSecs)
  if (Result.isFailure(elapsed)) return Result.fail(elapsed.failure)
  const recipeTable = resolveRecipes(recipes)
  if (Result.isFailure(recipeTable)) return Result.fail(recipeTable.failure)

  let current = validated.success
  let remaining: number = elapsed.success
  let brewedCount = 0
  while (remaining > 0) {
    const ingredient = current.ingredient
    const recipe = matchRecipe(current.bottles, current.ingredient, recipeTable.success)
    if (ingredient === undefined || recipe === undefined) {
      const progress = FixedDurationSecs.result(0)
      if (Result.isFailure(progress)) return Result.fail(progress.failure)
      current = { ...current, brewProgressSecs: progress.success }
      break
    }
    if (current.fuelCharges === 0) break

    const step = Math.min(remaining, BREWING_TIME_SECS - current.brewProgressSecs)
    const progress = FixedDurationSecs.result(current.brewProgressSecs + step)
    if (Result.isFailure(progress)) return Result.fail(progress.failure)
    current = { ...current, brewProgressSecs: progress.success }
    remaining -= step

    if (current.brewProgressSecs >= BREWING_TIME_SECS) {
      const brewed = brewOnce(current, ingredient, recipe)
      if (Result.isFailure(brewed)) return Result.fail(brewed.failure)
      current = brewed.success
      brewedCount += 1
    }
  }

  return Result.map(RecipeCompletionCount.result(brewedCount), (count) => ({
    state: current,
    brewedCount: count,
    brewed: count,
  }))
}
