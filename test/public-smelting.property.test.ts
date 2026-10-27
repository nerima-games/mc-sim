import fc from 'fast-check'
import { Result } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { assertResultContract, finiteTree, hostileNumber, hostileValue, isRecord, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 80 }
const starterRecipes = Result.getOrThrow(Sim.STARTER_SMELTING_RECIPES)
const recipe = starterRecipes[0]
const hostileStack = fc.oneof(
  unknownValue,
  fc.record({ item: hostileValue, count: hostileNumber, components: hostileValue }),
)
const hostileInventory = fc.oneof(
  unknownValue,
  fc.record({ slots: fc.array(hostileStack, { maxLength: 8 }) }),
)
const hostileFurnace = fc.oneof(
  unknownValue,
  fc.record({
    station: hostileValue,
    input: hostileStack,
    fuel: hostileStack,
    output: hostileStack,
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
    output: hostileStack,
    cookDurationSecs: hostileNumber,
    experience: hostileNumber,
  }),
)
const hostileRecipes = fc.oneof(unknownValue, fc.array(hostileRecipe, { maxLength: 4 }))

if (recipe === undefined) throw new Error('starter smelting recipe missing')

const assertTransferOutcome = (value: unknown): void => {
  expect(isRecord(value)).toBe(true)
  if (!isRecord(value)) return
  if (isRecord(value['result'])) {
    expect(['InvalidInput', 'InvalidCount', 'InsufficientItems', 'WrongItem', 'NoRoom', 'ItemStackFailure', 'Transferred', 'Collected', 'Empty']).toContain(
      value['result']['_tag'],
    )
    expect(finiteTree(value['result'])).toBe(true)
    return
  }
  expect(['Ready', 'Rejected']).toContain(value['_tag'])
  expect(finiteTree(value)).toBe(true)
}

it('furnace construction, matching, transfer selection, and collection handle hostile envelopes', () => {
  fc.assert(
    fc.property(hostileInventory, hostileFurnace, hostileStack, hostileValue, hostileRecipes, hostileNumber, (inventory, furnace, input, slot, recipes, count) => {
      assertResultContract(Sim.furnaceState(furnace))
      assertResultContract(Sim.matchSmeltingRecipe(input as never, slot as never, recipes as never))

      const selection = Sim.selectFurnaceTransfer(inventory as never, furnace as never, slot as never, input as never, count)
      assertTransferOutcome(selection)

      const transfer = Sim.transferToFurnace(inventory as never, furnace as never, slot as never, input as never, count)
      assertTransferOutcome(transfer)

      const collection = Sim.collectFurnaceOutput(inventory as never, furnace as never)
      assertTransferOutcome(collection)
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
})

it('valid furnace helpers return finite states with branded durations and valid stacks', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 64 }), (count) => {
      const input = Result.getOrThrow(Sim.itemStack(recipe.input, count))
      const fuel = Result.getOrThrow(Sim.itemStack('coal', 1))
      const output = Result.getOrThrow(Sim.itemStack(recipe.output.item, 1))
      const furnace = Result.getOrThrow(Sim.furnaceState({ input, fuel, output }))
      const inventory = Result.getOrThrow(Sim.addItem(Sim.emptyInventory(), recipe.input, count)).inventory

      const matched = Sim.matchSmeltingRecipe(input, 'furnace', starterRecipes)
      assertResultContract(matched, (success) => success === undefined || finiteTree(success))
      expect(Result.getOrThrow(matched)?.id).toBe(recipe.id)

      const selection = Sim.selectFurnaceTransfer(inventory, Result.getOrThrow(Sim.emptyFurnaceState()), 'input', recipe.input, count)
      expect(selection._tag).toBe('Ready')
      expect(finiteTree(selection)).toBe(true)

      const transfer = Sim.transferToFurnace(inventory, Result.getOrThrow(Sim.emptyFurnaceState()), 'input', recipe.input, count)
      expect(transfer.result._tag).toBe('Transferred')
      expect(Result.isSuccess(Sim.furnaceState(transfer.furnace))).toBe(true)
      expect(finiteTree(transfer)).toBe(true)

      const collection = Sim.collectFurnaceOutput(Sim.emptyInventory(), furnace)
      expect(collection.result._tag).toBe('Collected')
      expect(Result.isSuccess(Sim.furnaceState(collection.furnace))).toBe(true)
      expect(finiteTree(collection)).toBe(true)
    }),
    checks,
  )
})
