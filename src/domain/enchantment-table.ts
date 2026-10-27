import { Result } from 'effect'
import type { ItemType } from '@nerima-games/mc-kernel'
import {
  type AnvilEnchantment,
} from './anvil.js'
import { anvilEnchantmentIdFromValidated } from './anvil-primitives.js'
import {
  enchantmentAppliesTo,
  enchantmentsConflict,
} from './enchantment.js'
import {
  ENCHANTMENT_TABLE_BOOK,
  ENCHANTMENT_TABLE_MAX_BOOKSHELVES,
  enchantmentTableRuleFor,
  itemEnchantabilityOf,
  type EnchantmentTableCost,
  type EnchantmentTableItem,
  type EnchantmentTableRuleId,
} from './enchantment-table-data.js'
import { SUPPORTED_VANILLA_ENCHANTMENT_IDS } from './enchantment-data.js'
import { assertRandomInteger, weightedCandidate } from './enchantment-table-selection.js'

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

export type EnchantmentTableFailure = Readonly<{
  readonly _tag: 'EnchantmentTableFailure'
  readonly reason:
    | 'invalid-level'
    | 'invalid-bookshelf-count'
    | 'invalid-slot'
    | 'invalid-random-integer'
    | 'invalid-random-float'
    | 'empty-candidate-set'
  readonly value: unknown
  readonly message: string
}>

export type EnchantmentTableError = EnchantmentTableFailure

type Candidate = Readonly<{
  readonly id: EnchantmentTableRuleId
  readonly level: number
  readonly weight: number
}>

const failure = (
  reason: EnchantmentTableFailure['reason'],
  value: unknown,
  message: string,
): Result.Result<never, EnchantmentTableFailure> => Result.fail({
  _tag: 'EnchantmentTableFailure',
  reason,
  value,
  message,
})

const costAtLevelUnchecked = (cost: EnchantmentTableCost, level: number): number =>
  cost.base + cost.perLevelAboveFirst * (level - 1)

const assertRandomFloat = (random: EnchantmentTableRandom): Result.Result<number, EnchantmentTableFailure> => {
  const value = random.nextFloat()
  return Number.isFinite(value) && value >= 0 && value < 1
    ? Result.succeed(value)
    : failure('invalid-random-float', value, 'Random float must be finite and in [0, 1)')
}

const normalizeBookshelfCount = (bookshelfCount: number): Result.Result<number, EnchantmentTableFailure> =>
  Number.isSafeInteger(bookshelfCount)
    ? Result.succeed(Math.min(ENCHANTMENT_TABLE_MAX_BOOKSHELVES, Math.max(0, bookshelfCount)))
    : failure('invalid-bookshelf-count', bookshelfCount, 'Bookshelf count must be a safe integer')

const isEnchantmentTableSlot = (slot: number): slot is EnchantmentTableSlot =>
  slot === 0 || slot === 1 || slot === 2

const powerAtSlot = (power: number, slot: EnchantmentTableSlot, bookshelfCount: number): number => {
  const powers: readonly [number, number, number] = [
    Math.max(Math.floor(power / 3), 1),
    Math.floor((power * 2) / 3) + 1,
    Math.max(power, bookshelfCount * 2),
  ]
  return powers[slot]
}

const lapisCostAtSlot = (slot: EnchantmentTableSlot): 1 | 2 | 3 => {
  const costs: readonly [1, 2, 3] = [1, 2, 3]
  return costs[slot]
}

export const enchantmentTableCostAtLevel = (
  cost: EnchantmentTableCost,
  level: number,
): Result.Result<number, EnchantmentTableFailure> =>
  Number.isSafeInteger(level) && level >= 1
    ? Result.succeed(costAtLevelUnchecked(cost, level))
    : failure('invalid-level', level, 'Enchantment level must be a positive safe integer')

export const calculateEnchantmentTableLevelCost = ({
  item,
  bookshelfCount: rawBookshelfCount,
  random,
  slot,
}: CalculateEnchantmentTableLevelCostInput): Result.Result<number, EnchantmentTableFailure> => {
  const normalized = normalizeBookshelfCount(rawBookshelfCount)
  if (Result.isFailure(normalized)) return normalized
  if (!isEnchantmentTableSlot(slot)) {
    return failure('invalid-slot', slot, `Invalid enchantment table slot: ${String(slot)}`)
  }
  const bookshelfCount = normalized.success
  const enchantability = itemEnchantabilityOf(item)
  if (enchantability === 0) return Result.succeed(0)

  const firstRandom = assertRandomInteger(random, 8)
  if (Result.isFailure(firstRandom)) return firstRandom
  const secondRandom = assertRandomInteger(random, bookshelfCount + 1)
  if (Result.isFailure(secondRandom)) return secondRandom

  const power = firstRandom.success + 1 + (bookshelfCount >> 1) + secondRandom.success
  return Result.succeed(powerAtSlot(power, slot, bookshelfCount))
}

