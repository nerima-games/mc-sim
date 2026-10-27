import { describe, expect, it, vi } from 'vitest'
import { Result } from 'effect'
import { FixedDurationSecs } from '@nerima-games/mc-kernel'
import {
  BREWING_FUEL_CHARGES,
  BREWING_FUEL_ITEM,
  BREWING_MAX_FUEL_CHARGES,
  BREWING_TIME_SECS,
  STARTER_BREWING_RECIPES,
  VANILLA_BREWING_RECIPES,
} from '../src/domain/brewing-data.js'
import {
  activeBrewingRecipe,
  addBrewingFuel,
  advanceBrewing,
  brewOnce,
  brewingRecipeFor,
  brewingState,
  emptyBrewingState,
  matchBrewingRecipe,
  setBrewingBottle,
  setBrewingIngredient,
  validateBrewingSnapshot,
  type BrewingState,
} from '../src/domain/brewing.js'
import { itemStack as itemStackResult, type ItemStack } from '../src/domain/inventory.js'
import * as itemStackModule from '../src/domain/item-stack.js'

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const itemStack = (...args: Parameters<typeof itemStackResult>): ItemStack =>
  must(itemStackResult(...args))

const withFuel = (state: BrewingState, count = 1) =>
  must(addBrewingFuel(must(brewingState({ ...state, fuel: itemStack(BREWING_FUEL_ITEM, count) }))))

