import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import { FixedDurationSecs, RepairCost } from '@nerima-games/mc-kernel'
import { vi } from 'vitest'
import {
  addItem as addItemResult,
  countOf,
  emptyInventory,
  INVENTORY_SLOT_COUNT,
  itemStack as itemStackResult,
  type ItemStack,
  type Inventory,
} from '../src/domain/inventory'
import {
  advanceFurnace as advanceFurnaceResult,
  collectFurnaceOutput as collectFurnaceOutputResult,
  emptyFurnaceState as emptyFurnaceStateResult,
  furnaceState,
  matchSmeltingRecipe as matchSmeltingRecipeResult,
  transferToFurnace as transferToFurnaceResult,
  validateFurnaceSnapshot as validateFurnaceSnapshotResult,
  type FurnaceState,
  type FuelRuleInput,
  type SmeltingRecipeInput,
} from '../src/domain/smelting'
import {
  STARTER_FUEL_RULES,
  STARTER_SMELTING_RECIPES as starterSmeltingRecipesResult,
  VANILLA_FUEL_RULES,
  VANILLA_SMELTING_RECIPES,
} from '../src/domain/smelting-data'

const requireSuccess = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const itemStack = (...args: Parameters<typeof itemStackResult>): ItemStack =>
  requireSuccess(itemStackResult(...args))
const addItem = (...args: Parameters<typeof addItemResult>) => requireSuccess(addItemResult(...args))
const STARTER_SMELTING_RECIPES = requireSuccess(starterSmeltingRecipesResult)

type LegacyFurnaceState = Readonly<{
  readonly input: ItemStack | null
  readonly fuel: ItemStack | null
  readonly output: ItemStack | null
  readonly cookElapsedSecs: number
  readonly burnRemainingSecs: number
}>

const toFurnaceState = (state: LegacyFurnaceState): FurnaceState => requireSuccess(furnaceState({
  station: 'furnace',
  input: state.input ?? undefined,
  fuel: state.fuel ?? undefined,
  output: state.output ?? undefined,
  cookProgressSecs: state.cookElapsedSecs,
  fuelTimeRemainingSecs: state.burnRemainingSecs,
  fuelTimeTotalSecs: state.burnRemainingSecs,
}))
const fromFurnaceState = (state: FurnaceState): LegacyFurnaceState => ({
  input: state.input === undefined ? null : requireSuccess(itemStackResult(state.input.item, state.input.count, { components: state.input.components })),
  fuel: state.fuel === undefined ? null : requireSuccess(itemStackResult(state.fuel.item, state.fuel.count, { components: state.fuel.components })),
  output: state.output === undefined ? null : requireSuccess(itemStackResult(state.output.item, state.output.count, { components: state.output.components })),
  cookElapsedSecs: state.cookProgressSecs,
  burnRemainingSecs: state.fuelTimeRemainingSecs,
})
const emptyFurnaceState = (): LegacyFurnaceState => fromFurnaceState(requireSuccess(emptyFurnaceStateResult()))
const advanceFurnace = (
  state: LegacyFurnaceState,
  elapsedSecs: number,
  recipes?: ReadonlyArray<SmeltingRecipeInput>,
  fuels?: ReadonlyArray<FuelRuleInput>,
) => {
  const outcome = requireSuccess(advanceFurnaceResult(toFurnaceState(state), elapsedSecs, recipes, fuels))
  return { state: fromFurnaceState(outcome.state), smelted: outcome.smeltedCount, fuelConsumed: outcome.fuelConsumed }
}
const matchSmeltingRecipe = (recipes: ReadonlyArray<SmeltingRecipeInput>, input: ItemStack | undefined) =>
  requireSuccess(matchSmeltingRecipeResult(input, 'furnace', recipes)) ?? null
