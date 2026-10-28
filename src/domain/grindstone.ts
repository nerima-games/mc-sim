import { Brand, Result } from 'effect'
import {
  EnchantmentLevel,
  enchantmentsComponent,
  maxStackCountOfItem,
  type EnchantmentsComponent,
  type ItemValidationFailure,
} from '@nerima-games/mc-kernel'
import type {
  AnvilEnchantment,
  AnvilEnchantmentId,
  AnvilValidationIssue,
  CanonicalAnvilItemPayload,
} from './anvil.js'
import { AnvilEnchantmentId as createAnvilEnchantmentId } from './anvil.js'
import type { AnvilPrimitiveFailure } from './anvil-primitives.js'
import { canonicalEnchantments } from './anvil-normalization.js'
import {
  GRINDSTONE_CURSE_ENCHANTMENT_IDS,
  GRINDSTONE_DURABILITY_BONUS_PERCENT,
  GRINDSTONE_REPAIR_COST_MAX,
} from './grindstone-data.js'

export {
  GRINDSTONE_CURSE_ENCHANTMENT_IDS,
  GRINDSTONE_DURABILITY_BONUS_PERCENT,
  GRINDSTONE_REPAIR_COST_MAX,
} from './grindstone-data.js'

export type GrindstoneInput = Readonly<{
  readonly payload: CanonicalAnvilItemPayload
  readonly count: number
}>

export type GrindstoneOutput = Readonly<{
  readonly payload: CanonicalAnvilItemPayload
  readonly count: number
  readonly experienceLevels: number
}>

export type GrindstoneFailureReason =
  | 'empty-input'
  | 'invalid-stack'
  | 'invalid-component'
  | 'incompatible-input'
  | 'nothing-to-do'

export type GrindstoneComponentFailure =
  | Brand.BrandError
  | ItemValidationFailure
  | Readonly<{ readonly _tag: 'DuplicateGrindstoneEnchantment'; readonly componentId: string }>
  | AnvilPrimitiveFailure

export type GrindstonePlan =
  | { readonly ok: true; readonly output: GrindstoneOutput }
  | {
      readonly ok: false
      readonly reason: Exclude<GrindstoneFailureReason, 'invalid-component'>
      readonly issues: ReadonlyArray<AnvilValidationIssue>
    }
  | {
      readonly ok: false
      readonly reason: 'invalid-component'
      readonly issues: ReadonlyArray<AnvilValidationIssue>
      readonly componentFailure: GrindstoneComponentFailure
    }

const CURSE_ENCHANTMENT_LOOKUP: ReadonlySet<string> = new Set(GRINDSTONE_CURSE_ENCHANTMENT_IDS)

const isCurseEnchantment = (id: AnvilEnchantmentId): boolean => CURSE_ENCHANTMENT_LOOKUP.has(id)

const issue = (path: string, reason: string): AnvilValidationIssue => ({ path, reason })

const failure = (
  reason: Exclude<GrindstoneFailureReason, 'invalid-component'>,
  path: string,
  message: string,
): GrindstonePlan => ({
  ok: false,
  reason,
  issues: [issue(path, message)],
})

const componentFailure = (
  error: GrindstoneComponentFailure,
  path: string,
  message: string,
): GrindstonePlan => ({
  ok: false,
  reason: 'invalid-component',
  issues: [issue(path, message)],
  componentFailure: error,
})

const success = (output: GrindstoneOutput): GrindstonePlan => ({ ok: true, output })

const componentIdOf = (id: AnvilEnchantmentId): string =>
  id.includes(':') ? id : `minecraft:${id}`

const simIdOf = (id: string): string =>
  id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id

