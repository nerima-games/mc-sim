import * as Eq from './equipment'
import * as Inv from './inventory'
import { isItemType, StackCount } from '@nerima-games/mc-kernel'
import * as Player from './player-storage'

export type ContainerKind = 'chest' | 'shulker_box' | 'dispenser' | 'dropper' | 'hopper'

export const CHEST_CONTAINER_CAPACITY = 27 as const
export const DISPENSER_CONTAINER_CAPACITY = 9 as const
export const HOPPER_CONTAINER_CAPACITY = 5 as const
export const CONTAINER_STORAGE_SNAPSHOT_VERSION = 2 as const

export type ContainerId = string

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

/** @deprecated Use Container. */
export type ChestContainer = Container

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

export type CreateContainerResult =
  | { readonly _tag: 'Created'; readonly container: ChestContainer }
  | { readonly _tag: 'AlreadyExists'; readonly container: ChestContainer }
  | { readonly _tag: 'InvalidContainerId' }

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

const validId = (id: string): boolean => id.length > 0 && id.trim() === id

const copyDurability = (value: Eq.Durability | null): Eq.Durability | null =>
  value === null ? null : { ...value }

const copyStack = (stack: ContainerStoredStack): ContainerStoredStack => ({
  item: stack.item,
  count: stack.count,
  durability: copyDurability(stack.durability),
})

export const containerCapacity = (kind: ContainerKind): number => {
  switch (kind) {
    case 'chest':
    case 'shulker_box':
      return CHEST_CONTAINER_CAPACITY
    case 'dispenser':
    case 'dropper':
      return DISPENSER_CONTAINER_CAPACITY
    case 'hopper':
      return HOPPER_CONTAINER_CAPACITY
  }
}

const copyContainer = (container: Container): Container => ({
  id: container.id,
  kind: container.kind,
  slots: container.slots.map((slot) => slot === null ? null : copyStack(slot)),
})

export const emptyContainerStorage = (): ContainerStorage => ({ containers: [] })

export const emptyContainer = (
  id: ContainerId,
  kind: ContainerKind = 'chest',
): Container => ({
  id,
  kind,
  slots: Array.from({ length: containerCapacity(kind) }, () => null),
})

export const emptyChestContainer = (id: ContainerId): ChestContainer =>
  emptyContainer(id, 'chest')

/** Stable host-defined block key, including dimension when the host has more than one. */
export const containerIdAt = (
  dimension: string,
  position: ContainerPosition,
): ContainerId => `${dimension}:${position.x},${position.y},${position.z}`

export const findContainer = (
  storage: ContainerStorage,
  id: ContainerId,
): ChestContainer | undefined => {
  const container = storage.containers.find((candidate) => candidate.id === id)
  return container === undefined ? undefined : copyContainer(container)
}

