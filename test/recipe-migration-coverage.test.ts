import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import type { ItemType } from '@nerima-games/mc-kernel'
import { itemStack as itemStackResult, type ItemStack } from '../src/domain/inventory.js'
import {
  anyOf,
  buildRecipeIndexes,
  cellAt,
  conflictsIn,
  craftGrid as craftGridResult,
  exactly,
  ingredientMatches,
  matchIndexedRecipe,
  matchRecipe,
  matchRecipeWithAssignments,
  matchesRecipe,
  matchesShaped,
  matchesShapeless,
  RecipeGridDimension,
  RecipePriority,
  RecipeStationTag,
  shapedRecipe as shapedRecipeResult,
  shapelessRecipe as shapelessRecipeResult,
  tagged,
  type CraftGrid,
  type CraftingIngredientInput,
  type Recipe,
  type RecipeOptions,
  type ShapedRecipe,
  type ShapelessRecipe,
} from '../src/domain/recipe.js'

const requireSuccess = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const expectFailure = <A, E>(
  result: Result.Result<A, E>,
  expected: Readonly<Record<string, unknown>>,
): void => {
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) expect(result.failure).toMatchObject(expected)
}

const stack = (item: ItemType, count = 1): ItemStack =>
  requireSuccess(itemStackResult(item, count))

const grid = (
  width: number,
  height: number,
  items: ReadonlyArray<ItemType | ItemStack | undefined>,
): CraftGrid => requireSuccess(craftGridResult(width, height, items))

const shaped = (
  id: string,
  rows: ReadonlyArray<string>,
  key: Readonly<Record<string, CraftingIngredientInput>>,
  output: ItemStack,
  options?: RecipeOptions,
): ShapedRecipe => requireSuccess(
  shapedRecipeResult(id, rows, key, Result.succeed(output), options),
)

const shapeless = (
  id: string,
  ingredients: ReadonlyArray<CraftingIngredientInput>,
  output: ItemStack,
  options?: RecipeOptions,
): ShapelessRecipe => requireSuccess(
  shapelessRecipeResult(id, ingredients, Result.succeed(output), options),
)

