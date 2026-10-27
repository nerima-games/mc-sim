import { isEnchantmentId, isPositiveSafeInteger } from './anvil-primitives.js'
import type {
  AnvilEnchantmentId,
  AnvilEnchantmentRule,
  AnvilPlan,
  AnvilRejectionReason,
  AnvilRepairMaterialRule,
  AnvilRuleSet,
  CanonicalAnvilItemPayload,
} from './anvil.js'
import type { ItemType } from '@nerima-games/mc-kernel'
import type { StackCount } from '@nerima-games/mc-kernel'

export type AnvilPlanFailure = Extract<AnvilPlan, { readonly ok: false }>

export type CanonicalAnvilStateRight = {
  readonly payload: CanonicalAnvilItemPayload
  readonly count: StackCount
}

export type CompiledAnvilEnchantmentRule = {
  readonly id: AnvilEnchantmentId
  readonly maxLevel: number
  readonly applicableItems: ReadonlySet<ItemType>
  readonly incompatibleWith: ReadonlySet<AnvilEnchantmentId>
  readonly conflictingWith: ReadonlySet<AnvilEnchantmentId>
  readonly costPerLevel: number
}

type MutableCompiledAnvilEnchantmentRule = Omit<CompiledAnvilEnchantmentRule, 'conflictingWith'> & {
  readonly conflictingWith: Set<AnvilEnchantmentId>
}

export type CompiledAnvilRuleSet = {
  readonly enchantments: ReadonlyMap<AnvilEnchantmentId, CompiledAnvilEnchantmentRule>
  readonly repairMaterials: ReadonlyMap<ItemType, ReadonlyMap<ItemType, AnvilRepairMaterialRule>>
}

export type AnvilRuleSetCompilation =
  | { readonly ok: true; readonly rules: CompiledAnvilRuleSet }
  | AnvilPlanFailure

export const rejection = (
  reason: Exclude<AnvilRejectionReason, 'insufficient-experience'>,
  path: string,
  message: string,
): AnvilPlanFailure => ({ ok: false, reason, issues: [{ path, reason: message }] })

export const conflicts = (
  leftId: AnvilEnchantmentId,
  rightId: AnvilEnchantmentId,
  definitions: ReadonlyMap<AnvilEnchantmentId, CompiledAnvilEnchantmentRule>,
): boolean => {
  if (leftId === rightId) return false

  return (
    definitions.get(leftId)?.conflictingWith.has(rightId) === true ||
    definitions.get(rightId)?.conflictingWith.has(leftId) === true
  )
}

const validateEnchantmentSet = (
  payload: CanonicalAnvilItemPayload,
  definitions: ReadonlyMap<AnvilEnchantmentId, CompiledAnvilEnchantmentRule>,
  sourceBook: boolean,
): AnvilPlanFailure | undefined => {
  for (const [index, enchantment] of payload.enchantments.entries()) {
    const definition = definitions.get(enchantment.id)
    if (definition === undefined || enchantment.level > definition.maxLevel) {
      return rejection('invalid-enchantment', `$.enchantments.${String(index)}`, 'is unregistered or exceeds its level cap')
    }
    if (!sourceBook && !definition.applicableItems.has(payload.item)) {
      return rejection('invalid-enchantment', `$.enchantments.${String(index)}`, 'does not apply to this item')
    }
    if (payload.enchantments.some((other) => conflicts(enchantment.id, other.id, definitions))) {
      return rejection('enchantment-conflict', `$.enchantments.${String(index)}`, 'conflicts with another enchantment')
    }
  }

  return undefined
}

export const validateRuleSet = (
  rules: AnvilRuleSet,
): AnvilRuleSetCompilation => {
  const definitions = new Map<AnvilEnchantmentId, AnvilEnchantmentRule>()

  for (const [index, rule] of rules.enchantments.entries()) {
    const invalidIncompatibleWith = rule.incompatibleWith.some((id) => !isEnchantmentId(id))
    if (
      !isEnchantmentId(rule.id) ||
      invalidIncompatibleWith ||
      !isPositiveSafeInteger(rule.maxLevel) ||
      (rule.costPerLevel !== undefined && !isPositiveSafeInteger(rule.costPerLevel)) ||
      definitions.has(rule.id)
    ) {
      return rejection('invalid-rules', `$.rules.enchantments.${String(index)}`, 'contains an invalid or duplicate rule')
    }
    definitions.set(rule.id, rule)
  }

  const repairMaterials = new Map<ItemType, Map<ItemType, AnvilRepairMaterialRule>>()
  for (const [index, rule] of (rules.repairMaterials ?? []).entries()) {
    if (!isPositiveSafeInteger(rule.durabilityPerUnit)) {
      return rejection('invalid-rules', `$.rules.repairMaterials.${String(index)}`, 'durabilityPerUnit must be positive')
    }
    const byMaterial = repairMaterials.get(rule.target) ?? new Map<ItemType, AnvilRepairMaterialRule>()
    if (!byMaterial.has(rule.material)) byMaterial.set(rule.material, rule)
    repairMaterials.set(rule.target, byMaterial)
  }

  const compiledDefinitions = new Map<AnvilEnchantmentId, MutableCompiledAnvilEnchantmentRule>()
  for (const rule of definitions.values()) {
    compiledDefinitions.set(rule.id, {
      id: rule.id,
      maxLevel: rule.maxLevel,
      applicableItems: new Set(rule.applicableItems),
      incompatibleWith: new Set(rule.incompatibleWith),
      conflictingWith: new Set(rule.incompatibleWith),
      costPerLevel: rule.costPerLevel ?? 1,
    })
  }
  for (const rule of definitions.values()) {
    for (const incompatibleId of rule.incompatibleWith) {
      compiledDefinitions.get(incompatibleId)?.conflictingWith.add(rule.id)
    }
  }

  return {
    ok: true,
    rules: {
      enchantments: compiledDefinitions,
      repairMaterials,
    },
  }
}

export const compileAnvilRuleSet = (rules: AnvilRuleSet): AnvilRuleSetCompilation => validateRuleSet(rules)

export const validateInputEnchantments = (
  left: CanonicalAnvilItemPayload,
  right: CanonicalAnvilStateRight | null,
  definitions: ReadonlyMap<AnvilEnchantmentId, CompiledAnvilEnchantmentRule>,
): AnvilPlanFailure | undefined => {
  const leftFailure = validateEnchantmentSet(left, definitions, left.item === 'enchanted_book')
  if (leftFailure !== undefined) return leftFailure
  if (right === null) return undefined
  return validateEnchantmentSet(right.payload, definitions, right.payload.item === 'enchanted_book')
}