export const createContainer = (
  storage: ContainerStorage,
  id: ContainerId,
  kind: ContainerKind = 'chest',
): { readonly storage: ContainerStorage; readonly result: CreateContainerResult } => {
  if (!validId(id)) return { storage, result: { _tag: 'InvalidContainerId' } }
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

const invalid = (path: string, reason: string): ContainerStorageValidationResult => ({
  _tag: 'Invalid',
  error: { _tag: 'ContainerStorageValidationError', path, reason },
})

/** Strictly validate JSON persistence data and copy it into owned state. */
export const validateContainerStorageSnapshot = (
  value: unknown,
): ContainerStorageValidationResult => {
  if (!isRecord(value) || !hasExactKeys(value, ['version', 'containers']))
    return invalid('containerStorage', 'expected exactly version and containers')
  const version = value['version']
  if (version !== 1 && version !== CONTAINER_STORAGE_SNAPSHOT_VERSION)
    return invalid('containerStorage.version', `expected 1 or ${CONTAINER_STORAGE_SNAPSHOT_VERSION}`)
  if (!Array.isArray(value['containers']))
    return invalid('containerStorage.containers', 'expected an array')

  const containers: Array<Container> = []
  const ids = new Set<string>()
  for (let containerIndex = 0; containerIndex < value['containers'].length; containerIndex += 1) {
    const candidate = value['containers'][containerIndex]
    const path = `containerStorage.containers.${containerIndex}`
    const legacy = version === 1
    if (!isRecord(candidate) || !hasExactKeys(candidate, legacy ? ['id', 'slots'] : ['id', 'kind', 'slots']))
      return invalid(path, legacy ? 'expected exactly id and slots' : 'expected exactly id, kind and slots')
    if (typeof candidate['id'] !== 'string' || !validId(candidate['id']))
      return invalid(`${path}.id`, 'expected a non-empty trimmed string')
    if (ids.has(candidate['id'])) return invalid(`${path}.id`, 'container id must be unique')
    const kind = legacy ? 'chest' : candidate['kind']
    if (kind !== 'chest' && kind !== 'shulker_box' && kind !== 'dispenser' && kind !== 'dropper' && kind !== 'hopper')
      return invalid(`${path}.kind`, 'expected a supported container kind')
    const capacity = containerCapacity(kind)
    if (!Array.isArray(candidate['slots']) || candidate['slots'].length !== capacity)
      return invalid(`${path}.slots`, `expected exactly ${capacity} slots`)

    const slots: Array<ContainerSlot> = []
    for (let slotIndex = 0; slotIndex < capacity; slotIndex += 1) {
      const slot = candidate['slots'][slotIndex]
      const slotPath = `${path}.slots.${slotIndex}`
      if (slot === null) {
        slots.push(null)
        continue
      }
      if (!isRecord(slot) || !hasExactKeys(slot, ['item', 'count', 'durability']) ||
          typeof slot['item'] !== 'string' || !isItemType(slot['item']) ||
          !Number.isSafeInteger(slot['count']) || (slot['count'] as number) <= 0 ||
          (slot['count'] as number) > Inv.maxStackCountForItem(slot['item']))
        return invalid(slotPath, 'expected a valid stored item stack')
      const durability = slot['durability']
      if (Eq.isDamageableItemType(slot['item'])) {
        if (!Eq.isValidDurabilityForItem(slot['item'], durability))
          return invalid(`${slotPath}.durability`, `${slot['item']} requires its exact durability range`)
        slots.push({
          item: slot['item'],
          count: StackCount(slot['count'] as number),
          durability: { ...durability },
        })
      } else {
        if (durability !== null)
          return invalid(`${slotPath}.durability`, 'non-durable item requires null')
        slots.push({ item: slot['item'], count: StackCount(slot['count'] as number), durability: null })
      }
    }
    ids.add(candidate['id'])
    containers.push({ id: candidate['id'], kind, slots })
  }
  return { _tag: 'Valid', storage: { containers } }
}

const validPlayerSlot = (slot: number): boolean =>
  Number.isInteger(slot) && slot >= 0 && slot < Inv.INVENTORY_SLOT_COUNT

const validContainerSlot = (container: Container, slot: number): boolean =>
  Number.isInteger(slot) && slot >= 0 && slot < container.slots.length

const hasValidStoredStackShape = (value: unknown): value is ContainerStoredStack =>
  isRecord(value) && hasExactKeys(value, ['item', 'count', 'durability']) &&
  typeof value['item'] === 'string' && isItemType(value['item']) &&
  Number.isSafeInteger(value['count']) && (value['count'] as number) > 0 &&
  (value['count'] as number) <= Inv.maxStackCountForItem(value['item'])

const hasValidStoredStackDurability = (stack: ContainerStoredStack): boolean =>
  Eq.isDamageableItemType(stack.item)
    ? Eq.isValidDurabilityForItem(stack.item, stack.durability)
    : stack.durability === null

const failure = (
  playerStorage: Player.PlayerStorage,
  containerStorage: ContainerStorage,
  result: Exclude<ContainerTransferResult, { readonly _tag: 'Transferred' }>,
): ContainerTransferOutcome => ({ playerStorage, containerStorage, result })

/** Move exactly `count` items, changing player and chest together or neither. */
export const transferContainerItem = (
  playerStorage: Player.PlayerStorage,
  containerStorage: ContainerStorage,
  request: ContainerTransferRequest,
): ContainerTransferOutcome => {
  if (request.direction !== 'PlayerToContainer' && request.direction !== 'ContainerToPlayer')
    return failure(playerStorage, containerStorage, { _tag: 'InvalidDirection' })
  if (!validPlayerSlot(request.playerSlot))
    return failure(playerStorage, containerStorage, { _tag: 'InvalidPlayerSlot' })
  if (!Number.isSafeInteger(request.count) || request.count <= 0)
    return failure(playerStorage, containerStorage, { _tag: 'InvalidCount' })
  const containerIndex = containerStorage.containers.findIndex(
    (container) => container.id === request.containerId,
  )
  if (containerIndex < 0)
    return failure(playerStorage, containerStorage, { _tag: 'ContainerNotFound' })
  const container = containerStorage.containers[containerIndex]
  if (container === undefined)
    return failure(playerStorage, containerStorage, { _tag: 'ContainerNotFound' })
  if (!validContainerSlot(container, request.containerSlot))
    return failure(playerStorage, containerStorage, { _tag: 'InvalidContainerSlot' })

  const playerStack: unknown = playerStorage.inventory.slots[request.playerSlot]
  const playerStoredStack: unknown = playerStack === undefined
    ? null
    : isRecord(playerStack) ? {
        ...playerStack,
        durability: playerStorage.inventoryDurability[request.playerSlot] ?? null,
      }
    : playerStack
  const containerStack: unknown = container.slots[request.containerSlot] ?? null
  const playerIsSource = request.direction === 'PlayerToContainer'
  const source: unknown = playerIsSource ? playerStoredStack : containerStack
  const destination: unknown = playerIsSource
    ? containerStack
    : playerStoredStack

  if (source === null) return failure(playerStorage, containerStorage, { _tag: 'EmptySource' })
  if (!hasValidStoredStackShape(source))
    return failure(playerStorage, containerStorage, { _tag: 'InvalidSourceStack' })
  if (!hasValidStoredStackDurability(source))
    return failure(playerStorage, containerStorage, { _tag: 'InvalidSourceDurability' })
  if (destination !== null &&
      (!hasValidStoredStackShape(destination) || !hasValidStoredStackDurability(destination)))
    return failure(playerStorage, containerStorage, { _tag: 'InvalidDestinationStack' })
  if (request.count > source.count)
    return failure(playerStorage, containerStorage, {
      _tag: 'InsufficientSource', available: source.count,
    })
  if (destination !== null &&
      (destination.item !== source.item || destination.durability !== null || source.durability !== null))
    return failure(playerStorage, containerStorage, { _tag: 'DestinationMismatch' })
  if ((destination?.count ?? 0) + request.count > Inv.maxStackCountForItem(source.item))
    return failure(playerStorage, containerStorage, { _tag: 'DestinationFull' })

  const remaining = source.count - request.count
  const moved: ContainerStoredStack = {
    item: source.item,
    count: StackCount((destination?.count ?? 0) + request.count),
    durability: copyDurability(source.durability),
  }
  const playerSlots = [...playerStorage.inventory.slots]
  const playerDurability = [...playerStorage.inventoryDurability]
  const containerSlots = [...container.slots]
  if (playerIsSource) {
    playerSlots[request.playerSlot] = remaining === 0
      ? undefined
      : Inv.itemStack(source.item, remaining)
    playerDurability[request.playerSlot] = remaining === 0 ? null : copyDurability(source.durability)
    containerSlots[request.containerSlot] = moved
  } else {
    containerSlots[request.containerSlot] = remaining === 0
      ? null
      : { ...source, count: StackCount(remaining), durability: copyDurability(source.durability) }
    playerSlots[request.playerSlot] = Inv.itemStack(moved.item, moved.count)
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
      item: source.item,
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
  const containerIndex = storage.containers.findIndex((container) => container.id === request.containerId)
  if (containerIndex < 0) return { storage, result: { _tag: 'ContainerNotFound' } }
  const container = storage.containers[containerIndex]
  if (container === undefined) return { storage, result: { _tag: 'ContainerNotFound' } }
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
  slots[request.containerSlot] = remaining === 0
    ? null
    : { ...source, count: StackCount(remaining), durability: copyDurability(source.durability) }
  const containers = [...storage.containers]
  containers[containerIndex] = { ...container, slots }
  return {
    storage: { containers },
    result: {
      _tag: 'Extracted',
      stack: { item: source.item, count: StackCount(request.count), durability: copyDurability(source.durability) },
    },
  }
}

/** Move exactly `count` items between two containers, changing both or neither. */
export const moveContainerItem = (
  storage: ContainerStorage,
  request: ContainerMoveRequest,
): ContainerMoveOutcome => {
  const sourceIndex = storage.containers.findIndex((container) => container.id === request.sourceContainerId)
  if (sourceIndex < 0) return { storage, result: { _tag: 'SourceContainerNotFound' } }
  const destinationIndex = storage.containers.findIndex(
    (container) => container.id === request.destinationContainerId,
  )
  if (destinationIndex < 0) return { storage, result: { _tag: 'DestinationContainerNotFound' } }
  const sourceContainer = storage.containers[sourceIndex]
  const destinationContainer = storage.containers[destinationIndex]
  if (sourceContainer === undefined) return { storage, result: { _tag: 'SourceContainerNotFound' } }
  if (destinationContainer === undefined)
    return { storage, result: { _tag: 'DestinationContainerNotFound' } }
  if (!validContainerSlot(sourceContainer, request.sourceSlot))
    return { storage, result: { _tag: 'InvalidSourceSlot' } }
  if (!validContainerSlot(destinationContainer, request.destinationSlot))
    return { storage, result: { _tag: 'InvalidDestinationSlot' } }
  if (!Number.isSafeInteger(request.count) || request.count <= 0)
    return { storage, result: { _tag: 'InvalidCount' } }
  if (sourceIndex === destinationIndex && request.sourceSlot === request.destinationSlot)
    return { storage, result: { _tag: 'DestinationMismatch' } }

  const source: unknown = sourceContainer.slots[request.sourceSlot] ?? null
  const destination: unknown = destinationContainer.slots[request.destinationSlot] ?? null
  if (source === null) return { storage, result: { _tag: 'EmptySource' } }
  if (!hasValidStoredStackShape(source)) return { storage, result: { _tag: 'InvalidSourceStack' } }
  if (!hasValidStoredStackDurability(source))
    return { storage, result: { _tag: 'InvalidSourceDurability' } }
  if (destination !== null &&
      (!hasValidStoredStackShape(destination) || !hasValidStoredStackDurability(destination)))
    return { storage, result: { _tag: 'InvalidDestinationStack' } }
  if (request.count > source.count)
    return { storage, result: { _tag: 'InsufficientSource', available: source.count } }
  if (destination !== null &&
      (destination.item !== source.item || destination.durability !== null || source.durability !== null))
    return { storage, result: { _tag: 'DestinationMismatch' } }
  if ((destination?.count ?? 0) + request.count > Inv.maxStackCountForItem(source.item))
    return { storage, result: { _tag: 'DestinationFull' } }

  const sourceSlots = [...sourceContainer.slots]
  const destinationSlots = sourceIndex === destinationIndex ? sourceSlots : [...destinationContainer.slots]
  const remaining = source.count - request.count
  sourceSlots[request.sourceSlot] = remaining === 0
    ? null
    : { ...source, count: StackCount(remaining), durability: copyDurability(source.durability) }
  destinationSlots[request.destinationSlot] = {
    item: source.item,
    count: StackCount((destination?.count ?? 0) + request.count),
    durability: copyDurability(source.durability),
  }
  const containers = [...storage.containers]
  containers[sourceIndex] = { ...sourceContainer, slots: sourceSlots }
  if (sourceIndex !== destinationIndex)
    containers[destinationIndex] = { ...destinationContainer, slots: destinationSlots }
  return {
    storage: { containers },
    result: { _tag: 'Moved', item: source.item, count: request.count },
  }
}

/** Remove a chest and return its contents once; later calls observe it as absent. */
export const drainContainer = (
  storage: ContainerStorage,
  id: ContainerId,
): DrainContainerOutcome => {
  const index = storage.containers.findIndex((container) => container.id === id)
  if (index < 0) return { storage, result: { _tag: 'ContainerNotFound' } }
  const container = storage.containers[index]
  if (container === undefined) return { storage, result: { _tag: 'ContainerNotFound' } }
  return {
    storage: { containers: storage.containers.filter((_, candidate) => candidate !== index) },
    result: {
      _tag: 'Drained',
      items: container.slots.flatMap((slot) => slot === null ? [] : [copyStack(slot)]),
    },
  }
}
