import { Result } from 'effect'
import {
  PositiveTickCount,
  RecipeExperience,
  RecipeGridDimension,
  RecipeGroup,
  RecipeId,
  RecipeIngredientCount,
  RecipePriority,
  RecipeStationTag,
  TagLocation,
  TransmuteMaterialSlotCount,
  craftGrid,
  exactly,
  tagged,
  type ItemType,
} from '@nerima-games/mc-kernel'
import { applyCooking, matchCookingRecipe, matchCookingRecipes, matchesCookingRecipe, type CookingRecipe } from '../src/domain/cooking.js'
import { itemStack } from '../src/domain/inventory.js'
import { applySmithing, matchSmithingRecipe, matchSmithingRecipes, matchesSmithingRecipe, smithingInput, type SmithingRecipe } from '../src/domain/smithing.js'
import { applyStonecutting, matchStonecuttingRecipe, matchStonecuttingRecipes, matchesStonecuttingRecipe, type StonecuttingRecipe } from '../src/domain/stonecutting.js'
import { applyTransmute, matchTransmuteRecipe, matchTransmuteRecipes, matchesTransmuteRecipe, type TransmuteRecipe } from '../src/domain/transmute.js'
import { describe, expect, it } from 'vitest'

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const stack = (item: ItemType, count = 1) => must(itemStack(item, count))
const ingredient = (item: ItemType, count = 1) => must(exactly(item, must(RecipeIngredientCount.result(count))))
const id = (value: string) => must(RecipeId.result(value))
const priority = (value: number) => must(RecipePriority.result(value))

const cookingRecipe = (overrides: Partial<CookingRecipe> = {}): CookingRecipe => ({
  _tag: 'Cooking',
  id: id('minecraft:roasted_iron'),
  station: 'furnace',
  ingredient: ingredient('iron_ore'),
  output: stack('iron_ingot'),
  cookTimeTicks: must(PositiveTickCount.result(200)),
  experience: must(RecipeExperience.result(0.7)),
  priority: priority(0),
  ...overrides,
})

const stonecuttingRecipe = (overrides: Partial<StonecuttingRecipe> = {}): StonecuttingRecipe => ({
  _tag: 'Stonecutting',
  id: id('minecraft:polished_stone'),
  ingredient: ingredient('stone'),
  output: stack('iron_ingot'),
  priority: priority(0),
  ...overrides,
})

const smithingRecipe = (overrides: Partial<SmithingRecipe> = {}): SmithingRecipe => ({
  _tag: 'SmithingTransform',
  id: id('minecraft:iron_upgrade'),
  template: ingredient('netherite_upgrade_smithing_template'),
  base: ingredient('diamond_sword'),
  addition: ingredient('netherite_ingot'),
  output: stack('netherite_sword'),
  priority: priority(0),
  tags: [must(RecipeStationTag.result('smithing_table'))],
  ...overrides,
})

const transmuteRecipe = (overrides: Partial<TransmuteRecipe> = {}): TransmuteRecipe => ({
  _tag: 'Transmute',
  id: id('minecraft:clay_from_dirt'),
  source: ingredient('dirt'),
  material: ingredient('iron_ingot'),
  output: stack('iron_ingot'),
  materialCount: {
    min: must(TransmuteMaterialSlotCount.result(1)),
    max: must(TransmuteMaterialSlotCount.result(1)),
  },
  addMaterialCountToResult: true,
  priority: priority(0),
  ...overrides,
})

const grid = (cells: ReadonlyArray<ItemType | ReturnType<typeof stack> | undefined>, width = 3, height = 3) =>
  must(craftGrid(
    must(RecipeGridDimension.result(width)),
    must(RecipeGridDimension.result(height)),
    cells,
  ))

