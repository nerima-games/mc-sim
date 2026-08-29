import { describe, expect, it } from '@effect/vitest'
import {
  AnvilEnchantmentId,
  type AnvilEnchantment,
  type AnvilItemPayload,
  type AnvilState,
  type ItemType,
} from '@nerima-games/mc-kernel'
import {
  applyVanillaAnvil,
  enchantmentAppliesTo,
  enchantmentRuleFor,
  enchantmentsConflict,
  isSupportedVanillaEnchantmentId,
  planVanillaAnvil,
} from '../src/domain/enchantment'
import {
  SUPPORTED_VANILLA_ENCHANTMENT_IDS,
  SUPPORTED_VANILLA_ENCHANTMENT_RULES,
  VANILLA_ENCHANTMENT_COSTS,
  type SupportedVanillaEnchantmentId,
} from '../src/domain/enchantment-data'

const enchantment = (id: string, level = 1): AnvilEnchantment => ({
  id: AnvilEnchantmentId(id),
  level,
})

const payload = (item: ItemType, enchantments: ReadonlyArray<AnvilEnchantment> = []): AnvilItemPayload => ({
  item,
  durability: null,
  enchantments,
})

const anvilState = (
  left: ItemType,
  rightItem: ItemType,
  rightEnchantment: AnvilEnchantment,
  experienceLevels = 10,
): AnvilState => ({
  left: payload(left),
  right: { payload: payload(rightItem, [rightEnchantment]), count: 1 },
  rename: null,
  experienceLevels,
})

describe('supported vanilla enchantment data', () => {
  it('keeps a unique kernel rule for every supported id', () => {
    expect(new Set(SUPPORTED_VANILLA_ENCHANTMENT_IDS).size).toBe(SUPPORTED_VANILLA_ENCHANTMENT_IDS.length)
    expect(new Set(SUPPORTED_VANILLA_ENCHANTMENT_RULES.map((rule) => rule.id)).size).toBe(
      SUPPORTED_VANILLA_ENCHANTMENT_RULES.length,
    )
    expect(SUPPORTED_VANILLA_ENCHANTMENT_RULES).toHaveLength(SUPPORTED_VANILLA_ENCHANTMENT_IDS.length)
    expect(Object.keys(VANILLA_ENCHANTMENT_COSTS).sort()).toStrictEqual([...SUPPORTED_VANILLA_ENCHANTMENT_IDS].sort())

    for (const rule of SUPPORTED_VANILLA_ENCHANTMENT_RULES) {
      expect(SUPPORTED_VANILLA_ENCHANTMENT_IDS).toContain(rule.id)
      expect(enchantmentRuleFor(rule.id)).toStrictEqual(rule)
    }
  })

  it('stores the official item and book cost multipliers', () => {
    expect(VANILLA_ENCHANTMENT_COSTS.mending).toStrictEqual({ item: 4, book: 2 })
    expect(VANILLA_ENCHANTMENT_COSTS.silk_touch).toStrictEqual({ item: 8, book: 4 })
  })

  it('narrows only registered enchantment ids', () => {
    expect(isSupportedVanillaEnchantmentId('sharpness')).toBe(true)
    expect(isSupportedVanillaEnchantmentId('minecraft:sharpness')).toBe(false)
    expect(isSupportedVanillaEnchantmentId(null)).toBe(false)
    expect(isSupportedVanillaEnchantmentId(7)).toBe(false)
    expect(enchantmentRuleFor('not_registered')).toBeUndefined()
  })

  it('exposes target compatibility and conflicts from the rule data', () => {
    expect(enchantmentAppliesTo('sharpness', 'iron_sword')).toBe(true)
    expect(enchantmentAppliesTo('sharpness', 'bow')).toBe(false)
    expect(enchantmentAppliesTo('not_registered', 'iron_sword')).toBe(false)
    expect(enchantmentsConflict('sharpness', 'smite')).toBe(true)
    expect(enchantmentsConflict('smite', 'sharpness')).toBe(true)
    expect(enchantmentsConflict('sharpness', 'power')).toBe(false)
    expect(enchantmentsConflict('not_registered', 'sharpness')).toBe(false)
    expect(enchantmentsConflict('sharpness', 'not_registered')).toBe(false)
  })

  it('keeps the supported ids and level caps representative of the current kernel item vocabulary', () => {
    const rule = (id: SupportedVanillaEnchantmentId) => enchantmentRuleFor(id)

    expect(rule('protection')?.maxLevel).toBe(4)
    expect(rule('sharpness')?.maxLevel).toBe(5)
    expect(rule('mending')?.applicableItems).toContain('iron_sword')
    expect(rule('aqua_affinity')?.applicableItems).toStrictEqual(['iron_helmet'])
    expect(rule('silk_touch')?.incompatibleWith).toStrictEqual([AnvilEnchantmentId('fortune')])
  })
})

describe('vanilla anvil integration', () => {
  it('plans and applies a supported enchantment book to a compatible item', () => {
    const state = anvilState('iron_sword', 'enchanted_book', enchantment('mending'))
    const plan = planVanillaAnvil(state)

    expect(plan).toMatchObject({ ok: true, levelCost: 2, materialCost: 1 })
    if (!plan.ok) return
    expect(plan.output).toStrictEqual({
      item: 'iron_sword',
      durability: null,
      enchantments: [enchantment('mending')],
      repairCost: 1,
      customName: null,
    })

    const applied = applyVanillaAnvil(state)
    expect(applied).toMatchObject({ ok: true, levelCost: 2, materialCost: 1 })
    if (!applied.ok) return
    expect(applied.state).toStrictEqual({ left: null, right: null, rename: null, experienceLevels: 8 })
  })

  it('uses the item multiplier when combining two compatible items', () => {
    const state = anvilState('iron_sword', 'iron_sword', enchantment('mending'))

    expect(planVanillaAnvil(state)).toMatchObject({ ok: true, levelCost: 4, materialCost: 1 })
  })

  it('rejects conflicts, incompatible targets, and unregistered enchantments', () => {
    const conflictState: AnvilState = {
      ...anvilState('iron_sword', 'enchanted_book', enchantment('smite')),
      left: payload('iron_sword', [enchantment('sharpness')]),
    }
    expect(planVanillaAnvil(conflictState)).toMatchObject({ ok: false, reason: 'enchantment-conflict' })

    expect(planVanillaAnvil(anvilState('bow', 'enchanted_book', enchantment('sharpness')))).toMatchObject({
      ok: false,
      reason: 'invalid-enchantment',
    })

    expect(planVanillaAnvil(anvilState('iron_sword', 'enchanted_book', enchantment('minecraft:sharpness')))).toMatchObject({
      ok: false,
      reason: 'invalid-enchantment',
    })
  })

  it('does not consume inputs when the player lacks experience', () => {
    const state = anvilState('iron_sword', 'enchanted_book', enchantment('sharpness'), 0)
    const result = applyVanillaAnvil(state)

    expect(result).toMatchObject({ ok: false, reason: 'insufficient-experience', state })
  })
})
