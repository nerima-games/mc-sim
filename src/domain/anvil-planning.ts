import { snapshotAnvilState } from './anvil-snapshot-codec.js'
import { finalizeAnvilPlan, initialTransformationOf, mergeEnchantments, nextAnvilRepairCost, repairOf, withRename } from './anvil-transformation.js'
import { compileAnvilRuleSet as compileRuleSet, validateInputEnchantments } from './anvil-validation.js'
import type { AnvilRuleSetCompilation, CompiledAnvilRuleSet } from './anvil-validation.js'
import type { AnvilPlan, AnvilRuleInput, AnvilRuleSet, AnvilState, CanonicalAnvilState } from './anvil.js'

export { ANVIL_REPAIR_BONUS_RATIO, ANVIL_TOO_EXPENSIVE_LEVEL } from './anvil-constants.js'
export { nextAnvilRepairCost }
export type { AnvilRepairCostFailure } from './anvil-transformation.js'
export type { AnvilRuleSetCompilation, CompiledAnvilEnchantmentRule, CompiledAnvilRuleSet } from './anvil-validation.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isAnvilRuleSetEnvelope = (value: unknown): value is AnvilRuleSet =>
  isRecord(value) &&
  Array.isArray(value['enchantments']) &&
  (value['repairMaterials'] === undefined || Array.isArray(value['repairMaterials']))

const invalidAnvilRuleSet = (): AnvilRuleSetCompilation => ({
  ok: false,
  reason: 'invalid-rules',
  issues: [{ path: '$.rules', reason: 'must be a valid anvil rule set' }],
})

const compileRuleSetInput = (value: unknown): AnvilRuleSetCompilation => {
  try {
    if (!isAnvilRuleSetEnvelope(value)) return invalidAnvilRuleSet()
    return compileRuleSet(value)
  } catch {
    return invalidAnvilRuleSet()
  }
}

export const compileAnvilRuleSet = (rules: AnvilRuleSet): AnvilRuleSetCompilation =>
  compileRuleSetInput(rules)
const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

const isStringSet = (value: unknown): boolean => {
  if (!(value instanceof Set)) return false
  for (const member of value) {
    if (typeof member !== 'string') return false
  }
  return true
}

const isCompiledEnchantmentEntry = (id: unknown, candidate: unknown): boolean =>
  typeof id === 'string' &&
  isRecord(candidate) &&
  candidate['id'] === id &&
  isPositiveSafeInteger(candidate['maxLevel']) &&
  isStringSet(candidate['applicableItems']) &&
  isStringSet(candidate['incompatibleWith']) &&
  isStringSet(candidate['conflictingWith']) &&
  isPositiveSafeInteger(candidate['costPerLevel'])

const isCompiledEnchantmentMap = (value: unknown): boolean => {
  if (!(value instanceof Map)) return false
  for (const [id, candidate] of value) {
    if (!isCompiledEnchantmentEntry(id, candidate)) return false
  }
  return true
}

const isCompiledRepairMaterialEntry = (
  target: unknown,
  material: unknown,
  candidate: unknown,
): boolean =>
  typeof target === 'string' &&
  typeof material === 'string' &&
  isRecord(candidate) &&
  candidate['target'] === target &&
  candidate['material'] === material &&
  isPositiveSafeInteger(candidate['durabilityPerUnit'])

const isCompiledRepairMaterialMap = (value: unknown): boolean => {
  if (!(value instanceof Map)) return false
  for (const [target, byMaterial] of value) {
    if (typeof target !== 'string' || !(byMaterial instanceof Map)) return false
    for (const [material, candidate] of byMaterial) {
      if (!isCompiledRepairMaterialEntry(target, material, candidate)) return false
    }
  }
  return true
}

const isCompiledAnvilRuleSet = (rules: AnvilRuleInput): rules is CompiledAnvilRuleSet => {
  try {
    return isRecord(rules) &&
      isCompiledEnchantmentMap(rules['enchantments']) &&
      isCompiledRepairMaterialMap(rules['repairMaterials'])
  } catch {
    return false
  }
}

type CanonicalAnvilStateWithLeft = Omit<CanonicalAnvilState, 'left'> & {
  readonly left: NonNullable<CanonicalAnvilState['left']>
}

const planCanonicalAnvil = (state: CanonicalAnvilStateWithLeft, rules: CompiledAnvilRuleSet): AnvilPlan => {
  const { left, right, rename } = state

  const inputFailure = validateInputEnchantments(left, right, rules.enchantments)
  if (inputFailure !== undefined) return inputFailure

  let transformation = initialTransformationOf(left)
  if (right !== null) {
    const repairResult = repairOf(left, right, rules, transformation)
    if (repairResult !== undefined) {
      if ('failure' in repairResult) return repairResult.failure
      transformation = repairResult.state
    }

    const enchantmentResult = mergeEnchantments(left, right, rules.enchantments, transformation)
    if (enchantmentResult !== undefined) {
      if ('failure' in enchantmentResult) return enchantmentResult.failure
      transformation = enchantmentResult.state
    }
  }

  return finalizeAnvilPlan(left, right, rename, withRename(left, rename, transformation))
}

export function planAnvil(state: AnvilState, rules: AnvilRuleInput): AnvilPlan
export function planAnvil(state: AnvilState, rules: AnvilRuleInput): AnvilPlan {
  const snapshot = snapshotAnvilState(state)
  if (!snapshot.ok) return { ok: false, reason: 'invalid-input', issues: snapshot.issues }

  const { left } = snapshot.snapshot.state
  if (left === null) {
    return {
      ok: false,
      reason: 'invalid-input',
      issues: [{ path: '$.state.left', reason: 'an anvil requires a left input' }],
    }
  }

  const compiled: AnvilRuleSetCompilation = isCompiledAnvilRuleSet(rules)
    ? { ok: true, rules }
    : compileRuleSetInput(rules)
  if (!compiled.ok) return compiled
  return planCanonicalAnvil({ ...snapshot.snapshot.state, left }, compiled.rules)
}
