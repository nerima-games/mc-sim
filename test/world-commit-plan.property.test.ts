import { expect, it } from 'vitest'
import { Effect, Result, Schema } from 'effect'
import fc from 'fast-check'
import {
  BlockIdSchema,
  BlockPositionSchema,
  ChunkAxis,
  DimensionIdSchema,
  DimensionRevisionSchema,
  WorldIdSchema,
  WorldRevisionSchema,
} from '@nerima-games/mc-kernel'
import type { BlockPosition, Dimension, WorldWriteBatch } from '@nerima-games/mc-kernel'
import type { ChunkCoord } from '@nerima-games/mc-worldgen'
import {
  CHUNK_SIZE_XZ,
  ChunkCapacity,
  ChunkStoreRegistry,
  ChunkStoreRegistryLayer,
  blockIndex,
  chunkCoord,
} from '@nerima-games/mc-worldgen'
import { emptyBlocks } from '@nerima-games/mc-worldgen/testing'
import {
  mergeWorldCommitPlans,
  WorldCommitPlanConflictSchema,
  WorldCommitPlanMergeResultSchema,
  WorldCommitPlanRequestSchema,
  worldCommitPlanFragmentSchema,
  worldCommitPlanSnapshotSchema,
} from '../src/application/world-commit-plan.js'
import type { WorldCommitPlanFragment } from '../src/application/world-commit-plan.js'
import {
  WorldCommitCoordinatorErrorSchema,
  WorldCommitResultSchema,
  makeWorldCommitCoordinator,
} from '../src/application/world-commit-coordinator.js'
import {
  ReplicatedOwnerChangeSchema,
  ReplicatedOwnerIdSchema,
  replicatedWorldDeltaSchema,
} from '../src/application/replicated-state.js'
import type { ReplicatedOwnerCandidate } from '../src/application/world-commit-coordinator.js'

const dimension: Dimension = 'overworld'
const world = Schema.decodeUnknownSync(WorldIdSchema)('plan-property-world')
const ownerA = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('plan-property-owner-a')
const ownerB = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('plan-property-owner-b')
const ownerStateSchema = Schema.Struct({ value: Schema.Int })
const resultSchema = Schema.Struct({ status: Schema.Literal('planned') })
const fragmentSchema = worldCommitPlanFragmentSchema(resultSchema)
const chunk = chunkCoord(ChunkAxis(0), ChunkAxis(0))
const batchDimension = Schema.decodeUnknownSync(DimensionIdSchema)(dimension)
const chunkStoreLayer = ChunkStoreRegistryLayer(
  (_dimension) => (coord: ChunkCoord) => Effect.succeed({
    blocks: emptyBlocks(),
    biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
    coord,
  }),
  ChunkCapacity(2),
)

const makeWorld = (value: number) =>
  Schema.decodeUnknownSync(WorldIdSchema)(`plan-property-world-${value}`)
const makeWorldRevision = (value: number) =>
  Schema.decodeUnknownSync(WorldRevisionSchema)(value)
const makeDimensionRevision = (value: number) =>
  Schema.decodeUnknownSync(DimensionRevisionSchema)(value)
const makeBlock = (value: number) =>
  Schema.decodeUnknownSync(BlockIdSchema)(value)
const position = (x: number, y = 0, z = 0): BlockPosition =>
  Schema.decodeUnknownSync(BlockPositionSchema)({ x, y, z })

const makeCandidate = (ownerId: typeof ownerA, value: number): ReplicatedOwnerCandidate => ({
  ownerId,
  state: { value },
})

const makeFragment = (
  overrides: Partial<WorldCommitPlanFragment<Schema.Schema.Type<typeof resultSchema>>> = {},
): WorldCommitPlanFragment<Schema.Schema.Type<typeof resultSchema>> =>
  Schema.decodeUnknownSync(fragmentSchema)({
    world,
    expectedRevision: makeWorldRevision(0),
    expectedDimensions: [{ dimension, expectedRevision: makeDimensionRevision(0) }],
    changes: [],
    result: { status: 'planned' },
    postCommitEvents: [],
    ...overrides,
  })

const withoutField = (value: object, field: string) => {
  const copy = { ...(value as Record<string, unknown>) }
  delete copy[field]
  return copy
}

