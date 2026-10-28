import { describe, expect, it } from '@effect/vitest'
import {
  BlockAddressSchema,
  AIR_BLOCK_ID,
  BlockIdSchema,
  WorldIdSchema,
  WorldRevisionSchema,
  DimensionRevisionSchema,
  WorldWriteBatchSchema,
  chunkCoord,
  ChunkAxis,
  type Dimension,
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
  HopperCooldownPlanRequestSchema,
  HopperElapsedTicksSchema,
  HopperServiceErrorSchema,
  HopperServiceSnapshotSchema,
  HopperTransferOutcomeSchema,
  HopperTransferTickSnapshotSchema,
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

const playerWithStone = (count = 1): PlayerStorage => {
  const stack = itemStack('stone', count)
  if (Result.isFailure(stack)) throw stack.failure
  const slots: Array<typeof stack.success | undefined> = Array.from({ length: 36 }, () => undefined)
  slots[0] = stack.success
  return { ...emptyPlayerStorage(), inventory: { slots } }
}

const addressAt = (x: number, dimension: Dimension = 'overworld', y = 64, z = 8) => Schema.decodeUnknownSync(BlockAddressSchema)({
  dimension,
  position: { x, y, z },
})

const chunkSource: ChunkSource = (coord) => Effect.succeed({
  coord,
  blocks: new Uint16Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * CHUNK_HEIGHT),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
})

