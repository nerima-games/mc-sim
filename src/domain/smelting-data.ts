import { itemStack } from './inventory.js'
import type { FuelRule, SmeltingRecipe } from './smelting.js'

export const STARTER_SMELTING_RECIPES: ReadonlyArray<SmeltingRecipe> = [
  {
    id: 'mc-sim:iron-ingot',
    input: 'raw_iron',
    output: itemStack('iron_ingot', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:stone',
    input: 'cobblestone',
    output: itemStack('stone', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:glass',
    input: 'sand',
    output: itemStack('glass', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:coal-from-coal-ore',
    input: 'coal_ore',
    output: itemStack('coal', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:coal-from-deepslate-coal-ore',
    input: 'deepslate_coal_ore',
    output: itemStack('coal', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:iron-ingot-from-iron-ore',
    input: 'iron_ore',
    output: itemStack('iron_ingot', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:iron-ingot-from-deepslate-iron-ore',
    input: 'deepslate_iron_ore',
    output: itemStack('iron_ingot', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:diamond-from-diamond-ore',
    input: 'diamond_ore',
    output: itemStack('diamond', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:diamond-from-deepslate-diamond-ore',
    input: 'deepslate_diamond_ore',
    output: itemStack('diamond', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:redstone-dust-from-redstone-ore',
    input: 'redstone_ore',
    output: itemStack('redstone_dust', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:redstone-dust-from-deepslate-redstone-ore',
    input: 'deepslate_redstone_ore',
    output: itemStack('redstone_dust', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:lapis-lazuli-from-lapis-ore',
    input: 'lapis_ore',
    output: itemStack('lapis_lazuli', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:lapis-lazuli-from-deepslate-lapis-ore',
    input: 'deepslate_lapis_ore',
    output: itemStack('lapis_lazuli', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:emerald-from-emerald-ore',
    input: 'emerald_ore',
    output: itemStack('emerald', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:emerald-from-deepslate-emerald-ore',
    input: 'deepslate_emerald_ore',
    output: itemStack('emerald', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:nether-brick',
    input: 'netherrack',
    output: itemStack('nether_brick', 1),
    cookDurationSecs: 10,
  },
]

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
