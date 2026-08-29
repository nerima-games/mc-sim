import {
  AnvilEnchantmentId,
  type AnvilEnchantment,
  type ItemType,
} from '@nerima-games/mc-kernel'

import {
  enchantmentAppliesTo,
  enchantmentsConflict,
} from './enchantment'
import {
  ENCHANTMENT_TABLE_BOOK,
  ENCHANTMENT_TABLE_MAX_BOOKSHELVES,
  ENCHANTMENT_TABLE_SLOT_COUNT,
  enchantmentTableRuleFor,
  itemEnchantabilityOf,
  type EnchantmentTableCost,
  type EnchantmentTableItem,
  type EnchantmentTableRuleId,
} from './enchantment-table-data'
import { SUPPORTED_VANILLA_ENCHANTMENT_IDS } from './enchantment-data'

export type EnchantmentTableRandom = Readonly<{
  readonly nextInt: (bound: number) => number
  readonly nextFloat: () => number
}>

export type EnchantmentTableOffer = Readonly<{
  readonly levelCost: number
  readonly lapisCost: 1 | 2 | 3
  readonly enchantments: ReadonlyArray<AnvilEnchantment>
}>

export type EnchantmentTableOffers = readonly [
  EnchantmentTableOffer | undefined,
  EnchantmentTableOffer | undefined,
  EnchantmentTableOffer | undefined,
]

export type EnchantmentTableSlot = 0 | 1 | 2

export type CalculateEnchantmentTableLevelCostInput = Readonly<{
  readonly item: EnchantmentTableItem
  readonly bookshelfCount: number
  readonly random: EnchantmentTableRandom
  readonly slot: EnchantmentTableSlot
}>

export type GenerateEnchantmentOffersInput = Readonly<{
  readonly item: EnchantmentTableItem
  readonly bookshelfCount: number
  readonly random: EnchantmentTableRandom
}>

type Candidate = Readonly<{
  readonly id: EnchantmentTableRuleId
  readonly level: number
  readonly weight: number
}>

const assertRandomInteger = (
  random: EnchantmentTableRandom,
  bound: number,
): number => {
  const value = random.nextInt(bound)
  if (!Number.isSafeInteger(value) || value < 0 || value >= bound) {
    throw new RangeError(`Random integer is outside [0, ${bound}): ${String(value)}`)
  }
  return value
}

const assertRandomFloat = (random: EnchantmentTableRandom): number => {
  const value = random.nextFloat()
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError(`Random float must be finite and in [0, 1): ${String(value)}`)
  }
  return value
}

const normalizeBookshelfCount = (bookshelfCount: number): number => {
  if (!Number.isSafeInteger(bookshelfCount)) {
    throw new RangeError(`Bookshelf count must be a safe integer: ${String(bookshelfCount)}`)
  }
  return Math.min(ENCHANTMENT_TABLE_MAX_BOOKSHELVES, Math.max(0, bookshelfCount))
}

const assertEnchantmentTableSlot: (slot: number) => asserts slot is EnchantmentTableSlot = (slot) => {
  if (slot !== 0 && slot !== 1 && slot !== 2) {
    throw new RangeError(`Invalid enchantment table slot: ${String(slot)}`)
  }
}

const powerAtSlot = (power: number, slot: EnchantmentTableSlot, bookshelfCount: number): number => {
  const powers: readonly [number, number, number] = [
    Math.max(Math.floor(power / 3), 1),
    Math.floor((power * 2) / 3) + 1,
    Math.max(power, bookshelfCount * 2),
  ]
  return powers[slot]
}

const lapisCostAtSlot = (slot: EnchantmentTableSlot): 1 | 2 | 3 => (slot + 1) as 1 | 2 | 3

export const enchantmentTableCostAtLevel = (
  cost: EnchantmentTableCost,
  level: number,
): number => {
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new RangeError(`Enchantment level must be a positive safe integer: ${String(level)}`)
  }
  return cost.base + cost.perLevelAboveFirst * (level - 1)
}

export const calculateEnchantmentTableLevelCost = ({
  item,
  bookshelfCount: rawBookshelfCount,
  random,
  slot,
}: CalculateEnchantmentTableLevelCostInput): number => {
  const bookshelfCount = normalizeBookshelfCount(rawBookshelfCount)
  assertEnchantmentTableSlot(slot)
  const enchantability = itemEnchantabilityOf(item)
  if (enchantability === 0) return 0

  const power =
    assertRandomInteger(random, 8) +
    1 +
    (bookshelfCount >> 1) +
    assertRandomInteger(random, bookshelfCount + 1)
  return powerAtSlot(power, slot, bookshelfCount)
}

