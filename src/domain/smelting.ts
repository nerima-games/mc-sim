import { Brand, Result } from 'effect'
import {
  COOKING_STATIONS,
  FixedDurationSecs,
  RecipeCompletionCount,
  RecipeId,
  type FixedDurationSecs as FixedDurationSecsValue,
  RecipeExperience,
  isItemStack,
  isItemType,
  itemStackFromUnknown,
  itemStacksCanMerge,
  maxStackCountForStack,
  type CookingStation,
  type FuelRule as KernelFuelRule,
  type FurnaceAdvanceResult,
  type FurnaceState,
  type FurnaceStateInput,
  type ItemStack,
  type ItemType,
  type SmeltingRecipe as KernelSmeltingRecipe,
} from '@nerima-games/mc-kernel'
import {
  VANILLA_FUEL_RULES,
  VANILLA_SMELTING_RECIPES,
  STARTER_FUEL_RULES,
} from './smelting-data.js'
import { addItemStack, countOf, itemStack, type Inventory, type ItemStackFailure } from './inventory.js'
import { itemStackWithCount } from './item-stack.js'

export {
  COOKING_STATIONS,
  VANILLA_FUEL_RULES,
  VANILLA_SMELTING_RECIPES,
}
export type {
  CookingStation,
  FurnaceAdvanceResult,
  FurnaceState,
  FurnaceStateInput,
  KernelFuelRule as FuelRule,
  KernelSmeltingRecipe,
}

export type StarterSmeltingRecipe = Readonly<{
  readonly id: string
  readonly input: ItemType
  readonly output: ItemStack
  readonly cookDurationSecs: number
  readonly experience?: number
}>
export type SmeltingRecipeInput = KernelSmeltingRecipe | StarterSmeltingRecipe
export type StarterFuelRule = Readonly<{
  readonly item: ItemType
  readonly burnDurationSecs: number
}>
export type FuelRuleInput = KernelFuelRule | StarterFuelRule

export type FurnaceStateValidationFailure = Readonly<{
  readonly _tag: 'FurnaceStateValidationFailure'
  readonly path: string
  readonly reason: string
}>
export type SmeltingValidationFailure = Readonly<{
  readonly _tag: 'SmeltingValidationFailure'
  readonly path: string
  readonly reason: string
}>
export type FurnaceFailure =
  | Brand.BrandError
  | ItemStackFailure
  | FurnaceStateValidationFailure
  | SmeltingValidationFailure

type FurnaceStateFailure = Brand.BrandError | ItemStackFailure | FurnaceStateValidationFailure

export type FurnaceOutcome = FurnaceAdvanceResult & Readonly<{
  readonly fuelConsumed: number
}>

export type FurnaceTransferSlot = 'input' | 'fuel'
export type FurnaceTransferRejection =
  | { readonly _tag: 'InvalidInput'; readonly field: 'inventory' | 'furnace' | 'slot' | 'item' | 'count' }
  | { readonly _tag: 'InvalidCount'; readonly count: number }
  | { readonly _tag: 'InsufficientItems'; readonly available: number }
  | { readonly _tag: 'WrongItem'; readonly expected: ItemType }
  | { readonly _tag: 'NoRoom'; readonly available: number }
  | { readonly _tag: 'ItemStackFailure'; readonly error: ItemStackFailure }
export type FurnaceTransferResult =
  | { readonly _tag: 'Transferred'; readonly item: ItemType; readonly count: number }
  | FurnaceTransferRejection
export type FurnaceTransferOutcome = Readonly<{
  readonly inventory: Inventory
  readonly furnace: FurnaceState
  readonly result: FurnaceTransferResult
}>
export type FurnaceTransferSelection =
  | { readonly _tag: 'Ready'; readonly current: ItemStack | undefined; readonly selected: ItemStack }
  | { readonly _tag: 'Rejected'; readonly result: FurnaceTransferRejection }
export type FurnaceCollectionResult =
  | { readonly _tag: 'InvalidInput'; readonly field: 'inventory' | 'furnace' }
  | { readonly _tag: 'Collected'; readonly output: ItemStack }
  | { readonly _tag: 'Empty' }
  | { readonly _tag: 'NoRoom' }
  | { readonly _tag: 'ItemStackFailure'; readonly error: ItemStackFailure }
