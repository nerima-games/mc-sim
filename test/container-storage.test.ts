import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeInventoryService } from '../src/application/inventory-service'
import {
  CHEST_CONTAINER_CAPACITY,
  CONTAINER_STORAGE_SNAPSHOT_VERSION,
  DISPENSER_CONTAINER_CAPACITY,
  containerIdAt,
  createContainer,
  emptyChestContainer,
  emptyContainerStorage,
  HOPPER_CONTAINER_CAPACITY,
  extractContainerItem,
  findContainer,
  moveContainerItem,
  snapshotContainerStorage,
  transferContainerItem,
  validateContainerStorageSnapshot,
} from '../src/domain/container-storage'
import { itemStack } from '../src/domain/inventory'
import { emptyPlayerStorage } from '../src/domain/player-storage'

const bytes = (value: unknown): string => JSON.stringify(value)

describe('container storage domain', () => {
  it('creates one fixed-capacity chest under a stable block id', () => {
    const id = containerIdAt('overworld', { x: 12, y: 64, z: -7 })
    expect(id).toBe('overworld:12,64,-7')

    const created = createContainer(emptyContainerStorage(), id)
    expect(created.result._tag).toBe('Created')
    expect(created.storage.containers[0]?.slots).toHaveLength(CHEST_CONTAINER_CAPACITY)
    expect(created.storage.containers[0]?.slots.every((slot) => slot === null)).toBe(true)

    const duplicate = createContainer(created.storage, id)
    expect(duplicate.result._tag).toBe('AlreadyExists')
    expect(duplicate.storage).toBe(created.storage)
  })

  it('strictly rejects duplicate ids, malformed slots, and unknown snapshot versions', () => {
    const created = createContainer(emptyContainerStorage(), 'chest-a').storage
    const snapshot = snapshotContainerStorage(created)
    expect(validateContainerStorageSnapshot({ ...snapshot, version: 3 })._tag).toBe('Invalid')
    expect(validateContainerStorageSnapshot({
      ...snapshot,
      containers: [...snapshot.containers, snapshot.containers[0]],
    })._tag).toBe('Invalid')
    expect(validateContainerStorageSnapshot({
      ...snapshot,
      containers: [{ id: 'chest-a', slots: [] }],
    })._tag).toBe('Invalid')
  })

  it('uses kind-specific capacities and migrates v1 chest snapshots', () => {
    const dispenser = createContainer(emptyContainerStorage(), 'dispenser', 'dispenser')
    const dropper = createContainer(dispenser.storage, 'dropper', 'dropper')
    const hopper = createContainer(dropper.storage, 'hopper', 'hopper')

    expect(dispenser.storage.containers[0]?.slots).toHaveLength(DISPENSER_CONTAINER_CAPACITY)
    expect(dropper.storage.containers[1]?.slots).toHaveLength(DISPENSER_CONTAINER_CAPACITY)
    expect(hopper.storage.containers[2]?.slots).toHaveLength(HOPPER_CONTAINER_CAPACITY)

    const legacy = {
      version: 1,
      containers: [{ id: 'legacy-chest', slots: Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) }],
    }
    const restored = validateContainerStorageSnapshot(legacy)
    expect(restored._tag).toBe('Valid')
    if (restored._tag !== 'Valid') return
    expect(restored.storage.containers[0]?.kind).toBe('chest')
    expect(snapshotContainerStorage(restored.storage).version).toBe(CONTAINER_STORAGE_SNAPSHOT_VERSION)
  })

  it('does not expose stored slot or durability references through create and find results', () => {
    const created = createContainer(emptyContainerStorage(), 'isolated')
    expect(created.result._tag).toBe('Created')
    if (created.result._tag !== 'Created') return
    const resultSlots = created.result.container.slots as Array<unknown>
    resultSlots[0] = { ...itemStack('stone', 1), durability: null }
    expect(created.storage.containers[0]?.slots[0]).toBeNull()

    const slots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    slots[0] = { ...itemStack('bow', 1), durability: { current: 365, max: 384 } }
    const storage = {
      containers: [{ id: 'existing', slots }],
    } as unknown as ReturnType<typeof emptyContainerStorage>
    const duplicate = createContainer(storage, 'existing')
    expect(duplicate.result._tag).toBe('AlreadyExists')
    if (duplicate.result._tag !== 'AlreadyExists') return
    const duplicateDurability = duplicate.result.container.slots[0]?.durability as {
      current: number
      max: number
    }
    duplicateDurability.current = 1
    expect(storage.containers[0]?.slots[0]?.durability?.current).toBe(365)

    const found = findContainer(storage, 'existing')
    const foundDurability = found?.slots[0]?.durability as { current: number; max: number }
    foundDurability.current = 2
    expect(storage.containers[0]?.slots[0]?.durability?.current).toBe(365)
  })

  it('rejects non-damageable source items carrying durability without changing either side', () => {
    const player = emptyPlayerStorage()
    const created = createContainer(emptyContainerStorage(), 'invalid-chest').storage
    const container = created.containers[0]
    const invalidStorage = {
      containers: [{
        id: 'invalid-chest',
        kind: 'chest' as const,
        slots: container?.slots.map((slot, index) => index === 0
          ? { ...itemStack('stone', 1), durability: { current: 1, max: 1 } }
          : slot) ?? [],
      }],
    }

    const outcome = transferContainerItem(player, invalidStorage, {
      direction: 'ContainerToPlayer',
      containerId: 'invalid-chest',
      playerSlot: 0,
      containerSlot: 0,
      count: 1,
    })

    expect(outcome.result).toStrictEqual({ _tag: 'InvalidSourceDurability' })
    expect(outcome.playerStorage).toBe(player)
    expect(outcome.containerStorage).toBe(invalidStorage)
  })

  it('rejects malformed source and destination stacks before moving items', () => {
    const player = {
      ...emptyPlayerStorage(),
      inventory: {
        slots: [itemStack('stone', 1), ...Array.from({ length: 35 }, () => undefined)],
      },
    }
    const sourceSlots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    sourceSlots[0] = { item: 'bow', count: 2, durability: { current: 384, max: 384 } }
    const invalidSource = {
      containers: [{ id: 'invalid-source', slots: sourceSlots }],
    } as unknown as ReturnType<typeof emptyContainerStorage>
    expect(transferContainerItem(player, invalidSource, {
      direction: 'ContainerToPlayer',
      containerId: 'invalid-source',
      playerSlot: 1,
      containerSlot: 0,
      count: 1,
    }).result).toStrictEqual({ _tag: 'InvalidSourceStack' })

    const destinationSlots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    destinationSlots[0] = { item: 'stone', count: 65, durability: null }
    const invalidDestination = {
      containers: [{ id: 'invalid-destination', slots: destinationSlots }],
    } as unknown as ReturnType<typeof emptyContainerStorage>
    expect(transferContainerItem(player, invalidDestination, {
      direction: 'PlayerToContainer',
      containerId: 'invalid-destination',
      playerSlot: 0,
      containerSlot: 0,
      count: 1,
    }).result).toStrictEqual({ _tag: 'InvalidDestinationStack' })
  })

  it('rejects an unknown transfer direction at the runtime boundary', () => {
    const player = emptyPlayerStorage()
    const storage = createContainer(emptyContainerStorage(), 'direction').storage
    const request = {
      direction: 'Sideways',
      containerId: 'direction',
      playerSlot: 0,
      containerSlot: 0,
      count: 1,
    } as unknown as Parameters<typeof transferContainerItem>[2]

    const outcome = transferContainerItem(player, storage, request)
    expect(outcome.result).toStrictEqual({ _tag: 'InvalidDirection' })
    expect(outcome.playerStorage).toBe(player)
    expect(outcome.containerStorage).toBe(storage)
  })

  it('creates a chest-kind container via the deprecated emptyChestContainer alias', () => {
    const container = emptyChestContainer('legacy-chest')
    expect(container.kind).toBe('chest')
    expect(container.slots).toHaveLength(CHEST_CONTAINER_CAPACITY)
    expect(container.slots.every((slot) => slot === null)).toBe(true)
  })

  it('rejects an empty container id without touching storage', () => {
    const storage = emptyContainerStorage()
    const created = createContainer(storage, '')
    expect(created.result).toStrictEqual({ _tag: 'InvalidContainerId' })
    expect(created.storage).toBe(storage)
  })

  it('rejects a snapshot whose top level is not a record with exactly version and containers', () => {
    expect(validateContainerStorageSnapshot(null)._tag).toBe('Invalid')
    expect(validateContainerStorageSnapshot([])._tag).toBe('Invalid')
    expect(validateContainerStorageSnapshot({ version: CONTAINER_STORAGE_SNAPSHOT_VERSION })._tag).toBe('Invalid')
  })

  it('rejects a snapshot whose containers field is not an array', () => {
    const result = validateContainerStorageSnapshot({
      version: CONTAINER_STORAGE_SNAPSHOT_VERSION,
      containers: 'not-an-array',
    })
    expect(result).toStrictEqual({
      _tag: 'Invalid',
      error: {
        _tag: 'ContainerStorageValidationError',
        path: 'containerStorage.containers',
        reason: 'expected an array',
      },
    })
  })

  it('rejects a legacy (v1) candidate with the legacy-shaped error message', () => {
    const result = validateContainerStorageSnapshot({
      version: 1,
      containers: [{ id: 'legacy', kind: 'chest', slots: [] }],
    })
    expect(result).toStrictEqual({
      _tag: 'Invalid',
      error: {
        _tag: 'ContainerStorageValidationError',
        path: 'containerStorage.containers.0',
        reason: 'expected exactly id and slots',
      },
    })
  })

  it('rejects a candidate with an id that is not a non-empty trimmed string', () => {
    const result = validateContainerStorageSnapshot({
      version: CONTAINER_STORAGE_SNAPSHOT_VERSION,
      containers: [{ id: ' padded ', kind: 'chest', slots: [] }],
    })
    expect(result).toStrictEqual({
      _tag: 'Invalid',
      error: {
        _tag: 'ContainerStorageValidationError',
        path: 'containerStorage.containers.0.id',
        reason: 'expected a non-empty trimmed string',
      },
    })
  })

  it('rejects a candidate naming an unsupported container kind', () => {
    const result = validateContainerStorageSnapshot({
      version: CONTAINER_STORAGE_SNAPSHOT_VERSION,
      containers: [{ id: 'furnace-1', kind: 'furnace', slots: [] }],
    })
    expect(result).toStrictEqual({
      _tag: 'Invalid',
      error: {
        _tag: 'ContainerStorageValidationError',
        path: 'containerStorage.containers.0.kind',
        reason: 'expected a supported container kind',
      },
    })
  })

  it('rejects a candidate whose slots array length does not match its kind capacity', () => {
    const result = validateContainerStorageSnapshot({
      version: CONTAINER_STORAGE_SNAPSHOT_VERSION,
      containers: [{ id: 'short-chest', kind: 'chest', slots: [] }],
    })
    expect(result).toStrictEqual({
      _tag: 'Invalid',
      error: {
        _tag: 'ContainerStorageValidationError',
        path: 'containerStorage.containers.0.slots',
        reason: `expected exactly ${CHEST_CONTAINER_CAPACITY} slots`,
      },
    })
  })

  it('rejects a stored stack whose count exceeds its item max stack size', () => {
    const slots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    slots[0] = { item: 'stone', count: 999, durability: null }
    const result = validateContainerStorageSnapshot({
      version: CONTAINER_STORAGE_SNAPSHOT_VERSION,
      containers: [{ id: 'overfull', kind: 'chest', slots }],
    })
    expect(result).toStrictEqual({
      _tag: 'Invalid',
      error: {
        _tag: 'ContainerStorageValidationError',
        path: 'containerStorage.containers.0.slots.0',
        reason: 'expected a valid stored item stack',
      },
    })
  })

  it('rejects a non-durable stored stack that carries a non-null durability', () => {
    const slots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    slots[0] = { item: 'stone', count: 1, durability: { current: 1, max: 1 } }
    const result = validateContainerStorageSnapshot({
      version: CONTAINER_STORAGE_SNAPSHOT_VERSION,
      containers: [{ id: 'stone-chest', kind: 'chest', slots }],
    })
    expect(result).toStrictEqual({
      _tag: 'Invalid',
      error: {
        _tag: 'ContainerStorageValidationError',
        path: 'containerStorage.containers.0.slots.0.durability',
        reason: 'non-durable item requires null',
      },
    })
  })

  it('accepts and round-trips a non-durable stored stack with a null durability', () => {
    const slots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    slots[0] = { item: 'stone', count: 5, durability: null }
    const result = validateContainerStorageSnapshot({
      version: CONTAINER_STORAGE_SNAPSHOT_VERSION,
      containers: [{ id: 'stone-chest', kind: 'chest', slots }],
    })
    expect(result._tag).toBe('Valid')
    if (result._tag !== 'Valid') return
    expect(result.storage.containers[0]?.slots[0]).toStrictEqual({ item: 'stone', count: 5, durability: null })
  })

  it('rejects a player slot holding a raw non-record value as an invalid source stack', () => {
    const player = {
      ...emptyPlayerStorage(),
      inventory: {
        slots: ['not-a-stack', ...Array.from({ length: 35 }, () => undefined)],
      },
    } as unknown as ReturnType<typeof emptyPlayerStorage>
    const storage = createContainer(emptyContainerStorage(), 'chest-a').storage

    const outcome = transferContainerItem(player, storage, {
      direction: 'PlayerToContainer',
      containerId: 'chest-a',
      playerSlot: 0,
      containerSlot: 0,
      count: 1,
    })
    expect(outcome.result).toStrictEqual({ _tag: 'InvalidSourceStack' })
    expect(outcome.playerStorage).toBe(player)
    expect(outcome.containerStorage).toBe(storage)
  })

  it('rejects a PlayerToContainer transfer that would overflow the destination stack', () => {
    const player = {
      ...emptyPlayerStorage(),
      inventory: {
        slots: [itemStack('stone', 1), ...Array.from({ length: 35 }, () => undefined)],
      },
    }
    let storage = emptyContainerStorage()
    storage = createContainer(storage, 'full-chest').storage
    const container = storage.containers[0]
    if (container === undefined) throw new Error('test setup failed')
    storage = {
      containers: [
        { ...container, slots: [{ ...itemStack('stone', 64), durability: null }, ...container.slots.slice(1)] },
      ],
    }

    const outcome = transferContainerItem(player, storage, {
      direction: 'PlayerToContainer',
      containerId: 'full-chest',
      playerSlot: 0,
      containerSlot: 0,
      count: 1,
    })
    expect(outcome.result).toStrictEqual({ _tag: 'DestinationFull' })
    expect(outcome.playerStorage).toBe(player)
    expect(outcome.containerStorage).toBe(storage)
  })

  it('reports ContainerNotFound, InvalidContainerSlot, and InvalidCount for extractContainerItem', () => {
    const storage = createContainer(emptyContainerStorage(), 'chest-a').storage
    expect(extractContainerItem(storage, { containerId: 'missing', containerSlot: 0, count: 1 }).result)
      .toStrictEqual({ _tag: 'ContainerNotFound' })
    expect(extractContainerItem(storage, { containerId: 'chest-a', containerSlot: -1, count: 1 }).result)
      .toStrictEqual({ _tag: 'InvalidContainerSlot' })
    expect(extractContainerItem(storage, { containerId: 'chest-a', containerSlot: 0, count: 0 }).result)
      .toStrictEqual({ _tag: 'InvalidCount' })
  })

  it('reports EmptySource when extracting from a slot with nothing in it', () => {
    const storage = createContainer(emptyContainerStorage(), 'chest-a').storage
    const outcome = extractContainerItem(storage, { containerId: 'chest-a', containerSlot: 0, count: 1 })
    expect(outcome.result).toStrictEqual({ _tag: 'EmptySource' })
    expect(outcome.storage).toBe(storage)
  })

  it('reports InvalidSourceStack and InvalidSourceDurability for a malformed extract source', () => {
    const malformedShapeSlots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    malformedShapeSlots[0] = { item: 'stone', count: 65, durability: null }
    const malformedShapeStorage = {
      containers: [{ id: 'bad-shape', kind: 'chest' as const, slots: malformedShapeSlots }],
    } as unknown as ReturnType<typeof emptyContainerStorage>
    expect(extractContainerItem(malformedShapeStorage, {
      containerId: 'bad-shape', containerSlot: 0, count: 1,
    }).result).toStrictEqual({ _tag: 'InvalidSourceStack' })

    const badDurabilitySlots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    badDurabilitySlots[0] = { item: 'bow', count: 1, durability: { current: 1, max: 1 } }
    const badDurabilityStorage = {
      containers: [{ id: 'bad-durability', kind: 'chest' as const, slots: badDurabilitySlots }],
    } as unknown as ReturnType<typeof emptyContainerStorage>
    expect(extractContainerItem(badDurabilityStorage, {
      containerId: 'bad-durability', containerSlot: 0, count: 1,
    }).result).toStrictEqual({ _tag: 'InvalidSourceDurability' })
  })

  it('leaves the remaining count in the slot when an extract does not take the whole stack', () => {
    let storage = emptyContainerStorage()
    storage = createContainer(storage, 'source').storage
    const source = storage.containers[0]
    if (source === undefined) throw new Error('test setup failed')
    storage = {
      containers: [{ ...source, slots: [{ ...itemStack('stone', 5), durability: null }, ...source.slots.slice(1)] }],
    }

    const outcome = extractContainerItem(storage, { containerId: 'source', containerSlot: 0, count: 2 })
    expect(outcome.result).toStrictEqual({
      _tag: 'Extracted',
      stack: { item: 'stone', count: 2, durability: null },
    })
    expect(outcome.storage.containers[0]?.slots[0]).toStrictEqual({ item: 'stone', count: 3, durability: null })
  })

  it('reports SourceContainerNotFound, InvalidSourceSlot, InvalidDestinationSlot, and InvalidCount for moveContainerItem', () => {
    let storage = emptyContainerStorage()
    storage = createContainer(storage, 'source').storage
    storage = createContainer(storage, 'destination').storage

    expect(moveContainerItem(storage, {
      sourceContainerId: 'missing', sourceSlot: 0,
      destinationContainerId: 'destination', destinationSlot: 0, count: 1,
    }).result).toStrictEqual({ _tag: 'SourceContainerNotFound' })

    expect(moveContainerItem(storage, {
      sourceContainerId: 'source', sourceSlot: -1,
      destinationContainerId: 'destination', destinationSlot: 0, count: 1,
    }).result).toStrictEqual({ _tag: 'InvalidSourceSlot' })

    expect(moveContainerItem(storage, {
      sourceContainerId: 'source', sourceSlot: 0,
      destinationContainerId: 'destination', destinationSlot: -1, count: 1,
    }).result).toStrictEqual({ _tag: 'InvalidDestinationSlot' })

    expect(moveContainerItem(storage, {
      sourceContainerId: 'source', sourceSlot: 0,
      destinationContainerId: 'destination', destinationSlot: 0, count: 0,
    }).result).toStrictEqual({ _tag: 'InvalidCount' })
  })

  it('rejects a move whose source and destination are the exact same container slot', () => {
    let storage = emptyContainerStorage()
    storage = createContainer(storage, 'chest-a').storage
    const source = storage.containers[0]
    if (source === undefined) throw new Error('test setup failed')
    storage = {
      containers: [{ ...source, slots: [{ ...itemStack('stone', 1), durability: null }, ...source.slots.slice(1)] }],
    }

    const outcome = moveContainerItem(storage, {
      sourceContainerId: 'chest-a', sourceSlot: 0,
      destinationContainerId: 'chest-a', destinationSlot: 0, count: 1,
    })
    expect(outcome.result).toStrictEqual({ _tag: 'DestinationMismatch' })
    expect(outcome.storage).toBe(storage)
  })

  it('rejects moveContainerItem validation failures: empty, malformed, and mismatched stacks', () => {
    let emptyPair = emptyContainerStorage()
    emptyPair = createContainer(emptyPair, 'source').storage
    emptyPair = createContainer(emptyPair, 'destination').storage
    expect(moveContainerItem(emptyPair, {
      sourceContainerId: 'source', sourceSlot: 0,
      destinationContainerId: 'destination', destinationSlot: 0, count: 1,
    }).result).toStrictEqual({ _tag: 'EmptySource' })

    const malformedSourceSlots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    malformedSourceSlots[0] = { item: 'stone', count: 65, durability: null }
    const malformedSourceStorage = {
      containers: [
        { id: 'source', kind: 'chest' as const, slots: malformedSourceSlots },
        { id: 'destination', kind: 'chest' as const, slots: Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) },
      ],
    } as unknown as ReturnType<typeof emptyContainerStorage>
    expect(moveContainerItem(malformedSourceStorage, {
      sourceContainerId: 'source', sourceSlot: 0,
      destinationContainerId: 'destination', destinationSlot: 0, count: 1,
    }).result).toStrictEqual({ _tag: 'InvalidSourceStack' })

    const badSourceDurabilitySlots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    badSourceDurabilitySlots[0] = { item: 'bow', count: 1, durability: { current: 1, max: 1 } }
    const badSourceDurabilityStorage = {
      containers: [
        { id: 'source', kind: 'chest' as const, slots: badSourceDurabilitySlots },
        { id: 'destination', kind: 'chest' as const, slots: Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) },
      ],
    } as unknown as ReturnType<typeof emptyContainerStorage>
    expect(moveContainerItem(badSourceDurabilityStorage, {
      sourceContainerId: 'source', sourceSlot: 0,
      destinationContainerId: 'destination', destinationSlot: 0, count: 1,
    }).result).toStrictEqual({ _tag: 'InvalidSourceDurability' })

    const badDestinationSlots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    badDestinationSlots[0] = { item: 'stone', count: 65, durability: null }
    const goodSourceSlots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    goodSourceSlots[0] = { item: 'stone', count: 1, durability: null }
    const badDestinationStorage = {
      containers: [
        { id: 'source', kind: 'chest' as const, slots: goodSourceSlots },
        { id: 'destination', kind: 'chest' as const, slots: badDestinationSlots },
      ],
    } as unknown as ReturnType<typeof emptyContainerStorage>
    expect(moveContainerItem(badDestinationStorage, {
      sourceContainerId: 'source', sourceSlot: 0,
      destinationContainerId: 'destination', destinationSlot: 0, count: 1,
    }).result).toStrictEqual({ _tag: 'InvalidDestinationStack' })

    const insufficientSourceSlots = Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) as Array<unknown>
    insufficientSourceSlots[0] = { item: 'stone', count: 1, durability: null }
    const insufficientStorage = {
      containers: [
        { id: 'source', kind: 'chest' as const, slots: insufficientSourceSlots },
        { id: 'destination', kind: 'chest' as const, slots: Array.from({ length: CHEST_CONTAINER_CAPACITY }, () => null) },
      ],
    } as unknown as ReturnType<typeof emptyContainerStorage>
    expect(moveContainerItem(insufficientStorage, {
      sourceContainerId: 'source', sourceSlot: 0,
      destinationContainerId: 'destination', destinationSlot: 0, count: 2,
    }).result).toStrictEqual({ _tag: 'InsufficientSource', available: 1 })
  })

  it('moves an item between two slots of the SAME container', () => {
    let storage = emptyContainerStorage()
    storage = createContainer(storage, 'chest-a').storage
    const source = storage.containers[0]
    if (source === undefined) throw new Error('test setup failed')
    storage = {
      containers: [{ ...source, slots: [{ ...itemStack('stone', 5), durability: null }, ...source.slots.slice(1)] }],
    }

    const outcome = moveContainerItem(storage, {
      sourceContainerId: 'chest-a', sourceSlot: 0,
      destinationContainerId: 'chest-a', destinationSlot: 1, count: 2,
    })
    expect(outcome.result).toStrictEqual({ _tag: 'Moved', item: 'stone', count: 2 })
    expect(outcome.storage.containers[0]?.slots[0]).toStrictEqual({ item: 'stone', count: 3, durability: null })
    expect(outcome.storage.containers[0]?.slots[1]).toStrictEqual({ item: 'stone', count: 2, durability: null })
  })

  it('empties the source slot and merges into an existing destination stack on a full-count move', () => {
    let storage = emptyContainerStorage()
    storage = createContainer(storage, 'source').storage
    storage = createContainer(storage, 'destination').storage
    const source = storage.containers[0]
    const destination = storage.containers[1]
    if (source === undefined || destination === undefined) throw new Error('test setup failed')
    storage = {
      containers: [
        { ...source, slots: [{ ...itemStack('stone', 2), durability: null }, ...source.slots.slice(1)] },
        { ...destination, slots: [{ ...itemStack('stone', 3), durability: null }, ...destination.slots.slice(1)] },
      ],
    }

    const outcome = moveContainerItem(storage, {
      sourceContainerId: 'source', sourceSlot: 0,
      destinationContainerId: 'destination', destinationSlot: 0, count: 2,
    })
    expect(outcome.result).toStrictEqual({ _tag: 'Moved', item: 'stone', count: 2 })
    expect(outcome.storage.containers[0]?.slots[0]).toBeNull()
    expect(outcome.storage.containers[1]?.slots[0]).toStrictEqual({ item: 'stone', count: 5, durability: null })
  })
})

