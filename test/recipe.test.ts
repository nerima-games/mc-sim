/**
 * The recipe model: shaped matching under translation and mirroring, shapeless
 * matching under permutation, and the ambiguity rule.
 *
 * Test names follow docs/testing.md §4.5 — they name the FAILURE, so that a red
 * line says what broke rather than which function was called.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { itemStack } from '../src/domain/inventory'
import { ItemType } from '@nerima-games/mc-kernel'
import {
  cellAt,
  conflictsIn,
  CraftGrid,
  craftGrid,
  exactly,
  matchRecipe,
  Recipe,
  RecipePattern,
  RecipeTable,
  shapedRecipe,
  shapelessRecipe,
} from '../src/domain/recipe'
import { STARTER_RECIPES } from '../src/domain/recipe-data'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Every letter is a member of kernel's `ITEM_TYPES`, because `ItemType` is a
 * closed union and a legend of invented names would not compile. That is the
 * point of the repoint and it is worth noticing here: this legend was once free
 * to say `'FLINT'`, then was not allowed to say `'flint'` either, and now is —
 * because kernel granted the literal on a drop rule of its own.
 *
 * Every letter but `X` is an item some row of `STARTER_RECIPES` names. `X` is
 * deliberately an item NO recipe names — it is the intruder in "an extra item
 * defeats the match" and the filler in the ambiguity fixtures — and it is the
 * only entry here that is not part of a shipped recipe. There is no longer a
 * pair of fixture-only items standing in for a shipped row: the two rules that
 * needed them (the horizontal mirror, and permutation over three distinct
 * ingredients) are demonstrated by the shipped table again.
 */
const LEGEND: Readonly<Record<string, ItemType>> = {
  P: 'oak_planks',
  S: 'stick',
  L: 'oak_log',
  G: 'glowstone_dust',
  D: 'diamond',
  X: 'dirt',
  I: 'iron_ingot',
  F: 'flint',
  N: 'gunpowder',
  Z: 'blaze_powder',
  E: 'ender_pearl',
  C: 'coal',
  B: 'cobblestone',
  T: 'string',
  Q: 'coal_block',
  R: 'iron_block',
  A: 'diamond_block',
  M: 'bone',
}

/** A grid drawn as rows of legend characters; a space is an empty cell. */
const gridOf = (...rows: ReadonlyArray<string>): CraftGrid => {
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0)
  return craftGrid(
    width,
    rows.length,
    rows.flatMap((row) => Array.from({ length: width }, (_unused, x) => LEGEND[row[x] ?? ' '])),
  )
}

const placeAt = (
  width: number,
  height: number,
  cells: ReadonlyArray<readonly [number, number, ItemType]>,
): CraftGrid => {
  const items: Array<ItemType | undefined> = Array.from({ length: width * height }, () => undefined)
  for (const [x, y, item] of cells) {
    items[y * width + x] = item
  }
  return craftGrid(width, height, items)
}

/** The matched recipe's id, or the literal `'NoMatch'`. */
const matchedId = (grid: CraftGrid, table: RecipeTable = STARTER_RECIPES): string => {
  const match = matchRecipe(table, grid)
  return match._tag === 'Match' ? match.recipe.id : 'NoMatch'
}

const AMBIGUOUS_RECIPES: RecipeTable = [
  ...STARTER_RECIPES,
  shapelessRecipe('test:stick-from-loose-planks', ['oak_planks', 'oak_planks'], itemStack('stick', 2)),
]