describe('recipe constructor failure results', () => {
  it('returns typed failures for invalid identifiers, ingredient counts, and tag locations', () => {
    const invalidId = shapedRecipeResult(
      'not a resource location',
      ['S'],
      { S: 'stone' },
      Result.succeed(stack('stick')),
    )
    expectFailure(invalidId, { _tag: 'RecipeTypeFailure', name: 'TypeError' })

    const nonStringId = shapedRecipeResult(
      // @ts-expect-error runtime callers can supply a non-string identifier
      7,
      ['S'],
      { S: 'stone' },
      Result.succeed(stack('stick')),
    )
    expectFailure(nonStringId, { _tag: 'RecipeTypeFailure', name: 'TypeError' })

    expectFailure(exactly('stone', 0), { _tag: 'RecipeRangeFailure', name: 'RangeError' })
    expectFailure(tagged('minecraft:planks'), { _tag: 'RecipeTypeFailure', name: 'TypeError' })

    const validTag = requireSuccess(tagged('#coverage:planks'))
    expect(validTag).toMatchObject({ _tag: 'ItemTag', tag: '#coverage:planks', count: 1 })
  })

  it('rejects malformed key records, symbols, row arrays, and row widths as Result failures', () => {
    const invalidKey = shapedRecipeResult(
      'coverage:array-key',
      ['S'],
      // @ts-expect-error arrays are not shaped-recipe key records
      [],
      Result.succeed(stack('stick')),
    )
    expectFailure(invalidKey, { _tag: 'RecipeTypeFailure', name: 'TypeError' })

    const invalidSymbol = shapedRecipeResult(
      'coverage:space-symbol',
      ['A'],
      { ' ': 'stone' },
      Result.succeed(stack('stick')),
    )
    expectFailure(invalidSymbol, { _tag: 'RecipeTypeFailure', name: 'TypeError' })

    const nonArrayRows = shapedRecipeResult(
      'coverage:non-array-rows',
      // @ts-expect-error runtime callers can violate the typed rows boundary
      null,
      { S: 'stone' },
      Result.succeed(stack('stick')),
    )
    expectFailure(nonArrayRows, { _tag: 'RecipeTypeFailure', name: 'TypeError' })

    const tooWideRow = shapedRecipeResult(
      'coverage:wide-row',
      ['stone'],
      { s: 'stone' },
      Result.succeed(stack('stick')),
    )
    expectFailure(tooWideRow, { _tag: 'RecipeRangeFailure', name: 'RangeError' })
  })

  it('maps both brand and item-stack failures from recipe outputs', () => {
    const brandFailure = itemStackResult('stick', 0)
    expect(Result.isFailure(brandFailure)).toBe(true)
    expectFailure(
      shapelessRecipeResult('coverage:bad-count-output', ['stone'], brandFailure),
      { _tag: 'RecipeRangeFailure', name: 'RangeError' },
    )

    const itemFailure = itemStackResult(
      // @ts-expect-error the sim wrapper checks unknown runtime item identifiers
      'missing_item_type',
      1,
    )
    expect(Result.isFailure(itemFailure)).toBe(true)
    expectFailure(
      shapedRecipeResult('coverage:bad-item-output', ['S'], { S: 'stone' }, itemFailure),
      { _tag: 'RecipeItemFailure', failure: { _tag: 'ItemValidationFailure' } },
    )
  })

  it('returns dimension failures and reads outside a valid grid as empty', () => {
    expectFailure(craftGridResult(4, 1, []), { _tag: 'RecipeRangeFailure', name: 'RangeError' })
    expectFailure(craftGridResult(1, 4, []), { _tag: 'RecipeRangeFailure', name: 'RangeError' })

    const oneCell = grid(1, 1, ['stone'])
    expect(cellAt(oneCell, 0, 0)).toMatchObject({ item: 'stone', count: 1 })
    expect(cellAt(oneCell, -1, 0)).toBeUndefined()
    expect(cellAt(oneCell, 1, 0)).toBeUndefined()
    expect(cellAt(oneCell, 0.5, 0)).toBeUndefined()
  })
})