const candidatesFor = (item: EnchantmentTableItem, power: number): ReadonlyArray<Candidate> => {
  const candidates: Candidate[] = []

  for (const id of SUPPORTED_VANILLA_ENCHANTMENT_IDS) {
    const rule = enchantmentTableRuleFor(id)
    if (rule.treasureOnly) continue
    if (item !== ENCHANTMENT_TABLE_BOOK && !enchantmentAppliesTo(id, item)) continue

    for (let level = rule.maxLevel; level >= 1; level -= 1) {
      const minCost = enchantmentTableCostAtLevel(rule.minCost, level)
      const maxCost = enchantmentTableCostAtLevel(rule.maxCost, level)
      if (power < minCost || power > maxCost) continue
      candidates.push({ id, level, weight: rule.weight })
      break
    }
  }

  return candidates
}

const weightedCandidate = (
  candidates: ReadonlyArray<Candidate>,
  random: EnchantmentTableRandom,
): Candidate => {
  const totalWeight = candidates.reduce((total, candidate) => total + candidate.weight, 0)
  let remainingWeight = assertRandomInteger(random, totalWeight)

  let candidateIndex = 0
  while (
    candidateIndex < candidates.length - 1 &&
    remainingWeight >= candidates[candidateIndex]!.weight
  ) {
    remainingWeight -= candidates[candidateIndex]!.weight
    candidateIndex += 1
  }
  return candidates[candidateIndex]!
}

const selectEnchantments = (
  candidates: ReadonlyArray<Candidate>,
  power: number,
  random: EnchantmentTableRandom,
): ReadonlyArray<AnvilEnchantment> => {
  if (candidates.length === 0) return []

  const remaining = [...candidates]
  const selected: AnvilEnchantment[] = []
  let currentPower = power

  while (remaining.length > 0) {
    const candidate = weightedCandidate(remaining, random)
    selected.push({ id: AnvilEnchantmentId(candidate.id), level: candidate.level })

    const nextRemaining = remaining.filter(
      (entry) => entry.id !== candidate.id && !enchantmentsConflict(entry.id, candidate.id),
    )
    if (assertRandomInteger(random, 50) > currentPower || nextRemaining.length === 0) break
    remaining.splice(0, remaining.length, ...nextRemaining)
    currentPower = Math.floor(currentPower / 2)
  }

  return selected
}

const offerAtSlot = (
  item: EnchantmentTableItem,
  bookshelfCount: number,
  slot: EnchantmentTableSlot,
  random: EnchantmentTableRandom,
): EnchantmentTableOffer => {
  const levelCost = calculateEnchantmentTableLevelCost({ item, bookshelfCount, random, slot })
  const enchantability = itemEnchantabilityOf(item)
  const bonus =
    1 +
    assertRandomInteger(random, Math.floor(enchantability / 4) + 1) +
    assertRandomInteger(random, Math.floor(enchantability / 4) + 1)
  const variation = (assertRandomFloat(random) + assertRandomFloat(random) - 1) * 0.15
  const modifiedLevelCost = Math.min(
    30,
    Math.max(1, Math.round(levelCost + levelCost * variation + bonus)),
  )

  return {
    levelCost: modifiedLevelCost,
    lapisCost: lapisCostAtSlot(slot),
    enchantments: selectEnchantments(candidatesFor(item, modifiedLevelCost), modifiedLevelCost, random),
  }
}

export const generateEnchantmentTableOffers = ({
  item,
  bookshelfCount: rawBookshelfCount,
  random,
}: GenerateEnchantmentOffersInput): EnchantmentTableOffers => {
  const bookshelfCount = normalizeBookshelfCount(rawBookshelfCount)
  if (itemEnchantabilityOf(item) === 0) return [undefined, undefined, undefined]

  const offers: [
    EnchantmentTableOffer | undefined,
    EnchantmentTableOffer | undefined,
    EnchantmentTableOffer | undefined,
  ] = [undefined, undefined, undefined]
  for (let slot = 0; slot < ENCHANTMENT_TABLE_SLOT_COUNT; slot += 1) {
    offers[slot as EnchantmentTableSlot] = offerAtSlot(
      item,
      bookshelfCount,
      slot as EnchantmentTableSlot,
      random,
    )
  }
  return offers
}

export const enchantmentTableOutputItemOf = (item: EnchantmentTableItem): ItemType =>
  item === ENCHANTMENT_TABLE_BOOK ? 'enchanted_book' : item
