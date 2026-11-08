import { Effect, Result } from 'effect'
import { expect, it } from '@effect/vitest'
import { makeInventoryService } from '../src/application/inventory-service.js'
import { craftGrid } from '../src/domain/recipe.js'
import { VANILLA_CRAFTING_RECIPES } from '../src/domain/recipe-data.js'

it.effect('defaults inventory crafting to kernel recipes, including charcoal torches', () =>
  Effect.gen(function* () {
    const service = yield* makeInventoryService()
    yield* service.add('charcoal', 1)
    yield* service.add('stick', 1)

    expect(yield* service.recipes).toBe(VANILLA_CRAFTING_RECIPES)
    expect(yield* service.craft(Result.getOrThrow(craftGrid(1, 2, ['charcoal', 'stick'])))).toMatchObject({
      _tag: 'Crafted',
      recipeId: 'minecraft:torch',
      output: { item: 'torch', count: 4 },
    })
    expect(yield* service.countOf('charcoal')).toBe(0)
    expect(yield* service.countOf('stick')).toBe(0)
    expect(yield* service.countOf('torch')).toBe(4)
  }),
)
