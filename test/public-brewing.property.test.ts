import fc from 'fast-check'
import { Result } from 'effect'
import { expect, it } from 'vitest'
import { isItemStack } from '@nerima-games/mc-kernel'
import * as Sim from '../src/index.js'
import { assertResultContract, finiteTree, hostileNumber, hostileValue, isRecord, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 80 }
const recipe = Sim.STARTER_BREWING_RECIPES[0]
const hostileStack = fc.oneof(
  unknownValue,
  fc.record({ item: hostileValue, count: hostileNumber, components: hostileValue }),
)
const hostileState = fc.oneof(
  unknownValue,
  fc.record({
    bottles: fc.array(hostileStack, { maxLength: 4 }),
    ingredient: hostileStack,
    fuel: hostileStack,
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

it('brewing helpers return typed failures for hostile envelopes without throwing', () => {
  fc.assert(
    fc.property(hostileState, hostileStack, hostileRecipes, hostileNumber, (state, input, recipes, index) => {
      assertResultContract(Sim.brewingState(state))
      assertResultContract(Sim.matchBrewingRecipe(state as never, input as never, recipes as never))
      assertResultContract(Sim.brewingRecipeFor(input as never, state as never, recipes as never))
      assertResultContract(Sim.activeBrewingRecipe(state as never, recipes as never))
      assertResultContract(Sim.setBrewingBottle(state as never, index, input as never))
      assertResultContract(Sim.setBrewingIngredient(state as never, input as never))
      assertResultContract(Sim.consumeIngredient(input as never))
      assertResultContract(Sim.brewOnce(state as never, input as never, recipes as never))
      assertResultContract(Sim.addBrewingFuel(state as never))
    }),
    checks,
  )
})

it('valid brewing helpers preserve branded state and finite item counts', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
      const bottle = Result.getOrThrow(Sim.itemStack(recipe.input, 1))
      const ingredient = Result.getOrThrow(Sim.itemStack(recipe.ingredient, count))
      const fuel = Result.getOrThrow(Sim.itemStack(Sim.BREWING_FUEL_ITEM, 1))
      const state = Result.getOrThrow(Sim.brewingState({
        bottles: [bottle, undefined, undefined],
        ingredient,
        fuel,
        fuelCharges: 1,
      }))

      const matched = Sim.matchBrewingRecipe(state.bottles, state.ingredient, Sim.STARTER_BREWING_RECIPES)
      assertResultContract(matched, (success) => success === undefined || isRecord(success) && typeof success['id'] === 'string')
      expect(Result.getOrThrow(matched)?.id).toBe(recipe.id)

      const setBottle = Sim.setBrewingBottle(state, 1, bottle)
      assertResultContract(setBottle, (success) => Result.isSuccess(Sim.brewingState(success)))

      const setIngredient = Sim.setBrewingIngredient(state, ingredient)
      assertResultContract(setIngredient, (success) => Result.isSuccess(Sim.brewingState(success)))

      const consumed = Sim.consumeIngredient(ingredient)
      assertResultContract(consumed, (success) => success === undefined || isItemStack(success))

      const brewed = Sim.brewOnce(state, ingredient, recipe)
      assertResultContract(brewed, (success) => Result.isSuccess(Sim.brewingState(success)))

      const fueled = Sim.addBrewingFuel(Result.getOrThrow(Sim.brewingState({
        ...state,
        fuelCharges: 0,
      })))
      assertResultContract(fueled, (success) => Result.isSuccess(Sim.brewingState(success)))
      expect(finiteTree(Result.getOrThrow(fueled))).toBe(true)
    }),
    checks,
  )
})
