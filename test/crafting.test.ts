/**
 * Crafting against the inventory: what is consumed, what is produced, and what
 * happens when the craft cannot complete.
 *
 * The load-bearing property is ALL-OR-NOTHING. Two of these tests are named
 * REGRESSION per docs/testing.md §4.5, because a partially applied craft is not
 * a wrong number on a screen — it deletes or duplicates the player's items, and
 * the deletion is silent.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { makeInventoryService } from '../application/inventory-service'
import { craftFromGrid, ingredientCost } from '../domain/crafting'
import {
  addItem,
  countOf,
  emptyInventory,
  INVENTORY_SLOT_COUNT,
  Inventory,
  ItemId,
  itemStack,
} from '../domain/inventory'
import { MAX_STACK_COUNT } from '../domain/kernel-vocabulary'
import { CraftGrid, craftGrid, shapelessRecipe, STARTER_RECIPES } from '../domain/recipe'

const LEGEND: Readonly<Record<string, ItemId>> = {
  P: 'OAK_PLANKS',
  S: 'STICK',
  L: 'OAK_LOG',
  D: 'DIRT',
}

const gridOf = (...rows: ReadonlyArray<string>): CraftGrid => {
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0)
  return craftGrid(
    width,
    rows.length,
    rows.flatMap((row) => Array.from({ length: width }, (_unused, x) => LEGEND[row[x] ?? ' '])),
  )
}

const stocked = (entries: ReadonlyArray<readonly [ItemId, number]>): Inventory =>
  entries.reduce((inventory, [item, count]) => addItem(inventory, item, count).inventory, emptyInventory())

// The stick grid: two planks in a column. Costs 2 planks, yields 4 sticks.
const STICK_GRID = gridOf('P', 'P')

describe('ingredientCost', () => {
  it.effect('charges one item per occupied cell, whatever the stack in it holds', () =>
    Effect.sync(() => {
      // A cell holding 12 planks still costs one plank, which is the rule that
      // makes "hold a stack in the grid and craft repeatedly" work.
      const fat: CraftGrid = {
        width: 1,
        height: 2,
        cells: [itemStack('OAK_PLANKS', 12), itemStack('OAK_PLANKS', 3)],
      }
      expect([...ingredientCost(fat)]).toStrictEqual([['OAK_PLANKS', 2]])
      expect([...ingredientCost(gridOf('PPP', ' S ', ' S '))]).toStrictEqual([
        ['OAK_PLANKS', 3],
        ['STICK', 2],
      ])
      expect([...ingredientCost(craftGrid(3, 3, []))]).toStrictEqual([])
    }),
  )
})

describe('craftFromGrid', () => {
  it.effect('consumes exactly the ingredients and produces exactly the result', () =>
    Effect.sync(() => {
      const before = stocked([['OAK_PLANKS', 10]])
      const after = craftFromGrid(before, STARTER_RECIPES, STICK_GRID)

      expect(after.result).toStrictEqual({
        _tag: 'Crafted',
        recipeId: 'mc-sim:stick',
        output: { item: 'STICK', count: 4 },
      })
      expect(countOf(after.inventory, 'OAK_PLANKS')).toBe(8)
      expect(countOf(after.inventory, 'STICK')).toBe(4)
      // Nothing else moved.
      expect(after.inventory.slots.filter((slot) => slot !== undefined)).toHaveLength(2)
    }),
  )

  it.effect('charges one craft, not one per item in the grid cells', () =>
    Effect.sync(() => {
      const before = stocked([['OAK_PLANKS', 64]])
      const fat: CraftGrid = {
        width: 1,
        height: 2,
        cells: [itemStack('OAK_PLANKS', 32), itemStack('OAK_PLANKS', 32)],
      }
      const after = craftFromGrid(before, STARTER_RECIPES, fat)

      expect(countOf(after.inventory, 'OAK_PLANKS')).toBe(62)
      expect(countOf(after.inventory, 'STICK')).toBe(4)
    }),
  )

  it.effect('REGRESSION: a craft short of an ingredient leaves the inventory untouched', () =>
    Effect.sync(() => {
      const before = stocked([['OAK_PLANKS', 1]])
      const after = craftFromGrid(before, STARTER_RECIPES, STICK_GRID)

      expect(after.result).toStrictEqual({
        _tag: 'MissingIngredients',
        missing: [{ item: 'OAK_PLANKS', short: 1 }],
      })
      // Identity, not equality: there is no path that rebuilds the inventory.
      expect(after.inventory).toBe(before)
      expect(countOf(after.inventory, 'STICK')).toBe(0)
    }),
  )

  it.effect('REGRESSION: a craft with nowhere to put the result leaves the inventory untouched', () =>
    Effect.sync(() => {
      // 35 slots of dirt plus one FULL stack of planks. Spending two planks does
      // not free the slot, and four sticks have nowhere to go. Consuming here
      // and failing to produce would delete two planks.
      const before = stocked([
        ['DIRT', (INVENTORY_SLOT_COUNT - 1) * MAX_STACK_COUNT],
        ['OAK_PLANKS', MAX_STACK_COUNT],
      ])
      const after = craftFromGrid(before, STARTER_RECIPES, STICK_GRID)

      expect(after.result).toStrictEqual({ _tag: 'NoRoom' })
      expect(after.inventory).toBe(before)
      expect(countOf(after.inventory, 'OAK_PLANKS')).toBe(MAX_STACK_COUNT)
      expect(countOf(after.inventory, 'STICK')).toBe(0)
    }),
  )

  it.effect('removes the ingredients BEFORE offering the result, so the last craft still fits', () =>
    Effect.sync(() => {
      // The same 36 full slots, except the planks slot holds exactly the two the
      // craft spends. Checking for room first would refuse this — which is
      // precisely when a player crafts: to make room.
      const before = stocked([
        ['DIRT', (INVENTORY_SLOT_COUNT - 1) * MAX_STACK_COUNT],
        ['OAK_PLANKS', 2],
      ])
      const after = craftFromGrid(before, STARTER_RECIPES, STICK_GRID)

      expect(after.result._tag).toBe('Crafted')
      expect(countOf(after.inventory, 'STICK')).toBe(4)
      expect(countOf(after.inventory, 'OAK_PLANKS')).toBe(0)
    }),
  )

  it.effect('a grid that makes nothing leaves the inventory untouched', () =>
    Effect.sync(() => {
      const before = stocked([['OAK_PLANKS', 10]])
      const after = craftFromGrid(before, STARTER_RECIPES, gridOf('PPP', 'P P'))

      expect(after.result).toStrictEqual({ _tag: 'NoMatch' })
      expect(after.inventory).toBe(before)
    }),
  )

  it.effect('reports every missing ingredient, not just the first', () =>
    Effect.sync(() => {
      const after = craftFromGrid(emptyInventory(), STARTER_RECIPES, gridOf('PPP', ' S ', ' S '))

      expect(after.result).toStrictEqual({
        _tag: 'MissingIngredients',
        missing: [
          { item: 'OAK_PLANKS', short: 3 },
          { item: 'STICK', short: 2 },
        ],
      })
    }),
  )

  it.effect('the ambiguity rule reaches the inventory: the shaped output is the one produced', () =>
    Effect.sync(() => {
      const before = stocked([['OAK_PLANKS', 4]])

      // Column -> shaped mc-sim:stick -> 4 sticks for 2 planks.
      const column = craftFromGrid(before, STARTER_RECIPES, gridOf('P', 'P'))
      expect(countOf(column.inventory, 'STICK')).toBe(4)

      // Row -> the shapeless fallback -> 2 sticks for the same 2 planks.
      const row = craftFromGrid(before, STARTER_RECIPES, gridOf('PP'))
      expect(countOf(row.inventory, 'STICK')).toBe(2)
    }),
  )
})

describe('InventoryService.craft', () => {
  it.effect('crafts through the service and reports what it made', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('OAK_LOG', 1)

      expect(yield* service.craft(gridOf('L'))).toStrictEqual({
        _tag: 'Crafted',
        recipeId: 'mc-sim:oak-planks',
        output: { item: 'OAK_PLANKS', count: 4 },
      })
      expect(yield* service.countOf('OAK_LOG')).toBe(0)
      expect(yield* service.countOf('OAK_PLANKS')).toBe(4)
    }),
  )

  it.effect('previewCraft answers the same question without changing anything', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const before = yield* service.snapshot

      const match = yield* service.previewCraft(STICK_GRID)
      expect(match._tag === 'Match' ? match.recipe.id : 'NoMatch').toBe('mc-sim:stick')

      // Preview says what the grid MAKES; it does not say the player can afford
      // it, and the empty inventory below is the proof that it must not.
      expect(yield* service.snapshot).toStrictEqual(before)
      expect((yield* service.craft(STICK_GRID))._tag).toBe('MissingIngredients')
    }),
  )

  it.effect('REGRESSION: concurrent crafts cannot overdraw — Ref.modify, not get-then-set', () =>
    Effect.gen(function* () {
      // 20 planks is exactly 10 sticks' worth. A get-then-set craft lets fibers
      // read the same stock and each conclude it can afford one, which mints
      // sticks out of nothing. This is DN-07 with a two-sided payload.
      const service = yield* makeInventoryService()
      yield* service.add('OAK_PLANKS', 20)

      const fibers = yield* Effect.forEach(
        Array.from({ length: 50 }, (_unused, index) => index),
        () => Effect.fork(service.craft(STICK_GRID)),
        { concurrency: 'unbounded' },
      )
      const results = yield* Effect.forEach(fibers, Fiber.join)

      expect(results.filter((result) => result._tag === 'Crafted')).toHaveLength(10)
      expect(results.filter((result) => result._tag === 'MissingIngredients')).toHaveLength(40)
      expect(yield* service.countOf('OAK_PLANKS')).toBe(0)
      expect(yield* service.countOf('STICK')).toBe(40)
    }),
  )

  it.effect('the recipe table is world-scoped, so two worlds can know different recipes', () =>
    Effect.gen(function* () {
      const modded = [
        ...STARTER_RECIPES,
        shapelessRecipe('test:dirt-to-mud', ['DIRT'], itemStack('MUD', 1)),
      ]
      const vanilla = yield* makeInventoryService()
      const world = yield* makeInventoryService(stocked([['DIRT', 1]]), modded)

      expect(yield* vanilla.recipes).toStrictEqual(STARTER_RECIPES)
      expect(yield* vanilla.previewCraft(gridOf('D'))).toStrictEqual({ _tag: 'NoMatch' })

      expect((yield* world.craft(gridOf('D')))._tag).toBe('Crafted')
      expect(yield* world.countOf('MUD')).toBe(1)
    }),
  )
})