const permutations = <A>(values: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> =>
  values.length <= 1
    ? [values]
    : values.flatMap((value, index) =>
        permutations([...values.slice(0, index), ...values.slice(index + 1)]).map((rest) => [
          value,
          ...rest,
        ]),
      )

const rotations = <A>(values: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> =>
  values.map((_unused, index) => [...values.slice(index), ...values.slice(0, index)])

/**
 * A grid laid out exactly as a shaped recipe's pattern says, or as its
 * horizontal mirror says.
 *
 * Reading the pattern back out of the shipped recipe, rather than hand-copying
 * its rows into the test, is what lets the mirror regression below assert
 * something about `STARTER_RECIPES` as a whole instead of about one row a future
 * editor may rename or reshape.
 */
const gridFromPattern = (pattern: RecipePattern, mirrored: boolean): CraftGrid =>
  craftGrid(
    pattern.width,
    pattern.height,
    Array.from({ length: pattern.width * pattern.height }, (_unused, index) => {
      const x = index % pattern.width
      const y = Math.floor(index / pattern.width)
      const cell = pattern.cells[y * pattern.width + (mirrored ? pattern.width - 1 - x : x)]
      return cell?.item
    }),
  )

const canonicalGrid = (recipe: Recipe): CraftGrid =>
  recipe._tag === 'Shaped'
    ? gridFromPattern(recipe.pattern, false)
    : craftGrid(
        recipe.ingredients.length,
        1,
        recipe.ingredients.map((ingredient) => ingredient.item),
      )

/**
 * Whether a pattern is unchanged by the horizontal flip — and so can say nothing
 * about whether the matcher applies the flip at all.
 */
const isOwnMirror = (pattern: RecipePattern): boolean =>
  pattern.cells.every(
    (cell, index) =>
      cell?.item ===
      pattern.cells[
        Math.floor(index / pattern.width) * pattern.width +
          (pattern.width - 1 - (index % pattern.width))
      ]?.item,
  )

const shapedIn = (table: RecipeTable): ReadonlyArray<{ id: string; pattern: RecipePattern }> =>
  table.flatMap((recipe) =>
    recipe._tag === 'Shaped' ? [{ id: recipe.id, pattern: recipe.pattern }] : [],
  )

// ---------------------------------------------------------------------------

describe('shaped matching translates', () => {
  it.effect('a 2x2 shape is the SAME recipe at all four positions in a 3x3 grid', () =>
    Effect.sync(() => {
      const positions = [0, 1].flatMap((y) => [0, 1].map((x) => [x, y] as const))
      expect(positions).toHaveLength(4)

      for (const [ox, oy] of positions) {
        const grid = placeAt(3, 3, [
          [ox, oy, 'glowstone_dust'],
          [ox + 1, oy, 'glowstone_dust'],
          [ox, oy + 1, 'glowstone_dust'],
          [ox + 1, oy + 1, 'glowstone_dust'],
        ])
        expect({ ox, oy, id: matchedId(grid) }).toStrictEqual({
          ox,
          oy,
          id: 'mc-sim:glowstone',
        })
      }
    }),
  )

  it.effect('the crafting table works in a player 2x2 grid and at every 3x3 offset', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('PP', 'PP'))).toBe('mc-sim:crafting-table')

      const positions = [0, 1].flatMap((y) => [0, 1].map((x) => [x, y] as const))
      for (const [ox, oy] of positions) {
        const grid = placeAt(3, 3, [
          [ox, oy, 'oak_planks'],
          [ox + 1, oy, 'oak_planks'],
          [ox, oy + 1, 'oak_planks'],
          [ox + 1, oy + 1, 'oak_planks'],
        ])
        expect({ ox, oy, id: matchedId(grid) }).toStrictEqual({
          ox,
          oy,
          id: 'mc-sim:crafting-table',
        })
      }
    }),
  )

  it.effect('the furnace requires a cobblestone ring with an empty centre', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('BBB', 'B B', 'BBB'))).toBe('mc-sim:furnace')
      expect(matchedId(gridOf('BBB', 'BBB', 'BBB'))).toBe('NoMatch')
    }),
  )

  it.effect('the chest requires an oak-plank ring with an empty centre', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('PPP', 'P P', 'PPP'))).toBe('mc-sim:chest')
      expect(matchedId(gridOf('PPP', 'PPP', 'PPP'))).toBe('NoMatch')
    }),
  )

  it.effect('a 1x2 shape is the SAME recipe at all six positions in a 3x3 grid', () =>
    Effect.sync(() => {
      const positions = [0, 1].flatMap((y) => [0, 1, 2].map((x) => [x, y] as const))
      expect(positions).toHaveLength(6)

      for (const [ox, oy] of positions) {
        const grid = placeAt(3, 3, [
          [ox, oy, 'oak_planks'],
          [ox, oy + 1, 'oak_planks'],
        ])
        expect({ ox, oy, id: matchedId(grid) }).toStrictEqual({ ox, oy, id: 'mc-sim:stick' })
      }
    }),
  )

  it.effect('a broken shape is not a translation of the whole shape', () =>
    Effect.sync(() => {
      // The same four planks, in an L. The occupied box is 2x3 and no 2x3
      // recipe exists, so nothing is made — and nothing must be made, because
      // "four planks somewhere" is the shapeless reading of a shaped recipe.
      expect(matchedId(gridOf('PP ', 'P  ', 'P  '))).toBe('NoMatch')
      // One plank displaced by a single cell: the box becomes 3x2.
      expect(matchedId(gridOf('PP ', 'P P'))).toBe('NoMatch')
      // A gap inside both rows: the box is 3x2, not 2x2.
      expect(matchedId(gridOf('P P', 'P P'))).toBe('NoMatch')
    }),
  )

  it.effect('a hole in the pattern is a requirement, so a stray item breaks the match', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('PPP', ' S ', ' S '))).toBe('mc-sim:wooden-pickaxe')
      // One plank in a cell the pickaxe requires to be empty.
      expect(matchedId(gridOf('PPP', 'PS ', ' S '))).toBe('NoMatch')
    }),
  )

  it.effect('stone pickaxe requires a cobblestone head and centered handle', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('BBB', ' S ', ' S '))).toBe('mc-sim:stone-pickaxe')
      expect(matchedId(gridOf('BBB', 'S  ', 'S  '))).toBe('NoMatch')
    }),
  )

  it.effect('each hoe tier uses two materials and a two-stick handle', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('PP', ' S', ' S'))).toBe('mc-sim:wooden-hoe')
      expect(matchedId(gridOf('BB', ' S', ' S'))).toBe('mc-sim:stone-hoe')
      expect(matchedId(gridOf('II', ' S', ' S'))).toBe('mc-sim:iron-hoe')
      expect(matchedId(gridOf('DD', ' S', ' S'))).toBe('mc-sim:diamond-hoe')
      expect(matchedId(gridOf('PP', 'S ', 'S '))).toBe('mc-sim:wooden-hoe')
    }),
  )

  it.effect('iron pickaxe requires an iron head and centered handle', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('III', ' S ', ' S '))).toBe('mc-sim:iron-pickaxe')
      expect(matchedId(gridOf('III', 'S  ', 'S  '))).toBe('NoMatch')
    }),
  )

  it.effect('diamond pickaxe requires a diamond head and centered handle', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('DDD', ' S ', ' S '))).toBe('mc-sim:diamond-pickaxe')
      expect(matchedId(gridOf('DDD', 'S  ', 'S  '))).toBe('NoMatch')
    }),
  )

  it.effect('fishing rod fits the three-by-three crafting table layout', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('  S', ' ST', 'S T'))).toBe('mc-sim:fishing-rod')
    }),
  )

  it.effect('iron armor recipes match their canonical layouts', () =>
    Effect.sync(() => {
      const cases = [
        { id: 'mc-sim:iron-helmet', rows: ['III', 'I I'] },
        { id: 'mc-sim:iron-chestplate', rows: ['I I', 'III', 'III'] },
        { id: 'mc-sim:iron-leggings', rows: ['III', 'I I', 'I I'] },
        { id: 'mc-sim:iron-boots', rows: ['I I', 'I I'] },
      ] as const

      for (const { id, rows } of cases) {
        expect(matchedId(gridOf(...rows))).toBe(id)
      }
    }),
  )

  it.effect('iron helmet and boots translate vertically in a 3x3 grid', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('   ', 'III', 'I I'))).toBe('mc-sim:iron-helmet')
      expect(matchedId(gridOf('   ', 'I I', 'I I'))).toBe('mc-sim:iron-boots')
    }),
  )

  it.effect('extra iron in an armor pattern empty cell prevents a match', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('III', 'I I', ' I '))).toBe('NoMatch')
      // A third-row iron prevents both the two-row minecart and all armor shapes.
      expect(matchedId(gridOf('I I', 'III', ' I '))).toBe('NoMatch')
    }),
  )

  it.effect('a 3x3 recipe cannot be reached from the player 2x2 grid', () =>
    Effect.sync(() => {
      // No rule says so: the occupied box of a 2x2 grid can never be 3x3.
      expect(matchedId(gridOf('PP', 'S '))).toBe('NoMatch')
      // The positive control, so that the line above is failing for the reason
      // claimed and not because a 2x2 grid matches nothing at all.
      expect(matchedId(gridOf('GG', 'GG'))).toBe('mc-sim:glowstone')
    }),
  )

  it.effect('a pattern written with a spare border is the same pattern, not a second recipe', () =>
    Effect.sync(() => {
      const padded = shapedRecipe(
        'test:glowstone-padded',
        ['   ', ' GG', ' GG'],
        { G: 'glowstone_dust' },
        itemStack('glowstone', 1),
      )
      expect(padded.pattern.width).toBe(2)
      expect(padded.pattern.height).toBe(2)
      expect(matchedId(gridOf('GG ', 'GG ', '   '), [padded])).toBe('test:glowstone-padded')

      // ...and the table checker sees the two as the duplicate they are.
      const both = STARTER_RECIPES.filter((recipe) => recipe.id === 'mc-sim:glowstone')
      expect(conflictsIn([...both, padded])).toStrictEqual([
        { reason: 'same-shape', recipeIds: ['mc-sim:glowstone', 'test:glowstone-padded'] },
      ])
    }),
  )

  it.effect('a row MISSING from the array — not merely blank — reads as an empty row too', () =>
    Effect.sync(() => {
      // `trimPattern` reads `rows[y] ?? ''` because `noUncheckedIndexedAccess`
      // types every array read as possibly-undefined. That is not paranoia about
      // something that cannot happen: `rows.length` is a plain writable number
      // property, so extending it past the last pushed element leaves a genuine
      // gap — a real `undefined`, with no cast and no `any` — which is exactly
      // what a sparse array is. This constructs one without escaping the type.
      const rows: Array<string> = ['PPP', ' S ']
      rows.length = 3

      const withGap = shapedRecipe(
        'test:gap-row',
        rows,
        { P: 'oak_planks', S: 'stick' },
        itemStack('stick', 1),
      )

      // The missing row occupies nothing, so it cannot widen the trimmed box —
      // the result is identical to never having written a third row at all.
      expect(withGap.pattern).toStrictEqual({
        width: 3,
        height: 2,
        cells: [exactly('oak_planks'), exactly('oak_planks'), exactly('oak_planks'), undefined, exactly('stick'), undefined],
      })
    }),
  )

  it.effect('a pattern with no legend hit anywhere trims to the canonical empty pattern', () =>
    Effect.sync(() => {
      // Every character in every row is either a space or, here, absent from
      // the (empty) legend — so `trimPattern` never finds an occupied cell and
      // takes the `maxX < 0` early return instead of computing a box.
      const blank = shapedRecipe('test:blank', ['   ', '   '], {}, itemStack('stick', 1))
      expect(blank.pattern).toStrictEqual({ width: 0, height: 0, cells: [] })

      // A zero-size pattern cannot equal any grid's occupied box, so it is
      // unmatchable rather than a silent universal match.
      expect(matchedId(gridOf('GG', 'GG'), [blank])).toBe('NoMatch')
    }),
  )
})

