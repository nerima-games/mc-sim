import type { ItemType } from '@nerima-games/mc-kernel'

import {
  SUPPORTED_VANILLA_ENCHANTMENT_IDS,
  type SupportedVanillaEnchantmentId,
} from './enchantment-data.js'

export const ENCHANTMENT_TABLE_BOOK = 'book' as const
export const ENCHANTMENT_TABLE_MAX_BOOKSHELVES = 15
export const ENCHANTMENT_TABLE_SLOT_COUNT = 3

export type EnchantmentTableItem = ItemType | typeof ENCHANTMENT_TABLE_BOOK

export type EnchantmentTableCost = Readonly<{
  readonly base: number
  readonly perLevelAboveFirst: number
}>

export type VanillaEnchantmentTableRule = Readonly<{
  readonly maxLevel: number
  readonly weight: number
  readonly minCost: EnchantmentTableCost
  readonly maxCost: EnchantmentTableCost
  readonly treasureOnly: boolean
}>

export const VANILLA_ENCHANTMENT_TABLE_RULES: Readonly<
  Record<SupportedVanillaEnchantmentId, VanillaEnchantmentTableRule>
> = {
  aqua_affinity: {
    maxLevel: 1,
    weight: 2,
    minCost: { base: 1, perLevelAboveFirst: 0 },
    maxCost: { base: 41, perLevelAboveFirst: 0 },
    treasureOnly: false,
  },
  bane_of_arthropods: {
    maxLevel: 5,
    weight: 5,
    minCost: { base: 5, perLevelAboveFirst: 8 },
    maxCost: { base: 25, perLevelAboveFirst: 8 },
    treasureOnly: false,
  },
  binding_curse: {
    maxLevel: 1,
    weight: 1,
    minCost: { base: 25, perLevelAboveFirst: 0 },
    maxCost: { base: 50, perLevelAboveFirst: 0 },
    treasureOnly: true,
  },
  blast_protection: {
    maxLevel: 4,
    weight: 2,
    minCost: { base: 5, perLevelAboveFirst: 8 },
    maxCost: { base: 13, perLevelAboveFirst: 8 },
    treasureOnly: false,
  },
  depth_strider: {
    maxLevel: 3,
    weight: 2,
    minCost: { base: 10, perLevelAboveFirst: 10 },
    maxCost: { base: 25, perLevelAboveFirst: 10 },
    treasureOnly: false,
  },
  efficiency: {
    maxLevel: 5,
    weight: 10,
    minCost: { base: 1, perLevelAboveFirst: 10 },
    maxCost: { base: 51, perLevelAboveFirst: 10 },
    treasureOnly: false,
  },
  feather_falling: {
    maxLevel: 4,
    weight: 5,
    minCost: { base: 5, perLevelAboveFirst: 6 },
    maxCost: { base: 11, perLevelAboveFirst: 6 },
    treasureOnly: false,
  },
  fire_aspect: {
    maxLevel: 2,
    weight: 2,
    minCost: { base: 10, perLevelAboveFirst: 20 },
    maxCost: { base: 60, perLevelAboveFirst: 20 },
    treasureOnly: false,
  },
  fire_protection: {
    maxLevel: 4,
    weight: 5,
    minCost: { base: 10, perLevelAboveFirst: 8 },
    maxCost: { base: 18, perLevelAboveFirst: 8 },
    treasureOnly: false,
  },
  flame: {
    maxLevel: 1,
    weight: 2,
    minCost: { base: 20, perLevelAboveFirst: 0 },
    maxCost: { base: 50, perLevelAboveFirst: 0 },
    treasureOnly: false,
  },
  fortune: {
    maxLevel: 3,
    weight: 2,
    minCost: { base: 15, perLevelAboveFirst: 9 },
    maxCost: { base: 65, perLevelAboveFirst: 9 },
    treasureOnly: false,
  },
  frost_walker: {
    maxLevel: 2,
    weight: 2,
    minCost: { base: 10, perLevelAboveFirst: 10 },
    maxCost: { base: 25, perLevelAboveFirst: 10 },
    treasureOnly: true,
  },
  infinity: {
    maxLevel: 1,
    weight: 1,
    minCost: { base: 20, perLevelAboveFirst: 0 },
    maxCost: { base: 50, perLevelAboveFirst: 0 },
    treasureOnly: false,
  },
  knockback: {
    maxLevel: 2,
    weight: 5,
    minCost: { base: 5, perLevelAboveFirst: 20 },
    maxCost: { base: 55, perLevelAboveFirst: 20 },
    treasureOnly: false,
  },
  looting: {
    maxLevel: 3,
    weight: 2,
    minCost: { base: 15, perLevelAboveFirst: 9 },
    maxCost: { base: 65, perLevelAboveFirst: 9 },
    treasureOnly: false,
  },
  luck_of_the_sea: {
    maxLevel: 3,
    weight: 2,
    minCost: { base: 15, perLevelAboveFirst: 9 },
    maxCost: { base: 65, perLevelAboveFirst: 9 },
    treasureOnly: false,
  },
  lure: {
    maxLevel: 3,
    weight: 2,
    minCost: { base: 15, perLevelAboveFirst: 9 },
    maxCost: { base: 65, perLevelAboveFirst: 9 },
    treasureOnly: false,
  },
  mending: {
    maxLevel: 1,
    weight: 2,
    minCost: { base: 25, perLevelAboveFirst: 25 },
    maxCost: { base: 75, perLevelAboveFirst: 25 },
    treasureOnly: true,
  },
  power: {
    maxLevel: 5,
    weight: 10,
    minCost: { base: 1, perLevelAboveFirst: 10 },
    maxCost: { base: 16, perLevelAboveFirst: 10 },
    treasureOnly: false,
  },
  projectile_protection: {
    maxLevel: 4,
    weight: 5,
    minCost: { base: 3, perLevelAboveFirst: 6 },
    maxCost: { base: 9, perLevelAboveFirst: 6 },
    treasureOnly: false,
  },
  protection: {
    maxLevel: 4,
    weight: 10,
    minCost: { base: 1, perLevelAboveFirst: 11 },
    maxCost: { base: 12, perLevelAboveFirst: 11 },
    treasureOnly: false,
  },
  punch: {
    maxLevel: 2,
    weight: 2,
    minCost: { base: 12, perLevelAboveFirst: 20 },
    maxCost: { base: 37, perLevelAboveFirst: 20 },
    treasureOnly: false,
  },
  respiration: {
    maxLevel: 3,
    weight: 2,
    minCost: { base: 10, perLevelAboveFirst: 10 },
    maxCost: { base: 40, perLevelAboveFirst: 10 },
    treasureOnly: false,
  },
  sharpness: {
    maxLevel: 5,
    weight: 10,
    minCost: { base: 1, perLevelAboveFirst: 11 },
    maxCost: { base: 21, perLevelAboveFirst: 11 },
    treasureOnly: false,
  },
  silk_touch: {
    maxLevel: 1,
    weight: 1,
    minCost: { base: 15, perLevelAboveFirst: 0 },
    maxCost: { base: 65, perLevelAboveFirst: 0 },
    treasureOnly: false,
  },
  smite: {
    maxLevel: 5,
    weight: 5,
    minCost: { base: 5, perLevelAboveFirst: 8 },
    maxCost: { base: 25, perLevelAboveFirst: 8 },
    treasureOnly: false,
  },
  soul_speed: {
    maxLevel: 3,
    weight: 1,
    minCost: { base: 10, perLevelAboveFirst: 10 },
    maxCost: { base: 25, perLevelAboveFirst: 10 },
    treasureOnly: true,
  },
  sweeping_edge: {
    maxLevel: 3,
    weight: 2,
    minCost: { base: 5, perLevelAboveFirst: 9 },
    maxCost: { base: 20, perLevelAboveFirst: 9 },
    treasureOnly: false,
  },
  swift_sneak: {
    maxLevel: 3,
    weight: 1,
    minCost: { base: 25, perLevelAboveFirst: 25 },
    maxCost: { base: 75, perLevelAboveFirst: 25 },
    treasureOnly: true,
  },
  thorns: {
    maxLevel: 3,
    weight: 1,
    minCost: { base: 10, perLevelAboveFirst: 20 },
    maxCost: { base: 60, perLevelAboveFirst: 20 },
    treasureOnly: false,
  },
  unbreaking: {
    maxLevel: 3,
    weight: 5,
    minCost: { base: 5, perLevelAboveFirst: 8 },
    maxCost: { base: 55, perLevelAboveFirst: 8 },
    treasureOnly: false,
  },
  vanishing_curse: {
    maxLevel: 1,
    weight: 1,
    minCost: { base: 25, perLevelAboveFirst: 0 },
    maxCost: { base: 50, perLevelAboveFirst: 0 },
    treasureOnly: true,
  },
} as const

