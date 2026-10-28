import * as Eq from './equipment.js'
import * as Inv from './inventory.js'
import { Brand, Result, Schema } from 'effect'
import {
  BlockAddressSchema,
  isItemStack,
  isItemType,
  itemStacksCanMerge,
  maxStackCountForStack,
  type BlockAddress,
} from '@nerima-games/mc-kernel'
import * as Player from './player-storage.js'

export type ContainerKind = 'chest' | 'shulker_box' | 'dispenser' | 'dropper' | 'hopper'

export const CHEST_CONTAINER_CAPACITY = 27 as const
export const DISPENSER_CONTAINER_CAPACITY = 9 as const
export const HOPPER_CONTAINER_CAPACITY = 5 as const
export const CONTAINER_STORAGE_SNAPSHOT_VERSION = 3 as const

export type ContainerId = string

export type WorldContainerId = string & Brand.Brand<'WorldContainerId'>
export const WorldContainerIdSchema: Schema.Codec<WorldContainerId, string> =
  Schema.NonEmptyString.pipe(Schema.brand('WorldContainerId'))

export type ContainerStorageHelperFailure =
  | { readonly _tag: 'InvalidContainerId' }
  | { readonly _tag: 'InvalidContainerKind' }
  | { readonly _tag: 'InvalidContainerDimension' }
  | { readonly _tag: 'InvalidContainerPosition' }
  | { readonly _tag: 'InvalidContainerAddress' }
  | { readonly _tag: 'InvalidContainerStorage' }

export const worldContainerId = (value: unknown): Result.Result<WorldContainerId, Schema.SchemaError> =>
  Schema.decodeUnknownResult(WorldContainerIdSchema)(value)