export const enchantmentsComponentOf = (
  enchantments: ReadonlyArray<AnvilEnchantment>,
): Result.Result<EnchantmentsComponent, GrindstoneComponentFailure> => {
  const values: Record<string, number> = {}
  for (const enchantment of enchantments) {
    const componentId = componentIdOf(enchantment.id)
    if (Object.hasOwn(values, componentId)) {
      return Result.fail({ _tag: 'DuplicateGrindstoneEnchantment', componentId })
    }
    const level = EnchantmentLevel.result(enchantment.level)
    if (Result.isFailure(level)) return Result.fail(level.failure)
    values[componentId] = level.success
  }
  return enchantmentsComponent(values)
}

export const anvilEnchantmentsFromComponent = (
  component: Readonly<Record<string, number>>,
): Result.Result<ReadonlyArray<AnvilEnchantment>, GrindstoneComponentFailure> => {
  const validated = enchantmentsComponent(component)
  if (Result.isFailure(validated)) return Result.fail(validated.failure)

  const enchantments: AnvilEnchantment[] = []
  for (const [componentId, level] of Object.entries(validated.success)) {
    const id = createAnvilEnchantmentId(simIdOf(componentId))
    if (Result.isFailure(id)) return Result.fail(id.failure)
    enchantments.push({ id: id.success, level })
  }
  return Result.succeed(canonicalEnchantments(enchantments))
}

export const grindstoneExperienceFor = (nonCurseEnchantmentCount: number): number => {
  const count = Math.max(0, Math.floor(nonCurseEnchantmentCount))
  let cost = 0

  for (let index = 0; index < count && cost < GRINDSTONE_REPAIR_COST_MAX; index += 1) {
    cost = Math.min(cost * 2 + 1, GRINDSTONE_REPAIR_COST_MAX)
  }

  return cost
}

const mergeEnchantments = (
  first: ReadonlyArray<AnvilEnchantment>,
  second: ReadonlyArray<AnvilEnchantment>,
): ReadonlyArray<AnvilEnchantment> => {
  const merged = new Map<AnvilEnchantmentId, AnvilEnchantment>()

  for (const enchantment of canonicalEnchantments(first)) {
    merged.set(enchantment.id, enchantment)
  }

  for (const enchantment of canonicalEnchantments(second)) {
    const existing = merged.get(enchantment.id)
    if (existing !== undefined && isCurseEnchantment(enchantment.id)) continue
    merged.set(enchantment.id, enchantment)
  }

  return canonicalEnchantments([...merged.values()])
}

const stripNonCurses = (
  payload: CanonicalAnvilItemPayload,
  enchantments: ReadonlyArray<AnvilEnchantment>,
): CanonicalAnvilItemPayload => {
  const canonical = canonicalEnchantments(enchantments)
  const curses = canonical.filter(({ id }) => isCurseEnchantment(id))
  const item = payload.item === 'enchanted_book' && curses.length === 0 ? 'book' : payload.item

  return {
    ...payload,
    item,
    enchantments: curses,
    repairCost: grindstoneExperienceFor(canonical.length - curses.length),
  }
}

const sameEnchantments = (
  first: ReadonlyArray<AnvilEnchantment>,
  second: ReadonlyArray<AnvilEnchantment>,
): boolean => {
  const left = canonicalEnchantments(first)
  const right = canonicalEnchantments(second)
  if (left.length !== right.length) return false

  const leftIterator = left.values()
  const rightIterator = right.values()
  while (true) {
    const leftNext = leftIterator.next()
    const rightNext = rightIterator.next()
    if (leftNext.done || rightNext.done) return leftNext.done === rightNext.done
    if (leftNext.value.id !== rightNext.value.id || leftNext.value.level !== rightNext.value.level) return false
  }
}

const sameComponents = (first: CanonicalAnvilItemPayload, second: CanonicalAnvilItemPayload): boolean => {
  if (first.repairCost !== second.repairCost) return false
  if (first.customName !== second.customName) return false
  return sameEnchantments(first.enchantments, second.enchantments)
}

