import { Result } from 'effect'
import fc from 'fast-check'
import {
  ANVIL_REPAIR_BONUS_RATIO,
  ITEM_DURABILITY_CATALOG,
  VANILLA_ENCHANTMENT_COSTS,
} from '@nerima-games/mc-kernel'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import * as Anvil from '../src/domain/anvil.js'
import { finiteTree, isRecord, unknownValue, invoke } from './public-property-helpers.js'

const checks = { numRuns: 64, seed: 0x414e5649 }

const maximumIncrementableRepairCost = Math.floor((Number.MAX_SAFE_INTEGER - 1) / 2)

const repairCostResult = (value: unknown): Result.Result<number, unknown> =>
  invoke(Sim.nextAnvilRepairCost, [value]) as Result.Result<number, unknown>

const invalidState = fc.oneof(
  unknownValue,
  fc.constantFrom<unknown>(
    null,
    undefined,
    false,
    0,
    '',
    [],
    {},
    { left: null, right: null, rename: null, experienceLevels: 0 },
  ),
)

const invalidRules = fc.oneof(
  unknownValue,
  fc.constantFrom<unknown>(
    null,
    undefined,
    false,
    0,
    '',
    [],
    {},
    { enchantments: null },
    { enchantments: [], repairMaterials: {} },
    { enchantments: [null] },
    { enchantments: [{}] },
  ),
)

const malformedCompiledRules = fc.constantFrom<unknown>(
  { enchantments: new Map(), repairMaterials: null },
  { enchantments: new Map([['sharpness', {}]]), repairMaterials: new Map() },
  { enchantments: new Map(), repairMaterials: new Map([['iron_sword', new Map([['iron_ingot', null]])]]) },
)

const validState = {
  left: {
    item: 'iron_sword',
    durability: null,
    enchantments: [],
    repairCost: 0,
    customName: null,
  },
  right: null,
  rename: null,
  experienceLevels: 0,
}

const assertTypedAnvilOutcome = (value: unknown): void => {
  expect(isRecord(value)).toBe(true)
  if (!isRecord(value)) return

  if (value['ok'] === false) {
    expect(typeof value['reason']).toBe('string')
    expect(Array.isArray(value['issues'])).toBe(true)
    expect(value['issues']).not.toHaveLength(0)
    return
  }

  expect(value['ok']).toBe(true)
  expect(finiteTree(value)).toBe(true)
}

it('generic anvil state envelopes return typed planning and application results', () => {
  fc.assert(fc.property(invalidState, (state) => {
    const plan = invoke(Sim.planAnvil, [state, { enchantments: [] }])
    const applied = invoke(Sim.applyAnvil, [state, { enchantments: [] }])

    assertTypedAnvilOutcome(plan)
    assertTypedAnvilOutcome(applied)
    expect(isRecord(plan) && plan['ok'] === false && plan['reason'] === 'invalid-input').toBe(true)
    expect(isRecord(applied) && applied['ok'] === false && applied['reason'] === 'invalid-input').toBe(true)
  }), checks)
})

it('generic anvil rule envelopes return typed invalid-rules results', () => {
  fc.assert(fc.property(invalidRules, (rules) => {
    const compilation = invoke(Anvil.compileAnvilRuleSet, [rules])
    const plan = invoke(Sim.planAnvil, [validState, rules])
    const applied = invoke(Sim.applyAnvil, [validState, rules])

    for (const result of [compilation, plan, applied]) {
      assertTypedAnvilOutcome(result)
      expect(isRecord(result) && result['ok'] === false && result['reason'] === 'invalid-rules').toBe(true)
    }
  }), checks)
})

it('forged compiled anvil maps are rejected as typed rule failures', () => {
  fc.assert(fc.property(malformedCompiledRules, (rules) => {
    const plan = invoke(Sim.planAnvil, [validState, rules])
    const applied = invoke(Sim.applyAnvil, [validState, rules])

    for (const result of [plan, applied]) {
      assertTypedAnvilOutcome(result)
      expect(isRecord(result) && result['ok'] === false && result['reason'] === 'invalid-rules').toBe(true)
    }
  }), { numRuns: 24, seed: 0x434d504c })
})

