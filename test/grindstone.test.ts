import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  AnvilCustomName as createAnvilCustomName,
  AnvilEnchantmentId as createAnvilEnchantmentId,
  type AnvilEnchantment,
  type CanonicalAnvilItemPayload,
} from '../src/domain/anvil'
import {
  anvilEnchantmentsFromComponent,
  enchantmentsComponentOf,
  grindstoneExperienceFor,
  GRINDSTONE_CURSE_ENCHANTMENT_IDS,
  GRINDSTONE_DURABILITY_BONUS_PERCENT,
  GRINDSTONE_REPAIR_COST_MAX,
  planGrindstone,
  type GrindstoneInput,
} from '../src/domain/grindstone'

const unwrap = <A, E>(value: Result.Result<A, E>): A => {
  if (Result.isSuccess(value)) return value.success
  throw new Error('Expected a successful test brand result')
}

const enchantmentId = (value: string) => unwrap(createAnvilEnchantmentId(value))
const customName = (value: string) => unwrap(createAnvilCustomName(value))

const enchantment = (id: string, level = 1): AnvilEnchantment => ({ id: enchantmentId(id), level })

const item = (overrides: Partial<CanonicalAnvilItemPayload> = {}): CanonicalAnvilItemPayload => ({
  item: 'iron_pickaxe',
  durability: { current: 80, max: 100 },
  enchantments: [],
  repairCost: 0,
  customName: null,
  ...overrides,
})

const input = (payload: CanonicalAnvilItemPayload, count = 1): GrindstoneInput => ({ payload, count })

describe('grindstone data and experience', () => {
  it('keeps the W1 curse list, durability bonus, repair-cost cap, and saturated experience rule', () => {
    expect(GRINDSTONE_CURSE_ENCHANTMENT_IDS).toStrictEqual(['binding_curse', 'vanishing_curse'])
    expect(GRINDSTONE_DURABILITY_BONUS_PERCENT).toBe(5)
    expect(GRINDSTONE_REPAIR_COST_MAX).toBe(2_147_483_647)
    expect(grindstoneExperienceFor(-1)).toBe(0)
    expect(grindstoneExperienceFor(2.9)).toBe(3)
    expect(grindstoneExperienceFor(31)).toBe(GRINDSTONE_REPAIR_COST_MAX)
    expect(grindstoneExperienceFor(32)).toBe(GRINDSTONE_REPAIR_COST_MAX)
  })
})

