import type { ItemType } from '@nerima-games/mc-kernel'

export const BREWING_TIME_SECS = 20
export const BREWING_FUEL_ITEM: ItemType = 'blaze_powder'
export const BREWING_FUEL_CHARGES = 20

export type BrewingRecipe = {
  readonly id: string
  readonly ingredient: ItemType
  readonly input: ItemType
  readonly output: ItemType
}

export const STARTER_BREWING_RECIPES = [
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
] as const
