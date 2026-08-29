import { describe, expect, it } from 'vitest'

import {
  ENCHANTMENT_TABLE_BOOK,
  ENCHANTMENT_TABLE_MAX_BOOKSHELVES,
  ENCHANTMENT_TABLE_SLOT_COUNT,
  ENCHANTMENT_TABLE_ITEM_ENCHANTABILITY,
  VANILLA_ENCHANTMENT_TABLE_RULES,
  enchantmentTableRuleFor,
  isEnchantmentTableRuleId,
  itemEnchantabilityOf,
} from '../src/domain/enchantment-table-data'
import { SUPPORTED_VANILLA_ENCHANTMENT_IDS } from '../src/domain/enchantment-data'
import {
  calculateEnchantmentTableLevelCost,
  enchantmentTableCostAtLevel,
  enchantmentTableOutputItemOf,
  generateEnchantmentTableOffers,
  type EnchantmentTableRandom,
} from '../src/domain/enchantment-table'

const zeroRandom = (): EnchantmentTableRandom => ({
  nextInt: () => 0,
  nextFloat: () => 0,
})

const maxRandom = (): EnchantmentTableRandom => ({
  nextInt: (bound) => bound - 1,
  nextFloat: () => 0.5,
})

const lastCandidateRandom = (): EnchantmentTableRandom => ({
  nextInt: (bound) => (bound === 50 ? bound - 1 : 0),
  nextFloat: () => 0,
})

const highPowerZeroRandom = (): EnchantmentTableRandom => ({
  nextInt: (bound) => {
    if (bound === 8) return 7
    if (bound === ENCHANTMENT_TABLE_MAX_BOOKSHELVES + 1) return ENCHANTMENT_TABLE_MAX_BOOKSHELVES
    return 0
  },
  nextFloat: () => 0,
})

describe('enchantment table data', () => {
  it('keeps one official rule per kernel-supported enchantment id', () => {
    expect(Object.keys(VANILLA_ENCHANTMENT_TABLE_RULES).sort()).toStrictEqual(
      [...SUPPORTED_VANILLA_ENCHANTMENT_IDS].sort(),
    )
    expect(Object.keys(VANILLA_ENCHANTMENT_TABLE_RULES)).toHaveLength(32)
    expect(ENCHANTMENT_TABLE_SLOT_COUNT).toBe(3)
    expect(enchantmentTableRuleFor('protection')).toStrictEqual({
      maxLevel: 4,
      weight: 10,
      minCost: { base: 1, perLevelAboveFirst: 11 },
      maxCost: { base: 12, perLevelAboveFirst: 11 },
      treasureOnly: false,
    })
    expect(isEnchantmentTableRuleId('sharpness')).toBe(true)
    expect(isEnchantmentTableRuleId('minecraft:sharpness')).toBe(false)
    expect(isEnchantmentTableRuleId(null)).toBe(false)
    expect(isEnchantmentTableRuleId(3)).toBe(false)
  })

  it('stores enchantability for supported table inputs', () => {
    expect(ENCHANTMENT_TABLE_ITEM_ENCHANTABILITY.iron_sword).toBe(14)
    expect(itemEnchantabilityOf(ENCHANTMENT_TABLE_BOOK)).toBe(1)
    expect(itemEnchantabilityOf('dirt')).toBe(0)
  })
})