const expectConflict = (
  result: ReturnType<typeof mergeWorldCommitPlans>,
) => {
  const decodedResult = Schema.decodeUnknownSync(WorldCommitPlanMergeResultSchema)(result)
  if (Result.isSuccess(decodedResult)) throw new Error('expected a merge conflict')
  return Schema.decodeUnknownSync(WorldCommitPlanConflictSchema)(decodedResult.failure)
}

const readChunkBlock = (blocks: ArrayLike<number>, x: number): number =>
  blocks[blockIndex(x, 0, 0)]!

const assertUnchangedCoordinator = (ownerId: typeof ownerA) =>
  Effect.gen(function* () {
    const registry = yield* ChunkStoreRegistry
    const store = registry.forDimension(dimension)
    yield* store.load(chunk)
    const coordinator = yield* makeWorldCommitCoordinator({
      world,
      owners: [{ ownerId, schema: ownerStateSchema, initialState: { value: 0 } }],
      dimensions: [dimension],
      chunkStores: registry,
    })
    return { coordinator, store }
  }).pipe(Effect.provide(chunkStoreLayer))

it('decodes complete plan fragments and rejects missing or null required fields', () => {
  const fragment = makeFragment({
    blockEdits: {
      dimension,
      edits: [{ position: position(0), block: makeBlock(1) }],
    },
  })
  expect(Schema.decodeUnknownSync(fragmentSchema)(fragment)).toEqual(fragment)

  const fragmentFields = [
    'world',
    'expectedRevision',
    'expectedDimensions',
    'changes',
    'result',
    'postCommitEvents',
  ]
  for (const field of fragmentFields) {
    expect(() => Schema.decodeUnknownSync(fragmentSchema)(withoutField(fragment, field))).toThrow()
    expect(() => Schema.decodeUnknownSync(fragmentSchema)({ ...fragment, [field]: null })).toThrow()
  }
  expect(() => Schema.decodeUnknownSync(fragmentSchema)({ ...fragment, blockEdits: null })).toThrow()

  const dimensionExpectation = { dimension, expectedRevision: makeDimensionRevision(0) }
  expect(() => Schema.decodeUnknownSync(fragmentSchema)({
    ...fragment,
    expectedDimensions: [withoutField(dimensionExpectation, 'dimension')],
  })).toThrow()
  expect(() => Schema.decodeUnknownSync(fragmentSchema)({
    ...fragment,
    expectedDimensions: [{ ...dimensionExpectation, expectedRevision: null }],
  })).toThrow()

  const candidate = makeCandidate(ownerA, 1)
  expect(() => Schema.decodeUnknownSync(fragmentSchema)({
    ...fragment,
    changes: [withoutField(candidate, 'ownerId')],
  })).toThrow()
  const edit = { position: position(0), block: makeBlock(1) }
  expect(() => Schema.decodeUnknownSync(fragmentSchema)({
    ...fragment,
    blockEdits: { dimension, edits: [withoutField(edit, 'position')] },
  })).toThrow()
  expect(() => Schema.decodeUnknownSync(fragmentSchema)({
    ...fragment,
    blockEdits: { dimension, edits: [{ ...edit, block: null }] },
  })).toThrow()
})

it('decodes complete snapshots and rejects missing or null envelope fields', () => {
  const snapshotSchema = worldCommitPlanSnapshotSchema(ownerStateSchema)
  const snapshot = {
    world,
    expectedRevision: makeWorldRevision(0),
    expectedDimensions: [{ dimension, expectedRevision: makeDimensionRevision(0) }],
    state: { value: 7 },
  }
  expect(Schema.decodeUnknownSync(snapshotSchema)(snapshot)).toEqual(snapshot)
  for (const field of ['world', 'expectedRevision', 'expectedDimensions', 'state']) {
    expect(() => Schema.decodeUnknownSync(snapshotSchema)(withoutField(snapshot, field))).toThrow()
    expect(() => Schema.decodeUnknownSync(snapshotSchema)({ ...snapshot, [field]: null })).toThrow()
  }
})