describe('cooking recipe runtime', () => {
  it('matches by station and ingredient, sorts by priority then id, and consumes the declared count', () => {
    const first = cookingRecipe({
      id: id('minecraft:a_roast'),
      priority: priority(2),
      ingredient: ingredient('iron_ore', 2),
      category: 'equipment',
      group: must(RecipeGroup.result('smelting')),
      showNotification: false,
    })
    const second = cookingRecipe({ id: id('minecraft:b_roast'), priority: priority(1) })
    const matches = matchCookingRecipes(stack('iron_ore', 3), { station: 'furnace' }, [first, second])
    expect(matches).toMatchObject({ _tag: 'Success', success: [second, first] })
    expect(matchCookingRecipe(stack('iron_ore', 3), { station: 'furnace' }, [first, second])).toMatchObject({
      _tag: 'Success', success: { _tag: 'Match', recipe: second, output: stack('iron_ingot') },
    })
    expect(applyCooking(first, stack('iron_ore', 3), { station: 'furnace' })).toMatchObject({
      _tag: 'Success', success: { _tag: 'Applied', remainingInput: stack('iron_ore', 1) },
    })
    expect(applyCooking(first, undefined, {})).toMatchObject({ _tag: 'Success', success: { _tag: 'NoMatch' } })
  })

  it('returns typed failures for invalid recipes, inputs, contexts and tables', () => {
    expect(matchesCookingRecipe({}, stack('iron_ore'))).toMatchObject({ _tag: 'Failure' })
    expect(matchesCookingRecipe(cookingRecipe(), 'iron_ore')).toMatchObject({ _tag: 'Failure' })
    expect(matchesCookingRecipe(cookingRecipe(), stack('iron_ore'), { station: ' ' })).toMatchObject({ _tag: 'Failure' })
    expect(matchCookingRecipes(stack('iron_ore'), {}, [cookingRecipe(), {}])).toMatchObject({ _tag: 'Failure' })
    expect(matchCookingRecipes(stack('iron_ore'), {}, null)).toMatchObject({ _tag: 'Failure' })
    expect(matchesCookingRecipe(cookingRecipe(), stack('iron_ore', 1), { station: 'smoker' })).toMatchObject({
      _tag: 'Success', success: false,
    })
    expect(matchesCookingRecipe(cookingRecipe({ ingredient: ingredient('iron_ore', 2) }), stack('iron_ore'))).toMatchObject({
      _tag: 'Success', success: false,
    })
    expect(matchCookingRecipes(undefined)).toMatchObject({ _tag: 'Success', success: [] })
    expect(matchCookingRecipe(stack('stone'))).toMatchObject({ _tag: 'Success', success: { _tag: 'NoMatch' } })
    expect(applyCooking({}, stack('iron_ore'))).toMatchObject({ _tag: 'Failure' })
    expect(matchCookingRecipes(stack('iron_ore'), {}, [
      cookingRecipe({ id: id('minecraft:z_roast'), priority: priority(1) }),
      cookingRecipe({ id: id('minecraft:a_roast'), priority: priority(1) }),
    ])).toMatchObject({
      _tag: 'Success', success: [
        expect.objectContaining({ id: 'minecraft:a_roast' }),
        expect.objectContaining({ id: 'minecraft:z_roast' }),
      ],
    })
    expect(applyCooking(cookingRecipe(), stack('iron_ore'))).toMatchObject({
      _tag: 'Success', success: { _tag: 'Applied', remainingInput: undefined },
    })
    for (const category of ['building', 'misc', 'redstone'] as const) {
      expect(matchesCookingRecipe(cookingRecipe({ category }), stack('iron_ore'))).toMatchObject({
        _tag: 'Success', success: true,
      })
    }
    expect(matchesCookingRecipe(cookingRecipe({ category: 'invalid' as never }), stack('iron_ore'))).toMatchObject({
      _tag: 'Failure',
    })
  })
})

describe('stonecutting recipe runtime', () => {
  it('matches and applies recipes, preserving priority order and remaining input', () => {
    const high = stonecuttingRecipe({ id: id('minecraft:z_polished'), priority: priority(4) })
    const low = stonecuttingRecipe({ id: id('minecraft:a_polished'), priority: priority(0) })
    const recipes = [high, low]
    expect(matchStonecuttingRecipes(stack('stone', 3), {}, recipes)).toMatchObject({ _tag: 'Success', success: [low, high] })
    expect(matchStonecuttingRecipe(stack('stone'), {}, recipes)).toMatchObject({
      _tag: 'Success', success: { _tag: 'Match', recipe: low },
    })
    expect(applyStonecutting(high, stack('stone', 3))).toMatchObject({
      _tag: 'Success', success: { _tag: 'Applied', remainingInput: stack('stone', 2) },
    })
    expect(applyStonecutting(high, stack('stone'), { station: 'smithing_table' })).toMatchObject({
      _tag: 'Success', success: { _tag: 'NoMatch' },
    })
    expect(matchesStonecuttingRecipe(low, stack('stone'))).toMatchObject({ _tag: 'Success', success: true })
    expect(matchStonecuttingRecipe(stack('stone'), {}, [])).toMatchObject({ _tag: 'Success', success: { _tag: 'NoMatch' } })
    expect(applyStonecutting({}, stack('stone'))).toMatchObject({ _tag: 'Failure' })
    expect(matchesStonecuttingRecipe(stonecuttingRecipe({ showNotification: 'yes' as never }), stack('stone'))).toMatchObject({
      _tag: 'Failure',
    })
  })

  it('rejects malformed values and enforces the stonecutter station when supplied', () => {
    expect(matchStonecuttingRecipes('stone', {}, [])).toMatchObject({ _tag: 'Failure' })
    expect(matchStonecuttingRecipes(stack('stone'), {}, [{}])).toMatchObject({ _tag: 'Failure' })
    expect(matchStonecuttingRecipes(stack('stone'), { station: '' }, [])).toMatchObject({ _tag: 'Failure' })
    expect(matchStonecuttingRecipes(stack('stone'), { station: 'stonecutter' }, [stonecuttingRecipe()])).toMatchObject({
      _tag: 'Success', success: [stonecuttingRecipe()],
    })
    expect(matchStonecuttingRecipes(stack('stone'), { station: 'furnace' }, [stonecuttingRecipe()])).toMatchObject({
      _tag: 'Success', success: [],
    })
  })
})

