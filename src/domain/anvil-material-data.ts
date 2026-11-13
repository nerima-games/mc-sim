import { ITEM_DURABILITY_CATALOG } from '@nerima-games/mc-kernel'
import type { DamageableItemType, ItemType } from '@nerima-games/mc-kernel'
import type { AnvilRepairMaterialRule } from './anvil.js'

const VANILLA_REPAIR_MATERIALS: ReadonlyArray<readonly [DamageableItemType, ItemType]> = [
  ['leather_helmet', 'leather'],
  ['leather_chestplate', 'leather'],
  ['leather_leggings', 'leather'],
  ['leather_boots', 'leather'],
  ['iron_helmet', 'iron_ingot'],
  ['iron_chestplate', 'iron_ingot'],
  ['iron_leggings', 'iron_ingot'],
  ['iron_boots', 'iron_ingot'],
  ['gold_helmet', 'gold_ingot'],
  ['gold_chestplate', 'gold_ingot'],
  ['gold_leggings', 'gold_ingot'],
  ['gold_boots', 'gold_ingot'],
  ['diamond_helmet', 'diamond'],
  ['diamond_chestplate', 'diamond'],
  ['diamond_leggings', 'diamond'],
  ['diamond_boots', 'diamond'],
  ['netherite_helmet', 'netherite_ingot'],
  ['netherite_chestplate', 'netherite_ingot'],
  ['netherite_leggings', 'netherite_ingot'],
  ['netherite_boots', 'netherite_ingot'],
  ['wooden_pickaxe', 'oak_planks'],
  ['wooden_shovel', 'oak_planks'],
  ['wooden_axe', 'oak_planks'],
  ['wooden_hoe', 'oak_planks'],
  ['wooden_sword', 'oak_planks'],
  ['gold_pickaxe', 'gold_ingot'],
  ['gold_shovel', 'gold_ingot'],
  ['gold_axe', 'gold_ingot'],
  ['gold_hoe', 'gold_ingot'],
  ['gold_sword', 'gold_ingot'],
  ['stone_pickaxe', 'cobblestone'],
  ['stone_shovel', 'cobblestone'],
  ['stone_axe', 'cobblestone'],
  ['stone_hoe', 'cobblestone'],
  ['stone_sword', 'cobblestone'],
  ['iron_pickaxe', 'iron_ingot'],
  ['iron_shovel', 'iron_ingot'],
  ['iron_axe', 'iron_ingot'],
  ['iron_hoe', 'iron_ingot'],
  ['iron_sword', 'iron_ingot'],
  ['diamond_pickaxe', 'diamond'],
  ['diamond_shovel', 'diamond'],
  ['diamond_axe', 'diamond'],
  ['diamond_hoe', 'diamond'],
  ['diamond_sword', 'diamond'],
  ['netherite_pickaxe', 'netherite_ingot'],
  ['netherite_shovel', 'netherite_ingot'],
  ['netherite_axe', 'netherite_ingot'],
  ['netherite_hoe', 'netherite_ingot'],
  ['netherite_sword', 'netherite_ingot'],
  ['bow', 'string'],
  ['fishing_rod', 'string'],
  ['flint_and_steel', 'iron_ingot'],
  ['shears', 'iron_ingot'],
]

const ANVIL_MATERIAL_REPAIR_RATIO = 0.25

export const SUPPORTED_VANILLA_ANVIL_REPAIR_MATERIAL_RULES: ReadonlyArray<AnvilRepairMaterialRule> =
  VANILLA_REPAIR_MATERIALS.map(([target, material]) => {
    const durability = ITEM_DURABILITY_CATALOG[target]
    const durabilityPerUnit = Math.floor(Number(durability.maxDurability) * ANVIL_MATERIAL_REPAIR_RATIO)
    return {
      target,
      material,
      durabilityPerUnit,
    }
  })
