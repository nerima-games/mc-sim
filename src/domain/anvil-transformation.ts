import { canonicalEnchantments } from './anvil-normalization.js'
import { ANVIL_REPAIR_BONUS_RATIO, ANVIL_TOO_EXPENSIVE_LEVEL } from './anvil-constants.js'
import {
  conflicts,
  rejection,
  type AnvilPlanFailure,
  type CanonicalAnvilStateRight,
  type CompiledAnvilEnchantmentRule,
  type CompiledAnvilRuleSet,
} from './anvil-validation.js'
import { AnvilMaterialCost } from './anvil-primitives.js'
import type {
  AnvilDurability,
  AnvilEnchantment,
  AnvilEnchantmentId,
  AnvilPlan,
  CanonicalAnvilItemPayload,
} from './anvil.js'

export type TransformationState = {
  readonly durability: AnvilDurability | null
  readonly enchantments: ReadonlyArray<AnvilEnchantment>
  readonly operationCost: number
  readonly materialCost: AnvilMaterialCost
  readonly rightContributed: boolean
}

export type TransformationResult =
  | { readonly state: TransformationState }
  | { readonly failure: AnvilPlanFailure }

const safeAdd = (left: number, right: number): number =>
  Math.min(Number.MAX_SAFE_INTEGER, left + right)

export const nextAnvilRepairCost = (repairCost: number): number =>
  Math.min(Number.MAX_SAFE_INTEGER, repairCost * 2 + 1)

export const initialTransformationOf = (left: CanonicalAnvilItemPayload): TransformationState => ({
  durability: left.durability === null ? null : { ...left.durability },
  enchantments: [...left.enchantments],
  operationCost: 0,
  materialCost: AnvilMaterialCost(0),
  rightContributed: false,
})

const repairWithSameItem = (
  left: CanonicalAnvilItemPayload,
  right: CanonicalAnvilStateRight,
  transformation: TransformationState,
): TransformationResult | undefined => {
  if (right.payload.item !== left.item || transformation.durability === null) return undefined

  const rightDurability = right.payload.durability
  if (rightDurability === null || rightDurability.max !== transformation.durability.max) {
    return {
      failure: rejection('incompatible-input', '$.state.right.payload.durability', 'must match the left item durability'),
    }
  }

  const repaired = Math.min(
    transformation.durability.max,
    transformation.durability.current + rightDurability.current +
      Math.floor(transformation.durability.max * ANVIL_REPAIR_BONUS_RATIO),
  )
  if (repaired <= transformation.durability.current) return { state: transformation }

  return {
    state: {
      ...transformation,
      durability: { current: repaired, max: transformation.durability.max },
      operationCost: safeAdd(transformation.operationCost, 2),
      materialCost: AnvilMaterialCost(1),
      rightContributed: true,
    },
  }
}

const hasRepairMaterialState = (payload: CanonicalAnvilItemPayload): boolean =>
  payload.durability !== null ||
  payload.enchantments.length > 0 ||
  payload.customName !== null ||
  payload.repairCost !== 0

const repairWithMaterial = (
  left: CanonicalAnvilItemPayload,
  right: CanonicalAnvilStateRight,
  rules: CompiledAnvilRuleSet,
  transformation: TransformationState,
): TransformationResult | undefined => {
  const repairRule = rules.repairMaterials.get(left.item)?.get(right.payload.item)
  if (repairRule === undefined || transformation.durability === null) return undefined
  if (hasRepairMaterialState(right.payload)) {
    return {
      failure: rejection('incompatible-input', '$.state.right.payload', 'repair material must not carry per-item state'),
    }
  }

  const missing = transformation.durability.max - transformation.durability.current
  const units = Math.min(right.count, Math.ceil(missing / repairRule.durabilityPerUnit))
  if (units <= 0) return { state: transformation }

  return {
    state: {
      ...transformation,
      durability: {
        current: Math.min(
          transformation.durability.max,
          transformation.durability.current + units * repairRule.durabilityPerUnit,
        ),
        max: transformation.durability.max,
      },
      operationCost: safeAdd(transformation.operationCost, units),
      materialCost: AnvilMaterialCost(units),
      rightContributed: true,
    },
  }
}

export const repairOf = (
  left: CanonicalAnvilItemPayload,
  right: CanonicalAnvilStateRight,
  rules: CompiledAnvilRuleSet,
  transformation: TransformationState,
): TransformationResult | undefined =>
  repairWithSameItem(left, right, transformation) ?? repairWithMaterial(left, right, rules, transformation)

