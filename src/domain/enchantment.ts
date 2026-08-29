import {
  AnvilEnchantmentId,
  applyAnvil,
  isAnvilEnchantmentId,
  planAnvil,
  type AnvilApplyResult,
  type AnvilEnchantmentRule,
  type AnvilPlan,
  type AnvilRuleSet,
  type AnvilState,
  type ItemType,
} from '@nerima-games/mc-kernel'
import {
  SUPPORTED_VANILLA_BOOK_ENCHANTMENT_RULES,
  SUPPORTED_VANILLA_ENCHANTMENT_RULES,
  SUPPORTED_VANILLA_ITEM_ENCHANTMENT_RULES,
  type SupportedVanillaEnchantmentId,
} from './enchantment-data'

export const SUPPORTED_VANILLA_BOOK_ANVIL_RULE_SET = {
  enchantments: SUPPORTED_VANILLA_BOOK_ENCHANTMENT_RULES,
} as const satisfies AnvilRuleSet

export const SUPPORTED_VANILLA_ITEM_ANVIL_RULE_SET = {
  enchantments: SUPPORTED_VANILLA_ITEM_ENCHANTMENT_RULES,
} as const satisfies AnvilRuleSet

export const SUPPORTED_VANILLA_ANVIL_RULE_SET = {
  enchantments: SUPPORTED_VANILLA_ENCHANTMENT_RULES,
} as const satisfies AnvilRuleSet

const RULES_BY_ID = new Map(
  SUPPORTED_VANILLA_ENCHANTMENT_RULES.map((rule) => [rule.id, rule]),
)

export const isSupportedVanillaEnchantmentId = (
  value: unknown,
): value is SupportedVanillaEnchantmentId =>
  typeof value === 'string' && isAnvilEnchantmentId(value) && RULES_BY_ID.has(value)

export const enchantmentRuleFor = (value: unknown): AnvilEnchantmentRule | undefined =>
  isSupportedVanillaEnchantmentId(value)
    ? RULES_BY_ID.get(AnvilEnchantmentId(value))
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
