import { describe, expect, it } from '@effect/vitest'
import * as fc from 'fast-check'
import {
  BlockAddressSchema,
  BlockIdSchema,
  WorldIdSchema,
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
  CONTAINER_STORAGE_REPLICATED_OWNER_ID,
  ContainerStorageService,
  ContainerStorageSnapshotSchema,
  containerStorageOwnerRegistration,
  makeContainerStorageService,
  playerStorageOwnerRegistration,
} from '../src/application/container-service.js'
import {
  HOPPER_REPLICATED_OWNER_ID,
  HopperElapsedTicksSchema,
  HopperServiceSnapshotSchema,
  HopperTransferOutcomeSchema,
  HopperTransferTickSnapshotSchema,
  hopperOwnerRegistration,
  makeHopperService,
} from '../src/application/hopper-service.js'
import { ReplicatedOwnerIdSchema } from '../src/application/replicated-state.js'
import { makeWorldCommitCoordinator, WorldCommitCoordinator } from '../src/application/world-commit-coordinator.js'
import { emptyPlayerStorage, type PlayerStorage } from '../src/domain/player-storage.js'
import { itemStack } from '../src/domain/inventory.js'

const world = Schema.decodeUnknownSync(WorldIdSchema)('hopper-cooldown-property-test')
const playerOwnerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('hopper-cooldown-property-player')
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
    return { coordinator, containerService, hopperService }
  }).pipe(Effect.provide(ChunkStoreRegistryLayer(() => chunkSource, ChunkCapacity(4))))

