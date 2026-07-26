/**
 * The recipe model: shaped matching under translation and mirroring, shapeless
 * matching under permutation, and the ambiguity rule.
 *
 * Test names follow docs/testing.md §4.5 — they name the FAILURE, so that a red
 * line says what broke rather than which function was called.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { itemStack } from '../domain/inventory'
import { ItemType } from '../domain/kernel-vocabulary'
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

/**
 * Every letter is a member of kernel's `ITEM_TYPES`, because `ItemType` is a
 * closed union now and a legend of invented names would not compile. That is
 * the point of the repoint and it is worth noticing here: this legend used to
 * be free to say `'FLINT'`.
 *
 * `A`, `B` and `C` are not the items of any recipe this game ships. They belong
 * to the local tables below, which exercise matcher rules that `STARTER_RECIPES`
 * can no longer demonstrate — see `domain/recipe.ts`'s table header for why the
 * recipes that used to demonstrate them were trimmed rather than reinvented out
 * of whatever items were to hand.
 */
const LEGEND: Readonly<Record<string, ItemType>> = {
  P: 'oak_planks',
  S: 'stick',
  L: 'oak_log',
  G: 'glowstone_dust',
  D: 'dirt',
  A: 'stone',
  B: 'sand',
  C: 'gravel',
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
// Local tables for the two rules the shipped table cannot show any more
// ---------------------------------------------------------------------------

/**
 * An ASYMMETRIC shaped recipe: a diagonal, so its horizontal mirror is a
 * different layout and both must match.
 *
 * `STARTER_RECIPES` used to carry vanilla's flint and steel for this, and it was
 * trimmed because `flint`, `iron_ingot` and `flint_and_steel` are not in
 * kernel's roster and mc-sim does not get to add them (`domain/recipe.ts`).
 * NOTHING VANILLA IS ASYMMETRIC OVER THE SIXTEEN ITEMS THAT DO EXIST, so the
 * choice was between inventing a recipe for the shipped table and putting the
 * fixture where fixtures go. This is the fixture.
 *
 * It is a local table rather than a `STARTER_RECIPES` entry on purpose: nothing
 * here claims the game can make a torch out of stone and sand, and a reader of
 * `InventoryService.recipes` will never see it.
 */
const MIRROR_TABLE: RecipeTable = [
  shapedRecipe('test:diagonal', ['A ', ' B'], { A: 'stone', B: 'sand' }, itemStack('torch', 1)),
]

/**
 * A shapeless recipe with three DISTINCT ingredients — permutation with
 * something to permute.
 *
 * The trimmed original was vanilla's fire charge (gunpowder, blaze powder,
 * coal). Two identical planks, which is what the shipped table still has, put
 * the backtracking assignment through only one arrangement; three distinct
 * items put it through six.
 */
const PERMUTATION_TABLE: RecipeTable = [
  shapelessRecipe('test:three-distinct', ['stone', 'sand', 'gravel'], itemStack('glass', 3)),
]

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
})

/*
 * Both blocks below run against LOCAL tables, and every assertion passes
 * `MIRROR_TABLE` / `PERMUTATION_TABLE` explicitly rather than defaulting to
 * `STARTER_RECIPES`.
 *
 * That is the whole visible consequence of the trim, and it is deliberate that
 * it is visible: the rules are matcher rules and are covered exactly as tightly
 * as before, but the SHIPPED table no longer contains a case for either, so a
 * reader who wants to know what the game can make and a reader who wants to know
 * what the matcher does are now reading two different lists.
 */