/*
 * Both blocks below run against `STARTER_RECIPES` — the table `InventoryService`
 * hands to mx-ui — and not against fixtures. That keeps the matcher properties
 * covered by rows the simulation actually publishes: asymmetric shaped rows
 * exercise the horizontal mirror, while distinct shapeless rows exercise
 * permutation. Ambiguity-only recipes remain local to the tests that need them.
 */
describe('shaped matching mirrors horizontally, and only horizontally', () => {
  it.effect('an asymmetric shape matches its left-right mirror, as vanilla does', () =>
    Effect.sync(() => {
      // Vanilla's flint and steel: an iron ingot above and left of a flint.
      expect(matchedId(gridOf('I ', ' F'))).toBe('mc-sim:flint-and-steel')
      expect(matchedId(gridOf(' I', 'F '))).toBe('mc-sim:flint-and-steel')
    }),
  )

  it.effect('the mirror travels with the translation, at every position', () =>
    Effect.sync(() => {
      for (const [ox, oy] of [0, 1].flatMap((y) => [0, 1].map((x) => [x, y] as const))) {
        const mirrored = placeAt(3, 3, [
          [ox + 1, oy, 'iron_ingot'],
          [ox, oy + 1, 'flint'],
        ])
        expect({ ox, oy, id: matchedId(mirrored) }).toStrictEqual({
          ox,
          oy,
          id: 'mc-sim:flint-and-steel',
        })
      }
    }),
  )

  it.effect('a vertical flip is NOT a mirror — a shape upside down is a different shape', () =>
    Effect.sync(() => {
      // Vertically flipping `I./.F` gives `.F/I.`, which is neither the pattern
      // nor its horizontal mirror. Accepting it would invent recipes.
      expect(matchedId(gridOf(' F', 'I '))).toBe('NoMatch')
      expect(matchedId(gridOf('F ', ' I'))).toBe('NoMatch')
    }),
  )

  it.effect('REGRESSION: a shipped recipe distinguishes the mirror, so deleting it breaks the game', () =>
    Effect.sync(() => {
      // At least one shipped pattern is NOT its own mirror, and the mirrored
      // layout of every such pattern must still match its own recipe. Keeping
      // the assertion data-driven means adding an official row cannot silently
      // leave its mirror behavior untested.
      const shaped = shapedIn(STARTER_RECIPES)
      expect(shaped.length).toBeGreaterThan(0)

      const asymmetric = shaped.filter((recipe) => !isOwnMirror(recipe.pattern))
      expect(asymmetric.length).toBeGreaterThan(0)
      expect(asymmetric.map((recipe) => recipe.id)).toContain('mc-sim:flint-and-steel')

      for (const recipe of asymmetric) {
        // Laid out as written, and laid out flipped. Both are the same recipe.
        expect({ id: recipe.id, plain: matchedId(gridFromPattern(recipe.pattern, false)) })
          .toStrictEqual({ id: recipe.id, plain: recipe.id })
        expect({ id: recipe.id, flipped: matchedId(gridFromPattern(recipe.pattern, true)) })
          .toStrictEqual({ id: recipe.id, flipped: recipe.id })
      }
    }),
  )
})

