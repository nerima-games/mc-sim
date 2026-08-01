import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { itemStack, type ItemStack } from '../src/domain/inventory'
import {
  advanceFurnace,
  emptyFurnaceState,
  matchSmeltingRecipe,
  STARTER_SMELTING_RECIPES,
  type FuelRule,
  type FurnaceState,
  type SmeltingRecipe,
} from '../src/domain/smelting'

const furnaceWith = (overrides: Partial<FurnaceState> = {}): FurnaceState => ({
  ...emptyFurnaceState(),
  ...overrides,
})

const uncheckedStack = (item: ItemStack['item'], count: number): ItemStack =>
  ({ item, count }) as unknown as ItemStack

describe('starter smelting data', () => {
  it.effect('raw iron matches the ten-second iron ingot recipe', () =>
    Effect.sync(() => {
      const recipe = matchSmeltingRecipe(STARTER_SMELTING_RECIPES, itemStack('raw_iron', 1))
      expect(recipe).toStrictEqual({
        id: 'mc-sim:iron-ingot',
        input: 'raw_iron',
        output: itemStack('iron_ingot', 1),
        cookDurationSecs: 10,
      })
      expect(matchSmeltingRecipe(STARTER_SMELTING_RECIPES, itemStack('dirt', 1))).toBeNull()
    }),
  )
})