export type FurnaceCollectionOutcome = Readonly<{
  readonly inventory: Inventory
  readonly furnace: FurnaceState
  readonly result: FurnaceCollectionResult
}>
export type FurnaceSnapshotValidationResult =
  | { readonly _tag: 'Valid'; readonly state: FurnaceState }
  | { readonly _tag: 'Invalid'; readonly error: FurnaceStateValidationFailure }
  | { readonly _tag: 'BrandFailure'; readonly error: Brand.BrandError }
  | { readonly _tag: 'ItemStackFailure'; readonly error: ItemStackFailure }

type Slot = ItemStack | undefined
type RecordValue = Readonly<Record<string, unknown>>

const validationFailure = (path: string, reason: string): FurnaceStateValidationFailure => ({
  _tag: 'FurnaceStateValidationFailure',
  path,
  reason,
})
const smeltingFailure = (path: string, reason: string): SmeltingValidationFailure => ({
  _tag: 'SmeltingValidationFailure',
  path,
  reason,
})
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isCookingStation = (value: unknown): value is CookingStation =>
  typeof value === 'string' && COOKING_STATIONS.some((station) => station === value)
const isCookingStationTable = (value: unknown): value is ReadonlyArray<CookingStation> =>
  Array.isArray(value) && value.every(isCookingStation)
const isFiniteNonNegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
const isSlot = (value: unknown): value is Slot => value === undefined || isItemStack(value)
const isInventoryEnvelope = (value: unknown): value is Inventory =>
  isRecord(value) && Array.isArray(value['slots'])
const isInventory = (value: unknown): value is Inventory =>
  isInventoryEnvelope(value) && value.slots.every(isSlot)
const isTransferSlot = (value: unknown): value is FurnaceTransferSlot =>
  value === 'input' || value === 'fuel'

const validateSlot = (value: unknown, path: string): Result.Result<Slot, FurnaceStateFailure> => {
  if (value === undefined) return Result.succeed(undefined)
  if (!isRecord(value) || Object.keys(value).some((key) => !['item', 'count', 'components'].includes(key))) {
    return Result.fail(validationFailure(path, 'expected an ItemStack or undefined'))
  }
  if (isItemStack(value)) return itemStack(value.item, value.count, { components: value.components })
  if (!isItemType(value['item'])) {
    return Result.fail(validationFailure(path, 'expected an ItemStack or undefined'))
  }
  if (!Object.hasOwn(value, 'count') || !Object.hasOwn(value, 'components')) {
    return Result.fail(validationFailure(path, 'expected an ItemStack or undefined'))
  }
  const components = value['components']
  if (!isRecord(components) || Object.keys(components).length === 0) {
    return itemStackFromUnknown(value['item'], value['count'], { components })
  }
  return Result.flatMap(itemStackFromUnknown(value['item'], value['count']), (defaults) =>
    itemStackFromUnknown(value['item'], value['count'], {
      components: { ...defaults.components, ...components },
    }),
  )
}

const fixedDuration = (
  value: unknown,
  path: string,
): Result.Result<FixedDurationSecsValue, FurnaceStateFailure> => {
  if (!isFiniteNonNegative(value)) {
    return Result.fail(validationFailure(path, 'must be a finite non-negative number'))
  }
  return FixedDurationSecs.result(value)
}