it('decodes complete merge conflicts and rejects missing or null fields for every variant', () => {
  const otherWorld = makeWorld(1)
  const conflicts: ReadonlyArray<Readonly<{ value: Record<string, unknown>; fields: ReadonlyArray<string> }>> = [
    {
      value: { _tag: 'WorldCommitPlanWorldConflict', expected: world, actual: otherWorld },
      fields: ['_tag', 'expected', 'actual'],
    },
    {
      value: {
        _tag: 'WorldCommitPlanRevisionConflict',
        expected: makeWorldRevision(0),
        actual: makeWorldRevision(1),
      },
      fields: ['_tag', 'expected', 'actual'],
    },
    {
      value: {
        _tag: 'WorldCommitPlanDimensionRevisionConflict',
        dimension,
        expected: makeDimensionRevision(0),
        actual: makeDimensionRevision(1),
      },
      fields: ['_tag', 'dimension', 'expected', 'actual'],
    },
    {
      value: { _tag: 'WorldCommitPlanDimensionRevisionMissing', dimension },
      fields: ['_tag', 'dimension'],
    },
    {
      value: { _tag: 'WorldCommitPlanDimensionIdInvalid' },
      fields: ['_tag'],
    },
    {
      value: { _tag: 'WorldCommitPlanOwnerConflict', ownerId: ownerA },
      fields: ['_tag', 'ownerId'],
    },
    {
      value: { _tag: 'WorldCommitPlanDimensionConflict', dimensions: [dimension, 'nether'] },
      fields: ['_tag', 'dimensions'],
    },
    {
      value: { _tag: 'WorldCommitPlanBlockConflict', dimension, position: position(0) },
      fields: ['_tag', 'dimension', 'position'],
    },
    {
      value: { _tag: 'WorldCommitPlanEmpty' },
      fields: ['_tag'],
    },
  ]

  for (const conflict of conflicts) {
    expect(Schema.decodeUnknownSync(WorldCommitPlanConflictSchema)(conflict.value)).toEqual(conflict.value)
    for (const field of conflict.fields) {
      expect(() => Schema.decodeUnknownSync(WorldCommitPlanConflictSchema)(withoutField(conflict.value, field))).toThrow()
      expect(() => Schema.decodeUnknownSync(WorldCommitPlanConflictSchema)({ ...conflict.value, [field]: null })).toThrow()
    }
  }
})

it('decodes complete merged requests and rejects missing or null request fields', () => {
  const request = {
    expectedRevision: makeWorldRevision(0),
    expectedDimensions: [{ dimension, expectedRevision: makeDimensionRevision(0) }],
    changes: [makeCandidate(ownerA, 1)],
  }
  expect(Schema.decodeUnknownSync(WorldCommitPlanRequestSchema)(request)).toEqual(request)
  for (const field of ['expectedRevision', 'expectedDimensions', 'changes']) {
    expect(() => Schema.decodeUnknownSync(WorldCommitPlanRequestSchema)(withoutField(request, field))).toThrow()
    expect(() => Schema.decodeUnknownSync(WorldCommitPlanRequestSchema)({ ...request, [field]: null })).toThrow()
  }
  expect(() => Schema.decodeUnknownSync(WorldCommitPlanRequestSchema)({ ...request, blockWrite: null })).toThrow()

  const blockWrite: WorldWriteBatch = {
    world,
    expectedWorldRevision: makeWorldRevision(0),
    dimension: batchDimension,
    expectedDimensionRevision: makeDimensionRevision(0),
    edits: [{ position: position(0), block: makeBlock(1) }],
  }
  for (const field of ['world', 'expectedWorldRevision', 'dimension', 'expectedDimensionRevision', 'edits']) {
    expect(() => Schema.decodeUnknownSync(WorldCommitPlanRequestSchema)({
      ...request,
      blockWrite: withoutField(blockWrite, field),
    })).toThrow()
    expect(() => Schema.decodeUnknownSync(WorldCommitPlanRequestSchema)({
      ...request,
      blockWrite: { ...blockWrite, [field]: null },
    })).toThrow()
  }
})

it('decodes complete merge results and rejects missing or null result fields', () => {
  const request = {
    expectedRevision: makeWorldRevision(0),
    expectedDimensions: [],
    changes: [makeCandidate(ownerA, 1)],
  }
  const success = Result.succeed(request)
  const failure = Result.fail({ _tag: 'WorldCommitPlanOwnerConflict', ownerId: ownerA })
  const decode = Schema.decodeUnknownSync(WorldCommitPlanMergeResultSchema)
  expect(decode(success)).toEqual(success)
  expect(decode(failure)).toEqual(failure)

  for (const field of ['_tag', 'success']) {
    expect(() => decode(withoutField(success, field))).toThrow()
    expect(() => decode({ ...success, [field]: null })).toThrow()
  }
  for (const field of ['_tag', 'failure']) {
    expect(() => decode(withoutField(failure, field))).toThrow()
    expect(() => decode({ ...failure, [field]: null })).toThrow()
  }
})

