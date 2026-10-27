import { describe, expect, it } from '@effect/vitest'
import {
  BlockAddressSchema,
  AIR_BLOCK_ID,
  BlockIdSchema,
  WorldIdSchema,
  WorldWriteBatchSchema,
  chunkCoord,
  ChunkAxis,
} from '@nerima-games/mc-kernel'
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  ChunkCapacity,
  ChunkStoreRegistry,
  ChunkStoreRegistryLayer,
  type ChunkSource,
} from '@nerima-games/mc-worldgen'
import { Effect, Result, Schema } from 'effect'
import {
  ContainerStorageService,
  CONTAINER_STORAGE_REPLICATED_OWNER_ID,
  ContainerStorageSnapshotSchema,
  containerStorageOwnerRegistration,
  makeContainerStorageService,
  playerStorageOwnerRegistration,
  PlayerStorageSnapshotSchema,
} from '../src/application/container-service.js'
import {
  HOPPER_REPLICATED_OWNER_ID,
  HopperCooldownOutcomeSchema,
  HopperServiceErrorSchema,
  HopperServiceSnapshotSchema,
  HopperTransferOutcomeSchema,
  hopperOwnerRegistration,
  makeHopperService,
} from '../src/application/hopper-service.js'
import { ReplicatedOwnerIdSchema } from '../src/application/replicated-state.js'
import {
  makeWorldCommitCoordinator,
  WorldCommitCoordinator,
  WorldRevisionConflict,
} from '../src/application/world-commit-coordinator.js'
import { emptyPlayerStorage, type PlayerStorage } from '../src/domain/player-storage.js'
import { itemStack } from '../src/domain/inventory.js'
import { worldContainerIdAt } from '../src/domain/container-storage.js'

const world = Schema.decodeUnknownSync(WorldIdSchema)('hopper-service-test')
const playerOwnerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('hopper-service-player')
const hopperBlock = Schema.decodeUnknownSync(BlockIdSchema)(23)

const playerWithStone = (): PlayerStorage => {
  const stack = itemStack('stone', 1)
  if (Result.isFailure(stack)) throw stack.failure
  const slots: Array<typeof stack.success | undefined> = Array.from({ length: 36 }, () => undefined)
  slots[0] = stack.success
  return { ...emptyPlayerStorage(), inventory: { slots } }
}

const addressAt = (x: number) => Schema.decodeUnknownSync(BlockAddressSchema)({
  dimension: 'overworld',
  position: { x, y: 64, z: 8 },
})

const chunkSource: ChunkSource = (coord) => Effect.succeed({
  coord,
  blocks: new Uint16Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * CHUNK_HEIGHT),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
})

const makeFixture = () =>
  Effect.gen(function* () {
    const chunkStores = yield* ChunkStoreRegistry
    const overworld = chunkStores.forDimension('overworld')
    yield* overworld.load(chunkCoord(ChunkAxis(0), ChunkAxis(0)))
    const coordinator = yield* makeWorldCommitCoordinator({
      world,
      chunkStores,
      owners: [
        containerStorageOwnerRegistration(),
        playerStorageOwnerRegistration(playerOwnerId, playerWithStone()),
        hopperOwnerRegistration(),
      ],
    })
    const containerService = yield* makeContainerStorageService().pipe(
      Effect.provideService(WorldCommitCoordinator, coordinator),
    )
    const hopperService = yield* makeHopperService().pipe(
      Effect.provideService(WorldCommitCoordinator, coordinator),
      Effect.provideService(ContainerStorageService, containerService),
    )
    return { coordinator, overworld, containerService, hopperService }
  }).pipe(Effect.provide(ChunkStoreRegistryLayer(() => chunkSource, ChunkCapacity(4))))

const batchFor = (
  expectedWorldRevision: number,
  expectedDimensionRevision: number,
  address: ReturnType<typeof addressAt>,
) => Schema.decodeUnknownSync(WorldWriteBatchSchema)({
  world,
  expectedWorldRevision,
  dimension: address.dimension,
  expectedDimensionRevision,
  edits: [{ position: address.position, block: hopperBlock }],
})