const transferToFurnace = (
  inventory: Inventory,
  furnace: LegacyFurnaceState,
  slot: 'input' | 'fuel',
  item: ItemStack['item'],
  count: number,
) => {
  const outcome = transferToFurnaceResult(inventory, toFurnaceState(furnace), slot, item, count)
  return {
    ...outcome,
    furnace: outcome.result._tag === 'Transferred' ? fromFurnaceState(outcome.furnace) : furnace,
  }
}
const collectFurnaceOutput = (inventory: Inventory, furnace: LegacyFurnaceState) => {
  const outcome = collectFurnaceOutputResult(inventory, toFurnaceState(furnace))
  return {
    ...outcome,
    furnace: outcome.result._tag === 'Collected' ? fromFurnaceState(outcome.furnace) : furnace,
  }
}
const validateFurnaceSnapshot = (value: unknown) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return validateFurnaceSnapshotResult(value)
  const raw = value as Record<string, unknown> & Partial<LegacyFurnaceState>
  const snapshot = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'cookElapsedSecs' && key !== 'burnRemainingSecs'))
  const result = validateFurnaceSnapshotResult({
    ...snapshot,
    station: 'furnace',
    input: raw.input ?? undefined,
    fuel: raw.fuel ?? undefined,
    output: raw.output ?? undefined,
    fuelTimeRemainingSecs: raw.burnRemainingSecs ?? 0,
    fuelTimeTotalSecs: raw.burnRemainingSecs ?? 0,
    cookProgressSecs: raw.cookElapsedSecs ?? 0,
  })
  return result._tag === 'Valid' ? { ...result, state: fromFurnaceState(result.state) } : result
}

const furnaceWith = (overrides: Partial<LegacyFurnaceState> = {}): LegacyFurnaceState => ({
  ...emptyFurnaceState(),
  ...overrides,
})