describe('Hopper cooldown properties', () => {
  it.effect('advances powered cooldowns and transfers only when unpowered at zero', () =>
    Effect.flatMap(makeFixture(), ({ coordinator, containerService, hopperService }) =>
      Effect.gen(function* () {
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
          count: 1,
        })

        const containerSnapshot = yield* coordinator.snapshot(
          CONTAINER_STORAGE_REPLICATED_OWNER_ID,
          ContainerStorageSnapshotSchema,
        )
        const expectedRevision = yield* coordinator.revision
        const dimensionRevision = yield* coordinator.dimensionRevision('overworld')
        const expectedDimensions = [{ dimension: 'overworld' as const, expectedRevision: dimensionRevision }]
        const blockEdits = {
          dimension: hopperAddress.dimension,
          edits: [{ position: hopperAddress.position, block: hopperBlock }],
        }
        const baseSnapshot = {
          world,
          expectedRevision,
          expectedDimensions,
          state: {
            hoppers: Schema.decodeUnknownSync(HopperServiceSnapshotSchema)({ hoppers: [] }),
            containers: {
              world: containerSnapshot.world,
              expectedRevision: containerSnapshot.revision,
              expectedDimensions,
              state: containerSnapshot.state,
            },
            player: { _tag: 'None' as const },
            intent: {
              hopperAddress,
              source: { _tag: 'Container' as const, address: sourceAddress, slot: 0 },
              destination: { _tag: 'Container' as const, address: hopperAddress, slot: 0 },
              blockEdits,
            },
          },
        }
        const elapsedTicks = Schema.decodeUnknownSync(HopperElapsedTicksSchema)(1)
        const planTick = (cooldownTicks: number, sourceSlot: number, powered: boolean) => {
          const snapshot = Schema.decodeUnknownSync(HopperTransferTickSnapshotSchema)({
            ...baseSnapshot,
            state: {
              ...baseSnapshot.state,
              hoppers: Schema.decodeUnknownSync(HopperServiceSnapshotSchema)({
                hoppers: [{ address: hopperAddress, cooldownTicks }],
              }),
              intent: {
                ...baseSnapshot.state.intent,
                source: { _tag: 'Container' as const, address: sourceAddress, slot: sourceSlot },
              },
            },
          })
          const fragment = Effect.runSync(hopperService.planTransferTick(snapshot, elapsedTicks, powered))
          return {
            fragment,
            outcome: Schema.decodeUnknownSync(HopperTransferOutcomeSchema)(fragment.result),
          }
        }
        const expectCooldownChange = (
          fragment: { readonly changes: ReadonlyArray<{ readonly ownerId: unknown; readonly state: unknown }> },
          previousCooldown: number,
          nextCooldown: number,
        ) => {
          expect(fragment.changes.map(({ ownerId }) => ownerId))
            .toEqual(previousCooldown === nextCooldown ? [] : [HOPPER_REPLICATED_OWNER_ID])
          expect(fragment.changes.length).toBeLessThanOrEqual(1)
          if (previousCooldown !== nextCooldown) {
            const changedState = Schema.decodeUnknownSync(HopperServiceSnapshotSchema)(fragment.changes[0]?.state)
            expect(changedState.hoppers).toMatchObject([{ address: hopperAddress, cooldownTicks: nextCooldown }])
          }
        }

        expect(() => Schema.decodeUnknownSync(HopperServiceSnapshotSchema)({
          hoppers: [{ address: hopperAddress, cooldownTicks: -1 }],
        })).toThrow()

        for (const cooldownTicks of [0, 1, 2, 7, 8, 9]) {
          const { fragment, outcome } = planTick(cooldownTicks, 4, true)
          const nextCooldown = Math.max(0, cooldownTicks - elapsedTicks)
          expect(outcome).toStrictEqual({ _tag: 'Disabled' })
          expectCooldownChange(fragment, cooldownTicks, nextCooldown)
          expect(fragment.blockEdits).toBeUndefined()
        }

        const propertyRuns = 100
        let cooldownProgressionTrials = 0
        fc.assert(fc.property(
          fc.integer({ min: 0, max: 32 }),
          fc.array(fc.boolean(), { minLength: 1, maxLength: 24 }),
          (initialCooldown, poweredSequence) => {
            cooldownProgressionTrials += 1
            let cooldown = initialCooldown
            for (const powered of poweredSequence) {
              const nextCooldown = Math.max(0, cooldown - 1)
              const { fragment, outcome } = planTick(cooldown, 4, powered)
              if (powered) {
                expect(outcome).toStrictEqual({ _tag: 'Disabled' })
              } else if (nextCooldown > 0) {
                expect(outcome).toStrictEqual({ _tag: 'CoolingDown', ticks: nextCooldown })
              } else {
                expect(outcome._tag).toBe('TransferRejected')
              }
              expect(outcome._tag).not.toBe('Committed')
              expectCooldownChange(fragment, cooldown, nextCooldown)
              expect(fragment.blockEdits).toBeUndefined()
              cooldown = nextCooldown
            }
            expect(cooldown).toBe(Math.max(0, initialCooldown - poweredSequence.length))
          },
        ), { numRuns: propertyRuns })
        expect(cooldownProgressionTrials).toBe(propertyRuns)

        let transferEligibilityTrials = 0
        fc.assert(fc.property(
          fc.integer({ min: 0, max: 16 }),
          fc.array(fc.boolean(), { minLength: 1, maxLength: 16 }),
          (initialCooldown, poweredSequence) => {
            transferEligibilityTrials += 1
            let cooldown = initialCooldown
            let transferred = false
            for (const powered of poweredSequence) {
              const nextCooldown = Math.max(0, cooldown - 1)
              const { fragment, outcome } = planTick(cooldown, 0, powered)
              const eligible = !powered && nextCooldown === 0
              expect(outcome._tag === 'Committed').toBe(eligible)
              if (eligible) {
                if (outcome._tag !== 'Committed') throw new Error('eligible hopper did not transfer')
                expect(outcome.hopper.cooldownTicks).toBe(8)
                expect(fragment.changes.map(({ ownerId }) => ownerId)).toEqual([
                  CONTAINER_STORAGE_REPLICATED_OWNER_ID,
                  HOPPER_REPLICATED_OWNER_ID,
                ])
                expect(fragment.blockEdits).toStrictEqual(blockEdits)
                transferred = true
                break
              }

              if (powered) {
                expect(outcome).toStrictEqual({ _tag: 'Disabled' })
              } else {
                expect(outcome).toStrictEqual({ _tag: 'CoolingDown', ticks: nextCooldown })
              }
              expectCooldownChange(fragment, cooldown, nextCooldown)
              expect(fragment.blockEdits).toBeUndefined()
              cooldown = nextCooldown
            }
            expect(transferred).toBe(poweredSequence.some(
              (powered, index) => !powered && initialCooldown <= index + 1,
            ))
          },
        ), { numRuns: propertyRuns })
        expect(transferEligibilityTrials).toBe(propertyRuns)
      }),
    ),
  )
})
