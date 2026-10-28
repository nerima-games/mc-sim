import { describe, expect, it } from '@effect/vitest'
import { Brand, Cause, Deferred, Effect, Exit, Fiber, Result, Schema, SchemaGetter } from 'effect'
import {
  BlockIdSchema,
  BlockPositionSchema,
  ChunkAxis,
  DimensionIdSchema,
  DimensionRevisionSchema,
  WorldIdSchema,
  WorldRevisionSchema,
  WorldWriteChunkUnavailable,
  WorldWriteInvalidBatch,
  chunkKeyOfPosition,
} from '@nerima-games/mc-kernel'
import type { BlockId, ChunkCoord, Dimension, WorldWriteBatch } from '@nerima-games/mc-kernel'
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  ChunkCapacity,
  ChunkStoreRegistry,
  ChunkStoreRegistryLayer,
  chunkCoord,
} from '@nerima-games/mc-worldgen'
import { emptyBlocks } from '@nerima-games/mc-worldgen/testing'
import type {
  ChunkStoreRegistryApi,
  ChunkWriteInvalidBatch,
  ChunkWriteStale,
  PreparedChunkWrite,
} from '@nerima-games/mc-worldgen'
import type { ReplicatedOwnerId } from '../src/application/replicated-state'
import {
  ReplicatedBlockChangeSchema,
  ReplicatedOwnerChangeSchema,
  WorldBlockReadSchema,
  WorldReadSnapshotSchema,
  replicatedOwnerChangeSchema,
  replicatedSnapshotSchema,
  replicatedWorldDeltaSchema,
} from '../src/application/replicated-state'
import {
  DimensionRevisionConflict,
  makeWorldCommitCoordinator,
  ReplicatedOwnerDuplicate,
  ReplicatedOwnerUnknown,
  WorldRevisionConflict,
  WorldCommitCoordinator,
  WorldCommitCoordinatorErrorSchema,
  WorldCommitResultSchema,
  WorldCommitCoordinatorLayer,
  WorldCommitBlockWriteInvalidPosition,
  WorldCommitChunkStoreUnavailable,
  WorldWriteTokenInvalid,
} from '../src/application/world-commit-coordinator'

const makeOwnerId = Brand.nominal<ReplicatedOwnerId>()
const ownerA = makeOwnerId('owner-a')
const ownerB = makeOwnerId('owner-b')
const unknownOwner = makeOwnerId('unknown-owner')
const transactionPosition = Schema.decodeUnknownSync(BlockPositionSchema)({ x: 1, y: 32, z: 1 })
const blockId = (value: number): BlockId => Schema.decodeUnknownSync(BlockIdSchema)(value)
const transactionWorld = Schema.decodeUnknownSync(WorldIdSchema)('world-a')
const transactionDimension = Schema.decodeUnknownSync(DimensionIdSchema)('overworld')
const transactionSource = (_dimension: Dimension) => (coord: ChunkCoord) => Effect.succeed({
  blocks: emptyBlocks(),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
  coord,
})
const makeChunkStoreRegistry = () => Effect.provide(
  ChunkStoreRegistry,
  ChunkStoreRegistryLayer(transactionSource, ChunkCapacity(2)),
)
const makeBlockWrite = (
  block: BlockId,
  edits: WorldWriteBatch['edits'] = [{ position: transactionPosition, block }],
): WorldWriteBatch => ({
  world: transactionWorld,
  expectedWorldRevision: Schema.decodeUnknownSync(WorldRevisionSchema)(0),
  dimension: transactionDimension,
  expectedDimensionRevision: Schema.decodeUnknownSync(DimensionRevisionSchema)(0),
  edits,
})

const decodeCoordinatorEffectResult = (value: unknown) =>
  Schema.decodeUnknownSync(Schema.Result(Schema.Unknown, WorldCommitCoordinatorErrorSchema))(value)

const commitEffectResultSchema = WorldCommitResultSchema(ReplicatedOwnerChangeSchema)
const decodeCommitEffectResult = (value: unknown) =>
  Schema.decodeUnknownSync(commitEffectResultSchema)(value)

const expectRequiredFieldsToRejectOmissionAndNull = (
  schema: Schema.Codec<any, any>,
  value: Readonly<Record<string, unknown>>,
  fields: ReadonlyArray<string>,
) => {
  for (const field of fields) {
    const omitted = Object.fromEntries(Object.entries(value).filter(([key]) => key !== field))
    expect(Schema.decodeUnknownResult(schema)(omitted)._tag, `${field} omission`).toBe('Failure')
    expect(Schema.decodeUnknownResult(schema)({ ...value, [field]: null })._tag, `${field} null`).toBe('Failure')
  }
}

