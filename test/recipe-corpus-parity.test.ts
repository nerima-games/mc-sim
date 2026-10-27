import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import type { ItemType } from '@nerima-games/mc-kernel'
import { itemStack as itemStackResult, type ItemStack } from '../src/domain/inventory'
import {
  anyOf,
  buildRecipeIndexes,
  craftGrid as craftGridResult,
  exactly,
  matchRecipe,
  matchesRecipe,
  matchIndexedRecipe,
  matchRecipeWithAssignments,
  RecipePriority,
  RecipeStationTag,
  shapedRecipe as shapedRecipeResult,
  shapelessRecipe as shapelessRecipeResult,
  tagged,
  type CraftGrid,
  type Recipe,
} from '../src/domain/recipe'
import { STARTER_RECIPES as starterRecipesResult } from '../src/domain/recipe-data'

const requireSuccess = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const itemStack = (...args: Parameters<typeof itemStackResult>): ItemStack =>
  requireSuccess(itemStackResult(...args))
const craftGrid = (...args: Parameters<typeof craftGridResult>): CraftGrid =>
  requireSuccess(craftGridResult(...args))
const shapedRecipe = (
  id: Parameters<typeof shapedRecipeResult>[0],
  rows: Parameters<typeof shapedRecipeResult>[1],
  key: Parameters<typeof shapedRecipeResult>[2],
  output: ItemStack,
  options?: Parameters<typeof shapedRecipeResult>[4],
): Recipe => requireSuccess(shapedRecipeResult(id, rows, key, Result.succeed(output), options))
const shapelessRecipe = (
  id: Parameters<typeof shapelessRecipeResult>[0],
  ingredients: Parameters<typeof shapelessRecipeResult>[1],
  output: ItemStack,
  options?: Parameters<typeof shapelessRecipeResult>[3],
): Recipe => requireSuccess(shapelessRecipeResult(id, ingredients, Result.succeed(output), options))
const STARTER_RECIPES = requireSuccess(starterRecipesResult)

const STARTER_RECIPE_IDS = [
  'mc-sim:bone-meal',
  'mc-sim:oak-planks',
  'mc-sim:stick',
  'mc-sim:crafting-table',
  'mc-sim:furnace',
  'mc-sim:chest',
  'mc-sim:torch',
  'mc-sim:bucket',
  'mc-sim:bow',
  'mc-sim:glowstone',
  'mc-sim:flint-and-steel',
  'mc-sim:fire-charge',
  'mc-sim:eye-of-ender',
  'mc-sim:coal-block',
  'mc-sim:coal-from-block',
  'mc-sim:iron-block',
  'mc-sim:iron-from-block',
  'mc-sim:diamond-block',
  'mc-sim:diamond-from-block',
  'mc-sim:redstone-block',
  'mc-sim:redstone-from-block',
  'mc-sim:lapis-block',
  'mc-sim:lapis-from-block',
  'mc-sim:emerald-block',
  'mc-sim:emerald-from-block',
  'mc-sim:amethyst-block',
  'mc-sim:amethyst-from-block',
  'mc-sim:sandstone',
  'mc-sim:redstone-torch',
  'mc-sim:lever',
  'mc-sim:stone-button',
  'mc-sim:repeater',
  'mc-sim:redstone-lamp',
  'mc-sim:piston',
  'mc-sim:dispenser',
  'mc-sim:dropper',
  'mc-sim:hopper',
  'mc-sim:end-stone-bricks',
  'mc-sim:end-crystal',
  'mc-sim:ender-chest',
  'mc-sim:purpur-pillar',
  'mc-sim:purpur-slab',
  'mc-sim:purpur-stairs',
  'mc-sim:door',
  'mc-sim:oak-stairs',
  'mc-sim:anvil',
  'mc-sim:cauldron',
  'mc-sim:bed',
  'mc-sim:tnt',
  'mc-sim:ladder',
  'mc-sim:rail',
  'mc-sim:pressure-plate',
  'mc-sim:stone-slab',
  'mc-sim:bowl',
  'mc-sim:oak-boat',
  'mc-sim:minecart',
  'mc-sim:fishing-rod',
  'mc-sim:shears',
  'mc-sim:wool',
  'mc-sim:sugar',
  'mc-sim:wooden-pickaxe',
  'mc-sim:stone-pickaxe',
  'mc-sim:iron-pickaxe',
  'mc-sim:diamond-pickaxe',
  'mc-sim:wooden-hoe',
  'mc-sim:stone-hoe',
  'mc-sim:iron-hoe',
  'mc-sim:diamond-hoe',
  'mc-sim:wooden-sword',
  'mc-sim:stone-sword',
  'mc-sim:iron-sword',
  'mc-sim:diamond-sword',
  'mc-sim:iron-helmet',
  'mc-sim:iron-chestplate',
  'mc-sim:iron-leggings',
  'mc-sim:iron-boots',
] as const

