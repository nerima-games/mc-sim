import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeInventoryService } from '../src/application/inventory-service'
import {
  CHEST_CONTAINER_CAPACITY,
  containerIdAt,
  createContainer,
  emptyContainerStorage,
  findContainer,
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
    expect(validateContainerStorageSnapshot({ ...snapshot, version: 2 })._tag).toBe('Invalid')
    expect(validateContainerStorageSnapshot({
      ...snapshot,
      containers: [...snapshot.containers, snapshot.containers[0]],
    })._tag).toBe('Invalid')
    expect(validateContainerStorageSnapshot({
      ...snapshot,
      containers: [{ id: 'chest-a', slots: [] }],
    })._tag).toBe('Invalid')
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
})

describe('InventoryService chest integration', () => {
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