describe('smithing recipe runtime', () => {
  const input = {
    template: stack('netherite_upgrade_smithing_template'),
    base: stack('diamond_sword'),
    addition: stack('netherite_ingot'),
  }

  it('matches the station, chooses the preferred recipe and applies transform or trim', () => {
    const transform = smithingRecipe()
    const trim = smithingRecipe({
      _tag: 'SmithingTrim',
      id: id('minecraft:trim'),
      priority: priority(1),
    })
    const context = { station: must(RecipeStationTag.result('smithing_table')) }
    expect(smithingInput({ base: input.base })).toMatchObject({ _tag: 'Success', success: { base: input.base } })
    expect(matchSmithingRecipes(input, context, [trim, transform])).toMatchObject({
      _tag: 'Success', success: [transform, trim],
    })
    expect(matchSmithingRecipe(input, context, [trim, transform])).toMatchObject({
      _tag: 'Success', success: transform,
    })
    expect(applySmithing(input, context, [transform])).toMatchObject({
      _tag: 'Success', success: { _tag: 'Transform', output: stack('netherite_sword') },
    })
    expect(applySmithing(input, {}, [trim])).toMatchObject({
      _tag: 'Success', success: { _tag: 'Trim', base: input.base },
    })
    expect(matchSmithingRecipe(input, { station: 'wrong' }, [transform])).toMatchObject({ _tag: 'Success', success: undefined })
    expect(matchesSmithingRecipe(transform, input)).toMatchObject({ _tag: 'Success', success: true })
    expect(matchesSmithingRecipe(transform, input, { station: 'wrong' })).toMatchObject({ _tag: 'Success', success: false })
    expect(matchSmithingRecipe(input, context, [])).toMatchObject({ _tag: 'Success', success: undefined })
  })

  it('accepts recipes without station tags and rejects invalid input, context and tables', () => {
    const untagged = smithingRecipe({ tags: [] })
    expect(matchSmithingRecipe(input, {}, [untagged])).toMatchObject({ _tag: 'Success', success: untagged })
    expect(smithingInput(null)).toMatchObject({ _tag: 'Failure' })
    expect(smithingInput({ base: null })).toMatchObject({ _tag: 'Failure' })
    const invalidStation = { station: 'invalid station!' }
    expect(matchSmithingRecipe(input, invalidStation, [untagged])).toMatchObject({ _tag: 'Failure' })
    expect(matchSmithingRecipes(input, invalidStation, [untagged])).toMatchObject({ _tag: 'Failure' })
    expect(matchesSmithingRecipe(untagged, input, invalidStation)).toMatchObject({ _tag: 'Failure' })
    expect(applySmithing(input, invalidStation, [untagged])).toMatchObject({ _tag: 'Failure' })
    expect(matchSmithingRecipe(input, { station: ' ' }, [untagged])).toMatchObject({ _tag: 'Failure' })
    expect(matchSmithingRecipe(input, {}, [{}])).toMatchObject({ _tag: 'Failure' })
    expect(matchesSmithingRecipe({}, input)).toMatchObject({ _tag: 'Failure' })
    expect(matchesSmithingRecipe(smithingRecipe({ tags: ['bad tag' as never] }), input)).toMatchObject({ _tag: 'Failure' })
    expect(matchesSmithingRecipe(smithingRecipe({ showNotification: 1 as never }), input)).toMatchObject({ _tag: 'Failure' })
    expect(applySmithing(input, {}, [])).toMatchObject({ _tag: 'Success', success: { _tag: 'NoMatch' } })
    expect(smithingInput()).toMatchObject({ _tag: 'Success', success: { template: undefined, base: undefined, addition: undefined } })
    for (const field of ['template', 'base', 'addition'] as const) {
      expect(applySmithing({ ...input, [field]: undefined }, {}, [untagged])).toMatchObject({
        _tag: 'Success', success: { _tag: 'NoMatch' },
      })
    }
  })
})