const mergedLevelOf = (
  existing: AnvilEnchantment | undefined,
  source: AnvilEnchantment,
  maxLevel: number,
): number => {
  if (existing === undefined) return Math.min(maxLevel, source.level)
  if (existing.level === source.level) return Math.min(maxLevel, source.level + 1)
  return Math.min(maxLevel, Math.max(existing.level, source.level))
}

const enchantmentsWith = (
  enchantments: ReadonlyArray<AnvilEnchantment>,
  existing: AnvilEnchantment | undefined,
  source: AnvilEnchantment,
  mergedLevel: number,
): ReadonlyArray<AnvilEnchantment> => {
  if (existing === undefined) return [...enchantments, { id: source.id, level: mergedLevel }]
  return enchantments.map((candidate) => {
    if (candidate.id === source.id) return { id: source.id, level: mergedLevel }
    return candidate
  })
}

const mergeOneEnchantment = (
  left: CanonicalAnvilItemPayload,
  source: AnvilEnchantment,
  definitions: ReadonlyMap<AnvilEnchantmentId, CompiledAnvilEnchantmentRule>,
  transformation: TransformationState,
): TransformationResult => {
  const definition = definitions.get(source.id)
  if (definition === undefined || (left.item !== 'enchanted_book' && !definition.applicableItems.has(left.item))) {
    return {
      failure: rejection('invalid-enchantment', '$.state.right.payload.enchantments', 'does not apply to the output item'),
    }
  }

  const existing = transformation.enchantments.find((candidate) => candidate.id === source.id)
  const mergedLevel = mergedLevelOf(existing, source, definition.maxLevel)
  if (transformation.enchantments.some((candidate) => conflicts(candidate.id, source.id, definitions))) {
    return {
      failure: rejection('enchantment-conflict', '$.state.right.payload.enchantments', 'conflicts with the output item'),
    }
  }
  if (existing !== undefined && existing.level === mergedLevel) return { state: transformation }

  return {
    state: {
      ...transformation,
      enchantments: enchantmentsWith(transformation.enchantments, existing, source, mergedLevel),
      operationCost: safeAdd(
        transformation.operationCost,
        mergedLevel * definition.costPerLevel,
      ),
      materialCost: AnvilMaterialCost(Math.max(transformation.materialCost, 1)),
      rightContributed: true,
    },
  }
}

export const mergeEnchantments = (
  left: CanonicalAnvilItemPayload,
  right: CanonicalAnvilStateRight,
  definitions: ReadonlyMap<AnvilEnchantmentId, CompiledAnvilEnchantmentRule>,
  transformation: TransformationState,
): TransformationResult | undefined => {
  if (right.payload.item !== 'enchanted_book' && right.payload.item !== left.item) return undefined

  let next = transformation
  for (const source of right.payload.enchantments) {
    const result = mergeOneEnchantment(left, source, definitions, next)
    if ('failure' in result) return result
    next = result.state
  }
  return { state: next }
}

export const withRename = (
  left: CanonicalAnvilItemPayload,
  rename: CanonicalAnvilItemPayload['customName'],
  transformation: TransformationState,
): TransformationState => {
  if (rename === left.customName) return transformation
  return { ...transformation, operationCost: safeAdd(transformation.operationCost, 1) }
}

export const finalizeAnvilPlan = (
  left: CanonicalAnvilItemPayload,
  right: CanonicalAnvilStateRight | null,
  rename: CanonicalAnvilItemPayload['customName'],
  transformation: TransformationState,
): AnvilPlan => {
  if (right !== null && !transformation.rightContributed) {
    return rejection('incompatible-input', '$.state.right', 'does not repair or enchant the left input')
  }
  if (transformation.operationCost === 0) {
    return rejection('nothing-to-do', '$.state', 'does not change the output item')
  }

  let levelCost = safeAdd(transformation.operationCost, left.repairCost)
  if (right !== null) levelCost = safeAdd(levelCost, right.payload.repairCost)
  if (levelCost >= ANVIL_TOO_EXPENSIVE_LEVEL) {
    return rejection('too-expensive', '$.state', 'level cost reaches the survival anvil limit')
  }

  const priorRepairCost = Math.max(left.repairCost, right?.payload.repairCost ?? 0)
  return {
    ok: true,
    output: {
      item: left.item,
      durability: transformation.durability,
      enchantments: canonicalEnchantments(transformation.enchantments),
      repairCost: nextAnvilRepairCost(priorRepairCost),
      customName: rename,
    },
    levelCost,
    materialCost: transformation.materialCost,
  }
}
