import { Result } from 'effect'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import {
  BlockAxis,
  NonNegativeTickCount,
  blockPosition,
  secondsForTicks,
  VANILLA_CRAFTING_RECIPES as KernelCraftingRecipes,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import * as Sim from '../src/index.js'
import { invoke } from './public-property-helpers.js'

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const ironFurnace = must(Sim.furnaceState({
  input: must(Sim.itemStack('iron_ore', 1)),
  fuel: must(Sim.itemStack('coal', 1)),
}))

const bookshelfRingOffsets = [
  [-2, -2], [-2, 0], [-2, 2],
  [0, -2], [0, 2],
  [2, -2], [2, 0], [2, 2],
] as const

const positionKey = ({ x, y, z }: BlockPosition): string => `${x},${y},${z}`
const at = (x: number, y: number, z: number) => blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))

const bookshelfPowerAtFor = (
  tablePosition: BlockPosition,
  shelves: readonly boolean[],
  openGaps: readonly boolean[],
): Sim.EnchantmentTableBlockPowerAt => {
  const blocks = new Map<string, Sim.EnchantmentTableBlockPower>()
  bookshelfRingOffsets.forEach(([dx, dz], index) => {
    for (const dy of [0, 1]) {
      blocks.set(positionKey(at(
        tablePosition.x + dx / 2,
        tablePosition.y + dy,
        tablePosition.z + dz / 2,
      )), openGaps[index] ? { _tag: 'Air' } : { _tag: 'Block', bookshelfPower: 0 })
      const shelfIndex = index * 2 + dy
      if (shelves[shelfIndex]) {
        blocks.set(positionKey(at(
          tablePosition.x + dx,
          tablePosition.y + dy,
          tablePosition.z + dz,
        )), { _tag: 'Block', bookshelfPower: 1 })
      }
    }
  })

  return (position) => blocks.get(positionKey(position)) ?? { _tag: 'Block', bookshelfPower: 0 }
}

it('publishes the kernel crafting table from the root API', () => {
  expect(Sim.VANILLA_CRAFTING_RECIPES).toBe(KernelCraftingRecipes)
})

it('public furnace tick advancement agrees with seconds at 20 ticks per second', () => {
  expect(Sim.TICKS_PER_SECOND).toBe(20)
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 400 }), (elapsedTicks) => {
      const elapsedSecs = must(secondsForTicks(NonNegativeTickCount(elapsedTicks)))
      expect(Sim.advanceFurnaceTicks(ironFurnace, NonNegativeTickCount(elapsedTicks))).toStrictEqual(
        Sim.advanceFurnace(ironFurnace, elapsedSecs),
      )
    }),
    { numRuns: 64, seed: 0x50554246 },
  )
})

it('public furnace tick advancement accepts 0 and 1 and rejects invalid tick counts', () => {
  expect(Result.isSuccess(Sim.advanceFurnaceTicks(ironFurnace, NonNegativeTickCount(0)))).toBe(true)
  expect(Result.isSuccess(Sim.advanceFurnaceTicks(ironFurnace, NonNegativeTickCount(1)))).toBe(true)

  for (const elapsedTicks of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const result = invoke(Sim.advanceFurnaceTicks, [ironFurnace, elapsedTicks])
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'FurnaceStateValidationFailure',
        path: 'elapsedTicks',
      },
    })
  }
})

it('public bookshelf counting matches an independent calculation for generated layouts', () => {
  const layout = fc.record({
    x: fc.integer({ min: -32, max: 32 }),
    y: fc.integer({ min: -32, max: 32 }),
    z: fc.integer({ min: -32, max: 32 }),
    shelves: fc.array(fc.boolean(), { minLength: 16, maxLength: 16 }),
    openGaps: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
  })

  fc.assert(fc.property(layout, ({ x, y, z, shelves, openGaps }) => {
    const tablePosition = at(x, y, z)
    const expected = Math.min(15, shelves.reduce((count, hasShelf, index) =>
      count + Number(hasShelf) * Number(openGaps[Math.floor(index / 2)]), 0))
    const actual = Sim.countEnchantmentTableBookshelves({
      tablePosition,
      blockPowerAt: bookshelfPowerAtFor(tablePosition, shelves, openGaps),
    })

    expect(Result.isSuccess(actual)).toBe(true)
    if (Result.isSuccess(actual)) expect(actual.success).toBe(expected)
  }), { numRuns: 64, seed: 0x50554242 })
})

it('public bookshelf counting keeps the 15 and 16 shelf boundary at power 15', () => {
  const tablePosition = at(0, 64, 0)
  const openGaps = bookshelfRingOffsets.map(() => true)
  const fifteen = Array.from({ length: 16 }, (_, index) => index < 15)
  const sixteen = Array.from({ length: 16 }, () => true)
  const count = (shelves: readonly boolean[]) => Sim.countEnchantmentTableBookshelves({
    tablePosition,
    blockPowerAt: bookshelfPowerAtFor(tablePosition, shelves, openGaps),
  })

  expect(count(fifteen)).toStrictEqual(Result.succeed(15))
  expect(count(sixteen)).toStrictEqual(Result.succeed(15))
})
