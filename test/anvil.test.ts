import { Result } from 'effect'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  ANVIL_REPAIR_BONUS_RATIO,
  ITEM_DURABILITY_CATALOG,
  VANILLA_ENCHANTMENT_COSTS,
  itemDurabilityDefinitionFor,
} from '@nerima-games/mc-kernel'
import {
  AnvilCustomName,
  AnvilEnchantmentId,
  type AnvilEnchantment,
  type AnvilItemPayload,
  type AnvilState,
} from '../src/domain/anvil'
import {
  applyVanillaAnvil,
  planVanillaAnvil,
  SUPPORTED_VANILLA_BOOK_ANVIL_RULE_SET,
  SUPPORTED_VANILLA_ITEM_ANVIL_RULE_SET,
} from '../src/domain/enchantment'
import { SUPPORTED_VANILLA_ANVIL_REPAIR_MATERIAL_RULES } from '../src/domain/anvil-material-data'

const vanillaAnvilSource = {
  edition: 'Java Edition 26.3',
  url: 'https://minecraft.wiki/w/Anvil_mechanics',
} as const

const enchantment = (id: string, level = 1): AnvilEnchantment => {
  const brandedId = AnvilEnchantmentId(id)
  if (Result.isFailure(brandedId)) throw new Error('Expected a valid fixture enchantment id')
  return { id: brandedId.success, level }
}

const brandedName = (value: string) => {
  const result = AnvilCustomName(value)
  if (Result.isFailure(result)) throw new Error('Expected a valid fixture custom name')
  return result.success
}

const payload = (item: AnvilItemPayload['item'], enchantments: ReadonlyArray<AnvilEnchantment> = []): AnvilItemPayload => ({
  item,
  durability: null,
  enchantments,
})

const state = (experienceLevels = 10): AnvilState => ({
  left: payload('iron_sword'),
  right: { payload: payload('enchanted_book', [enchantment('sharpness')]), count: 1 },
  rename: null,
  experienceLevels,
})