describe('replicated state schemas', () => {
  it('builds typed snapshot, owner-change, and world-delta codecs', () => {
    const stateSchema = Schema.Struct({ enabled: Schema.Boolean })
    const ownerChangeSchema = replicatedOwnerChangeSchema('owner-a', stateSchema)
    const snapshot = Schema.decodeUnknownResult(replicatedSnapshotSchema(stateSchema))({
      world: 'world-a',
      revision: 3,
      state: { enabled: true },
    })
    const ownerChange = Schema.decodeUnknownResult(ownerChangeSchema)({
      owner: 'owner-a',
      state: { enabled: false },
    })
    const delta = Schema.decodeUnknownResult(replicatedWorldDeltaSchema(ownerChangeSchema))({
      world: 'world-a',
      revision: 4,
      changes: [{ owner: 'owner-a', state: { enabled: true } }],
      blockChanges: [],
    })

    expect(snapshot._tag).toBe('Success')
    expect(ownerChange._tag).toBe('Success')
    expect(Schema.decodeUnknownResult(ownerChangeSchema)({
      owner: 'owner-b',
      state: { enabled: false },
    })._tag).toBe('Failure')
    expect(delta._tag).toBe('Success')
    if (delta._tag === 'Success') expect(delta.success.changes).toHaveLength(1)
  })

  it('rejects omitted and null commit-result and block-change fields', () => {
    const ownerChangeSchema = replicatedOwnerChangeSchema('owner-a', Schema.Struct({ enabled: Schema.Boolean }))
    const deltaSchema = replicatedWorldDeltaSchema(ownerChangeSchema)
    const delta = {
      world: 'world-a',
      revision: 1,
      changes: [{ owner: 'owner-a', state: { enabled: true } }],
      blockChanges: [{
        dimension: 'overworld',
        position: { x: 1, y: 32, z: 1 },
        before: 1,
        after: 2,
      }],
    }
    expect(Schema.decodeUnknownResult(commitEffectResultSchema)(Result.succeed(delta))._tag).toBe('Success')
    for (const field of ['world', 'revision', 'changes', 'blockChanges']) {
      const missingResult = Result.succeed(Object.fromEntries(Object.entries(delta).filter(([key]) => key !== field)))
      const nullResult = Result.succeed({ ...delta, [field]: null })
      expect(Schema.decodeUnknownResult(commitEffectResultSchema)(missingResult)._tag, `${field} omission`)
        .toBe('Failure')
      expect(Schema.decodeUnknownResult(commitEffectResultSchema)(nullResult)._tag, `${field} null`)
        .toBe('Failure')
    }
    expect(Schema.decodeUnknownResult(deltaSchema)({ ...delta, revision: Number.MAX_SAFE_INTEGER })._tag).toBe('Success')
    expect(Schema.decodeUnknownResult(deltaSchema)({ ...delta, revision: Number.MAX_SAFE_INTEGER + 1 })._tag)
      .toBe('Failure')
    expect(Schema.decodeUnknownResult(ReplicatedBlockChangeSchema)({
      ...delta.blockChanges[0],
      position: { x: Number.MAX_SAFE_INTEGER + 1, y: 32, z: 1 },
    })._tag).toBe('Failure')
    expectRequiredFieldsToRejectOmissionAndNull(deltaSchema, delta, ['world', 'revision', 'changes', 'blockChanges'])
    expectRequiredFieldsToRejectOmissionAndNull(ReplicatedBlockChangeSchema, delta.blockChanges[0]!, [
      'dimension', 'position', 'before', 'after',
    ])

    const blockRead = {
      dimension: 'overworld',
      position: { x: 1, y: 32, z: 1 },
      reading: { _tag: 'Block', block: 2 },
    }
    expectRequiredFieldsToRejectOmissionAndNull(WorldBlockReadSchema, blockRead, ['dimension', 'position', 'reading'])
    expect(Schema.decodeUnknownResult(WorldBlockReadSchema)({
      ...blockRead,
      reading: { _tag: 'Block' },
    })._tag).toBe('Failure')
    expect(Schema.decodeUnknownResult(WorldBlockReadSchema)({
      ...blockRead,
      reading: { _tag: 'Block', block: null },
    })._tag).toBe('Failure')

    const readSnapshotSchema = WorldReadSnapshotSchema(Schema.Struct({ enabled: Schema.Boolean }))
    const readSnapshot = {
      world: 'world-a',
      revision: 1,
      state: { enabled: true },
      blocks: [blockRead],
    }
    expectRequiredFieldsToRejectOmissionAndNull(readSnapshotSchema, readSnapshot, [
      'world', 'revision', 'state', 'blocks',
    ])
  })

  it('decodes the complete commit Result, including strict tagged failures and stale revisions', () => {
    const staleValue = {
      _tag: 'WorldWriteStale',
      dimension: 'overworld',
      key: '0,0',
      expectedRevision: 0,
      actualRevision: { _tag: 'None' },
    }
    const staleSchema = WorldCommitCoordinatorErrorSchema
    const validFailureResult = Result.fail(staleValue)
    expect(Schema.decodeUnknownResult(commitEffectResultSchema)(validFailureResult)._tag).toBe('Success')

    for (const field of ['dimension', 'key', 'expectedRevision', 'actualRevision']) {
      const missingFailure = Result.fail(Object.fromEntries(Object.entries(staleValue).filter(([key]) => key !== field)))
      const nullFailure = Result.fail({ ...staleValue, [field]: null })
      expect(Schema.decodeUnknownResult(commitEffectResultSchema)(missingFailure)._tag, `${field} omission`)
        .toBe('Failure')
      expect(Schema.decodeUnknownResult(commitEffectResultSchema)(nullFailure)._tag, `${field} null`)
        .toBe('Failure')
    }
    expect(Schema.decodeUnknownResult(staleSchema)({ ...staleValue, expectedRevision: Number.MAX_SAFE_INTEGER })._tag)
      .toBe('Success')
    expect(Schema.decodeUnknownResult(staleSchema)({
      ...staleValue,
      actualRevision: { _tag: 'Some', value: Number.MAX_SAFE_INTEGER },
    })._tag).toBe('Success')
    expect(Schema.decodeUnknownResult(staleSchema)({
      ...staleValue,
      actualRevision: { _tag: 'Some', value: Number.MAX_SAFE_INTEGER + 1 },
    })._tag).toBe('Failure')
    expect(Schema.decodeUnknownResult(staleSchema)({ ...staleValue, expectedRevision: Number.MAX_SAFE_INTEGER + 1 })._tag)
      .toBe('Failure')
    expect(Schema.decodeUnknownResult(staleSchema)({ ...staleValue, expectedRevision: -1 })._tag).toBe('Failure')
    expect(Schema.decodeUnknownResult(staleSchema)({ ...staleValue, expectedRevision: 0.5 })._tag).toBe('Failure')
    expect(Schema.decodeUnknownResult(commitEffectResultSchema)(Result.fail({
      _tag: 'WorldWriteTokenInvalid',
      reason: 'unknown_token',
    }))._tag).toBe('Success')
    expect(Schema.decodeUnknownResult(commitEffectResultSchema)(Result.fail({
      _tag: 'WorldWriteTokenInvalid',
    }))._tag).toBe('Failure')
  })
})

