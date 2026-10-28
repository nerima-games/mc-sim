import {
  SUPPORTED_VANILLA_BOOK_ENCHANTMENT_RULES as kernelBookRules,
  SUPPORTED_VANILLA_ENCHANTMENT_IDS as kernelEnchantmentIds,
  SUPPORTED_VANILLA_ENCHANTMENT_RULES as kernelRules,
  SUPPORTED_VANILLA_ITEM_ENCHANTMENT_RULES as kernelItemRules,
  VANILLA_ENCHANTMENT_COSTS as kernelEnchantmentCosts,
} from '@nerima-games/mc-kernel'
import { anvilEnchantmentIdFromValidated } from './anvil-primitives.js'
import type { AnvilEnchantmentRule } from './anvil.js'

export const SUPPORTED_VANILLA_ENCHANTMENT_IDS: typeof kernelEnchantmentIds = kernelEnchantmentIds

export type SupportedVanillaEnchantmentId = (typeof SUPPORTED_VANILLA_ENCHANTMENT_IDS)[number]

export type VanillaAnvilCost = Readonly<{
  item: number
  book: number
}>

export const VANILLA_ENCHANTMENT_COSTS: Readonly<
  Record<SupportedVanillaEnchantmentId, VanillaAnvilCost>
> = kernelEnchantmentCosts

const localRules = (
  rules: typeof kernelRules,
): ReadonlyArray<AnvilEnchantmentRule> =>
  rules.map(({ id, maxLevel, applicableItems, incompatibleWith, costPerLevel }) => ({
    id: anvilEnchantmentIdFromValidated(id),
    maxLevel: Number(maxLevel),
    applicableItems,
    incompatibleWith: incompatibleWith.map(anvilEnchantmentIdFromValidated),
    costPerLevel: Number(costPerLevel),
  }))

export const SUPPORTED_VANILLA_BOOK_ENCHANTMENT_RULES: ReadonlyArray<AnvilEnchantmentRule> = localRules(kernelBookRules)
export const SUPPORTED_VANILLA_ITEM_ENCHANTMENT_RULES: ReadonlyArray<AnvilEnchantmentRule> = localRules(kernelItemRules)
export const SUPPORTED_VANILLA_ENCHANTMENT_RULES: ReadonlyArray<AnvilEnchantmentRule> = localRules(kernelRules)