it('anvil repair-cost helper returns typed failures for malformed costs', () => {
  const invalidRepairCost = fc.constantFrom<unknown>(
    null,
    undefined,
    false,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    -0.5,
    0.5,
    Number.MAX_VALUE,
  )

  fc.assert(fc.property(invalidRepairCost, (repairCost) => {
    const outcome = repairCostResult(repairCost)
    expect(Result.isFailure(outcome)).toBe(true)
    if (Result.isFailure(outcome)) {
      expect(outcome.failure).toMatchObject({ _tag: 'InvalidAnvilRepairCost' })
    }
  }), checks)
})

it('anvil repair-cost helper reports overflow before losing integer precision', () => {
  const overflowingRepairCost = fc.constantFrom<unknown>(
    maximumIncrementableRepairCost + 1,
    Number.MAX_SAFE_INTEGER,
  )

  fc.assert(fc.property(overflowingRepairCost, (repairCost) => {
    const outcome = repairCostResult(repairCost)
    expect(Result.isFailure(outcome)).toBe(true)
    if (Result.isFailure(outcome)) {
      expect(outcome.failure).toMatchObject({ _tag: 'AnvilRepairCostOverflow' })
    }
  }), checks)
})

it('anvil repair-cost helper keeps exact calculations for representable valid costs', () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: maximumIncrementableRepairCost }),
    (repairCost) => {
      const outcome = repairCostResult(repairCost)
      expect(Result.isSuccess(outcome)).toBe(true)
      if (Result.isSuccess(outcome)) {
        expect(Number.isSafeInteger(outcome.success)).toBe(true)
        expect(outcome.success).toBe(repairCost * 2 + 1)
      }
    },
  ), checks)
})

it('public vanilla anvil plans match the independent two-tool cost formula', () => {
  const maxDurability = Number(ITEM_DURABILITY_CATALOG.iron_sword.maxDurability)
  const itemCost = Number(VANILLA_ENCHANTMENT_COSTS.sharpness.item)
  const sharpnessMaxLevel = 5
  const sharpness = Result.getOrThrow(Sim.AnvilEnchantmentId('sharpness'))

  fc.assert(fc.property(
    fc.integer({ min: 1, max: maxDurability - 1 }),
    fc.integer({ min: 1, max: maxDurability - 1 }),
    fc.integer({ min: 1, max: sharpnessMaxLevel }),
    fc.integer({ min: 1, max: sharpnessMaxLevel }),
    fc.integer({ min: 0, max: 3 }),
    fc.integer({ min: 0, max: 3 }),
    (leftCurrent, rightCurrent, leftLevel, rightLevel, leftRepairCost, rightRepairCost) => {
      const mergedLevel = Math.min(
        sharpnessMaxLevel,
        leftLevel === rightLevel ? leftLevel + 1 : Math.max(leftLevel, rightLevel),
      )
      const enchantmentCost = mergedLevel * itemCost
      const expectedDurability = Math.min(
        maxDurability,
        leftCurrent + rightCurrent + Math.floor(maxDurability * ANVIL_REPAIR_BONUS_RATIO),
      )
      const payload = (current: number, level: number, repairCost: number) => ({
        item: 'iron_sword' as const,
        durability: { current, max: maxDurability },
        enchantments: [{ id: sharpness, level }],
        repairCost,
      })
      const plan = Sim.planVanillaAnvil({
        left: payload(leftCurrent, leftLevel, leftRepairCost),
        right: { payload: payload(rightCurrent, rightLevel, rightRepairCost), count: 1 },
        rename: null,
        experienceLevels: 40,
      })

      expect(plan).toMatchObject({
        ok: true,
        levelCost: 2 + enchantmentCost + leftRepairCost + rightRepairCost,
        materialCost: 1,
        output: {
          durability: { current: expectedDurability, max: maxDurability },
          enchantments: [{ id: sharpness, level: mergedLevel }],
        },
      })
    },
  ), { ...checks, seed: 0x50554241 })
})

it('public vanilla anvil planning allows cost 39 and rejects cost 40', () => {
  const name = Result.getOrThrow(Sim.AnvilCustomName('Renamed'))
  const renameAt = (repairCost: number) => Sim.planVanillaAnvil({
    left: {
      item: 'iron_sword',
      durability: null,
      enchantments: [],
      repairCost,
    },
    right: null,
    rename: name,
    experienceLevels: 40,
  })

  expect(renameAt(38)).toMatchObject({ ok: true, levelCost: 39 })
  expect(renameAt(39)).toMatchObject({ ok: false, reason: 'too-expensive' })
})