export const furnaceState = (
  input: unknown = {},
): Result.Result<FurnaceState, FurnaceStateFailure> => {
  if (!isRecord(input)) return Result.fail(validationFailure('state', 'expected an object'))
  const station = input['station'] ?? 'furnace'
  if (!isCookingStation(station)) return Result.fail(validationFailure('station', 'expected a cooking station'))
  const furnaceInput = validateSlot(input['input'], 'input')
  const fuel = validateSlot(input['fuel'], 'fuel')
  const output = validateSlot(input['output'], 'output')
  const fuelTimeRemaining = fixedDuration(input['fuelTimeRemainingSecs'] ?? 0, 'fuelTimeRemainingSecs')
  const fuelTimeTotal = fixedDuration(input['fuelTimeTotalSecs'] ?? 0, 'fuelTimeTotalSecs')
  const cookProgress = fixedDuration(input['cookProgressSecs'] ?? 0, 'cookProgressSecs')
  return Result.flatMap(Result.all([furnaceInput, fuel, output]), ([validInput, validFuel, validOutput]) =>
    Result.flatMap(Result.all([fuelTimeRemaining, fuelTimeTotal, cookProgress]), ([remaining, total, progress]) => {
      if (remaining > total) {
        return Result.fail(validationFailure('fuelTimeRemainingSecs', 'cannot exceed fuelTimeTotalSecs'))
      }
      return Result.succeed({
        station,
        input: validInput,
        fuel: validFuel,
        output: validOutput,
        fuelTimeRemainingSecs: remaining,
        fuelTimeTotalSecs: total,
        cookProgressSecs: progress,
      })
    }),
  )
}

const isFurnaceState = (value: unknown): value is FurnaceState => {
  if (!isRecord(value)) return false
  const fields = ['station', 'input', 'fuel', 'output', 'fuelTimeRemainingSecs', 'fuelTimeTotalSecs', 'cookProgressSecs']
  return fields.every((field) => Object.hasOwn(value, field)) && Result.isSuccess(furnaceState(value))
}

export const emptyFurnaceState = (
  station: CookingStation = 'furnace',
): Result.Result<FurnaceState, FurnaceFailure> => furnaceState({ station })

export const validateFurnaceSnapshot = (value: unknown): FurnaceSnapshotValidationResult => {
  if (!isRecord(value)) return { _tag: 'Invalid', error: validationFailure('snapshot', 'expected an object') }
  const fields = ['station', 'input', 'fuel', 'output', 'fuelTimeRemainingSecs', 'fuelTimeTotalSecs', 'cookProgressSecs']
  if (Object.keys(value).length !== fields.length || !fields.every((field) => Object.hasOwn(value, field))) {
    return { _tag: 'Invalid', error: validationFailure('snapshot', 'expected the complete furnace state') }
  }
  const state = furnaceState(value)
  if (Result.isFailure(state)) {
    if (state.failure._tag === 'FurnaceStateValidationFailure') return { _tag: 'Invalid', error: state.failure }
    if (state.failure._tag === 'BrandError') return { _tag: 'BrandFailure', error: state.failure }
    return { _tag: 'ItemStackFailure', error: state.failure }
  }
  return { _tag: 'Valid', state: state.success }
}

const validStarterRecipe = (
  value: unknown,
): value is StarterSmeltingRecipe =>
  isRecord(value) &&
  typeof value['id'] === 'string' &&
  value['id'].length > 0 &&
  isItemType(value['input']) &&
  isItemStack(value['output']) &&
  isFinitePositive(value['cookDurationSecs']) &&
  (value['experience'] === undefined || isFiniteNonNegative(value['experience']))

const validateRecipe = (
  value: unknown,
): Result.Result<SmeltingRecipeInput, FurnaceFailure> => {
  if (!isRecord(value)) return Result.fail(smeltingFailure('recipe', 'expected an object'))
  if (value['_tag'] !== 'Smelting') {
    return validStarterRecipe(value)
      ? Result.succeed(value)
      : Result.fail(smeltingFailure('recipe', 'invalid starter smelting recipe'))
  }
  const id = value['id']
  const input = value['input']
  const output = value['output']
  const stations = value['stations']
  const cookTimeSecs = value['cookTimeSecs']
  const experience = value['experience']
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    !isItemType(input) ||
    !isItemStack(output) ||
    !isCookingStationTable(stations) ||
    stations.length === 0 ||
    !isFinitePositive(cookTimeSecs) ||
    !isFiniteNonNegative(experience)
  ) {
    return Result.fail(smeltingFailure('recipe', 'invalid kernel smelting recipe'))
  }
  return Result.map(
    Result.all([
      RecipeId.result(id),
      FixedDurationSecs.result(cookTimeSecs),
      RecipeExperience.result(experience),
    ]),
    ([validId, validDuration, validExperience]) => ({
      _tag: 'Smelting',
      id: validId,
      input,
      output,
      cookTimeSecs: validDuration,
      experience: validExperience,
      stations,
    }),
  )
}