describe('HopperService', () => {
  it.effect('commits hopper block, cooldown, source and destination containers at one revision', () =>
    Effect.flatMap(makeFixture(), ({ coordinator, overworld, containerService, hopperService }) =>
      Effect.gen(function* () {
        const sourceAddress = addressAt(10)
        const hopperAddress = addressAt(11)
        yield* containerService.createContainerAt(sourceAddress)
        yield* containerService.createContainerAt(hopperAddress, 'hopper')
        yield* containerService.transferContainerItem({
          playerOwnerId,
          address: sourceAddress,
          direction: 'PlayerToContainer',
          playerSlot: 0,
          containerSlot: 0,
          count: 1,
        })
        const before = yield* coordinator.revision
        const dimensionBefore = yield* coordinator.dimensionRevision('overworld')
        const batch = batchFor(before, dimensionBefore, hopperAddress)

        const outcome = yield* hopperService.transfer({
          hopperAddress,
          source: { _tag: 'Container', address: sourceAddress, slot: 0 },
          destination: { _tag: 'Container', address: hopperAddress, slot: 0 },
          blockWrite: batch,
        })

        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(outcome)).toEqual(outcome)
        expect(outcome).toMatchObject({
          _tag: 'Committed',
          transfer: { _tag: 'Moved', item: 'stone', count: 1 },
          hopper: { address: hopperAddress, cooldownTicks: 8 },
        })
        expect(yield* coordinator.revision).toBe(before + 1)
        expect(yield* coordinator.dimensionRevision('overworld')).toBe(dimensionBefore + 1)
        const storage = yield* coordinator.snapshot(CONTAINER_STORAGE_REPLICATED_OWNER_ID, ContainerStorageSnapshotSchema)
        expect(storage.state.containers.find(({ id }) => id === worldContainerIdAt(hopperAddress))?.slots[0]?.count).toBe(1)
        expect(storage.state.containers.find(({ id }) => id === worldContainerIdAt(sourceAddress))?.slots[0]).toBeNull()
        expect((yield* coordinator.snapshot(HOPPER_REPLICATED_OWNER_ID, HopperServiceSnapshotSchema)).state.hoppers)
          .toEqual([{ address: hopperAddress, cooldownTicks: 8 }])
        expect((yield* overworld.getBlock(hopperAddress.position))).toEqual({ _tag: 'Block', block: hopperBlock })
        expect((yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)).state).toEqual(emptyPlayerStorage())
      }),
    ),
  )

  it.effect('commits a player inventory endpoint with the container and hopper block edit', () =>
    Effect.flatMap(makeFixture(), ({ coordinator, overworld, containerService, hopperService }) =>
      Effect.gen(function* () {
        const hopperAddress = addressAt(12)
        const destinationAddress = addressAt(13)
        yield* containerService.createContainerAt(destinationAddress)
        const before = yield* coordinator.revision
        const dimensionBefore = yield* coordinator.dimensionRevision('overworld')

        const outcome = yield* hopperService.transfer({
          hopperAddress,
          source: { _tag: 'Player', ownerId: playerOwnerId, slot: 0 },
          destination: { _tag: 'Container', address: destinationAddress, slot: 0 },
          blockWrite: batchFor(before, dimensionBefore, hopperAddress),
        })

        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(outcome)).toEqual(outcome)
        expect(outcome).toMatchObject({
          _tag: 'Committed',
          transfer: { _tag: 'Transferred', item: 'stone', count: 1, direction: 'PlayerToContainer' },
          hopper: { address: hopperAddress, cooldownTicks: 8 },
        })
        expect(yield* coordinator.revision).toBe(before + 1)
        expect(yield* coordinator.dimensionRevision('overworld')).toBe(dimensionBefore + 1)
        expect((yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)).state)
          .toEqual(emptyPlayerStorage())
        const storage = yield* coordinator.snapshot(CONTAINER_STORAGE_REPLICATED_OWNER_ID, ContainerStorageSnapshotSchema)
        expect(storage.state.containers.find(({ id }) => id === worldContainerIdAt(destinationAddress))?.slots[0])
          .toMatchObject({ item: 'stone', count: 1 })
        expect((yield* coordinator.snapshot(HOPPER_REPLICATED_OWNER_ID, HopperServiceSnapshotSchema)).state.hoppers)
          .toEqual([{ address: hopperAddress, cooldownTicks: 8 }])
        expect(yield* overworld.getBlock(hopperAddress.position)).toEqual({ _tag: 'Block', block: hopperBlock })
      }),
    ),
  )

  it.effect('leaves every owner and the chunk unchanged when the shared commit is stale', () =>
    Effect.flatMap(makeFixture(), ({ coordinator, overworld, containerService, hopperService }) =>
      Effect.gen(function* () {
        const sourceAddress = addressAt(9)
        const hopperAddress = addressAt(10)
        yield* containerService.createContainerAt(sourceAddress)
        yield* containerService.createContainerAt(hopperAddress, 'hopper')
        yield* containerService.transferContainerItem({
          playerOwnerId,
          address: sourceAddress,
          direction: 'PlayerToContainer',
          playerSlot: 0,
          containerSlot: 0,
          count: 1,
        })
        const revisionBefore = yield* coordinator.revision
        const dimensionBefore = yield* coordinator.dimensionRevision('overworld')
        const containerBefore = yield* coordinator.snapshot(CONTAINER_STORAGE_REPLICATED_OWNER_ID, ContainerStorageSnapshotSchema)
        const playerBefore = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
        const hopperBefore = yield* coordinator.snapshot(HOPPER_REPLICATED_OWNER_ID, HopperServiceSnapshotSchema)
        const batch = batchFor(revisionBefore - 1, dimensionBefore, hopperAddress)

        const rejected = yield* Effect.result(hopperService.transfer({
          hopperAddress,
          source: { _tag: 'Container', address: sourceAddress, slot: 0 },
          destination: { _tag: 'Container', address: hopperAddress, slot: 0 },
          blockWrite: batch,
        }))

        expect(Schema.decodeUnknownSync(
          Schema.Result(HopperTransferOutcomeSchema, HopperServiceErrorSchema),
        )(rejected)).toEqual(rejected)
        expect(Result.isFailure(rejected)).toBe(true)
        if (Result.isFailure(rejected)) expect(rejected.failure).toBeInstanceOf(WorldRevisionConflict)
        expect(yield* coordinator.revision).toBe(revisionBefore)
        expect(yield* coordinator.dimensionRevision('overworld')).toBe(dimensionBefore)
        expect(yield* coordinator.snapshot(CONTAINER_STORAGE_REPLICATED_OWNER_ID, ContainerStorageSnapshotSchema))
          .toEqual(containerBefore)
        expect(yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)).toEqual(playerBefore)
        expect(yield* coordinator.snapshot(HOPPER_REPLICATED_OWNER_ID, HopperServiceSnapshotSchema)).toEqual(hopperBefore)
        expect((yield* overworld.getBlock(hopperAddress.position))).toEqual({ _tag: 'Block', block: AIR_BLOCK_ID })
      }),
    ),
  )

  it('rejects hopper outcomes with missing or null required fields', () => {
    const decodeTransfer = Schema.decodeUnknownSync(HopperTransferOutcomeSchema)
    const decodeCooldown = Schema.decodeUnknownSync(HopperCooldownOutcomeSchema)
    const assertRequiredFields = (
      decode: (value: unknown) => unknown,
      sample: Record<string, unknown>,
      fields: ReadonlyArray<string>,
    ) => {
      for (const field of fields) {
        const withoutField = Object.fromEntries(Object.entries(sample).filter(([key]) => key !== field))
        expect(() => decode(withoutField)).toThrow()
        expect(() => decode({ ...sample, [field]: null })).toThrow()
      }
    }
    const hopper = { address: addressAt(30), cooldownTicks: 8 }
    const moved = { _tag: 'Moved', item: 'stone', count: 1 }
    const transferred = {
      _tag: 'Transferred',
      item: 'stone',
      count: 1,
      direction: 'PlayerToContainer',
    }
    const committed = { _tag: 'Committed', transfer: moved, hopper }
    assertRequiredFields(decodeTransfer, committed, ['_tag', 'transfer', 'hopper'])
    for (const field of ['_tag', 'item', 'count']) {
      const withoutField = Object.fromEntries(Object.entries(moved).filter(([key]) => key !== field))
      expect(() => decodeTransfer({ ...committed, transfer: withoutField })).toThrow()
      expect(() => decodeTransfer({ ...committed, transfer: { ...moved, [field]: null } })).toThrow()
    }
    for (const field of ['_tag', 'item', 'count', 'direction']) {
      const withoutField = Object.fromEntries(Object.entries(transferred).filter(([key]) => key !== field))
      expect(() => decodeTransfer({ ...committed, transfer: withoutField })).toThrow()
      expect(() => decodeTransfer({ ...committed, transfer: { ...transferred, [field]: null } })).toThrow()
    }
    for (const field of ['address', 'cooldownTicks']) {
      const withoutField = Object.fromEntries(Object.entries(hopper).filter(([key]) => key !== field))
      expect(() => decodeTransfer({ ...committed, hopper: withoutField })).toThrow()
      expect(() => decodeTransfer({ ...committed, hopper: { ...hopper, [field]: null } })).toThrow()
    }
    const hopperAddress = hopper.address
    const position = hopperAddress.position
    for (const field of ['dimension', 'position']) {
      const withoutField = Object.fromEntries(Object.entries(hopperAddress).filter(([key]) => key !== field))
      expect(() => decodeTransfer({ ...committed, hopper: { ...hopper, address: withoutField } })).toThrow()
      expect(() => decodeTransfer({
        ...committed,
        hopper: { ...hopper, address: { ...hopperAddress, [field]: null } },
      })).toThrow()
    }
    for (const field of ['x', 'y', 'z']) {
      const withoutField = Object.fromEntries(Object.entries(position).filter(([key]) => key !== field))
      expect(() => decodeTransfer({
        ...committed,
        hopper: { ...hopper, address: { ...hopperAddress, position: withoutField } },
      })).toThrow()
      expect(() => decodeTransfer({
        ...committed,
        hopper: { ...hopper, address: { ...hopperAddress, position: { ...position, [field]: null } } },
      })).toThrow()
    }
    expect(() => decodeTransfer({
      ...committed,
      transfer: { ...moved, count: 0 },
    })).toThrow()
    expect(() => decodeTransfer({
      ...committed,
      transfer: { ...moved, count: Number.MAX_SAFE_INTEGER + 1 },
    })).toThrow()
    expect(() => decodeTransfer({
      ...committed,
      hopper: { ...hopper, cooldownTicks: Number.MAX_SAFE_INTEGER + 1 },
    })).toThrow()

    const coolingDown = { _tag: 'CoolingDown', ticks: 2 }
    const invalidRequest = { _tag: 'InvalidRequest', reason: 'player-to-player' }
    const rejectedContainer = {
      _tag: 'TransferRejected',
      transfer: { _tag: 'ContainerMove', outcome: { _tag: 'InsufficientSource', available: 1 } },
    }
    const rejectedPlayer = {
      _tag: 'TransferRejected',
      transfer: { _tag: 'PlayerTransfer', outcome: { ...transferred } },
    }
    assertRequiredFields(decodeTransfer, coolingDown, ['_tag', 'ticks'])
    expect(() => decodeTransfer({ ...coolingDown, ticks: 0 })).toThrow()
    expect(() => decodeTransfer({ ...coolingDown, ticks: Number.MAX_SAFE_INTEGER + 1 })).toThrow()
    assertRequiredFields(decodeTransfer, invalidRequest, ['_tag', 'reason'])
    assertRequiredFields(decodeTransfer, rejectedContainer, ['_tag', 'transfer'])
    for (const field of ['_tag', 'outcome']) {
      const withoutField = Object.fromEntries(Object.entries(rejectedContainer.transfer).filter(([key]) => key !== field))
      expect(() => decodeTransfer({ ...rejectedContainer, transfer: withoutField })).toThrow()
      expect(() => decodeTransfer({ ...rejectedContainer, transfer: { ...rejectedContainer.transfer, [field]: null } })).toThrow()
    }
    for (const field of ['_tag', 'available']) {
      const withoutField = Object.fromEntries(Object.entries(rejectedContainer.transfer.outcome).filter(([key]) => key !== field))
      expect(() => decodeTransfer({
        ...rejectedContainer,
        transfer: { ...rejectedContainer.transfer, outcome: withoutField },
      })).toThrow()
      expect(() => decodeTransfer({
        ...rejectedContainer,
        transfer: { ...rejectedContainer.transfer, outcome: { ...rejectedContainer.transfer.outcome, [field]: null } },
      })).toThrow()
    }
    for (const field of ['_tag', 'outcome']) {
      const withoutField = Object.fromEntries(Object.entries(rejectedPlayer.transfer).filter(([key]) => key !== field))
      expect(() => decodeTransfer({ ...rejectedPlayer, transfer: withoutField })).toThrow()
      expect(() => decodeTransfer({ ...rejectedPlayer, transfer: { ...rejectedPlayer.transfer, [field]: null } })).toThrow()
    }
    for (const field of ['_tag', 'item', 'count', 'direction']) {
      const withoutField = Object.fromEntries(Object.entries(rejectedPlayer.transfer.outcome).filter(([key]) => key !== field))
      expect(() => decodeTransfer({
        ...rejectedPlayer,
        transfer: { ...rejectedPlayer.transfer, outcome: withoutField },
      })).toThrow()
      expect(() => decodeTransfer({
        ...rejectedPlayer,
        transfer: { ...rejectedPlayer.transfer, outcome: { ...rejectedPlayer.transfer.outcome, [field]: null } },
      })).toThrow()
    }
    assertRequiredFields(decodeCooldown, { _tag: 'Advanced', hopper }, ['_tag', 'hopper'])
    for (const tag of ['NoChange', 'UnknownHopper']) {
      assertRequiredFields(decodeCooldown, { _tag: tag }, ['_tag'])
    }
    expect(decodeTransfer(committed)).toMatchObject({ _tag: 'Committed' })
    expect(decodeTransfer(rejectedContainer)).toMatchObject({ _tag: 'TransferRejected' })
    expect(decodeTransfer(rejectedPlayer)).toMatchObject({ _tag: 'TransferRejected' })
    expect(decodeCooldown({ _tag: 'NoChange' })).toEqual({ _tag: 'NoChange' })
    expect(decodeCooldown({ _tag: 'UnknownHopper' })).toEqual({ _tag: 'UnknownHopper' })
  })
})
