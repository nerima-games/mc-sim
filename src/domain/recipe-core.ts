import { ItemType } from '@nerima-games/mc-kernel'

import { itemStack, type ItemStack, type Slot } from './inventory'

export type RecipeId = string

export type Ingredient = {
  readonly _tag: 'Exact'
  readonly item: ItemType
}

export const exactly = (item: ItemType): Ingredient => ({ _tag: 'Exact', item })

export const ingredientMatches = (ingredient: Ingredient, item: ItemType): boolean =>
  ingredient._tag === 'Exact' && ingredient.item === item

export type PatternCell = Ingredient | undefined

export type RecipePattern = {
  readonly width: number
  readonly height: number
  readonly cells: ReadonlyArray<PatternCell>
}

export type ShapedRecipe = {
  readonly _tag: 'Shaped'
  readonly id: RecipeId
  readonly pattern: RecipePattern
  readonly output: ItemStack
}

export type ShapelessRecipe = {
  readonly _tag: 'Shapeless'
  readonly id: RecipeId
  readonly ingredients: ReadonlyArray<Ingredient>
  readonly output: ItemStack
}

export type Recipe = ShapedRecipe | ShapelessRecipe

export type RecipeTable = ReadonlyArray<Recipe>

export type CraftGrid = {
  readonly width: number
  readonly height: number
  readonly cells: ReadonlyArray<Slot>
}

export const craftGrid = (
  width: number,
  height: number,
  items: ReadonlyArray<ItemType | undefined>,
): CraftGrid => ({
  width,
  height,
  cells: Array.from({ length: Math.max(0, width * height) }, (_unused, index) => {
    const item = items[index]
    return item === undefined ? undefined : itemStack(item, 1)
  }),
})

export const cellAt = (grid: CraftGrid, x: number, y: number): Slot =>
  x < 0 || y < 0 || x >= grid.width || y >= grid.height ? undefined : grid.cells[y * grid.width + x]

const trimPattern = (rows: ReadonlyArray<string>, key: Readonly<Record<string, ItemType>>): RecipePattern => {
  const rawHeight = rows.length
  const rawWidth = rows.reduce((widest, row) => Math.max(widest, row.length), 0)

  const rawCellAt = (x: number, y: number): PatternCell => {
    const character = (rows[y] ?? '')[x]
    const item = character === undefined ? undefined : key[character]
    return item === undefined ? undefined : exactly(item)
  }

  let minX = rawWidth
  let minY = rawHeight
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < rawHeight; y += 1) {
    for (let x = 0; x < rawWidth; x += 1) {
      if (rawCellAt(x, y) === undefined) {
        continue
      }
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < 0) {
    return { width: 0, height: 0, cells: [] }
  }

  const width = maxX - minX + 1
  const height = maxY - minY + 1

  return {
    width,
    height,
    cells: Array.from({ length: width * height }, (_unused, index) =>
      rawCellAt(minX + (index % width), minY + Math.floor(index / width)),
    ),
  }
}

export const shapedRecipe = (
  id: RecipeId,
  rows: ReadonlyArray<string>,
  key: Readonly<Record<string, ItemType>>,
  output: ItemStack,
): ShapedRecipe => ({ _tag: 'Shaped', id, pattern: trimPattern(rows, key), output })

export const shapelessRecipe = (
  id: RecipeId,
  items: ReadonlyArray<ItemType>,
  output: ItemStack,
): ShapelessRecipe => ({ _tag: 'Shapeless', id, ingredients: items.map(exactly), output })
