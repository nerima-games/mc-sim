import { expect, it } from 'vitest'
import { Effect, Result, Schema } from 'effect'
import fc from 'fast-check'
import { BlockIdSchema, BlockPositionSchema, ChunkAxis, DimensionIdSchema, WorldIdSchema } from '@nerima-games/mc-kernel'
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
  ReplicatedBlockChangeSchema,
  WorldCommitCoordinatorErrorSchema,
  ReplicatedOwnerIdSchema,
  WorldCommitResultSchema,
  WorldBlockPositionSchema,
  makeWorldCommitCoordinator,
  replicatedOwnerChangeSchema,
  replicatedWorldDeltaSchema,
} from '../src/index.js'
import { assertResultContract } from './public-property-helpers.js'

const dimension: Dimension = 'overworld'
const world = Schema.decodeUnknownSync(WorldIdSchema)('property-model-world')
const ownerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('property-model-owner')
const ownerStateSchema = Schema.Struct({ value: Schema.Number })
const initialOwnerState = { value: 0 }
const chunk = chunkCoord(ChunkAxis(0), ChunkAxis(0))
const batchDimension = Schema.decodeUnknownSync(DimensionIdSchema)(dimension)

const sourceForDimension = (_dimension: Dimension) =>
  (coord: ChunkCoord) =>
    Effect.succeed({
      blocks: emptyBlocks(),
      biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
      coord,
    })

const chunkStoreLayer = ChunkStoreRegistryLayer(sourceForDimension, ChunkCapacity(2))

const ownerChangeSchema = replicatedOwnerChangeSchema('property-model-owner', ownerStateSchema)
const deltaSchema = replicatedWorldDeltaSchema(ownerChangeSchema)
const commitOutcomeSchema = WorldCommitResultSchema(ownerChangeSchema)

const withoutField = (value: Record<string, unknown>, field: string) => {
  const copy = { ...value }
  delete copy[field]
  return copy
}

const cloneResult = (value: object): Record<string, unknown> =>
  Object.create(Object.getPrototypeOf(value), Object.getOwnPropertyDescriptors(value))

const validDelta = {
  world,
  revision: 1,
  changes: [{ owner: ownerId, state: initialOwnerState }],
  blockChanges: [],
}
const validOwnerChange = { owner: ownerId, state: initialOwnerState }
const validCoordinatorFailure = Schema.decodeUnknownSync(WorldCommitCoordinatorErrorSchema)({
  _tag: 'WorldWriteStale',
  dimension,
  key: '0,0',
  expectedRevision: 0,
  actualRevision: { _tag: 'None' },
})
const validBlockChange = {
  dimension,
  position: Schema.decodeUnknownSync(BlockPositionSchema)({ x: 0, y: 0, z: 0 }),
  before: 0,
  after: 1,
}

it('requires result and sparse block-change fields to be present and non-null', () => {
  const decodeOutcome = Schema.decodeUnknownSync(commitOutcomeSchema)
  const decodeDelta = Schema.decodeUnknownSync(deltaSchema)
  const decodeOwnerChange = Schema.decodeUnknownSync(ownerChangeSchema)
  const decodeBlockChange = Schema.decodeUnknownSync(ReplicatedBlockChangeSchema)

  const success = Result.succeed(validDelta)
  expect(decodeOutcome(success)._tag).toBe('Success')
  const successWithoutPayload = cloneResult(success)
  delete successWithoutPayload['success']
  expect(() => decodeOutcome(successWithoutPayload)).toThrow()
  const successWithNullPayload = cloneResult(success)
  Object.defineProperty(successWithNullPayload, 'success', { value: null, configurable: true })
  expect(() => decodeOutcome(successWithNullPayload)).toThrow()
  const successWithNullTag = cloneResult(success)
  Object.defineProperty(successWithNullTag, '_tag', { value: null, configurable: true })
  expect(() => decodeOutcome(successWithNullTag)).toThrow()

  const failure = Result.fail(validCoordinatorFailure)
  expect(decodeOutcome(failure)._tag).toBe('Failure')
  const failureWithoutPayload = cloneResult(failure)
  delete failureWithoutPayload['failure']
  expect(() => decodeOutcome(failureWithoutPayload)).toThrow()
  const failureWithNullPayload = cloneResult(failure)
  Object.defineProperty(failureWithNullPayload, 'failure', { value: null, configurable: true })
  expect(() => decodeOutcome(failureWithNullPayload)).toThrow()
  const failureWithNullTag = cloneResult(failure)
  Object.defineProperty(failureWithNullTag, '_tag', { value: null, configurable: true })
  expect(() => decodeOutcome(failureWithNullTag)).toThrow()

  for (const field of ['world', 'revision', 'changes', 'blockChanges']) {
    expect(() => decodeDelta(withoutField(validDelta, field))).toThrow()
    expect(() => decodeDelta({ ...validDelta, [field]: null })).toThrow()
  }

  expect(decodeOwnerChange(validOwnerChange)).toEqual(validOwnerChange)
  expect(() => decodeOwnerChange(withoutField(validOwnerChange, 'owner'))).toThrow()
  expect(() => decodeOwnerChange({ ...validOwnerChange, owner: null })).toThrow()
  expect(() => decodeOwnerChange(withoutField(validOwnerChange, 'state'))).toThrow()
  expect(() => decodeOwnerChange({ ...validOwnerChange, state: null })).toThrow()

  const blockPosition = { x: 0, y: 0, z: 0 }
  for (const axis of ['x', 'y', 'z']) {
    expect(() => Schema.decodeUnknownSync(WorldBlockPositionSchema)(withoutField(blockPosition, axis))).toThrow()
    expect(() => Schema.decodeUnknownSync(WorldBlockPositionSchema)({ ...blockPosition, [axis]: null })).toThrow()
  }

  for (const field of ['dimension', 'position', 'before', 'after']) {
    expect(() => decodeBlockChange(withoutField(validBlockChange, field))).toThrow()
    expect(() => decodeBlockChange({ ...validBlockChange, [field]: null })).toThrow()
  }
})