describe('kernel enchantment component boundary', () => {
  it('maps bare vanilla ids to namespaced keys and reverses the mapping', () => {
    const component = enchantmentsComponentOf([enchantment('sharpness', 2)])
    expect(component).toMatchObject({ _tag: 'Success', success: { 'minecraft:sharpness': 2 } })
    if (Result.isFailure(component)) return
    expect(anvilEnchantmentsFromComponent(component.success)).toMatchObject({
      _tag: 'Success',
      success: [enchantment('sharpness', 2)],
    })
  })

  it('keeps non-minecraft namespaces and already namespaced vanilla ids', () => {
    const component = enchantmentsComponentOf([
      enchantment('minecraft:sharpness', 2),
      enchantment('example:keen', 3),
    ])
    expect(component).toMatchObject({
      _tag: 'Success',
      success: { 'minecraft:sharpness': 2, 'example:keen': 3 },
    })
    if (Result.isFailure(component)) return
    expect(anvilEnchantmentsFromComponent(component.success)).toMatchObject({
      _tag: 'Success',
      success: [enchantment('example:keen', 3), enchantment('sharpness', 2)],
    })
  })

  it('returns constructor failures for duplicate ids, invalid levels, invalid keys, and invalid sim ids', () => {
    const duplicate = enchantmentsComponentOf([
      enchantment('sharpness'),
      enchantment('minecraft:sharpness'),
    ])
    expect(duplicate).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'DuplicateGrindstoneEnchantment', componentId: 'minecraft:sharpness' },
    })

    const invalidLevel = enchantmentsComponentOf([enchantment('sharpness', 300)])
    expect(invalidLevel).toMatchObject({ _tag: 'Failure', failure: { _tag: 'BrandError' } })

    const invalidKey = anvilEnchantmentsFromComponent({ 'bad id': 1 })
    expect(invalidKey).toMatchObject({ _tag: 'Failure', failure: { _tag: 'ItemValidationFailure' } })

    const oversizedId = `${'x'.repeat(129)}:path`
    const invalidSimId = anvilEnchantmentsFromComponent({ [oversizedId]: 1 })
    expect(invalidSimId).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'AnvilPrimitiveFailure', brand: 'AnvilEnchantmentId' },
    })
  })

  it('leaves invalid grindstone input untouched when the kernel constructor fails', () => {
    const invalid = { id: 'bad id' as AnvilEnchantment['id'], level: 1 }
    const original = input(item({ enchantments: [invalid] }))
    const plan = planGrindstone(original, null)

    expect(plan).toMatchObject({
      ok: false,
      reason: 'invalid-component',
      issues: [{ path: '$.left.payload.enchantments' }],
      componentFailure: { _tag: 'ItemValidationFailure' },
    })
    expect(original.payload.enchantments).toStrictEqual([invalid])
    expect(original.payload.repairCost).toBe(0)
  })

  it('propagates an invalid component from a lone right input', () => {
    const invalid = { id: 'bad id' as AnvilEnchantment['id'], level: 1 }
    const original = input(item({ enchantments: [invalid] }))

    expect(planGrindstone(null, original)).toMatchObject({
      ok: false,
      reason: 'invalid-component',
      issues: [{ path: '$.right.payload.enchantments' }],
      componentFailure: { _tag: 'ItemValidationFailure' },
    })
    expect(original.payload.enchantments).toStrictEqual([invalid])
  })

  it('propagates right-side brand and component failures without changing either input', () => {
    const left = input(item({ enchantments: [enchantment('sharpness')] }))
    const invalidLevel = input(item({ enchantments: [enchantment('mending', 300)] }))
    const brandFailure = planGrindstone(left, invalidLevel)

    expect(brandFailure).toMatchObject({
      ok: false,
      reason: 'invalid-component',
      issues: [{ path: '$.right.payload.enchantments' }],
      componentFailure: { _tag: 'BrandError' },
    })
    expect(left.payload.enchantments).toStrictEqual([enchantment('sharpness')])
    expect(invalidLevel.payload.enchantments).toStrictEqual([enchantment('mending', 300)])

    const invalidKey = { id: 'bad id' as AnvilEnchantment['id'], level: 1 }
    const invalidComponent = input(item({ enchantments: [invalidKey] }))
    const componentFailure = planGrindstone(left, invalidComponent)

    expect(componentFailure).toMatchObject({
      ok: false,
      reason: 'invalid-component',
      issues: [{ path: '$.right.payload.enchantments' }],
      componentFailure: { _tag: 'ItemValidationFailure' },
    })
    expect(left.payload.enchantments).toStrictEqual([enchantment('sharpness')])
    expect(invalidComponent.payload.enchantments).toStrictEqual([invalidKey])

    const oversizedId = `${'x'.repeat(129)}:path` as AnvilEnchantment['id']
    const invalidBrand = input(item({ enchantments: [{ id: oversizedId, level: 1 }] }))
    const invalidBrandPlan = planGrindstone(left, invalidBrand)

    expect(invalidBrandPlan).toMatchObject({
      ok: false,
      reason: 'invalid-component',
      issues: [{ path: '$.right.payload.enchantments' }],
      componentFailure: { _tag: 'AnvilPrimitiveFailure', brand: 'AnvilEnchantmentId' },
    })
    expect(left.payload.enchantments).toStrictEqual([enchantment('sharpness')])
    expect(invalidBrand.payload.enchantments).toStrictEqual([{ id: oversizedId, level: 1 }])
  })
})