it('returns a typed conflict when worlds differ', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 100_000 }), (value) => {
      const conflict = expectConflict(mergeWorldCommitPlans([
        makeFragment({ world: makeWorld(value) }),
        makeFragment({ world: makeWorld(value + 1) }),
      ]))
      expect(conflict).toEqual({
        _tag: 'WorldCommitPlanWorldConflict',
        expected: makeWorld(value),
        actual: makeWorld(value + 1),
      })
    }),
    { numRuns: 30 },
  )
})

it('returns a typed conflict when world revisions differ', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 100_000 }), (value) => {
      const conflict = expectConflict(mergeWorldCommitPlans([
        makeFragment({ expectedRevision: makeWorldRevision(value) }),
        makeFragment({ expectedRevision: makeWorldRevision(value + 1) }),
      ]))
      expect(conflict).toEqual({
        _tag: 'WorldCommitPlanRevisionConflict',
        expected: makeWorldRevision(value),
        actual: makeWorldRevision(value + 1),
      })
    }),
    { numRuns: 30 },
  )
})

it('returns a typed conflict when dimension revisions differ', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 100_000 }), (value) => {
      const conflict = expectConflict(mergeWorldCommitPlans([
        makeFragment({
          expectedDimensions: [{ dimension, expectedRevision: makeDimensionRevision(value) }],
        }),
        makeFragment({
          expectedDimensions: [{ dimension, expectedRevision: makeDimensionRevision(value + 1) }],
        }),
      ]))
      expect(conflict).toEqual({
        _tag: 'WorldCommitPlanDimensionRevisionConflict',
        dimension,
        expected: makeDimensionRevision(value),
        actual: makeDimensionRevision(value + 1),
      })
    }),
    { numRuns: 30 },
  )
})

it('returns a typed conflict when fragments change the same owner', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 100_000 }), (value) => {
      const conflict = expectConflict(mergeWorldCommitPlans([
        makeFragment({ changes: [makeCandidate(ownerA, value)] }),
        makeFragment({ changes: [makeCandidate(ownerA, value + 1)] }),
      ]))
      expect(conflict).toEqual({ _tag: 'WorldCommitPlanOwnerConflict', ownerId: ownerA })
    }),
    { numRuns: 30 },
  )
})

it('returns a dimension conflict for block edits from different dimensions', () => {
  fc.assert(
    fc.property(fc.integer({ min: -100, max: 100 }), (x) => {
      const blockPosition = position(x)
      const conflict = expectConflict(mergeWorldCommitPlans([
        makeFragment({
          expectedDimensions: [
            { dimension, expectedRevision: makeDimensionRevision(0) },
            { dimension: 'nether', expectedRevision: makeDimensionRevision(0) },
          ],
          blockEdits: { dimension, edits: [{ position: blockPosition, block: makeBlock(1) }] },
        }),
        makeFragment({
          expectedDimensions: [{ dimension: 'nether', expectedRevision: makeDimensionRevision(0) }],
          blockEdits: {
            dimension: 'nether',
            edits: [{ position: blockPosition, block: makeBlock(2) }],
          },
        }),
      ]))
      expect(conflict).toEqual({
        _tag: 'WorldCommitPlanDimensionConflict',
        dimensions: [dimension, 'nether'],
      })
    }),
    { numRuns: 30 },
  )
})

it('returns a typed conflict when block edit positions overlap', () => {
  fc.assert(
    fc.property(
      fc.record({
        x: fc.integer({ min: -100, max: 100 }),
        y: fc.integer({ min: 0, max: 100 }),
        z: fc.integer({ min: -100, max: 100 }),
      }),
      ({ x, y, z }) => {
        const blockPosition = position(x, y, z)
        const conflict = expectConflict(mergeWorldCommitPlans([
          makeFragment({ blockEdits: { dimension, edits: [{ position: blockPosition, block: makeBlock(1) }] } }),
          makeFragment({ blockEdits: { dimension, edits: [{ position: blockPosition, block: makeBlock(2) }] } }),
        ]))
        expect(conflict).toEqual({
          _tag: 'WorldCommitPlanBlockConflict',
          dimension,
          position: blockPosition,
        })
      },
    ),
    { numRuns: 30 },
  )
})