type CommitKind = 'owner-only' | 'block-only' | 'mixed'
type Step = Readonly<{
  kind: CommitKind
  cells: ReadonlyArray<number>
  increment: number
}>
type BlockChange = Readonly<{
  dimension: Dimension
  position: BlockPosition
  before: number
  after: number
}>

const kindSequenceArbitrary: fc.Arbitrary<ReadonlyArray<CommitKind>> = fc
  .tuple(
    fc.shuffledSubarray(['owner-only', 'block-only', 'mixed'] as const, {
      minLength: 3,
      maxLength: 3,
    }),
    fc.array(fc.constantFrom<CommitKind>('owner-only', 'block-only', 'mixed'), {
      maxLength: 12,
    }),
  )
  .map(([requiredKinds, tail]) => [...requiredKinds, ...tail])

const stepPayloadArbitrary = fc.record({
  cells: fc.uniqueArray(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 4 }),
  increment: fc.integer({ min: 1, max: 7 }),
})

const stepsArbitrary: fc.Arbitrary<ReadonlyArray<Step>> = kindSequenceArbitrary.chain((kinds) =>
  fc
    .array(stepPayloadArbitrary, { minLength: kinds.length, maxLength: kinds.length })
    .map((payloads) =>
      kinds.map((kind, index) => ({
        kind,
        cells: payloads[index]!.cells,
        increment: payloads[index]!.increment,
      })),
    ),
)

const positionForCell = (cell: number): BlockPosition =>
  Schema.decodeUnknownSync(BlockPositionSchema)({ x: cell % 2, y: 0, z: Math.floor(cell / 2) })

const positionKey = (value: BlockPosition): string => `${value.x},${value.y},${value.z}`

const sortedBlockChanges = (changes: ReadonlyArray<BlockChange>): ReadonlyArray<BlockChange> =>
  [...changes].sort((left, right) =>
    positionKey(left.position).localeCompare(positionKey(right.position)),
  )

const readChunkBlock = (blocks: ArrayLike<number>, cell: number): number =>
  blocks[blockIndex(cell % 2, 0, Math.floor(cell / 2))]!