describe('brewing domain', () => {
  it('uses kernel brewing recipes and retains the sim starter table', () => {
    expect(STARTER_BREWING_RECIPES).toHaveLength(4)
    expect(STARTER_BREWING_RECIPES[0]).toMatchObject({
      id: 'mc-sim:awkward-potion',
      ingredient: 'nether_wart',
      input: 'water_bottle',
      output: 'awkward_potion',
    })
    expect(VANILLA_BREWING_RECIPES).toHaveLength(4)
    expect(VANILLA_BREWING_RECIPES[0]?._tag).toBe('Brewing')
    expect(BREWING_FUEL_ITEM).toBe('blaze_powder')
    expect(BREWING_FUEL_CHARGES).toBe(BREWING_MAX_FUEL_CHARGES)
    expect(BREWING_TIME_SECS).toBe(20)
  })

  it('creates complete branded state and preserves validation failures', () => {
    const empty = must(emptyBrewingState())
    expect(empty).toMatchObject({ bottles: [undefined, undefined, undefined], fuelCharges: 0, brewProgressSecs: 0 })
    expect(brewingState({ fuelCharges: -1 })).toMatchObject({ _tag: 'Failure' })
    expect(brewingState({ fuelCharges: 1.5 })).toMatchObject({ _tag: 'Failure' })
    expect(brewingState({ brewProgressSecs: Number.NaN })).toMatchObject({ _tag: 'Failure' })
    expect(brewingState({ brewProgressSecs: BREWING_TIME_SECS + 1 })).toMatchObject({ _tag: 'Failure' })
    expect(brewingState({ bottles: [] })).toMatchObject({ _tag: 'Failure' })
    expect(brewingState({ bottles: [undefined, undefined, 'water_bottle'] })).toMatchObject({ _tag: 'Failure' })
    expect(brewingState(null)).toMatchObject({ _tag: 'Failure' })
  })

  it('updates bottle and ingredient slots without mutating the original state', () => {
    const empty = must(emptyBrewingState())
    const withBottle = must(setBrewingBottle(empty, 1, itemStack('water_bottle', 1)))
    const withIngredient = must(setBrewingIngredient(withBottle, itemStack('nether_wart', 2)))
    expect(empty.bottles[1]).toBeUndefined()
    expect(withIngredient.bottles[1]).toEqual(itemStack('water_bottle', 1))
    expect(withIngredient.ingredient).toEqual(itemStack('nether_wart', 2))
    expect(setBrewingBottle(empty, -1, undefined)).toMatchObject({ _tag: 'Failure' })
    expect(setBrewingBottle(empty, 3, undefined)).toMatchObject({ _tag: 'Failure' })
    expect(setBrewingBottle(empty, 0, 'water_bottle' as never)).toMatchObject({ _tag: 'Failure' })
    expect(setBrewingIngredient(empty, 'nether_wart' as never)).toMatchObject({ _tag: 'Failure' })
  })

  it('matches recipes across the vanilla table and the retained starter table', () => {
    const recipe = VANILLA_BREWING_RECIPES[0]
    const bottle = itemStack('water_bottle', 1)
    const ingredient = itemStack('nether_wart', 1)
    expect(recipe).toBeDefined()
    expect(must(brewingRecipeFor(ingredient, bottle))).toBe(recipe)
    expect(must(brewingRecipeFor(undefined, bottle))).toBeUndefined()
    expect(must(brewingRecipeFor(ingredient, undefined))).toBeUndefined()
    expect(must(brewingRecipeFor(itemStack('sugar', 1), bottle))).toBeUndefined()
    expect(must(matchBrewingRecipe([bottle, undefined, undefined], ingredient))).toBe(recipe)
    expect(must(matchBrewingRecipe([bottle, undefined, undefined], ingredient, STARTER_BREWING_RECIPES))).toMatchObject({
      id: 'mc-sim:awkward-potion',
    })
    expect(must(matchBrewingRecipe([undefined, undefined, undefined], ingredient))).toBeUndefined()
    expect(brewingRecipeFor('bad' as never, bottle)).toMatchObject({ _tag: 'Failure' })
    expect(matchBrewingRecipe([bottle, undefined, undefined], ingredient, [{}] as never)).toMatchObject({ _tag: 'Failure' })
  })

  it('adds bounded fuel only from a blaze powder slot', () => {
    const empty = must(emptyBrewingState())
    expect(must(addBrewingFuel(empty))).toEqual(empty)
    const wrongFuel = must(brewingState({ ...empty, fuel: itemStack('coal', 1) }))
    expect(must(addBrewingFuel(wrongFuel))).toEqual(wrongFuel)
    const loaded = withFuel(empty, 2)
    expect(loaded.fuelCharges).toBe(BREWING_MAX_FUEL_CHARGES)
    expect(loaded.fuel).toEqual(itemStack(BREWING_FUEL_ITEM, 1))
  })

  it('brews every matching bottle, consumes one ingredient and fuel charge, and keeps partial progress', () => {
    let state = must(emptyBrewingState())
    state = must(setBrewingBottle(state, 0, itemStack('water_bottle', 1)))
    state = must(setBrewingBottle(state, 1, itemStack('water_bottle', 1)))
    state = must(setBrewingBottle(state, 2, itemStack('water_bottle', 1)))
    state = must(setBrewingIngredient(state, itemStack('nether_wart', 2)))
    state = withFuel(state, 2)
    expect(must(activeBrewingRecipe(state))?.id).toBe('minecraft:awkward_potion')

    const first = must(advanceBrewing(state, BREWING_TIME_SECS + 5))
    expect(first.brewedCount).toBe(1)
    expect(first.brewed).toBe(1)
    expect(first.state.brewProgressSecs).toBe(0)
    expect(first.state.ingredient).toEqual(itemStack('nether_wart', 1))
    expect(first.state.fuelCharges).toBe(BREWING_MAX_FUEL_CHARGES - 1)
    expect(first.state.bottles).toEqual([
      itemStack('awkward_potion', 1),
      itemStack('awkward_potion', 1),
      itemStack('awkward_potion', 1),
    ])

    const sugar = must(setBrewingIngredient(first.state, itemStack('sugar', 1)))
    const second = must(advanceBrewing(sugar, BREWING_TIME_SECS))
    expect(second.brewedCount).toBe(1)
    expect(second.state.ingredient).toBeUndefined()
    expect(second.state.fuelCharges).toBe(BREWING_MAX_FUEL_CHARGES - 2)
    expect(second.state.bottles.every((bottle) => bottle?.item === 'potion_of_swiftness')).toBe(true)
  })

  it('does not brew mismatched bottles or advance without fuel', () => {
    const mixed = must(brewingState({
      bottles: [itemStack('sugar', 1), itemStack('water_bottle', 1), undefined],
      ingredient: itemStack('nether_wart', 1),
      fuelCharges: 5,
      brewProgressSecs: 7,
    }))
    expect(must(activeBrewingRecipe(mixed))?.id).toBe('minecraft:awkward_potion')
    const unmatched = must(advanceBrewing(mixed, BREWING_TIME_SECS))
    expect(unmatched.brewedCount).toBe(1)
    expect(unmatched.state.bottles[0]?.item).toBe('sugar')
    expect(unmatched.state.bottles[1]?.item).toBe('awkward_potion')
    expect(unmatched.state.brewProgressSecs).toBe(0)

    const ready = must(brewingState({
      bottles: [itemStack('water_bottle', 1), undefined, undefined],
      ingredient: itemStack('nether_wart', 1),
      brewProgressSecs: 4,
    }))
    expect(must(activeBrewingRecipe(ready))).toBeUndefined()
    expect(must(advanceBrewing(ready, 6)).state.brewProgressSecs).toBe(4)
  })

  it('fails invalid elapsed values and invalid recipes without replacing the Result', () => {
    const state = withFuel(must(brewingState({
      bottles: [itemStack('water_bottle', 1), undefined, undefined],
      ingredient: itemStack('nether_wart', 1),
    })))
    expect(advanceBrewing(state, -1)).toMatchObject({ _tag: 'Failure' })
    expect(advanceBrewing(state, Number.NaN)).toMatchObject({ _tag: 'Failure' })
    expect(advanceBrewing(state, Number.POSITIVE_INFINITY)).toMatchObject({ _tag: 'Failure' })
    expect(advanceBrewing(state, 1, [{}] as never)).toMatchObject({ _tag: 'Failure' })
  })

  it('validates complete persisted snapshots and rejects malformed state', () => {
    const state = must(brewingState({
      bottles: [itemStack('water_bottle', 1), undefined, undefined],
      ingredient: itemStack('nether_wart', 1),
      fuel: itemStack('blaze_powder', 1),
      fuelCharges: 2,
      brewProgressSecs: 3,
    }))
    expect(validateBrewingSnapshot(state)).toStrictEqual({ _tag: 'Valid', state })
    expect(validateBrewingSnapshot({ ...state, extra: true })).toMatchObject({ _tag: 'Invalid' })
    expect(validateBrewingSnapshot({ ...state, fuelCharges: -1 })).toMatchObject({ _tag: 'Failure' })
    expect(validateBrewingSnapshot(null)).toMatchObject({ _tag: 'Invalid' })
  })

  it('returns output stack construction failures from a single brew', () => {
    const recipe = VANILLA_BREWING_RECIPES[0]
    if (recipe === undefined) throw new Error('vanilla brewing recipe missing')
    const state = withFuel(must(brewingState({
      bottles: [itemStack(recipe.input, 1), undefined, undefined],
      ingredient: itemStack(recipe.ingredient, 1),
    })))
    const result = brewOnce(state, state.ingredient!, recipe)
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result)) throw result.failure
    expect(result.success.bottles[0]?.item).toBe(recipe.output)
  })

  it('covers persisted aliases, malformed slots, and Result failures without substituting state', () => {
    const validSnapshot = {
      bottles: [null, null, null],
      ingredient: null,
      fuel: null,
      fuelCharges: 0,
      brewProgressSecs: 0,
    }
    expect(validateBrewingSnapshot(validSnapshot)).toMatchObject({ _tag: 'Valid' })
    expect(validateBrewingSnapshot({ ...validSnapshot, bottles: null })).toMatchObject({ _tag: 'Valid' })
    expect(validateBrewingSnapshot({ ...validSnapshot, fuelCharges: -1 })).toMatchObject({ _tag: 'Failure' })
    expect(validateBrewingSnapshot({ ...validSnapshot, bottles: 'invalid' })).toMatchObject({ _tag: 'Invalid' })

    expect(brewingState({ ingredient: { item: 'nether_wart', count: 1 } })).toMatchObject({ _tag: 'Failure' })
    expect(brewingState({ ingredient: { item: 'nether_wart', count: 0, components: {} } })).toMatchObject({ _tag: 'Failure' })
    expect(matchBrewingRecipe([null, undefined, undefined] as never, itemStack('nether_wart', 1))).toMatchObject({ _tag: 'Failure' })
    expect(matchBrewingRecipe([undefined, undefined, undefined], undefined)).toMatchObject({ _tag: 'Success', success: undefined })
    expect(matchBrewingRecipe([undefined, undefined, undefined], itemStack('nether_wart', 1), null as never)).toMatchObject({ _tag: 'Failure' })
    expect(brewingRecipeFor(itemStack('nether_wart', 1), 'bad' as never)).toMatchObject({ _tag: 'Failure' })

    const empty = must(emptyBrewingState())
    const bottles = must(setBrewingBottle(empty, 0, itemStack('water_bottle', 1)))
    expect(setBrewingBottle(bottles, 2, itemStack('water_bottle', 1))).toMatchObject({ _tag: 'Success' })
    const invalidState = { fuelCharges: -1 } as never
    expect(setBrewingBottle(invalidState, 0, undefined)).toMatchObject({ _tag: 'Failure' })
    expect(setBrewingIngredient(invalidState, undefined)).toMatchObject({ _tag: 'Failure' })
    expect(activeBrewingRecipe(invalidState)).toMatchObject({ _tag: 'Failure' })
    expect(addBrewingFuel(invalidState)).toMatchObject({ _tag: 'Failure' })

    const state = must(brewingState({
      bottles: [itemStack('water_bottle', 1), undefined, undefined],
      ingredient: itemStack('nether_wart', 2),
      fuelCharges: 1,
    }))
    const starter = STARTER_BREWING_RECIPES[0]
    const vanilla = VANILLA_BREWING_RECIPES[0]
    const ingredient = state.ingredient
    expect(starter).toBeDefined()
    expect(vanilla).toBeDefined()
    if (starter === undefined || vanilla === undefined || ingredient === undefined) throw new Error('brewing recipe missing')
    expect(Result.isSuccess(brewOnce(state, ingredient, starter))).toBe(true)
    expect(Result.isSuccess(brewOnce(state, ingredient, vanilla))).toBe(true)
    expect(Result.isFailure(brewOnce(state, ingredient, {
      id: 'invalid', input: 'water_bottle', ingredient: 'nether_wart', output: 'unknown_item',
    } as never))).toBe(true)
    expect(Result.isFailure(brewOnce(state, { item: 'nether_wart', count: 0 } as never, starter))).toBe(true)
    const emptyCharges = must(brewingState({ ...state, fuelCharges: 0 }))
    expect(Result.isFailure(brewOnce(emptyCharges, ingredient, starter))).toBe(true)
    expect(Result.isFailure(advanceBrewing(state, 1, null as never))).toBe(true)
    expect(Result.isFailure(advanceBrewing(invalidState, 1))).toBe(true)
    expect(Result.isFailure(advanceBrewing(state, -1))).toBe(true)
    expect(advanceBrewing({ ...state, brewProgressSecs: BREWING_TIME_SECS }, 1)).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'BrewingValidationFailure', path: 'brewProgressSecs' },
    })
    expect(Result.isFailure(brewingState({ fuelCharges: null }))).toBe(true)
    expect(Result.isFailure(brewingState({ brewProgressSecs: null }))).toBe(true)
    expect(validateBrewingSnapshot({ ...validSnapshot, fuelCharges: null })).toMatchObject({ _tag: 'Invalid' })
    expect(validateBrewingSnapshot({ ...validSnapshot, brewProgressSecs: BREWING_TIME_SECS })).toMatchObject({ _tag: 'Invalid' })
  })

  it('validates custom starter and kernel recipe tables', () => {
    const starter = STARTER_BREWING_RECIPES[0]
    const vanilla = VANILLA_BREWING_RECIPES[0]
    if (starter === undefined || vanilla === undefined) throw new Error('brewing recipe missing')
    const state = must(brewingState({
      bottles: [itemStack('water_bottle', 1), undefined, undefined],
      ingredient: itemStack('nether_wart', 2),
      fuelCharges: 2,
    }))

    expect(Result.isSuccess(advanceBrewing(state, 1, [...STARTER_BREWING_RECIPES]))).toBe(true)
    expect(Result.isSuccess(advanceBrewing(state, 1, [...VANILLA_BREWING_RECIPES]))).toBe(true)
    for (const recipe of [
      { ...starter, id: '' },
      { ...starter, input: 'invalid_item' },
      { ...starter, ingredient: 'invalid_item' },
      { ...starter, output: 'invalid_item' },
      { ...starter, _tag: 'Unexpected' },
    ]) {
      expect(Result.isFailure(matchBrewingRecipe(state.bottles, state.ingredient, [recipe] as never))).toBe(true)
    }
  })

  it('returns failures from branded duration and item stack operations', () => {
    const durationFailure = FixedDurationSecs.result(-1)
    const stackFailure = itemStackModule.itemStackWithCount(itemStack(BREWING_FUEL_ITEM, 2), 0)
    if (Result.isSuccess(durationFailure) || Result.isSuccess(stackFailure)) throw new Error('invalid test values unexpectedly passed')
    const active = must(brewingState({
      bottles: [itemStack('water_bottle', 1), undefined, undefined],
      ingredient: itemStack('nether_wart', 2),
      fuelCharges: 2,
    }))
    const empty = must(emptyBrewingState())
    const fuelState = must(brewingState({ fuel: itemStack(BREWING_FUEL_ITEM, 2) }))

    const originalDuration = FixedDurationSecs.result
    const elapsedSpy = vi.spyOn(FixedDurationSecs, 'result').mockImplementation((value) =>
      value === 7 ? Result.fail(durationFailure.failure) : originalDuration(value),
    )
    const elapsedFailure = advanceBrewing(active, 7)
    elapsedSpy.mockRestore()
    expect(Result.isFailure(elapsedFailure)).toBe(true)

    let zeroCalls = 0
    const resetSpy = vi.spyOn(FixedDurationSecs, 'result').mockImplementation((value) => {
      if (value === 0 && ++zeroCalls === 2) return Result.fail(durationFailure.failure)
      return originalDuration(value)
    })
    const resetFailure = advanceBrewing(empty, 1)
    resetSpy.mockRestore()
    expect(Result.isFailure(resetFailure)).toBe(true)

    let oneCalls = 0
    const progressSpy = vi.spyOn(FixedDurationSecs, 'result').mockImplementation((value) => {
      if (value === 1 && ++oneCalls === 2) return Result.fail(durationFailure.failure)
      return originalDuration(value)
    })
    const progressFailure = advanceBrewing(active, 1)
    progressSpy.mockRestore()
    expect(Result.isFailure(progressFailure)).toBe(true)

    let brewZeroCalls = 0
    const brewSpy = vi.spyOn(FixedDurationSecs, 'result').mockImplementation((value) => {
      if (value === 0 && ++brewZeroCalls === 2) return Result.fail(durationFailure.failure)
      return originalDuration(value)
    })
    const brewFailure = advanceBrewing(active, BREWING_TIME_SECS)
    brewSpy.mockRestore()
    expect(Result.isFailure(brewFailure)).toBe(true)

    const stackSpy = vi.spyOn(itemStackModule, 'itemStackWithCount').mockReturnValue(stackFailure)
    const fuelFailure = addBrewingFuel(fuelState)
    stackSpy.mockRestore()
    expect(Result.isFailure(fuelFailure)).toBe(true)
  })
})