describe('shapeless matching permutes', () => {
  it.effect('the Eye of Ender recipe accepts either ingredient order', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('EZ'))).toBe('mc-sim:eye-of-ender')
      expect(matchedId(gridOf('ZE'))).toBe('mc-sim:eye-of-ender')
    }),
  )

  it.effect('every permutation of the ingredients is the same recipe', () =>
    Effect.sync(() => {
      // Vanilla's fire charge: gunpowder, blaze powder and coal, all distinct,
      // so the backtracking assignment is put through six arrangements rather
      // than the one an identical pair would give it.
      const orders = permutations(['N', 'Z', 'C'])
      expect(orders).toHaveLength(6)

      for (const order of orders) {
        expect({ order, id: matchedId(gridOf(order.join(''))) }).toStrictEqual({
          order,
          id: 'mc-sim:fire-charge',
        })
      }
    }),
  )

  it.effect('position is irrelevant, not merely reorderable within a row', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('N Z', '   ', '  C'))).toBe('mc-sim:fire-charge')
      expect(matchedId(gridOf('  C', ' Z ', 'N  '))).toBe('mc-sim:fire-charge')
    }),
  )

  it.effect('an extra item defeats the match instead of being ignored', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('NZC'))).toBe('mc-sim:fire-charge')
      // `X` is dirt, which no shipped recipe names at all.
      expect(matchedId(gridOf('NZC', 'X  '))).toBe('NoMatch')
      // A duplicate of a required item is an extra item too.
      expect(matchedId(gridOf('NZC', 'C  '))).toBe('NoMatch')
    }),
  )

  it.effect('a missing item defeats the match', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('NZ '))).toBe('NoMatch')
    }),
  )

  it.effect('two identical ingredients are not satisfied by one matching item plus an unrelated one', () =>
    Effect.sync(() => {
      // The ambiguity fixture needs two planks. Against a plank next to
      // dirt, the backtracking assignment greedily takes the plank for the
      // first ingredient slot, finds nothing left for the second, and must
      // release (not merely abandon) that choice before it can conclude the
      // recipe does not apply.
      expect(matchedId(gridOf('PX'), AMBIGUOUS_RECIPES)).toBe('NoMatch')
    }),
  )

  it.effect('an identical ingredient pair permutes too, which is the degenerate case', () =>
    Effect.sync(() => {
      // Weaker than the three-distinct case above and kept because it is a
      // different case, not a lesser copy of it: with interchangeable
      // candidates the assignment succeeds on its first choice every time, and
      // this pair is also the shapeless half of the ambiguity below. A diagonal
      // layout avoids the official two-plank pressure-plate recipe.
      expect(matchedId(gridOf('P ', ' P'), AMBIGUOUS_RECIPES)).toBe('test:stick-from-loose-planks')
      expect(matchedId(gridOf('P', 'P', ' '))).toBe('mc-sim:stick')
      expect(matchedId(gridOf('P  ', '  P'), AMBIGUOUS_RECIPES)).toBe('test:stick-from-loose-planks')
    }),
  )
})

