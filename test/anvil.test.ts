import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  AnvilEnchantmentId,
  type AnvilEnchantment,
  type AnvilItemPayload,
  type AnvilState,
} from '../src/domain/anvil'
import { applyVanillaAnvil, planVanillaAnvil } from '../src/domain/enchantment'

const enchantment = (id: string, level = 1): AnvilEnchantment => {
  const brandedId = AnvilEnchantmentId(id)
  if (Result.isFailure(brandedId)) throw new Error('Expected a valid fixture enchantment id')
  return { id: brandedId.success, level }
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
})
