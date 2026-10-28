import { type ItemType } from '@nerima-games/mc-kernel'
import { StackCount } from '@nerima-games/mc-kernel'
import { Brand, Result } from 'effect'
import {
  ANVIL_MAX_CUSTOM_NAME_LENGTH as maxCustomNameLength,
  ANVIL_SNAPSHOT_VERSION as snapshotVersion,
  AnvilMaterialCost as createAnvilMaterialCost,
  AnvilCustomName as createAnvilCustomName,
  AnvilEnchantmentId as createAnvilEnchantmentId,
  isAnvilCustomName as narrowAnvilCustomName,
  isAnvilEnchantmentId as narrowAnvilEnchantmentId,
  type AnvilMaterialCost as AnvilMaterialCostValue,
} from './anvil-primitives.js'
import { planAnvil } from './anvil-planning.js'
import type { CompiledAnvilRuleSet } from './anvil-validation.js'
import {
  AnvilSnapshotString as createAnvilSnapshotString,
  decodeAnvilSnapshot,
  decodeAnvilSnapshotString,
  encodeAnvilSnapshot,
  isAnvilSnapshotString,
  snapshotAnvilState,
} from './anvil-snapshot-codec.js'

export const ANVIL_SNAPSHOT_VERSION: typeof snapshotVersion = snapshotVersion
export const ANVIL_MAX_CUSTOM_NAME_LENGTH: typeof maxCustomNameLength = maxCustomNameLength

export type AnvilEnchantmentId = string & Brand.Brand<'AnvilEnchantmentId'>
export type AnvilCustomName = string & Brand.Brand<'AnvilCustomName'>
export type AnvilMaterialCost = AnvilMaterialCostValue

export type AnvilDurability = {
  readonly current: number
  readonly max: number
}

export type AnvilEnchantment = {
  readonly id: AnvilEnchantmentId
  readonly level: number
}

/** Structurally compatible with mx-gameplay's EnchantedItem wire shape. */
export type AnvilItemPayload = {
  readonly item: ItemType
  readonly durability: AnvilDurability | null
  readonly enchantments: ReadonlyArray<AnvilEnchantment>
  readonly repairCost?: number
  readonly customName?: AnvilCustomName | null
}

export type CanonicalAnvilItemPayload = {
  readonly item: ItemType
  readonly durability: AnvilDurability | null
  readonly enchantments: ReadonlyArray<AnvilEnchantment>
  readonly repairCost: number
  readonly customName: AnvilCustomName | null
}

export type AnvilInputStack = {
  readonly payload: AnvilItemPayload
  readonly count: number
}

export type AnvilState = {
  readonly left: AnvilItemPayload | null
  readonly right: AnvilInputStack | null
  /** Desired output name. Use null to clear an existing custom name. */
  readonly rename: AnvilCustomName | null
  readonly experienceLevels: number
}

export type CanonicalAnvilState = {
  readonly left: CanonicalAnvilItemPayload | null
  readonly right: {
    readonly payload: CanonicalAnvilItemPayload
    readonly count: StackCount
  } | null
  readonly rename: AnvilCustomName | null
  readonly experienceLevels: number
}

export type AnvilEnchantmentRule = {
  readonly id: AnvilEnchantmentId
  readonly maxLevel: number
  readonly applicableItems: ReadonlyArray<ItemType>
  readonly incompatibleWith: ReadonlyArray<AnvilEnchantmentId>
  readonly costPerLevel?: number
}

export type AnvilRepairMaterialRule = {
  readonly target: ItemType
  readonly material: ItemType
  readonly durabilityPerUnit: number
}

export type AnvilRuleSet = {
  readonly enchantments: ReadonlyArray<AnvilEnchantmentRule>
  readonly repairMaterials?: ReadonlyArray<AnvilRepairMaterialRule>
}

export type AnvilRuleInput = AnvilRuleSet | CompiledAnvilRuleSet

export type AnvilValidationIssue = {
  readonly path: string
  readonly reason: string
}

export type AnvilSnapshot = {
  readonly version: typeof ANVIL_SNAPSHOT_VERSION
  readonly state: CanonicalAnvilState
}

export type AnvilSnapshotString = string & Brand.Brand<'AnvilSnapshotString'>

export type AnvilSnapshotResult =
  | { readonly ok: true; readonly snapshot: AnvilSnapshot }
  | { readonly ok: false; readonly issues: ReadonlyArray<AnvilValidationIssue> }