describe('enchantment table level calculation', () => {
  it('calculates the three slot powers and clamps bookshelf counts', () => {
    expect(enchantmentTableCostAtLevel({ base: 5, perLevelAboveFirst: 8 }, 3)).toBe(21)
    expect(
      calculateEnchantmentTableLevelCost({
        item: ENCHANTMENT_TABLE_BOOK,
        bookshelfCount: 0,
        random: zeroRandom(),
        slot: 0,
      }),
    ).toBe(1)
    expect(
      calculateEnchantmentTableLevelCost({
        item: ENCHANTMENT_TABLE_BOOK,
        bookshelfCount: 0,
        random: zeroRandom(),
        slot: 1,
      }),
    ).toBe(1)
    expect(
      calculateEnchantmentTableLevelCost({
        item: ENCHANTMENT_TABLE_BOOK,
        bookshelfCount: 0,
        random: zeroRandom(),
        slot: 2,
      }),
    ).toBe(1)

    expect(
      calculateEnchantmentTableLevelCost({
        item: ENCHANTMENT_TABLE_BOOK,
        bookshelfCount: ENCHANTMENT_TABLE_MAX_BOOKSHELVES,
        random: maxRandom(),
        slot: 0,
      }),
    ).toBe(10)
    expect(
      calculateEnchantmentTableLevelCost({
        item: ENCHANTMENT_TABLE_BOOK,
        bookshelfCount: ENCHANTMENT_TABLE_MAX_BOOKSHELVES,
        random: maxRandom(),
        slot: 1,
      }),
    ).toBe(21)
    expect(
      calculateEnchantmentTableLevelCost({
        item: ENCHANTMENT_TABLE_BOOK,
        bookshelfCount: ENCHANTMENT_TABLE_MAX_BOOKSHELVES,
        random: maxRandom(),
        slot: 2,
      }),
    ).toBe(30)
    expect(
      calculateEnchantmentTableLevelCost({
        item: ENCHANTMENT_TABLE_BOOK,
        bookshelfCount: -4,
        random: zeroRandom(),
        slot: 2,
      }),
    ).toBe(1)
    expect(
      calculateEnchantmentTableLevelCost({
        item: ENCHANTMENT_TABLE_BOOK,
        bookshelfCount: ENCHANTMENT_TABLE_MAX_BOOKSHELVES + 5,
        random: maxRandom(),
        slot: 2,
      }),
    ).toBe(30)
    expect(
      calculateEnchantmentTableLevelCost({
        item: 'dirt',
        bookshelfCount: 0,
        random: zeroRandom(),
        slot: 0,
      }),
    ).toBe(0)
  })

  it('rejects invalid levels, bookshelf counts, slots, and random integers', () => {
    expect(() => enchantmentTableCostAtLevel({ base: 1, perLevelAboveFirst: 1 }, 0)).toThrow(RangeError)
    expect(() => enchantmentTableCostAtLevel({ base: 1, perLevelAboveFirst: 1 }, 1.5)).toThrow(RangeError)
    expect(() => enchantmentTableCostAtLevel({ base: 1, perLevelAboveFirst: 1 }, Number.NaN)).toThrow(RangeError)
    expect(() =>
      calculateEnchantmentTableLevelCost({
        item: ENCHANTMENT_TABLE_BOOK,
        bookshelfCount: 1.5,
        random: zeroRandom(),
        slot: 0,
      }),
    ).toThrow(RangeError)
    expect(() =>
      calculateEnchantmentTableLevelCost({
        item: ENCHANTMENT_TABLE_BOOK,
        bookshelfCount: Number.POSITIVE_INFINITY,
        random: zeroRandom(),
        slot: 0,
      }),
    ).toThrow(RangeError)
    expect(() =>
      calculateEnchantmentTableLevelCost({
        item: ENCHANTMENT_TABLE_BOOK,
        bookshelfCount: 0,
        random: zeroRandom(),
        slot: 3 as 0,
      }),
    ).toThrow(RangeError)

    for (const nextInt of [-1, 8, 1.5, Number.NaN]) {
      expect(() =>
        calculateEnchantmentTableLevelCost({
          item: ENCHANTMENT_TABLE_BOOK,
          bookshelfCount: 0,
          random: { nextInt: () => nextInt, nextFloat: () => 0 },
          slot: 0,
        }),
      ).toThrow(RangeError)
    }
  })
})

describe('enchantment table offers', () => {
  it('returns empty slots for unchantable inputs and maps book output', () => {
    expect(
      generateEnchantmentTableOffers({ item: 'dirt', bookshelfCount: 0, random: zeroRandom() }),
    ).toStrictEqual([undefined, undefined, undefined])
    expect(enchantmentTableOutputItemOf(ENCHANTMENT_TABLE_BOOK)).toBe('enchanted_book')
    expect(enchantmentTableOutputItemOf('bow')).toBe('bow')
  })

  it('generates weighted, non-treasure book offers with lapis costs', () => {
    const offers = generateEnchantmentTableOffers({
      item: ENCHANTMENT_TABLE_BOOK,
      bookshelfCount: 0,
      random: zeroRandom(),
    })

    expect(offers).toHaveLength(ENCHANTMENT_TABLE_SLOT_COUNT)
    expect(offers.map((offer) => offer?.lapisCost)).toStrictEqual([1, 2, 3])
    for (const offer of offers) {
      expect(offer).toBeDefined()
      if (offer === undefined) continue
      expect(offer.levelCost).toBeGreaterThanOrEqual(1)
      expect(offer.enchantments.length).toBeGreaterThan(0)
      expect(
        offer.enchantments.every(
          ({ id }) => isEnchantmentTableRuleId(id) && !enchantmentTableRuleFor(id).treasureOnly,
        ),
      ).toBe(true)
    }

    const lastCandidateOffer = generateEnchantmentTableOffers({
      item: ENCHANTMENT_TABLE_BOOK,
      bookshelfCount: 0,
      random: lastCandidateRandom(),
    })[0]
    expect(lastCandidateOffer?.enchantments).toHaveLength(1)
  })

  it('handles no matching candidate, early random stop, and exhausted conflicts', () => {
    const lowRodOffers = generateEnchantmentTableOffers({
      item: 'fishing_rod',
      bookshelfCount: 0,
      random: zeroRandom(),
    })
    expect(lowRodOffers.every((offer) => offer?.enchantments.length === 0)).toBe(true)

    const highSwordOffers = generateEnchantmentTableOffers({
      item: 'iron_sword',
      bookshelfCount: ENCHANTMENT_TABLE_MAX_BOOKSHELVES,
      random: maxRandom(),
    })
    expect(highSwordOffers.every((offer) => offer !== undefined && offer.enchantments.length === 1)).toBe(true)

    const flintAndSteelOffers = generateEnchantmentTableOffers({
      item: 'flint_and_steel',
      bookshelfCount: ENCHANTMENT_TABLE_MAX_BOOKSHELVES,
      random: highPowerZeroRandom(),
    })
    expect(flintAndSteelOffers.every((offer) => offer?.enchantments.length === 1)).toBe(true)
  })

  it('rejects invalid random floats', () => {
    for (const nextFloat of [Number.NaN, -0.1, 1]) {
      expect(() =>
        generateEnchantmentTableOffers({
          item: 'iron_sword',
          bookshelfCount: 0,
          random: { nextInt: () => 0, nextFloat: () => nextFloat },
        }),
      ).toThrow(RangeError)
    }
  })
})