describe('InventoryService chest integration', () => {
  it.effect('keeps containers isolated by their dimension-qualified positions', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const position = { x: 12, y: 64, z: -4 }

      expect(yield* service.createContainerAt('overworld', position)).toMatchObject({
        _tag: 'Created', container: { id: containerIdAt('overworld', position) },
      })
      expect(yield* service.createContainerAt('nether', position, 'hopper')).toMatchObject({
        _tag: 'Created', container: { id: containerIdAt('nether', position) },
      })
      expect((yield* service.containerSnapshotAt('overworld', position))?.kind).toBe('chest')
      expect((yield* service.containerSnapshotAt('nether', position))?.kind).toBe('hopper')
      expect(yield* service.containerSnapshotAt('overworld', { ...position, x: 13 })).toBeNull()
    }),
  )

  it.effect('resolves a chest by dimension and block position', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.createContainer(containerIdAt('overworld', { x: 12, y: 64, z: -4 }))
      yield* service.add('stone', 3)
      yield* service.transferContainerItem({
        direction: 'PlayerToContainer',
        containerId: containerIdAt('overworld', { x: 12, y: 64, z: -4 }),
        playerSlot: 0,
        containerSlot: 0,
        count: 2,
      })

      expect((yield* service.containerSnapshotAt('overworld', { x: 12, y: 64, z: -4 }))?.slots[0])
        .toStrictEqual({ item: 'stone', count: 2, durability: null })
      expect(yield* service.containerSnapshotAt('nether', { x: 12, y: 64, z: -4 })).toBeNull()
    }),
  )

  it.effect('does not expose service container state through create results', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const created = yield* service.createContainer('service-isolated')
      expect(created._tag).toBe('Created')
      if (created._tag !== 'Created') return
      const slots = created.container.slots as Array<unknown>
      slots[0] = { ...itemStack('stone', 1), durability: null }
      expect((yield* service.containerSnapshot('service-isolated'))?.slots[0]).toBeNull()

      const duplicate = yield* service.createContainer('service-isolated')
      expect(duplicate._tag).toBe('AlreadyExists')
      if (duplicate._tag !== 'AlreadyExists') return
      const duplicateSlots = duplicate.container.slots as Array<unknown>
      duplicateSlots[1] = { ...itemStack('dirt', 1), durability: null }
      expect((yield* service.containerSnapshot('service-isolated'))?.slots[1]).toBeNull()
    }),
  )

  it.effect('moves stackable items in both directions and merges exact requested counts', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.createContainer('chest-a')
      yield* service.add('stone', 10)

      expect(yield* service.transferContainerItem({
        direction: 'PlayerToContainer',
        containerId: 'chest-a',
        playerSlot: 0,
        containerSlot: 0,
        count: 6,
      })).toStrictEqual({
        _tag: 'Transferred', item: 'stone', count: 6, direction: 'PlayerToContainer',
      })
      expect((yield* service.snapshot).slots[0]).toStrictEqual({ item: 'stone', count: 4 })
      expect((yield* service.containerSnapshot('chest-a'))?.slots[0]).toStrictEqual({
        item: 'stone', count: 6, durability: null,
      })

      expect(yield* service.transferContainerItem({
        direction: 'ContainerToPlayer',
        containerId: 'chest-a',
        playerSlot: 0,
        containerSlot: 0,
        count: 3,
      })).toMatchObject({ _tag: 'Transferred', count: 3 })
      expect((yield* service.snapshot).slots[0]).toStrictEqual({ item: 'stone', count: 7 })
      expect((yield* service.containerSnapshot('chest-a'))?.slots[0]).toStrictEqual({
        item: 'stone', count: 3, durability: null,
      })
    }),
  )

  it.effect('preserves damaged tool durability through a chest and persistence restore', () =>
    Effect.gen(function* () {
      const source = yield* makeInventoryService()
      yield* source.createContainer('tool-chest')
      yield* source.add('bow', 1)
      yield* source.damageAt({ _tag: 'Inventory', slotIndex: 0 }, 19)
      yield* source.transferContainerItem({
        direction: 'PlayerToContainer',
        containerId: 'tool-chest',
        playerSlot: 0,
        containerSlot: 4,
        count: 1,
      })

      const snapshot = yield* source.containerStorageSnapshot
      expect(snapshot.containers[0]?.slots[4]).toStrictEqual({
        item: 'bow', count: 1, durability: { current: 365, max: 384 },
      })

      const restored = yield* makeInventoryService()
      yield* restored.restoreContainerStorage(JSON.parse(JSON.stringify(snapshot)))
      expect(yield* restored.transferContainerItem({
        direction: 'ContainerToPlayer',
        containerId: 'tool-chest',
        playerSlot: 8,
        containerSlot: 4,
        count: 1,
      })).toMatchObject({ _tag: 'Transferred', item: 'bow' })
      const player = yield* restored.storageSnapshot
      expect(player.inventory.slots[8]).toStrictEqual({ item: 'bow', count: 1 })
      expect(player.inventoryDurability[8]).toStrictEqual({ current: 365, max: 384 })
    }),
  )

  it.effect('leaves player and chest byte-identical for every transfer failure class', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.createContainer('chest-a')
      yield* service.add('stone', 2)
      yield* service.add('dirt', 1)
      yield* service.transferContainerItem({
        direction: 'PlayerToContainer',
        containerId: 'chest-a',
        playerSlot: 1,
        containerSlot: 0,
        count: 1,
      })
      const beforePlayer = bytes(yield* service.storageSnapshot)
      const beforeContainers = bytes(yield* service.containerStorageSnapshot)
      const requests = [
        {
          direction: 'PlayerToContainer', containerId: 'missing',
          playerSlot: 0, containerSlot: 1, count: 1,
        },
        {
          direction: 'PlayerToContainer', containerId: 'chest-a',
          playerSlot: -1, containerSlot: 1, count: 1,
        },
        {
          direction: 'PlayerToContainer', containerId: 'chest-a',
          playerSlot: 0, containerSlot: CHEST_CONTAINER_CAPACITY, count: 1,
        },
        {
          direction: 'PlayerToContainer', containerId: 'chest-a',
          playerSlot: 0, containerSlot: 1, count: 0,
        },
        {
          direction: 'PlayerToContainer', containerId: 'chest-a',
          playerSlot: 5, containerSlot: 1, count: 1,
        },
        {
          direction: 'PlayerToContainer', containerId: 'chest-a',
          playerSlot: 0, containerSlot: 1, count: 3,
        },
        {
          direction: 'PlayerToContainer', containerId: 'chest-a',
          playerSlot: 0, containerSlot: 0, count: 1,
        },
      ] as const

      for (const request of requests) {
        expect((yield* service.transferContainerItem(request))._tag).not.toBe('Transferred')
        expect(bytes(yield* service.storageSnapshot)).toBe(beforePlayer)
        expect(bytes(yield* service.containerStorageSnapshot)).toBe(beforeContainers)
      }
    }),
  )

  it.effect('serializes competing transfers so only one can move the last item', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.createContainer('chest-a')
      yield* service.add('stone', 1)
      const transfer = (containerSlot: number) => service.transferContainerItem({
        direction: 'PlayerToContainer',
        containerId: 'chest-a',
        playerSlot: 0,
        containerSlot,
        count: 1,
      })

      const results = yield* Effect.all([transfer(0), transfer(1)], { concurrency: 'unbounded' })
      expect(results.map((result) => result._tag).sort()).toStrictEqual(['EmptySource', 'Transferred'])
      expect((yield* service.snapshot).slots[0]).toBeUndefined()
      const chest = yield* service.containerSnapshot('chest-a')
      expect(chest?.slots.filter((slot) => slot !== null)).toHaveLength(1)
    }),
  )

  it.effect('extracts one machine output atomically and preserves durability', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.createContainer('dispenser')
      yield* service.add('bow', 1)
      yield* service.damageAt({ _tag: 'Inventory', slotIndex: 0 }, 19)
      yield* service.transferContainerItem({
        direction: 'PlayerToContainer',
        containerId: 'dispenser',
        playerSlot: 0,
        containerSlot: 0,
        count: 1,
      })

      expect(yield* service.extractContainerItem({
        containerId: 'dispenser', containerSlot: 0, count: 1,
      })).toStrictEqual({
        _tag: 'Extracted',
        stack: { item: 'bow', count: 1, durability: { current: 365, max: 384 } },
      })
      expect((yield* service.containerSnapshot('dispenser'))?.slots[0]).toBeNull()
    }),
  )

  it.effect('moves one hopper item between containers without exposing an intermediate state', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.createContainer('source')
      yield* service.createContainer('destination')
      yield* service.add('stone', 3)
      yield* service.transferContainerItem({
        direction: 'PlayerToContainer',
        containerId: 'source',
        playerSlot: 0,
        containerSlot: 0,
        count: 3,
      })

      expect(yield* service.moveContainerItem({
        sourceContainerId: 'source', sourceSlot: 0,
        destinationContainerId: 'destination', destinationSlot: 0,
        count: 1,
      })).toStrictEqual({ _tag: 'Moved', item: 'stone', count: 1 })
      expect((yield* service.containerSnapshot('source'))?.slots[0]).toStrictEqual({
        item: 'stone', count: 2, durability: null,
      })
      expect((yield* service.containerSnapshot('destination'))?.slots[0]).toStrictEqual({
        item: 'stone', count: 1, durability: null,
      })
    }),
  )

  it.effect('moves exactly one item between positioned containers atomically', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const source = { dimension: 'overworld', position: { x: 1, y: 64, z: 1 } }
      const destination = { dimension: 'overworld', position: { x: 2, y: 64, z: 1 } }
      yield* service.createContainerAt(source.dimension, source.position)
      yield* service.createContainerAt(destination.dimension, destination.position)
      yield* service.add('stone', 2)
      yield* service.transferContainerItem({
        direction: 'PlayerToContainer',
        containerId: containerIdAt(source.dimension, source.position),
        playerSlot: 0,
        containerSlot: 0,
        count: 2,
      })

      expect(yield* service.moveOneContainerItemAt({
        source,
        sourceSlot: 0,
        destination,
        destinationSlot: 0,
      })).toStrictEqual({ _tag: 'Moved', item: 'stone', count: 1 })
      expect((yield* service.containerSnapshotAt(source.dimension, source.position))?.slots[0])
        .toStrictEqual({ item: 'stone', count: 1, durability: null })
      expect((yield* service.containerSnapshotAt(destination.dimension, destination.position))?.slots[0])
        .toStrictEqual({ item: 'stone', count: 1, durability: null })
    }),
  )

  it.effect('leaves positioned container storage unchanged when destination is absent or full', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const source = { dimension: 'overworld', position: { x: 3, y: 64, z: 1 } }
      const destination = { dimension: 'overworld', position: { x: 4, y: 64, z: 1 } }
      yield* service.createContainerAt(source.dimension, source.position)
      yield* service.createContainerAt(destination.dimension, destination.position)
      yield* service.add('stone', 66)
      yield* service.transferContainerItem({
        direction: 'PlayerToContainer',
        containerId: containerIdAt(destination.dimension, destination.position),
        playerSlot: 0,
        containerSlot: 0,
        count: 64,
      })
      yield* service.transferContainerItem({
        direction: 'PlayerToContainer',
        containerId: containerIdAt(source.dimension, source.position),
        playerSlot: 1,
        containerSlot: 0,
        count: 2,
      })
      const before = bytes(yield* service.containerStorageSnapshot)

      expect(yield* service.moveOneContainerItemAt({
        source,
        sourceSlot: 0,
        destination: { ...destination, position: { ...destination.position, x: 5 } },
        destinationSlot: 0,
      })).toStrictEqual({ _tag: 'DestinationContainerNotFound' })
      expect(bytes(yield* service.containerStorageSnapshot)).toBe(before)

      expect(yield* service.moveOneContainerItemAt({
        source,
        sourceSlot: 0,
        destination,
        destinationSlot: 0,
      })).toStrictEqual({ _tag: 'DestinationFull' })
      expect(bytes(yield* service.containerStorageSnapshot)).toBe(before)
    }),
  )

  it('keeps storage byte-identical when a container move cannot fit', () => {
    let storage = emptyContainerStorage()
    storage = createContainer(storage, 'source').storage
    storage = createContainer(storage, 'destination').storage
    const source = storage.containers[0]
    const destination = storage.containers[1]
    if (source === undefined || destination === undefined) throw new Error('test setup failed')
    storage = {
      containers: [
        { ...source, slots: [{ ...itemStack('stone', 1), durability: null }, ...source.slots.slice(1)] },
        {
          ...destination,
          slots: [{ ...itemStack('dirt', 64), durability: null }, ...destination.slots.slice(1)],
        },
      ],
    }
    const before = bytes(storage)

    const outcome = moveContainerItem(storage, {
      sourceContainerId: 'source', sourceSlot: 0,
      destinationContainerId: 'destination', destinationSlot: 0,
      count: 1,
    })

    expect(outcome.result).toStrictEqual({ _tag: 'DestinationMismatch' })
    expect(bytes(outcome.storage)).toBe(before)
  })

  it('does not extract a partial stack when the requested count is unavailable', () => {
    let storage = emptyContainerStorage()
    storage = createContainer(storage, 'source').storage
    const source = storage.containers[0]
    if (source === undefined) throw new Error('test setup failed')
    storage = {
      containers: [{ ...source, slots: [{ ...itemStack('stone', 1), durability: null }, ...source.slots.slice(1)] }],
    }
    const before = bytes(storage)

    const outcome = extractContainerItem(storage, { containerId: 'source', containerSlot: 0, count: 2 })

    expect(outcome.result).toStrictEqual({ _tag: 'InsufficientSource', available: 1 })
    expect(bytes(outcome.storage)).toBe(before)
  })

  it.effect('rejects malformed restore without changing state', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.createContainer('chest-a')
      const before = bytes(yield* service.containerStorageSnapshot)
      const malformed = {
        version: 1,
        containers: [{
          id: 'broken',
          slots: Array.from({ length: CHEST_CONTAINER_CAPACITY }, (_, index) => index === 0
            ? { item: 'bow', count: 1, durability: { current: 999, max: 384 } }
            : null),
        }],
      }

      const result = yield* Effect.either(service.restoreContainerStorage(malformed))
      expect(result._tag).toBe('Left')
      expect(bytes(yield* service.containerStorageSnapshot)).toBe(before)
    }),
  )

  it.effect('drains a broken chest once and preserves durable item state', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.createContainer('break-me')
      yield* service.add('iron_boots', 1)
      yield* service.damageAt({ _tag: 'Inventory', slotIndex: 0 }, 7)
      yield* service.transferContainerItem({
        direction: 'PlayerToContainer',
        containerId: 'break-me',
        playerSlot: 0,
        containerSlot: 0,
        count: 1,
      })

      expect(yield* service.drainContainer('break-me')).toStrictEqual({
        _tag: 'Drained',
        items: [{
          item: 'iron_boots', count: 1, durability: { current: 188, max: 195 },
        }],
      })
      expect(yield* service.drainContainer('break-me')).toStrictEqual({
        _tag: 'ContainerNotFound',
      })
      expect(yield* service.containerSnapshot('break-me')).toBeNull()
    }),
  )
})