export type AnvilSnapshotEncodingResult =
  | { readonly ok: true; readonly encoded: AnvilSnapshotString; readonly snapshot: AnvilSnapshot }
  | { readonly ok: false; readonly issues: ReadonlyArray<AnvilValidationIssue> }

export type AnvilRejectionReason =
  | 'invalid-input'
  | 'invalid-rules'
  | 'incompatible-input'
  | 'invalid-enchantment'
  | 'enchantment-conflict'
  | 'nothing-to-do'
  | 'too-expensive'
  | 'insufficient-experience'

export type AnvilPlan =
  | {
      readonly ok: true
      readonly output: CanonicalAnvilItemPayload
      readonly levelCost: number
      readonly materialCost: AnvilMaterialCost
    }
  | {
      readonly ok: false
      readonly reason: Exclude<AnvilRejectionReason, 'insufficient-experience'>
      readonly issues: ReadonlyArray<AnvilValidationIssue>
    }

export type AnvilApplyResult =
  | {
      readonly ok: true
      readonly state: CanonicalAnvilState
      readonly output: CanonicalAnvilItemPayload
      readonly levelCost: number
      readonly materialCost: AnvilMaterialCost
    }
  | {
      readonly ok: false
      readonly state: AnvilState
      readonly reason: AnvilRejectionReason
      readonly issues: ReadonlyArray<AnvilValidationIssue>
    }

/** Narrow external text to a canonical enchantment id without throwing. */
export const isAnvilEnchantmentId: typeof narrowAnvilEnchantmentId = narrowAnvilEnchantmentId

/** Narrow external text to a canonical custom name without throwing. */
export const isAnvilCustomName: typeof narrowAnvilCustomName = narrowAnvilCustomName

export const AnvilEnchantmentId: typeof createAnvilEnchantmentId = createAnvilEnchantmentId

export const AnvilCustomName: typeof createAnvilCustomName = createAnvilCustomName

export const AnvilMaterialCost: typeof createAnvilMaterialCost = createAnvilMaterialCost

export const AnvilSnapshotString: typeof createAnvilSnapshotString = createAnvilSnapshotString

export {
  decodeAnvilSnapshot,
  decodeAnvilSnapshotString,
  encodeAnvilSnapshot,
  isAnvilSnapshotString,
  snapshotAnvilState,
}

export {
  ANVIL_REPAIR_BONUS_RATIO,
  ANVIL_TOO_EXPENSIVE_LEVEL,
  compileAnvilRuleSet,
  nextAnvilRepairCost,
} from './anvil-planning.js'

export type { AnvilRepairCostFailure } from './anvil-planning.js'

export type {
  AnvilRuleSetCompilation,
  CompiledAnvilEnchantmentRule,
  CompiledAnvilRuleSet,
} from './anvil-validation.js'

export type { AnvilPrimitiveFailure } from './anvil-primitives.js'

export { planAnvil }

export const applyAnvil = (state: AnvilState, rules: AnvilRuleInput): AnvilApplyResult => {
  const plan = planAnvil(state, rules)
  if (!plan.ok) {
    return { ...plan, state }
  }
  if (state.experienceLevels < plan.levelCost) {
    return {
      ok: false,
      state,
      reason: 'insufficient-experience',
      issues: [{ path: '$.state.experienceLevels', reason: 'is lower than the planned level cost' }],
    }
  }

  const canonical = snapshotAnvilState(state)
  if (!canonical.ok) {
    return { ok: false, state, reason: 'invalid-input', issues: canonical.issues }
  }
  const right = canonical.snapshot.state.right
  let remainingRight: CanonicalAnvilState['right'] = null
  if (right !== null && right.count !== Number(plan.materialCost)) {
    const remainingCount = StackCount.result(right.count - plan.materialCost)
    if (Result.isFailure(remainingCount)) {
      return {
        ok: false,
        state,
        reason: 'invalid-input',
        issues: [{ path: '$.state.right.count', reason: remainingCount.failure.message }],
      }
    }
    remainingRight = { payload: right.payload, count: remainingCount.success }
  }

  return {
    ok: true,
    state: {
      left: null,
      right: remainingRight,
      rename: null,
      experienceLevels: canonical.snapshot.state.experienceLevels - plan.levelCost,
    },
    output: plan.output,
    levelCost: plan.levelCost,
    materialCost: plan.materialCost,
  }
}