describe('furnace progression', () => {
  it.effect('starting a burn consumes exactly one coal and completion consumes one input', () =>
    Effect.sync(() => {
      const initial = furnaceWith({
        input: itemStack('raw_iron', 2),
        fuel: itemStack('coal', 2),
      })

      const first = advanceFurnace(initial, 9)
      expect(first).toStrictEqual({
        state: {
          input: itemStack('raw_iron', 2),
          fuel: itemStack('coal', 1),
          output: null,
          cookElapsedSecs: 9,
          burnRemainingSecs: 71,
        },
        smelted: 0,
        fuelConsumed: 1,
      })

      const completed = advanceFurnace(first.state, 1)
      expect(completed.state).toStrictEqual({
        input: itemStack('raw_iron', 1),
        fuel: itemStack('coal', 1),
        output: itemStack('iron_ingot', 1),
        cookElapsedSecs: 0,
        burnRemainingSecs: 70,
      })
      expect(completed.smelted).toBe(1)
      expect(completed.fuelConsumed).toBe(0)
      expect(initial).toStrictEqual(
        furnaceWith({ input: itemStack('raw_iron', 2), fuel: itemStack('coal', 2) }),
      )
    }),
  )

  it.effect('a large delta smelts multiple inputs and only burns during active work', () =>
    Effect.sync(() => {
      const outcome = advanceFurnace(
        furnaceWith({ input: itemStack('raw_iron', 2), fuel: itemStack('coal', 1) }),
        100,
      )

      expect(outcome.state).toStrictEqual({
        input: null,
        fuel: null,
        output: itemStack('iron_ingot', 2),
        cookElapsedSecs: 0,
        burnRemainingSecs: 60,
      })
      expect(outcome.smelted).toBe(2)
      expect(outcome.fuelConsumed).toBe(1)
    }),
  )

  it.effect('a large delta can cross fuel boundaries and consume multiple coal', () =>
    Effect.sync(() => {
      const outcome = advanceFurnace(
        furnaceWith({ input: itemStack('raw_iron', 10), fuel: itemStack('coal', 2) }),
        100,
      )

      expect(outcome.state).toStrictEqual({
        input: null,
        fuel: null,
        output: itemStack('iron_ingot', 10),
        cookElapsedSecs: 0,
        burnRemainingSecs: 60,
      })
      expect(outcome.smelted).toBe(10)
      expect(outcome.fuelConsumed).toBe(2)
    }),
  )

  it.effect('input exhaustion stops an existing burn without spending the remaining delta', () =>
    Effect.sync(() => {
      const outcome = advanceFurnace(
        furnaceWith({ input: itemStack('raw_iron', 1), fuel: itemStack('coal', 1) }),
        100,
      )

      expect(outcome.state.input).toBeNull()
      expect(outcome.state.output).toStrictEqual(itemStack('iron_ingot', 1))
      expect(outcome.state.burnRemainingSecs).toBe(70)
    }),
  )

  it.effect('fractional deltas complete exactly at the recipe boundary', () =>
    Effect.sync(() => {
      const almost = advanceFurnace(
        furnaceWith({ input: itemStack('raw_iron', 1), fuel: itemStack('coal', 1) }),
        9.999,
      )
      const completed = advanceFurnace(almost.state, 0.001)

      expect(completed.state.input).toBeNull()
      expect(completed.state.output).toStrictEqual(itemStack('iron_ingot', 1))
      expect(completed.state.cookElapsedSecs).toBe(0)
      expect(completed.state.burnRemainingSecs).toBe(70)
    }),
  )

  it.effect('invalid input resets progress without ticking an existing burn', () =>
    Effect.sync(() => {
      const outcome = advanceFurnace(
        furnaceWith({
          input: itemStack('dirt', 1),
          fuel: itemStack('coal', 1),
          cookElapsedSecs: 6,
          burnRemainingSecs: 30,
        }),
        5,
      )

      expect(outcome.state.cookElapsedSecs).toBe(0)
      expect(outcome.state.burnRemainingSecs).toBe(30)
      expect(outcome.state.fuel).toStrictEqual(itemStack('coal', 1))
    }),
  )

  it.effect('a changed input starts its newly matched recipe from zero progress', () =>
    Effect.sync(() => {
      const recipes = [
        ...STARTER_SMELTING_RECIPES,
        {
          id: 'mc-sim:stone-from-cobblestone',
          input: 'cobblestone' as const,
          output: itemStack('stone', 1),
          cookDurationSecs: 10,
        },
      ]
      const reset = advanceFurnace(
        furnaceWith({
          input: itemStack('dirt', 1),
          cookElapsedSecs: 7,
          burnRemainingSecs: 40,
        }),
        1,
        recipes,
      )
      const changed = advanceFurnace(
        { ...reset.state, input: itemStack('cobblestone', 1) },
        1,
        recipes,
      )

      expect(changed.state.cookElapsedSecs).toBe(1)
      expect(changed.state.burnRemainingSecs).toBe(39)
    }),
  )

  it.effect('wrong or full output resets progress and preserves burn time', () =>
    Effect.sync(() => {
      for (const output of [itemStack('dirt', 1), itemStack('iron_ingot', 64)]) {
        const outcome = advanceFurnace(
          furnaceWith({
            input: itemStack('raw_iron', 1),
            fuel: itemStack('coal', 1),
            output,
            cookElapsedSecs: 4,
            burnRemainingSecs: 20,
          }),
          10,
        )

        expect(outcome.state.cookElapsedSecs).toBe(0)
        expect(outcome.state.burnRemainingSecs).toBe(20)
        expect(outcome.state.output).toStrictEqual(output)
        expect(outcome.smelted).toBe(0)
      }
    }),
  )

  it.effect('output capacity blocks a recipe atomically', () =>
    Effect.sync(() => {
      const recipe = {
        id: 'mc-sim:double-iron-ingot',
        input: 'raw_iron' as const,
        output: itemStack('iron_ingot', 2),
        cookDurationSecs: 10,
      }
      const state = furnaceWith({
        input: itemStack('raw_iron', 1),
        output: itemStack('iron_ingot', 63),
        cookElapsedSecs: 3,
        burnRemainingSecs: 20,
      })
      const outcome = advanceFurnace(state, 10, [recipe])

      expect(outcome.state).toStrictEqual({ ...state, cookElapsedSecs: 0 })
      expect(outcome.smelted).toBe(0)
      expect(outcome.fuelConsumed).toBe(0)
    }),
  )

  it.effect('fuel exhaustion preserves partial cook progress', () =>
    Effect.sync(() => {
      const outcome = advanceFurnace(
        furnaceWith({ input: itemStack('raw_iron', 1), fuel: itemStack('coal', 1) }),
        10,
        STARTER_SMELTING_RECIPES,
        [{ item: 'coal', burnDurationSecs: 4 }],
      )

      expect(outcome.state.cookElapsedSecs).toBe(4)
      expect(outcome.state.burnRemainingSecs).toBe(0)
      expect(outcome.state.input).toStrictEqual(itemStack('raw_iron', 1))
      expect(outcome.state.output).toBeNull()
    }),
  )

  it.effect('non-positive and non-finite deltas are no-ops', () =>
    Effect.sync(() => {
      const state = furnaceWith({ input: itemStack('raw_iron', 1), fuel: itemStack('coal', 1) })
      for (const delta of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const outcome = advanceFurnace(state, delta)
        expect(outcome.state).toBe(state)
        expect(outcome.smelted).toBe(0)
        expect(outcome.fuelConsumed).toBe(0)
      }
    }),
  )
})

