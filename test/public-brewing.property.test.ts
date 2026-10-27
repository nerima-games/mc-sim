import fc from 'fast-check'
import { Result } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { assertResultContract, hostileItemStack, hostileNumber, hostileValue, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 80 }
const recipe = Sim.STARTER_BREWING_RECIPES[0]
const hostileState = fc.oneof(
  unknownValue,
  fc.record({
    bottles: fc.array(hostileItemStack, { maxLength: 4 }),
    ingredient: hostileItemStack,
    fuel: hostileItemStack,
    fuelCharges: hostileNumber,
    brewProgressSecs: hostileNumber,
  }),
)
const hostileRecipe = fc.oneof(
  unknownValue,
  fc.record({ id: hostileValue, input: hostileValue, ingredient: hostileValue, output: hostileValue }),
)
const hostileRecipes = fc.oneof(unknownValue, fc.array(hostileRecipe, { maxLength: 4 }))

if (recipe === undefined) throw new Error('starter brewing recipe missing')

const validInputs = (count: number) => {
  const bottle = Result.getOrThrow(Sim.itemStack(recipe.input, 1))
  const ingredient = Result.getOrThrow(Sim.itemStack(recipe.ingredient, count))
  const fuel = Result.getOrThrow(Sim.itemStack(Sim.BREWING_FUEL_ITEM, 1))
  const state = Result.getOrThrow(Sim.brewingState({
    bottles: [bottle, undefined, undefined],
    ingredient,
    fuel,
    fuelCharges: 1,
  }))
  return { bottle, ingredient, fuel, state }
}

it('brewing helpers return typed failures for hostile envelopes without throwing', () => {
  fc.assert(
    fc.property(hostileState, hostileItemStack, hostileRecipes, hostileNumber, (state, input, recipes, index) => {
      assertResultContract('brewingState', () => Sim.brewingState(state), Sim.BrewingStateSchema, Sim.BrewingFailureSchema)
      assertResultContract('matchBrewingRecipe', () => Sim.matchBrewingRecipe(state as never, input as never, recipes as never), Sim.BrewingRecipeOptionSchema, Sim.BrewingFailureSchema)
      assertResultContract('brewingRecipeFor', () => Sim.brewingRecipeFor(input as never, state as never, recipes as never), Sim.BrewingRecipeOptionSchema, Sim.BrewingFailureSchema)
      assertResultContract('activeBrewingRecipe', () => Sim.activeBrewingRecipe(state as never, recipes as never), Sim.BrewingRecipeOptionSchema, Sim.BrewingFailureSchema)
      assertResultContract('setBrewingBottle', () => Sim.setBrewingBottle(state as never, index, input as never), Sim.BrewingStateSchema, Sim.BrewingFailureSchema)
      assertResultContract('setBrewingIngredient', () => Sim.setBrewingIngredient(state as never, input as never), Sim.BrewingStateSchema, Sim.BrewingFailureSchema)
      assertResultContract('consumeIngredient', () => Sim.consumeIngredient(input as never), Sim.BrewingItemSlotSchema, Sim.ItemStackFailureSchema)
      assertResultContract('brewOnce', () => Sim.brewOnce(state as never, input as never, recipes as never), Sim.BrewingStateSchema, Sim.BrewingFailureSchema)
      assertResultContract('addBrewingFuel', () => Sim.addBrewingFuel(state as never), Sim.BrewingStateSchema, Sim.BrewingFailureSchema)
    }),
    checks,
  )
})

it('matchBrewingRecipe returns a schema-valid recipe for valid inputs', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
    const { state } = validInputs(count)
    const matched = Sim.matchBrewingRecipe(state.bottles, state.ingredient, Sim.STARTER_BREWING_RECIPES)
    assertResultContract('matchBrewingRecipe.valid', () => matched, Sim.BrewingRecipeOptionSchema, Sim.BrewingFailureSchema)
    expect(Result.getOrThrow(matched)?.id).toBe(recipe.id)
  }), checks)
})

it('setBrewingBottle returns a schema-valid state for a valid bottle', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
    const { bottle, state } = validInputs(count)
    const result = Sim.setBrewingBottle(state, 1, bottle)
    assertResultContract('setBrewingBottle.valid', () => result, Sim.BrewingStateSchema, Sim.BrewingFailureSchema)
  }), checks)
})

it('setBrewingIngredient returns a schema-valid state for a valid ingredient', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
    const { ingredient, state } = validInputs(count)
    const result = Sim.setBrewingIngredient(state, ingredient)
    assertResultContract('setBrewingIngredient.valid', () => result, Sim.BrewingStateSchema, Sim.BrewingFailureSchema)
  }), checks)
})

it('consumeIngredient returns a schema-valid slot for valid ingredient counts', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
    const { ingredient } = validInputs(count)
    const result = Sim.consumeIngredient(ingredient)
    assertResultContract('consumeIngredient.valid', () => result, Sim.BrewingItemSlotSchema, Sim.ItemStackFailureSchema)
  }), checks)
})

it('brewOnce returns a schema-valid state for valid brewing inputs', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
    const { ingredient, state } = validInputs(count)
    const result = Sim.brewOnce(state, ingredient, recipe)
    assertResultContract('brewOnce.valid', () => result, Sim.BrewingStateSchema, Sim.BrewingFailureSchema)
  }), checks)
})

it('addBrewingFuel returns a schema-valid state for valid fuel', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
    const { state } = validInputs(count)
    const noFuelCharges = Result.getOrThrow(Sim.brewingState({ ...state, fuelCharges: 0 }))
    const result = Sim.addBrewingFuel(noFuelCharges)
    assertResultContract('addBrewingFuel.valid', () => result, Sim.BrewingStateSchema, Sim.BrewingFailureSchema)
  }), checks)
})