describe('anvil runtime', () => {
  it('uses the vanilla rule data to combine a book without changing W1 costs', () => {
    const plan = planVanillaAnvil(state())

    expect(plan).toMatchObject({ ok: true, levelCost: 1, materialCost: 1 })
    if (!plan.ok) return
    expect(plan.output).toStrictEqual({
      item: 'iron_sword',
      durability: null,
      enchantments: [enchantment('sharpness')],
      repairCost: 1,
      customName: null,
    })
  })

  it('returns a typed failure for invalid ids and leaves inputs unchanged on rejection', () => {
    expect(AnvilEnchantmentId('bad id')).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'AnvilPrimitiveFailure', brand: 'AnvilEnchantmentId', value: 'bad id' },
    })

    const input = state(0)
    const applied = applyVanillaAnvil(input)
    expect(applied).toMatchObject({ ok: false, reason: 'insufficient-experience' })
    if (!applied.ok) expect(applied.state).toBe(input)
  })

  it('uses kernel item and book enchantment costs and vanilla repair materials', () => {
    expect(SUPPORTED_VANILLA_ITEM_ANVIL_RULE_SET.repairMaterials).toBe(SUPPORTED_VANILLA_ANVIL_REPAIR_MATERIAL_RULES)
    expect(SUPPORTED_VANILLA_BOOK_ANVIL_RULE_SET.repairMaterials).toBe(SUPPORTED_VANILLA_ANVIL_REPAIR_MATERIAL_RULES)

    const protection = enchantment('protection')
    const bookPlan = planVanillaAnvil({
      left: payload('iron_chestplate'),
      right: { payload: payload('enchanted_book', [protection]), count: 1 },
      rename: null,
      experienceLevels: 40,
    })
    const itemPlan = planVanillaAnvil({
      left: payload('iron_chestplate', [protection]),
      right: { payload: payload('iron_chestplate', [protection]), count: 1 },
      rename: null,
      experienceLevels: 40,
    })

    expect(bookPlan).toMatchObject({ ok: true, levelCost: VANILLA_ENCHANTMENT_COSTS.protection.book })
    expect(itemPlan).toMatchObject({ ok: true, levelCost: 2 * VANILLA_ENCHANTMENT_COSTS.protection.item })

    const swordMax = Number(itemDurabilityDefinitionFor('iron_sword')?.maxDurability)
    const materialPlan = planVanillaAnvil({
      left: { ...payload('iron_sword'), durability: { current: 50, max: swordMax }, repairCost: 2 },
      right: { payload: payload('iron_ingot'), count: 2 },
      rename: null,
      experienceLevels: 40,
    })

    expect(materialPlan).toMatchObject({ ok: true, levelCost: 4, materialCost: 2 })
    if (materialPlan.ok) expect(materialPlan.output.durability?.current).toBe(50 + 2 * Math.floor(swordMax * 0.25))
  })

  it('covers each kernel-durable item with a supported vanilla repair material and source metadata', () => {
    expect(vanillaAnvilSource).toStrictEqual({
      edition: 'Java Edition 26.3',
      url: 'https://minecraft.wiki/w/Anvil_mechanics',
    })

    const repairsByTarget = new Map(
      SUPPORTED_VANILLA_ANVIL_REPAIR_MATERIAL_RULES.map((rule) => [rule.target, rule]),
    )
    const durableItems = Object.keys(ITEM_DURABILITY_CATALOG).filter((item) => item !== 'elytra')
    expect([...repairsByTarget.keys()].sort()).toStrictEqual(durableItems.sort())
    for (const rule of SUPPORTED_VANILLA_ANVIL_REPAIR_MATERIAL_RULES) {
      const maxDurability = Number(itemDurabilityDefinitionFor(rule.target)?.maxDurability)
      expect(rule.durabilityPerUnit).toBe(Math.floor(maxDurability * 0.25))
    }
    expect(repairsByTarget.get('wooden_pickaxe')?.material).toBe('oak_planks')
    expect(repairsByTarget.get('stone_pickaxe')?.material).toBe('cobblestone')
    expect(repairsByTarget.get('iron_sword')?.material).toBe('iron_ingot')
    expect(repairsByTarget.get('diamond_sword')?.material).toBe('diamond')
    expect(repairsByTarget.get('netherite_sword')?.material).toBe('netherite_ingot')
    expect(repairsByTarget.get('bow')?.material).toBe('string')
    expect(repairsByTarget.has('elytra')).toBe(false)
  })

  it('accepts the exact 39-level boundary and rejects 40 levels', () => {
    const makeRenameState = (repairCost: number): AnvilState => ({
      left: { ...payload('iron_sword'), repairCost },
      right: null,
      rename: brandedName('Renamed'),
      experienceLevels: 40,
    })

    expect(planVanillaAnvil(makeRenameState(38))).toMatchObject({ ok: true, levelCost: 39 })
    expect(planVanillaAnvil(makeRenameState(39))).toMatchObject({
      ok: false,
      reason: 'too-expensive',
      issues: [{ path: '$.state' }],
    })
  })

  it('matches the independently calculated tool-combination formula for arbitrary valid damage and levels', () => {
    const maxDurability = Number(itemDurabilityDefinitionFor('iron_sword')?.maxDurability)
    const itemCost = Number(VANILLA_ENCHANTMENT_COSTS.sharpness.item)
    fc.assert(fc.property(
      fc.integer({ min: 1, max: maxDurability - 1 }),
      fc.integer({ min: 1, max: maxDurability - 1 }),
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 0, max: 3 }),
      fc.integer({ min: 0, max: 3 }),
      (leftCurrent, rightCurrent, leftLevel, rightLevel, leftRepairCost, rightRepairCost) => {
        const mergedLevel = leftLevel === rightLevel
          ? leftLevel + 1
          : Math.max(leftLevel, rightLevel)
        const enchantmentCost = leftLevel > rightLevel ? 0 : mergedLevel * itemCost
        const expectedDurability = Math.min(
          maxDurability,
          leftCurrent + rightCurrent + Math.floor(maxDurability * ANVIL_REPAIR_BONUS_RATIO),
        )
        const expectedLevelCost = 2 + enchantmentCost + leftRepairCost + rightRepairCost
        const plan = planVanillaAnvil({
          left: {
            ...payload('iron_sword', [enchantment('sharpness', leftLevel)]),
            durability: { current: leftCurrent, max: maxDurability },
            repairCost: leftRepairCost,
          },
          right: {
            payload: {
              ...payload('iron_sword', [enchantment('sharpness', rightLevel)]),
              durability: { current: rightCurrent, max: maxDurability },
              repairCost: rightRepairCost,
            },
            count: 1,
          },
          rename: null,
          experienceLevels: 40,
        })

        expect(plan).toMatchObject({
          ok: true,
          levelCost: expectedLevelCost,
          materialCost: 1,
          output: {
            durability: { current: expectedDurability, max: maxDurability },
            enchantments: [enchantment('sharpness', mergedLevel)],
          },
        })
      },
    ))
  })
})