describe('transmute recipe runtime', () => {
  const fullGrid = grid([stack('dirt', 2), stack('iron_ingot', 2), ...Array(7).fill(undefined)])

  it('matches, sorts and consumes source and material slots while scaling output', () => {
    const recipe = transmuteRecipe()
    const context = { station: must(RecipeStationTag.result('other_station')) }
    const match = matchTransmuteRecipe(fullGrid, context, [recipe])
    expect(match).toMatchObject({
      _tag: 'Success', success: {
        _tag: 'Match', sourceSlotIndex: 0, materialSlotIndexes: [1], output: stack('iron_ingot', 2),
      },
    })
    expect(must(matchTransmuteRecipes(fullGrid, context, [recipe]))).toEqual([must(matchTransmuteRecipe(fullGrid, context, [recipe]))])
    expect(matchesTransmuteRecipe(recipe, fullGrid, context)).toMatchObject({ _tag: 'Success', success: true })
    expect(applyTransmute(recipe, fullGrid)).toMatchObject({
      _tag: 'Success', success: { _tag: 'Applied', remainingGrid: { cells: [stack('dirt'), stack('iron_ingot'), ...Array(7).fill(undefined)] } },
    })
  })

  it('returns no match for wrong grids and typed failures for malformed data', () => {
    const recipe = transmuteRecipe()
    expect(matchTransmuteRecipe(grid([stack('dirt'), stack('iron_ingot'), undefined], 2, 2), {}, [recipe])).toMatchObject({
      _tag: 'Success', success: { _tag: 'NoMatch' },
    })
    expect(matchTransmuteRecipe(null)).toMatchObject({ _tag: 'Failure' })
    expect(matchTransmuteRecipe(fullGrid, { station: '' }, [recipe])).toMatchObject({ _tag: 'Failure' })
    expect(matchTransmuteRecipe(fullGrid, {}, [{}])).toMatchObject({ _tag: 'Failure' })
    expect(matchesTransmuteRecipe({}, fullGrid)).toMatchObject({ _tag: 'Failure' })
    expect(applyTransmute(recipe, grid([stack('stone'), stack('iron_ingot'), ...Array(7).fill(undefined)]))).toMatchObject({
      _tag: 'Success', success: { _tag: 'NoMatch' },
    })
    expect(applyTransmute({}, fullGrid)).toMatchObject({ _tag: 'Failure' })
  })

  it('rejects material overflow and matches tags through validated memberships', () => {
    const overflowing = transmuteRecipe({ output: stack('iron_ingot', 64) })
    expect(matchTransmuteRecipe(fullGrid, {}, [overflowing])).toMatchObject({ _tag: 'Failure' })
    const tag = must(TagLocation.result('#minecraft:earth'))
    const taggedRecipe = transmuteRecipe({ source: must(tagged(tag)) })
    const context = { itemTags: new Map([[tag, new Set<ItemType>(['dirt'])]]) }
    const taggedGrid = grid([stack('dirt'), stack('iron_ingot'), ...Array(7).fill(undefined)])
    expect(matchTransmuteRecipe(taggedGrid, context, [taggedRecipe])).toMatchObject({ _tag: 'Success', success: { _tag: 'Match' } })
    expect(matchTransmuteRecipe(taggedGrid, { itemTags: new Map([[tag, new Set<ItemType>(['stone'])]]) }, [taggedRecipe])).toMatchObject({
      _tag: 'Success', success: { _tag: 'NoMatch' },
    })
    for (const category of ['building', 'equipment', 'misc', 'redstone'] as const) {
      expect(matchTransmuteRecipe(fullGrid, {}, [transmuteRecipe({ category })])).toMatchObject({
        _tag: 'Success', success: { _tag: 'Match' },
      })
    }
    for (const recipe of [
      transmuteRecipe({ category: 'invalid' as never }),
      transmuteRecipe({ group: 1 as never }),
      transmuteRecipe({ showNotification: 1 as never }),
    ]) {
      expect(matchTransmuteRecipe(fullGrid, {}, [recipe])).toMatchObject({ _tag: 'Failure' })
    }
    expect(matchTransmuteRecipe(fullGrid, {}, [transmuteRecipe({ addMaterialCountToResult: false })])).toMatchObject({
      _tag: 'Success', success: { _tag: 'Match', output: stack('iron_ingot') },
    })
    expect(applyTransmute(transmuteRecipe({ addMaterialCountToResult: false }), grid([
      stack('dirt'), stack('iron_ingot'), ...Array(7).fill(undefined),
    ]))).toMatchObject({
      _tag: 'Success', success: { _tag: 'Applied', remainingGrid: { cells: [undefined, undefined, ...Array(7).fill(undefined)] } },
    })
    expect(matchTransmuteRecipe(grid([stack('dirt'), ...Array(8).fill(undefined)]), {}, [transmuteRecipe()])).toMatchObject({
      _tag: 'Success', success: { _tag: 'NoMatch' },
    })
    expect(matchTransmuteRecipe(grid([stack('dirt'), stack('iron_ingot'), stack('stone'), ...Array(6).fill(undefined)]), {}, [transmuteRecipe()])).toMatchObject({
      _tag: 'Success', success: { _tag: 'NoMatch' },
    })
  })
})