const resolveRecipeTable = (
  recipes: unknown,
): Result.Result<ReadonlyArray<SmeltingRecipeInput>, FurnaceFailure> => {
  if (recipes === VANILLA_SMELTING_RECIPES) return Result.succeed(VANILLA_SMELTING_RECIPES)
  if (!Array.isArray(recipes)) return Result.fail(smeltingFailure('recipes', 'expected an array'))
  return Result.all(recipes.map(validateRecipe))
}

const recipeInput = (recipe: SmeltingRecipeInput): ItemType => recipe.input
const recipeOutput = (recipe: SmeltingRecipeInput): ItemStack => recipe.output
const isKernelSmeltingRecipe = (recipe: SmeltingRecipeInput): recipe is KernelSmeltingRecipe =>
  '_tag' in recipe && recipe._tag === 'Smelting'
const recipeDuration = (recipe: SmeltingRecipeInput): number =>
  isKernelSmeltingRecipe(recipe) ? recipe.cookTimeSecs : recipe.cookDurationSecs
const recipeExperience = (recipe: SmeltingRecipeInput): number =>
  isKernelSmeltingRecipe(recipe) ? recipe.experience : recipe.experience ?? 0
const recipeSupportsStation = (recipe: SmeltingRecipeInput, station: CookingStation): boolean =>
  isKernelSmeltingRecipe(recipe) ? recipe.stations.includes(station) : station === 'furnace'

export const matchSmeltingRecipe = (
  input: Slot,
  station: CookingStation = 'furnace',
  recipes: ReadonlyArray<SmeltingRecipeInput> = VANILLA_SMELTING_RECIPES,
): Result.Result<SmeltingRecipeInput | undefined, FurnaceFailure> => {
  if (!isCookingStation(station)) return Result.fail(smeltingFailure('station', 'unknown cooking station'))
  if (!isSlot(input)) return Result.fail(smeltingFailure('input', 'expected an ItemStack or undefined'))
  return Result.map(resolveRecipeTable(recipes), (table) => {
    if (input === undefined) return undefined
    return table.find((recipe) => recipeInput(recipe) === input.item && recipeSupportsStation(recipe, station))
  })
}

export const selectFurnaceTransfer = (
  inventory: Inventory,
  furnace: FurnaceState,
  slot: FurnaceTransferSlot,
  item: ItemType,
  count: number,
): FurnaceTransferSelection => {
  if (!Number.isSafeInteger(count) || count <= 0) {
    if (!Number.isFinite(count)) {
      return { _tag: 'Rejected', result: { _tag: 'InvalidInput', field: 'count' } }
    }
    return { _tag: 'Rejected', result: { _tag: 'InvalidCount', count } }
  }
  if (!isInventoryEnvelope(inventory)) {
    return { _tag: 'Rejected', result: { _tag: 'InvalidInput', field: 'inventory' } }
  }
  if (!isFurnaceState(furnace)) {
    return { _tag: 'Rejected', result: { _tag: 'InvalidInput', field: 'furnace' } }
  }
  if (!isTransferSlot(slot)) {
    return { _tag: 'Rejected', result: { _tag: 'InvalidInput', field: 'slot' } }
  }
  if (!isItemType(item)) {
    return { _tag: 'Rejected', result: { _tag: 'InvalidInput', field: 'item' } }
  }
  const totalAvailable = countOf(inventory, item)
  if (totalAvailable < count) {
    return { _tag: 'Rejected', result: { _tag: 'InsufficientItems', available: totalAvailable } }
  }
  const current = furnace[slot]
  if (current !== undefined && current.item !== item) {
    return { _tag: 'Rejected', result: { _tag: 'WrongItem', expected: current.item } }
  }
  const selected = current ?? inventory.slots.findLast((held) => held?.item === item && isItemStack(held))
  if (selected === undefined) {
    return { _tag: 'Rejected', result: { _tag: 'InsufficientItems', available: 0 } }
  }
  const available = inventory.slots.reduce(
    (total, held) => total + (isItemStack(held) && itemStacksCanMerge(held, selected) ? held.count : 0),
    0,
  )
  if (available < count) return { _tag: 'Rejected', result: { _tag: 'InsufficientItems', available } }
  const capacity = maxStackCountForStack(selected) - (current?.count ?? 0)
  if (capacity < count) return { _tag: 'Rejected', result: { _tag: 'NoRoom', available: capacity } }
  return { _tag: 'Ready', current, selected }
}

