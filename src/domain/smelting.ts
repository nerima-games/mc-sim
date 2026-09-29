import {
  addItemStack,
  countOf,
  itemStack,
  type Inventory,
  type ItemStack,
} from './inventory.js'
import {
  isItemComponents,
  isItemStack,
  isItemType,
  itemStackWithCount,
  itemStacksCanMerge,
  maxStackCountForStack,
  type ItemType,
} from '@nerima-games/mc-kernel'
import { STARTER_FUEL_RULES, STARTER_SMELTING_RECIPES } from './smelting-data.js'

export type SmeltingRecipe = {
  readonly id: string
  readonly input: ItemType
  readonly output: ItemStack
  readonly cookDurationSecs: number
}

export type FuelRule = {
  readonly item: ItemType
  readonly burnDurationSecs: number
}

export type FurnaceState = {
  readonly input: ItemStack | null
  readonly fuel: ItemStack | null
  readonly output: ItemStack | null
  readonly cookElapsedSecs: number
  readonly burnRemainingSecs: number
}

export type FurnaceOutcome = {
  readonly state: FurnaceState
  readonly smelted: number
  readonly fuelConsumed: number
}

export type FurnaceTransferSlot = 'input' | 'fuel'

export type FurnaceTransferResult =
  | { readonly _tag: 'Transferred'; readonly item: ItemType; readonly count: number }
  | { readonly _tag: 'InvalidCount'; readonly count: number }
  | { readonly _tag: 'InsufficientItems'; readonly available: number }
  | { readonly _tag: 'WrongItem'; readonly expected: ItemType }
  | { readonly _tag: 'NoRoom'; readonly available: number }

export type FurnaceTransferOutcome = {
  readonly inventory: Inventory
  readonly furnace: FurnaceState
  readonly result: FurnaceTransferResult
}

export type FurnaceCollectionResult =
  | { readonly _tag: 'Collected'; readonly output: ItemStack }
  | { readonly _tag: 'Empty' }
  | { readonly _tag: 'NoRoom' }

export type FurnaceCollectionOutcome = {
  readonly inventory: Inventory
  readonly furnace: FurnaceState
  readonly result: FurnaceCollectionResult
}

export type FurnaceSnapshotValidationError = {
  readonly _tag: 'FurnaceSnapshotValidationError'
  readonly path: string
  readonly reason: string
}

export type FurnaceSnapshotValidationResult =
  | { readonly _tag: 'Valid'; readonly state: FurnaceState }
  | { readonly _tag: 'Invalid'; readonly error: FurnaceSnapshotValidationError }

export const emptyFurnaceState = (): FurnaceState => ({
  input: null,
  fuel: null,
  output: null,
  cookElapsedSecs: 0,
  burnRemainingSecs: 0,
})

/** Atomically move player-owned items into one furnace slot. */
export const transferToFurnace = (
  inventory: Inventory,
  furnace: FurnaceState,
  slot: FurnaceTransferSlot,
  item: ItemType,
  count: number,
): FurnaceTransferOutcome => {
  if (!Number.isSafeInteger(count) || count <= 0) {
    return { inventory, furnace, result: { _tag: 'InvalidCount', count } }
  }
  const totalAvailable = countOf(inventory, item)
  if (totalAvailable < count) {
    return { inventory, furnace, result: { _tag: 'InsufficientItems', available: totalAvailable } }
  }
  const current = furnace[slot]
  if (current !== null && current.item !== item) {
    return { inventory, furnace, result: { _tag: 'WrongItem', expected: current.item } }
  }
  const selected = current ?? inventory.slots.findLast((held) => held?.item === item && isItemStack(held))
  if (selected === undefined) {
    return { inventory, furnace, result: { _tag: 'InsufficientItems', available: 0 } }
  }
  const available = inventory.slots.reduce(
    (total, held) => total + (held !== undefined && itemStacksCanMerge(held, selected) ? held.count : 0),
    0,
  )
  if (available < count) {
    return { inventory, furnace, result: { _tag: 'InsufficientItems', available } }
  }
  const capacity = maxStackCountForStack(selected) - (current?.count ?? 0)
  if (capacity < count) {
    return { inventory, furnace, result: { _tag: 'NoRoom', available: capacity } }
  }
  const slots = [...inventory.slots]
  let remaining = count
  for (let index = slots.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const held = slots[index]
    if (held === undefined || !itemStacksCanMerge(held, selected)) continue
    const taken = Math.min(held.count, remaining)
    slots[index] = held.count === taken ? undefined : itemStackWithCount(held, held.count - taken)
    remaining -= taken
  }
  return {
    inventory: { slots },
    furnace: {
      ...furnace,
      [slot]: itemStackWithCount(selected, (current?.count ?? 0) + count),
    },
    result: { _tag: 'Transferred', item, count },
  }
}

