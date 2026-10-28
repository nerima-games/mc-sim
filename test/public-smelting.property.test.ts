import fc from 'fast-check'
import { Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { assertResultContract, hostileItemStack, hostileNumber, hostileValue, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 80 }
const starterRecipes = Result.getOrThrow(Sim.STARTER_SMELTING_RECIPES)
const recipe = starterRecipes[0]
const hostileInventory = fc.oneof(
  unknownValue,
  fc.record({ slots: fc.array(hostileItemStack, { maxLength: 8 }) }),
)
const hostileFurnace = fc.oneof(
  unknownValue,
  fc.record({
    station: hostileValue,
    input: hostileItemStack,
    fuel: hostileItemStack,
    output: hostileItemStack,
    fuelTimeRemainingSecs: hostileNumber,
    fuelTimeTotalSecs: hostileNumber,
    cookProgressSecs: hostileNumber,
  }),
)
const hostileRecipe = fc.oneof(
  unknownValue,
  fc.record({
    id: hostileValue,
    input: hostileValue,
    output: hostileItemStack,
    cookDurationSecs: hostileNumber,
    experience: hostileNumber,
  }),
)
const hostileRecipes = fc.oneof(unknownValue, fc.array(hostileRecipe, { maxLength: 4 }))

if (recipe === undefined) throw new Error('starter smelting recipe missing')

const validInputs = (count: number) => {
  const input = Result.getOrThrow(Sim.itemStack(recipe.input, count))
  const fuel = Result.getOrThrow(Sim.itemStack('coal', 1))
  const output = Result.getOrThrow(Sim.itemStack(recipe.output.item, 1))
  const furnace = Result.getOrThrow(Sim.furnaceState({ input, fuel, output }))
  const inventory = Result.getOrThrow(Sim.addItem(Sim.emptyInventory(), recipe.input, count)).inventory
  return { input, furnace, inventory }
}

it('furnace construction, matching, transfer selection, and collection handle hostile envelopes', () => {
  fc.assert(
    fc.property(hostileInventory, hostileFurnace, hostileItemStack, hostileValue, hostileRecipes, hostileNumber, (inventory, furnace, input, slot, recipes, count) => {
      assertResultContract('furnaceState', () => Sim.furnaceState(furnace), Sim.FurnaceStateSchema, Sim.FurnaceFailureSchema)
      assertResultContract('matchSmeltingRecipe', () => Sim.matchSmeltingRecipe(input as never, slot as never, recipes as never), Sim.SmeltingRecipeOptionSchema, Sim.FurnaceFailureSchema)

      const selection = Sim.selectFurnaceTransfer(inventory as never, furnace as never, slot as never, input as never, count)
      expect(Schema.is(Sim.FurnaceTransferSelectionSchema)(selection)).toBe(true)

      const transfer = Sim.transferToFurnace(inventory as never, furnace as never, slot as never, input as never, count)
      expect(Schema.is(Sim.FurnaceTransferResultSchema)(transfer.result)).toBe(true)

      const collection = Sim.collectFurnaceOutput(inventory as never, furnace as never)
      expect(Schema.is(Sim.FurnaceCollectionResultSchema)(collection.result)).toBe(true)
    }),
    checks,
  )

  const emptyFurnace = Result.getOrThrow(Sim.emptyFurnaceState())
  expect(Sim.selectFurnaceTransfer(null as never, emptyFurnace, 'input', 'stone', 1)).toMatchObject({
    _tag: 'Rejected',
    result: { _tag: 'InvalidInput', field: 'inventory' },
  })
  expect(Sim.transferToFurnace(null as never, emptyFurnace, 'input', 'stone', 1)).toMatchObject({
    result: { _tag: 'InvalidInput', field: 'inventory' },
  })
  expect(Sim.collectFurnaceOutput(null as never, emptyFurnace)).toMatchObject({
    result: { _tag: 'InvalidInput', field: 'inventory' },
  })
  expect(Sim.collectFurnaceOutput(Sim.emptyInventory(), null as never)).toMatchObject({
    result: { _tag: 'InvalidInput', field: 'furnace' },
  })
  expect(Sim.transferToFurnace(Sim.emptyInventory(), null as never, 'input', 'stone', 1)).toMatchObject({
    result: { _tag: 'InvalidInput', field: 'furnace' },
  })
})

it('smelting recipe schemas validate canonical and malformed recipes', () => {
  expect(Schema.is(Sim.SmeltingRecipeInputSchema)(recipe)).toBe(true)
  expect(Schema.is(Sim.SmeltingRecipeInputSchema)({ ...recipe, cookDurationSecs: Number.NaN })).toBe(false)
  expect(Schema.is(Sim.SmeltingRecipeOptionSchema)(recipe)).toBe(true)
  expect(Schema.is(Sim.SmeltingRecipeOptionSchema)(undefined)).toBe(true)
  expect(Schema.is(Sim.SmeltingRecipeOptionSchema)({ ...recipe, cookDurationSecs: Number.NaN })).toBe(false)
  expect(Schema.is(Sim.SmeltingRecipeOptionSchema)(null)).toBe(false)
})

it('furnace, inventory, and kernel recipe schemas reject omitted or null required fields', () => {
  const furnace = Result.getOrThrow(Sim.furnaceState())
  const decodeFurnace = Schema.decodeUnknownResult(Sim.FurnaceStateSchema)
  for (const field of Object.keys(furnace)) {
    const withoutField = Object.fromEntries(Object.entries(furnace).filter(([key]) => key !== field))
    expect(Result.isFailure(decodeFurnace(withoutField))).toBe(true)
    expect(Result.isFailure(decodeFurnace({ ...furnace, [field]: null }))).toBe(true)
  }

  const inventory = Result.getOrThrow(Sim.addItem(Sim.emptyInventory(), 'coal', 1)).inventory
  expect(Schema.is(Sim.InventorySchema)(inventory)).toBe(true)
  expect(Result.isFailure(Schema.decodeUnknownResult(Sim.InventorySchema)({}))).toBe(true)
  expect(Result.isFailure(Schema.decodeUnknownResult(Sim.InventorySchema)({ slots: null }))).toBe(true)

  const kernelRecipe = Sim.VANILLA_SMELTING_RECIPES[0]
  if (kernelRecipe === undefined) throw new Error('vanilla smelting recipe missing')
  const decodeRecipe = Schema.decodeUnknownResult(Sim.SmeltingRecipeInputSchema)
  expect(Result.isSuccess(decodeRecipe(kernelRecipe))).toBe(true)
  for (const field of Object.keys(kernelRecipe)) {
    const withoutField = Object.fromEntries(Object.entries(kernelRecipe).filter(([key]) => key !== field))
    expect(Result.isFailure(decodeRecipe(withoutField))).toBe(true)
    expect(Result.isFailure(decodeRecipe({ ...kernelRecipe, [field]: null }))).toBe(true)
  }
})

it('matchSmeltingRecipe returns a schema-valid recipe for valid input', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
    const { input } = validInputs(count)
    const result = Sim.matchSmeltingRecipe(input, 'furnace', starterRecipes)
    assertResultContract('matchSmeltingRecipe.valid', () => result, Sim.SmeltingRecipeOptionSchema, Sim.FurnaceFailureSchema)
    expect(Result.getOrThrow(result)?.id).toBe(recipe.id)
  }), checks)
})