export const transferToFurnace = (
  inventory: Inventory,
  furnace: FurnaceState,
  slot: FurnaceTransferSlot,
  item: ItemType,
  count: number,
): FurnaceTransferOutcome => {
  const selection = selectFurnaceTransfer(inventory, furnace, slot, item, count)
  if (selection._tag === 'Rejected') return { inventory, furnace, result: selection.result }
  if (!isInventory(inventory)) {
    return { inventory, furnace, result: { _tag: 'InvalidInput', field: 'inventory' } }
  }
  const { current, selected } = selection
  const slots = [...inventory.slots]
  let remaining = count
  for (let index = slots.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const held = slots[index]
    if (!isItemStack(held) || !itemStacksCanMerge(held, selected)) continue
    const taken = Math.min(held.count, remaining)
    if (held.count !== taken) {
      const reduced = itemStackWithCount(held, held.count - taken)
      if (Result.isFailure(reduced)) {
        return { inventory, furnace, result: { _tag: 'ItemStackFailure', error: reduced.failure } }
      }
      slots[index] = reduced.success
    } else {
      slots[index] = undefined
    }
    remaining -= taken
  }
  const destination = itemStackWithCount(selected, (current?.count ?? 0) + count)
  if (Result.isFailure(destination)) {
    return { inventory, furnace, result: { _tag: 'ItemStackFailure', error: destination.failure } }
  }
  return {
    inventory: { slots },
    furnace: { ...furnace, [slot]: destination.success },
    result: { _tag: 'Transferred', item, count },
  }
}

export const collectFurnaceOutput = (
  inventory: Inventory,
  furnace: FurnaceState,
): FurnaceCollectionOutcome => {
  if (!isInventory(inventory)) {
    return { inventory, furnace, result: { _tag: 'InvalidInput', field: 'inventory' } }
  }
  if (!isFurnaceState(furnace)) {
    return { inventory, furnace, result: { _tag: 'InvalidInput', field: 'furnace' } }
  }
  if (furnace.output === undefined) return { inventory, furnace, result: { _tag: 'Empty' } }
  const inserted = addItemStack(inventory, furnace.output)
  if (Result.isFailure(inserted)) return { inventory, furnace, result: { _tag: 'ItemStackFailure', error: inserted.failure } }
  if (inserted.success.leftover > 0) return { inventory, furnace, result: { _tag: 'NoRoom' } }
  return {
    inventory: inserted.success.inventory,
    furnace: { ...furnace, output: undefined },
    result: { _tag: 'Collected', output: furnace.output },
  }
}

const validateFuelRule = (
  value: unknown,
): Result.Result<FuelRuleInput, FurnaceFailure> => {
  if (!isRecord(value)) return Result.fail(smeltingFailure('fuel', 'expected an object'))
  if (Object.hasOwn(value, 'fuel')) {
    const fuel = value['fuel']
    const duration = value['burnTimeSecs']
    if (!isItemType(fuel) || !isFinitePositive(duration)) {
      return Result.fail(smeltingFailure('fuel', 'invalid fuel rule'))
    }
    return Result.map(FixedDurationSecs.result(duration), (burnTimeSecs): KernelFuelRule => ({ fuel, burnTimeSecs }))
  }
  const item = value['item']
  const duration = value['burnDurationSecs']
  return isItemType(item) && isFinitePositive(duration)
    ? Result.succeed<StarterFuelRule>({ item, burnDurationSecs: duration })
    : Result.fail(smeltingFailure('fuel', 'invalid fuel rule'))
}

