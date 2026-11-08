import fc from 'fast-check'
import { BlockAxis, blockPosition } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  countEnchantmentTableBookshelves,
  type EnchantmentTableBlockPower,
} from '../src/domain/enchantment-table.js'

const ringOffsets = [
  [-2, -2], [-2, 0], [-2, 2],
  [0, -2], [0, 2],
  [2, -2], [2, 0], [2, 2],
] as const

const keyOf = ({ x, y, z }: Readonly<{ x: number; y: number; z: number }>): string => `${x},${y},${z}`
const positionAt = (x: number, y: number, z: number) =>
  blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))

const blockPowerAtFor = (shelves: readonly boolean[], openGaps: readonly boolean[]) => {
  const blocks = new Map<string, EnchantmentTableBlockPower>()
  ringOffsets.forEach(([dx, dz], index) => {
    const gapX = dx / 2
    const gapZ = dz / 2
    for (const gapY of [0, 1]) {
      blocks.set(keyOf({ x: gapX, y: gapY, z: gapZ }), openGaps[index]
        ? { _tag: 'Air' }
        : { _tag: 'Block', bookshelfPower: 0 })
    }
    for (const shelfY of [0, 1]) {
      const shelfIndex = index * 2 + shelfY
      if (shelves[shelfIndex]) {
        blocks.set(keyOf({ x: dx, y: shelfY, z: dz }), { _tag: 'Block', bookshelfPower: 1 })
      }
    }
  })

  return ({ x, y, z }: Readonly<{ x: number; y: number; z: number }>): EnchantmentTableBlockPower =>
    blocks.get(keyOf({ x, y, z })) ?? { _tag: 'Block', bookshelfPower: 0 }
}

const unwrap = (value: ReturnType<typeof countEnchantmentTableBookshelves>): number => {
  if (Result.isFailure(value)) throw value.failure
  return value.success
}

describe('enchantment table bookshelf power', () => {
  it('clamps the 15 and 16 bookshelf boundaries', () => {
    const openGaps = ringOffsets.map(() => true)
    const fifteenShelves = Array.from({ length: 16 }, (_, index) => index < 15)
    const sixteenShelves = Array.from({ length: 16 }, () => true)

    expect(unwrap(countEnchantmentTableBookshelves({
      tablePosition: positionAt(0, 0, 0),
      blockPowerAt: blockPowerAtFor(fifteenShelves, openGaps),
    }))).toBe(15)
    expect(unwrap(countEnchantmentTableBookshelves({
      tablePosition: positionAt(0, 0, 0),
      blockPowerAt: blockPowerAtFor(sixteenShelves, openGaps),
    }))).toBe(15)
  })

  it('counts generated layouts using an independent ring calculation', () => {
    const layout = fc.record({
      shelves: fc.array(fc.boolean(), { minLength: 16, maxLength: 16 }),
      openGaps: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
    })

    fc.assert(fc.property(layout, ({ shelves, openGaps }) => {
      const expected = Math.min(15, shelves.reduce((count, hasShelf, index) =>
        count + Number(hasShelf) * Number(openGaps[Math.floor(index / 2)]), 0))
      const actual = countEnchantmentTableBookshelves({
        tablePosition: positionAt(0, 0, 0),
        blockPowerAt: blockPowerAtFor(shelves, openGaps),
      })

      expect(Result.isSuccess(actual)).toBe(true)
      if (Result.isSuccess(actual)) expect(actual.success).toBe(expected)
    }))
  })

  it('does not count shelves whose one-block air gap is obstructed', () => {
    const shelves = Array.from({ length: 16 }, () => false)
    shelves[0] = true
    const openGaps = ringOffsets.map((_, index) => index !== 0)

    expect(unwrap(countEnchantmentTableBookshelves({
      tablePosition: positionAt(0, 0, 0),
      blockPowerAt: blockPowerAtFor(shelves, openGaps),
    }))).toBe(0)
  })

  it('returns failures for positions that overflow the ring and invalid block power', () => {
    const invalidPosition = countEnchantmentTableBookshelves({
      tablePosition: positionAt(Number.MAX_SAFE_INTEGER, 0, 0),
      blockPowerAt: () => ({ _tag: 'Air' }),
    })
    expect(invalidPosition).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'EnchantmentTableBookshelfFailure',
        reason: 'invalid-table-position',
        message: 'Table position must leave room for a safe integer two-block ring',
      },
    })

    const invalidBlockPower = countEnchantmentTableBookshelves({
      tablePosition: positionAt(0, 0, 0),
      blockPowerAt: () => null as never,
    })
    expect(invalidBlockPower).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'EnchantmentTableBookshelfFailure',
        reason: 'invalid-block-power',
        message: 'Block power must describe air or bookshelf power 0 or 1',
      },
    })
  })
})