it('selectFurnaceTransfer returns a schema-valid ready selection for valid inventory inputs', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
    const { inventory } = validInputs(count)
    const result = Sim.selectFurnaceTransfer(inventory, Result.getOrThrow(Sim.emptyFurnaceState()), 'input', recipe.input, count)
    expect(Schema.is(Sim.FurnaceTransferSelectionSchema)(result)).toBe(true)
    expect(result._tag).toBe('Ready')
  }), checks)
})

it('transferToFurnace returns a schema-valid transfer outcome for valid inputs', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
    const { inventory } = validInputs(count)
    const result = Sim.transferToFurnace(inventory, Result.getOrThrow(Sim.emptyFurnaceState()), 'input', recipe.input, count)
    expect(Schema.is(Sim.FurnaceTransferOutcomeSchema)(result)).toBe(true)
    expect(result.result._tag).toBe('Transferred')
  }), checks)
})

it('collectFurnaceOutput returns a schema-valid collection outcome for valid output', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
    const { furnace } = validInputs(count)
    const result = Sim.collectFurnaceOutput(Sim.emptyInventory(), furnace)
    expect(Schema.is(Sim.FurnaceCollectionOutcomeSchema)(result)).toBe(true)
    expect(result.result._tag).toBe('Collected')
  }), checks)
})