describe('recipe matcher coverage paths', () => {
  it('matches direct shaped and shapeless calls with default contexts', () => {
    const shapedRecipe = shaped('coverage:direct-shaped', ['S'], { S: 'stone' }, stack('stick'))
    const shapelessRecipe = shapeless('coverage:direct-shapeless', ['stone'], stack('bowl'))

    expect(matchesShaped(shapedRecipe, grid(1, 1, ['stone']))).toBe(true)
    expect(matchesShapeless(shapelessRecipe, grid(1, 1, ['stone']))).toBe(true)
    expect(matchesRecipe(shapelessRecipe, grid(1, 1, ['stone']))).toBe(true)
    expect(matchRecipeWithAssignments([shapedRecipe], grid(1, 1, ['stone']))).toMatchObject({
      _tag: 'Match',
      recipe: shapedRecipe,
      assignments: [{ slotIndex: 0, item: 'stone', ingredient: shapedRecipe.pattern.cells[0] }],
    })
  })

  it('rejects extra shaped cells, station mismatches, and malformed ingredients safely', () => {
    const extraCellRecipe = shaped('coverage:one-stone', ['S'], { S: 'stone' }, stack('stick'))
    expect(matchesShaped(extraCellRecipe, grid(2, 1, ['stone', 'dirt']))).toBe(false)

    const station = RecipeStationTag('minecraft:crafting_table')
    const stationRecipe = shaped(
      'coverage:station-recipe',
      ['S'],
      { S: 'stone' },
      stack('stick'),
      { tags: [station] },
    )
    expect(matchesRecipe(stationRecipe, grid(1, 1, ['stone']))).toBe(false)
    expect(matchesRecipe(stationRecipe, grid(1, 1, ['stone']), { station })).toBe(true)

    const shapelessStationRecipe = shapeless(
      'coverage:shapeless-station-recipe',
      ['stone'],
      stack('bowl'),
      { tags: [station] },
    )
    const shapelessGrid = grid(1, 1, ['stone'])
    expect(matchesRecipe(shapelessStationRecipe, shapelessGrid)).toBe(false)
    expect(matchesRecipe(shapelessStationRecipe, shapelessGrid, { station })).toBe(true)
    expect(matchRecipe([shapelessStationRecipe], shapelessGrid)).toStrictEqual({ _tag: 'NoMatch' })
    expect(matchRecipe([shapelessStationRecipe], shapelessGrid, { station })).toMatchObject({
      _tag: 'Match',
      recipe: shapelessStationRecipe,
    })

    const malformed = shapeless('coverage:mutable-ingredient', ['stone'], stack('bowl'))
    expect(Reflect.set(malformed.ingredients, 0, null)).toBe(true)
    expect(matchRecipe([malformed], grid(1, 1, ['stone']))).toStrictEqual({ _tag: 'NoMatch' })
  })

  it('memoizes failed overlapping shapeless assignments and skips empty candidate slots', () => {
    const either = requireSuccess(anyOf(['oak_planks', 'stone']))
    const backtracking = shapeless(
      'coverage:overlap-fails',
      [either, either, 'coal'],
      stack('bowl'),
    )
    expect(matchesShapeless(backtracking, grid(3, 1, ['oak_planks', 'stone', 'dirt']))).toBe(false)

    const repeated = shapeless('coverage:two-spaced-stones', ['stone', 'stone'], stack('stick'))
    expect(matchesShapeless(repeated, grid(3, 1, ['stone', undefined, 'stone']))).toBe(true)

    const countRequired = shapeless(
      'coverage:two-stone-count',
      [requireSuccess(exactly('stone', 2))],
      stack('stick'),
    )
    expect(matchesShapeless(countRequired, grid(1, 1, [stack('stone', 1)]))).toBe(false)
  })

  it('builds indexes for exact, AnyOf, shapeless, repeated, and hole-containing recipes', () => {
    const repeated = shapeless('coverage:index-repeated', ['dirt', 'dirt'], stack('stick'))
    const hole = shaped('coverage:index-hole', ['D D'], { D: 'dirt' }, stack('bowl'))
    const alternatives = shapeless(
      'coverage:index-any-of',
      [requireSuccess(anyOf(['oak_planks', 'stone']))],
      stack('gravel'),
    )
    const anotherDirt = shapeless('coverage:index-dirt', ['dirt'], stack('sand'))
    const index = buildRecipeIndexes([repeated, hole, alternatives, anotherDirt])

    expect(index.exactByItem.get('dirt')).toStrictEqual([repeated, hole, anotherDirt])
    expect(matchIndexedRecipe(index, grid(2, 1, ['dirt', 'dirt']))).toBe(repeated)
    expect(matchIndexedRecipe(index, grid(3, 1, ['dirt', undefined, 'dirt']))).toBe(hole)
    expect(matchIndexedRecipe(index, grid(1, 1, ['stone']))).toBe(alternatives)
    expect(matchIndexedRecipe(index, grid(2, 1, [undefined, 'dirt']))).toBe(anotherDirt)
  })

  it('uses tagged fallback candidates with and without an exact index winner', () => {
    const tagIngredient = requireSuccess(tagged('#coverage:items'))
    const taggedRecipe = shapeless('coverage:tagged-index', [tagIngredient], stack('bowl'))
    const itemTags = new Map([[tagIngredient.tag, new Set<ItemType>(['stone'])]])
    const stoneGrid = grid(1, 1, ['stone'])
    const tagOnlyIndex = buildRecipeIndexes([taggedRecipe])

    expect(matchIndexedRecipe(tagOnlyIndex, stoneGrid, { itemTags })).toBe(taggedRecipe)
    expect(matchIndexedRecipe(tagOnlyIndex, grid(0, 0, []), { itemTags })).toBeUndefined()

    const exactLaterWinner = shapeless(
      'coverage:exact-later-winner',
      ['stone'],
      stack('sand'),
      { priority: RecipePriority(1) },
    )
    const taggedEarlierWinner = shapeless(
      'coverage:tagged-earlier-winner',
      [tagIngredient],
      stack('gravel'),
      { priority: RecipePriority(0) },
    )
    const tagWins = buildRecipeIndexes([exactLaterWinner, taggedEarlierWinner])
    expect(matchIndexedRecipe(tagWins, stoneGrid, { itemTags })).toBe(taggedEarlierWinner)

    const exactEarlierWinner = shapeless(
      'coverage:exact-earlier-winner',
      ['stone'],
      stack('sand'),
      { priority: RecipePriority(0) },
    )
    const taggedLaterWinner = shapeless(
      'coverage:tagged-later-winner',
      [tagIngredient],
      stack('gravel'),
      { priority: RecipePriority(1) },
    )
    const exactWins = buildRecipeIndexes([exactEarlierWinner, taggedLaterWinner])
    expect(matchIndexedRecipe(exactWins, stoneGrid, { itemTags })).toBe(exactEarlierWinner)
  })

  it('rejects malformed indexed grids and skips sparse recipe table slots', () => {
    const recipe = shaped('coverage:sparse-table', ['S'], { S: 'stone' }, stack('stick'))
    const sparseTable: Recipe[] = []
    sparseTable[1] = recipe
    expect(matchRecipe(sparseTable, grid(1, 1, ['stone']))).toMatchObject({
      _tag: 'Match',
      recipe,
    })

    const invalidGrid: CraftGrid = {
      width: RecipeGridDimension(1),
      height: RecipeGridDimension(1),
      cells: [stack('stone'), stack('dirt')],
    }
    expect(matchesShaped(recipe, invalidGrid)).toBe(false)
    expect(matchesShapeless(shapeless('coverage:invalid-grid', ['stone'], stack('bowl')), invalidGrid))
      .toBe(false)
    expect(matchIndexedRecipe(buildRecipeIndexes([recipe]), invalidGrid)).toBeUndefined()
  })

  it('detects equivalent AnyOf shapes and shapeless tag ingredients as conflicts', () => {
    const alternatives = requireSuccess(anyOf(['dirt', 'sand']))
    const shapeA = shaped('coverage:shape-a', ['X'], { X: alternatives }, stack('stick'))
    const shapeB = shaped('coverage:shape-b', ['X'], { X: alternatives }, stack('bowl'))
    expect(conflictsIn([shapeA, shapeB])).toStrictEqual([
      { firstId: 'coverage:shape-a', secondId: 'coverage:shape-b', reason: 'same-shape' },
    ])

    const tagIngredient = requireSuccess(tagged('#coverage:conflict'))
    const tagA = shapeless('coverage:tag-a', [tagIngredient], stack('stick'))
    const tagB = shapeless('coverage:tag-b', [tagIngredient], stack('bowl'))
    expect(conflictsIn([tagA, tagB])).toStrictEqual([
      { firstId: 'coverage:tag-a', secondId: 'coverage:tag-b', reason: 'same-ingredients' },
    ])
  })

  it('keeps priority winner selection independent of table order', () => {
    const lowerPriority = shapeless(
      'coverage:priority-zero',
      ['dirt'],
      stack('sand'),
      { priority: RecipePriority(0) },
    )
    const higherPriority = shapeless(
      'coverage:priority-one',
      ['dirt'],
      stack('gravel'),
      { priority: RecipePriority(1) },
    )

    expect(matchRecipe([higherPriority, lowerPriority], grid(1, 1, ['dirt']))).toMatchObject({
      _tag: 'Match',
      recipe: lowerPriority,
    })
  })

  it('rejects invalid ingredients and absent tag memberships at the ingredient boundary', () => {
    const invalidIngredientMatch = ingredientMatches(
      // @ts-expect-error the predicate must return false for malformed runtime values
      null,
      'stone',
    )
    expect(invalidIngredientMatch).toBe(false)

    const tagIngredient = requireSuccess(tagged('#coverage:missing'))
    expect(ingredientMatches(tagIngredient, 'stone', new Map())).toBe(false)
  })
})