const resolveFuelTable = (
  fuels: unknown,
): Result.Result<ReadonlyArray<FuelRuleInput>, FurnaceFailure> => {
  if (fuels === VANILLA_FUEL_RULES) return Result.succeed(VANILLA_FUEL_RULES)
  if (fuels === STARTER_FUEL_RULES) return Result.succeed(STARTER_FUEL_RULES)
  if (!Array.isArray(fuels)) return Result.fail(smeltingFailure('fuels', 'expected an array'))
  return Result.all(fuels.map(validateFuelRule))
}

const fuelItem = (rule: FuelRuleInput): ItemType =>
  'fuel' in rule ? rule.fuel : rule.item
const fuelDuration = (rule: FuelRuleInput): number =>
  'burnTimeSecs' in rule ? rule.burnTimeSecs : rule.burnDurationSecs

const consumeOne = (stack: Slot): Result.Result<Slot, ItemStackFailure> => {
  if (stack === undefined || stack.count === 1) return Result.succeed(undefined)
  return itemStackWithCount(stack, stack.count - 1)
}

const appendOutput = (
  output: Slot,
  addition: ItemStack,
): Result.Result<ItemStack, ItemStackFailure> => {
  if (output === undefined) return Result.succeed(addition)
  return itemStackWithCount(output, output.count + addition.count)
}

const resetCookProgress = (state: FurnaceState): Result.Result<FurnaceState, FurnaceFailure> =>
  Result.map(FixedDurationSecs.result(0), (cookProgressSecs) => ({ ...state, cookProgressSecs }))

const smeltingRecipeFor = (
  recipes: ReadonlyArray<SmeltingRecipeInput>,
  input: ItemStack,
  station: CookingStation,
): SmeltingRecipeInput | undefined => {
  for (const recipe of recipes) {
    if (recipeInput(recipe) === input.item && recipeSupportsStation(recipe, station)) return recipe
  }
  return undefined
}

const canAppendRecipeOutput = (output: Slot, addition: ItemStack): boolean =>
  output === undefined || itemStacksCanMerge(output, addition) &&
    output.count + addition.count <= maxStackCountForStack(output)

const fuelRuleFor = (
  fuel: Slot,
  fuels: ReadonlyArray<FuelRuleInput>,
): FuelRuleInput | undefined => {
  if (fuel === undefined) return undefined
  for (const rule of fuels) {
    if (fuelItem(rule) === fuel.item) return rule
  }
  return undefined
}

type FuelStart = Readonly<{ readonly state: FurnaceState; readonly fuelConsumed: number }>

const startFuelBurn = (
  state: FurnaceState,
  fuels: ReadonlyArray<FuelRuleInput>,
): Result.Result<FuelStart | undefined, FurnaceFailure> => {
  if (state.fuelTimeRemainingSecs !== 0) return Result.succeed({ state, fuelConsumed: 0 })
  const rule = fuelRuleFor(state.fuel, fuels)
  if (rule === undefined) return Result.succeed(undefined)
  return Result.flatMap(consumeOne(state.fuel), (fuel) =>
    Result.map(FixedDurationSecs.result(fuelDuration(rule)), (burnTime) => ({
      state: { ...state, fuel, fuelTimeRemainingSecs: burnTime, fuelTimeTotalSecs: burnTime },
      fuelConsumed: 1,
    })),
  )
}

type CookingInterval = Readonly<{
  readonly state: FurnaceState
  readonly remaining: number
  readonly smelted: boolean
}>

