import { describe, expect, it } from '@effect/vitest'
import { StackCount, type ItemType } from '@nerima-games/mc-kernel'
import {
  ANVIL_MAX_CUSTOM_NAME_LENGTH,
  ANVIL_SNAPSHOT_VERSION,
  AnvilCustomName,
  AnvilEnchantmentId,
  AnvilMaterialCost,
  AnvilSnapshotString,
  applyAnvil,
  compileAnvilRuleSet,
  decodeAnvilSnapshot,
  decodeAnvilSnapshotString,
  encodeAnvilSnapshot,
  isAnvilCustomName,
  isAnvilEnchantmentId,
  isAnvilSnapshotString,
  planAnvil,
  snapshotAnvilState,
  type AnvilCustomName as AnvilCustomNameValue,
  type AnvilDurability,
  type AnvilEnchantment,
  type AnvilEnchantmentId as AnvilEnchantmentIdValue,
  type AnvilEnchantmentRule,
  type AnvilInputStack,
  type AnvilItemPayload,
  type AnvilRepairMaterialRule,
  type AnvilRuleSet,
  type AnvilState,
  type CanonicalAnvilItemPayload,
} from '../src/domain/anvil'
import { canonicalEnchantments } from '../src/domain/anvil-normalization'
import {
  isCustomName,
  isEnchantmentId,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from '../src/domain/anvil-primitives'
import {
  conflicts,
  validateInputEnchantments,
  type CanonicalAnvilStateRight,
  type CompiledAnvilEnchantmentRule,
  type CompiledAnvilRuleSet,
} from '../src/domain/anvil-validation'
import {
  finalizeAnvilPlan,
  initialTransformationOf,
  mergeEnchantments,
  nextAnvilRepairCost,
  repairOf,
  withRename,
  type TransformationState,
} from '../src/domain/anvil-transformation'

type PayloadOverrides = {
  readonly durability?: AnvilDurability | null
  readonly enchantments?: ReadonlyArray<AnvilEnchantment>
  readonly repairCost?: number
  readonly customName?: AnvilCustomNameValue | null
}

const enchantment = (id: string, level = 1): AnvilEnchantment => ({
  id: AnvilEnchantmentId(id),
  level,
})

const payload = (item: ItemType, overrides: PayloadOverrides = {}): AnvilItemPayload => ({
  item,
  durability: overrides.durability ?? null,
  enchantments: overrides.enchantments ?? [],
  repairCost: overrides.repairCost ?? 0,
  customName: overrides.customName ?? null,
})

const canonicalPayload = (
  item: ItemType,
  overrides: PayloadOverrides = {},
): CanonicalAnvilItemPayload => ({
  item,
  durability: overrides.durability ?? null,
  enchantments: overrides.enchantments ?? [],
  repairCost: overrides.repairCost ?? 0,
  customName: overrides.customName ?? null,
})

const inputStack = (itemPayload: AnvilItemPayload, count = 1): AnvilInputStack => ({
  payload: itemPayload,
  count,
})

const canonicalRight = (
  itemPayload: CanonicalAnvilItemPayload,
  count = 1,
): CanonicalAnvilStateRight => ({
  payload: itemPayload,
  count: StackCount(count),
})

const state = (
  left: AnvilItemPayload | null,
  right: AnvilInputStack | null = null,
  rename: AnvilCustomNameValue | null = null,
  experienceLevels = 50,
): AnvilState => ({ left, right, rename, experienceLevels })

type EnchantmentRuleOptions = {
  readonly maxLevel?: number
  readonly applicableItems?: ReadonlyArray<ItemType>
  readonly incompatibleWith?: ReadonlyArray<AnvilEnchantmentIdValue>
  readonly costPerLevel?: number
}

const enchantmentRule = (
  id: AnvilEnchantmentIdValue,
  options: EnchantmentRuleOptions = {},
): AnvilEnchantmentRule => ({
  id,
  maxLevel: options.maxLevel ?? 5,
  applicableItems: options.applicableItems ?? ['iron_sword'],
  incompatibleWith: options.incompatibleWith ?? [],
  ...(options.costPerLevel === undefined ? {} : { costPerLevel: options.costPerLevel }),
})

const ruleSet = (
  enchantments: ReadonlyArray<AnvilEnchantmentRule> = [],
  repairMaterials: ReadonlyArray<AnvilRepairMaterialRule> = [],
): AnvilRuleSet => ({ enchantments, repairMaterials })

const compile = (rules: AnvilRuleSet): CompiledAnvilRuleSet => {
  const result = compileAnvilRuleSet(rules)
  if (!result.ok) throw new Error('The test rule set must compile')
  return result.rules
}

type CompiledRuleOptions = {
  readonly maxLevel?: number
  readonly applicableItems?: ReadonlySet<ItemType>
  readonly incompatibleWith?: ReadonlySet<AnvilEnchantmentIdValue>
  readonly conflictingWith?: ReadonlySet<AnvilEnchantmentIdValue>
  readonly costPerLevel?: number
}

const compiledRule = (
  id: AnvilEnchantmentIdValue,
  options: CompiledRuleOptions = {},
): CompiledAnvilEnchantmentRule => ({
  id,
  maxLevel: options.maxLevel ?? 5,
  applicableItems: options.applicableItems ?? new Set<ItemType>(['iron_sword']),
  incompatibleWith: options.incompatibleWith ?? new Set<AnvilEnchantmentIdValue>(),
  conflictingWith: options.conflictingWith ?? new Set<AnvilEnchantmentIdValue>(),
  costPerLevel: options.costPerLevel ?? 1,
})

const transformation = (patch: Partial<TransformationState> = {}): TransformationState => ({
  durability: null,
  enchantments: [],
  operationCost: 0,
  materialCost: AnvilMaterialCost(0),
  rightContributed: false,
  ...patch,
})

describe('anvil primitives and canonicalization', () => {
  it('validates bounded costs, safe integers, canonical ids, and custom names', () => {
    expect(AnvilMaterialCost(0)).toBe(0)
    expect(AnvilMaterialCost(99)).toBe(99)
    expect(() => AnvilMaterialCost(-1)).toThrow()
    expect(() => AnvilMaterialCost(100)).toThrow()
    expect(() => AnvilMaterialCost(1.5)).toThrow()

    expect(isNonNegativeSafeInteger(0)).toBe(true)
    expect(isNonNegativeSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(isNonNegativeSafeInteger(-1)).toBe(false)
    expect(isNonNegativeSafeInteger(1.5)).toBe(false)
    expect(isNonNegativeSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false)
    expect(isNonNegativeSafeInteger('1')).toBe(false)
    expect(isPositiveSafeInteger(1)).toBe(true)
    expect(isPositiveSafeInteger(0)).toBe(false)
    expect(isPositiveSafeInteger(-1)).toBe(false)
    expect(isPositiveSafeInteger(Number.POSITIVE_INFINITY)).toBe(false)

    const longestId = `a${'b'.repeat(127)}`
    expect(isEnchantmentId('minecraft:sharpness')).toBe(true)
    expect(isEnchantmentId(longestId)).toBe(true)
    expect(isEnchantmentId('')).toBe(false)
    expect(isEnchantmentId('Uppercase')).toBe(false)
    expect(isEnchantmentId('_leading')).toBe(false)
    expect(isEnchantmentId(`${longestId}b`)).toBe(false)
    expect(isAnvilEnchantmentId('minecraft:sharpness')).toBe(true)
    expect(isAnvilEnchantmentId('bad id')).toBe(false)
    expect(AnvilEnchantmentId('minecraft:sharpness')).toBe('minecraft:sharpness')
    expect(() => AnvilEnchantmentId('bad id')).toThrow(TypeError)

    const longestName = 'x'.repeat(ANVIL_MAX_CUSTOM_NAME_LENGTH)
    expect(isCustomName('Named blade')).toBe(true)
    expect(isCustomName(longestName)).toBe(true)
    expect(isCustomName('')).toBe(false)
    expect(isCustomName('x'.repeat(ANVIL_MAX_CUSTOM_NAME_LENGTH + 1))).toBe(false)
    expect(isCustomName('\u0000')).toBe(false)
    expect(isCustomName('\u001f')).toBe(false)
    expect(isCustomName('\u007f')).toBe(false)
    expect(isAnvilCustomName('Named blade')).toBe(true)
    expect(isAnvilCustomName('')).toBe(false)
    expect(AnvilCustomName('Named blade')).toBe('Named blade')
    expect(() => AnvilCustomName('')).toThrow(TypeError)
  })

  it('sorts enchantments canonically without changing the input array', () => {
    const values = [
      enchantment('minecraft:smite', 2),
      enchantment('minecraft:sharpness', 3),
      enchantment('minecraft:sharpness', 1),
    ]

    expect(canonicalEnchantments(values)).toStrictEqual([
      enchantment('minecraft:sharpness', 3),
      enchantment('minecraft:sharpness', 1),
      enchantment('minecraft:smite', 2),
    ])
    expect(values).toStrictEqual([
      enchantment('minecraft:smite', 2),
      enchantment('minecraft:sharpness', 3),
      enchantment('minecraft:sharpness', 1),
    ])
  })
})

describe('anvil rule compilation and input validation', () => {
  it('compiles defaults, reverse conflicts, and the first duplicate repair-material rule', () => {
    const sharpness = AnvilEnchantmentId('minecraft:sharpness')
    const smite = AnvilEnchantmentId('minecraft:smite')
    const compiled = compile(ruleSet(
      [
        enchantmentRule(sharpness, { incompatibleWith: [smite] }),
        enchantmentRule(smite, { costPerLevel: 2 }),
      ],
      [
        { target: 'iron_sword', material: 'iron_ingot', durabilityPerUnit: 20 },
        { target: 'iron_sword', material: 'iron_ingot', durabilityPerUnit: 5 },
      ],
    ))

    expect(compiled.enchantments.get(sharpness)).toMatchObject({ costPerLevel: 1 })
    expect(compiled.enchantments.get(sharpness)?.conflictingWith.has(smite)).toBe(true)
    expect(compiled.enchantments.get(smite)?.conflictingWith.has(sharpness)).toBe(true)
    expect(compiled.enchantments.get(smite)?.costPerLevel).toBe(2)
    expect(compiled.repairMaterials.get('iron_sword')?.get('iron_ingot')).toStrictEqual({
      target: 'iron_sword',
      material: 'iron_ingot',
      durabilityPerUnit: 20,
    })
    expect(compile(ruleSet()).enchantments.size).toBe(0)
    expect(compileAnvilRuleSet({ enchantments: [] })).toMatchObject({ ok: true })
  })

  it('rejects malformed enchantment and repair-material rules at their input paths', () => {
    const malformedRuleSets = [
      '{"enchantments":[{"id":"bad id","maxLevel":1,"applicableItems":["iron_sword"],"incompatibleWith":[]}]}',
      '{"enchantments":[{"id":"minecraft:sharpness","maxLevel":1,"applicableItems":["iron_sword"],"incompatibleWith":["bad id"]}]}',
      '{"enchantments":[{"id":"minecraft:sharpness","maxLevel":0,"applicableItems":["iron_sword"],"incompatibleWith":[]}]}',
      '{"enchantments":[{"id":"minecraft:sharpness","maxLevel":1,"applicableItems":["iron_sword"],"incompatibleWith":[],"costPerLevel":0}]}',
      '{"enchantments":[{"id":"minecraft:sharpness","maxLevel":1,"applicableItems":["iron_sword"],"incompatibleWith":[]},{"id":"minecraft:sharpness","maxLevel":2,"applicableItems":["iron_sword"],"incompatibleWith":[]}]}',
      '{"enchantments":[],"repairMaterials":[{"target":"iron_sword","material":"iron_ingot","durabilityPerUnit":0}]}',
    ]

    for (const encoded of malformedRuleSets) {
      expect(compileAnvilRuleSet(JSON.parse(encoded))).toMatchObject({
        ok: false,
        reason: 'invalid-rules',
      })
    }
  })

  it('checks conflict direction and validates each input enchantment set', () => {
    const sharpness = AnvilEnchantmentId('minecraft:sharpness')
    const smite = AnvilEnchantmentId('minecraft:smite')
    const sharpRule = compiledRule(sharpness, {
      conflictingWith: new Set([smite]),
    })
    const smiteRule = compiledRule(smite)
    const noRules = new Map<AnvilEnchantmentIdValue, CompiledAnvilEnchantmentRule>()

    expect(conflicts(sharpness, sharpness, noRules)).toBe(false)
    expect(conflicts(sharpness, smite, new Map([[sharpness, sharpRule]]))).toBe(true)
    expect(conflicts(sharpness, smite, new Map([[smite, compiledRule(smite, {
      conflictingWith: new Set([sharpness]),
    })]]))).toBe(true)
    expect(conflicts(sharpness, smite, noRules)).toBe(false)

    const definitions = compile(ruleSet([
      enchantmentRule(sharpness, { incompatibleWith: [smite] }),
      enchantmentRule(smite),
    ])).enchantments
    const validLeft = canonicalPayload('iron_sword', { enchantments: [enchantment('minecraft:sharpness')] })
    const unknownLeft = canonicalPayload('iron_sword', { enchantments: [enchantment('minecraft:unregistered')] })
    const wrongItemLeft = canonicalPayload('bow', { enchantments: [enchantment('minecraft:sharpness')] })
    const conflictingLeft = canonicalPayload('iron_sword', {
      enchantments: [enchantment('minecraft:sharpness'), enchantment('minecraft:smite')],
    })

    expect(validateInputEnchantments(validLeft, null, definitions)).toBeUndefined()
    expect(validateInputEnchantments(unknownLeft, null, definitions)).toMatchObject({
      reason: 'invalid-enchantment',
    })
    expect(validateInputEnchantments(wrongItemLeft, null, definitions)).toMatchObject({
      reason: 'invalid-enchantment',
    })
    expect(validateInputEnchantments(conflictingLeft, null, definitions)).toMatchObject({
      reason: 'enchantment-conflict',
    })
    expect(validateInputEnchantments(
      canonicalPayload('iron_sword'),
      canonicalRight(canonicalPayload('enchanted_book', { enchantments: [enchantment('minecraft:sharpness')] })),
      definitions,
    )).toBeUndefined()
    expect(validateInputEnchantments(
      canonicalPayload('iron_sword'),
      canonicalRight(unknownLeft),
      definitions,
    )).toMatchObject({ reason: 'invalid-enchantment' })
    expect(validateInputEnchantments(
      canonicalPayload('iron_sword'),
      canonicalRight(canonicalPayload('bow', { enchantments: [enchantment('minecraft:sharpness')] })),
      definitions,
    )).toMatchObject({ reason: 'invalid-enchantment' })
    expect(smiteRule.applicableItems.has('iron_sword')).toBe(true)
  })
})

describe('anvil transformations', () => {
  it('starts from the left input and saturates repair-cost growth', () => {
    const empty = initialTransformationOf(canonicalPayload('iron_sword'))
    const damaged = initialTransformationOf(canonicalPayload('iron_sword', {
      durability: { current: 25, max: 100 },
      enchantments: [enchantment('minecraft:sharpness')],
    }))

    expect(empty).toStrictEqual({
      durability: null,
      enchantments: [],
      operationCost: 0,
      materialCost: AnvilMaterialCost(0),
      rightContributed: false,
    })
    expect(damaged.durability).toStrictEqual({ current: 25, max: 100 })
    expect(damaged.enchantments).toStrictEqual([enchantment('minecraft:sharpness')])
    expect(nextAnvilRepairCost(4)).toBe(9)
    expect(nextAnvilRepairCost(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('repairs matching items, rejects incompatible durability, and leaves full items unchanged', () => {
    const rules = compile(ruleSet())
    const left = canonicalPayload('iron_sword', { durability: { current: 60, max: 100 } })
    const repaired = repairOf(
      left,
      canonicalRight(canonicalPayload('iron_sword', { durability: { current: 40, max: 100 } })),
      rules,
      initialTransformationOf(left),
    )

    expect(repaired).toMatchObject({
      state: {
        durability: { current: 100, max: 100 },
        operationCost: 2,
        materialCost: 1,
        rightContributed: true,
      },
    })
    expect(repairOf(
      left,
      canonicalRight(canonicalPayload('iron_sword', { durability: { current: 20, max: 80 } })),
      rules,
      initialTransformationOf(left),
    )).toMatchObject({ failure: { reason: 'incompatible-input' } })
    expect(repairOf(
      left,
      canonicalRight(canonicalPayload('iron_sword')),
      rules,
      initialTransformationOf(left),
    )).toMatchObject({ failure: { reason: 'incompatible-input' } })

    const fullLeft = canonicalPayload('iron_sword', { durability: { current: 100, max: 100 } })
    expect(repairOf(
      fullLeft,
      canonicalRight(canonicalPayload('iron_sword', { durability: { current: 20, max: 100 } })),
      rules,
      initialTransformationOf(fullLeft),
    )).toStrictEqual({ state: initialTransformationOf(fullLeft) })
    expect(repairOf(
      canonicalPayload('stone'),
      canonicalRight(canonicalPayload('stone')),
      rules,
      initialTransformationOf(canonicalPayload('stone')),
    )).toBeUndefined()
  })

  it('uses clean repair materials, caps the units, and refuses stateful materials', () => {
    const rules = compile(ruleSet([], [
      { target: 'iron_sword', material: 'iron_ingot', durabilityPerUnit: 20 },
    ]))
    const left = canonicalPayload('iron_sword', { durability: { current: 30, max: 100 } })
    const repaired = repairOf(left, canonicalRight(canonicalPayload('iron_ingot'), 3), rules, initialTransformationOf(left))

    expect(repaired).toMatchObject({
      state: {
        durability: { current: 90, max: 100 },
        operationCost: 3,
        materialCost: 3,
        rightContributed: true,
      },
    })

    const fullLeft = canonicalPayload('iron_sword', { durability: { current: 100, max: 100 } })
    expect(repairOf(fullLeft, canonicalRight(canonicalPayload('iron_ingot')), rules, initialTransformationOf(fullLeft)))
      .toStrictEqual({ state: initialTransformationOf(fullLeft) })
    expect(repairOf(
      canonicalPayload('iron_sword'),
      canonicalRight(canonicalPayload('iron_ingot')),
      rules,
      initialTransformationOf(canonicalPayload('iron_sword')),
    )).toBeUndefined()

    const statefulMaterials = [
      canonicalPayload('iron_ingot', { durability: { current: 1, max: 10 } }),
      canonicalPayload('iron_ingot', { enchantments: [enchantment('minecraft:sharpness')] }),
      canonicalPayload('iron_ingot', { customName: AnvilCustomName('Stamped') }),
      canonicalPayload('iron_ingot', { repairCost: 1 }),
    ]
    for (const material of statefulMaterials) {
      expect(repairOf(left, canonicalRight(material), rules, initialTransformationOf(left))).toMatchObject({
        failure: { reason: 'incompatible-input' },
      })
    }
  })

  it('merges, caps, and rejects enchantments without changing unrelated state', () => {
    const sharpness = AnvilEnchantmentId('minecraft:sharpness')
    const smite = AnvilEnchantmentId('minecraft:smite')
    const definitions = new Map<AnvilEnchantmentIdValue, CompiledAnvilEnchantmentRule>([
      [sharpness, compiledRule(sharpness, { maxLevel: 3, costPerLevel: 2 })],
      [smite, compiledRule(smite)],
    ])
    const left = canonicalPayload('iron_sword', {
      enchantments: [enchantment('minecraft:sharpness', 1), enchantment('minecraft:unrelated', 1)],
    })
    const book = (source: AnvilEnchantment) => canonicalRight(canonicalPayload('enchanted_book', {
      enchantments: [source],
    }))
    const merged = mergeEnchantments(left, book(enchantment('minecraft:sharpness', 1)), definitions, initialTransformationOf(left))

    expect(merged).toMatchObject({
      state: {
        enchantments: [
          enchantment('minecraft:sharpness', 2),
          enchantment('minecraft:unrelated', 1),
        ],
        operationCost: 4,
        materialCost: 1,
        rightContributed: true,
      },
    })
    expect(mergeEnchantments(
      left,
      book(enchantment('minecraft:sharpness', 2)),
      definitions,
      initialTransformationOf(left),
    )).toMatchObject({
      state: {
        enchantments: [
          enchantment('minecraft:sharpness', 2),
          enchantment('minecraft:unrelated', 1),
        ],
      },
    })
    expect(mergeEnchantments(
      left,
      book(enchantment('minecraft:sharpness', 3)),
      definitions,
      transformation({ enchantments: [enchantment('minecraft:sharpness', 3)] }),
    )).toStrictEqual({
      state: transformation({ enchantments: [enchantment('minecraft:sharpness', 3)] }),
    })
    expect(mergeEnchantments(left, canonicalRight(canonicalPayload('diamond')), definitions, initialTransformationOf(left)))
      .toBeUndefined()
    expect(mergeEnchantments(
      left,
      book(enchantment('minecraft:unregistered')),
      definitions,
      initialTransformationOf(left),
    )).toMatchObject({ failure: { reason: 'invalid-enchantment' } })
    expect(mergeEnchantments(
      canonicalPayload('iron_sword'),
      book(enchantment('minecraft:sharpness')),
      new Map([[sharpness, compiledRule(sharpness, { applicableItems: new Set<ItemType>(['diamond_sword']) })]]),
      initialTransformationOf(canonicalPayload('iron_sword')),
    )).toMatchObject({ failure: { reason: 'invalid-enchantment' } })
    expect(mergeEnchantments(
      canonicalPayload('iron_sword', { enchantments: [enchantment('minecraft:sharpness')] }),
      book(enchantment('minecraft:smite')),
      new Map([
        [sharpness, compiledRule(sharpness, { conflictingWith: new Set([smite]) })],
        [smite, compiledRule(smite)],
      ]),
      initialTransformationOf(canonicalPayload('iron_sword', { enchantments: [enchantment('minecraft:sharpness')] })),
    )).toMatchObject({ failure: { reason: 'enchantment-conflict' } })
    expect(mergeEnchantments(
      canonicalPayload('enchanted_book'),
      book(enchantment('minecraft:sharpness')),
      definitions,
      initialTransformationOf(canonicalPayload('enchanted_book')),
    )).toMatchObject({ state: { rightContributed: true } })
    expect(mergeEnchantments(
      canonicalPayload('iron_sword'),
      canonicalRight(canonicalPayload('iron_sword')),
      definitions,
      initialTransformationOf(canonicalPayload('iron_sword')),
    )).toStrictEqual({ state: initialTransformationOf(canonicalPayload('iron_sword')) })
  })

  it('finalizes rename, no-op, incompatibility, and expensive plans', () => {
    const left = canonicalPayload('iron_sword')
    const untouched = transformation()

    expect(withRename(left, null, untouched)).toBe(untouched)
    expect(withRename(left, AnvilCustomName('Named'), untouched)).toMatchObject({ operationCost: 1 })
    expect(finalizeAnvilPlan(left, canonicalRight(canonicalPayload('stone')), null, untouched))
      .toMatchObject({ ok: false, reason: 'incompatible-input' })
    expect(finalizeAnvilPlan(left, null, null, untouched)).toMatchObject({ ok: false, reason: 'nothing-to-do' })
    expect(finalizeAnvilPlan(
      canonicalPayload('iron_sword', { repairCost: 39 }),
      null,
      AnvilCustomName('Named'),
      withRename(left, AnvilCustomName('Named'), untouched),
    )).toMatchObject({ ok: false, reason: 'too-expensive' })
    expect(finalizeAnvilPlan(
      canonicalPayload('iron_sword', { repairCost: 4 }),
      canonicalRight(canonicalPayload('iron_ingot', { repairCost: 2 })),
      AnvilCustomName('Named'),
      transformation({ operationCost: 3, materialCost: AnvilMaterialCost(1), rightContributed: true }),
    )).toMatchObject({
      ok: true,
      levelCost: 9,
      materialCost: 1,
      output: {
        item: 'iron_sword',
        repairCost: 9,
        customName: AnvilCustomName('Named'),
      },
    })
  })
})

describe('anvil planning and application', () => {
  it('handles invalid snapshots, missing left inputs, and malformed rule sets', () => {
    const validRules = ruleSet()
    expect(planAnvil(state(payload('iron_sword', { durability: { current: 0, max: 100 } }), null, AnvilCustomName('New')), validRules))
      .toMatchObject({ ok: false, reason: 'invalid-input' })
    expect(planAnvil(state(null), validRules)).toMatchObject({
      ok: false,
      reason: 'invalid-input',
      issues: [{ path: '$.state.left' }],
    })
    expect(planAnvil(
      state(payload('iron_sword'), null, AnvilCustomName('New')),
      JSON.parse('{"enchantments":[{"id":"bad id","maxLevel":1,"applicableItems":["iron_sword"],"incompatibleWith":[]}]}'),
    )).toMatchObject({ ok: false, reason: 'invalid-rules' })
  })

  it('plans through array and compiled rules and returns transformation failures', () => {
    const sharpness = AnvilEnchantmentId('minecraft:sharpness')
    const smite = AnvilEnchantmentId('minecraft:smite')
    const rules = ruleSet([
      enchantmentRule(sharpness, { incompatibleWith: [smite] }),
      enchantmentRule(smite),
    ])
    const compiled = compile(rules)
    const renameState = state(payload('iron_sword'), null, AnvilCustomName('Named'))

    expect(planAnvil(renameState, rules)).toStrictEqual(planAnvil(renameState, compiled))
    expect(planAnvil(state(
      payload('iron_sword', { enchantments: [enchantment('minecraft:sharpness')] }),
      inputStack(payload('enchanted_book', { enchantments: [enchantment('minecraft:smite')] })),
    ), rules)).toMatchObject({ ok: false, reason: 'enchantment-conflict' })
    expect(planAnvil(state(
      payload('iron_sword'),
      inputStack(payload('enchanted_book', { enchantments: [enchantment('minecraft:sharpness')] })),
    ), rules)).toMatchObject({
      ok: true,
      levelCost: 1,
      output: { enchantments: [enchantment('minecraft:sharpness')] },
    })
    expect(planAnvil(
      state(payload('iron_sword', { enchantments: [enchantment('minecraft:unregistered')] })),
      rules,
    )).toMatchObject({ ok: false, reason: 'invalid-enchantment' })
    expect(planAnvil(state(
      payload('iron_sword', { durability: { current: 10, max: 100 } }),
      inputStack(payload('iron_sword', { durability: { current: 20, max: 80 } })),
    ), rules)).toMatchObject({ ok: false, reason: 'incompatible-input' })
  })

  it('applies costs, preserves failed input, and leaves only unconsumed repair material', () => {
    const repairRules = ruleSet([], [
      { target: 'iron_sword', material: 'iron_ingot', durabilityPerUnit: 20 },
    ])
    const spent = applyAnvil(state(
      payload('iron_sword', { durability: { current: 90, max: 100 } }),
      inputStack(payload('iron_ingot'), 1),
      null,
      10,
    ), repairRules)
    expect(spent).toMatchObject({
      ok: true,
      state: { left: null, right: null, experienceLevels: 9 },
      output: { durability: { current: 100, max: 100 } },
      levelCost: 1,
      materialCost: 1,
    })

    const partial = applyAnvil(state(
      payload('iron_sword', { durability: { current: 90, max: 100 } }),
      inputStack(payload('iron_ingot'), 3),
      null,
      10,
    ), repairRules)
    expect(partial).toMatchObject({ ok: true, state: { right: { count: 2 } } })

    const insufficient = state(payload('iron_sword'), null, AnvilCustomName('New'), 0)
    expect(applyAnvil(insufficient, ruleSet())).toMatchObject({
      ok: false,
      state: insufficient,
      reason: 'insufficient-experience',
    })
    const noChange = state(payload('iron_sword'))
    expect(applyAnvil(noChange, ruleSet())).toMatchObject({
      ok: false,
      state: noChange,
      reason: 'nothing-to-do',
    })
  })

  it('revalidates the state before consuming the result', () => {
    let reads = 0
    const changingState: AnvilState = {
      get left() {
        reads += 1
        return reads === 1
          ? payload('iron_sword')
          : payload('iron_sword', { durability: { current: 0, max: 100 } })
      },
      right: null,
      rename: AnvilCustomName('New'),
      experienceLevels: 10,
    }

    expect(applyAnvil(changingState, ruleSet())).toMatchObject({
      ok: false,
      state: changingState,
      reason: 'invalid-input',
    })
  })
})

describe('anvil snapshot encoding and decoding', () => {
  const validState = state(payload('iron_sword', {
    durability: { current: 20, max: 100 },
    enchantments: [enchantment('minecraft:sharpness', 2)],
  }), inputStack(payload('iron_ingot'), 2), AnvilCustomName('Named'), 12)

  it('round-trips a canonical snapshot and validates the branded string', () => {
    const snapshot = snapshotAnvilState(validState)
    expect(snapshot).toMatchObject({
      ok: true,
      snapshot: {
        version: ANVIL_SNAPSHOT_VERSION,
        state: { left: { item: 'iron_sword', repairCost: 0 }, experienceLevels: 12 },
      },
    })

    const encoded = encodeAnvilSnapshot(validState)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) throw new Error('The fixture state must encode')
    expect(decodeAnvilSnapshot(encoded.snapshot)).toStrictEqual(snapshot)
    expect(decodeAnvilSnapshotString(encoded.encoded)).toStrictEqual(snapshot)
    expect(isAnvilSnapshotString(encoded.encoded)).toBe(true)
    expect(AnvilSnapshotString(encoded.encoded)).toBe(encoded.encoded)
  })

  it('reports malformed top-level, state, item, durability, and right-input values', () => {
    const malformed = {
      version: 7,
      extraSnapshotField: true,
      state: {
        extraStateField: true,
        left: {
          item: 'unknown_item',
          durability: { current: 0, max: 0 },
          enchantments: 'not-an-array',
          repairCost: -1,
          customName: 'x'.repeat(ANVIL_MAX_CUSTOM_NAME_LENGTH + 1),
          extraItemField: true,
        },
        right: { payload: {}, count: 0, extraStackField: true },
        rename: '\u0000invalid',
        experienceLevels: -1,
      },
    }

    expect(decodeAnvilSnapshot(null)).toMatchObject({ ok: false, issues: [{ path: '$' }] })
    expect(decodeAnvilSnapshot([])).toMatchObject({ ok: false, issues: [{ path: '$' }] })
    expect(decodeAnvilSnapshot({ version: ANVIL_SNAPSHOT_VERSION, state: null })).toMatchObject({
      ok: false,
      issues: [{ path: '$.state', reason: 'must be an object' }],
    })
    expect(decodeAnvilSnapshot({
      version: ANVIL_SNAPSHOT_VERSION,
      state: { left: 'not an item payload', right: null, rename: null, experienceLevels: 0 },
    })).toMatchObject({
      ok: false,
      issues: [{ path: '$.state.left', reason: 'must be an object' }],
    })
    expect(decodeAnvilSnapshot({
      version: ANVIL_SNAPSHOT_VERSION,
      state: { left: null, right: 'not an input stack', rename: null, experienceLevels: 0 },
    })).toMatchObject({
      ok: false,
      issues: [{ path: '$.state.right', reason: 'must be null or an input stack' }],
    })
    expect(decodeAnvilSnapshot({
      version: ANVIL_SNAPSHOT_VERSION,
      state: { left: null, right: { payload: null, count: 1 }, rename: null, experienceLevels: 0 },
    })).toMatchObject({
      ok: false,
      issues: [{ path: '$.state.right.payload', reason: 'must be an object' }],
    })
    expect(decodeAnvilSnapshot(malformed)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { path: '$.extraSnapshotField', reason: 'is not a field of this format' },
        { path: '$.version', reason: `must be ${String(ANVIL_SNAPSHOT_VERSION)}` },
        { path: '$.state.extraStateField', reason: 'is not a field of this format' },
        { path: '$.state.left.extraItemField', reason: 'is not a field of this format' },
        { path: '$.state.left.durability', reason: 'must be null or valid remaining durability' },
        { path: '$.state.left.enchantments', reason: 'must be an array' },
        { path: '$.state.left.repairCost', reason: 'must be a non-negative safe integer' },
        { path: '$.state.left.customName', reason: 'must be null or a valid custom name' },
        { path: '$.state.right.extraStackField', reason: 'is not a field of this format' },
        { path: '$.state.right.count', reason: 'must be a positive safe integer' },
        { path: '$.state.rename', reason: 'must be null or a valid custom name' },
        { path: '$.state.experienceLevels', reason: 'must be a non-negative safe integer' },
      ]),
    })
    expect(encodeAnvilSnapshot(state(
      payload('iron_sword', { durability: { current: 0, max: 100 } }),
    ))).toMatchObject({ ok: false, issues: [{ path: '$.state.left.durability' }] })
  })

  it('collects enchantment, unknown-field, stack-limit, and durability-stack errors', () => {
    const enchantmentIssues = {
      version: ANVIL_SNAPSHOT_VERSION,
      state: {
        left: {
          item: 'iron_sword',
          durability: { current: 1, max: 2, extraDurabilityField: true },
          enchantments: [
            null,
            { id: 'bad id', level: 1 },
            { id: 'minecraft:sharpness', level: 0 },
            { id: 'minecraft:sharpness', level: 1, extraEnchantmentField: true },
            { id: 'minecraft:sharpness', level: 2 },
          ],
          repairCost: 0,
          customName: null,
          extraItemField: true,
        },
        right: {
          payload: { item: 'iron_ingot', durability: null, enchantments: [], customName: null },
          count: 1,
          extraStackField: true,
        },
        rename: null,
        experienceLevels: 1,
        extraStateField: true,
      },
    }

    expect(decodeAnvilSnapshot(enchantmentIssues)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { path: '$.state.left.durability.extraDurabilityField', reason: 'is not a field of this format' },
        { path: '$.state.left.enchantments.0', reason: 'must be an object' },
        { path: '$.state.left.enchantments.1.id', reason: 'must be a canonical enchantment id' },
        { path: '$.state.left.enchantments.2.level', reason: 'must be a positive safe integer' },
        { path: '$.state.left.enchantments.3.extraEnchantmentField', reason: 'is not a field of this format' },
        { path: '$.state.left.enchantments.4.id', reason: 'must be unique' },
      ]),
    })

    const overStackLimit = state(payload('iron_sword'), inputStack(payload('stone'), 65))
    expect(snapshotAnvilState(overStackLimit)).toMatchObject({
      ok: false,
      issues: [{ path: '$.state.right.count', reason: 'exceeds the item stack limit' }],
    })
    const stackedDurability = state(
      payload('iron_sword'),
      inputStack(payload('stone', { durability: { current: 1, max: 2 } }), 2),
    )
    expect(snapshotAnvilState(stackedDurability)).toMatchObject({
      ok: false,
      issues: [{ path: '$.state.right.count', reason: 'durable item payloads cannot stack' }],
    })
  })

  it('accepts optional defaults and rejects malformed JSON or branded snapshot text', () => {
    const optionalDefaults = {
      version: ANVIL_SNAPSHOT_VERSION,
      state: {
        left: {
          item: 'iron_sword',
          durability: null,
          enchantments: [],
        },
        right: null,
        rename: null,
        experienceLevels: 0,
      },
    }
    expect(decodeAnvilSnapshot(optionalDefaults)).toMatchObject({
      ok: true,
      snapshot: { state: { left: { repairCost: 0, customName: null }, right: null } },
    })
    expect(decodeAnvilSnapshotString('{')).toMatchObject({
      ok: false,
      issues: [{ path: '$', reason: 'must be valid JSON' }],
    })
    expect(decodeAnvilSnapshotString(JSON.stringify(optionalDefaults))).toMatchObject({ ok: true })
    expect(isAnvilSnapshotString('{')).toBe(false)
    expect(() => AnvilSnapshotString('{')).toThrow(TypeError)

    const inheritedSnapshot = Object.setPrototypeOf(
      { version: ANVIL_SNAPSHOT_VERSION, state: optionalDefaults.state },
      { inheritedField: true },
    )
    expect(decodeAnvilSnapshot(inheritedSnapshot)).toMatchObject({ ok: true })
  })
})
