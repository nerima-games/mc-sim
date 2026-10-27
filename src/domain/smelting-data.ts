import { Result } from 'effect'
import { itemStack } from './inventory.js'
import type { ItemStackFailure } from './inventory.js'
import type { FuelRule, SmeltingRecipe } from './smelting.js'

const starterRecipe = (
  id: string,
  input: SmeltingRecipe['input'],
  output: ReturnType<typeof itemStack>,
): Result.Result<SmeltingRecipe, ItemStackFailure> =>
  Result.map(output, (stack) => ({ id, input, output: stack, cookDurationSecs: 10 }))

export const STARTER_SMELTING_RECIPES: Result.Result<ReadonlyArray<SmeltingRecipe>, ItemStackFailure> = Result.all([
  starterRecipe('mc-sim:iron-ingot', 'raw_iron', itemStack('iron_ingot', 1)),
  starterRecipe('mc-sim:stone', 'cobblestone', itemStack('stone', 1)),
  starterRecipe('mc-sim:glass', 'sand', itemStack('glass', 1)),
  starterRecipe('mc-sim:coal-from-coal-ore', 'coal_ore', itemStack('coal', 1)),
  starterRecipe('mc-sim:coal-from-deepslate-coal-ore', 'deepslate_coal_ore', itemStack('coal', 1)),
  starterRecipe('mc-sim:iron-ingot-from-iron-ore', 'iron_ore', itemStack('iron_ingot', 1)),
  starterRecipe('mc-sim:iron-ingot-from-deepslate-iron-ore', 'deepslate_iron_ore', itemStack('iron_ingot', 1)),
  starterRecipe('mc-sim:diamond-from-diamond-ore', 'diamond_ore', itemStack('diamond', 1)),
  starterRecipe('mc-sim:diamond-from-deepslate-diamond-ore', 'deepslate_diamond_ore', itemStack('diamond', 1)),
  starterRecipe('mc-sim:redstone-dust-from-redstone-ore', 'redstone_ore', itemStack('redstone_dust', 1)),
  starterRecipe('mc-sim:redstone-dust-from-deepslate-redstone-ore', 'deepslate_redstone_ore', itemStack('redstone_dust', 1)),
  starterRecipe('mc-sim:lapis-lazuli-from-lapis-ore', 'lapis_ore', itemStack('lapis_lazuli', 1)),
  starterRecipe('mc-sim:lapis-lazuli-from-deepslate-lapis-ore', 'deepslate_lapis_ore', itemStack('lapis_lazuli', 1)),
  starterRecipe('mc-sim:emerald-from-emerald-ore', 'emerald_ore', itemStack('emerald', 1)),
  starterRecipe('mc-sim:emerald-from-deepslate-emerald-ore', 'deepslate_emerald_ore', itemStack('emerald', 1)),
  starterRecipe('mc-sim:nether-brick', 'netherrack', itemStack('nether_brick', 1)),
])

export const STARTER_FUEL_RULES: ReadonlyArray<FuelRule> = [
  { item: 'coal', burnDurationSecs: 80 },
  { item: 'coal_block', burnDurationSecs: 800 },
  { item: 'oak_log', burnDurationSecs: 15 },
  { item: 'oak_planks', burnDurationSecs: 15 },
  { item: 'stick', burnDurationSecs: 5 },
  { item: 'oak_stairs', burnDurationSecs: 15 },
  { item: 'crafting_table', burnDurationSecs: 15 },
  { item: 'chest', burnDurationSecs: 15 },
  { item: 'bow', burnDurationSecs: 15 },
  { item: 'fishing_rod', burnDurationSecs: 15 },
  { item: 'oak_boat', burnDurationSecs: 60 },
  { item: 'ladder', burnDurationSecs: 15 },
  { item: 'sapling', burnDurationSecs: 5 },
  { item: 'wooden_pickaxe', burnDurationSecs: 10 },
  { item: 'wooden_hoe', burnDurationSecs: 10 },
  { item: 'wooden_sword', burnDurationSecs: 10 },
  { item: 'bowl', burnDurationSecs: 5 },
  { item: 'wool', burnDurationSecs: 5 },
  { item: 'door', burnDurationSecs: 10 },
]
