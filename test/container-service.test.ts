import { describe, expect, it } from '@effect/vitest'
import {
  BlockAddressSchema,
  BlockIdSchema,
  WorldIdSchema,
  WorldRevisionSchema,
  WorldWriteBatchSchema,
} from '@nerima-games/mc-kernel'
import { Effect, Layer, Result, Schema, Stream } from 'effect'
import {
  CONTAINER_STORAGE_REPLICATED_OWNER_ID,
  ContainerStorageService,
  ContainerStorageServiceLayer,
  ContainerStorageSnapshotSchema,
  containerStorageOwnerRegistration,
  makeContainerStorageService,
  playerStorageOwnerRegistration,
  PlayerStorageSnapshotSchema,
} from '../src/application/container-service.js'
import {
  DomainEventBus,
  type DomainEvent,
  type DomainEventBusApi,
} from '../src/application/domain-event-bus.js'
import { ReplicatedOwnerIdSchema } from '../src/application/replicated-state.js'
import {
  makeWorldCommitCoordinator,
  WorldCommitCoordinator,
  WorldCommitCoordinatorErrorSchema,
  WorldCommitChunkStoreUnavailable,
  WorldCommitCoordinatorLayer,
} from '../src/application/world-commit-coordinator.js'
import {
  createContainer,
  emptyContainerStorage,
  snapshotContainerStorage,
  worldContainerId,
  worldContainerIdAt,
} from '../src/domain/container-storage.js'
import { itemStack, type ItemStack } from '../src/domain/inventory.js'
import { emptyPlayerStorage, type PlayerStorage } from '../src/domain/player-storage.js'
import type { WorldCommitCoordinatorApi } from '../src/application/world-commit-coordinator.js'

const world = Schema.decodeUnknownSync(WorldIdSchema)('container-service-test')
const playerOwnerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('container-service-player')

const addressAt = (x: number, dimension: 'overworld' | 'nether' | 'end' = 'overworld') => Schema.decodeUnknownSync(BlockAddressSchema)({
  dimension,
  position: { x, y: 64, z: 8 },
})

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const stack = (item: Parameters<typeof itemStack>[0], count: number): ItemStack =>
  must(itemStack(item, count))

const playerWithStack = (item: Parameters<typeof itemStack>[0], count: number): PlayerStorage => {
  const slots: Array<ItemStack | undefined> = Array.from({ length: 36 }, () => undefined)
  slots[0] = stack(item, count)
  return { ...emptyPlayerStorage(), inventory: { slots } }
}

const eventRecorder = (
  published: Array<DomainEvent>,
): Layer.Layer<DomainEventBus> =>
  Layer.succeed(DomainEventBus, {
    publish: (event) => Effect.as(Effect.sync(() => published.push(event)), undefined),
    events: Stream.empty,
  } satisfies DomainEventBusApi)

const makeFixture = (playerStorage: PlayerStorage = emptyPlayerStorage()) =>
  Effect.gen(function* () {
    const coordinator = yield* makeWorldCommitCoordinator({
      world,
      owners: [
        containerStorageOwnerRegistration(),
        playerStorageOwnerRegistration(playerOwnerId, playerStorage),
      ],
    })
    const published: Array<DomainEvent> = []
    const services = Layer.mergeAll(
      Layer.succeed(WorldCommitCoordinator, coordinator),
      eventRecorder(published),
    )
    const service = yield* makeContainerStorageService().pipe(Effect.provide(services))
    return { coordinator, published, service }
  })

