import type { AnvilEnchantment } from './anvil.js'

const compareIds = (left: AnvilEnchantment, right: AnvilEnchantment): number =>
  Number(left.id > right.id) - Number(left.id < right.id)

export const canonicalEnchantments = (
  enchantments: ReadonlyArray<AnvilEnchantment>,
): ReadonlyArray<AnvilEnchantment> =>
  [...enchantments].sort(compareIds).map(({ id, level }) => ({ id, level }))