it('returns a typed conflict when a runtime block dimension cannot decode as a dimension ID', () => {
  const fragment = makeFragment({
    blockEdits: { dimension, edits: [{ position: position(0), block: makeBlock(1) }] },
  })
  const malformedFragment = new Proxy(fragment, {
    get(target, property, receiver) {
      if (property === 'blockEdits') return { dimension: 'invalid', edits: fragment.blockEdits?.edits }
      if (property === 'expectedDimensions') {
        return [{ dimension: 'invalid', expectedRevision: makeDimensionRevision(0) }]
      }
      return Reflect.get(target, property, receiver)
    },
  })
  const conflict = expectConflict(mergeWorldCommitPlans([malformedFragment]))
  expect(conflict).toEqual({ _tag: 'WorldCommitPlanDimensionIdInvalid' })
})

it('returns a typed conflict when block edits lack a dimension revision expectation', () => {
  fc.assert(
    fc.property(fc.integer({ min: -100, max: 100 }), (x) => {
      const conflict = expectConflict(mergeWorldCommitPlans([
        makeFragment({
          expectedDimensions: [],
          blockEdits: { dimension, edits: [{ position: position(x), block: makeBlock(1) }] },
        }),
      ]))
      expect(conflict).toEqual({ _tag: 'WorldCommitPlanDimensionRevisionMissing', dimension })
    }),
    { numRuns: 30 },
  )
})

it('returns a typed conflict for an empty plan list', () => {
  expect(expectConflict(mergeWorldCommitPlans([]))).toEqual({ _tag: 'WorldCommitPlanEmpty' })
})

it('merges fragments into one commit with all owner and block changes', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        firstValue: fc.integer({ min: 0, max: 100_000 }),
        secondValue: fc.integer({ min: 0, max: 100_000 }),
        firstBlock: fc.integer({ min: 1, max: 65_535 }),
        secondBlock: fc.integer({ min: 1, max: 65_535 }),
      }),
      async ({ firstValue, secondValue, firstBlock, secondBlock }) => {
        const merged = Schema.decodeUnknownSync(WorldCommitPlanMergeResultSchema)(mergeWorldCommitPlans([
          makeFragment({
            changes: [makeCandidate(ownerA, firstValue)],
            blockEdits: { dimension, edits: [{ position: position(0), block: makeBlock(firstBlock) }] },
          }),
          makeFragment({
            changes: [makeCandidate(ownerB, secondValue)],
            blockEdits: { dimension, edits: [{ position: position(1), block: makeBlock(secondBlock) }] },
          }),
        ]))
        if (Result.isFailure(merged)) throw merged.failure
        const request = Schema.decodeUnknownSync(WorldCommitPlanRequestSchema)(merged.success)
        expect(request.expectedDimensions).toEqual([
          { dimension, expectedRevision: makeDimensionRevision(0) },
        ])
        expect(request.changes).toHaveLength(2)
        expect(request.blockWrite?.edits).toHaveLength(2)

        await Effect.runPromise(Effect.gen(function* () {
          const registry = yield* ChunkStoreRegistry
          const store = registry.forDimension(dimension)
          yield* store.load(chunk)
          const coordinator = yield* makeWorldCommitCoordinator({
            world,
            owners: [
              { ownerId: ownerA, schema: ownerStateSchema, initialState: { value: 0 } },
              { ownerId: ownerB, schema: ownerStateSchema, initialState: { value: 0 } },
            ],
            dimensions: [dimension],
            chunkStores: registry,
          })

          const delta = yield* coordinator.commit(request)
          const decodedDelta = Schema.decodeUnknownSync(
            replicatedWorldDeltaSchema(ReplicatedOwnerChangeSchema),
          )(delta)
          expect(decodedDelta.revision).toBe(makeWorldRevision(1))
          expect(decodedDelta.changes).toEqual([
            { owner: ownerA, state: { value: firstValue } },
            { owner: ownerB, state: { value: secondValue } },
          ])
          expect(decodedDelta.blockChanges).toHaveLength(2)
          expect(yield* coordinator.revision).toBe(makeWorldRevision(1))
          expect(yield* coordinator.dimensionRevision(dimension)).toBe(makeDimensionRevision(1))

          const firstSnapshot = yield* coordinator.snapshot(ownerA, ownerStateSchema)
          const secondSnapshot = yield* coordinator.snapshot(ownerB, ownerStateSchema)
          expect(firstSnapshot.state).toEqual({ value: firstValue })
          expect(secondSnapshot.state).toEqual({ value: secondValue })

          const committedChunk = yield* store.peek(chunk)
          if (committedChunk === undefined) throw new Error('committed chunk was not observable')
          expect(readChunkBlock(committedChunk.blocks, 0)).toBe(firstBlock)
          expect(readChunkBlock(committedChunk.blocks, 1)).toBe(secondBlock)
        }).pipe(Effect.provide(chunkStoreLayer)))
      },
    ),
    { numRuns: 25 },
  )
})