describe('the ambiguity rule', () => {
  it.effect('the shaped recipe beats the shapeless one that also matches', () =>
    Effect.sync(() => {
      // Two planks in a column satisfy BOTH mc-sim:stick (shaped) and the
      // test-only loose-plank recipe (shapeless). The outputs differ, so
      // getting this wrong is visible rather than merely theoretical.
      const column = gridOf('P', 'P')
      const match = matchRecipe(AMBIGUOUS_RECIPES, column)

      expect(match._tag).toBe('Match')
      expect(matchedId(column, AMBIGUOUS_RECIPES)).toBe('mc-sim:stick')
      expect(match._tag === 'Match' ? match.output : undefined).toStrictEqual({
        item: 'stick',
        count: 4,
      })
    }),
  )

  it.effect('REGRESSION: the winner does not depend on where the recipe sits in the table', () =>
    Effect.sync(() => {
      const column = gridOf('P', 'P')
      const orderings = [...rotations(AMBIGUOUS_RECIPES), [...AMBIGUOUS_RECIPES].reverse()]
      expect(orderings).toHaveLength(AMBIGUOUS_RECIPES.length + 1)

      for (const table of orderings) {
        expect(matchedId(column, table)).toBe('mc-sim:stick')
      }
    }),
  )

  it.effect('the less specific recipe still wins where the specific one does not apply', () =>
    Effect.sync(() => {
      // A diagonal layout is not the stick SHAPE, so preferring shaped is a
      // preference and not a veto.
      const diagonal = gridOf('P ', ' P')
      expect(matchedId(diagonal, AMBIGUOUS_RECIPES)).toBe('test:stick-from-loose-planks')
      const match = matchRecipe(AMBIGUOUS_RECIPES, diagonal)
      expect(match._tag === 'Match' ? match.output : undefined).toStrictEqual({
        item: 'stick',
        count: 2,
      })
    }),
  )

  it.effect('equally specific matches are decided by id, in either table order', () =>
    Effect.sync(() => {
      const alpha = shapelessRecipe('test:alpha', ['dirt', 'dirt'], itemStack('gravel', 1))
      const beta = shapelessRecipe('test:beta', ['dirt', 'dirt'], itemStack('sand', 1))
      const grid = gridOf('XX')

      expect(matchedId(grid, [alpha, beta])).toBe('test:alpha')
      expect(matchedId(grid, [beta, alpha])).toBe('test:alpha')
    }),
  )

  it.effect('conflictsIn names the pairs the id tie-break has to decide', () =>
    Effect.sync(() => {
      const alpha = shapelessRecipe('test:alpha', ['dirt', 'dirt'], itemStack('gravel', 1))
      const beta = shapelessRecipe('test:beta', ['dirt', 'dirt'], itemStack('sand', 1))

      expect(conflictsIn([beta, alpha])).toStrictEqual([
        { reason: 'same-ingredients', recipeIds: ['test:alpha', 'test:beta'] },
      ])
    }),
  )

  it.effect('conflictsIn reports a duplicate id, which no rule can resolve', () =>
    Effect.sync(() => {
      const one = shapelessRecipe('test:same', ['dirt'], itemStack('gravel', 1))
      const two = shapedRecipe('test:same', ['D'], { D: 'dirt' }, itemStack('sand', 1))

      expect(conflictsIn([one, two])).toStrictEqual([
        { reason: 'duplicate-id', recipeIds: ['test:same', 'test:same'] },
      ])
    }),
  )

  it.effect('a mirrored duplicate is a duplicate — conflictsIn is not fooled by the flip', () =>
    Effect.sync(() => {
      const flipped = shapedRecipe(
        'test:flint-and-steel-mirror',
        [' I', 'F '],
        { I: 'iron_ingot', F: 'flint' },
        itemStack('flint_and_steel', 1),
      )

      // The SHIPPED asymmetric recipe is the left-hand side, so the two halves
      // of the mirror rule — matching and conflict detection — are asserted
      // against one pattern rather than two hand-copied ones, and that pattern
      // is the one mx-ui is handed.
      const shipped = STARTER_RECIPES.filter((recipe) => recipe.id === 'mc-sim:flint-and-steel')
      expect(shipped).toHaveLength(1)

      expect(conflictsIn([...shipped, flipped])).toStrictEqual([
        { reason: 'same-shape', recipeIds: ['mc-sim:flint-and-steel', 'test:flint-and-steel-mirror'] },
      ])
    }),
  )

  it.effect('conflictsIn sorts three-or-more conflicts, and skips a hole in the table', () =>
    Effect.sync(() => {
      // Three recipes, all pairwise conflicting on ingredients, produce THREE
      // conflict entries — enough for `Array.prototype.sort` to actually invoke
      // the comparator (it never does for zero or one element), which is the
      // only way to exercise both of its branches: two entries that share
      // `recipeIds[0]` (tie-broken on `recipeIds[1]`) and two that do not.
      const a = shapelessRecipe('test:conflict-a', ['dirt', 'dirt'], itemStack('gravel', 1))
      const b = shapelessRecipe('test:conflict-b', ['dirt', 'dirt'], itemStack('sand', 1))
      const c = shapelessRecipe('test:conflict-c', ['dirt', 'dirt'], itemStack('bowl', 1))

      // A table with a genuine gap — `table.length` is a plain writable number
      // property, so this is a real hole reachable through `RecipeTable`'s own
      // type, not a cast. `first === undefined || second === undefined` exists
      // for exactly this, and every pairing that touches the gap must be
      // skipped rather than throwing on `.id`.
      const table: Array<Recipe> = [a]
      table[3] = c
      table[2] = b
      // table[1] is the gap; table.length is 4.

      expect(conflictsIn(table)).toStrictEqual([
        { reason: 'same-ingredients', recipeIds: ['test:conflict-a', 'test:conflict-b'] },
        { reason: 'same-ingredients', recipeIds: ['test:conflict-a', 'test:conflict-c'] },
        { reason: 'same-ingredients', recipeIds: ['test:conflict-b', 'test:conflict-c'] },
      ])
    }),
  )

  it.effect('STARTER_RECIPES has no conflicting recipe pairs', () =>
    Effect.sync(() => {
      expect(conflictsIn(STARTER_RECIPES)).toStrictEqual([])
    }),
  )
})