const advanceCookingInterval = (
  state: FurnaceState,
  recipe: SmeltingRecipeInput,
  remaining: number,
): Result.Result<CookingInterval, FurnaceFailure> => {
  const cookRemaining = recipeDuration(recipe) - state.cookProgressSecs
  const step = Math.min(remaining, cookRemaining, state.fuelTimeRemainingSecs)
  const fuelTimeRemainingSecs = FixedDurationSecs.result(state.fuelTimeRemainingSecs - step)
  const cookProgressSecs = FixedDurationSecs.result(state.cookProgressSecs + step)
  return Result.flatMap(Result.all([fuelTimeRemainingSecs, cookProgressSecs]), ([fuelRemaining, cookProgress]) => {
    const nextState = { ...state, fuelTimeRemainingSecs: fuelRemaining, cookProgressSecs: cookProgress }
    const nextRemaining = remaining - step
    if (cookProgress < recipeDuration(recipe)) {
      return Result.succeed<CookingInterval>({ state: nextState, remaining: nextRemaining, smelted: false })
    }
    return Result.flatMap(consumeOne(nextState.input), (input) =>
      Result.flatMap(appendOutput(nextState.output, recipeOutput(recipe)), (output) =>
        Result.map(resetCookProgress({ ...nextState, input, output }), (completedState): CookingInterval => ({
          state: completedState,
          remaining: nextRemaining,
          smelted: true,
        })),
      ),
    )
  })
}

const completedCookProgressFailure = (
  state: FurnaceState,
  recipes: ReadonlyArray<SmeltingRecipeInput>,
): FurnaceFailure | undefined => {
  if (state.input === undefined) return undefined
  const recipe = smeltingRecipeFor(recipes, state.input, state.station)
  if (recipe === undefined || state.cookProgressSecs < recipeDuration(recipe)) return undefined
  return validationFailure('cookProgressSecs', 'must be less than the matched recipe duration')
}

export const advanceFurnace = (
  state: FurnaceState,
  elapsedSecs: number,
  recipes: ReadonlyArray<SmeltingRecipeInput> = VANILLA_SMELTING_RECIPES,
  fuels: ReadonlyArray<FuelRuleInput> = VANILLA_FUEL_RULES,
): Result.Result<FurnaceOutcome, FurnaceFailure> => {
  const validatedState = furnaceState(state)
  if (Result.isFailure(validatedState)) return Result.fail(validatedState.failure)
  const elapsed = fixedDuration(elapsedSecs, 'elapsedSecs')
  if (Result.isFailure(elapsed)) return Result.fail(elapsed.failure)
  const recipeTable = resolveRecipeTable(recipes)
  if (Result.isFailure(recipeTable)) return Result.fail(recipeTable.failure)
  const fuelTable = resolveFuelTable(fuels)
  if (Result.isFailure(fuelTable)) return Result.fail(fuelTable.failure)

  let current = validatedState.success
  const completedProgressFailure = completedCookProgressFailure(current, recipeTable.success)
  if (completedProgressFailure !== undefined) return Result.fail(completedProgressFailure)
  let remaining: number = elapsed.success
  let smeltedCount = 0
  let experienceGained = 0
  let fuelConsumed = 0

  while (remaining > 0) {
    if (current.input === undefined) {
      const reset = resetCookProgress(current)
      if (Result.isFailure(reset)) return Result.fail(reset.failure)
      current = reset.success
      break
    }
    const recipe = smeltingRecipeFor(recipeTable.success, current.input, current.station)
    if (recipe === undefined || !canAppendRecipeOutput(current.output, recipeOutput(recipe))) {
      const reset = resetCookProgress(current)
      if (Result.isFailure(reset)) return Result.fail(reset.failure)
      current = reset.success
      break
    }

    const burn = startFuelBurn(current, fuelTable.success)
    if (Result.isFailure(burn)) return Result.fail(burn.failure)
    if (burn.success === undefined) break
    current = burn.success.state
    fuelConsumed += burn.success.fuelConsumed

    const interval = advanceCookingInterval(current, recipe, remaining)
    if (Result.isFailure(interval)) return Result.fail(interval.failure)
    current = interval.success.state
    remaining = interval.success.remaining
    if (interval.success.smelted) {
      smeltedCount += 1
      experienceGained += recipeExperience(recipe)
    }
  }

  return Result.map(
    Result.all([
      RecipeCompletionCount.result(smeltedCount),
      RecipeExperience.result(experienceGained),
    ]),
    ([count, experience]) => ({ state: current, smeltedCount: count, experienceGained: experience, fuelConsumed }),
  )
}