describe('shaped matching mirrors horizontally, and only horizontally', () => {
  it.effect('an asymmetric shape matches its left-right mirror, as vanilla does', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('A ', ' B'), MIRROR_TABLE)).toBe('test:diagonal')
      expect(matchedId(gridOf(' A', 'B '), MIRROR_TABLE)).toBe('test:diagonal')
    }),
  )

  it.effect('the mirror travels with the translation, at every position', () =>
    Effect.sync(() => {
      for (const [ox, oy] of [0, 1].flatMap((y) => [0, 1].map((x) => [x, y] as const))) {
        const mirrored = placeAt(3, 3, [
          [ox + 1, oy, 'stone'],
          [ox, oy + 1, 'sand'],
        ])
        expect({ ox, oy, id: matchedId(mirrored, MIRROR_TABLE) }).toStrictEqual({
          ox,
          oy,
          id: 'test:diagonal',
        })
      }
    }),
  )

  it.effect('a vertical flip is NOT a mirror — a shape upside down is a different shape', () =>
    Effect.sync(() => {
      // Vertically flipping `A./.B` gives `.B/A.`, which is neither the pattern
      // nor its horizontal mirror. Accepting it would invent recipes.
      expect(matchedId(gridOf(' B', 'A '), MIRROR_TABLE)).toBe('NoMatch')
      expect(matchedId(gridOf('B ', ' A'), MIRROR_TABLE)).toBe('NoMatch')
    }),
  )

  it.effect('REGRESSION: no shipped recipe distinguishes the mirror, so only the above does', () =>
    Effect.sync(() => {
      // Every pattern in `STARTER_RECIPES` is its own horizontal mirror, which
      // is a fact about the trimmed table and not a coincidence — see
      // `domain/recipe.ts`. Deleting the mirroring branch of `matchesShaped`
      // would therefore leave the shipped table entirely green, and this line
      // exists so that the next reader does not conclude the rule is unused.
      const shaped = STARTER_RECIPES.filter((recipe) => recipe._tag === 'Shaped')
      expect(shaped.length).toBeGreaterThan(0)

      for (const recipe of shaped) {
        const { width, height, cells } = recipe.pattern
        const flipped = Array.from({ length: width * height }, (_unused, index) => {
          const x = index % width
          const y = Math.floor(index / width)
          return cells[y * width + (width - 1 - x)]
        })
        expect({ id: recipe.id, cells: flipped }).toStrictEqual({ id: recipe.id, cells: [...cells] })
      }
    }),
  )
})

describe('shapeless matching permutes', () => {
  it.effect('every permutation of the ingredients is the same recipe', () =>
    Effect.sync(() => {
      const orders = permutations(['A', 'B', 'C'])
      expect(orders).toHaveLength(6)

      for (const order of orders) {
        expect({ order, id: matchedId(gridOf(order.join('')), PERMUTATION_TABLE) }).toStrictEqual({
          order,
          id: 'test:three-distinct',
        })
      }
    }),
  )

  it.effect('position is irrelevant, not merely reorderable within a row', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('A B', '   ', '  C'), PERMUTATION_TABLE)).toBe('test:three-distinct')
      expect(matchedId(gridOf('  C', ' B ', 'A  '), PERMUTATION_TABLE)).toBe('test:three-distinct')
    }),
  )

  it.effect('an extra item defeats the match instead of being ignored', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('ABC'), PERMUTATION_TABLE)).toBe('test:three-distinct')
      expect(matchedId(gridOf('ABC', 'D  '), PERMUTATION_TABLE)).toBe('NoMatch')
      // A duplicate of a required item is an extra item too.
      expect(matchedId(gridOf('ABC', 'C  '), PERMUTATION_TABLE)).toBe('NoMatch')
    }),
  )

  it.effect('a missing item defeats the match', () =>
    Effect.sync(() => {
      expect(matchedId(gridOf('AB '), PERMUTATION_TABLE)).toBe('NoMatch')
    }),
  )

  it.effect('the shipped table still permutes, with the one ingredient pair it has', () =>
    Effect.sync(() => {
      // Weaker than the three-distinct case above and kept anyway: it is the
      // only permutation assertion that runs against what mx-ui will be handed.
      expect(matchedId(gridOf('PP'))).toBe('mc-sim:stick-from-loose-planks')
      expect(matchedId(gridOf('P', 'P', ' '))).toBe('mc-sim:stick')
      expect(matchedId(gridOf('P  ', '  P'))).toBe('mc-sim:stick-from-loose-planks')
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
        item: 'stick',
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
        item: 'stick',
        count: 2,
      })
    }),
  )

  it.effect('equally specific matches are decided by id, in either table order', () =>
    Effect.sync(() => {
      const alpha = shapelessRecipe('test:alpha', ['dirt', 'dirt'], itemStack('gravel', 1))
      const beta = shapelessRecipe('test:beta', ['dirt', 'dirt'], itemStack('sand', 1))
      const grid = gridOf('DD')

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
        'test:diagonal-mirror',
        [' A', 'B '],
        { A: 'stone', B: 'sand' },
        itemStack('torch', 1),
      )

      // `MIRROR_TABLE`'s own recipe is the left-hand side, so the two halves of
      // the mirror rule — matching and conflict detection — are asserted against
      // one pattern rather than two hand-copied ones.
      expect(conflictsIn([...MIRROR_TABLE, flipped])).toStrictEqual([
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
        ['mc-sim:stick', gridOf('P', 'P')],
        ['mc-sim:stick-from-loose-planks', gridOf('PP')],
        ['mc-sim:glowstone', gridOf('GG', 'GG')],
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
      expect(matchRecipe([], gridOf('GG', 'GG'))).toStrictEqual({ _tag: 'NoMatch' })
    }),
  )
})