describe('W1 grindstone runtime behavior', () => {
  it('rejects empty, oversized, and unchanged inputs', () => {
    expect(planGrindstone(null, null)).toMatchObject({ ok: false, reason: 'empty-input' })
    expect(planGrindstone(input(item(), 2), null)).toMatchObject({ ok: false, reason: 'invalid-stack' })
    expect(planGrindstone(null, input(item(), 2))).toMatchObject({ ok: false, reason: 'invalid-stack' })
    expect(planGrindstone(input(item()), null)).toMatchObject({ ok: false, reason: 'nothing-to-do' })
  })

  it('plans a valid single right input', () => {
    expect(planGrindstone(null, input(item({ enchantments: [enchantment('sharpness')] })))).toMatchObject({
      ok: true,
      output: { payload: { enchantments: [], repairCost: 1 } },
    })
  })

  it('removes ordinary enchantments while preserving curses, custom name, and W1 XP cost', () => {
    const plan = planGrindstone(input(item({
      enchantments: [
        enchantment('sharpness'),
        enchantment('vanishing_curse'),
        enchantment('binding_curse'),
      ],
      repairCost: 7,
      customName: customName('Kept'),
    })), null)

    expect(plan).toStrictEqual({
      ok: true,
      output: {
        payload: {
          item: 'iron_pickaxe',
          durability: { current: 80, max: 100 },
          enchantments: [enchantment('binding_curse'), enchantment('vanishing_curse')],
          repairCost: 1,
          customName: customName('Kept'),
        },
        count: 1,
        experienceLevels: 1,
      },
    })
  })

  it('turns curse-free enchanted books into books and keeps curse-only books enchanted', () => {
    const plainBook = planGrindstone(input(item({
      item: 'enchanted_book',
      durability: null,
      enchantments: [enchantment('mending')],
    })), null)
    expect(plainBook).toMatchObject({
      ok: true,
      output: { payload: { item: 'book', enchantments: [], repairCost: 1 }, experienceLevels: 1 },
    })

    const cursedBook = planGrindstone(input(item({
      item: 'enchanted_book',
      durability: null,
      enchantments: [enchantment('binding_curse')],
    })), null)
    expect(cursedBook).toMatchObject({
      ok: true,
      output: { payload: { item: 'enchanted_book', enchantments: [enchantment('binding_curse')], repairCost: 0 } },
    })
  })

  it('rejects mismatched item types and mixed damageability', () => {
    expect(planGrindstone(input(item()), input(item({ item: 'iron_sword' })))).toMatchObject({
      ok: false,
      reason: 'incompatible-input',
    })
    expect(planGrindstone(
      input(item({ item: 'book', durability: null })),
      input(item({ item: 'book' })),
    )).toMatchObject({ ok: false, reason: 'incompatible-input' })
  })

  it('requires identical stackable non-damageable components and preserves duplicate curses once', () => {
    expect(planGrindstone(
      input(item({ item: 'enchanted_book', durability: null })),
      input(item({ item: 'enchanted_book', durability: null })),
    )).toMatchObject({ ok: false, reason: 'incompatible-input' })
    expect(planGrindstone(
      input(item({ item: 'book', durability: null, enchantments: [enchantment('sharpness')] })),
      input(item({ item: 'book', durability: null, enchantments: [enchantment('mending')] })),
    )).toMatchObject({ ok: false, reason: 'incompatible-input' })
    expect(planGrindstone(
      input(item({ item: 'book', durability: null, enchantments: [enchantment('sharpness')] })),
      input(item({ item: 'book', durability: null })),
    )).toMatchObject({ ok: false, reason: 'incompatible-input' })

    const plan = planGrindstone(
      input(item({ item: 'book', durability: null, enchantments: [enchantment('binding_curse')] })),
      input(item({ item: 'book', durability: null, enchantments: [enchantment('binding_curse')] })),
    )
    expect(plan).toMatchObject({
      ok: true,
      output: { payload: { enchantments: [enchantment('binding_curse')], repairCost: 0 }, count: 2 },
    })
  })

  it('compares repair cost and custom name for otherwise stackable inputs', () => {
    const book = (overrides: Partial<CanonicalAnvilItemPayload> = {}) =>
      item({ item: 'book', durability: null, ...overrides })

    expect(planGrindstone(input(book({ repairCost: 1 })), input(book()))).toMatchObject({
      ok: false, reason: 'incompatible-input', issues: [{ path: '$.right.components' }],
    })
    expect(planGrindstone(input(book({ customName: customName('Left') })), input(book()))).toMatchObject({
      ok: false, reason: 'incompatible-input', issues: [{ path: '$.right.components' }],
    })
    expect(planGrindstone(input(book()), input(book(), 2))).toMatchObject({
      ok: false, reason: 'invalid-stack', issues: [{ path: '$.right.count' }],
    })
  })

  it('repairs damageable items with five-percent bonus durability, merges curses, and caps damage at zero', () => {
    const plan = planGrindstone(
      input(item({
        enchantments: [enchantment('sharpness'), enchantment('binding_curse')],
        customName: customName('Kept'),
      })),
      input(item({
        durability: { current: 50, max: 120 },
        enchantments: [enchantment('mending'), enchantment('binding_curse', 3)],
      })),
    )
    expect(plan).toMatchObject({
      ok: true,
      output: {
        payload: {
          durability: { current: 24, max: 120 },
          enchantments: [enchantment('binding_curse')],
          repairCost: 3,
          customName: customName('Kept'),
        },
        experienceLevels: 3,
      },
    })

    const zeroDurability = planGrindstone(
      input(item({ durability: { current: 0, max: 100 } })),
      input(item({ durability: { current: 0, max: 100 } })),
    )
    expect(zeroDurability).toMatchObject({
      ok: true,
      output: { payload: { durability: { current: 0, max: 100 } } },
    })
  })
})
