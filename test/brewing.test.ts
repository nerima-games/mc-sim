import { describe, expect, it } from 'vitest'

import {
  BREWING_FUEL_CHARGES,
  BREWING_FUEL_ITEM,
  BREWING_TIME_SECS,
  STARTER_BREWING_RECIPES,
} from '../src/domain/brewing-data'
import {
  activeBrewingRecipe,
  addBrewingFuel,
  advanceBrewing,
  brewingRecipeFor,
  emptyBrewingState,
  setBrewingBottle,
  setBrewingIngredient,
} from '../src/domain/brewing'
import { itemStack } from '../src/domain/inventory'

describe('brewing', () => {
  it('defines the starter brewing chain using kernel item identities', () => {
    expect(STARTER_BREWING_RECIPES).toHaveLength(4)
    expect(STARTER_BREWING_RECIPES[0]).toMatchObject({
      ingredient: 'nether_wart',
      input: 'water_bottle',
      output: 'awkward_potion',
    })
    expect(BREWING_FUEL_ITEM).toBe('blaze_powder')
    expect(BREWING_FUEL_CHARGES).toBe(20)
    expect(BREWING_TIME_SECS).toBe(20)
  })

  it('loads bottles and fuel without mutating the prior state', () => {
    const initial = emptyBrewingState()
    const bottleResult = setBrewingBottle(initial, 1, itemStack('water_bottle', 1))
    expect(bottleResult).toMatchObject({ ok: true })
    if (!bottleResult.ok) throw new Error('expected a valid bottle slot')

    const withIngredient = setBrewingIngredient(
      bottleResult.state,
      itemStack('nether_wart', 2),
    )
    const withFuel = addBrewingFuel(withIngredient, 'blaze_powder', 1)

    expect(initial).toEqual(emptyBrewingState())
    expect(withFuel).toMatchObject({ accepted: 1, leftover: 0 })
    expect(withFuel.state.fuelCharges).toBe(BREWING_FUEL_CHARGES)
    expect(withFuel.state.bottles[1]).toEqual(itemStack('water_bottle', 1))
    expect(withFuel.state.ingredient).toEqual(itemStack('nether_wart', 2))
  })

  it('rejects invalid bottle indexes and fuel inputs', () => {
    const state = emptyBrewingState()
    expect(setBrewingBottle(state, -1, undefined)).toEqual({
      ok: false,
      reason: 'invalid-index',
    })
    expect(setBrewingBottle(state, 3, undefined)).toEqual({
      ok: false,
      reason: 'invalid-index',
    })
    expect(addBrewingFuel(state, 'sugar', 1)).toMatchObject({
      accepted: 0,
      leftover: 1,
    })
    expect(addBrewingFuel(state, 'blaze_powder', 0)).toMatchObject({
      accepted: 0,
      leftover: 0,
    })
    expect(addBrewingFuel(state, 'blaze_powder', Number.NaN)).toMatchObject({
      accepted: 0,
      leftover: 0,
    })
  })

  it('finds only matching recipes', () => {
    const recipe = STARTER_BREWING_RECIPES[0]
    expect(
      brewingRecipeFor(itemStack(recipe.ingredient, 1), itemStack(recipe.input, 1)),
    ).toEqual(recipe)
    expect(brewingRecipeFor(undefined, itemStack(recipe.input, 1))).toBeUndefined()
    expect(brewingRecipeFor(itemStack(recipe.ingredient, 1), undefined)).toBeUndefined()
    expect(
      brewingRecipeFor(itemStack('sugar', 1), itemStack('water_bottle', 1)),
    ).toBeUndefined()
  })

  it('brews all eligible bottles and keeps partial progress', () => {
    const firstBottle = setBrewingBottle(
      emptyBrewingState(),
      0,
      itemStack('water_bottle', 1),
    )
    if (!firstBottle.ok) throw new Error('expected a valid bottle slot')

    const loaded = addBrewingFuel(
      setBrewingIngredient(firstBottle.state, itemStack('nether_wart', 2)),
      'blaze_powder',
      2,
    )
    const secondBottle = setBrewingBottle(
      loaded.state,
      1,
      itemStack('water_bottle', 1),
    )
    if (!secondBottle.ok) throw new Error('expected a valid bottle slot')
    const allBottles = setBrewingBottle(
      secondBottle.state,
      2,
      itemStack('water_bottle', 1),
    )
    if (!allBottles.ok) throw new Error('expected a valid bottle slot')

    const first = advanceBrewing(allBottles.state, BREWING_TIME_SECS + 5)
    expect(first.brewed).toBe(1)
    expect(first.state.brewTimeSecs).toBe(5)
    expect(first.state.ingredient).toEqual(itemStack('nether_wart', 1))
    expect(first.state.fuelCharges).toBe(BREWING_FUEL_CHARGES * 2 - 1)
    expect(first.state.bottles).toEqual([
      itemStack('awkward_potion', 1),
      itemStack('awkward_potion', 1),
      itemStack('awkward_potion', 1),
    ])

    const second = advanceBrewing(
      setBrewingIngredient(first.state, itemStack('sugar', 1)),
      BREWING_TIME_SECS,
    )
    expect(second.brewed).toBe(1)
    expect(second.state.ingredient).toBeUndefined()
    expect(second.state.fuelCharges).toBe(BREWING_FUEL_CHARGES * 2 - 2)
    expect(second.state.bottles).toEqual([
      itemStack('potion_of_swiftness', 1),
      itemStack('potion_of_swiftness', 1),
      itemStack('potion_of_swiftness', 1),
    ])
  })

  it('leaves empty and mismatched bottles untouched', () => {
    const firstBottle = setBrewingBottle(
      emptyBrewingState(),
      0,
      itemStack('water_bottle', 1),
    )
    if (!firstBottle.ok) throw new Error('expected a valid bottle slot')
    const secondBottle = setBrewingBottle(firstBottle.state, 1, itemStack('sugar', 1))
    if (!secondBottle.ok) throw new Error('expected a valid bottle slot')
    const loaded = addBrewingFuel(
      setBrewingIngredient(secondBottle.state, itemStack('nether_wart', 1)),
      'blaze_powder',
      1,
    )

    const result = advanceBrewing(loaded.state, BREWING_TIME_SECS)

    expect(result.brewed).toBe(1)
    expect(result.state.bottles).toEqual([
      itemStack('awkward_potion', 1),
      itemStack('sugar', 1),
      undefined,
    ])
  })

  it('does not advance when the stand cannot brew', () => {
    const bottleOnly = setBrewingBottle(
      emptyBrewingState(),
      0,
      itemStack('water_bottle', 1),
    )
    if (!bottleOnly.ok) throw new Error('expected a valid bottle slot')
    const noFuel = setBrewingIngredient(
      bottleOnly.state,
      itemStack('nether_wart', 1),
    )
    expect(activeBrewingRecipe(noFuel)).toBeUndefined()
    expect(advanceBrewing(noFuel, BREWING_TIME_SECS)).toEqual({
      state: { ...noFuel, brewTimeSecs: BREWING_TIME_SECS },
      brewed: 0,
    })

    const noBottle = addBrewingFuel(
      setBrewingIngredient(emptyBrewingState(), itemStack('nether_wart', 1)),
      'blaze_powder',
      1,
    )
    expect(activeBrewingRecipe(noBottle.state)).toBeUndefined()
    expect(advanceBrewing(noBottle.state, BREWING_TIME_SECS).brewed).toBe(0)
    expect(advanceBrewing(noBottle.state, -1)).toEqual({ state: noBottle.state, brewed: 0 })
    expect(advanceBrewing(noBottle.state, Number.POSITIVE_INFINITY)).toEqual({
      state: noBottle.state,
      brewed: 0,
    })

    const noIngredient = {
      ...noBottle.state,
      brewTimeSecs: BREWING_TIME_SECS,
      ingredient: undefined,
    }
    expect(advanceBrewing(noIngredient, 0)).toEqual({ state: noIngredient, brewed: 0 })
  })
})