describe('ContainerStorageService', () => {
  it.effect('creates address-keyed containers and atomically commits typed storage operations', () =>
    Effect.flatMap(makeFixture(playerWithStack('stone', 5)), ({ coordinator, published, service }) =>
      Effect.gen(function* () {
        const firstAddress = addressAt(10)
        const secondAddress = addressAt(11)
        const createdFirst = yield* service.createContainerAt(firstAddress, 'chest')
        const createdSecond = yield* service.createContainerAt(secondAddress, 'hopper')

        expect(createdFirst._tag).toBe('Created')
        expect(createdSecond._tag).toBe('Created')
        expect(published).toEqual([])

        const exposedSnapshot = yield* service.snapshot
        const exposedContainers = exposedSnapshot.containers as Array<unknown>
        exposedContainers.pop()
        expect((yield* service.snapshot).containers).toHaveLength(2)

        const revisionBeforeTransfer = yield* coordinator.revision
        const transfer = yield* service.transferContainerItem({
          playerOwnerId,
          address: firstAddress,
          direction: 'PlayerToContainer',
          playerSlot: 0,
          containerSlot: 0,
          count: 4,
        })
        const revisionAfterTransfer = yield* coordinator.revision
        expect(transfer).toStrictEqual({
          _tag: 'Transferred',
          item: 'stone',
          count: 4,
          direction: 'PlayerToContainer',
        })
        expect(revisionAfterTransfer).toBe(revisionBeforeTransfer + 1)

        const containerSnapshot = yield* coordinator.snapshot(
          CONTAINER_STORAGE_REPLICATED_OWNER_ID,
          ContainerStorageSnapshotSchema,
        )
        const playerSnapshot = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
        expect(containerSnapshot.revision).toBe(revisionAfterTransfer)
        expect(playerSnapshot.revision).toBe(revisionAfterTransfer)
        expect(containerSnapshot.state.containers[0]?.slots[0]?.count).toBe(4)
        expect(playerSnapshot.state.inventory.slots[0]?.count).toBe(1)

        const moved = yield* service.moveContainerItem({
          sourceAddress: firstAddress,
          sourceSlot: 0,
          destinationAddress: secondAddress,
          destinationSlot: 1,
          count: 2,
        })
        expect(moved).toStrictEqual({ _tag: 'Moved', item: 'stone', count: 2 })

        const extracted = yield* service.extractContainerItem({
          address: secondAddress,
          containerSlot: 1,
          count: 1,
        })
        expect(extracted._tag).toBe('Extracted')
        if (extracted._tag === 'Extracted') expect(extracted.stack.count).toBe(1)
        expect(published).toEqual([])
      }),
    ),
  )

  it.effect('leaves every owner unchanged and publishes no event after a rejected multi-owner commit', () =>
    Effect.flatMap(makeFixture(playerWithStack('stone', 3)), ({ coordinator, published, service }) =>
      Effect.gen(function* () {
        const address = addressAt(20)
        const created = yield* service.createContainerAt(address)
        expect(created._tag).toBe('Created')

        const containerBefore = yield* coordinator.snapshot(
          CONTAINER_STORAGE_REPLICATED_OWNER_ID,
          ContainerStorageSnapshotSchema,
        )
        const playerBefore = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
        const rejected = yield* Effect.result(service.transferContainerItem({
          playerOwnerId,
          address,
          direction: 'PlayerToContainer',
          playerSlot: 0,
          containerSlot: 0,
          count: 2,
        }, {
          expectedRevision: Schema.decodeUnknownSync(WorldRevisionSchema)(0),
        }))

        expect(Result.isFailure(rejected)).toBe(true)
        if (Result.isFailure(rejected)) expect(rejected.failure._tag).toBe('WorldRevisionConflict')

        const containerAfter = yield* coordinator.snapshot(
          CONTAINER_STORAGE_REPLICATED_OWNER_ID,
          ContainerStorageSnapshotSchema,
        )
        const playerAfter = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
        expect(containerAfter).toStrictEqual(containerBefore)
        expect(playerAfter).toStrictEqual(playerBefore)
        expect(published).toEqual([])
      }),
    ),
  )

  it.effect('returns valid absence and typed domain failures without committing', () =>
    Effect.flatMap(makeFixture(), ({ coordinator, published, service }) =>
      Effect.gen(function* () {
        const address = addressAt(25)
        const missingAddress = addressAt(26)
        const created = yield* service.createContainerAt(address)
        expect(created._tag).toBe('Created')

        const existingId = worldContainerIdAt(address)
        const missingId = must(worldContainerId('container-service-missing'))
        expect(yield* service.containerSnapshot(existingId)).not.toBeNull()
        expect(yield* service.containerSnapshot(missingId)).toBeNull()
        expect(yield* service.containerSnapshotAt(missingAddress)).toBeNull()

        const revisionBefore = yield* coordinator.revision
        const duplicate = yield* service.createContainerAt(address)
        const transfer = yield* service.transferContainerItem({
          playerOwnerId,
          address,
          direction: 'PlayerToContainer',
          playerSlot: 0,
          containerSlot: 0,
          count: 1,
        })
        const extracted = yield* service.extractContainerItem({
          address,
          containerSlot: 0,
          count: 1,
        })
        const missingDestination = yield* service.moveContainerItem({
          sourceAddress: address,
          sourceSlot: 0,
          destinationAddress: missingAddress,
          destinationSlot: 0,
          count: 1,
        })
        const missingSource = yield* service.moveContainerItem({
          sourceAddress: addressAt(27),
          sourceSlot: 0,
          destinationAddress: address,
          destinationSlot: 0,
          count: 1,
        })

        expect(duplicate._tag).toBe('AlreadyExists')
        expect(transfer).toStrictEqual({ _tag: 'EmptySource' })
        expect(extracted).toStrictEqual({ _tag: 'EmptySource' })
        expect(missingDestination).toStrictEqual({ _tag: 'DestinationContainerNotFound' })
        expect(missingSource).toStrictEqual({ _tag: 'SourceContainerNotFound' })
        expect(yield* coordinator.revision).toBe(revisionBefore)
        expect(published).toEqual([])
      }),
    ),
  )

  it.effect('rejects transfer when owner snapshots carry different revisions', () =>
    Effect.flatMap(makeFixture(playerWithStack('stone', 2)), ({ coordinator, published, service }) =>
      Effect.gen(function* () {
        const address = addressAt(28)
        const created = yield* service.createContainerAt(address)
        expect(created._tag).toBe('Created')

        const revision = yield* coordinator.revision
        const staleRevision = Schema.decodeUnknownSync(WorldRevisionSchema)(revision - 1)
        const staleSnapshot: WorldCommitCoordinatorApi['snapshot'] = (ownerId, schema) =>
          Effect.map(coordinator.snapshot(ownerId, schema), (snapshot) =>
            ownerId === playerOwnerId ? { ...snapshot, revision: staleRevision } : snapshot,
          )
        const staleCoordinator: WorldCommitCoordinatorApi = {
          ...coordinator,
          snapshot: staleSnapshot,
        }
        const staleService = yield* makeContainerStorageService().pipe(
          Effect.provideService(WorldCommitCoordinator, staleCoordinator),
        )
        const containerBefore = yield* coordinator.snapshot(
          CONTAINER_STORAGE_REPLICATED_OWNER_ID,
          ContainerStorageSnapshotSchema,
        )
        const playerBefore = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
        const rejected = yield* Effect.result(staleService.transferContainerItem({
          playerOwnerId,
          address,
          direction: 'PlayerToContainer',
          playerSlot: 0,
          containerSlot: 0,
          count: 1,
        }))

        expect(Result.isFailure(rejected)).toBe(true)
        if (Result.isFailure(rejected)) {
          expect(rejected.failure._tag).toBe('WorldRevisionConflict')
          if (rejected.failure._tag === 'WorldRevisionConflict')
            expect(rejected.failure.actual).toBe(staleRevision)
        }
        expect(yield* coordinator.snapshot(
          CONTAINER_STORAGE_REPLICATED_OWNER_ID,
          ContainerStorageSnapshotSchema,
        )).toStrictEqual(containerBefore)
        expect(yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)).toStrictEqual(playerBefore)
        expect(published).toEqual([])
      }),
    ),
  )

  it.effect('exposes a service layer over registered C4 owners', () => {
    const address = addressAt(30)
    const worldId = worldContainerIdAt(address)
    const initialStorage = createContainer(emptyContainerStorage(), worldId).storage
    const dependencies = Layer.mergeAll(
      WorldCommitCoordinatorLayer({
        world,
        owners: [
          containerStorageOwnerRegistration(snapshotContainerStorage(initialStorage)),
          playerStorageOwnerRegistration(playerOwnerId),
        ],
      }),
    )
    return Effect.gen(function* () {
      const service = yield* ContainerStorageService
      expect(yield* service.containerSnapshotAt(address)).not.toBeNull()
    }).pipe(
      Effect.provide(ContainerStorageServiceLayer.pipe(Layer.provide(dependencies))),
    )
  })

  it.effect('includes a block-write dimension that has no container address in the commit expectations', () =>
    Effect.flatMap(makeFixture(playerWithStack('stone', 2)), ({ coordinator, service }) =>
      Effect.gen(function* () {
        const sourceAddress = addressAt(40, 'nether')
        const destinationAddress = addressAt(41, 'nether')
        expect(yield* service.createContainerAt(sourceAddress)).toMatchObject({ _tag: 'Created' })
        expect(yield* service.createContainerAt(destinationAddress)).toMatchObject({ _tag: 'Created' })
        expect(yield* service.transferContainerItem({
          playerOwnerId,
          address: sourceAddress,
          direction: 'PlayerToContainer',
          playerSlot: 0,
          containerSlot: 0,
          count: 2,
        })).toMatchObject({ _tag: 'Transferred' })
        const before = yield* coordinator.snapshot(CONTAINER_STORAGE_REPLICATED_OWNER_ID, ContainerStorageSnapshotSchema)
        const revision = yield* coordinator.revision
        const overworldRevision = yield* coordinator.dimensionRevision('overworld')
        const blockWrite = Schema.decodeUnknownSync(WorldWriteBatchSchema)({
          world,
          expectedWorldRevision: revision,
          dimension: 'overworld',
          expectedDimensionRevision: overworldRevision,
          edits: [{ position: { x: 42, y: 64, z: 8 }, block: Schema.decodeUnknownSync(BlockIdSchema)(23) }],
        })
        const rejected = yield* Effect.result(service.moveContainerItem({
          sourceAddress,
          sourceSlot: 0,
          destinationAddress,
          destinationSlot: 0,
          count: 1,
        }, { blockWrite }))
        const decoded = Schema.decodeUnknownSync(
          Schema.Result(Schema.Unknown, WorldCommitCoordinatorErrorSchema),
        )(rejected)

        expect(decoded).toEqual(rejected)
        expect(Result.isFailure(decoded)).toBe(true)
        if (Result.isFailure(decoded)) expect(decoded.failure).toBeInstanceOf(WorldCommitChunkStoreUnavailable)
        expect(yield* coordinator.snapshot(CONTAINER_STORAGE_REPLICATED_OWNER_ID, ContainerStorageSnapshotSchema))
          .toEqual(before)
      }),
    ),
  )
})