it('leaves coordinator state unchanged when merge fails', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 100_000 }), async (value) => {
      await Effect.runPromise(Effect.gen(function* () {
        const { coordinator, store } = yield* assertUnchangedCoordinator(ownerA)
        const before = yield* coordinator.snapshot(ownerA, ownerStateSchema)
        const conflict = expectConflict(mergeWorldCommitPlans([
          makeFragment({
            changes: [makeCandidate(ownerA, value)],
            blockEdits: { dimension, edits: [{ position: position(0), block: makeBlock(1) }] },
          }),
          makeFragment({ changes: [makeCandidate(ownerA, value + 1)] }),
        ]))
        expect(conflict._tag).toBe('WorldCommitPlanOwnerConflict')
        expect(yield* coordinator.revision).toBe(before.revision)
        expect(yield* coordinator.dimensionRevision(dimension)).toBe(makeDimensionRevision(0))
        const after = yield* coordinator.snapshot(ownerA, ownerStateSchema)
        expect(after.state).toEqual(before.state)
        const loadedChunk = yield* store.peek(chunk)
        if (loadedChunk === undefined) throw new Error('initial chunk was not observable')
        expect(readChunkBlock(loadedChunk.blocks, 0)).toBe(0)
      }))
    }),
    { numRuns: 25 },
  )
})

it('leaves owners, blocks, and revisions unchanged when a commit fails', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 65_535 }), async (nextValue) => {
      await Effect.runPromise(Effect.gen(function* () {
        const registry = yield* ChunkStoreRegistry
        const store = registry.forDimension(dimension)
        yield* store.load(chunk)
        const coordinator = yield* makeWorldCommitCoordinator({
          world,
          owners: [{ ownerId: ownerA, schema: ownerStateSchema, initialState: { value: 0 } }],
          dimensions: [dimension],
          chunkStores: registry,
        })
        const outcome = yield* Effect.result(coordinator.commit({
          expectedRevision: makeWorldRevision(1),
          expectedDimensions: [{ dimension, expectedRevision: makeDimensionRevision(0) }],
          changes: [makeCandidate(ownerA, nextValue)],
          blockWrite: {
            world,
            expectedWorldRevision: makeWorldRevision(1),
            dimension: batchDimension,
            expectedDimensionRevision: makeDimensionRevision(0),
            edits: [{ position: position(0), block: makeBlock(nextValue) }],
          },
        }))
        const decodedOutcome = Schema.decodeUnknownSync(
          WorldCommitResultSchema(ReplicatedOwnerChangeSchema),
        )(outcome)
        if (Result.isSuccess(decodedOutcome)) throw new Error('expected a stale revision failure')
        const decodedFailure = Schema.decodeUnknownSync(WorldCommitCoordinatorErrorSchema)(decodedOutcome.failure)
        expect(decodedFailure._tag).toBe('WorldRevisionConflict')

        expect(yield* coordinator.revision).toBe(makeWorldRevision(0))
        expect(yield* coordinator.dimensionRevision(dimension)).toBe(makeDimensionRevision(0))
        const snapshot = yield* coordinator.snapshot(ownerA, ownerStateSchema)
        expect(snapshot.state).toEqual({ value: 0 })
        const loadedChunk = yield* store.peek(chunk)
        if (loadedChunk === undefined) throw new Error('initial chunk was not observable')
        expect(readChunkBlock(loadedChunk.blocks, 0)).toBe(0)
      }).pipe(Effect.provide(chunkStoreLayer)))
    }),
    { numRuns: 25 },
  )
})
