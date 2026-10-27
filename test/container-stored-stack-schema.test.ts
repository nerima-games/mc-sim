import { expect, it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import { ContainerStoredStackSchema } from '../src/application/inventory-service.js'
import { equipmentItem as equipmentItemResult } from '../src/domain/equipment.js'
import { itemStack as itemStackResult } from '../src/domain/inventory.js'

const itemStack = (item: Parameters<typeof itemStackResult>[0]) => {
  const result = itemStackResult(item, 1)
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const decodeStoredStack = Schema.decodeUnknownResult(ContainerStoredStackSchema)

it('decodes ordinary and damageable stored stacks with their declared durability state', () => {
  const ordinary = { ...itemStack('stone'), durability: null }
  expect(Result.isSuccess(decodeStoredStack(ordinary))).toBe(true)

  const bootsResult = equipmentItemResult(itemStack('iron_boots'))
  if (Result.isFailure(bootsResult)) throw bootsResult.failure
  expect(Result.isSuccess(decodeStoredStack(bootsResult.success))).toBe(true)
  expect(Result.isFailure(decodeStoredStack({ ...bootsResult.success, durability: null }))).toBe(true)
  expect(Result.isFailure(decodeStoredStack({
    ...bootsResult.success,
    durability: { ...bootsResult.success.durability!, max: bootsResult.success.durability!.max - 1 },
  }))).toBe(true)
})

it('rejects omitted required fields and null non-null fields', () => {
  const valid = { ...itemStack('stone'), durability: null }
  for (const key of ['item', 'count', 'components', 'durability'] as const) {
    const missing: Record<string, unknown> = { ...valid }
    delete missing[key]
    expect(Result.isFailure(decodeStoredStack(missing)), `missing ${key}`).toBe(true)
  }

  expect(Result.isFailure(decodeStoredStack({ ...valid, item: null }))).toBe(true)
  expect(Result.isFailure(decodeStoredStack({ ...valid, count: null }))).toBe(true)
  expect(Result.isFailure(decodeStoredStack({ ...valid, components: null }))).toBe(true)
  expect(Result.isSuccess(decodeStoredStack({ ...valid, durability: null }))).toBe(true)
})