describe('WorldCommitCoordinator', () => {
  it.effect('provides the coordinator layer and starts unregistered dimensions at revision zero', () =>
    Effect.gen(function* () {
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const dimensionRevisionZero = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(0)
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const coordinator = yield* WorldCommitCoordinator
      const absentDimension = yield* coordinator.dimensionRevision('end')
      const unknownSnapshot = decodeCoordinatorEffectResult(
        yield* Effect.result(coordinator.snapshot(unknownOwner, counterSchema)),
      )
      const delta = yield* coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'end', expectedRevision: dimensionRevisionZero }],
        changes: [{ ownerId: ownerA, state: { count: 1 } }],
      })

      expect(absentDimension).toBe(0)
      expect(coordinator.worldId).toBe('world-a')
      expect(unknownSnapshot._tag).toBe('Failure')
      if (unknownSnapshot._tag === 'Failure') expect(unknownSnapshot.failure).toBeInstanceOf(ReplicatedOwnerUnknown)
      expect(delta.revision).toBe(1)
      expect(yield* coordinator.dimensionRevision('end')).toBe(1)
    }).pipe(Effect.provide(WorldCommitCoordinatorLayer({
      world: Schema.decodeUnknownSync(WorldIdSchema)('world-a'),
      dimensions: [],
      owners: [{ ownerId: ownerA, schema: Schema.Struct({ count: Schema.Int }), initialState: { count: 0 } }],
    }))),
  )

  it.effect('rejects commitFromSnapshot for an unknown owner before building a request', () =>
    Effect.gen(function* () {
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const coordinator = yield* makeWorldCommitCoordinator({
        world: transactionWorld,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
      })
      let buildRequestCalled = false

      const result = decodeCoordinatorEffectResult(yield* Effect.result(coordinator.commitFromSnapshot(
        unknownOwner,
        counterSchema,
        (current) => Effect.sync(() => {
          buildRequestCalled = true
          return {
            expectedRevision: current.revision,
            expectedDimensions: [],
            changes: [{ ownerId: ownerA, state: { count: current.state.count + 1 } }],
          }
        }),
      )))

      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') expect(result.failure).toBeInstanceOf(ReplicatedOwnerUnknown)
      expect(buildRequestCalled).toBe(false)
      expect(yield* coordinator.revision).toBe(0)
      expect((yield* coordinator.snapshot(ownerA, counterSchema)).state).toEqual({ count: 0 })
    }),
  )

  it.effect('publishes all owner candidates at one world revision and advances each dimension once', () =>
    Effect.gen(function* () {
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('world-a')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const dimensionRevisionZero = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(0)
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const flagSchema = Schema.Struct({ enabled: Schema.Boolean })
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [
          { ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } },
          { ownerId: ownerB, schema: flagSchema, initialState: { enabled: false } },
        ],
      })

      const delta = yield* coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [
          { dimension: 'overworld', expectedRevision: dimensionRevisionZero },
          { dimension: 'nether', expectedRevision: dimensionRevisionZero },
          { dimension: 'overworld', expectedRevision: dimensionRevisionZero },
        ],
        changes: [
          { ownerId: ownerA, state: { count: 1 } },
          { ownerId: ownerB, state: { enabled: true } },
        ],
      })

      expect(delta.revision).toBe(1)
      expect(delta.changes.map(({ owner }) => owner)).toStrictEqual([ownerA, ownerB])
      expect(yield* coordinator.revision).toBe(1)
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(1)
      expect(yield* coordinator.dimensionRevision('nether')).toBe(1)
      expect(yield* coordinator.dimensionRevision('end')).toBe(0)

      const player = yield* coordinator.snapshot(ownerA, counterSchema)
      const inventory = yield* coordinator.snapshot(ownerB, flagSchema)
      expect(player).toStrictEqual({ world, revision: delta.revision, state: { count: 1 } })
      expect(inventory).toStrictEqual({ world, revision: delta.revision, state: { enabled: true } })
    }),
  )

  it.effect('a decode failure in one owner candidate leaves every owner and revision unchanged', () =>
    Effect.gen(function* () {
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('world-a')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const dimensionRevisionZero = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(0)
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const flagSchema = Schema.Struct({ enabled: Schema.Boolean })
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [
          { ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } },
          { ownerId: ownerB, schema: flagSchema, initialState: { enabled: false } },
        ],
      })

      const outcome = decodeCommitEffectResult(yield* Effect.result(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
        changes: [
          { ownerId: ownerA, state: { count: 8 } },
          { ownerId: ownerB, state: { enabled: 'invalid' } },
        ],
      })))

      expect(outcome._tag).toBe('Failure')
      expect(yield* coordinator.revision).toBe(0)
      expect((yield* coordinator.snapshot(ownerA, counterSchema)).state).toStrictEqual({ count: 0 })
      expect((yield* coordinator.snapshot(ownerB, flagSchema)).state).toStrictEqual({ enabled: false })
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(0)
    }),
  )

  it.effect('an encode failure in one owner candidate leaves earlier candidates unpublished', () =>
    Effect.gen(function* () {
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('world-a')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const dimensionRevisionZero = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(0)
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const nonNegativeInt: Schema.Int = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
      const encodeGuardedInt = Schema.decodeTo<Schema.Int, Schema.Int>(Schema.Int, {
        decode: SchemaGetter.transform<number, number>((value) => value),
        encode: SchemaGetter.transform<number, number>((value) => value === 0 ? 0 : -1),
      })(nonNegativeInt)
      const guardedSchema = Schema.Struct({ count: encodeGuardedInt })
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [
          { ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } },
          { ownerId: ownerB, schema: guardedSchema, initialState: { count: 0 } },
        ],
      })

      const outcome = decodeCommitEffectResult(yield* Effect.result(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
        changes: [
          { ownerId: ownerA, state: { count: 7 } },
          { ownerId: ownerB, state: { count: 1 } },
        ],
      })))

      expect(outcome._tag).toBe('Failure')
      expect(yield* coordinator.revision).toBe(0)
      expect((yield* coordinator.snapshot(ownerA, counterSchema)).state).toStrictEqual({ count: 0 })
      expect((yield* coordinator.snapshot(ownerB, guardedSchema)).state).toStrictEqual({ count: 0 })
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(0)
    }),
  )

  it.effect('interrupting preflight leaves owner state, revisions, and the returned delta unchanged', () =>
    Effect.gen(function* () {
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('world-a')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const dimensionRevisionZero = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(0)
      const decodeStarted = yield* Deferred.make<void>()
      const releaseDecode = yield* Deferred.make<void>()
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const gatedCount = Schema.Int.pipe(Schema.decode({
        decode: SchemaGetter.transformEffect((value: number) => value === 1
          ? Effect.andThen(
              Deferred.succeed(decodeStarted, undefined),
              Effect.map(Deferred.await(releaseDecode), () => value),
            )
          : Effect.succeed(value)),
        encode: SchemaGetter.passthrough(),
      }))
      const gatedSchema = Schema.Struct({ count: gatedCount })
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [
          { ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } },
          { ownerId: ownerB, schema: gatedSchema, initialState: { count: 0 } },
        ],
      })

      const fiber = yield* Effect.forkChild(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
        changes: [
          { ownerId: ownerA, state: { count: 5 } },
          { ownerId: ownerB, state: { count: 1 } },
        ],
      }))
      yield* Deferred.await(decodeStarted)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(yield* coordinator.revision).toBe(0)
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(0)
      expect((yield* coordinator.snapshot(ownerA, counterSchema)).state).toStrictEqual({ count: 0 })
      expect((yield* coordinator.snapshot(ownerB, gatedSchema)).state).toStrictEqual({ count: 0 })
    }),
  )

  it.effect('returns the three contract conflicts without publishing a candidate', () =>
    Effect.gen(function* () {
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('world-a')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const revisionOne = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(1)
      const dimensionRevisionOne = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(1)
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
      })
      const candidate = { ownerId: ownerA, state: { count: 1 } }

      const invalidRevision = decodeCommitEffectResult(yield* Effect.result(coordinator.commit({
        expectedRevision: Brand.nominal<typeof revisionZero>()(0.5),
        expectedDimensions: [],
        changes: [candidate],
      })))
      const worldConflict = decodeCommitEffectResult(yield* Effect.result(coordinator.commit({
        expectedRevision: revisionOne,
        expectedDimensions: [],
        changes: [candidate],
      })))
      const dimensionConflict = decodeCommitEffectResult(yield* Effect.result(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionOne }],
        changes: [candidate],
      })))
      const ownerConflict = decodeCommitEffectResult(yield* Effect.result(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [],
        changes: [{ ownerId: unknownOwner, state: { count: 1 } }],
      })))

      expect(invalidRevision._tag).toBe('Failure')
      if (invalidRevision._tag === 'Failure') expect(invalidRevision.failure._tag).toBe('SchemaError')
      expect(worldConflict._tag).toBe('Failure')
      if (worldConflict._tag === 'Failure') expect(worldConflict.failure).toBeInstanceOf(WorldRevisionConflict)
      expect(dimensionConflict._tag).toBe('Failure')
      if (dimensionConflict._tag === 'Failure') expect(dimensionConflict.failure).toBeInstanceOf(DimensionRevisionConflict)
      expect(ownerConflict._tag).toBe('Failure')
      if (ownerConflict._tag === 'Failure') expect(ownerConflict.failure).toBeInstanceOf(ReplicatedOwnerUnknown)
      expect(yield* coordinator.revision).toBe(0)
      expect((yield* coordinator.snapshot(ownerA, counterSchema)).state).toStrictEqual({ count: 0 })
    }),
  )

  it.effect('rejects duplicate owner registrations and duplicate owners in a group', () =>
    Effect.gen(function* () {
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('world-a')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const duplicateRegistration = decodeCoordinatorEffectResult(yield* Effect.result(makeWorldCommitCoordinator({
        world,
        owners: [
          { ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } },
          { ownerId: ownerA, schema: counterSchema, initialState: { count: 1 } },
        ],
      })))
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
      })
      const duplicateChange = decodeCommitEffectResult(yield* Effect.result(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [],
        changes: [
          { ownerId: ownerA, state: { count: 1 } },
          { ownerId: ownerA, state: { count: 2 } },
        ],
      })))

      expect(duplicateRegistration._tag).toBe('Failure')
      if (duplicateRegistration._tag === 'Failure') expect(duplicateRegistration.failure).toBeInstanceOf(ReplicatedOwnerDuplicate)
      expect(duplicateChange._tag).toBe('Failure')
      if (duplicateChange._tag === 'Failure') expect(duplicateChange.failure).toBeInstanceOf(ReplicatedOwnerDuplicate)
      expect(yield* coordinator.revision).toBe(0)
    }),
  )

  it.effect('commits a sparse block patch with owner state under one revision and reads both together', () =>
    Effect.gen(function* () {
      const registry = yield* makeChunkStoreRegistry()
      const chunkStore = registry.forDimension('overworld')
      yield* chunkStore.load(chunkCoord(ChunkAxis(0), ChunkAxis(0)))
      yield* chunkStore.setBlock(transactionPosition, blockId(1))
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const coordinator = yield* makeWorldCommitCoordinator({
        world: transactionWorld,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
        chunkStores: registry,
      })
      const revisionZero = Schema.decodeUnknownSync(WorldRevisionSchema)(0)
      const dimensionRevisionZero = Schema.decodeUnknownSync(DimensionRevisionSchema)(0)

      const delta = yield* coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
        changes: [{ ownerId: ownerA, state: { count: 1 } }],
        blockWrite: makeBlockWrite(blockId(2)),
      })
      const observed = yield* coordinator.observe(ownerA, counterSchema, [
        { dimension: 'overworld', position: transactionPosition },
      ])
      const observedDecoded = Schema.decodeUnknownResult(WorldReadSnapshotSchema(counterSchema))(observed)

      expect(delta.revision).toBe(1)
      expect(delta.changes.map(({ owner }) => owner)).toStrictEqual([ownerA])
      expect(delta.blockChanges).toStrictEqual([{
        dimension: 'overworld',
        position: transactionPosition,
        before: blockId(1),
        after: blockId(2),
      }])
      expect(yield* coordinator.revision).toBe(1)
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(1)
      expect(yield* coordinator.dimensionRevision('nether')).toBe(0)
      expect(observedDecoded._tag).toBe('Success')
      if (observedDecoded._tag === 'Success') {
        expect(observedDecoded.success).toStrictEqual({
          world: transactionWorld,
          revision: delta.revision,
          state: { count: 1 },
          blocks: [{
            dimension: 'overworld',
            position: transactionPosition,
            reading: { _tag: 'Block', block: blockId(2) },
          }],
        })
      }
    }),
  )

  it.effect('commits a non-empty all-no-op batch with an empty sparse delta', () =>
    Effect.gen(function* () {
      const registry = yield* makeChunkStoreRegistry()
      const chunkStore = registry.forDimension('overworld')
      yield* chunkStore.load(chunkCoord(ChunkAxis(0), ChunkAxis(0)))
      yield* chunkStore.setBlock(transactionPosition, blockId(1))
      const coordinator = yield* makeWorldCommitCoordinator({
        world: transactionWorld,
        owners: [],
        chunkStores: registry,
      })
      const delta = yield* coordinator.commit({
        expectedRevision: Schema.decodeUnknownSync(WorldRevisionSchema)(0),
        expectedDimensions: [{
          dimension: 'overworld',
          expectedRevision: Schema.decodeUnknownSync(DimensionRevisionSchema)(0),
        }],
        changes: [],
        blockWrite: makeBlockWrite(blockId(1)),
      })

      expect(delta.blockChanges).toStrictEqual([])
      expect(delta.revision).toBe(1)
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(1)
      expect(yield* chunkStore.getBlock(transactionPosition)).toStrictEqual({ _tag: 'Block', block: blockId(1) })
    }),
  )

  it.effect('rejects empty, duplicate, out-of-world, and unavailable block writes without partial publication', () =>
    Effect.gen(function* () {
      const registry = yield* makeChunkStoreRegistry()
      const chunkStore = registry.forDimension('overworld')
      yield* chunkStore.load(chunkCoord(ChunkAxis(0), ChunkAxis(0)))
      yield* chunkStore.setBlock(transactionPosition, blockId(1))
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const coordinator = yield* makeWorldCommitCoordinator({
        world: transactionWorld,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
        chunkStores: registry,
      })
      const revisionZero = Schema.decodeUnknownSync(WorldRevisionSchema)(0)
      const dimensionRevisionZero = Schema.decodeUnknownSync(DimensionRevisionSchema)(0)
      const candidate = { ownerId: ownerA, state: { count: 1 } }
      const outOfWorldPosition = Schema.decodeUnknownSync(BlockPositionSchema)({ x: 1, y: CHUNK_HEIGHT, z: 1 })
      const unavailablePosition = Schema.decodeUnknownSync(BlockPositionSchema)({ x: CHUNK_SIZE_XZ * 2, y: 32, z: 1 })
      const emptyBatch = makeBlockWrite(blockId(2), [])
      const duplicateBatch = makeBlockWrite(blockId(2), [
        { position: transactionPosition, block: blockId(2) },
        { position: transactionPosition, block: blockId(3) },
      ])
      const outOfWorldBatch = makeBlockWrite(blockId(2), [{ position: outOfWorldPosition, block: blockId(2) }])
      const unavailableBatch = makeBlockWrite(blockId(2), [{ position: unavailablePosition, block: blockId(2) }])
      const requests: ReadonlyArray<WorldWriteBatch> = [emptyBatch, duplicateBatch, outOfWorldBatch, unavailableBatch]
      const outcomes = yield* Effect.forEach(requests, (blockWrite) => Effect.map(Effect.result(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
        changes: [candidate],
        blockWrite,
      })), decodeCommitEffectResult))

      expect(outcomes.map(({ _tag }) => _tag)).toStrictEqual(['Failure', 'Failure', 'Failure', 'Failure'])
      const [emptyOutcome, duplicateOutcome, outOfWorldOutcome, unavailableOutcome] = outcomes
      if (emptyOutcome?._tag === 'Failure') expect(emptyOutcome.failure).toBeInstanceOf(WorldWriteInvalidBatch)
      if (duplicateOutcome?._tag === 'Failure') expect(duplicateOutcome.failure).toBeInstanceOf(WorldWriteInvalidBatch)
      if (outOfWorldOutcome?._tag === 'Failure') expect(outOfWorldOutcome.failure).toBeInstanceOf(WorldCommitBlockWriteInvalidPosition)
      if (unavailableOutcome?._tag === 'Failure') expect(unavailableOutcome.failure).toBeInstanceOf(WorldWriteChunkUnavailable)
      expect(yield* coordinator.revision).toBe(0)
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(0)
      expect((yield* coordinator.snapshot(ownerA, counterSchema)).state).toStrictEqual({ count: 0 })
      expect(yield* chunkStore.getBlock(transactionPosition)).toStrictEqual({ _tag: 'Block', block: blockId(1) })
    }),
  )

  it.effect('checks block batch world and revision baselines without substituting request values', () =>
    Effect.gen(function* () {
      const registry = yield* makeChunkStoreRegistry()
      yield* registry.forDimension('overworld').load(chunkCoord(ChunkAxis(0), ChunkAxis(0)))
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const coordinator = yield* makeWorldCommitCoordinator({
        world: transactionWorld,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
        chunkStores: registry,
      })
      const revisionZero = Schema.decodeUnknownSync(WorldRevisionSchema)(0)
      const dimensionRevisionZero = Schema.decodeUnknownSync(DimensionRevisionSchema)(0)
      const otherWorld = Schema.decodeUnknownSync(WorldIdSchema)('world-b')
      const mismatchedWorld = { ...makeBlockWrite(blockId(2)), world: otherWorld }
      const mismatchedWorldRevision = {
        ...makeBlockWrite(blockId(2)),
        expectedWorldRevision: Schema.decodeUnknownSync(WorldRevisionSchema)(1),
      }
      const mismatchedDimensionRevision = {
        ...makeBlockWrite(blockId(2)),
        expectedDimensionRevision: Schema.decodeUnknownSync(DimensionRevisionSchema)(1),
      }
      const [worldOutcome, worldRevisionOutcome, dimensionRevisionOutcome, missingDimensionOutcome, emptyOutcome] = yield* Effect.all([
        coordinator.commit({
          expectedRevision: revisionZero,
          expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
          changes: [],
          blockWrite: mismatchedWorld,
        }).pipe(Effect.result, Effect.map(decodeCommitEffectResult)),
        coordinator.commit({
          expectedRevision: revisionZero,
          expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
          changes: [],
          blockWrite: mismatchedWorldRevision,
        }).pipe(Effect.result, Effect.map(decodeCommitEffectResult)),
        coordinator.commit({
          expectedRevision: revisionZero,
          expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
          changes: [],
          blockWrite: mismatchedDimensionRevision,
        }).pipe(Effect.result, Effect.map(decodeCommitEffectResult)),
        coordinator.commit({
          expectedRevision: revisionZero,
          expectedDimensions: [],
          changes: [],
          blockWrite: makeBlockWrite(blockId(2)),
        }).pipe(Effect.result, Effect.map(decodeCommitEffectResult)),
        coordinator.commit({ expectedRevision: revisionZero, expectedDimensions: [], changes: [] })
          .pipe(Effect.result, Effect.map(decodeCommitEffectResult)),
      ])

      expect([
        worldOutcome,
        worldRevisionOutcome,
        dimensionRevisionOutcome,
        missingDimensionOutcome,
        emptyOutcome,
      ].map(({ _tag }) => _tag)).toStrictEqual(['Failure', 'Failure', 'Failure', 'Failure', 'Failure'])
      if (worldOutcome._tag === 'Failure') expect(worldOutcome.failure._tag).toBe('WorldCommitBlockWriteMismatch')
      if (worldRevisionOutcome._tag === 'Failure') expect(worldRevisionOutcome.failure._tag).toBe('WorldCommitBlockWriteMismatch')
      if (dimensionRevisionOutcome._tag === 'Failure') {
        expect(dimensionRevisionOutcome.failure._tag).toBe('WorldCommitBlockWriteMismatch')
        if (dimensionRevisionOutcome.failure._tag === 'WorldCommitBlockWriteMismatch') {
          expect(dimensionRevisionOutcome.failure.reason).toBe('dimension-revision')
        }
      }
      if (missingDimensionOutcome._tag === 'Failure') {
        expect(missingDimensionOutcome.failure._tag).toBe('WorldCommitBlockWriteMismatch')
        if (missingDimensionOutcome.failure._tag === 'WorldCommitBlockWriteMismatch') {
          expect(missingDimensionOutcome.failure.reason).toBe('dimension-revision')
        }
      }
      if (emptyOutcome._tag === 'Failure') expect(emptyOutcome.failure._tag).toBe('WorldCommitEmptyRequest')
      expect(yield* coordinator.revision).toBe(0)
    }),
  )

  it.effect('serializes same-revision commits so only one prepared block patch is visible', () =>
    Effect.gen(function* () {
      const registry = yield* makeChunkStoreRegistry()
      const chunkStore = registry.forDimension('overworld')
      yield* chunkStore.load(chunkCoord(ChunkAxis(0), ChunkAxis(0)))
      yield* chunkStore.setBlock(transactionPosition, blockId(1))
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const coordinator = yield* makeWorldCommitCoordinator({
        world: transactionWorld,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
        chunkStores: registry,
      })
      const revisionZero = Schema.decodeUnknownSync(WorldRevisionSchema)(0)
      const dimensionRevisionZero = Schema.decodeUnknownSync(DimensionRevisionSchema)(0)
      const commit = (block: BlockId) => coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
        changes: [{ ownerId: ownerA, state: { count: block } }],
        blockWrite: makeBlockWrite(block),
      }).pipe(Effect.result, Effect.map(decodeCommitEffectResult))
      const outcomes = yield* Effect.all([commit(blockId(2)), commit(blockId(3))], { concurrency: 'unbounded' })
      const winnerIndex = outcomes.findIndex((outcome) => outcome._tag === 'Success')
      const winner = outcomes[winnerIndex]
      const winnerBlock = winnerIndex === 0 ? blockId(2) : blockId(3)

      expect(outcomes.filter(({ _tag }) => _tag === 'Success')).toHaveLength(1)
      expect(outcomes.filter(({ _tag }) => _tag === 'Failure')).toHaveLength(1)
      if (winner?._tag === 'Success') expect(winner.success.blockChanges[0]?.after).toBe(winnerBlock)
      expect(yield* coordinator.revision).toBe(1)
      expect(yield* chunkStore.getBlock(transactionPosition)).toStrictEqual({ _tag: 'Block', block: winnerBlock })
    }),
  )

  it.effect('maps a stale prepared chunk and an invalid publish token without advancing coordinator state', () =>
    Effect.gen(function* () {
      const baseRegistry = yield* makeChunkStoreRegistry()
      const baseStore = baseRegistry.forDimension('overworld')
      yield* baseStore.load(chunkCoord(ChunkAxis(0), ChunkAxis(0)))
      yield* baseStore.setBlock(transactionPosition, blockId(1))
      const staleRegistry: ChunkStoreRegistryApi = {
        forDimension: (dimension) => {
          const store = baseRegistry.forDimension(dimension)
          return {
            ...store,
            publish: (prepared) => Effect.flatMap(
              store.setBlock(transactionPosition, blockId(3)),
              () => store.publish(prepared),
            ),
          }
        },
      }
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const staleCoordinator = yield* makeWorldCommitCoordinator({
        world: transactionWorld,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
        chunkStores: staleRegistry,
      })
      const revisionZero = Schema.decodeUnknownSync(WorldRevisionSchema)(0)
      const dimensionRevisionZero = Schema.decodeUnknownSync(DimensionRevisionSchema)(0)
      const staleOutcome = decodeCommitEffectResult(yield* Effect.result(staleCoordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
        changes: [{ ownerId: ownerA, state: { count: 1 } }],
        blockWrite: makeBlockWrite(blockId(2)),
      })))

      expect(staleOutcome._tag).toBe('Failure')
      if (staleOutcome._tag === 'Failure') {
        expect(staleOutcome.failure._tag).toBe('WorldWriteStale')
        if (staleOutcome.failure._tag === 'WorldWriteStale') {
          expect(staleOutcome.failure.actualRevision._tag).toBe('Some')
        }
      }
      expect(yield* staleCoordinator.revision).toBe(0)
      expect((yield* staleCoordinator.snapshot(ownerA, counterSchema)).state).toStrictEqual({ count: 0 })
      expect(yield* baseStore.getBlock(transactionPosition)).toStrictEqual({ _tag: 'Block', block: blockId(3) })

      const tokenRegistry: ChunkStoreRegistryApi = {
        forDimension: (dimension) => {
          const store = baseRegistry.forDimension(dimension)
          return {
            ...store,
            publish: (_prepared: PreparedChunkWrite) => Effect.fail({
              _tag: 'ChunkWriteTokenInvalid',
              reason: 'unknown_token',
            }),
          }
        },
      }
      const tokenCoordinator = yield* makeWorldCommitCoordinator({
        world: transactionWorld,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
        chunkStores: tokenRegistry,
      })
      const tokenOutcome = decodeCommitEffectResult(yield* Effect.result(tokenCoordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
        changes: [{ ownerId: ownerA, state: { count: 1 } }],
        blockWrite: makeBlockWrite(blockId(2)),
      })))

      expect(tokenOutcome._tag).toBe('Failure')
      if (tokenOutcome._tag === 'Failure') expect(tokenOutcome.failure).toBeInstanceOf(WorldWriteTokenInvalid)
      expect(yield* tokenCoordinator.revision).toBe(0)
      expect((yield* tokenCoordinator.snapshot(ownerA, counterSchema)).state).toStrictEqual({ count: 0 })
    }),
  )

  it.effect('maps stale chunks without an actual revision and chunk-store prepare errors to typed results', () =>
    Effect.gen(function* () {
      const baseRegistry = yield* makeChunkStoreRegistry()
      const baseStore = baseRegistry.forDimension('overworld')
      yield* baseStore.load(chunkCoord(ChunkAxis(0), ChunkAxis(0)))
      const stale: ChunkWriteStale = {
        _tag: 'ChunkWriteStale',
        key: chunkKeyOfPosition(transactionPosition),
        expectedRevision: 0,
      }
      const staleRegistry: ChunkStoreRegistryApi = {
        forDimension: (dimension) => ({
          ...baseRegistry.forDimension(dimension),
          publish: (_prepared: PreparedChunkWrite) => Effect.fail(stale),
        }),
      }
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const staleCoordinator = yield* makeWorldCommitCoordinator({
        world: transactionWorld,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
        chunkStores: staleRegistry,
      })
      const staleOutcome = decodeCommitEffectResult(yield* Effect.result(staleCoordinator.commit({
        expectedRevision: Schema.decodeUnknownSync(WorldRevisionSchema)(0),
        expectedDimensions: [{
          dimension: 'overworld',
          expectedRevision: Schema.decodeUnknownSync(DimensionRevisionSchema)(0),
        }],
        changes: [{ ownerId: ownerA, state: { count: 1 } }],
        blockWrite: makeBlockWrite(blockId(2)),
      })))
      expect(staleOutcome._tag).toBe('Failure')
      if (staleOutcome._tag === 'Failure') {
        expect(staleOutcome.failure._tag).toBe('WorldWriteStale')
        if (staleOutcome.failure._tag === 'WorldWriteStale') {
          expect(staleOutcome.failure.actualRevision).toEqual({ _tag: 'None' })
        }
      }
      expect(yield* staleCoordinator.revision).toBe(0)

      const errors: ReadonlyArray<Readonly<{
        error: ChunkWriteInvalidBatch
        expectedTag: string
      }>> = [
        { error: { _tag: 'ChunkWriteInvalidBatch', reason: 'empty' }, expectedTag: 'WorldWriteInvalidBatch' },
        {
          error: { _tag: 'ChunkWriteInvalidBatch', reason: 'duplicate-position' },
          expectedTag: 'WorldWriteInvalidBatch',
        },
        { error: { _tag: 'ChunkWriteInvalidBatch', reason: 'invalid-edit' }, expectedTag: 'WorldCommitBlockWritePrepareInvalid' },
      ]
      for (const { error, expectedTag } of errors) {
        const invalidRegistry: ChunkStoreRegistryApi = {
          forDimension: (dimension) => ({
            ...baseRegistry.forDimension(dimension),
            prepare: (_edits) => Effect.fail(error),
          }),
        }
        const coordinator = yield* makeWorldCommitCoordinator({
          world: transactionWorld,
          owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
          chunkStores: invalidRegistry,
        })
        const outcome = decodeCommitEffectResult(yield* Effect.result(coordinator.commit({
          expectedRevision: Schema.decodeUnknownSync(WorldRevisionSchema)(0),
          expectedDimensions: [{
            dimension: 'overworld',
            expectedRevision: Schema.decodeUnknownSync(DimensionRevisionSchema)(0),
          }],
          changes: [{ ownerId: ownerA, state: { count: 1 } }],
          blockWrite: makeBlockWrite(blockId(2)),
        })))
        expect(outcome._tag).toBe('Failure')
        if (outcome._tag === 'Failure') expect(outcome.failure._tag).toBe(expectedTag)
        expect(yield* coordinator.revision).toBe(0)
        expect((yield* coordinator.snapshot(ownerA, counterSchema)).state).toEqual({ count: 0 })
      }
    }),
  )

  it.effect('rejects malformed ChunkStore options at coordinator construction', () =>
    Effect.gen(function* () {
      const malformedCoordinator: ReturnType<typeof makeWorldCommitCoordinator> = Reflect.apply(makeWorldCommitCoordinator, undefined, [{
        world: transactionWorld,
        owners: [],
        chunkStores: {},
      }])
      const result = decodeCoordinatorEffectResult(yield* Effect.result(malformedCoordinator))
      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') expect(result.failure._tag).toBe('WorldCommitCoordinatorInvalidOptions')
    }),
  )

  it.effect('allows owner-only reads without ChunkStore and reports missing stores for block observations', () =>
    Effect.gen(function* () {
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const coordinator = yield* makeWorldCommitCoordinator({
        world: transactionWorld,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
      })
      const emptyRead = yield* coordinator.observe(ownerA, counterSchema, [])
      const unavailableRead = decodeCoordinatorEffectResult(yield* Effect.result(coordinator.observe(ownerA, counterSchema, [
        { dimension: 'overworld', position: transactionPosition },
      ])))
      const unknownOwnerRead = decodeCoordinatorEffectResult(yield* Effect.result(coordinator.observe(
        unknownOwner,
        counterSchema,
        [],
      )))
      const unavailableCommit = decodeCommitEffectResult(yield* Effect.result(coordinator.commit({
        expectedRevision: Schema.decodeUnknownSync(WorldRevisionSchema)(0),
        expectedDimensions: [{
          dimension: 'overworld',
          expectedRevision: Schema.decodeUnknownSync(DimensionRevisionSchema)(0),
        }],
        changes: [{ ownerId: ownerA, state: { count: 1 } }],
        blockWrite: makeBlockWrite(blockId(2)),
      })))

      expect(emptyRead).toStrictEqual({
        world: transactionWorld,
        revision: 0,
        state: { count: 0 },
        blocks: [],
      })
      expect(unavailableRead._tag).toBe('Failure')
      if (unavailableRead._tag === 'Failure') expect(unavailableRead.failure).toBeInstanceOf(WorldCommitChunkStoreUnavailable)
      expect(unknownOwnerRead._tag).toBe('Failure')
      if (unknownOwnerRead._tag === 'Failure') expect(unknownOwnerRead.failure).toBeInstanceOf(ReplicatedOwnerUnknown)
      expect(unavailableCommit._tag).toBe('Failure')
      if (unavailableCommit._tag === 'Failure') {
        expect(unavailableCommit.failure).toBeInstanceOf(WorldCommitChunkStoreUnavailable)
      }
    }),
  )

  it.effect('interrupting prepared block preflight leaves its candidate unpublished', () =>
    Effect.gen(function* () {
      const baseRegistry = yield* makeChunkStoreRegistry()
      const store = baseRegistry.forDimension('overworld')
      yield* store.load(chunkCoord(ChunkAxis(0), ChunkAxis(0)))
      yield* store.setBlock(transactionPosition, blockId(1))
      const prepareStarted = yield* Deferred.make<void>()
      const releasePrepare = yield* Deferred.make<void>()
      const registry: ChunkStoreRegistryApi = {
        forDimension: (dimension) => {
          const dimensionStore = baseRegistry.forDimension(dimension)
          return {
            ...dimensionStore,
            prepare: (edits) => Effect.flatMap(dimensionStore.prepare(edits), (prepared) =>
              Effect.andThen(
                Deferred.succeed(prepareStarted, undefined),
                Effect.map(Deferred.await(releasePrepare), () => prepared),
              ),
            ),
          }
        },
      }
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const coordinator = yield* makeWorldCommitCoordinator({
        world: transactionWorld,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
        chunkStores: registry,
      })
      const fiber = yield* Effect.forkChild(coordinator.commit({
        expectedRevision: Schema.decodeUnknownSync(WorldRevisionSchema)(0),
        expectedDimensions: [{
          dimension: 'overworld',
          expectedRevision: Schema.decodeUnknownSync(DimensionRevisionSchema)(0),
        }],
        changes: [{ ownerId: ownerA, state: { count: 1 } }],
        blockWrite: makeBlockWrite(blockId(2)),
      }))
      yield* Deferred.await(prepareStarted)
      yield* Fiber.interrupt(fiber)

      expect(yield* coordinator.revision).toBe(0)
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(0)
      expect((yield* coordinator.snapshot(ownerA, counterSchema)).state).toStrictEqual({ count: 0 })
      expect(yield* store.getBlock(transactionPosition)).toStrictEqual({ _tag: 'Block', block: blockId(1) })
    }),
  )
})