const normalizeInput = (
  input: GrindstoneInput,
): Result.Result<GrindstoneInput, GrindstoneComponentFailure> => {
  const component = enchantmentsComponentOf(input.payload.enchantments)
  if (Result.isFailure(component)) return Result.fail(component.failure)
  const enchantments = anvilEnchantmentsFromComponent(component.success)
  if (Result.isFailure(enchantments)) return Result.fail(enchantments.failure)
  return Result.succeed({
    ...input,
    payload: { ...input.payload, enchantments: enchantments.success },
  })
}

const planSingle = (input: GrindstoneInput): GrindstonePlan => {
  if (input.payload.enchantments.length === 0) {
    return failure('nothing-to-do', '$.input.enchantments', 'must contain at least one enchantment')
  }

  const payload = stripNonCurses(input.payload, input.payload.enchantments)
  return success({ payload, count: 1, experienceLevels: payload.repairCost })
}

const planPair = (left: GrindstoneInput, right: GrindstoneInput): GrindstonePlan => {
  if (left.payload.item !== right.payload.item) {
    return failure('incompatible-input', '$.right.item', 'must match the left item')
  }

  const leftDurability = left.payload.durability
  const rightDurability = right.payload.durability

  if (leftDurability === null && rightDurability === null) {
    if (maxStackCountOfItem(left.payload.item) < 2) {
      return failure('incompatible-input', '$.left.item', 'must be stackable')
    }
    if (!sameComponents(left.payload, right.payload)) {
      return failure('incompatible-input', '$.right.components', 'must match the left components')
    }

    const enchantments = mergeEnchantments(left.payload.enchantments, right.payload.enchantments)
    const payload = stripNonCurses(left.payload, enchantments)
    return success({ payload, count: 2, experienceLevels: payload.repairCost })
  }

  if (leftDurability === null || rightDurability === null) {
    return failure('incompatible-input', '$.durability', 'both inputs must be damageable or neither')
  }

  const maxDamage = Math.max(leftDurability.max, rightDurability.max)
  const combinedDamage =
    leftDurability.max - leftDurability.current +
    (rightDurability.max - rightDurability.current) +
    Math.floor((maxDamage * GRINDSTONE_DURABILITY_BONUS_PERCENT) / 100)
  const durability = {
    max: maxDamage,
    current: Math.max(maxDamage - combinedDamage, 0),
  }
  const enchantments = mergeEnchantments(left.payload.enchantments, right.payload.enchantments)
  const payload = stripNonCurses({ ...left.payload, durability }, enchantments)

  return success({ payload, count: 1, experienceLevels: payload.repairCost })
}

export const planGrindstone = (
  left: GrindstoneInput | null,
  right: GrindstoneInput | null,
): GrindstonePlan => {
  if (left === null) {
    if (right === null) return failure('empty-input', '$.input', 'requires at least one input')
    if (right.count !== 1) return failure('invalid-stack', '$.right.count', 'must contain exactly one item')
    const normalized = normalizeInput(right)
    if (Result.isFailure(normalized)) {
      return componentFailure(
        normalized.failure,
        '$.right.payload.enchantments',
        'could not construct the kernel enchantments component',
      )
    }
    return planSingle(normalized.success)
  }
  if (left.count !== 1) return failure('invalid-stack', '$.left.count', 'must contain exactly one item')
  const normalizedLeft = normalizeInput(left)
  if (Result.isFailure(normalizedLeft)) {
    return componentFailure(
      normalizedLeft.failure,
      '$.left.payload.enchantments',
      'could not construct the kernel enchantments component',
    )
  }
  if (right === null) return planSingle(normalizedLeft.success)
  if (right.count !== 1) return failure('invalid-stack', '$.right.count', 'must contain exactly one item')
  const normalizedRight = normalizeInput(right)
  if (Result.isFailure(normalizedRight)) {
    return componentFailure(
      normalizedRight.failure,
      '$.right.payload.enchantments',
      'could not construct the kernel enchantments component',
    )
  }
  return planPair(normalizedLeft.success, normalizedRight.success)
}