describe('furnace boundary validation', () => {
  it.effect('occupied slots reject counts outside their stack bounds', () =>
    Effect.sync(() => {
      const zeroInput = uncheckedStack('raw_iron', 0)
      const excessiveInput = uncheckedStack('raw_iron', 65)
      const excessiveFuel = uncheckedStack('coal', 65)
      const excessiveOutput = uncheckedStack('iron_ingot', 65)

      for (const input of [
        zeroInput,
        excessiveInput,
        uncheckedStack('raw_iron', 1.5),
        uncheckedStack('raw_iron', Number.NaN),
        uncheckedStack('raw_iron', Number.POSITIVE_INFINITY),
      ]) {
        expect(() => advanceFurnace(furnaceWith({ input }), 1)).toThrow(RangeError)
      }
      expect(() => advanceFurnace(furnaceWith({ fuel: excessiveFuel }), 1)).toThrow(RangeError)
      expect(() => advanceFurnace(furnaceWith({ output: excessiveOutput }), 1)).toThrow(RangeError)
    }),
  )

  it.effect('empty furnace slots use null rather than undefined', () =>
    Effect.sync(() => {
      const undefinedInput = { ...furnaceWith(), input: undefined } as unknown as FurnaceState
      expect(() => advanceFurnace(undefinedInput, 1)).toThrow(RangeError)
    }),
  )

  it.effect('timers reject invalid values and completed progress cannot be persisted', () =>
    Effect.sync(() => {
      expect(() =>
        advanceFurnace(furnaceWith({ cookElapsedSecs: Number.NaN }), 1),
      ).toThrow(RangeError)
      expect(() =>
        advanceFurnace(furnaceWith({ burnRemainingSecs: -1 }), 1),
      ).toThrow(RangeError)
      expect(() =>
        advanceFurnace(
          furnaceWith({ input: itemStack('raw_iron', 1), cookElapsedSecs: 10 }),
          1,
        ),
      ).toThrow(RangeError)
    }),
  )

  it.effect('recipes and fuel rules reject invalid durations and stacks', () =>
    Effect.sync(() => {
      const state = furnaceWith({ input: itemStack('raw_iron', 1), fuel: itemStack('coal', 1) })
      const recipe = STARTER_SMELTING_RECIPES[0]
      if (recipe === undefined) throw new Error('starter smelting recipe missing')

      for (const cookDurationSecs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => advanceFurnace(state, 1, [{ ...recipe, cookDurationSecs }])).toThrow(
          RangeError,
        )
      }
      expect(() =>
        advanceFurnace(state, 1, [{ ...recipe, output: uncheckedStack('iron_ingot', 0) }]),
      ).toThrow(RangeError)
      expect(() => advanceFurnace(state, 1, [{ ...recipe, id: '' }])).toThrow(RangeError)
      expect(() =>
        advanceFurnace(state, 1, [
          { ...recipe, input: 'unknown_item' } as unknown as SmeltingRecipe,
        ]),
      ).toThrow(RangeError)

      for (const burnDurationSecs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
          advanceFurnace(state, 1, STARTER_SMELTING_RECIPES, [
            { item: 'coal', burnDurationSecs },
          ]),
        ).toThrow(RangeError)
      }
      expect(() =>
        advanceFurnace(state, 1, STARTER_SMELTING_RECIPES, [
          { item: 'unknown_item', burnDurationSecs: 1 } as unknown as FuelRule,
        ]),
      ).toThrow(RangeError)
    }),
  )
})
