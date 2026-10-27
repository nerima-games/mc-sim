import { snapshotAnvilState } from './anvil-snapshot-codec.js'
import { finalizeAnvilPlan, initialTransformationOf, mergeEnchantments, nextAnvilRepairCost, repairOf, withRename } from './anvil-transformation.js'
import { compileAnvilRuleSet, validateInputEnchantments } from './anvil-validation.js'
import type { CompiledAnvilRuleSet } from './anvil-validation.js'
import type { AnvilPlan, AnvilRuleInput, AnvilState, CanonicalAnvilState } from './anvil.js'

export { ANVIL_REPAIR_BONUS_RATIO, ANVIL_TOO_EXPENSIVE_LEVEL } from './anvil-constants.js'
export { nextAnvilRepairCost }
export { compileAnvilRuleSet }
export type { AnvilRuleSetCompilation, CompiledAnvilEnchantmentRule, CompiledAnvilRuleSet } from './anvil-validation.js'

const isCompiledAnvilRuleSet = (rules: AnvilRuleInput): rules is CompiledAnvilRuleSet => rules.enchantments instanceof Map

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

  const compiled: ReturnType<typeof compileAnvilRuleSet> = isCompiledAnvilRuleSet(rules)
    ? { ok: true, rules }
    : compileAnvilRuleSet(rules)
  if (!compiled.ok) return compiled
  return planCanonicalAnvil({ ...snapshot.snapshot.state, left }, compiled.rules)
}