export type ContainerPosition = {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type ContainerStoredStack = Inv.ItemStack & {
  readonly durability: Eq.Durability | null
}

export type ContainerSlot = ContainerStoredStack | null

export type Container = {
  readonly id: ContainerId
  readonly kind: ContainerKind
  readonly slots: ReadonlyArray<ContainerSlot>
}

export type ContainerStorage = {
  readonly containers: ReadonlyArray<Container>
}

export type ContainerStorageSnapshot = {
  readonly version: typeof CONTAINER_STORAGE_SNAPSHOT_VERSION
  readonly containers: ReadonlyArray<Container>
}

export type ContainerStorageValidationError = {
  readonly _tag: 'ContainerStorageValidationError'
  readonly path: string
  readonly reason: string
}

export type ContainerStorageValidationResult =
  | { readonly _tag: 'Valid'; readonly storage: ContainerStorage }
  | { readonly _tag: 'Invalid'; readonly error: ContainerStorageValidationError }
  | { readonly _tag: 'ItemStackFailure'; readonly error: Inv.ItemStackFailure }

export type CreateContainerResult =
  | { readonly _tag: 'Created'; readonly container: Container }
  | { readonly _tag: 'AlreadyExists'; readonly container: Container }
  | { readonly _tag: 'InvalidContainerId' }
  | { readonly _tag: 'InvalidContainerKind' }

export type ContainerTransferRequest = {
  readonly direction: 'PlayerToContainer' | 'ContainerToPlayer'
  readonly containerId: ContainerId
  readonly playerSlot: number
  readonly containerSlot: number
  readonly count: number
}

export type ContainerTransferResult =
  | {
      readonly _tag: 'Transferred'
      readonly item: Inv.ItemStack['item']
      readonly count: number
      readonly direction: ContainerTransferRequest['direction']
    }
  | { readonly _tag: 'ContainerNotFound' }
  | { readonly _tag: 'InvalidPlayerSlot' }
  | { readonly _tag: 'InvalidContainerSlot' }
  | { readonly _tag: 'InvalidCount' }
  | { readonly _tag: 'EmptySource' }
  | { readonly _tag: 'InsufficientSource'; readonly available: number }
  | { readonly _tag: 'DestinationMismatch' }
  | { readonly _tag: 'DestinationFull' }
  | { readonly _tag: 'InvalidDirection' }
  | { readonly _tag: 'InvalidSourceStack' }
  | { readonly _tag: 'InvalidDestinationStack' }
  | { readonly _tag: 'InvalidSourceDurability' }
  | { readonly _tag: 'InvalidRequest' }
  | { readonly _tag: 'InvalidPlayerStorage' }
  | { readonly _tag: 'InvalidContainerStorage' }
  | { readonly _tag: 'ItemStackFailure'; readonly error: Inv.ItemStackFailure }

export type ContainerTransferOutcome = {
  readonly playerStorage: Player.PlayerStorage
  readonly containerStorage: ContainerStorage
  readonly result: ContainerTransferResult
}

export type ContainerExtractRequest = {
  readonly containerId: ContainerId
  readonly containerSlot: number
  readonly count: number
}

export type ContainerExtractResult =
  | { readonly _tag: 'Extracted'; readonly stack: ContainerStoredStack }
  | { readonly _tag: 'ContainerNotFound' }
  | { readonly _tag: 'InvalidContainerSlot' }
  | { readonly _tag: 'InvalidCount' }
  | { readonly _tag: 'EmptySource' }
  | { readonly _tag: 'InsufficientSource'; readonly available: number }
  | { readonly _tag: 'InvalidSourceStack' }
  | { readonly _tag: 'InvalidSourceDurability' }
  | { readonly _tag: 'InvalidRequest' }
  | { readonly _tag: 'InvalidContainerStorage' }
  | { readonly _tag: 'ItemStackFailure'; readonly error: Inv.ItemStackFailure }

export type ContainerExtractOutcome = {
  readonly storage: ContainerStorage
  readonly result: ContainerExtractResult
}

export type ContainerMoveRequest = {
  readonly sourceContainerId: ContainerId
  readonly sourceSlot: number
  readonly destinationContainerId: ContainerId
  readonly destinationSlot: number
  readonly count: number
}

export type ContainerMoveResult =
  | { readonly _tag: 'Moved'; readonly item: Inv.ItemStack['item']; readonly count: number }
  | { readonly _tag: 'SourceContainerNotFound' }
  | { readonly _tag: 'DestinationContainerNotFound' }
  | { readonly _tag: 'InvalidSourceSlot' }
  | { readonly _tag: 'InvalidDestinationSlot' }
  | { readonly _tag: 'InvalidCount' }
  | { readonly _tag: 'EmptySource' }
  | { readonly _tag: 'InsufficientSource'; readonly available: number }
  | { readonly _tag: 'DestinationMismatch' }
  | { readonly _tag: 'DestinationFull' }
  | { readonly _tag: 'InvalidSourceStack' }
  | { readonly _tag: 'InvalidDestinationStack' }
  | { readonly _tag: 'InvalidSourceDurability' }
  | { readonly _tag: 'InvalidRequest' }
  | { readonly _tag: 'InvalidContainerStorage' }
  | { readonly _tag: 'ItemStackFailure'; readonly error: Inv.ItemStackFailure }

export type ContainerMoveOutcome = {
  readonly storage: ContainerStorage
  readonly result: ContainerMoveResult
}

export type DrainContainerResult =
  | { readonly _tag: 'Drained'; readonly items: ReadonlyArray<ContainerStoredStack> }
  | { readonly _tag: 'ContainerNotFound' }

export type DrainContainerOutcome = {
  readonly storage: ContainerStorage
  readonly result: DrainContainerResult
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.trim() === id

const isContainerKind = (value: unknown): value is ContainerKind =>
  value === 'chest' || value === 'shulker_box' || value === 'dispenser' ||
  value === 'dropper' || value === 'hopper'

const isContainerDimension = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.trim() === value

const isContainerPosition = (value: unknown): value is ContainerPosition => {
  if (!isRecord(value) || !hasExactKeys(value, ['x', 'y', 'z'])) return false
  return Number.isSafeInteger(value['x']) && Number.isSafeInteger(value['y']) && Number.isSafeInteger(value['z'])
}

const CONTAINER_CAPACITY_BY_KIND = {
  chest: CHEST_CONTAINER_CAPACITY,
  shulker_box: CHEST_CONTAINER_CAPACITY,
  dispenser: DISPENSER_CONTAINER_CAPACITY,
  dropper: DISPENSER_CONTAINER_CAPACITY,
  hopper: HOPPER_CONTAINER_CAPACITY,
} satisfies Record<ContainerKind, number>

export function containerCapacity(kind: ContainerKind): number
export function containerCapacity(kind: unknown): number | ContainerStorageHelperFailure
export function containerCapacity(kind: unknown): number | ContainerStorageHelperFailure {
  if (!isContainerKind(kind)) return { _tag: 'InvalidContainerKind' }
  return CONTAINER_CAPACITY_BY_KIND[kind]
}

const isContainerStorageEnvelope = (value: unknown): value is ContainerStorage => {
  if (!isRecord(value) || !hasExactKeys(value, ['containers']) || !Array.isArray(value['containers']))
    return false

  const seenIds = new Set<string>()
  for (let index = 0; index < value['containers'].length; index += 1) {
    const container: unknown = value['containers'][index]
    if (!isRecord(container)) return false

    const hasKind = Object.hasOwn(container, 'kind')
    if (!(hasKind
      ? hasExactKeys(container, ['id', 'kind', 'slots'])
      : hasExactKeys(container, ['id', 'slots']))) return false

    const { id, kind, slots } = container
    if (!validId(id) || !Array.isArray(slots) || seenIds.has(id)) return false
    if (hasKind) {
      if (!isContainerKind(kind) || slots.length !== containerCapacity(kind)) return false
    } else if (slots.length !== CHEST_CONTAINER_CAPACITY) {
      // Legacy chest-shaped storage has no kind field but keeps the fixed chest capacity.
      return false
    }
    seenIds.add(id)
  }
  return true
}

const validPlayerSlot = (slot: number): boolean =>
  Number.isInteger(slot) && slot >= 0 && slot < Inv.INVENTORY_SLOT_COUNT

const validContainerSlot = (container: Container, slot: number): boolean =>
  Number.isInteger(slot) && slot >= 0 && slot < container.slots.length

const hasValidStoredStackShape = (value: unknown): value is ContainerStoredStack =>
  isRecord(value) && hasExactKeys(value, ['item', 'count', 'components', 'durability']) &&
  isItemStack({ item: value['item'], count: value['count'], components: value['components'] })

const hasValidStoredStackDurability = (stack: ContainerStoredStack): boolean =>
  Eq.isDamageableItemType(stack.item)
    ? Eq.isValidDurabilityForItem(stack.item, stack.durability)
    : stack.durability === null

const isPlayerStorageEnvelope = (value: unknown): value is Player.PlayerStorage =>
  isRecord(value) && isRecord(value['inventory']) && Array.isArray(value['inventory']['slots']) &&
  value['inventory']['slots'].length === Inv.INVENTORY_SLOT_COUNT &&
  isRecord(value['equipment']) && isRecord(value['equipment']['slots']) &&
  Array.isArray(value['inventoryDurability']) &&
  value['inventoryDurability'].length === Inv.INVENTORY_SLOT_COUNT

const copyDurability = (value: Eq.Durability | null): Eq.Durability | null =>
  value === null ? null : { ...value }

const copyStack = (stack: ContainerStoredStack): ContainerStoredStack => ({
  ...stack,
  durability: copyDurability(stack.durability),
})

const coreStack = (stack: ContainerStoredStack): Inv.ItemStack => ({
  item: stack.item, count: stack.count, components: stack.components,
})

const storedWithCount = (
  stack: ContainerStoredStack,
  count: number,
): Result.Result<ContainerStoredStack, Inv.ItemStackFailure> =>
  Result.map(Inv.itemStack(stack.item, count, { components: stack.components }), (updated) => ({
    ...updated,
    durability: copyDurability(stack.durability),
  }))

const copyContainer = (container: Container): Container => ({
  id: container.id,
  kind: container.kind,
  slots: container.slots.map((slot) => slot === null ? null : copyStack(slot)),
})

export const emptyContainerStorage = (): ContainerStorage => ({ containers: [] })

export function emptyContainer(id: ContainerId, kind?: ContainerKind): Container
export function emptyContainer(id: unknown, kind?: unknown): Container | ContainerStorageHelperFailure
export function emptyContainer(
  id: unknown,
  kind: unknown = 'chest',
): Container | ContainerStorageHelperFailure {
  if (!validId(id)) return { _tag: 'InvalidContainerId' }
  if (!isContainerKind(kind)) return { _tag: 'InvalidContainerKind' }
  return {
    id,
    kind,
    slots: Array.from({ length: CONTAINER_CAPACITY_BY_KIND[kind] }, () => null),
  }
}

/** Stable host-defined block key, including dimension when the host has more than one. */
export function containerIdAt(dimension: string, position: ContainerPosition): ContainerId
export function containerIdAt(dimension: unknown, position: unknown): ContainerId | ContainerStorageHelperFailure
export function containerIdAt(
  dimension: unknown,
  position: unknown,
): ContainerId | ContainerStorageHelperFailure {
  if (!isContainerDimension(dimension)) return { _tag: 'InvalidContainerDimension' }
  const result = Result.try({
    try: (): ContainerId | ContainerStorageHelperFailure => {
      if (!isContainerPosition(position)) return { _tag: 'InvalidContainerPosition' as const }
      return `${dimension}:${position.x},${position.y},${position.z}`
    },
    catch: () => ({ _tag: 'InvalidContainerPosition' as const }),
  })
  return Result.isFailure(result) ? result.failure : result.success
}


export function worldContainerIdAt(address: BlockAddress): WorldContainerId
export function worldContainerIdAt(address: unknown): WorldContainerId | ContainerStorageHelperFailure
export function worldContainerIdAt(address: unknown): WorldContainerId | ContainerStorageHelperFailure {
  const result = Result.try({
    try: (): WorldContainerId | ContainerStorageHelperFailure => {
      const decodedAddress = Schema.decodeUnknownResult(BlockAddressSchema)(address)
      if (Result.isFailure(decodedAddress)) return { _tag: 'InvalidContainerAddress' }
      const { dimension, position } = decodedAddress.success
      const id = `${dimension}:${position.x},${position.y},${position.z}`
      const decodedId = worldContainerId(id)
      return Result.isFailure(decodedId) ? { _tag: 'InvalidContainerAddress' } : decodedId.success
    },
    catch: () => ({ _tag: 'InvalidContainerAddress' as const }),
  })
  return Result.isFailure(result) ? result.failure : result.success
}

const isFindableContainerStorage = (value: unknown): value is ContainerStorage => {
  if (!isContainerStorageEnvelope(value)) return false
  return value.containers.every((container) => container.slots.every((slot) =>
    slot === null || (hasValidStoredStackShape(slot) && hasValidStoredStackDurability(slot)),
  ))
}

export function findContainer(storage: ContainerStorage, id: ContainerId): Container | undefined
export function findContainer(
  storage: unknown,
  id: unknown,
): Container | undefined | ContainerStorageHelperFailure
export function findContainer(
  storage: unknown,
  id: unknown,
): Container | undefined | ContainerStorageHelperFailure {
  const result = Result.try({
    try: (): Container | undefined | ContainerStorageHelperFailure => {
      if (!validId(id)) return { _tag: 'InvalidContainerId' }
      if (!isFindableContainerStorage(storage)) return { _tag: 'InvalidContainerStorage' }
      const container = storage.containers.find((candidate) => candidate.id === id)
      return container === undefined ? undefined : copyContainer(container)
    },
    catch: () => ({ _tag: 'InvalidContainerStorage' as const }),
  })
  return Result.isFailure(result) ? result.failure : result.success
}

export const createContainer = (
  storage: ContainerStorage,
  id: ContainerId,
  kind: ContainerKind = 'chest',
): { readonly storage: ContainerStorage; readonly result: CreateContainerResult } => {
  if (!validId(id)) return { storage, result: { _tag: 'InvalidContainerId' } }
  if (!isContainerKind(kind)) return { storage, result: { _tag: 'InvalidContainerKind' } }
  const existing = findContainer(storage, id)
  if (existing !== undefined) return { storage, result: { _tag: 'AlreadyExists', container: existing } }
  const container = emptyContainer(id, kind)
  return {
    storage: { containers: [...storage.containers, container] },
    result: { _tag: 'Created', container: copyContainer(container) },
  }
}

export const snapshotContainerStorage = (
  storage: ContainerStorage,
): ContainerStorageSnapshot => ({
  version: CONTAINER_STORAGE_SNAPSHOT_VERSION,
  containers: storage.containers.map(copyContainer),
})

const invalidError = (path: string, reason: string): ContainerStorageValidationError => ({
  _tag: 'ContainerStorageValidationError', path, reason,
})
const invalid = (path: string, reason: string): ContainerStorageValidationResult => ({
  _tag: 'Invalid',
  error: invalidError(path, reason),
})

type SlotValidation =
  | { readonly _tag: 'Invalid'; readonly error: ContainerStorageValidationError }
  | { readonly _tag: 'Slot'; readonly slot: ContainerSlot }
  | { readonly _tag: 'ItemStackFailure'; readonly error: Inv.ItemStackFailure }

const validateStoredSlot = (slot: unknown, slotPath: string): SlotValidation => {
  if (slot === null) return { _tag: 'Slot', slot: null }
  if (!isRecord(slot) ||
      !hasExactKeys(slot, ['item', 'count', 'components', 'durability']) ||
      typeof slot['item'] !== 'string' || !isItemType(slot['item']))
    return { _tag: 'Invalid', error: invalidError(slotPath, 'expected a valid stored item stack') }
  const count = slot['count']
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0)
    return { _tag: 'Invalid', error: invalidError(slotPath, 'expected a valid stored item stack') }
  const candidate = { item: slot['item'], count, components: slot['components'] }
  if (!isItemStack(candidate))
    return { _tag: 'Invalid', error: invalidError(slotPath, 'expected a valid stored item stack') }
  const stack = Inv.itemStack(candidate.item, candidate.count, { components: candidate.components })
  if (Result.isFailure(stack)) return { _tag: 'ItemStackFailure', error: stack.failure }
  const durability = slot['durability']
  if (Eq.isDamageableItemType(slot['item'])) {
    if (!Eq.isValidDurabilityForItem(slot['item'], durability))
      return {
        _tag: 'Invalid',
        error: invalidError(`${slotPath}.durability`, `${slot['item']} requires its exact durability range`),
      }
    return {
      _tag: 'Slot',
      slot: { ...stack.success, durability: { ...durability } },
    }
  }
  if (durability !== null)
    return { _tag: 'Invalid', error: invalidError(`${slotPath}.durability`, 'non-durable item requires null') }
  return { _tag: 'Slot', slot: { ...stack.success, durability: null } }
}

type ContainerCandidateValidation =
  | { readonly _tag: 'Invalid'; readonly error: ContainerStorageValidationError }
  | { readonly _tag: 'Container'; readonly container: Container }
  | { readonly _tag: 'ItemStackFailure'; readonly error: Inv.ItemStackFailure }

const validateContainerCandidate = (
  candidate: unknown,
  path: string,
  seenIds: ReadonlySet<string>,
): ContainerCandidateValidation => {
  if (!isRecord(candidate) || !hasExactKeys(candidate, ['id', 'kind', 'slots']))
    return {
      _tag: 'Invalid',
      error: invalidError(path, 'expected exactly id, kind and slots'),
    }
  if (typeof candidate['id'] !== 'string' || !validId(candidate['id']))
    return { _tag: 'Invalid', error: invalidError(`${path}.id`, 'expected a non-empty trimmed string') }
  if (seenIds.has(candidate['id']))
    return { _tag: 'Invalid', error: invalidError(`${path}.id`, 'container id must be unique') }
  const kind = candidate['kind']
  if (kind !== 'chest' && kind !== 'shulker_box' && kind !== 'dispenser' && kind !== 'dropper' && kind !== 'hopper')
    return { _tag: 'Invalid', error: invalidError(`${path}.kind`, 'expected a supported container kind') }
  const capacity = containerCapacity(kind)
  if (!Array.isArray(candidate['slots']) || candidate['slots'].length !== capacity)
    return { _tag: 'Invalid', error: invalidError(`${path}.slots`, `expected exactly ${capacity} slots`) }

  const slots: Array<ContainerSlot> = []
  for (let slotIndex = 0; slotIndex < capacity; slotIndex += 1) {
    const validated = validateStoredSlot(candidate['slots'][slotIndex], `${path}.slots.${slotIndex}`)
    if (validated._tag !== 'Slot') return validated
    slots.push(validated.slot)
  }
  return { _tag: 'Container', container: { id: candidate['id'], kind, slots } }
}

/** Strictly validate JSON persistence data and copy it into owned state. */
export const validateContainerStorageSnapshot = (
  value: unknown,
): ContainerStorageValidationResult => {
  if (!isRecord(value) || !hasExactKeys(value, ['version', 'containers']))
    return invalid('containerStorage', 'expected exactly version and containers')
  const version = value['version']
  if (version !== CONTAINER_STORAGE_SNAPSHOT_VERSION)
    return invalid('containerStorage.version', `expected ${CONTAINER_STORAGE_SNAPSHOT_VERSION}`)
  if (!Array.isArray(value['containers']))
    return invalid('containerStorage.containers', 'expected an array')

  const containers: Array<Container> = []
  const ids = new Set<string>()
  for (let containerIndex = 0; containerIndex < value['containers'].length; containerIndex += 1) {
    const candidate = value['containers'][containerIndex]
    const path = `containerStorage.containers.${containerIndex}`
    const validated = validateContainerCandidate(candidate, path, ids)
    if (validated._tag === 'ItemStackFailure') return validated
    if (validated._tag === 'Invalid') return { _tag: 'Invalid', error: validated.error }
    ids.add(validated.container.id)
    containers.push(validated.container)
  }
  return { _tag: 'Valid', storage: { containers } }
}

const failure = (
  playerStorage: Player.PlayerStorage,
  containerStorage: ContainerStorage,
  result: Exclude<ContainerTransferResult, { readonly _tag: 'Transferred' }>,
): ContainerTransferOutcome => ({ playerStorage, containerStorage, result })

const resolvePlayerStoredStack = (playerStorage: Player.PlayerStorage, playerSlot: number): unknown => {
  const playerStack: unknown = playerStorage.inventory.slots[playerSlot]
  if (playerStack === undefined) return null
  if (!isRecord(playerStack)) return playerStack
  return { ...playerStack, durability: playerStorage.inventoryDurability[playerSlot] ?? null }
}

type TransferSides = {
  readonly playerIsSource: boolean
  readonly source: unknown
  readonly destination: unknown
}

const resolveTransferSides = (
  direction: ContainerTransferRequest['direction'], playerStoredStack: unknown, containerStack: unknown,
): TransferSides => {
  const playerIsSource = direction === 'PlayerToContainer'
  return {
    playerIsSource,
    source: playerIsSource ? playerStoredStack : containerStack,
    destination: playerIsSource ? containerStack : playerStoredStack,
  }
}

type TransferStackValidation =
  | {
      readonly _tag: 'Invalid'
      readonly result: Exclude<ContainerTransferResult, { readonly _tag: 'Transferred' }>
    }
  | { readonly _tag: 'Valid'; readonly source: ContainerStoredStack; readonly destination: ContainerStoredStack | null }

/** Guard the resolved source/destination pair before any mutation is computed. */
const validateTransferStacks = (
  source: unknown, destination: unknown, count: number,
): TransferStackValidation => {
  if (source === null) return { _tag: 'Invalid', result: { _tag: 'EmptySource' } }
  if (!hasValidStoredStackShape(source)) return { _tag: 'Invalid', result: { _tag: 'InvalidSourceStack' } }
  if (!hasValidStoredStackDurability(source))
    return { _tag: 'Invalid', result: { _tag: 'InvalidSourceDurability' } }
  if (destination !== null &&
      (!hasValidStoredStackShape(destination) || !hasValidStoredStackDurability(destination)))
    return { _tag: 'Invalid', result: { _tag: 'InvalidDestinationStack' } }
  if (count > source.count)
    return { _tag: 'Invalid', result: { _tag: 'InsufficientSource', available: source.count } }
  if (destination !== null &&
      (!itemStacksCanMerge(coreStack(destination), coreStack(source)) || destination.durability !== null || source.durability !== null))
    return { _tag: 'Invalid', result: { _tag: 'DestinationMismatch' } }
  if ((destination?.count ?? 0) + count > maxStackCountForStack(source))
    return { _tag: 'Invalid', result: { _tag: 'DestinationFull' } }
  return { _tag: 'Valid', source, destination: destination === null ? null : destination }
}

/** Move exactly `count` items, changing player and chest together or neither. */
type TransferContainerLookupError = Extract<
  ContainerTransferResult,
  {
    readonly _tag:
      | 'InvalidDirection'
      | 'InvalidPlayerSlot'
      | 'InvalidCount'
      | 'ContainerNotFound'
      | 'InvalidContainerSlot'
  }
>

type TransferContainerLookup =
  | { readonly _tag: 'Invalid'; readonly result: TransferContainerLookupError }
  | { readonly _tag: 'Valid'; readonly container: Container; readonly containerIndex: number }

const lookupTransferContainer = (
  containerStorage: ContainerStorage,
  request: ContainerTransferRequest,
): TransferContainerLookup => {
  if (request.direction !== 'PlayerToContainer' && request.direction !== 'ContainerToPlayer')
    return { _tag: 'Invalid', result: { _tag: 'InvalidDirection' } }
  if (!validPlayerSlot(request.playerSlot))
    return { _tag: 'Invalid', result: { _tag: 'InvalidPlayerSlot' } }
  if (!Number.isSafeInteger(request.count) || request.count <= 0)
    return { _tag: 'Invalid', result: { _tag: 'InvalidCount' } }
  const container = containerStorage.containers.find(
    (candidate) => candidate.id === request.containerId,
  )
  if (container === undefined)
    return { _tag: 'Invalid', result: { _tag: 'ContainerNotFound' } }
  const containerIndex = containerStorage.containers.indexOf(container)
  if (!validContainerSlot(container, request.containerSlot))
    return { _tag: 'Invalid', result: { _tag: 'InvalidContainerSlot' } }
  return { _tag: 'Valid', container, containerIndex }
}

export const transferContainerItem = (
  playerStorage: Player.PlayerStorage,
  containerStorage: ContainerStorage,
  request: ContainerTransferRequest,
): ContainerTransferOutcome => {
  if (!isRecord(request))
    return failure(playerStorage, containerStorage, { _tag: 'InvalidRequest' })
  if (!isPlayerStorageEnvelope(playerStorage))
    return failure(playerStorage, containerStorage, { _tag: 'InvalidPlayerStorage' })
  if (!isContainerStorageEnvelope(containerStorage))
    return failure(playerStorage, containerStorage, { _tag: 'InvalidContainerStorage' })
  const lookup = lookupTransferContainer(containerStorage, request)
  if (lookup._tag === 'Invalid') return failure(playerStorage, containerStorage, lookup.result)
  const { container, containerIndex } = lookup

  const playerStoredStack = resolvePlayerStoredStack(playerStorage, request.playerSlot)
  const containerStack: unknown = container.slots[request.containerSlot] ?? null
  const { playerIsSource, source, destination } = resolveTransferSides(
    request.direction, playerStoredStack, containerStack,
  )

  const validated = validateTransferStacks(source, destination, request.count)
  if (validated._tag === 'Invalid') return failure(playerStorage, containerStorage, validated.result)
  const { source: validSource, destination: validDestination } = validated

  const remaining = validSource.count - request.count
  const movedResult = storedWithCount(validSource, (validDestination?.count ?? 0) + request.count)
  if (Result.isFailure(movedResult))
    return failure(playerStorage, containerStorage, { _tag: 'ItemStackFailure', error: movedResult.failure })
  let remainingPlayerStack: Inv.Slot = undefined
  if (playerIsSource && remaining > 0) {
    const remainingResult = Inv.itemStack(validSource.item, remaining, { components: validSource.components })
    if (Result.isFailure(remainingResult))
      return failure(playerStorage, containerStorage, { _tag: 'ItemStackFailure', error: remainingResult.failure })
    remainingPlayerStack = remainingResult.success
  }
  let remainingContainerStack: ContainerSlot = null
  if (!playerIsSource && remaining > 0) {
    const remainingResult = storedWithCount(validSource, remaining)
    if (Result.isFailure(remainingResult))
      return failure(playerStorage, containerStorage, { _tag: 'ItemStackFailure', error: remainingResult.failure })
    remainingContainerStack = remainingResult.success
  }
  let destinationPlayerStack: Inv.Slot = undefined
  if (!playerIsSource) {
    const destinationResult = Inv.itemStack(movedResult.success.item, movedResult.success.count, {
      components: movedResult.success.components,
    })
    if (Result.isFailure(destinationResult))
      return failure(playerStorage, containerStorage, { _tag: 'ItemStackFailure', error: destinationResult.failure })
    destinationPlayerStack = destinationResult.success
  }
  const moved = movedResult.success
  const playerSlots = [...playerStorage.inventory.slots]
  const playerDurability = [...playerStorage.inventoryDurability]
  const containerSlots = [...container.slots]
  if (playerIsSource) {
    playerSlots[request.playerSlot] = remainingPlayerStack
    playerDurability[request.playerSlot] = remaining === 0 ? null : copyDurability(validSource.durability)
    containerSlots[request.containerSlot] = moved
  } else {
    containerSlots[request.containerSlot] = remainingContainerStack
    playerSlots[request.playerSlot] = destinationPlayerStack
    playerDurability[request.playerSlot] = copyDurability(moved.durability)
  }
  const containers = [...containerStorage.containers]
  containers[containerIndex] = { ...container, slots: containerSlots }
  return {
    playerStorage: {
      ...playerStorage,
      inventory: { slots: playerSlots },
      inventoryDurability: playerDurability,
    },
    containerStorage: { containers },
    result: {
      _tag: 'Transferred',
      item: validSource.item,
      count: request.count,
      direction: request.direction,
    },
  }
}

/** Remove exactly `count` items from a container slot, or leave storage unchanged. */
export const extractContainerItem = (
  storage: ContainerStorage,
  request: ContainerExtractRequest,
): ContainerExtractOutcome => {
  if (!isRecord(request)) return { storage, result: { _tag: 'InvalidRequest' } }
  if (!isContainerStorageEnvelope(storage)) return { storage, result: { _tag: 'InvalidContainerStorage' } }
  const container = storage.containers.find((candidate) => candidate.id === request.containerId)
  if (container === undefined) return { storage, result: { _tag: 'ContainerNotFound' } }
  const containerIndex = storage.containers.indexOf(container)
  if (!validContainerSlot(container, request.containerSlot))
    return { storage, result: { _tag: 'InvalidContainerSlot' } }
  if (!Number.isSafeInteger(request.count) || request.count <= 0)
    return { storage, result: { _tag: 'InvalidCount' } }
  const source: unknown = container.slots[request.containerSlot] ?? null
  if (source === null) return { storage, result: { _tag: 'EmptySource' } }
  if (!hasValidStoredStackShape(source))
    return { storage, result: { _tag: 'InvalidSourceStack' } }
  if (!hasValidStoredStackDurability(source))
    return { storage, result: { _tag: 'InvalidSourceDurability' } }
  if (request.count > source.count)
    return { storage, result: { _tag: 'InsufficientSource', available: source.count } }

  const slots = [...container.slots]
  const remaining = source.count - request.count
  let remainingStack: ContainerSlot = null
  if (remaining > 0) {
    const remainingResult = storedWithCount(source, remaining)
    if (Result.isFailure(remainingResult))
      return { storage, result: { _tag: 'ItemStackFailure', error: remainingResult.failure } }
    remainingStack = remainingResult.success
  }
  const extractedResult = storedWithCount(source, request.count)
  if (Result.isFailure(extractedResult))
    return { storage, result: { _tag: 'ItemStackFailure', error: extractedResult.failure } }
  slots[request.containerSlot] = remainingStack
  const containers = [...storage.containers]
  containers[containerIndex] = { ...container, slots }
  return {
    storage: { containers },
    result: {
      _tag: 'Extracted',
      stack: extractedResult.success,
    },
  }
}

type MoveStackValidation =
  | { readonly _tag: 'Invalid'; readonly result: Exclude<ContainerMoveResult, { readonly _tag: 'Moved' }> }
  | { readonly _tag: 'Valid'; readonly source: ContainerStoredStack; readonly destination: ContainerStoredStack | null }

/** Guard the resolved source/destination pair before any move is computed. */
const validateMoveStacks = (source: unknown, destination: unknown, count: number): MoveStackValidation => {
  if (source === null) return { _tag: 'Invalid', result: { _tag: 'EmptySource' } }
  if (!hasValidStoredStackShape(source)) return { _tag: 'Invalid', result: { _tag: 'InvalidSourceStack' } }
  if (!hasValidStoredStackDurability(source))
    return { _tag: 'Invalid', result: { _tag: 'InvalidSourceDurability' } }
  if (destination !== null &&
      (!hasValidStoredStackShape(destination) || !hasValidStoredStackDurability(destination)))
    return { _tag: 'Invalid', result: { _tag: 'InvalidDestinationStack' } }
  if (count > source.count)
    return { _tag: 'Invalid', result: { _tag: 'InsufficientSource', available: source.count } }
  if (destination !== null &&
      (!itemStacksCanMerge(coreStack(destination), coreStack(source)) || destination.durability !== null || source.durability !== null))
    return { _tag: 'Invalid', result: { _tag: 'DestinationMismatch' } }
  if ((destination?.count ?? 0) + count > maxStackCountForStack(source))
    return { _tag: 'Invalid', result: { _tag: 'DestinationFull' } }
  return { _tag: 'Valid', source, destination: destination === null ? null : destination }
}

type MoveContainers = {
  readonly sourceIndex: number
  readonly destinationIndex: number
  readonly sourceContainer: Container
  readonly destinationContainer: Container
}

type MoveContainersLookup =
  | { readonly _tag: 'Invalid'; readonly result: Exclude<ContainerMoveResult, { readonly _tag: 'Moved' }> }
  | ({ readonly _tag: 'Valid' } & MoveContainers)

const lookupMoveContainers = (storage: ContainerStorage, request: ContainerMoveRequest): MoveContainersLookup => {
  const sourceContainer = storage.containers.find((container) => container.id === request.sourceContainerId)
  if (sourceContainer === undefined) return { _tag: 'Invalid', result: { _tag: 'SourceContainerNotFound' } }
  const sourceIndex = storage.containers.indexOf(sourceContainer)
  const destinationContainer = storage.containers.find(
    (container) => container.id === request.destinationContainerId,
  )
  if (destinationContainer === undefined) return { _tag: 'Invalid', result: { _tag: 'DestinationContainerNotFound' } }
  const destinationIndex = storage.containers.indexOf(destinationContainer)
  if (!validContainerSlot(sourceContainer, request.sourceSlot))
    return { _tag: 'Invalid', result: { _tag: 'InvalidSourceSlot' } }
  if (!validContainerSlot(destinationContainer, request.destinationSlot))
    return { _tag: 'Invalid', result: { _tag: 'InvalidDestinationSlot' } }
  if (!Number.isSafeInteger(request.count) || request.count <= 0)
    return { _tag: 'Invalid', result: { _tag: 'InvalidCount' } }
  if (sourceIndex === destinationIndex && request.sourceSlot === request.destinationSlot)
    return { _tag: 'Invalid', result: { _tag: 'DestinationMismatch' } }
  return {
    _tag: 'Valid',
    sourceIndex: storage.containers.indexOf(sourceContainer),
    destinationIndex: storage.containers.indexOf(destinationContainer),
    sourceContainer,
    destinationContainer,
  }
}

/** Move exactly `count` items between two containers, changing both or neither. */
export const moveContainerItem = (
  storage: ContainerStorage,
  request: ContainerMoveRequest,
): ContainerMoveOutcome => {
  if (!isRecord(request)) return { storage, result: { _tag: 'InvalidRequest' } }
  if (!isContainerStorageEnvelope(storage)) return { storage, result: { _tag: 'InvalidContainerStorage' } }
  const containers = lookupMoveContainers(storage, request)
  if (containers._tag === 'Invalid') return { storage, result: containers.result }
  const { sourceIndex, destinationIndex, sourceContainer, destinationContainer } = containers

  const source: unknown = sourceContainer.slots[request.sourceSlot] ?? null
  const destination: unknown = destinationContainer.slots[request.destinationSlot] ?? null
  const validated = validateMoveStacks(source, destination, request.count)
  if (validated._tag === 'Invalid') return { storage, result: validated.result }
  const { source: validSource, destination: validDestination } = validated

  const sourceSlots = [...sourceContainer.slots]
  const destinationSlots = sourceIndex === destinationIndex ? sourceSlots : [...destinationContainer.slots]
  const remaining = validSource.count - request.count
  let remainingStack: ContainerSlot = null
  if (remaining > 0) {
    const remainingResult = storedWithCount(validSource, remaining)
    if (Result.isFailure(remainingResult))
      return { storage, result: { _tag: 'ItemStackFailure', error: remainingResult.failure } }
    remainingStack = remainingResult.success
  }
  const destinationResult = storedWithCount(validSource, (validDestination?.count ?? 0) + request.count)
  if (Result.isFailure(destinationResult))
    return { storage, result: { _tag: 'ItemStackFailure', error: destinationResult.failure } }
  sourceSlots[request.sourceSlot] = remainingStack
  destinationSlots[request.destinationSlot] = destinationResult.success
  const updatedContainers = [...storage.containers]
  updatedContainers[sourceIndex] = { ...sourceContainer, slots: sourceSlots }
  if (sourceIndex !== destinationIndex)
    updatedContainers[destinationIndex] = { ...destinationContainer, slots: destinationSlots }
  return {
    storage: { containers: updatedContainers },
    result: { _tag: 'Moved', item: validSource.item, count: request.count },
  }
}

/** Remove a chest and return its contents once; later calls observe it as absent. */
export function drainContainer(storage: ContainerStorage, id: ContainerId): DrainContainerOutcome
export function drainContainer(
  storage: unknown,
  id: unknown,
): DrainContainerOutcome | ContainerStorageHelperFailure
export function drainContainer(
  storage: unknown,
  id: unknown,
): DrainContainerOutcome | ContainerStorageHelperFailure {
  const result = Result.try({
    try: (): DrainContainerOutcome | ContainerStorageHelperFailure => {
      if (!validId(id)) return { _tag: 'InvalidContainerId' }
      if (!isFindableContainerStorage(storage)) return { _tag: 'InvalidContainerStorage' }
      const container = storage.containers.find((candidate) => candidate.id === id)
      if (container === undefined) return { storage, result: { _tag: 'ContainerNotFound' } }
      const index = storage.containers.indexOf(container)
      return {
        storage: { containers: storage.containers.filter((_, candidate) => candidate !== index) },
        result: {
          _tag: 'Drained',
          items: container.slots.flatMap((slot) => slot === null ? [] : [copyStack(slot)]),
        },
      }
    },
    catch: () => ({ _tag: 'InvalidContainerStorage' as const }),
  })
  return Result.isFailure(result) ? result.failure : result.success
}