const candidatesFor = (item: EnchantmentTableItem, power: number): ReadonlyArray<Candidate> => {
  const candidates: Candidate[] = []

  for (const id of SUPPORTED_VANILLA_ENCHANTMENT_IDS) {
    const rule = enchantmentTableRuleFor(id)
    if (rule.treasureOnly) continue
    if (item !== ENCHANTMENT_TABLE_BOOK && !enchantmentAppliesTo(id, item)) continue

    for (let level = rule.maxLevel; level >= 1; level -= 1) {
      const minCost = costAtLevelUnchecked(rule.minCost, level)
      const maxCost = costAtLevelUnchecked(rule.maxCost, level)
      if (power < minCost || power > maxCost) continue
      candidates.push({ id, level, weight: rule.weight })
      break
    }
  }

  return candidates
}

const selectEnchantments = (
  candidates: ReadonlyArray<Candidate>,
  power: number,
  random: EnchantmentTableRandom,
): Result.Result<ReadonlyArray<AnvilEnchantment>, EnchantmentTableError> => {
  if (candidates.length === 0) return Result.succeed([])

  const remaining = [...candidates]
  const selected: AnvilEnchantment[] = []
  let currentPower = power

  while (remaining.length > 0) {
    const selectedCandidate = weightedCandidate(remaining, random)
    if (Result.isFailure(selectedCandidate)) return Result.fail(selectedCandidate.failure)

    const candidate = selectedCandidate.success
    selected.push({ id: anvilEnchantmentIdFromValidated(candidate.id), level: candidate.level })

    const nextRemaining = remaining.filter(
      (entry) => entry.id !== candidate.id && !enchantmentsConflict(entry.id, candidate.id),
    )
    if (nextRemaining.length === 0) break

    const continuation = assertRandomInteger(random, 50)
    if (Result.isFailure(continuation)) return Result.fail(continuation.failure)
    if (continuation.success > currentPower) break

    remaining.splice(0, remaining.length, ...nextRemaining)
    currentPower = Math.floor(currentPower / 2)
  }

  return Result.succeed(selected)
}

const offerAtSlot = (
  item: EnchantmentTableItem,
  bookshelfCount: number,
  slot: EnchantmentTableSlot,
  random: EnchantmentTableRandom,
): Result.Result<EnchantmentTableOffer, EnchantmentTableError> => {
  const levelCost = calculateEnchantmentTableLevelCost({ item, bookshelfCount, random, slot })
  if (Result.isFailure(levelCost)) return Result.fail(levelCost.failure)
  const enchantability = itemEnchantabilityOf(item)

  const firstBonus = assertRandomInteger(random, Math.floor(enchantability / 4) + 1)
  if (Result.isFailure(firstBonus)) return Result.fail(firstBonus.failure)
  const secondBonus = assertRandomInteger(random, Math.floor(enchantability / 4) + 1)
  if (Result.isFailure(secondBonus)) return Result.fail(secondBonus.failure)
  const firstFloat = assertRandomFloat(random)
  if (Result.isFailure(firstFloat)) return Result.fail(firstFloat.failure)
  const secondFloat = assertRandomFloat(random)
  if (Result.isFailure(secondFloat)) return Result.fail(secondFloat.failure)

  const bonus = 1 + firstBonus.success + secondBonus.success
  const variation = (firstFloat.success + secondFloat.success - 1) * 0.15
  const modifiedLevelCost = Math.min(
    30,
    Math.max(1, Math.round(levelCost.success + levelCost.success * variation + bonus)),
  )
  const enchantments = selectEnchantments(candidatesFor(item, modifiedLevelCost), modifiedLevelCost, random)
  if (Result.isFailure(enchantments)) return Result.fail(enchantments.failure)

  return Result.succeed({
    levelCost: modifiedLevelCost,
    lapisCost: lapisCostAtSlot(slot),
    enchantments: enchantments.success,
  })
}

export const generateEnchantmentTableOffers = ({
  item,
  bookshelfCount: rawBookshelfCount,
  random,
}: GenerateEnchantmentOffersInput): Result.Result<EnchantmentTableOffers, EnchantmentTableError> => {
  const normalized = normalizeBookshelfCount(rawBookshelfCount)
  if (Result.isFailure(normalized)) return Result.fail(normalized.failure)
  const bookshelfCount = normalized.success
  if (itemEnchantabilityOf(item) === 0) return Result.succeed([undefined, undefined, undefined])

  const offers: [
    EnchantmentTableOffer | undefined,
    EnchantmentTableOffer | undefined,
    EnchantmentTableOffer | undefined,
  ] = [undefined, undefined, undefined]
  const slots: ReadonlyArray<EnchantmentTableSlot> = [0, 1, 2]
  for (const slot of slots) {
    const offer = offerAtSlot(item, bookshelfCount, slot, random)
    if (Result.isFailure(offer)) return Result.fail(offer.failure)
    offers[slot] = offer.success
  }
  return Result.succeed(offers)
}

export const enchantmentTableOutputItemOf = (item: EnchantmentTableItem): ItemType =>
  item === ENCHANTMENT_TABLE_BOOK ? 'enchanted_book' : item
