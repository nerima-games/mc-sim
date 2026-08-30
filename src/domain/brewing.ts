import type { ItemType } from '@nerima-games/mc-kernel'

import {
  BREWING_FUEL_CHARGES,
  BREWING_FUEL_ITEM,
  BREWING_TIME_SECS,
  STARTER_BREWING_RECIPES,
  type BrewingRecipe,
} from './brewing-data.js'
import { itemStack, type ItemStack, type Slot } from './inventory.js'

export const BREWING_BOTTLE_SLOTS = 3

export type BrewingState = {
  readonly bottles: readonly [Slot, Slot, Slot]
  readonly ingredient: Slot
  readonly fuelCharges: number
  readonly brewTimeSecs: number
}

export type BrewingAdvanceResult = {
  readonly state: BrewingState
  readonly brewed: number
}

export type BrewingFuelResult = {
  readonly state: BrewingState
  readonly accepted: number
  readonly leftover: number
}

export type BrewingBottleResult =
  | { readonly ok: true; readonly state: BrewingState }
  | { readonly ok: false; readonly reason: 'invalid-index' }

export const emptyBrewingState = (): BrewingState => ({
  bottles: [undefined, undefined, undefined],
  ingredient: undefined,
  fuelCharges: 0,
  brewTimeSecs: 0,
})

export const setBrewingBottle = (
  state: BrewingState,
  index: number,
  bottle: Slot,
): BrewingBottleResult => {
  if (!Number.isInteger(index) || index < 0 || index >= BREWING_BOTTLE_SLOTS) {
    return { ok: false, reason: 'invalid-index' }
  }

  const bottles: [Slot, Slot, Slot] = [...state.bottles]
  bottles[index] = bottle
  return { ok: true, state: { ...state, bottles } }
}

export const setBrewingIngredient = (
  state: BrewingState,
  ingredient: Slot,
): BrewingState => ({ ...state, ingredient })

export const addBrewingFuel = (
  state: BrewingState,
  item: ItemType,
  count: number,
): BrewingFuelResult => {
  if (item !== BREWING_FUEL_ITEM || !Number.isSafeInteger(count) || count <= 0) {
    return { state, accepted: 0, leftover: Number.isFinite(count) && count > 0 ? count : 0 }
  }

  return {
    state: {
      ...state,
      fuelCharges: state.fuelCharges + count * BREWING_FUEL_CHARGES,
    },
    accepted: count,
    leftover: 0,
  }
}

export const brewingRecipeFor = (
  ingredient: Slot,
  bottle: Slot,
  recipes: ReadonlyArray<BrewingRecipe> = STARTER_BREWING_RECIPES,
): BrewingRecipe | undefined => {
  if (ingredient === undefined || bottle === undefined) return undefined

  return recipes.find(
    (recipe) => recipe.ingredient === ingredient.item && recipe.input === bottle.item,
  )
}

export const activeBrewingRecipe = (
  state: BrewingState,
  recipes: ReadonlyArray<BrewingRecipe> = STARTER_BREWING_RECIPES,
): BrewingRecipe | undefined => {
  if (state.fuelCharges < 1 || state.ingredient === undefined) return undefined

  return state.bottles
    .map((bottle) => brewingRecipeFor(state.ingredient, bottle, recipes))
    .find((recipe): recipe is BrewingRecipe => recipe !== undefined)
}

const consumeIngredient = (ingredient: ItemStack): Slot =>
  ingredient.count === 1 ? undefined : itemStack(ingredient.item, ingredient.count - 1)

const brewOnce = (
  state: BrewingState,
  ingredient: ItemStack,
  recipe: BrewingRecipe,
): BrewingState => ({
  ...state,
  ingredient: consumeIngredient(ingredient),
  fuelCharges: state.fuelCharges - 1,
  bottles: state.bottles.map((bottle) =>
    bottle?.item === recipe.input ? itemStack(recipe.output, bottle.count) : bottle,
  ) as [Slot, Slot, Slot],
})

export const advanceBrewing = (
  state: BrewingState,
  deltaSecs: number,
  recipes: ReadonlyArray<BrewingRecipe> = STARTER_BREWING_RECIPES,
): BrewingAdvanceResult => {
  if (!Number.isFinite(deltaSecs) || deltaSecs < 0) return { state, brewed: 0 }

  let currentState = state
  let remainingSecs = state.brewTimeSecs + deltaSecs
  let brewed = 0

  while (remainingSecs >= BREWING_TIME_SECS) {
    const ingredient = currentState.ingredient
    if (ingredient === undefined) break
    const recipe = activeBrewingRecipe(currentState, recipes)
    if (recipe === undefined) break

    currentState = brewOnce(currentState, ingredient, recipe)
    remainingSecs -= BREWING_TIME_SECS
    brewed += 1
  }

  return {
    state: { ...currentState, brewTimeSecs: remainingSecs },
    brewed,
  }
}
