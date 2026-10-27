import { describe, expect, it } from '@effect/vitest'
import {
  AIR_BLOCK_ID,
  BlockIdSchema,
  BlockPositionSchema,
  WorldWriteChunkUnavailable,
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
  BucketUseOutcomeSchema,
  BucketServiceErrorSchema,
  makeBucketService,
} from '../src/application/bucket-service.js'
import {
  playerStorageOwnerRegistration,
  PlayerStorageSnapshotSchema,
} from '../src/application/container-service.js'
import { ReplicatedOwnerIdSchema } from '../src/application/replicated-state.js'
import { makeWorldCommitCoordinator, WorldCommitCoordinator } from '../src/application/world-commit-coordinator.js'
import { itemStack } from '../src/domain/inventory.js'
import { emptyPlayerStorage, type PlayerStorage } from '../src/domain/player-storage.js'

const world = Schema.decodeUnknownSync(WorldIdSchema)('bucket-service-test')
const playerOwnerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('bucket-service-player')
const waterBlock = Schema.decodeUnknownSync(BlockIdSchema)(29)
const position = Schema.decodeUnknownSync(BlockPositionSchema)({ x: 2, y: 64, z: 3 })

const storageWith = (item: 'bucket' | 'water_bucket'): PlayerStorage => {
  const stack = itemStack(item, 1)
  if (Result.isFailure(stack)) throw stack.failure
  const empty = emptyPlayerStorage()
  const slots = [...empty.inventory.slots]
  slots[0] = stack.success
  return { ...empty, inventory: { slots } }
}

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
      owners: [playerStorageOwnerRegistration(playerOwnerId, storageWith('water_bucket'))],
    })
    const api = yield* makeBucketService().pipe(Effect.provideService(WorldCommitCoordinator, coordinator))
    return { coordinator, overworld, api }
  }).pipe(Effect.provide(ChunkStoreRegistryLayer(() => chunkSource, ChunkCapacity(4))))

const writeBatch = (
  expectedWorldRevision: number,
  expectedDimensionRevision: number,
  x: number = position.x,
  additionalX?: number,
) =>
  Schema.decodeUnknownSync(WorldWriteBatchSchema)({
    world,
    expectedWorldRevision,
    dimension: 'overworld',
    expectedDimensionRevision,
    edits: [
      { position: { x, y: position.y, z: position.z }, block: waterBlock },
      ...(additionalX === undefined
        ? []
        : [{ position: { x: additionalX, y: position.y, z: position.z }, block: waterBlock }]),
    ],
  })

describe('BucketService', () => {
  it.effect('commits the bucket inventory candidate and all fluid-cell edits together', () =>
    Effect.flatMap(makeFixture(), ({ coordinator, overworld, api }) =>
      Effect.gen(function* () {
        const revisionBefore = yield* coordinator.revision
        const dimensionBefore = yield* coordinator.dimensionRevision('overworld')
        const committed = yield* Effect.result(api.commitUse({
          playerOwnerId,
          playerStorage: storageWith('bucket'),
          blockWrite: writeBatch(revisionBefore, dimensionBefore),
        }))
        const outcome = Schema.decodeUnknownSync(
          Schema.Result(BucketUseOutcomeSchema, BucketServiceErrorSchema),
        )(committed)

        expect(Result.isSuccess(outcome)).toBe(true)
        if (Result.isSuccess(outcome)) expect(outcome.success).toEqual({ _tag: 'Committed', revision: revisionBefore + 1 })
        expect(yield* coordinator.revision).toBe(revisionBefore + 1)
        expect(yield* coordinator.dimensionRevision('overworld')).toBe(dimensionBefore + 1)
        const player = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
        expect(player.state.inventory.slots[0]?.item).toBe('bucket')
        expect(yield* overworld.getBlock(position)).toEqual({ _tag: 'Block', block: waterBlock })
      }),
    ),
  )

  it.effect('leaves the player owner unchanged when an affected fluid chunk is unavailable', () =>
    Effect.flatMap(makeFixture(), ({ coordinator, overworld, api }) =>
      Effect.gen(function* () {
        const revisionBefore = yield* coordinator.revision
        const dimensionBefore = yield* coordinator.dimensionRevision('overworld')
        const playerBefore = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
        const rejected = yield* Effect.result(api.commitUse({
          playerOwnerId,
          playerStorage: storageWith('bucket'),
          blockWrite: writeBatch(revisionBefore, dimensionBefore, position.x, 32),
        }))

        expect(Schema.decodeUnknownSync(Schema.Result(BucketUseOutcomeSchema, BucketServiceErrorSchema))(rejected))
          .toEqual(rejected)
        expect(Result.isFailure(rejected)).toBe(true)
        if (Result.isFailure(rejected)) expect(rejected.failure).toBeInstanceOf(WorldWriteChunkUnavailable)
        expect(yield* coordinator.revision).toBe(revisionBefore)
        expect(yield* coordinator.dimensionRevision('overworld')).toBe(dimensionBefore)
        expect(yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)).toEqual(playerBefore)
        expect(yield* overworld.getBlock(position)).toEqual({ _tag: 'Block', block: AIR_BLOCK_ID })
      }),
    ),
  )

  it.effect('does not commit an inventory-only update for an empty fluid batch', () =>
    Effect.flatMap(makeFixture(), ({ coordinator, api }) =>
      Effect.gen(function* () {
        const revisionBefore = yield* coordinator.revision
        const playerBefore = yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)
        const emptyBatch = Schema.decodeUnknownSync(WorldWriteBatchSchema)({
          world,
          expectedWorldRevision: revisionBefore,
          dimension: 'overworld',
          expectedDimensionRevision: yield* coordinator.dimensionRevision('overworld'),
          edits: [],
        })
        const outcome = yield* api.commitUse({
          playerOwnerId,
          playerStorage: storageWith('bucket'),
          blockWrite: emptyBatch,
        })

        expect(Schema.decodeUnknownSync(BucketUseOutcomeSchema)(outcome)).toEqual(outcome)
        expect(outcome).toEqual({ _tag: 'NoChanges' })
        expect(yield* coordinator.revision).toBe(revisionBefore)
        expect(yield* coordinator.snapshot(playerOwnerId, PlayerStorageSnapshotSchema)).toEqual(playerBefore)
      }),
    ),
  )

  it('rejects bucket outcomes with missing or null required fields', () => {
    const decode = Schema.decodeUnknownSync(BucketUseOutcomeSchema)
    const assertRequiredFields = (sample: Record<string, unknown>, fields: ReadonlyArray<string>) => {
      for (const field of fields) {
        const withoutField = Object.fromEntries(Object.entries(sample).filter(([key]) => key !== field))
        expect(() => decode(withoutField)).toThrow()
        expect(() => decode({ ...sample, [field]: null })).toThrow()
      }
    }
    assertRequiredFields({ _tag: 'Committed', revision: 0 }, ['_tag', 'revision'])
    expect(() => decode({ _tag: 'Committed', revision: Number.MAX_SAFE_INTEGER + 1 })).toThrow()
    assertRequiredFields({ _tag: 'NoChanges' }, ['_tag'])
    expect(decode({ _tag: 'Committed', revision: 0 })).toEqual({ _tag: 'Committed', revision: 0 })
    expect(decode({ _tag: 'NoChanges' })).toEqual({ _tag: 'NoChanges' })
  })
})