/** Atomically collect the complete output stack, or leave both states unchanged. */
export const collectFurnaceOutput = (
  inventory: Inventory,
  furnace: FurnaceState,
): FurnaceCollectionOutcome => {
  if (furnace.output === null) {
    return { inventory, furnace, result: { _tag: 'Empty' } }
  }
  const inserted = addItemStack(inventory, furnace.output)
  if (inserted.leftover > 0) {
    return { inventory, furnace, result: { _tag: 'NoRoom' } }
  }
  return {
    inventory: inserted.inventory,
    furnace: { ...furnace, output: null },
    result: { _tag: 'Collected', output: furnace.output },
  }
}

const assertPositiveFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be finite and greater than zero, received ${String(value)}`)
  }
}

const assertNonNegativeFinite = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative, received ${String(value)}`)
  }
}

const assertSlot = (slot: ItemStack | null, label: string): void => {
  if (slot === null) return
  if (!isItemStack(slot)) throw new RangeError(`Invalid ${label} ItemStack`)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const invalidSnapshot = (path: string, reason: string): FurnaceSnapshotValidationResult => ({
  _tag: 'Invalid',
  error: { _tag: 'FurnaceSnapshotValidationError', path, reason },
})

const isValidDuration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Validate an untrusted JSON furnace snapshot before installing it in world state. */
export const validateFurnaceSnapshot = (value: unknown): FurnaceSnapshotValidationResult => {
  if (!isRecord(value)) return invalidSnapshot('snapshot', 'expected an object')
  const keys = ['input', 'fuel', 'output', 'cookElapsedSecs', 'burnRemainingSecs']
  if (Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
    return invalidSnapshot('snapshot', `expected exactly { ${keys.join(', ')} }`)
  }

  const slots: Record<'input' | 'fuel' | 'output', ItemStack | null> = {
    input: null, fuel: null, output: null,
  }
  for (const name of ['input', 'fuel', 'output'] as const) {
    const slot = value[name]
    if (slot === null) continue
    if (!isRecord(slot) || Object.keys(slot).length !== 3 ||
        !Object.hasOwn(slot, 'item') || !Object.hasOwn(slot, 'count') || !Object.hasOwn(slot, 'components')) {
      return invalidSnapshot(name, 'expected null or a canonical ItemStack')
    }
    if (typeof slot['item'] !== 'string' || !isItemType(slot['item'])) {
      return invalidSnapshot(`${name}.item`, 'expected a known item')
    }
    const savedComponents = slot['components']
    if (!isRecord(savedComponents) ||
        !Object.hasOwn(savedComponents, 'maxStackSize') ||
        !Object.hasOwn(savedComponents, 'repairCost') ||
        !Object.hasOwn(savedComponents, 'rarity')) {
      return invalidSnapshot(`${name}.components`, 'expected valid resolved item components')
    }
    // JSON omits canonical component keys whose values are undefined.
    const components = { ...itemStack(slot['item'], 1).components, ...savedComponents }
    if (!isItemComponents(components)) {
      return invalidSnapshot(`${name}.components`, 'expected valid resolved item components')
    }
    const restored = { ...slot, components }
    if (!isItemStack(restored)) {
      return invalidSnapshot(`${name}.count`, 'expected a valid positive stack count')
    }
    slots[name] = itemStack(restored.item, restored.count, { components: restored.components })
  }

  let cookElapsedSecs = 0
  let burnRemainingSecs = 0
  for (const name of ['cookElapsedSecs', 'burnRemainingSecs'] as const) {
    const duration = value[name]
    if (!isValidDuration(duration)) {
      return invalidSnapshot(name, 'expected a finite non-negative number')
    }
    if (name === 'cookElapsedSecs') cookElapsedSecs = duration
    else burnRemainingSecs = duration
  }
  return {
    _tag: 'Valid',
    state: {
      input: slots.input,
      fuel: slots.fuel,
      output: slots.output,
      cookElapsedSecs,
      burnRemainingSecs,
    },
  }
}

const assertRecipe = (recipe: SmeltingRecipe): void => {
  if (recipe.id.length === 0) throw new RangeError('Smelting recipe id must not be empty')
  if (!isItemType(recipe.input)) {
    throw new RangeError(`Invalid input for recipe ${recipe.id}: ${String(recipe.input)}`)
  }
  assertSlot(recipe.output, `output for recipe ${recipe.id}`)
  assertPositiveFinite(recipe.cookDurationSecs, `Cook duration for recipe ${recipe.id}`)
}

const assertFuelRule = (rule: FuelRule): void => {
  if (!isItemType(rule.item)) {
    throw new RangeError(`Invalid fuel item: ${String(rule.item)}`)
  }
  assertPositiveFinite(rule.burnDurationSecs, `Burn duration for fuel ${rule.item}`)
}

const decrementSlot = (slot: ItemStack): ItemStack | null =>
  slot.count === 1 ? null : itemStackWithCount(slot, slot.count - 1)

const outputAccepts = (output: ItemStack | null, produced: ItemStack): boolean =>
  output === null ||
  (itemStacksCanMerge(output, produced) &&
    output.count + produced.count <= maxStackCountForStack(output))

const addOutput = (output: ItemStack | null, produced: ItemStack): ItemStack =>
  output === null
    ? produced
    : itemStackWithCount(output, output.count + produced.count)

export const matchSmeltingRecipe = (
  recipes: ReadonlyArray<SmeltingRecipe>,
  input: ItemStack | null,
): SmeltingRecipe | null => {
  assertSlot(input, 'furnace input')
  for (const recipe of recipes) assertRecipe(recipe)
  if (input === null) return null
  return recipes.find((recipe) => recipe.input === input.item) ?? null
}

export const advanceFurnace = (
  state: FurnaceState,
  deltaTimeSecs: number,
  recipes: ReadonlyArray<SmeltingRecipe> = STARTER_SMELTING_RECIPES,
  fuelRules: ReadonlyArray<FuelRule> = STARTER_FUEL_RULES,
): FurnaceOutcome => {
  if (!Number.isFinite(deltaTimeSecs) || deltaTimeSecs <= 0) {
    return { state, smelted: 0, fuelConsumed: 0 }
  }

  assertSlot(state.input, 'furnace input')
  assertSlot(state.fuel, 'furnace fuel')
  assertSlot(state.output, 'furnace output')
  assertNonNegativeFinite(state.cookElapsedSecs, 'Cook elapsed time')
  assertNonNegativeFinite(state.burnRemainingSecs, 'Burn remaining time')
  for (const recipe of recipes) assertRecipe(recipe)
  for (const rule of fuelRules) assertFuelRule(rule)

  let input = state.input
  let fuel = state.fuel
  let output = state.output
  let cookElapsedSecs = state.cookElapsedSecs
  let burnRemainingSecs = state.burnRemainingSecs
  let remainingSecs = deltaTimeSecs
  let smelted = 0
  let fuelConsumed = 0

  while (remainingSecs > 0) {
    const recipe = matchSmeltingRecipe(recipes, input)
    if (recipe === null || input === null) {
      cookElapsedSecs = 0
      break
    }
    if (cookElapsedSecs >= recipe.cookDurationSecs) {
      throw new RangeError('Cook elapsed time must be less than the matched recipe duration')
    }
    if (!outputAccepts(output, recipe.output)) {
      cookElapsedSecs = 0
      break
    }

    if (burnRemainingSecs === 0) {
      if (fuel === null) break
      const fuelItem = fuel.item
      const fuelRule = fuelRules.find((rule) => rule.item === fuelItem)
      if (fuelRule === undefined) break
      fuel = decrementSlot(fuel)
      burnRemainingSecs = fuelRule.burnDurationSecs
      fuelConsumed += 1
    }

    const cookRemainingSecs = recipe.cookDurationSecs - cookElapsedSecs
    const activeSecs = Math.min(remainingSecs, burnRemainingSecs, cookRemainingSecs)
    const completedRecipe = activeSecs >= cookRemainingSecs
    remainingSecs = Math.max(0, remainingSecs - activeSecs)
    burnRemainingSecs = Math.max(0, burnRemainingSecs - activeSecs)
    cookElapsedSecs += activeSecs

    if (completedRecipe) {
      input = decrementSlot(input)
      output = addOutput(output, recipe.output)
      cookElapsedSecs = 0
      smelted += 1
    }
  }

  return {
    state: { input, fuel, output, cookElapsedSecs, burnRemainingSecs },
    smelted,
    fuelConsumed,
  }
}
