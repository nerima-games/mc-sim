import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  addItem,
  countOf,
  emptyInventory,
  INVENTORY_SLOT_COUNT,
  itemStack,
  type Inventory,
  type ItemStack,
} from '../src/domain/inventory'
import {
  advanceFurnace,
  collectFurnaceOutput,
  emptyFurnaceState,
  matchSmeltingRecipe,
  STARTER_FUEL_RULES,
  STARTER_SMELTING_RECIPES,
  transferToFurnace,
  validateFurnaceSnapshot,
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
  it.effect('each starter input has one ten-second output recipe', () =>
    Effect.sync(() => {
      const expected = [
        ['raw_iron', 'iron_ingot'],
        ['cobblestone', 'stone'],
        ['sand', 'glass'],
      ] as const

      for (const [input, output] of expected) {
        expect(matchSmeltingRecipe(STARTER_SMELTING_RECIPES, itemStack(input, 1))).toMatchObject({
          input,
          output: itemStack(output, 1),
          cookDurationSecs: 10,
        })
      }
      expect(matchSmeltingRecipe(STARTER_SMELTING_RECIPES, itemStack('dirt', 1))).toBeNull()
    }),
  )

  it.effect('starter recipe ids, inputs, and fuel items are unique', () =>
    Effect.sync(() => {
      const recipeIds = STARTER_SMELTING_RECIPES.map((recipe) => recipe.id)
      const inputs = STARTER_SMELTING_RECIPES.map((recipe) => recipe.input)
      const fuelItems = STARTER_FUEL_RULES.map((rule) => rule.item)

      expect(new Set(recipeIds).size).toBe(recipeIds.length)
      expect(new Set(inputs).size).toBe(inputs.length)
      expect(new Set(fuelItems).size).toBe(fuelItems.length)
    }),
  )

  it.effect('starter fuels expose the intended burn durations', () =>
    Effect.sync(() => {
      expect(STARTER_FUEL_RULES).toStrictEqual([
        { item: 'coal', burnDurationSecs: 80 },
        { item: 'coal_block', burnDurationSecs: 800 },
        { item: 'oak_log', burnDurationSecs: 15 },
        { item: 'oak_planks', burnDurationSecs: 15 },
        { item: 'stick', burnDurationSecs: 5 },
      ])
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

  it.effect('a fuel item with no matching fuel rule stops progress rather than burning', () =>
    Effect.sync(() => {
      // `dirt` is a real, known item — so it clears `assertSlot` — but no
      // starter fuel rule names it, which is a different failure than an empty
      // fuel slot and must be refused the same way rather than defaulting to
      // some duration.
      const outcome = advanceFurnace(
        furnaceWith({ input: itemStack('raw_iron', 1), fuel: itemStack('dirt', 1) }),
        5,
      )

      expect(outcome.state.burnRemainingSecs).toBe(0)
      expect(outcome.state.fuel).toStrictEqual(itemStack('dirt', 1))
      expect(outcome.smelted).toBe(0)
      expect(outcome.fuelConsumed).toBe(0)
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

describe('inventory-backed furnace progression', () => {
  it.effect('moves player-owned ore and fuel through smelting and collection', () =>
    Effect.sync(() => {
      let inventory = emptyInventory()
      inventory = addItem(inventory, 'raw_iron', 3).inventory
      inventory = addItem(inventory, 'coal', 1).inventory

      const input = transferToFurnace(inventory, emptyFurnaceState(), 'input', 'raw_iron', 3)
      expect(input.result).toStrictEqual({ _tag: 'Transferred', item: 'raw_iron', count: 3 })
      expect(countOf(input.inventory, 'raw_iron')).toBe(0)

      const fuel = transferToFurnace(input.inventory, input.furnace, 'fuel', 'coal', 1)
      expect(countOf(fuel.inventory, 'coal')).toBe(0)

      const smelted = advanceFurnace(fuel.furnace, 30)
      expect(smelted.smelted).toBe(3)
      expect(smelted.state.output).toStrictEqual(itemStack('iron_ingot', 3))

      const collected = collectFurnaceOutput(fuel.inventory, smelted.state)
      expect(collected.result).toStrictEqual({
        _tag: 'Collected',
        output: itemStack('iron_ingot', 3),
      })
      expect(countOf(collected.inventory, 'iron_ingot')).toBe(3)
      expect(collected.furnace.output).toBeNull()
    }),
  )

  it.effect('leaves both states unchanged when a transfer cannot complete', () =>
    Effect.sync(() => {
      const inventory = addItem(emptyInventory(), 'raw_iron', 1).inventory
      const furnace = furnaceWith({ input: itemStack('cobblestone', 1) })

      const insufficient = transferToFurnace(inventory, emptyFurnaceState(), 'input', 'raw_iron', 2)
      expect(insufficient.result).toStrictEqual({ _tag: 'InsufficientItems', available: 1 })
      expect(insufficient.inventory).toBe(inventory)

      const wrongItem = transferToFurnace(inventory, furnace, 'input', 'raw_iron', 1)
      expect(wrongItem.result).toStrictEqual({ _tag: 'WrongItem', expected: 'cobblestone' })
      expect(wrongItem.inventory).toBe(inventory)
      expect(wrongItem.furnace).toBe(furnace)
    }),
  )

  it.effect('a zero, negative, or non-integer count is refused before anything else is checked', () =>
    Effect.sync(() => {
      const inventory = addItem(emptyInventory(), 'raw_iron', 5).inventory

      for (const count of [0, -1, 1.5]) {
        const outcome = transferToFurnace(inventory, emptyFurnaceState(), 'input', 'raw_iron', count)
        expect(outcome.result).toStrictEqual({ _tag: 'InvalidCount', count })
        expect(outcome.inventory).toBe(inventory)
      }
    }),
  )

  it.effect('transferring into an already-occupied slot accumulates onto it, up to its capacity', () =>
    Effect.sync(() => {
      const inventory = addItem(emptyInventory(), 'raw_iron', 63).inventory
      const partiallyFilled = furnaceWith({ input: itemStack('raw_iron', 5) })

      // Fits: 64 (max) - 5 (already there) = 59 room, and only 3 are asked for.
      const fits = transferToFurnace(inventory, partiallyFilled, 'input', 'raw_iron', 3)
      expect(fits.result).toStrictEqual({ _tag: 'Transferred', item: 'raw_iron', count: 3 })
      expect(fits.furnace.input).toStrictEqual(itemStack('raw_iron', 8))

      // Does not fit: the slot already holds 60, and 60 + 60 would exceed 64.
      const nearlyFull = furnaceWith({ input: itemStack('raw_iron', 60) })
      const tooMuch = transferToFurnace(inventory, nearlyFull, 'input', 'raw_iron', 60)
      expect(tooMuch.result).toStrictEqual({ _tag: 'NoRoom', available: 4 })
      expect(tooMuch.inventory).toBe(inventory)
      expect(tooMuch.furnace).toBe(nearlyFull)
    }),
  )

  it.effect('collecting an empty furnace changes nothing', () =>
    Effect.sync(() => {
      const inventory = addItem(emptyInventory(), 'raw_iron', 1).inventory
      const furnace = emptyFurnaceState()
      const outcome = collectFurnaceOutput(inventory, furnace)

      expect(outcome.result).toStrictEqual({ _tag: 'Empty' })
      expect(outcome.inventory).toBe(inventory)
      expect(outcome.furnace).toBe(furnace)
    }),
  )

  it.effect('does not partially collect output when the inventory is full', () =>
    Effect.sync(() => {
      const inventory: Inventory = {
        slots: Array.from({ length: INVENTORY_SLOT_COUNT }, () => itemStack('cobblestone', 64)),
      }
      const furnace = furnaceWith({ output: itemStack('iron_ingot', 3) })
      const outcome = collectFurnaceOutput(inventory, furnace)

      expect(outcome.result).toStrictEqual({ _tag: 'NoRoom' })
      expect(outcome.inventory).toBe(inventory)
      expect(outcome.furnace).toBe(furnace)
    }),
  )

  it.effect('validates JSON round trips and rejects corrupt persisted state', () =>
    Effect.sync(() => {
      const state = furnaceWith({
        input: itemStack('raw_iron', 2),
        fuel: itemStack('coal', 1),
        cookElapsedSecs: 4,
        burnRemainingSecs: 76,
      })
      expect(validateFurnaceSnapshot(JSON.parse(JSON.stringify(state)))).toStrictEqual({
        _tag: 'Valid',
        state,
      })
      expect(validateFurnaceSnapshot({ ...state, burnRemainingSecs: -1 })).toMatchObject({
        _tag: 'Invalid',
        error: { path: 'burnRemainingSecs' },
      })
      expect(validateFurnaceSnapshot({ ...state, extra: true })).toMatchObject({
        _tag: 'Invalid',
        error: { path: 'snapshot' },
      })
    }),
  )

  it.effect('rejects a malformed, foreign, or overcounted slot inside an otherwise-valid snapshot', () =>
    Effect.sync(() => {
      const state = furnaceWith({ input: itemStack('raw_iron', 2), fuel: itemStack('coal', 1) })

      // Not `null` and not `{ item, count }` at all.
      expect(validateFurnaceSnapshot({ ...state, input: 'raw_iron' })).toMatchObject({
        _tag: 'Invalid',
        error: { path: 'input', reason: 'expected null or exactly { item, count }' },
      })
      // The right shape, missing `count`.
      expect(validateFurnaceSnapshot({ ...state, input: { item: 'raw_iron' } })).toMatchObject({
        _tag: 'Invalid',
        error: { path: 'input', reason: 'expected null or exactly { item, count }' },
      })

      // A well-shaped slot naming an item this build has no vocabulary for.
      expect(
        validateFurnaceSnapshot({ ...state, fuel: { item: 'unknown_item', count: 1 } }),
      ).toMatchObject({
        _tag: 'Invalid',
        error: { path: 'fuel.item', reason: 'expected a known item' },
      })

      // A well-shaped, well-known slot with a count outside its stack bound.
      expect(
        validateFurnaceSnapshot({ ...state, output: { item: 'iron_ingot', count: 0 } }),
      ).toMatchObject({
        _tag: 'Invalid',
        error: { path: 'output.count', reason: 'expected a valid positive stack count' },
      })
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

  it.effect('a slot naming an item this build has no vocabulary for is refused, not smelted', () =>
    Effect.sync(() => {
      // The cast bypasses the type system the way a foreign or hand-edited save
      // does; `validateFurnaceSnapshot` is the guard on the way IN from
      // persistence, and this is the guard `advanceFurnace` itself still
      // carries for a `FurnaceState` built any other way.
      const foreignInput = { item: 'unknown_item', count: 1 } as unknown as ItemStack
      expect(() => advanceFurnace(furnaceWith({ input: foreignInput }), 1)).toThrow(RangeError)
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