describe('starter smelting data', () => {
  it.effect('each supported starter input has one ten-second output recipe', () =>
    Effect.sync(() => {
      const expected = [
        ['raw_iron', 'iron_ingot'],
        ['cobblestone', 'stone'],
        ['sand', 'glass'],
        ['coal_ore', 'coal'],
        ['deepslate_coal_ore', 'coal'],
        ['iron_ore', 'iron_ingot'],
        ['deepslate_iron_ore', 'iron_ingot'],
        ['diamond_ore', 'diamond'],
        ['deepslate_diamond_ore', 'diamond'],
        ['redstone_ore', 'redstone_dust'],
        ['deepslate_redstone_ore', 'redstone_dust'],
        ['lapis_ore', 'lapis_lazuli'],
        ['deepslate_lapis_ore', 'lapis_lazuli'],
        ['emerald_ore', 'emerald'],
        ['deepslate_emerald_ore', 'emerald'],
        ['netherrack', 'nether_brick'],
      ] as const

      for (const [input, output] of expected) {
        expect(matchSmeltingRecipe(STARTER_SMELTING_RECIPES, itemStack(input, 1))).toMatchObject({
          input,
          output: itemStack(output, 1),
          cookDurationSecs: 10,
        })
      }
      expect(STARTER_SMELTING_RECIPES).toHaveLength(expected.length)
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
        { item: 'oak_stairs', burnDurationSecs: 15 },
        { item: 'crafting_table', burnDurationSecs: 15 },
        { item: 'chest', burnDurationSecs: 15 },
        { item: 'bow', burnDurationSecs: 15 },
        { item: 'fishing_rod', burnDurationSecs: 15 },
        { item: 'oak_boat', burnDurationSecs: 60 },
        { item: 'ladder', burnDurationSecs: 15 },
        { item: 'sapling', burnDurationSecs: 5 },
        { item: 'wooden_pickaxe', burnDurationSecs: 10 },
        { item: 'wooden_hoe', burnDurationSecs: 10 },
        { item: 'wooden_sword', burnDurationSecs: 10 },
        { item: 'bowl', burnDurationSecs: 5 },
        { item: 'wool', burnDurationSecs: 5 },
        { item: 'door', burnDurationSecs: 10 },
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

  it.effect('zero delta is a no-op and invalid deltas fail as Results', () =>
    Effect.sync(() => {
      const state = furnaceWith({ input: itemStack('raw_iron', 1), fuel: itemStack('coal', 1) })
      const noOp = requireSuccess(advanceFurnaceResult(toFurnaceState(state), 0))
      expect(fromFurnaceState(noOp.state)).toStrictEqual(state)
      for (const delta of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(Result.isFailure(advanceFurnaceResult(toFurnaceState(state), delta))).toBe(true)
      }
    }),
  )
})

describe('inventory-backed furnace progression', () => {
  it.effect('keeps distinct stack components when transferring and collecting', () =>
    Effect.sync(() => {
      const rawIron = itemStack('raw_iron', 2)
      const repairedIron = itemStack('raw_iron', 3, {
        components: { ...rawIron.components, repairCost: RepairCost(1) },
      })
      const inventory: Inventory = {
        slots: [rawIron, repairedIron, ...emptyInventory().slots.slice(2)],
      }
      const transferred = transferToFurnace(inventory, emptyFurnaceState(), 'input', 'raw_iron', 2)
      expect(transferred.furnace.input).toStrictEqual(itemStack('raw_iron', 2, {
        components: repairedIron.components,
      }))
      expect(transferred.inventory.slots[0]).toStrictEqual(rawIron)
      expect(transferred.inventory.slots[1]).toStrictEqual(itemStack('raw_iron', 1, {
        components: repairedIron.components,
      }))

      const output = itemStack('iron_ingot', 1, {
        components: { ...itemStack('iron_ingot', 1).components, repairCost: RepairCost(1) },
      })
      const collected = collectFurnaceOutput(
        { slots: [itemStack('iron_ingot', 63), ...emptyInventory().slots.slice(1)] },
        furnaceWith({ output }),
      )
      expect(collected.result).toStrictEqual({ _tag: 'Collected', output })
      expect(collected.inventory.slots[0]).toStrictEqual(itemStack('iron_ingot', 63))
      expect(collected.inventory.slots[1]).toStrictEqual(output)
    }),
  )

  it.effect('does not merge recipe output with an item carrying different components', () =>
    Effect.sync(() => {
      const plainOutput = itemStack('iron_ingot', 1)
      const modifiedOutput = itemStack('iron_ingot', 1, {
        components: { ...plainOutput.components, repairCost: RepairCost(1) },
      })
      const state = furnaceWith({
        input: itemStack('raw_iron', 1),
        output: modifiedOutput,
        burnRemainingSecs: 20,
      })
      const outcome = advanceFurnace(state, 10)
      expect(outcome.state.output).toStrictEqual(modifiedOutput)
      expect(outcome.state.input).toStrictEqual(state.input)
      expect(outcome.smelted).toBe(0)
    }),
  )

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
      const modifiedOutput = itemStack('iron_ingot', 1, {
        components: { ...itemStack('iron_ingot', 1).components, repairCost: RepairCost(1) },
      })
      const modifiedState = furnaceWith({ output: modifiedOutput })
      expect(validateFurnaceSnapshot(JSON.parse(JSON.stringify(modifiedState)))).toStrictEqual({
        _tag: 'Valid',
        state: modifiedState,
      })
      expect(validateFurnaceSnapshot({ ...state, burnRemainingSecs: -1 })).toMatchObject({
        _tag: 'Invalid',
      })
      expect(validateFurnaceSnapshot({ ...state, extra: true })).toMatchObject({
        _tag: 'Invalid',
        error: { path: 'snapshot' },
      })
      expect(validateFurnaceSnapshot(null)).toMatchObject({
        _tag: 'Invalid',
        error: { path: 'snapshot' },
      })
      expect(validateFurnaceSnapshot([])).toMatchObject({
        _tag: 'Invalid',
        error: { path: 'snapshot' },
      })
    }),
  )

  it.effect('rejects a malformed, foreign, or overcounted slot inside an otherwise-valid snapshot', () =>
    Effect.sync(() => {
      const state = furnaceWith({ input: itemStack('raw_iron', 2), fuel: itemStack('coal', 1) })

      expect(validateFurnaceSnapshot({ ...state, input: 'raw_iron' })).toMatchObject({ _tag: 'Invalid' })
      expect(validateFurnaceSnapshot({ ...state, input: { item: 'raw_iron', count: 1 } })).toMatchObject({ _tag: 'Invalid' })
      expect(validateFurnaceSnapshot({ ...state, input: { item: 'raw_iron' } })).toMatchObject({ _tag: 'Invalid' })

      expect(
        validateFurnaceSnapshot({ ...state, fuel: { ...itemStack('coal', 1), item: 'unknown_item' } }),
      ).toMatchObject({ _tag: 'Invalid' })

      expect(
        validateFurnaceSnapshot({ ...state, output: { ...itemStack('iron_ingot', 1), count: 0 } }),
      ).toMatchObject({ _tag: 'ItemStackFailure' })
      expect(validateFurnaceSnapshot({
        ...state,
        output: { ...itemStack('iron_ingot', 1), components: {} },
      })).toMatchObject({ _tag: 'ItemStackFailure' })
      expect(validateFurnaceSnapshot({
        ...state,
        output: { ...itemStack('iron_ingot', 1), extra: true },
      })).toMatchObject({ _tag: 'Invalid' })
    }),
  )
})