describe('recipe migration parity', () => {
  it('preserves the sim starter recipe IDs in source order', () => {
    expect(STARTER_RECIPES.map((recipe) => recipe.id)).toStrictEqual(STARTER_RECIPE_IDS)
  })

  it('matches an AnyOf shaped ingredient against each fixed option', () => {
    const alternative = requireSuccess(anyOf(['stone', 'dirt']))
    const recipe = shapedRecipe('parity:any-of', ['A'], { A: alternative }, itemStack('bowl', 1))

    expect(matchRecipe([recipe], craftGrid(1, 1, ['stone']))).toMatchObject({ _tag: 'Match', recipe })
    expect(matchRecipe([recipe], craftGrid(1, 1, ['dirt']))).toMatchObject({ _tag: 'Match', recipe })
    expect(matchRecipe([recipe], craftGrid(1, 1, ['sand']))).toStrictEqual({ _tag: 'NoMatch' })
    expect(matchesRecipe(recipe, craftGrid(1, 1, ['stone']))).toBe(true)
    expect(matchesRecipe(recipe, craftGrid(1, 1, ['sand']))).toBe(false)
    expect(matchIndexedRecipe(buildRecipeIndexes([recipe]), craftGrid(1, 1, ['stone']))).toBe(recipe)
  })

  it('requires the tagged station and uses the supplied item tag membership', () => {
    const plankTag = requireSuccess(tagged('#minecraft:planks'))
    const craftingTable = RecipeStationTag('minecraft:crafting_table')
    const recipe = shapedRecipe(
      'parity:tagged-station',
      ['P'],
      { P: plankTag },
      itemStack('stick', 1),
      { tags: [craftingTable] },
    )
    const itemTags = new Map([[plankTag.tag, new Set<ItemType>(['oak_planks'])]])
    const grid = craftGrid(1, 1, ['oak_planks'])

    expect(matchRecipe([recipe], grid, { itemTags, station: craftingTable })._tag).toBe('Match')
    expect(matchIndexedRecipe(buildRecipeIndexes([recipe]), grid, { itemTags, station: craftingTable })).toBe(recipe)
    expect(matchRecipe([recipe], grid, { itemTags })._tag).toBe('NoMatch')
    expect(matchRecipe([recipe], grid, { itemTags, station: RecipeStationTag('minecraft:furnace') })._tag).toBe('NoMatch')
    expect(matchRecipe([recipe], craftGrid(1, 1, ['dirt']), { itemTags, station: craftingTable })._tag).toBe('NoMatch')
  })

  it('checks stack counts before accepting shaped or shapeless ingredients', () => {
    const twoPlanks = requireSuccess(exactly('oak_planks', 2))
    const recipe = shapedRecipe('parity:two-planks', ['P'], { P: twoPlanks }, itemStack('stick', 1))
    const shapeless = shapelessRecipe('parity:two-loose-planks', [twoPlanks], itemStack('stick', 1))

    expect(matchRecipe([recipe], craftGrid(1, 1, [itemStack('oak_planks', 1)]))._tag).toBe('NoMatch')
    expect(matchRecipe([recipe], craftGrid(1, 1, [itemStack('oak_planks', 2)]))._tag).toBe('Match')
    expect(matchRecipe([shapeless], craftGrid(1, 1, [itemStack('oak_planks', 1)]))._tag).toBe('NoMatch')
    expect(matchRecipe([shapeless], craftGrid(1, 1, [itemStack('oak_planks', 2)]))._tag).toBe('Match')
  })

  it('backtracks a shapeless tag assignment and reports assignments by slot', () => {
    const broad = requireSuccess(tagged('#parity:overlapping'))
    const exact = requireSuccess(exactly('oak_planks'))
    const recipe = shapelessRecipe('parity:backtracking', [broad, exact], itemStack('bowl', 1))
    const itemTags = new Map([[broad.tag, new Set<ItemType>(['oak_planks', 'stone'])]])
    const grid = craftGrid(2, 1, ['oak_planks', 'stone'])

    expect(matchRecipeWithAssignments([recipe], grid, { itemTags })).toStrictEqual({
      _tag: 'Match',
      recipe,
      output: recipe.output,
      assignments: [
        { slotIndex: 0, item: 'oak_planks', ingredient: exact },
        { slotIndex: 1, item: 'stone', ingredient: broad },
      ],
    })
  })

  it('orders equal-priority matches with shaped recipes before shapeless recipes', () => {
    const shaped = shapedRecipe('parity:shaped', ['D'], { D: 'dirt' }, itemStack('sand', 1))
    const shapeless = shapelessRecipe('parity:shapeless', ['dirt'], itemStack('gravel', 1))

    expect(matchRecipe([shapeless, shaped], craftGrid(1, 1, ['dirt']))).toMatchObject({
      _tag: 'Match',
      recipe: shaped,
    })
  })

  it('orders lower numeric priority before recipe kind', () => {
    const higherPriorityShaped = shapedRecipe(
      'parity:shaped',
      ['D'],
      { D: 'dirt' },
      itemStack('sand', 1),
      { priority: RecipePriority(1) },
    )
    const lowerPriorityShapeless = shapelessRecipe(
      'parity:shapeless',
      ['dirt'],
      itemStack('gravel', 1),
      { priority: RecipePriority(0) },
    )

    expect(matchRecipe([higherPriorityShaped, lowerPriorityShapeless], craftGrid(1, 1, ['dirt'])))
      .toMatchObject({ _tag: 'Match', recipe: lowerPriorityShapeless })
  })
})
