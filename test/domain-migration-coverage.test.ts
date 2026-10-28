import { afterEach, describe, expect, it, vi } from 'vitest'
import { Result } from 'effect'
import {
  ITEM_TYPES,
  NON_PLACEABLE_ITEM_TYPES,
  PLACEABLE_ITEM_TYPES,
  StackCount,
} from '@nerima-games/mc-kernel'
import { placeableBlockFromItem } from '../src/domain/block-interaction'
import {
  addBrewingFuel as addBrewingFuelResult,
  advanceBrewing,
  brewingState,
  emptyBrewingState as emptyBrewingStateResult,
  setBrewingBottle as setBrewingBottleResult,
  setBrewingIngredient as setBrewingIngredientResult,
  type BrewingState,
} from '../src/domain/brewing'
import { BREWING_TIME_SECS, STARTER_BREWING_RECIPES } from '../src/domain/brewing-data'
import { STARTER_SMELTING_RECIPES } from '../src/domain/smelting-data'
import { validateCropSnapshot } from '../src/domain/crop'
import { DEFAULT_SETTINGS, isValidSettings } from '../src/domain/settings'
import { itemStack as itemStackResult, type ItemStack } from '../src/domain/inventory'
import {
  advanceFurnace,
  collectFurnaceOutput,
  emptyFurnaceState as emptyFurnaceStateResult,
  transferToFurnace,
  validateFurnaceSnapshot,
  type FurnaceState,
} from '../src/domain/smelting'
import { emptyInventory } from '../src/domain/inventory'

const dependencyFailures = vi.hoisted(() => ({
  missingBlockType: '',
  failNextBlockAxisResult: false,
  itemStackFailureMode: 0,
  itemStackWithCountFailureOnCall: 0,
  failStarterRecipes: false,
}))

vi.mock('@nerima-games/mc-kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nerima-games/mc-kernel')>()
  const { Option } = await import('effect')
  return {
    ...actual,
    blockIdOf: (type: Parameters<typeof actual.blockIdOf>[0]) =>
      dependencyFailures.missingBlockType === type ? Option.none() : actual.blockIdOf(type),
  }
})

vi.mock('@nerima-games/mc-kernel/domain/coordinates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nerima-games/mc-kernel/domain/coordinates')>()
  const BlockAxis = Object.assign(
    (value: Parameters<typeof actual.BlockAxis>[0]) => actual.BlockAxis(value),
    {
      ...actual.BlockAxis,
      result: (value: Parameters<typeof actual.BlockAxis.result>[0]) => {
        if (dependencyFailures.failNextBlockAxisResult) {
          dependencyFailures.failNextBlockAxisResult = false
          return actual.BlockAxis.result(Number.NaN)
        }
        return actual.BlockAxis.result(value)
      },
    },
  )
  return { ...actual, BlockAxis }
})

vi.mock('../src/domain/inventory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/domain/inventory')>()
  return {
    ...actual,
    itemStack: (...args: Parameters<typeof actual.itemStack>) => {
      const [item, , options] = args
      if (dependencyFailures.itemStackFailureMode === 1 ||
        (dependencyFailures.itemStackFailureMode === 2 && options?.components !== undefined)) {
        dependencyFailures.itemStackFailureMode = 0
        return actual.itemStack(item, 0, options)
      }
      return actual.itemStack(...args)
    },
  }
})

vi.mock('../src/domain/item-stack', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/domain/item-stack')>()
  return {
    ...actual,
    itemStackWithCount: (...args: Parameters<typeof actual.itemStackWithCount>) => {
      if (dependencyFailures.itemStackWithCountFailureOnCall > 0) {
        dependencyFailures.itemStackWithCountFailureOnCall -= 1
        if (dependencyFailures.itemStackWithCountFailureOnCall === 0) {
          return actual.itemStackWithCount(args[0], 0)
        }
      }
      return actual.itemStackWithCount(...args)
    },
  }
})