export const ENCHANTMENT_TABLE_ITEM_ENCHANTABILITY: Readonly<
  Partial<Record<EnchantmentTableItem, number>>
> = {
  [ENCHANTMENT_TABLE_BOOK]: 1,
  bow: 1,
  diamond_hoe: 10,
  diamond_pickaxe: 10,
  diamond_sword: 10,
  fishing_rod: 1,
  flint_and_steel: 10,
  iron_boots: 9,
  iron_chestplate: 9,
  iron_helmet: 9,
  iron_leggings: 9,
  iron_hoe: 14,
  iron_pickaxe: 14,
  iron_sword: 14,
  shears: 15,
  stone_hoe: 5,
  stone_pickaxe: 5,
  stone_sword: 5,
  wooden_hoe: 15,
  wooden_pickaxe: 15,
  wooden_sword: 15,
}

export type EnchantmentTableRuleId = keyof typeof VANILLA_ENCHANTMENT_TABLE_RULES

export const isEnchantmentTableRuleId = (
  value: unknown,
): value is EnchantmentTableRuleId =>
  typeof value === 'string' &&
  (SUPPORTED_VANILLA_ENCHANTMENT_IDS as readonly string[]).includes(value)

export const enchantmentTableRuleFor = (
  id: EnchantmentTableRuleId,
): VanillaEnchantmentTableRule => VANILLA_ENCHANTMENT_TABLE_RULES[id]

export const itemEnchantabilityOf = (item: EnchantmentTableItem): number =>
  ENCHANTMENT_TABLE_ITEM_ENCHANTABILITY[item] ?? 0