describe('furnace boundary validation', () => {
  it('rejects malformed component records and legacy malformed slots', () => {
    const state = furnaceWith()
    expect(validateFurnaceSnapshot({
      ...state,
      input: { ...itemStack('raw_iron', 1), components: { maxStackSize: 'bad' } },
    })).toMatchObject({ _tag: 'ItemStackFailure' })
    const malformed = { ...itemStack('raw_iron', 1) }
    Reflect.deleteProperty(malformed, 'components')
      expect(Result.isFailure(matchSmeltingRecipeResult(malformed as ItemStack, 'furnace', []))).toBe(true)
  })

  it('rejects malformed slots passed directly to advanceFurnace', () => {
    for (const slot of ['input', 'fuel', 'output'] as const) {
      const malformed = { ...itemStack(slot === 'fuel' ? 'coal' : 'raw_iron', 1) }
      Reflect.deleteProperty(malformed, 'components')
      const state = { ...toFurnaceState(furnaceWith()), [slot]: malformed } as FurnaceState
      expect(Result.isFailure(advanceFurnaceResult(state, 1))).toBe(true)
    }
  })

  it('rejects unavailable and incompatible transfer stacks', () => {
    const legacy = { ...itemStack('raw_iron', 1) }
    Reflect.deleteProperty(legacy, 'components')
    const inventory = { slots: [legacy, ...emptyInventory().slots.slice(1)] }
    expect(transferToFurnace(inventory, emptyFurnaceState(), 'input', 'raw_iron', 1).result).toMatchObject({
      _tag: 'InsufficientItems', available: 0,
    })
    const modified = itemStack('raw_iron', 1, {
      components: { ...itemStack('raw_iron', 1).components, repairCost: RepairCost(1) },
    })
    expect(transferToFurnace({ slots: [itemStack('raw_iron', 1), modified, ...emptyInventory().slots.slice(2)] },
      emptyFurnaceState(), 'input', 'raw_iron', 2).result).toMatchObject({ _tag: 'InsufficientItems' })
  })

  it('rejects invalid fuel duration and malformed recipe output', () => {
    expect(Result.isFailure(advanceFurnaceResult(toFurnaceState(emptyFurnaceState()), 1, [], [{ item: 'coal', burnDurationSecs: 0 }]))).toBe(true)
    const malformed = { ...itemStack('iron_ingot', 1) }
    Reflect.deleteProperty(malformed, 'components')
    for (const recipe of STARTER_SMELTING_RECIPES.slice(0, 1)) {
      expect(Result.isFailure(matchSmeltingRecipeResult(undefined, 'furnace', [{ ...recipe, output: malformed }]))).toBe(true)
    }
    expect(validateFurnaceSnapshot({ ...furnaceWith(), input: { ...itemStack('raw_iron', 1), components: null } })).toMatchObject({
      _tag: 'ItemStackFailure',
    })
    expect(validateFurnaceSnapshot({
      ...furnaceWith(),
      input: { ...itemStack('raw_iron', 1), components: { maxStackSize: 'bad', repairCost: null, rarity: 'bad' } },
    })).toMatchObject({ _tag: 'ItemStackFailure' })
    const invalidRecipe = JSON.parse('{"id":"bad","input":"not-an-item","output":null,"cookDurationSecs":1}')
    expect(Result.isFailure(matchSmeltingRecipeResult(undefined, 'furnace', [invalidRecipe]))).toBe(true)
    const invalidFuel = JSON.parse('{"item":"not-an-item","burnDurationSecs":1}')
    expect(Result.isFailure(advanceFurnaceResult(toFurnaceState(emptyFurnaceState()), 1, [], [invalidFuel]))).toBe(true)
  })
  it.effect('persisted occupied slots reject counts outside their stack bounds', () =>
    Effect.sync(() => {
      const state = furnaceWith()
      for (const count of [0, 65, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(validateFurnaceSnapshot({
          ...state,
          input: { ...itemStack('raw_iron', 1), count },
        })).toMatchObject({ _tag: 'ItemStackFailure' })
      }
      expect(validateFurnaceSnapshot({
        ...state,
        fuel: { ...itemStack('coal', 1), count: 65 },
      })).toMatchObject({ _tag: 'ItemStackFailure' })
      expect(validateFurnaceSnapshot({
        ...state,
        output: { ...itemStack('iron_ingot', 1), count: 65 },
      })).toMatchObject({ _tag: 'ItemStackFailure' })
    }),
  )

  it.effect('a foreign item is refused at the snapshot boundary', () =>
    Effect.sync(() => {
      expect(validateFurnaceSnapshot({
        ...furnaceWith(),
        input: { ...itemStack('raw_iron', 1), item: 'unknown_item' },
      })).toMatchObject({ _tag: 'Invalid' })
    }),
  )

  it.effect('empty furnace slots use the kernel undefined slot value', () =>
    Effect.sync(() => {
      expect(validateFurnaceSnapshot({ ...furnaceWith(), input: undefined })).toMatchObject({ _tag: 'Valid' })
    }),
  )

  it.effect('invalid timers return failures and completed progress stalls safely', () =>
    Effect.sync(() => {
      expect(Result.isFailure(furnaceState({ cookProgressSecs: Number.NaN }))).toBe(true)
      expect(Result.isFailure(furnaceState({ fuelTimeRemainingSecs: -1 }))).toBe(true)
      const completed = advanceFurnaceResult(
        toFurnaceState(furnaceWith({ input: itemStack('raw_iron', 1), cookElapsedSecs: 10 })),
        1,
      )
      expect(Result.isSuccess(completed)).toBe(true)
      if (Result.isFailure(completed)) throw completed.failure
      expect(completed.success.state.input?.item).toBe('raw_iron')
    }),
  )

  it.effect('recipes and fuel rules reject invalid durations and stacks', () =>
    Effect.sync(() => {
      const state = furnaceWith({ input: itemStack('raw_iron', 1), fuel: itemStack('coal', 1) })
      const recipe = STARTER_SMELTING_RECIPES[0]
      if (recipe === undefined) throw new Error('starter smelting recipe missing')

      for (const cookDurationSecs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(Result.isFailure(advanceFurnaceResult(toFurnaceState(state), 1, [{ ...recipe, cookDurationSecs }]))).toBe(true)
      }
      expect(Result.isFailure(advanceFurnaceResult(toFurnaceState(state), 1, [{ ...recipe, id: '' }]))).toBe(true)

      for (const burnDurationSecs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(Result.isFailure(advanceFurnaceResult(toFurnaceState(state), 1, STARTER_SMELTING_RECIPES, [
          { item: 'coal', burnDurationSecs },
        ]))).toBe(true)
      }
    }),
  )

  it('validates kernel recipe and fuel tables and rejects malformed branded values', () => {
    const kernelRecipe = VANILLA_SMELTING_RECIPES[0]
    if (kernelRecipe === undefined) throw new Error('vanilla smelting recipe missing')
    const state = requireSuccess(furnaceState({ input: itemStack(kernelRecipe.input, 1), fuel: itemStack('coal', 1) }))

    expect(Result.isSuccess(matchSmeltingRecipeResult(itemStack(kernelRecipe.input, 1), 'furnace', [...VANILLA_SMELTING_RECIPES]))).toBe(true)
    expect(matchSmeltingRecipeResult(undefined, 'furnace', [...VANILLA_SMELTING_RECIPES])).toMatchObject({
      _tag: 'Success', success: undefined,
    })
    expect(Result.isFailure(matchSmeltingRecipeResult(undefined, 'furnace', [
      { ...kernelRecipe, id: 'invalid recipe id' },
    ] as never))).toBe(true)
    for (const malformed of [
      { ...kernelRecipe, input: 'not_an_item' },
      { ...kernelRecipe, output: null },
      { ...kernelRecipe, stations: [] },
      { ...kernelRecipe, stations: ['unknown_station'] },
      { ...kernelRecipe, cookTimeSecs: 0 },
      { ...kernelRecipe, experience: -1 },
    ]) {
      expect(Result.isFailure(matchSmeltingRecipeResult(undefined, 'furnace', [malformed] as never))).toBe(true)
    }

    const starter = STARTER_SMELTING_RECIPES[0]
    if (starter === undefined) throw new Error('starter smelting recipe missing')
    expect(Result.isSuccess(matchSmeltingRecipeResult(itemStack(starter.input, 1), 'furnace', [
      starter,
    ]))).toBe(true)
    const starterFuel = STARTER_FUEL_RULES.find((rule) => rule.item === 'coal')
    const station = kernelRecipe.stations[0]
    const kernelFuel = VANILLA_FUEL_RULES.find((rule) => rule.burnTimeSecs >= kernelRecipe.cookTimeSecs)
    if (starterFuel === undefined || station === undefined || kernelFuel === undefined) throw new Error('station data missing')
    const kernelState = requireSuccess(furnaceState({
      station,
      input: itemStack(kernelRecipe.input, 1),
      fuel: itemStack(kernelFuel.fuel, 1),
    }))
    const kernelOutcome = advanceFurnaceResult(
      kernelState,
      kernelRecipe.cookTimeSecs,
      [...VANILLA_SMELTING_RECIPES],
      [...VANILLA_FUEL_RULES],
    )
    expect(Result.isSuccess(kernelOutcome)).toBe(true)
    if (Result.isFailure(kernelOutcome)) throw kernelOutcome.failure
    expect(kernelOutcome.success.smeltedCount).toBe(1)
    const starterWithExperience = { ...starter, experience: 0.25 }
    const starterState = requireSuccess(furnaceState({
      input: itemStack(starter.input, 1),
      fuel: itemStack(starterFuel.item, 1),
    }))
    const starterOutcome = advanceFurnaceResult(
      starterState,
      starter.cookDurationSecs,
      [starterWithExperience],
      STARTER_FUEL_RULES,
    )
    expect(Result.isSuccess(starterOutcome)).toBe(true)
    if (Result.isFailure(starterOutcome)) throw starterOutcome.failure
    expect(starterOutcome.success.smeltedCount).toBe(1)
    const starterWithoutExperience = advanceFurnaceResult(
      starterState,
      starter.cookDurationSecs,
      [starter],
      STARTER_FUEL_RULES,
    )
    expect(Result.isSuccess(starterWithoutExperience)).toBe(true)
    if (Result.isFailure(starterWithoutExperience)) throw starterWithoutExperience.failure
    expect(starterWithoutExperience.success.smeltedCount).toBe(1)
    expect(Result.isFailure(matchSmeltingRecipeResult(undefined, 'unknown' as never, []))).toBe(true)
    expect(Result.isFailure(matchSmeltingRecipeResult(undefined, 'furnace', null as never))).toBe(true)
    expect(Result.isFailure(matchSmeltingRecipeResult(undefined, 'furnace', [null] as never))).toBe(true)

    expect(Result.isSuccess(advanceFurnaceResult(state, 1, [], [...VANILLA_FUEL_RULES]))).toBe(true)
    const firstFuelRule = VANILLA_FUEL_RULES[0]
    if (firstFuelRule === undefined) throw new Error('vanilla fuel rule missing')
    expect(Result.isFailure(advanceFurnaceResult(state, 1, [], [
      { ...firstFuelRule, burnTimeSecs: 0 },
    ] as never))).toBe(true)
    expect(Result.isFailure(advanceFurnaceResult(state, 1, [], [
      { fuel: 'not_an_item', burnTimeSecs: 10 },
    ] as never))).toBe(true)
    expect(Result.isFailure(advanceFurnaceResult(state, 1, [], [null] as never))).toBe(true)
    expect(Result.isFailure(advanceFurnaceResult(state, 1, [], null as never))).toBe(true)
    expect(Result.isFailure(furnaceState(null))).toBe(true)
    expect(Result.isFailure(furnaceState({ station: 'unknown' }))).toBe(true)
    expect(Result.isFailure(furnaceState({ fuelTimeRemainingSecs: 2, fuelTimeTotalSecs: 1 }))).toBe(true)
    expect(Result.isSuccess(advanceFurnaceResult(requireSuccess(emptyFurnaceStateResult()), 1))).toBe(true)
  })

  it.effect('does not advance a recipe whose cook progress already meets its duration', () =>
    Effect.sync(() => {
      const state = requireSuccess(furnaceState({
        input: itemStack('raw_iron', 1),
        fuel: itemStack('coal', 1),
        fuelTimeRemainingSecs: 80,
        fuelTimeTotalSecs: 80,
        cookProgressSecs: 10,
      }))
      const outcome = advanceFurnaceResult(state, 1, STARTER_SMELTING_RECIPES, STARTER_FUEL_RULES)
      expect(Result.isSuccess(outcome)).toBe(true)
      if (Result.isFailure(outcome)) throw outcome.failure
      expect(outcome.success.state.cookProgressSecs).toBe(10)
      expect(outcome.success.smeltedCount).toBe(0)
    }),
  )

  it('preserves branded duration failures at snapshot and cook progress reset boundaries', () => {
    const durationFailure = FixedDurationSecs.result(-1)
    if (Result.isSuccess(durationFailure)) throw new Error('negative duration unexpectedly passed')
    const originalDuration = FixedDurationSecs.result
    const state = requireSuccess(emptyFurnaceStateResult())
    const snapshotSpy = vi.spyOn(FixedDurationSecs, 'result').mockImplementation((value) =>
      value === 0 ? Result.fail(durationFailure.failure) : originalDuration(value),
    )
    const snapshot = validateFurnaceSnapshot(state)
    snapshotSpy.mockRestore()
    expect(snapshot).toMatchObject({ _tag: 'BrandFailure' })

    const emptyWithProgress = requireSuccess(furnaceState({ cookProgressSecs: 5 }))
    let emptyCalls = 0
    const emptyResetSpy = vi.spyOn(FixedDurationSecs, 'result').mockImplementation((value) => {
      if (value === 0 && ++emptyCalls === 3) return Result.fail(durationFailure.failure)
      return originalDuration(value)
    })
    const emptyReset = advanceFurnaceResult(emptyWithProgress, 1)
    emptyResetSpy.mockRestore()
    expect(Result.isFailure(emptyReset)).toBe(true)

    const unmatched = requireSuccess(furnaceState({ input: itemStack('raw_iron', 1) }))
    let unmatchedCalls = 0
    const unmatchedResetSpy = vi.spyOn(FixedDurationSecs, 'result').mockImplementation((value) => {
      if (value === 0 && ++unmatchedCalls === 4) return Result.fail(durationFailure.failure)
      return originalDuration(value)
    })
    const unmatchedReset = advanceFurnaceResult(unmatched, 1, [], STARTER_FUEL_RULES)
    unmatchedResetSpy.mockRestore()
    expect(Result.isFailure(unmatchedReset)).toBe(true)
  })
})
