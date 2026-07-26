/**
 * The recipe model: shaped matching under translation and mirroring, shapeless
 * matching under permutation, and the ambiguity rule.
 *
 * Test names follow docs/testing.md §4.5 — they name the FAILURE, so that a red
 * line says what broke rather than which function was called.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { ItemId, itemStack } from '../domain/inventory'
import {
  cellAt,
  conflictsIn,
  CraftGrid,
  craftGrid,
  matchRecipe,
  RecipeTable,
  shapedRecipe,
  shapelessRecipe,
  STARTER_RECIPES,
} from '../domain/recipe'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEGEND: Readonly<Record<string, ItemId>> = {
  P: 'OAK_PLANKS',
  S: 'STICK',
  I: 'IRON_INGOT',
  F: 'FLINT',
  L: 'OAK_LOG',
  G: 'GUNPOWDER',
  B: 'BLAZE_POWDER',
  C: 'COAL',
  D: 'DIRT',
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
  cells: ReadonlyArray<readonly [number, number, ItemId]>,
): CraftGrid => {
  const items: Array<ItemId | undefined> = Array.from({ length: width * height }, () => undefined)
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

// ---------------------------------------------------------------------------

describe('shaped matching translates', () => {
  it.effect('a 2x2 shape is the SAME recipe at all four positions in a 3x3 grid', () =>
    Effect.sync(() => {
      const positions = [0, 1].flatMap((y) => [0, 1].map((x) => [x, y] as const))
      expect(positions).toHaveLength(4)

      for (const [ox, oy] of positions) {
        const grid = placeAt(3, 3, [
          [ox, oy, 'OAK_PLANKS'],
          [ox + 1, oy, 'OAK_PLANKS'],
          [ox, oy + 1, 'OAK_PLANKS'],
          [ox + 1, oy + 1, 'OAK_PLANKS'],
        ])
        expect({ ox, oy, id: matchedId(grid) }).toStrictEqual({
          ox,
          oy,
          id: 'mc-sim:crafting-table',
        })
      }
    }),
  )

  it.effect('a 1x2 shape is the SAME recipe at all six positions in a 3x3 grid', () =>
    Effect.sync(() => {
      const positions = [0, 1].flatMap((y) => [0, 1, 2].map((x) => [x, y] as const))
      expect(positions).toHaveLength(6)

      for (const [ox, oy] of positions) {
        const grid = placeAt(3, 3, [
          [ox, oy, 'OAK_PLANKS'],
          [ox, oy + 1, 'OAK_PLANKS'],
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

  it.effect('a 3x3 recipe cannot be reached from the player 2x2 grid', () =>
    Effect.sync(() => {
      // No rule says so: the occupied box of a 2x2 grid can never be 3x3.
      expect(matchedId(gridOf('PP', 'S '))).toBe('NoMatch')
      expect(matchedId(gridOf('PP', 'PP'))).toBe('mc-sim:crafting-table')
    }),
  )

  it.effect('a pattern written with a spare border is the same pattern, not a second recipe', () =>
    Effect.sync(() => {
      const padded = shapedRecipe(
        'test:crafting-table-padded',
        ['   ', ' PP', ' PP'],
        { P: 'OAK_PLANKS' },
        itemStack('CRAFTING_TABLE', 1),
      )
      expect(padded.pattern.width).toBe(2)
      expect(padded.pattern.height).toBe(2)
      expect(matchedId(gridOf('PP ', 'PP ', '   '), [padded])).toBe('test:crafting-table-padded')

      // ...and the table checker sees the two as the duplicate they are.
      const both = STARTER_RECIPES.filter((recipe) => recipe.id === 'mc-sim:crafting-table')
      expect(conflictsIn([...both, padded])).toStrictEqual([
        { reason: 'same-shape', recipeIds: ['mc-sim:crafting-table', 'test:crafting-table-padded'] },
      ])
    }),
  )
})

describe('shaped matching mirrors horizontally, and only horizontally', () => {
  it.effect('an asymmetric shape matches its left-right mirror, as vanilla does', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('I ', ' F'))).toBe('mc-sim:flint-and-steel')
      expect(matchedId(gridOf(' I', 'F '))).toBe('mc-sim:flint-and-steel')
    }),
  )

  it.effect('the mirror travels with the translation, at every position', () =>
    Effect.sync(() => {
      for (const [ox, oy] of [0, 1].flatMap((y) => [0, 1].map((x) => [x, y] as const))) {
        const mirrored = placeAt(3, 3, [
          [ox + 1, oy, 'IRON_INGOT'],
          [ox, oy + 1, 'FLINT'],
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
})

describe('shapeless matching permutes', () => {
  it.effect('every permutation of the ingredients is the same recipe', () =>
    Effect.sync(() => {
      const orders = permutations(['G', 'B', 'C'])
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
      expect(matchedId(gridOf('G B', '   ', '  C'))).toBe('mc-sim:fire-charge')
      expect(matchedId(gridOf('  C', ' B ', 'G  '))).toBe('mc-sim:fire-charge')
    }),
  )

  it.effect('an extra item defeats the match instead of being ignored', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('GBC'))).toBe('mc-sim:fire-charge')
      expect(matchedId(gridOf('GBC', 'D  '))).toBe('NoMatch')
      // A duplicate of a required item is an extra item too.
      expect(matchedId(gridOf('GBC', 'C  '))).toBe('NoMatch')
    }),
  )

  it.effect('a missing item defeats the match', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('GB '))).toBe('NoMatch')
    }),
  )
})

describe('the ambiguity rule', () => {
  it.effect('the shaped recipe beats the shapeless one that also matches', () =>
    Effect.sync(() => {
      // Two planks in a column satisfy BOTH mc-sim:stick (shaped) and
      // mc-sim:stick-from-loose-planks (shapeless). The outputs differ, so
      // getting this wrong is visible rather than merely theoretical.
      const column = gridOf('P', 'P')
      const match = matchRecipe(STARTER_RECIPES, column)

      expect(match._tag).toBe('Match')
      expect(matchedId(column)).toBe('mc-sim:stick')
      expect(match._tag === 'Match' ? match.output : undefined).toStrictEqual({
        item: 'STICK',
        count: 4,
      })
    }),
  )

  it.effect('REGRESSION: the winner does not depend on where the recipe sits in the table', () =>
    Effect.sync(() => {
      const column = gridOf('P', 'P')
      const orderings = [...rotations(STARTER_RECIPES), [...STARTER_RECIPES].reverse()]
      expect(orderings).toHaveLength(STARTER_RECIPES.length + 1)

      for (const table of orderings) {
        expect(matchedId(column, table)).toBe('mc-sim:stick')
      }
    }),
  )

  it.effect('the less specific recipe still wins where the specific one does not apply', () =>
    Effect.sync(() => {
      // Side by side is not the stick SHAPE, so preferring shaped is a
      // preference and not a veto.
      expect(matchedId(gridOf('PP'))).toBe('mc-sim:stick-from-loose-planks')
      const match = matchRecipe(STARTER_RECIPES, gridOf('PP'))
      expect(match._tag === 'Match' ? match.output : undefined).toStrictEqual({
        item: 'STICK',
        count: 2,
      })
    }),
  )

  it.effect('equally specific matches are decided by id, in either table order', () =>
    Effect.sync(() => {
      const alpha = shapelessRecipe('test:alpha', ['DIRT', 'DIRT'], itemStack('MUD', 1))
      const beta = shapelessRecipe('test:beta', ['DIRT', 'DIRT'], itemStack('CLAY', 1))
      const grid = gridOf('DD')

      expect(matchedId(grid, [alpha, beta])).toBe('test:alpha')
      expect(matchedId(grid, [beta, alpha])).toBe('test:alpha')
    }),
  )

  it.effect('conflictsIn names the pairs the id tie-break has to decide', () =>
    Effect.sync(() => {
      const alpha = shapelessRecipe('test:alpha', ['DIRT', 'DIRT'], itemStack('MUD', 1))
      const beta = shapelessRecipe('test:beta', ['DIRT', 'DIRT'], itemStack('CLAY', 1))

      expect(conflictsIn([beta, alpha])).toStrictEqual([
        { reason: 'same-ingredients', recipeIds: ['test:alpha', 'test:beta'] },
      ])
    }),
  )

  it.effect('conflictsIn reports a duplicate id, which no rule can resolve', () =>
    Effect.sync(() => {
      const one = shapelessRecipe('test:same', ['DIRT'], itemStack('MUD', 1))
      const two = shapedRecipe('test:same', ['D'], { D: 'DIRT' }, itemStack('CLAY', 1))

      expect(conflictsIn([one, two])).toStrictEqual([
        { reason: 'duplicate-id', recipeIds: ['test:same', 'test:same'] },
      ])
    }),
  )

  it.effect('a mirrored duplicate is a duplicate — conflictsIn is not fooled by the flip', () =>
    Effect.sync(() => {
      const original = shapedRecipe(
        'test:diagonal',
        ['I ', ' F'],
        { I: 'IRON_INGOT', F: 'FLINT' },
        itemStack('FLINT_AND_STEEL', 1),
      )
      const flipped = shapedRecipe(
        'test:diagonal-mirror',
        [' I', 'F '],
        { I: 'IRON_INGOT', F: 'FLINT' },
        itemStack('FLINT_AND_STEEL', 1),
      )

      expect(conflictsIn([original, flipped])).toStrictEqual([
        { reason: 'same-shape', recipeIds: ['test:diagonal', 'test:diagonal-mirror'] },
      ])
    }),
  )

  it.effect('STARTER_RECIPES leans on specificity, never on the id tie-break', () =>
    Effect.sync(() => {
      // The shaped/shapeless stick pair is deliberate and is resolved by rule.
      // Anything reported here would be resolved by alphabet, which is the
      // situation conflictsIn exists to make impossible to ship unnoticed.
      expect(conflictsIn(STARTER_RECIPES)).toStrictEqual([])
    }),
  )
})

describe('matching is total', () => {
  it.effect('every starter recipe matches its own canonical layout', () =>
    Effect.sync(() => {
      const canonical: ReadonlyArray<readonly [string, CraftGrid]> = [
        ['mc-sim:oak-planks', gridOf('L')],
        ['mc-sim:fire-charge', gridOf('GBC')],
        ['mc-sim:stick', gridOf('P', 'P')],
        ['mc-sim:stick-from-loose-planks', gridOf('PP')],
        ['mc-sim:crafting-table', gridOf('PP', 'PP')],
        ['mc-sim:flint-and-steel', gridOf('I ', ' F')],
        ['mc-sim:wooden-pickaxe', gridOf('PPP', ' S ', ' S ')],
      ]

      // Every recipe is covered: a new entry with no canonical grid fails here,
      // and so does a shapedRecipe whose legend drops a character.
      expect(canonical.map(([id]) => id).sort()).toStrictEqual(
        STARTER_RECIPES.map((recipe) => recipe.id).sort(),
      )
      for (const [id, grid] of canonical) {
        expect({ id, matched: matchedId(grid) }).toStrictEqual({ id, matched: id })
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
      expect(matchRecipe([], gridOf('PP', 'PP'))).toStrictEqual({ _tag: 'NoMatch' })
    }),
  )
})