const makeFixture = (playerStorage: PlayerStorage = playerWithStone()) =>
  Effect.gen(function* () {
    const chunkStores = yield* ChunkStoreRegistry
    const overworld = chunkStores.forDimension('overworld')
    yield* overworld.load(chunkCoord(ChunkAxis(0), ChunkAxis(0)))
    const coordinator = yield* makeWorldCommitCoordinator({
      world,
      chunkStores,
      owners: [
        containerStorageOwnerRegistration(),
        playerStorageOwnerRegistration(playerOwnerId, playerStorage),
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
  it.effect('plans Java Edition cooldown cadence without committing and pauses while powered', () =>
    Effect.flatMap(makeFixture(playerWithStone(2)), ({ coordinator, containerService, hopperService }) =>
      Effect.gen(function* () {
        const cadenceFixture = {
          source: 'https://minecraft.wiki/w/Hopper',
          edition: 'Java Edition',
          version: '1.21.4',
          cooldownTicks: 8,
          unpoweredElapsedTicks: 7,
          poweredElapsedTicks: 20,
        } as const
        const sourceAddress = addressAt(8)
        const hopperAddress = addressAt(9)
        yield* containerService.createContainerAt(sourceAddress)
        yield* containerService.createContainerAt(hopperAddress, 'hopper')
        yield* containerService.transferContainerItem({
          playerOwnerId,
          address: sourceAddress,
          direction: 'PlayerToContainer',
          playerSlot: 0,
          containerSlot: 0,
          count: 2,
        })
        const revision = yield* coordinator.revision
        const dimensionRevision = yield* coordinator.dimensionRevision('overworld')
        const blockWrite = batchFor(revision, dimensionRevision, hopperAddress)
        expect(yield* hopperService.transfer({
          hopperAddress,
          source: { _tag: 'Container', address: sourceAddress, slot: 0 },
          destination: { _tag: 'Container', address: hopperAddress, slot: 0 },
          blockWrite,
        })).toMatchObject({ _tag: 'Committed', hopper: { cooldownTicks: cadenceFixture.cooldownTicks } })

        const hopperSnapshot = yield* coordinator.snapshot(HOPPER_REPLICATED_OWNER_ID, HopperServiceSnapshotSchema)
        const containerSnapshot = yield* coordinator.snapshot(CONTAINER_STORAGE_REPLICATED_OWNER_ID, ContainerStorageSnapshotSchema)
        const currentRevision = yield* coordinator.revision
        const currentDimensionRevision = yield* coordinator.dimensionRevision('overworld')
        const expectedDimensions = [{ dimension: 'overworld' as const, expectedRevision: currentDimensionRevision }]
        const intent = {
          hopperAddress,
          source: { _tag: 'Container' as const, address: sourceAddress, slot: 0 },
          destination: { _tag: 'Container' as const, address: hopperAddress, slot: 0 },
          blockEdits: { dimension: 'overworld' as const, edits: blockWrite.edits },
        }
        const planSnapshot = {
          world,
          expectedRevision: currentRevision,
          expectedDimensions,
          state: {
            hoppers: hopperSnapshot.state,
            containers: {
              world: containerSnapshot.world,
              expectedRevision: containerSnapshot.revision,
              expectedDimensions,
              state: containerSnapshot.state,
            },
            player: { _tag: 'None' as const },
            intent,
          },
        }

        const unpowered = yield* hopperService.planTransferTick(
          planSnapshot,
          Schema.decodeUnknownSync(HopperElapsedTicksSchema)(cadenceFixture.unpoweredElapsedTicks),
          false,
        )
        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(unpowered.result))
          .toStrictEqual({ _tag: 'CoolingDown', ticks: 1 })
        expect(unpowered.changes).toHaveLength(1)
        expect(unpowered.blockEdits).toBeUndefined()

        const powered = yield* hopperService.planTransferTick(
          planSnapshot,
          Schema.decodeUnknownSync(HopperElapsedTicksSchema)(cadenceFixture.poweredElapsedTicks),
          true,
        )
        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(powered.result)).toStrictEqual({ _tag: 'Disabled' })
        expect(powered.changes).toEqual([])

        const cooldownSnapshot = {
          world,
          expectedRevision: currentRevision,
          expectedDimensions,
          state: hopperSnapshot.state,
        }
        const cooldownRequest = Schema.decodeUnknownSync(HopperCooldownPlanRequestSchema)({
          address: hopperAddress,
          ticks: 1,
        })
        const unknownCooldown = yield* hopperService.planAdvanceCooldown({
          ...cooldownSnapshot,
          state: Schema.decodeUnknownSync(HopperServiceSnapshotSchema)({ hoppers: [] }),
        }, cooldownRequest)
        const noChangeCooldown = yield* hopperService.planAdvanceCooldown({
          ...cooldownSnapshot,
          state: Schema.decodeUnknownSync(HopperServiceSnapshotSchema)({
            hoppers: [{ address: hopperAddress, cooldownTicks: 0 }],
          }),
        }, cooldownRequest)
        const missingDimension = yield* Effect.result(hopperService.planAdvanceCooldown({
          ...cooldownSnapshot,
          expectedDimensions: [],
        }, cooldownRequest))
        expect(unknownCooldown.result).toEqual({ _tag: 'UnknownHopper' })
        expect(noChangeCooldown.result).toEqual({ _tag: 'NoChange' })
        expect(Result.isFailure(missingDimension)).toBe(true)
        if (Result.isFailure(missingDimension)) {
          expect(missingDimension.failure._tag).toBe('WorldCommitPlanDimensionRevisionMissing')
        }

        const zeroTicks = Schema.decodeUnknownSync(HopperElapsedTicksSchema)(0)
        const otherWorld = Schema.decodeUnknownSync(WorldIdSchema)('other-hopper-plan-world')
        const inconsistentSnapshots = [
          {
            ...planSnapshot,
            state: { ...planSnapshot.state, containers: { ...planSnapshot.state.containers, world: otherWorld } },
          },
          {
            ...planSnapshot,
            state: {
              ...planSnapshot.state,
              containers: {
                ...planSnapshot.state.containers,
                expectedRevision: Schema.decodeUnknownSync(WorldRevisionSchema)(currentRevision - 1),
              },
            },
          },
          {
            ...planSnapshot,
            state: { ...planSnapshot.state, containers: { ...planSnapshot.state.containers, expectedDimensions: [] } },
          },
          {
            ...planSnapshot,
            state: {
              ...planSnapshot.state,
              containers: {
                ...planSnapshot.state.containers,
                expectedDimensions: [{
                  dimension: 'overworld' as const,
                  expectedRevision: Schema.decodeUnknownSync(DimensionRevisionSchema)(currentDimensionRevision + 1),
                }],
              },
            },
          },
        ]
        const snapshotConflicts = []
        for (const inconsistent of inconsistentSnapshots) {
          snapshotConflicts.push(yield* Effect.result(hopperService.planTransferTick(inconsistent, zeroTicks, false)))
        }
        expect(snapshotConflicts.map((result) =>
          Result.isFailure(result) ? result.failure._tag : undefined,
        )).toEqual([
          'WorldCommitPlanWorldConflict',
          'WorldCommitPlanRevisionConflict',
          'WorldCommitPlanDimensionRevisionMissing',
          'WorldCommitPlanDimensionRevisionConflict',
        ])

        const playerIntent = {
          ...intent,
          source: { _tag: 'Player' as const, ownerId: playerOwnerId, slot: 0 },
          destination: { _tag: 'Container' as const, address: hopperAddress, slot: 0 },
        }
        const missingPlayerPlans = [
          { ...planSnapshot, state: { ...planSnapshot.state, hoppers: { hoppers: [] }, intent: playerIntent } },

          {
            ...planSnapshot,
            state: {
              ...planSnapshot.state,
              hoppers: { hoppers: [] },
              intent: { ...playerIntent, source: { _tag: 'Container' as const, address: sourceAddress, slot: 0 }, destination: { _tag: 'Player' as const, ownerId: playerOwnerId, slot: 0 } },

            },
          },
        ]
        const missingPlayerResults = []
        for (const missingPlayer of missingPlayerPlans) {
          missingPlayerResults.push(yield* hopperService.planTransferTick(missingPlayer, zeroTicks, false))
        }
        expect(missingPlayerResults.map(({ result }) => result)).toEqual([
          { _tag: 'InvalidRequest', reason: 'missing-player-snapshot' },
          { _tag: 'InvalidRequest', reason: 'missing-player-snapshot' },
        ])

        const otherPlayerOwner = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('other-hopper-player')
        const wrongPlayer = yield* hopperService.planTransferTick({
          ...planSnapshot,
          state: {
            ...planSnapshot.state,
            hoppers: { hoppers: [] },
            intent: playerIntent,
            player: {
              _tag: 'Some',
              ownerId: otherPlayerOwner,
              snapshot: {
                world,
                expectedRevision: currentRevision,
                expectedDimensions,
                state: emptyPlayerStorage(),
              },
            },
          },
        }, zeroTicks, false)
        expect(wrongPlayer.result).toEqual({ _tag: 'InvalidRequest', reason: 'missing-player-snapshot' })

        const invalidPlayerPair = yield* hopperService.planTransferTick({
          ...planSnapshot,
          state: {
            ...planSnapshot.state,
            intent: {
              ...intent,
              source: { _tag: 'Player', ownerId: playerOwnerId, slot: 0 },
              destination: { _tag: 'Player', ownerId: playerOwnerId, slot: 1 },
            },
          },
        }, zeroTicks, false)
        expect(invalidPlayerPair.result).toEqual({ _tag: 'InvalidRequest', reason: 'player-to-player' })

        const missingHopperBlockEdit = yield* hopperService.planTransferTick({
          ...planSnapshot,
          state: {
            ...planSnapshot.state,
            intent: {
              ...intent,
              blockEdits: {
                ...intent.blockEdits,
                edits: [{ position: sourceAddress.position, block: hopperBlock }],
              },
            },
          },
        }, zeroTicks, false)
        expect(missingHopperBlockEdit.result).toEqual({
          _tag: 'InvalidRequest',
          reason: 'missing-hopper-block-edit',
        })

        const emptySourceIntent = { ...intent, source: { ...intent.source, slot: 4 } }
        const rejectedWithoutCooldown = yield* hopperService.planTransferTick({
          ...planSnapshot,
          state: { ...planSnapshot.state, hoppers: { hoppers: [] }, intent: emptySourceIntent },
        }, zeroTicks, false)
        const rejectedWithCooldown = yield* hopperService.planTransferTick({
          ...planSnapshot,
          state: { ...planSnapshot.state, intent: emptySourceIntent },
        }, Schema.decodeUnknownSync(HopperElapsedTicksSchema)(cadenceFixture.cooldownTicks), false)
        expect(rejectedWithoutCooldown.result).toMatchObject({ _tag: 'TransferRejected' })
        expect(rejectedWithoutCooldown.changes).toEqual([])
        expect(rejectedWithCooldown.result).toMatchObject({ _tag: 'TransferRejected' })
        expect(rejectedWithCooldown.changes).toHaveLength(1)
        expect(rejectedWithCooldown.changes[0]?.state).toMatchObject({ hoppers: [{ cooldownTicks: 0 }] })

        const ready = yield* hopperService.planTransferTick(
          planSnapshot,
          Schema.decodeUnknownSync(HopperElapsedTicksSchema)(cadenceFixture.cooldownTicks),
          false,
        )
        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(ready.result)).toMatchObject({
          _tag: 'Committed',
          transfer: { _tag: 'Moved', count: 1 },
          hopper: { cooldownTicks: cadenceFixture.cooldownTicks },
        })
        expect(ready.changes.map(({ ownerId }) => ownerId)).toEqual([
          CONTAINER_STORAGE_REPLICATED_OWNER_ID,
          HOPPER_REPLICATED_OWNER_ID,
        ])
        expect(ready.blockEdits).toStrictEqual(intent.blockEdits)
        expect(yield* coordinator.revision).toBe(currentRevision)
      }),
    ),
  )

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

  it.effect('returns typed invalid requests for unsupported endpoints, mixed dimensions, and missing block edits', () =>
    Effect.flatMap(makeFixture(), ({ coordinator, hopperService }) =>
      Effect.gen(function* () {
        const hopperAddress = addressAt(20)
        const player = { _tag: 'Player' as const, ownerId: playerOwnerId, slot: 0 }
        const playerToPlayer = yield* hopperService.transfer({
          hopperAddress,
          source: player,
          destination: { ...player, slot: 1 },
          blockWrite: batchFor(0, 0, hopperAddress),
        })
        const dimensionMismatch = yield* hopperService.transfer({
          hopperAddress,
          source: { _tag: 'Container', address: addressAt(21, 'nether'), slot: 0 },
          destination: player,
          blockWrite: batchFor(0, 0, hopperAddress),
        })
        const missingHopperEdit = yield* hopperService.transfer({
          hopperAddress,
          source: player,
          destination: { _tag: 'Container', address: addressAt(22), slot: 0 },
          blockWrite: batchFor(0, 0, addressAt(23)),
        })

        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(playerToPlayer))
          .toEqual({ _tag: 'InvalidRequest', reason: 'player-to-player' })
        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(dimensionMismatch))
          .toEqual({ _tag: 'InvalidRequest', reason: 'dimension-mismatch' })
        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(missingHopperEdit))
          .toEqual({ _tag: 'InvalidRequest', reason: 'missing-hopper-block-edit' })
        expect(yield* coordinator.revision).toBe(0)
      }),
    ),
  )

  it.effect('transfers from a container to a player and advances an existing hopper cooldown', () =>
    Effect.flatMap(makeFixture(playerWithStone(2)), ({ coordinator, containerService, hopperService }) =>
      Effect.gen(function* () {
        const hopperAddress = addressAt(14)
        yield* containerService.createContainerAt(hopperAddress, 'hopper')
        yield* containerService.transferContainerItem({
          playerOwnerId,
          address: hopperAddress,
          direction: 'PlayerToContainer',
          playerSlot: 0,
          containerSlot: 0,
          count: 1,
        })
        const revisionBefore = yield* coordinator.revision
        const dimensionRevisionBefore = yield* coordinator.dimensionRevision('overworld')
        const firstTransfer = yield* hopperService.transfer({
          hopperAddress,
          source: { _tag: 'Container', address: hopperAddress, slot: 0 },
          destination: { _tag: 'Player', ownerId: playerOwnerId, slot: 0 },
          blockWrite: batchFor(revisionBefore, dimensionRevisionBefore, hopperAddress),
        })
        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(firstTransfer)).toMatchObject({
          _tag: 'Committed',
          transfer: { direction: 'ContainerToPlayer', item: 'stone', count: 1 },
        })
        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(yield* hopperService.transfer({
          hopperAddress,
          source: { _tag: 'Player', ownerId: playerOwnerId, slot: 0 },
          destination: { _tag: 'Container', address: hopperAddress, slot: 0 },
          blockWrite: batchFor(revisionBefore, dimensionRevisionBefore, hopperAddress),
        }))).toMatchObject({ _tag: 'CoolingDown', ticks: 8 })

        const revisionAfterTransfer = yield* coordinator.revision
        const dimensionRevisionAfterTransfer = yield* coordinator.dimensionRevision('overworld')
        const staleWorld = yield* Effect.result(hopperService.advanceCooldown({
          address: hopperAddress,
          ticks: 1,
          expectedRevision: revisionBefore,
          expectedDimensionRevision: dimensionRevisionAfterTransfer,
        }))
        const staleDimension = yield* Effect.result(hopperService.advanceCooldown({
          address: hopperAddress,
          ticks: 1,
          expectedRevision: revisionAfterTransfer,
          expectedDimensionRevision: dimensionRevisionBefore,
        }))
        expect(Schema.decodeUnknownSync(
          Schema.Result(HopperCooldownOutcomeSchema, HopperServiceErrorSchema),
        )(staleWorld)).toEqual(staleWorld)
        expect(Schema.decodeUnknownSync(
          Schema.Result(HopperCooldownOutcomeSchema, HopperServiceErrorSchema),
        )(staleDimension)).toEqual(staleDimension)
        expect(Result.isFailure(staleWorld)).toBe(true)
        if (Result.isFailure(staleWorld)) expect(staleWorld.failure).toBeInstanceOf(WorldRevisionConflict)
        expect(Result.isFailure(staleDimension)).toBe(true)
        if (Result.isFailure(staleDimension)) expect(staleDimension.failure._tag).toBe('DimensionRevisionConflict')

        const mismatchedAddresses = [
          addressAt(14, 'nether'),
          addressAt(15),
          addressAt(14, 'overworld', 65),
          addressAt(14, 'overworld', 64, 9),
        ]
        for (const address of mismatchedAddresses) {
          expect(Schema.decodeUnknownSync(HopperCooldownOutcomeSchema)(yield* hopperService.advanceCooldown({
            address,
            ticks: 1,
            expectedRevision: revisionAfterTransfer,
            expectedDimensionRevision: dimensionRevisionAfterTransfer,
          }))).toEqual({ _tag: 'UnknownHopper' })
        }

        const advancedOnce = yield* hopperService.advanceCooldown({
          address: hopperAddress,
          ticks: 1,
          expectedRevision: revisionAfterTransfer,
          expectedDimensionRevision: dimensionRevisionAfterTransfer,
        })
        expect(Schema.decodeUnknownSync(HopperCooldownOutcomeSchema)(advancedOnce))
          .toMatchObject({ _tag: 'Advanced', hopper: { cooldownTicks: 7 } })
        const revisionAfterOneTick = yield* coordinator.revision
        const dimensionRevisionAfterOneTick = yield* coordinator.dimensionRevision('overworld')
        const advancedToZero = yield* hopperService.advanceCooldown({
          address: hopperAddress,
          ticks: 7,
          expectedRevision: revisionAfterOneTick,
          expectedDimensionRevision: dimensionRevisionAfterOneTick,
        })
        expect(Schema.decodeUnknownSync(HopperCooldownOutcomeSchema)(advancedToZero))
          .toMatchObject({ _tag: 'Advanced', hopper: { cooldownTicks: 0 } })
        const revisionAtZero = yield* coordinator.revision
        const dimensionRevisionAtZero = yield* coordinator.dimensionRevision('overworld')
        expect(Schema.decodeUnknownSync(HopperCooldownOutcomeSchema)(yield* hopperService.advanceCooldown({
          address: hopperAddress,
          ticks: 1,
          expectedRevision: revisionAtZero,
          expectedDimensionRevision: dimensionRevisionAtZero,
        }))).toEqual({ _tag: 'NoChange' })

        const retransfer = yield* hopperService.transfer({
          hopperAddress,
          source: { _tag: 'Player', ownerId: playerOwnerId, slot: 0 },
          destination: { _tag: 'Container', address: hopperAddress, slot: 0 },
          blockWrite: batchFor(revisionAtZero, dimensionRevisionAtZero, hopperAddress),
        })
        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(retransfer)).toMatchObject({
          _tag: 'Committed',
          transfer: { direction: 'PlayerToContainer', item: 'stone', count: 1 },
          hopper: { cooldownTicks: 8 },
        })

        const secondHopperAddress = addressAt(15)
        yield* containerService.createContainerAt(secondHopperAddress, 'hopper')
        const revisionBeforeSecondTransfer = yield* coordinator.revision
        const dimensionRevisionBeforeSecondTransfer = yield* coordinator.dimensionRevision('overworld')
        const secondTransfer = yield* hopperService.transfer({
          hopperAddress: secondHopperAddress,
          source: { _tag: 'Player', ownerId: playerOwnerId, slot: 0 },
          destination: { _tag: 'Container', address: secondHopperAddress, slot: 0 },
          blockWrite: batchFor(revisionBeforeSecondTransfer, dimensionRevisionBeforeSecondTransfer, secondHopperAddress),
        })
        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(secondTransfer)).toMatchObject({
          _tag: 'Committed',
          transfer: { direction: 'PlayerToContainer', item: 'stone', count: 1 },
        })
        const revisionAfterSecondTransfer = yield* coordinator.revision
        const dimensionRevisionAfterSecondTransfer = yield* coordinator.dimensionRevision('overworld')
        expect(Schema.decodeUnknownSync(HopperCooldownOutcomeSchema)(yield* hopperService.advanceCooldown({
          address: secondHopperAddress,
          ticks: 8,
          expectedRevision: revisionAfterSecondTransfer,
          expectedDimensionRevision: dimensionRevisionAfterSecondTransfer,
        }))).toMatchObject({ _tag: 'Advanced', hopper: { cooldownTicks: 0 } })
        const revisionAfterSecondCooldown = yield* coordinator.revision
        const dimensionRevisionAfterSecondCooldown = yield* coordinator.dimensionRevision('overworld')
        const secondRetransfer = yield* hopperService.transfer({
          hopperAddress: secondHopperAddress,
          source: { _tag: 'Container', address: secondHopperAddress, slot: 0 },
          destination: { _tag: 'Player', ownerId: playerOwnerId, slot: 0 },
          blockWrite: batchFor(revisionAfterSecondCooldown, dimensionRevisionAfterSecondCooldown, secondHopperAddress),
        })
        expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(secondRetransfer)).toMatchObject({
          _tag: 'Committed',
          transfer: { direction: 'ContainerToPlayer', item: 'stone', count: 1 },
        })
      }),
    ),
  )

  it.effect('returns transfer rejections without starting a hopper cooldown', () =>
    Effect.gen(function* () {
      const fixture = yield* makeFixture()
      const emptyPlayerFixture = yield* makeFixture(emptyPlayerStorage())
      const sourceAddress = addressAt(26)
      const destinationAddress = addressAt(27)
      const hopperAddress = addressAt(28)
      yield* fixture.containerService.createContainerAt(sourceAddress)
      yield* fixture.containerService.createContainerAt(destinationAddress)
      const containerRejected = yield* fixture.hopperService.transfer({
        hopperAddress,
        source: { _tag: 'Container', address: sourceAddress, slot: 0 },
        destination: { _tag: 'Container', address: destinationAddress, slot: 0 },
        blockWrite: batchFor(2, 0, hopperAddress),
      })
      expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(containerRejected))
        .toMatchObject({ _tag: 'TransferRejected', transfer: { _tag: 'ContainerMove', outcome: { _tag: 'EmptySource' } } })
      expect((yield* fixture.coordinator.snapshot(HOPPER_REPLICATED_OWNER_ID, HopperServiceSnapshotSchema)).state.hoppers)
        .toEqual([])
      expect(yield* fixture.coordinator.revision).toBe(2)

      const playerDestination = addressAt(29)
      yield* emptyPlayerFixture.containerService.createContainerAt(playerDestination)
      const playerRejected = yield* emptyPlayerFixture.hopperService.transfer({
        hopperAddress: addressAt(30),
        source: { _tag: 'Player', ownerId: playerOwnerId, slot: 0 },
        destination: { _tag: 'Container', address: playerDestination, slot: 0 },
        blockWrite: batchFor(1, 0, addressAt(30)),
      })
      expect(Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(playerRejected))
        .toMatchObject({ _tag: 'TransferRejected', transfer: { _tag: 'PlayerTransfer', outcome: { _tag: 'EmptySource' } } })
      expect((yield* emptyPlayerFixture.coordinator.snapshot(HOPPER_REPLICATED_OWNER_ID, HopperServiceSnapshotSchema)).state.hoppers)
        .toEqual([])
      expect(yield* emptyPlayerFixture.coordinator.revision).toBe(1)
    }),
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

  it('validates branded hopper plan inputs and their bounds', () => {
    const planRequest = { address: addressAt(30), ticks: 1 }
    for (const field of ['address', 'ticks']) {
      const missing = Object.fromEntries(Object.entries(planRequest).filter(([key]) => key !== field))
      expect(() => Schema.decodeUnknownSync(HopperCooldownPlanRequestSchema)(missing)).toThrow()
      expect(() => Schema.decodeUnknownSync(HopperCooldownPlanRequestSchema)({ ...planRequest, [field]: null })).toThrow()
    }
    expect(Schema.decodeUnknownSync(HopperCooldownPlanRequestSchema)(planRequest).ticks).toBe(1)
    expect(() => Schema.decodeUnknownSync(HopperElapsedTicksSchema)(undefined)).toThrow()
    expect(() => Schema.decodeUnknownSync(HopperElapsedTicksSchema)(null)).toThrow()
    expect(() => Schema.decodeUnknownSync(HopperElapsedTicksSchema)(-1)).toThrow()
    expect(() => Schema.decodeUnknownSync(HopperElapsedTicksSchema)(Number.MAX_SAFE_INTEGER + 1)).toThrow()
    expect(() => Schema.decodeUnknownSync(HopperElapsedTicksSchema)(0.5)).toThrow()
    expect(Schema.decodeUnknownSync(HopperElapsedTicksSchema)(0)).toBe(0)
    expect(Schema.decodeUnknownSync(HopperElapsedTicksSchema)(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('rejects hopper transfer-tick snapshots with missing or null required fields', () => {
    const address = addressAt(31)
    const revision = Schema.decodeUnknownSync(WorldRevisionSchema)(0)
    const dimensionRevision = Schema.decodeUnknownSync(DimensionRevisionSchema)(0)
    const expectedDimensions = [{ dimension: address.dimension, expectedRevision: dimensionRevision }]
    const sample = {
      world,
      expectedRevision: revision,
      expectedDimensions,
      state: {
        hoppers: { hoppers: [] },
        containers: {
          world,
          expectedRevision: revision,
          expectedDimensions,
          state: containerStorageOwnerRegistration().initialState,
        },
        player: { _tag: 'None' },
        intent: {
          hopperAddress: address,
          source: { _tag: 'Container', address, slot: 0 },
          destination: { _tag: 'Container', address, slot: 1 },
          blockEdits: {
            dimension: address.dimension,
            edits: [{ position: address.position, block: hopperBlock }],
          },
        },
      },
    }
    const decode = Schema.decodeUnknownSync(HopperTransferTickSnapshotSchema)
    expect(decode(sample)).toEqual(sample)
    for (const field of ['world', 'expectedRevision', 'expectedDimensions', 'state']) {
      const withoutField = Object.fromEntries(Object.entries(sample).filter(([key]) => key !== field))
      expect(() => decode(withoutField)).toThrow()
      expect(() => decode({ ...sample, [field]: null })).toThrow()
    }
    for (const field of ['hoppers', 'containers', 'player', 'intent']) {
      const withoutField = Object.fromEntries(Object.entries(sample.state).filter(([key]) => key !== field))
      expect(() => decode({ ...sample, state: withoutField })).toThrow()
      expect(() => decode({ ...sample, state: { ...sample.state, [field]: null } })).toThrow()
    }
    for (const field of ['_tag']) {
      const withoutField = Object.fromEntries(Object.entries(sample.state.player).filter(([key]) => key !== field))
      expect(() => decode({ ...sample, state: { ...sample.state, player: withoutField } })).toThrow()
      expect(() => decode({ ...sample, state: { ...sample.state, player: { ...sample.state.player, [field]: null } } })).toThrow()
    }
    for (const field of ['hopperAddress', 'source', 'destination', 'blockEdits']) {
      const withoutField = Object.fromEntries(Object.entries(sample.state.intent).filter(([key]) => key !== field))
      expect(() => decode({ ...sample, state: { ...sample.state, intent: withoutField } })).toThrow()
      expect(() => decode({ ...sample, state: { ...sample.state, intent: { ...sample.state.intent, [field]: null } } })).toThrow()
    }
  })
})