vi.mock('../src/domain/smelting-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/domain/smelting-data')>()
  const { Result: EffectResult } = await import('effect')
  const invalidCount = StackCount.result(0)
  const failedRecipes = EffectResult.isFailure(invalidCount)
    ? EffectResult.fail(invalidCount.failure)
    : actual.STARTER_SMELTING_RECIPES
  return {
    ...actual,
    get STARTER_SMELTING_RECIPES() {
      return dependencyFailures.failStarterRecipes ? failedRecipes : actual.STARTER_SMELTING_RECIPES
    },
  }
})

afterEach(() => {
  dependencyFailures.missingBlockType = ''
  dependencyFailures.failNextBlockAxisResult = false
  dependencyFailures.itemStackFailureMode = 0
  dependencyFailures.itemStackWithCountFailureOnCall = 0
  dependencyFailures.failStarterRecipes = false
})

const itemStack = (...args: Parameters<typeof itemStackResult>): ItemStack => {
  const result = itemStackResult(...args)
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const failureOf = <A, E>(result: Result.Result<A, E>): E => {
  if (Result.isSuccess(result)) throw new Error('expected a Result failure')
  return result.failure
}

const emptyBrewingState = (): BrewingState => must(emptyBrewingStateResult())

const setBrewingBottle = (state: BrewingState, index: number, bottle: ItemStack | undefined): BrewingState =>
  must(setBrewingBottleResult(state, index, bottle))

const setBrewingIngredient = (state: BrewingState, ingredient: ItemStack | undefined): BrewingState =>
  must(setBrewingIngredientResult(state, ingredient))

const addBrewingFuel = (state: BrewingState, item: ItemStack['item'], count: number) => ({
  state: must(addBrewingFuelResult(must(brewingState({ ...state, fuel: itemStack(item, count) })))),
})

const emptyFurnaceState = (): FurnaceState => must(emptyFurnaceStateResult())

const withBottle = (
  state: BrewingState,
  index: number,
  bottle: ItemStack,
) => setBrewingBottle(state, index, bottle)

describe('domain migration coverage', () => {
  it('propagates a missing block registry id for the mapped type', () => {
    dependencyFailures.missingBlockType = 'stone'
    expect(failureOf(placeableBlockFromItem('stone'))).toStrictEqual({
      _tag: 'BlockRegistryFailure',
      reason: 'missing-block-row',
      message: 'No block registry row is registered for block type "stone"',
    })
  })

  it('maps all registered placeable items and rejects every non-placeable item', () => {
    expect(new Set(PLACEABLE_ITEM_TYPES).size).toBe(PLACEABLE_ITEM_TYPES.length)
    expect(
      PLACEABLE_ITEM_TYPES.map(placeableBlockFromItem).every(
        (result) => Result.isSuccess(result) && result.success !== undefined,
      ),
    ).toBe(true)
    expect(
      NON_PLACEABLE_ITEM_TYPES.map(placeableBlockFromItem).every(
        (result) => Result.isSuccess(result) && result.success === undefined,
      ),
    ).toBe(true)
    expect(ITEM_TYPES).toHaveLength(PLACEABLE_ITEM_TYPES.length + NON_PLACEABLE_ITEM_TYPES.length)
  })

  it('keeps the first mismatched bottle while brewing a matching later bottle', () => {
    const [recipe] = STARTER_BREWING_RECIPES
    if (recipe === undefined) throw new Error('starter brewing recipe missing')
    const firstBottle = withBottle(emptyBrewingState(), 0, itemStack('sugar', 1))
    const secondBottle = withBottle(firstBottle, 1, itemStack(recipe.input, 1))
    const loaded = addBrewingFuel(
      setBrewingIngredient(
        secondBottle,
        itemStack(recipe.ingredient, 1),
      ),
      'blaze_powder',
      1,
    )

    const result = advanceBrewing(loaded.state, BREWING_TIME_SECS)

    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isFailure(result)) throw result.failure
    expect(result.success).toMatchObject({
      state: {
        bottles: [itemStack('sugar', 1), itemStack(recipe.output, 1), undefined],
        ingredient: undefined,
        fuel: undefined,
        fuelCharges: 19,
        brewProgressSecs: 0,
      },
      brewedCount: 1,
      brewed: 1,
    })
  })

  it('propagates an output stack failure instead of reporting a completed brew', () => {
    const [recipe] = STARTER_BREWING_RECIPES
    if (recipe === undefined) throw new Error('starter brewing recipe missing')
    const state = setBrewingIngredient(
      withBottle(emptyBrewingState(), 0, itemStack(recipe.input, 1)),
      itemStack(recipe.ingredient, 1),
    )
    const loaded = addBrewingFuel(state, 'blaze_powder', 1)

    const expectedFailure = failureOf(itemStackResult(recipe.output, 0))
    dependencyFailures.itemStackFailureMode = 1
    const result = advanceBrewing(loaded.state, BREWING_TIME_SECS)

    expect(failureOf(result)).toStrictEqual(expectedFailure)
  })

  it('normalizes negative zero coordinates and rejects unsafe integer coordinates', () => {
    const normalized = validateCropSnapshot({
      crops: [{
        dimension: 'overworld',
        position: { x: -0, y: 64, z: -0 },
        crop: 'wheat_crop',
        growthSecs: 0,
      }],
    })
    expect(normalized._tag).toBe('Valid')
    if (normalized._tag !== 'Valid') throw new Error('expected a valid crop snapshot')
    const crop = normalized.snapshot.crops[0]
    if (crop === undefined) throw new Error('expected the normalized crop')
    expect(crop.position).toStrictEqual({ x: 0, y: 64, z: 0 })
    expect(Object.is(crop.position.x, -0)).toBe(false)
    expect(Object.is(crop.position.z, -0)).toBe(false)

    expect(validateCropSnapshot({
      crops: [{
        dimension: 'overworld',
        position: { x: Number.MAX_SAFE_INTEGER + 1, y: 64, z: 0 },
        crop: 'wheat_crop',
        growthSecs: 0,
      }],
    })).toStrictEqual({
      _tag: 'Invalid',
      error: {
        _tag: 'CropValidationError',
        path: 'crops[0].position',
        reason: 'coordinates must be safe integers',
      },
    })
  })

  it('rejects a crop position when the axis brand reports a validation failure', () => {
    dependencyFailures.failNextBlockAxisResult = true

    expect(validateCropSnapshot({
      crops: [{
        dimension: 'overworld',
        position: { x: 0, y: 64, z: 0 },
        crop: 'wheat_crop',
        growthSecs: 0,
      }],
    })).toStrictEqual({
      _tag: 'Invalid',
      error: {
        _tag: 'CropValidationError',
        path: 'crops[0].position',
        reason: 'coordinates must be safe integers',
      },
    })
  })

  it('rejects non-record settings and malformed key-binding maps', () => {
    expect(isValidSettings(null)).toBe(false)
    expect(isValidSettings([])).toBe(false)
    expect(isValidSettings({ ...DEFAULT_SETTINGS, keyBindings: [] })).toBe(false)
    expect(isValidSettings({ ...DEFAULT_SETTINGS, keyBindings: { '': 'KeyQ' } })).toBe(false)
    expect(isValidSettings({ ...DEFAULT_SETTINGS, keyBindings: { jump: 1 } })).toBe(false)
    expect(isValidSettings({ ...DEFAULT_SETTINGS, keyBindings: { jump: '' } })).toBe(false)
  })

  it('rejects a malformed furnace output without changing the inventory', () => {
    const inventory = emptyInventory()
    const output = { ...itemStack('iron_ingot', 1) }
    expect(Reflect.set(output, 'item', 'unknown_item')).toBe(true)
    const furnace = { ...emptyFurnaceState(), output }
    const result = collectFurnaceOutput(inventory, furnace)

    expect(result.result).toStrictEqual({ _tag: 'InvalidInput', field: 'furnace' })
    expect(result.inventory).toBe(inventory)
    expect(result.furnace).toBe(furnace)
  })

  it('propagates stack-construction failures while validating a furnace snapshot', () => {
    const stack = itemStack('raw_iron', 1)
    const snapshot = { ...emptyFurnaceState(), input: stack }
    const expectedFailure = failureOf(itemStackResult('raw_iron', 0))
    dependencyFailures.itemStackFailureMode = 1

    expect(validateFurnaceSnapshot(snapshot)).toStrictEqual({
      _tag: 'BrandFailure',
      error: expectedFailure,
    })
  })

  it('propagates a failure rebuilding a validated furnace stack', () => {
    const stack = itemStack('raw_iron', 1)
    const snapshot = { ...emptyFurnaceState(), input: stack }
    const expectedFailure = failureOf(itemStackResult('raw_iron', 0, { components: stack.components }))
    dependencyFailures.itemStackFailureMode = 2

    expect(validateFurnaceSnapshot(snapshot)).toStrictEqual({
      _tag: 'BrandFailure',
      error: expectedFailure,
    })
  })

  it('propagates a starter-recipe Result failure before furnace work starts', () => {
    const expectedFailure = failureOf(StackCount.result(0))
    dependencyFailures.failStarterRecipes = true

    expect(failureOf(STARTER_SMELTING_RECIPES)).toStrictEqual(expectedFailure)
  })

  it('preserves inventory and furnace state when reducing an input stack fails', () => {
    const inventory = { slots: [itemStack('raw_iron', 2)] }
    const furnace = emptyFurnaceState()
    const expectedFailure = failureOf(itemStackResult('raw_iron', 0))
    dependencyFailures.itemStackWithCountFailureOnCall = 1

    const result = transferToFurnace(inventory, furnace, 'input', 'raw_iron', 1)

    expect(result.result).toStrictEqual({ _tag: 'ItemStackFailure', error: expectedFailure })
    expect(result.inventory).toBe(inventory)
    expect(result.furnace).toBe(furnace)
  })

  it('preserves inventory and furnace state when constructing the destination stack fails', () => {
    const inventory = { slots: [itemStack('raw_iron', 1)] }
    const furnace = emptyFurnaceState()
    const expectedFailure = failureOf(itemStackResult('raw_iron', 0))
    dependencyFailures.itemStackWithCountFailureOnCall = 1

    const result = transferToFurnace(inventory, furnace, 'input', 'raw_iron', 1)

    expect(result.result).toStrictEqual({ _tag: 'ItemStackFailure', error: expectedFailure })
    expect(result.inventory).toBe(inventory)
    expect(result.furnace).toBe(furnace)
  })

  it('propagates fuel decrement failures without returning a furnace outcome', () => {
    const expectedFailure = failureOf(itemStackResult('coal', 0))
    const state = {
      ...emptyFurnaceState(),
      input: itemStack('raw_iron', 1),
      fuel: itemStack('coal', 2),
    }
    dependencyFailures.itemStackWithCountFailureOnCall = 1

    expect(failureOf(advanceFurnace(state, 1))).toStrictEqual(expectedFailure)
  })

  it('propagates input decrement failures after fuel is consumed', () => {
    const expectedFailure = failureOf(itemStackResult('raw_iron', 0))
    const state = {
      ...emptyFurnaceState(),
      input: itemStack('raw_iron', 2),
      fuel: itemStack('coal', 2),
    }
    dependencyFailures.itemStackWithCountFailureOnCall = 2

    expect(failureOf(advanceFurnace(state, 10))).toStrictEqual(expectedFailure)
  })

  it('propagates output merge failures after a recipe completes', () => {
    const expectedFailure = failureOf(itemStackResult('iron_ingot', 0))
    const state = {
      ...emptyFurnaceState(),
      input: itemStack('raw_iron', 1),
      fuel: itemStack('coal', 1),
      output: itemStack('iron_ingot', 1),
    }
    dependencyFailures.itemStackWithCountFailureOnCall = 1

    expect(failureOf(advanceFurnace(state, 10))).toStrictEqual(expectedFailure)
  })
})
