/**
 * `excludeReservedPlacementConsumptions` — unit cases plus an INVARIANT angle.
 *
 * The repository has no property-testing library (`fast-check` is not a
 * toolchain-pinned devDependency — see mc-dev-meta's `toolchain.ts`), so the
 * invariant angle below is a hand-rolled generator: a seeded LCG produces
 * many (consumed, reserved) item-array pairs and asserts, on EVERY one, the
 * conservation and non-duplication properties the function's own doc comment
 * claims. This is the "no slot exceeds its stack limit / count is conserved"
 * style check requested for inventory-adjacent moves, adapted to this
 * function's actual domain (a positional multiset difference, not a stack).
 */
import { describe, expect, it } from '@effect/vitest'
import { excludeReservedPlacementConsumptions } from '../src/domain/placement-consumption'

describe('excludeReservedPlacementConsumptions', () => {
  it('removes one occurrence of each reserved item', () => {
    expect(excludeReservedPlacementConsumptions(['oak_planks', 'stick'], ['oak_planks'])).toStrictEqual(['stick'])
  })

  it('reserves against distinct occurrences, not the same one twice', () => {
    expect(
      excludeReservedPlacementConsumptions(['oak_planks', 'oak_planks', 'stick'], ['oak_planks']),
    ).toStrictEqual(['oak_planks', 'stick'])
  })

  it('an item with no matching reservation passes through unchanged', () => {
    expect(excludeReservedPlacementConsumptions(['stone'], ['oak_planks'])).toStrictEqual(['stone'])
  })

  it('a reservation with no matching consumed item has no effect', () => {
    expect(excludeReservedPlacementConsumptions(['stone'], ['oak_planks', 'oak_planks'])).toStrictEqual(['stone'])
  })

  it('empty consumed items yields empty output regardless of reservations', () => {
    expect(excludeReservedPlacementConsumptions([], ['oak_planks'])).toStrictEqual([])
  })

  it('empty reservations returns the consumed items unchanged (including duplicates)', () => {
    expect(excludeReservedPlacementConsumptions(['stone', 'stone'], [])).toStrictEqual(['stone', 'stone'])
  })

  it('a reservation count exceeding the consumed count only removes what exists', () => {
    expect(
      excludeReservedPlacementConsumptions(['oak_planks'], ['oak_planks', 'oak_planks', 'oak_planks']),
    ).toStrictEqual([])
  })

  it('preserves the relative order of the surviving items', () => {
    expect(
      excludeReservedPlacementConsumptions(
        ['stone', 'oak_planks', 'dirt', 'oak_planks', 'stick'],
        ['oak_planks'],
      ),
    ).toStrictEqual(['stone', 'dirt', 'oak_planks', 'stick'])
  })

  it('does not mutate its inputs', () => {
    const consumed = ['oak_planks', 'stick']
    const reserved = ['oak_planks']
    excludeReservedPlacementConsumptions(consumed, reserved)
    expect(consumed).toStrictEqual(['oak_planks', 'stick'])
    expect(reserved).toStrictEqual(['oak_planks'])
  })

  // --- Invariant angle -------------------------------------------------------

  /** A tiny seeded LCG so the generated cases are reproducible across runs. */
  const nextRandom = (seed: number): { readonly value: number; readonly seed: number } => {
    const next = (seed * 1103515245 + 12345) & 0x7fffffff
    return { value: next / 0x7fffffff, seed: next }
  }

  const ITEMS = ['stone', 'dirt', 'oak_planks', 'stick', 'cobblestone'] as const

  const randomItems = (
    seed: number,
    length: number,
  ): { readonly items: ReadonlyArray<(typeof ITEMS)[number]>; readonly seed: number } => {
    let currentSeed = seed
    const items: Array<(typeof ITEMS)[number]> = []
    for (let index = 0; index < length; index += 1) {
      const draw = nextRandom(currentSeed)
      currentSeed = draw.seed
      items.push(ITEMS[Math.floor(draw.value * ITEMS.length)] ?? 'stone')
    }
    return { items, seed: currentSeed }
  }

  const countsOf = <Item>(items: ReadonlyArray<Item>): Map<Item, number> => {
    const counts = new Map<Item, number>()
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
    return counts
  }

  it('INVARIANT (500 seeded cases): count conservation and per-item cap hold for every input', () => {
    let seed = 20260901
    for (let trial = 0; trial < 500; trial += 1) {
      const consumedDraw = randomItems(seed, 1 + (trial % 7))
      const reservedDraw = randomItems(consumedDraw.seed, trial % 5)
      seed = reservedDraw.seed
      const consumed = consumedDraw.items
      const reserved = reservedDraw.items

      const result = excludeReservedPlacementConsumptions(consumed, reserved)

      // 1. Never removes more than existed, and never adds anything: the
      //    result is a subsequence of the input.
      expect(result.length).toBeLessThanOrEqual(consumed.length)

      // 2. Per item: removed = min(consumedCount, reservedCount). Conservation
      //    holds item-by-item, not just in aggregate length.
      const consumedCounts = countsOf(consumed)
      const reservedCounts = countsOf(reserved)
      const resultCounts = countsOf(result)
      for (const [item, consumedCount] of consumedCounts) {
        const reservedCount = reservedCounts.get(item) ?? 0
        const expectedRemoved = Math.min(consumedCount, reservedCount)
        const actualRemaining = resultCounts.get(item) ?? 0
        expect(actualRemaining).toBe(consumedCount - expectedRemoved)
      }

      // 3. No item appears in the result MORE times than it did in the input
      //    (the function only ever removes, never duplicates).
      for (const [item, remaining] of resultCounts) {
        expect(remaining).toBeLessThanOrEqual(consumedCounts.get(item) ?? 0)
      }

      // 4. Idempotent against an empty reservation list, for every consumed
      //    array this trial generated.
      expect(excludeReservedPlacementConsumptions(consumed, [])).toStrictEqual(consumed)
    }
  })
})