const runModelSequence = (steps: ReadonlyArray<Step>) =>
  Effect.gen(function* () {
    const registry = yield* ChunkStoreRegistry
    const store = registry.forDimension(dimension)
    yield* store.load(chunk)

    const coordinator = yield* makeWorldCommitCoordinator({
      world,
      owners: [{ ownerId, schema: ownerStateSchema, initialState: initialOwnerState }],
      dimensions: [dimension],
      chunkStores: registry,
    })

    let modelWorldRevision = 0
    let modelDimensionRevision = 0
    let modelOwnerState = initialOwnerState
    const modelBlocks = new Map<number, number>([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ])

    expect(yield* coordinator.revision).toBe(modelWorldRevision)
    expect(yield* coordinator.dimensionRevision(dimension)).toBe(modelDimensionRevision)

    const initialChunk = yield* store.peek(chunk)
    if (initialChunk === undefined) throw new Error('loaded chunk was not observable')
    for (const cell of [0, 1, 2, 3]) expect(readChunkBlock(initialChunk.blocks, cell)).toBe(0)

    for (const step of steps) {
      const hasOwnerChange = step.kind !== 'block-only'
      const hasBlockWrite = step.kind !== 'owner-only'
      const nextOwnerState = hasOwnerChange
        ? { value: modelOwnerState.value + step.increment }
        : modelOwnerState
      const changes = hasOwnerChange ? [{ ownerId, state: nextOwnerState }] : []

      const editPlans = hasBlockWrite
        ? step.cells.map((cell) => {
            const before = modelBlocks.get(cell) ?? 0
            const after = before + step.increment
            const edit = {
              position: positionForCell(cell),
              block: Schema.decodeUnknownSync(BlockIdSchema)(after),
            }
            return {
              cell,
              edit,
              change: { dimension, position: edit.position, before, after },
            }
          })
        : []
      const edits = editPlans.map(({ edit }) => edit)
      const expectedBlockChanges = editPlans.map(({ change }) => change)

      const blockWrite: WorldWriteBatch | undefined = hasBlockWrite
        ? {
            world,
            expectedWorldRevision: modelWorldRevision as WorldWriteBatch['expectedWorldRevision'],
            dimension: batchDimension,
            expectedDimensionRevision: modelDimensionRevision as WorldWriteBatch['expectedDimensionRevision'],
            edits,
          }
        : undefined

      const request: Parameters<typeof coordinator.commit>[0] = {
        expectedRevision: modelWorldRevision as Parameters<
          typeof coordinator.commit
        >[0]['expectedRevision'],
        expectedDimensions: hasBlockWrite
          ? [
              {
                dimension,
                expectedRevision: modelDimensionRevision as Parameters<
                  typeof coordinator.commit
                >[0]['expectedDimensions'][number]['expectedRevision'],
              },
            ]
          : [],
        changes,
        ...(blockWrite === undefined ? {} : { blockWrite }),
      }

      const outcome = yield* Effect.result(coordinator.commit(request))
      const decodedOutcome = Schema.decodeUnknownSync(commitOutcomeSchema)(outcome)
      assertResultContract(
        'WorldCommitCoordinator.commit',
        () => decodedOutcome,
        deltaSchema,
        WorldCommitCoordinatorErrorSchema,
      )
      if (Result.isFailure(decodedOutcome)) throw decodedOutcome.failure

      const delta = decodedOutcome.success
      modelWorldRevision += 1
      if (hasBlockWrite) modelDimensionRevision += 1
      if (hasOwnerChange) modelOwnerState = nextOwnerState
      const expectedOwnerChanges = hasOwnerChange
        ? [{ owner: ownerId, state: nextOwnerState }]
        : []
      for (const { cell, edit } of editPlans) {
        modelBlocks.set(cell, edit.block)
      }

      expect(delta.world).toBe(world)
      expect(delta.revision).toBe(modelWorldRevision)
      expect(delta.changes).toEqual(expectedOwnerChanges)
      expect(sortedBlockChanges(delta.blockChanges)).toEqual(
        sortedBlockChanges(expectedBlockChanges),
      )
      expect(yield* coordinator.revision).toBe(modelWorldRevision)
      expect(yield* coordinator.dimensionRevision(dimension)).toBe(modelDimensionRevision)

      const ownerSnapshot = yield* coordinator.snapshot(ownerId, ownerStateSchema)
      expect(ownerSnapshot.revision).toBe(modelWorldRevision)
      expect(ownerSnapshot.state).toEqual(modelOwnerState)

      const currentChunk = yield* store.peek(chunk)
      if (currentChunk === undefined) throw new Error('committed chunk was not observable')
      for (const cell of [0, 1, 2, 3]) {
        expect(readChunkBlock(currentChunk.blocks, cell)).toBe(modelBlocks.get(cell))
      }
    }
  }).pipe(Effect.provide(chunkStoreLayer))

it('matches an independent model across randomized owner-only, block-only, and mixed commits', async () => {
  await fc.assert(
    fc.asyncProperty(stepsArbitrary, async (steps) => {
      await Effect.runPromise(runModelSequence(steps))
    }),
    { numRuns: 35 },
  )
})