describe('matching is total', () => {
  it.effect('every starter recipe matches its own canonical layout', () =>
    Effect.sync(() => {
      for (const recipe of STARTER_RECIPES) {
        expect({ id: recipe.id, matched: matchedId(canonicalGrid(recipe)) }).toStrictEqual({
          id: recipe.id,
          matched: recipe.id,
        })
      }
    }),
  )

  it.effect('an empty grid makes nothing rather than matching an empty pattern', () =>
    Effect.sync(() => {
      expect(matchedId(craftGrid(3, 3, []))).toBe('NoMatch')
      expect(matchedId(craftGrid(0, 0, []))).toBe('NoMatch')
    }),
  )

  it.effect('a ragged grid reads as empty where it is short, and does not throw', () =>
    Effect.sync(() => {
      // mx-ui builds these from screen state; a short array must produce
      // NoMatch inside a frame, not a defect.
      const ragged: CraftGrid = { width: 3, height: 3, cells: [] }
      expect(matchedId(ragged)).toBe('NoMatch')
      expect(cellAt(ragged, 2, 2)).toBeUndefined()

      const negative: CraftGrid = { width: -2, height: -2, cells: [] }
      expect(matchedId(negative)).toBe('NoMatch')
      expect(cellAt(negative, 0, 0)).toBeUndefined()
    }),
  )

  it.effect('an empty table makes nothing, and says so rather than failing', () =>
    Effect.sync(() => {
      expect(matchRecipe([], gridOf('GG', 'GG'))).toStrictEqual({ _tag: 'NoMatch' })
    }),
  )
})
