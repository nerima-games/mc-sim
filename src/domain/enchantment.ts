import type { ItemType } from '@nerima-games/mc-kernel'
import {
  SUPPORTED_VANILLA_ANVIL_RULE_SET as kernelAnvilRules,
  SUPPORTED_VANILLA_BOOK_ANVIL_RULE_SET as kernelBookAnvilRules,
  SUPPORTED_VANILLA_ITEM_ANVIL_RULE_SET as kernelItemAnvilRules,
  VANILLA_ENCHANTMENT_COSTS,
} from '@nerima-games/mc-kernel'
import {
  applyAnvil,
  isAnvilEnchantmentId,
  planAnvil,
  type AnvilApplyResult,
  type AnvilEnchantmentRule,
  type AnvilPlan,
  type AnvilRuleSet,
  type AnvilState,
} from './anvil.js'
import type { SupportedVanillaEnchantmentId } from './enchantment-data.js'
import { anvilEnchantmentIdFromValidated } from './anvil-primitives.js'
import { SUPPORTED_VANILLA_ANVIL_REPAIR_MATERIAL_RULES } from './anvil-material-data.js'

type KernelVanillaEnchantmentRule = Readonly<{
  id: SupportedVanillaEnchantmentId
  maxLevel: number
  applicableItems: ReadonlyArray<ItemType>
  incompatibleWith: ReadonlyArray<SupportedVanillaEnchantmentId>
}>

const localRules = (
  rules: ReadonlyArray<KernelVanillaEnchantmentRule>,
  costSource: 'item' | 'book',
): ReadonlyArray<AnvilEnchantmentRule> =>
  rules.map(({ id, maxLevel, applicableItems, incompatibleWith }) => ({
    id: anvilEnchantmentIdFromValidated(id),
    maxLevel: Number(maxLevel),
    applicableItems,
    incompatibleWith: incompatibleWith.map(anvilEnchantmentIdFromValidated),
    costPerLevel: Number(VANILLA_ENCHANTMENT_COSTS[id][costSource]),
  }))

export const SUPPORTED_VANILLA_BOOK_ANVIL_RULE_SET: AnvilRuleSet = {
  enchantments: localRules(kernelBookAnvilRules.enchantments, 'book'),
  repairMaterials: SUPPORTED_VANILLA_ANVIL_REPAIR_MATERIAL_RULES,
} as const

export const SUPPORTED_VANILLA_ITEM_ANVIL_RULE_SET: AnvilRuleSet = {
  enchantments: localRules(kernelItemAnvilRules.enchantments, 'item'),
  repairMaterials: SUPPORTED_VANILLA_ANVIL_REPAIR_MATERIAL_RULES,
} as const

export const SUPPORTED_VANILLA_ANVIL_RULE_SET: AnvilRuleSet = {
  enchantments: localRules(kernelAnvilRules.enchantments, 'book'),
  repairMaterials: SUPPORTED_VANILLA_ANVIL_REPAIR_MATERIAL_RULES,
} as const

const RULES_BY_ID: ReadonlyMap<string, AnvilEnchantmentRule> = new Map(
  SUPPORTED_VANILLA_ANVIL_RULE_SET.enchantments.map(
    (rule): readonly [string, AnvilEnchantmentRule] => [rule.id, rule],
  ),
)

export const isSupportedVanillaEnchantmentId = (
  value: unknown,
): value is SupportedVanillaEnchantmentId =>
  typeof value === 'string' && isAnvilEnchantmentId(value) && RULES_BY_ID.has(value)

export const enchantmentRuleFor = (value: unknown): AnvilEnchantmentRule | undefined =>
  isSupportedVanillaEnchantmentId(value)
    ? RULES_BY_ID.get(value)
    : undefined

export const enchantmentAppliesTo = (enchantment: unknown, item: ItemType): boolean =>
  enchantmentRuleFor(enchantment)?.applicableItems.includes(item) ?? false

export const enchantmentsConflict = (left: unknown, right: unknown): boolean => {
  const leftRule = enchantmentRuleFor(left)
  const rightRule = enchantmentRuleFor(right)
  if (leftRule === undefined || rightRule === undefined) return false
  return leftRule.incompatibleWith.some((id) => id === right) ||
    rightRule.incompatibleWith.some((id) => id === left)
}

const anvilRuleSetFor = (state: AnvilState): AnvilRuleSet =>
  state.right?.payload.item === 'enchanted_book'
    ? SUPPORTED_VANILLA_BOOK_ANVIL_RULE_SET
    : SUPPORTED_VANILLA_ITEM_ANVIL_RULE_SET

export const planVanillaAnvil = (state: AnvilState): AnvilPlan =>
  planAnvil(state, anvilRuleSetFor(state))

export const applyVanillaAnvil = (state: AnvilState): AnvilApplyResult =>
  applyAnvil(state, anvilRuleSetFor(state))
