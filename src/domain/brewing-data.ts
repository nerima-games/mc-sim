import {
  BREWING_BOTTLE_SLOTS,
  BREWING_FUEL_ITEM,
  BREWING_MAX_FUEL_CHARGES,
  BREWING_TIME_SECS,
  VANILLA_BREWING_RECIPES,
  type BrewingBottles,
  type BrewingFuelCharges,
  type BrewingRecipe as KernelBrewingRecipe,
  type BrewingRecipeTable,
  type BrewingState,
  type BrewingStateInput,
} from '@nerima-games/mc-kernel'
import type { ItemType } from '@nerima-games/mc-kernel'

export {
  BREWING_BOTTLE_SLOTS,
  BREWING_FUEL_ITEM,
  BREWING_MAX_FUEL_CHARGES,
  BREWING_TIME_SECS,
  VANILLA_BREWING_RECIPES,
}
export type {
  BrewingBottles,
  BrewingFuelCharges,
  BrewingRecipeTable,
  BrewingState,
  BrewingStateInput,
}
export type VanillaBrewingRecipe = KernelBrewingRecipe
export type StarterBrewingRecipe = Readonly<{
  readonly id: string
  readonly ingredient: ItemType
  readonly input: ItemType
  readonly output: ItemType
}>
export type BrewingRecipeInput = VanillaBrewingRecipe | StarterBrewingRecipe

export const BREWING_FUEL_CHARGES: number = BREWING_MAX_FUEL_CHARGES

export const STARTER_BREWING_RECIPES: ReadonlyArray<StarterBrewingRecipe> = [
  {
    id: 'mc-sim:awkward-potion',
    ingredient: 'nether_wart',
    input: 'water_bottle',
    output: 'awkward_potion',
  },
  {
    id: 'mc-sim:swiftness-potion',
    ingredient: 'sugar',
    input: 'awkward_potion',
    output: 'potion_of_swiftness',
  },
  {
    id: 'mc-sim:poison-potion',
    ingredient: 'spider_eye',
    input: 'awkward_potion',
    output: 'potion_of_poison',
  },
  {
    id: 'mc-sim:regeneration-potion',
    ingredient: 'ghast_tear',
    input: 'awkward_potion',
    output: 'potion_of_regeneration',
  },
]
