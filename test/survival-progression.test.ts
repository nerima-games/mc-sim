import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { type ItemType } from '@nerima-games/mc-kernel'
import { type Recipe } from '../src/domain/recipe'
import { STARTER_RECIPES } from '../src/domain/recipe-data'
import { STARTER_FUEL_RULES, STARTER_SMELTING_RECIPES } from '../src/domain/smelting-data'

const ingredientsOf = (recipe: Recipe): ReadonlyArray<ItemType> =>
  recipe._tag === 'Shaped'
    ? recipe.pattern.cells.flatMap((cell) => (cell === undefined ? [] : [cell.item]))
    : recipe.ingredients.map((ingredient) => ingredient.item)

/**
 * Closes over recipes while treating each gathered resource as renewable. The
 * test models progression gates, not finite inventory accounting.
 */
const reachableFrom = (startingItems: ReadonlySet<ItemType>): ReadonlySet<ItemType> => {
  const reachable = new Set(startingItems)
  let changed = true

  while (changed) {
    changed = false
    for (const recipe of STARTER_RECIPES) {
      if (!ingredientsOf(recipe).every((item) => reachable.has(item))) continue
      if (reachable.has(recipe.output.item)) continue
      reachable.add(recipe.output.item)
      changed = true
    }

    const hasFurnace = reachable.has('furnace')
    const hasFuel = STARTER_FUEL_RULES.some((rule) => reachable.has(rule.item))
    if (!hasFurnace || !hasFuel) continue
    for (const recipe of STARTER_SMELTING_RECIPES) {
      if (!reachable.has(recipe.input) || reachable.has(recipe.output.item)) continue
      reachable.add(recipe.output.item)
      changed = true
    }
  }

  return reachable
}

const expectReachable = (
  reachable: ReadonlySet<ItemType>,
  expected: ReadonlyArray<ItemType>,
): void => {
  expect(expected.filter((item) => !reachable.has(item))).toStrictEqual([])
}

describe('starter survival progression', () => {
  it.effect('gathered resources unlock the wooden, stone, iron, and diamond stages in order', () =>
    Effect.sync(() => {
      const wood = reachableFrom(new Set<ItemType>(['oak_log']))
      expectReachable(wood, [
        'oak_planks',
        'stick',
        'crafting_table',
        'wooden_pickaxe',
        'wooden_hoe',
        'wooden_sword',
      ])
      expect(wood.has('stone_pickaxe')).toBe(false)

      const stone = reachableFrom(new Set<ItemType>([...wood, 'cobblestone', 'coal', 'sand']))
      expectReachable(stone, [
        'furnace',
        'torch',
        'stone',
        'glass',
        'stone_pickaxe',
        'stone_hoe',
        'stone_sword',
      ])
      expect(stone.has('iron_pickaxe')).toBe(false)

      const iron = reachableFrom(new Set<ItemType>([...stone, 'raw_iron', 'flint']))
      expectReachable(iron, [
        'iron_ingot',
        'iron_pickaxe',
        'iron_hoe',
        'iron_sword',
        'iron_helmet',
        'iron_chestplate',
        'iron_leggings',
        'iron_boots',
        'bucket',
        'flint_and_steel',
      ])
      expect(iron.has('diamond_pickaxe')).toBe(false)

      const diamond = reachableFrom(new Set<ItemType>([...iron, 'diamond']))
      expectReachable(diamond, ['diamond_pickaxe', 'diamond_hoe', 'diamond_sword'])

      const adventure = reachableFrom(
        new Set<ItemType>([...diamond, 'string', 'ender_pearl', 'blaze_powder']),
      )
      expectReachable(adventure, ['bow', 'eye_of_ender'])
    }),
  )
})
