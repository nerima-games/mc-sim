import {
  addItem,
  countOf,
  itemStack,
  maxStackCountForItem,
  removeItem,
  type Inventory,
  type ItemStack,
} from './inventory'
import { isItemType, type ItemType } from './kernel-vocabulary'

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

export const STARTER_SMELTING_RECIPES: ReadonlyArray<SmeltingRecipe> = [
  {
    id: 'mc-sim:iron-ingot',
    input: 'raw_iron',
    output: itemStack('iron_ingot', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:stone',
    input: 'cobblestone',
    output: itemStack('stone', 1),
    cookDurationSecs: 10,
  },
  {
    id: 'mc-sim:glass',
    input: 'sand',
    output: itemStack('glass', 1),
    cookDurationSecs: 10,
  },
]

export const STARTER_FUEL_RULES: ReadonlyArray<FuelRule> = [
  { item: 'coal', burnDurationSecs: 80 },
  { item: 'coal_block', burnDurationSecs: 800 },
  { item: 'oak_log', burnDurationSecs: 15 },
  { item: 'oak_planks', burnDurationSecs: 15 },
  { item: 'stick', burnDurationSecs: 5 },
]

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
  const available = countOf(inventory, item)
  if (available < count) {
    return { inventory, furnace, result: { _tag: 'InsufficientItems', available } }
  }
  const current = furnace[slot]
  if (current !== null && current.item !== item) {
    return { inventory, furnace, result: { _tag: 'WrongItem', expected: current.item } }
  }
  const capacity = maxStackCountForItem(item) - (current?.count ?? 0)
  if (capacity < count) {
    return { inventory, furnace, result: { _tag: 'NoRoom', available: capacity } }
  }
  const removed = removeItem(inventory, item, count)
  return {
    inventory: removed.inventory,
    furnace: {
      ...furnace,
      [slot]: itemStack(item, (current?.count ?? 0) + count),
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
  const inserted = addItem(inventory, furnace.output.item, furnace.output.count)
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
  if (slot === undefined) {
    throw new RangeError(`${label} must use null for an empty slot`)
  }
  if (!isItemType(slot.item)) {
    throw new RangeError(`Invalid ${label} item: ${String(slot.item)}`)
  }

  if (
    !Number.isInteger(slot.count) ||
    slot.count <= 0 ||
    slot.count > maxStackCountForItem(slot.item)
  ) {
    throw new RangeError(`Invalid ${label} stack count: ${String(slot.count)}`)
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const invalidSnapshot = (path: string, reason: string): FurnaceSnapshotValidationResult => ({
  _tag: 'Invalid',
  error: { _tag: 'FurnaceSnapshotValidationError', path, reason },
})

/** Validate an untrusted JSON furnace snapshot before installing it in world state. */
export const validateFurnaceSnapshot = (value: unknown): FurnaceSnapshotValidationResult => {
  if (!isRecord(value)) return invalidSnapshot('snapshot', 'expected an object')
  const keys = ['input', 'fuel', 'output', 'cookElapsedSecs', 'burnRemainingSecs']
  if (Object.keys(value).length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
    return invalidSnapshot('snapshot', `expected exactly { ${keys.join(', ')} }`)
  }

  for (const name of ['input', 'fuel', 'output'] as const) {
    const slot = value[name]
    if (slot === null) continue
    if (!isRecord(slot) || Object.keys(slot).length !== 2 ||
        !Object.hasOwn(slot, 'item') || !Object.hasOwn(slot, 'count')) {
      return invalidSnapshot(name, 'expected null or exactly { item, count }')
    }
    if (typeof slot['item'] !== 'string' || !isItemType(slot['item'])) {
      return invalidSnapshot(`${name}.item`, 'expected a known item')
    }
    if (
      !Number.isSafeInteger(slot['count']) ||
      (slot['count'] as number) <= 0 ||
      (slot['count'] as number) > maxStackCountForItem(slot['item'])
    ) {
      return invalidSnapshot(`${name}.count`, 'expected a valid positive stack count')
    }
  }

  for (const name of ['cookElapsedSecs', 'burnRemainingSecs'] as const) {
    const duration = value[name]
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
      return invalidSnapshot(name, 'expected a finite non-negative number')
    }
  }

  return {
    _tag: 'Valid',
    state: {
      input: value['input'] as ItemStack | null,
      fuel: value['fuel'] as ItemStack | null,
      output: value['output'] as ItemStack | null,
      cookElapsedSecs: value['cookElapsedSecs'] as number,
      burnRemainingSecs: value['burnRemainingSecs'] as number,
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
  slot.count === 1 ? null : itemStack(slot.item, slot.count - 1)

const outputAccepts = (output: ItemStack | null, produced: ItemStack): boolean =>
  output === null ||
  (output.item === produced.item &&
    output.count + produced.count <= maxStackCountForItem(produced.item))

const addOutput = (output: ItemStack | null, produced: ItemStack): ItemStack =>
  output === null
    ? itemStack(produced.item, produced.count)
    : itemStack(output.item, output.count + produced.count)

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
