import {
  BlockIdSchema,
  DIMENSIONS,
  DimensionRevisionSchema,
  WorldIdSchema,
  WorldRevisionSchema,
  blockPositionKeyOf,
  WorldWriteBatchSchema,
  WorldWriteChunkUnavailable,
  WorldWriteInvalidBatch,
  chunkKeyOfPosition,
  isChunkKey,
} from '@nerima-games/mc-kernel'
import type { BlockPosition, ChunkKey, Dimension, DimensionRevision, WorldId, WorldRevision, WorldWriteBatch } from '@nerima-games/mc-kernel'
import { CHUNK_HEIGHT } from '@nerima-games/mc-worldgen'
import type { ChunkStoreRegistryApi, ChunkWriteChunkUnavailable, ChunkWriteInvalidBatch, ChunkWriteStale, ChunkWriteTokenInvalid, PreparedChunkWrite } from '@nerima-games/mc-worldgen'
import { Brand, Context, Effect, Layer, Ref, Result, Schema, Semaphore } from 'effect'
import type { YieldableError } from 'effect/Cause'
import { SchemaErrorSchema } from '../schema-errors.js'
import {
  ReplicatedOwnerIdSchema,
  type ReplicatedOwnerChange,
  type ReplicatedOwnerId,
  type ReplicatedSnapshot,
  type ReplicatedWorldDelta,
  type WorldBlockRead,
  type WorldReadSnapshot,
  ReplicatedOwnerChangeSchema,
  WorldBlockPositionSchema,
  replicatedWorldDeltaSchema,
} from './replicated-state.js'

type AnyCodec = Schema.Codec<any, any>

const isAnyCodec = (value: unknown): value is AnyCodec => Schema.isSchema(value)
const ChunkKeySchema: Schema.Codec<ChunkKey, string> = Schema.String.check(Schema.makeFilter(isChunkKey)).pipe(Schema.brand('ChunkKey'))
const SafeWorldRevisionSchema: Schema.Codec<WorldRevision, number> = WorldRevisionSchema.check(
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
const SafeDimensionRevisionSchema: Schema.Codec<DimensionRevision, number> = DimensionRevisionSchema.check(
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
export type ChunkStoreRevision = number & Brand.Brand<'ChunkStoreRevision'>
export const ChunkStoreRevisionSchema: Schema.Codec<ChunkStoreRevision, number> = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER))
  .pipe(Schema.brand('ChunkStoreRevision'))
export type WorldWriteStaleActualRevision = Readonly<
  { _tag: 'None' } | { _tag: 'Some'; value: ChunkStoreRevision }
>
export const WorldWriteStaleActualRevisionSchema: Schema.Codec<WorldWriteStaleActualRevision, Readonly<
  { _tag: 'None' } | { _tag: 'Some'; value: number }
>> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('None') }),
  Schema.Struct({ _tag: Schema.Literal('Some'), value: ChunkStoreRevisionSchema }),
])

type WorldRevisionConflictFields = Readonly<{ expected: WorldRevision; actual: WorldRevision }>
const WorldRevisionConflictFieldsSchema: Readonly<{
  expected: typeof SafeWorldRevisionSchema
  actual: typeof SafeWorldRevisionSchema
}> = {
  expected: SafeWorldRevisionSchema,
  actual: SafeWorldRevisionSchema,
}
type WorldRevisionConflictShape = YieldableError & Readonly<{ _tag: 'WorldRevisionConflict' }> & WorldRevisionConflictFields
const WorldRevisionConflictBase: Schema.Class<
  WorldRevisionConflictShape,
  Schema.TaggedStruct<'WorldRevisionConflict', typeof WorldRevisionConflictFieldsSchema>,
  YieldableError
> = Schema.TaggedError<WorldRevisionConflictShape>()('WorldRevisionConflict', WorldRevisionConflictFieldsSchema)
export class WorldRevisionConflict extends WorldRevisionConflictBase {}

type DimensionRevisionConflictFields = Readonly<{
  dimension: Dimension
  expected: DimensionRevision
  actual: DimensionRevision
}>
const DimensionRevisionConflictFieldsSchema: Readonly<{
  dimension: Schema.Codec<Dimension, string>
  expected: typeof SafeDimensionRevisionSchema
  actual: typeof SafeDimensionRevisionSchema
}> = {
  dimension: Schema.Literals(DIMENSIONS),
  expected: SafeDimensionRevisionSchema,
  actual: SafeDimensionRevisionSchema,
}
type DimensionRevisionConflictShape = YieldableError & Readonly<{ _tag: 'DimensionRevisionConflict' }> & DimensionRevisionConflictFields
const DimensionRevisionConflictBase: Schema.Class<
  DimensionRevisionConflictShape,
  Schema.TaggedStruct<'DimensionRevisionConflict', typeof DimensionRevisionConflictFieldsSchema>,
  YieldableError
> = Schema.TaggedError<DimensionRevisionConflictShape>()('DimensionRevisionConflict', DimensionRevisionConflictFieldsSchema)
export class DimensionRevisionConflict extends DimensionRevisionConflictBase {}

type ReplicatedOwnerFields = Readonly<{ ownerId: ReplicatedOwnerId }>
const ReplicatedOwnerFieldsSchema: Readonly<{ ownerId: typeof ReplicatedOwnerIdSchema }> = { ownerId: ReplicatedOwnerIdSchema }
type ReplicatedOwnerUnknownShape = YieldableError & Readonly<{ _tag: 'ReplicatedOwnerUnknown' }> & ReplicatedOwnerFields
const ReplicatedOwnerUnknownBase: Schema.Class<
  ReplicatedOwnerUnknownShape,
  Schema.TaggedStruct<'ReplicatedOwnerUnknown', typeof ReplicatedOwnerFieldsSchema>,
  YieldableError
> = Schema.TaggedError<ReplicatedOwnerUnknownShape>()('ReplicatedOwnerUnknown', ReplicatedOwnerFieldsSchema)
export class ReplicatedOwnerUnknown extends ReplicatedOwnerUnknownBase {}

type ReplicatedOwnerDuplicateShape = YieldableError & Readonly<{ _tag: 'ReplicatedOwnerDuplicate' }> & ReplicatedOwnerFields
const ReplicatedOwnerDuplicateBase: Schema.Class<
  ReplicatedOwnerDuplicateShape,
  Schema.TaggedStruct<'ReplicatedOwnerDuplicate', typeof ReplicatedOwnerFieldsSchema>,
  YieldableError
> = Schema.TaggedError<ReplicatedOwnerDuplicateShape>()('ReplicatedOwnerDuplicate', ReplicatedOwnerFieldsSchema)
export class ReplicatedOwnerDuplicate extends ReplicatedOwnerDuplicateBase {}

type WorldCommitBlockWriteMismatchFields = Readonly<{ reason: 'world' | 'world-revision' | 'dimension-revision' }>
const WorldCommitBlockWriteMismatchFieldsSchema: Readonly<{
  reason: Schema.Codec<WorldCommitBlockWriteMismatchFields['reason'], string>
}> = {
  reason: Schema.Literals(['world', 'world-revision', 'dimension-revision']),
}
type WorldCommitBlockWriteMismatchShape = YieldableError & Readonly<{ _tag: 'WorldCommitBlockWriteMismatch' }> & WorldCommitBlockWriteMismatchFields
const WorldCommitBlockWriteMismatchBase: Schema.Class<
  WorldCommitBlockWriteMismatchShape,
  Schema.TaggedStruct<'WorldCommitBlockWriteMismatch', typeof WorldCommitBlockWriteMismatchFieldsSchema>,
  YieldableError
> = Schema.TaggedError<WorldCommitBlockWriteMismatchShape>()('WorldCommitBlockWriteMismatch', WorldCommitBlockWriteMismatchFieldsSchema)
export class WorldCommitBlockWriteMismatch extends WorldCommitBlockWriteMismatchBase {}

type WorldCommitEmptyRequestShape = YieldableError & Readonly<{ _tag: 'WorldCommitEmptyRequest' }>
const WorldCommitEmptyRequestFieldsSchema: Readonly<Record<never, never>> = {}
const WorldCommitEmptyRequestBase: Schema.Class<
  WorldCommitEmptyRequestShape,
  Schema.TaggedStruct<'WorldCommitEmptyRequest', typeof WorldCommitEmptyRequestFieldsSchema>,
  YieldableError
> = Schema.TaggedError<WorldCommitEmptyRequestShape>()('WorldCommitEmptyRequest', WorldCommitEmptyRequestFieldsSchema)
export class WorldCommitEmptyRequest extends WorldCommitEmptyRequestBase {}

type WorldCommitBlockWriteInvalidPositionFields = Readonly<{ dimension: Dimension; position: BlockPosition }>
const WorldCommitBlockWriteInvalidPositionFieldsSchema: Readonly<{
  dimension: Schema.Codec<Dimension, string>
  position: typeof WorldBlockPositionSchema
}> = {
  dimension: Schema.Literals(DIMENSIONS),
  position: WorldBlockPositionSchema,
}
type WorldCommitBlockWriteInvalidPositionShape = YieldableError & Readonly<{ _tag: 'WorldCommitBlockWriteInvalidPosition' }> & WorldCommitBlockWriteInvalidPositionFields
const WorldCommitBlockWriteInvalidPositionBase: Schema.Class<
  WorldCommitBlockWriteInvalidPositionShape,
  Schema.TaggedStruct<'WorldCommitBlockWriteInvalidPosition', typeof WorldCommitBlockWriteInvalidPositionFieldsSchema>,
  YieldableError
> = Schema.TaggedError<WorldCommitBlockWriteInvalidPositionShape>()('WorldCommitBlockWriteInvalidPosition', WorldCommitBlockWriteInvalidPositionFieldsSchema)
export class WorldCommitBlockWriteInvalidPosition extends WorldCommitBlockWriteInvalidPositionBase {}

type WorldCommitChunkStoreUnavailableFields = Readonly<{ dimension: Dimension }>
const WorldCommitChunkStoreUnavailableFieldsSchema: Readonly<{ dimension: Schema.Codec<Dimension, string> }> = {
  dimension: Schema.Literals(DIMENSIONS),
}
type WorldCommitChunkStoreUnavailableShape = YieldableError & Readonly<{ _tag: 'WorldCommitChunkStoreUnavailable' }> & WorldCommitChunkStoreUnavailableFields
const WorldCommitChunkStoreUnavailableBase: Schema.Class<
  WorldCommitChunkStoreUnavailableShape,
  Schema.TaggedStruct<'WorldCommitChunkStoreUnavailable', typeof WorldCommitChunkStoreUnavailableFieldsSchema>,
  YieldableError
> = Schema.TaggedError<WorldCommitChunkStoreUnavailableShape>()('WorldCommitChunkStoreUnavailable', WorldCommitChunkStoreUnavailableFieldsSchema)
export class WorldCommitChunkStoreUnavailable extends WorldCommitChunkStoreUnavailableBase {}

type WorldWriteStaleFields = Readonly<{
  dimension: Dimension
  key: ChunkKey
  expectedRevision: ChunkStoreRevision
  actualRevision: WorldWriteStaleActualRevision
}>
const WorldWriteStaleFieldsSchema: Readonly<{
  dimension: Schema.Codec<Dimension, string>
  key: typeof ChunkKeySchema
  expectedRevision: typeof ChunkStoreRevisionSchema
  actualRevision: typeof WorldWriteStaleActualRevisionSchema
}> = {
  dimension: Schema.Literals(DIMENSIONS),
  key: ChunkKeySchema,
  expectedRevision: ChunkStoreRevisionSchema,
  actualRevision: WorldWriteStaleActualRevisionSchema,
}
type WorldWriteStaleShape = YieldableError & Readonly<{ _tag: 'WorldWriteStale' }> & WorldWriteStaleFields
const WorldWriteStaleBase: Schema.Class<
  WorldWriteStaleShape,
  Schema.TaggedStruct<'WorldWriteStale', typeof WorldWriteStaleFieldsSchema>,
  YieldableError
> = Schema.TaggedError<WorldWriteStaleShape>()('WorldWriteStale', WorldWriteStaleFieldsSchema)
export class WorldWriteStale extends WorldWriteStaleBase {}

type WorldWriteTokenInvalidFields = Readonly<{ reason: ChunkWriteTokenInvalid['reason'] }>
const WorldWriteTokenInvalidFieldsSchema: Readonly<{
  reason: Schema.Codec<ChunkWriteTokenInvalid['reason'], string>
}> = {
  reason: Schema.Literals(['foreign_store', 'already_published', 'unknown_token']),
}
type WorldWriteTokenInvalidShape = YieldableError & Readonly<{ _tag: 'WorldWriteTokenInvalid' }> & WorldWriteTokenInvalidFields
const WorldWriteTokenInvalidBase: Schema.Class<
  WorldWriteTokenInvalidShape,
  Schema.TaggedStruct<'WorldWriteTokenInvalid', typeof WorldWriteTokenInvalidFieldsSchema>,
  YieldableError
> = Schema.TaggedError<WorldWriteTokenInvalidShape>()('WorldWriteTokenInvalid', WorldWriteTokenInvalidFieldsSchema)
export class WorldWriteTokenInvalid extends WorldWriteTokenInvalidBase {}

type WorldCommitBlockWritePrepareInvalidFields = Readonly<{
  reason: Exclude<ChunkWriteInvalidBatch['reason'], 'empty' | 'duplicate-position'>
}>
const WorldCommitBlockWritePrepareInvalidFieldsSchema: Readonly<{
  reason: Schema.Codec<WorldCommitBlockWritePrepareInvalidFields['reason'], string>
}> = {
  reason: Schema.Literals(['not-array', 'invalid-edit', 'invalid-position', 'invalid-block-id', 'out-of-world']),
}
type WorldCommitBlockWritePrepareInvalidShape = YieldableError & Readonly<{ _tag: 'WorldCommitBlockWritePrepareInvalid' }> & WorldCommitBlockWritePrepareInvalidFields
const WorldCommitBlockWritePrepareInvalidBase: Schema.Class<
  WorldCommitBlockWritePrepareInvalidShape,
  Schema.TaggedStruct<'WorldCommitBlockWritePrepareInvalid', typeof WorldCommitBlockWritePrepareInvalidFieldsSchema>,
  YieldableError
> = Schema.TaggedError<WorldCommitBlockWritePrepareInvalidShape>()('WorldCommitBlockWritePrepareInvalid', WorldCommitBlockWritePrepareInvalidFieldsSchema)
export class WorldCommitBlockWritePrepareInvalid extends WorldCommitBlockWritePrepareInvalidBase {}

export type ReplicatedOwnerRegistration<Codec extends AnyCodec = AnyCodec> = Readonly<{
  ownerId: ReplicatedOwnerId
  schema: Codec
  initialState: Codec['Type']
}>

export type DimensionRevisionExpectation = Readonly<{
  dimension: Dimension
  expectedRevision: DimensionRevision
}>

export type ReplicatedOwnerCandidate = Readonly<{
  ownerId: ReplicatedOwnerId
  state: unknown
}>

export type WorldCommitRequest = Readonly<{
  expectedRevision: WorldRevision
  expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>
  changes: ReadonlyArray<ReplicatedOwnerCandidate>
  blockWrite?: WorldWriteBatch
}>

const WorldCommitRequestSchema = Schema.Struct({
  expectedRevision: SafeWorldRevisionSchema,
  expectedDimensions: Schema.Array(Schema.Struct({
    dimension: Schema.Literals(DIMENSIONS),
    expectedRevision: SafeDimensionRevisionSchema,
  })),
  changes: Schema.Array(Schema.Struct({
    ownerId: ReplicatedOwnerIdSchema,
    state: Schema.Unknown,
  })),
  blockWrite: Schema.optional(Schema.Unknown),
})

const WorldCommitCoordinatorOptionsSchema = Schema.Struct({
  world: WorldIdSchema,
  owners: Schema.Array(Schema.Struct({
    ownerId: ReplicatedOwnerIdSchema,
    schema: Schema.Unknown,
    initialState: Schema.Unknown,
  })),
  dimensions: Schema.optional(Schema.Array(Schema.Literals(DIMENSIONS))),
  chunkStores: Schema.optional(Schema.Unknown),
})

export type WorldCommitCoordinatorError =
  | Readonly<{ _tag: 'WorldCommitCoordinatorInvalidOptions'; value: unknown }>
  | WorldCommitEmptyRequest
  | Schema.SchemaError
  | WorldRevisionConflict
  | DimensionRevisionConflict
  | ReplicatedOwnerUnknown
  | ReplicatedOwnerDuplicate
  | WorldCommitBlockWriteMismatch
  | WorldCommitBlockWriteInvalidPosition
  | WorldCommitChunkStoreUnavailable
  | WorldWriteChunkUnavailable
  | WorldWriteInvalidBatch
  | WorldWriteStale
  | WorldWriteTokenInvalid
  | WorldCommitBlockWritePrepareInvalid

export const WorldCommitCoordinatorErrorSchema: Schema.Codec<WorldCommitCoordinatorError, unknown> = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('WorldCommitCoordinatorInvalidOptions'),
    value: Schema.Unknown,
  }),
  SchemaErrorSchema,
  WorldRevisionConflict,
  DimensionRevisionConflict,
  ReplicatedOwnerUnknown,
  ReplicatedOwnerDuplicate,
  WorldCommitBlockWriteMismatch,
  WorldCommitEmptyRequest,
  WorldCommitBlockWriteInvalidPosition,
  WorldCommitChunkStoreUnavailable,
  WorldWriteChunkUnavailable,
  WorldWriteInvalidBatch,
  WorldWriteStale,
  WorldWriteTokenInvalid,
  WorldCommitBlockWritePrepareInvalid,
])

export const WorldCommitResultSchema = <Change extends AnyCodec>(
  change: Change,
): Schema.Codec<
  Result.Result<ReplicatedWorldDelta<Schema.Schema.Type<Change>>, WorldCommitCoordinatorError>,
  unknown
> =>
  Schema.Result(replicatedWorldDeltaSchema(change), WorldCommitCoordinatorErrorSchema)

type PreparedOwnerChange = ReplicatedOwnerChange

type CoordinatorState = Readonly<{
  readonly world: WorldId
  readonly revision: WorldRevision
  readonly dimensionRevisions: ReadonlyMap<Dimension, DimensionRevision>
  readonly owners: ReadonlyMap<ReplicatedOwnerId, unknown>
}>

type OwnerRegistry = ReadonlyMap<ReplicatedOwnerId, AnyCodec>

export type WorldCommitCoordinatorApi = Readonly<{
  readonly worldId: WorldId
  readonly snapshot: <Codec extends AnyCodec>(
    ownerId: ReplicatedOwnerId,
    schema: Codec,
  ) => Effect.Effect<
    ReplicatedSnapshot<Codec>,
    Schema.SchemaError | ReplicatedOwnerUnknown,
    Schema.Codec.DecodingServices<Codec>
  >
  readonly observe: <Codec extends AnyCodec>(
    ownerId: ReplicatedOwnerId,
    schema: Codec,
    reads: ReadonlyArray<Readonly<{ dimension: Dimension; position: BlockPosition }>>,
  ) => Effect.Effect<
    WorldReadSnapshot<Codec>,
    Schema.SchemaError | ReplicatedOwnerUnknown | WorldCommitChunkStoreUnavailable,
    Schema.Codec.DecodingServices<Codec>
  >
  readonly revision: Effect.Effect<WorldRevision>
  readonly dimensionRevision: (dimension: Dimension) => Effect.Effect<DimensionRevision>
  readonly commit: (
    request: WorldCommitRequest,
  ) => Effect.Effect<ReplicatedWorldDelta<PreparedOwnerChange>, WorldCommitCoordinatorError>
}>

const WorldCommitCoordinatorBase: Context.ServiceClass<
  WorldCommitCoordinator,
  '@nerima-games/mc-sim/WorldCommitCoordinator',
  WorldCommitCoordinatorApi
> = Context.Service<WorldCommitCoordinator, WorldCommitCoordinatorApi>()(
  '@nerima-games/mc-sim/WorldCommitCoordinator',
)

export class WorldCommitCoordinator extends WorldCommitCoordinatorBase {}

export type WorldCommitCoordinatorOptions = Readonly<{
  world: WorldId
  owners: ReadonlyArray<ReplicatedOwnerRegistration>
  dimensions?: ReadonlyArray<Dimension>
  chunkStores?: ChunkStoreRegistryApi
}>

const makeDimensionRevision = Brand.nominal<DimensionRevision>()
const makeChunkRevision = Brand.nominal<ChunkStoreRevision>()
const defaultDimensions: ReadonlyArray<Dimension> = DIMENSIONS

const repeatedOwnerId = (changes: ReadonlyArray<ReplicatedOwnerCandidate>): ReplicatedOwnerId | undefined => {
  const seen = new Set<ReplicatedOwnerId>()
  for (const change of changes) {
    if (seen.has(change.ownerId)) return change.ownerId
    seen.add(change.ownerId)
  }
  return undefined
}

const WorldBlockReadRequestSchema = Schema.Struct({
  dimension: Schema.Literals(DIMENSIONS),
  position: WorldBlockPositionSchema,
})

const WorldWriteEditsSchema = Schema.Array(Schema.Struct({
  position: WorldBlockPositionSchema,
  block: BlockIdSchema,
}))

const isChunkStoreRegistryApi = (value: unknown): value is ChunkStoreRegistryApi =>
  typeof value === 'object' && value !== null &&
  'forDimension' in value && typeof value.forDimension === 'function'

const repeatedBlockPosition = (edits: WorldWriteBatch['edits']): BlockPosition | undefined => {
  const seen = new Set<string>()
  for (const { position } of edits) {
    const key = blockPositionKeyOf(position)
    if (seen.has(key)) return position
    seen.add(key)
  }
  return undefined
}

const invalidBatchError = (
  dimension: Dimension,
  edits: WorldWriteBatch['edits'],
  error: ChunkWriteInvalidBatch,
): WorldWriteInvalidBatch | WorldCommitBlockWriteInvalidPosition | WorldCommitBlockWritePrepareInvalid => {
  if (error.reason === 'empty' || error.reason === 'duplicate-position') {
    return new WorldWriteInvalidBatch({ reason: error.reason })
  }
  if (error.reason === 'out-of-world') {
    const edit = edits.find(({ position }) => position.y < 0 || position.y >= CHUNK_HEIGHT)
    if (edit !== undefined) return new WorldCommitBlockWriteInvalidPosition({ dimension, position: edit.position })
  }
  return new WorldCommitBlockWritePrepareInvalid({ reason: error.reason })
}

const mapChunkWritePrepareError = (
  dimension: Dimension,
  edits: WorldWriteBatch['edits'],
  error: ChunkWriteInvalidBatch | ChunkWriteChunkUnavailable,
): WorldWriteChunkUnavailable | WorldWriteInvalidBatch | WorldCommitBlockWriteInvalidPosition | WorldCommitBlockWritePrepareInvalid =>
  error._tag === 'ChunkWriteChunkUnavailable'
    ? new WorldWriteChunkUnavailable({ dimension, chunk: chunkKeyOfPosition(error.position) })
    : invalidBatchError(dimension, edits, error)

const mapChunkWritePublishError = (
  dimension: Dimension,
  error: ChunkWriteStale | ChunkWriteTokenInvalid,
): WorldWriteStale | WorldWriteTokenInvalid => {
  if (error._tag === 'ChunkWriteStale') {
    return new WorldWriteStale({
      dimension,
      key: error.key,
      expectedRevision: makeChunkRevision(error.expectedRevision),
      actualRevision: error.actualRevision === undefined
        ? { _tag: 'None' }
        : { _tag: 'Some', value: makeChunkRevision(error.actualRevision) },
    })
  }
  return new WorldWriteTokenInvalid({ reason: error.reason })
}

const blockWriteMismatch = (
  world: WorldId,
  expectedRevision: WorldRevision,
  expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>,
  batch: WorldWriteBatch,
): WorldCommitBlockWriteMismatch | undefined => {
  if (batch.world !== world) return new WorldCommitBlockWriteMismatch({ reason: 'world' })
  if (batch.expectedWorldRevision !== expectedRevision) return new WorldCommitBlockWriteMismatch({ reason: 'world-revision' })
  const dimensionExpectations = expectedDimensions.filter(({ dimension }) => dimension === batch.dimension)
  if (dimensionExpectations.length === 0 || dimensionExpectations.some(({ expectedRevision: expectedDimensionRevision }) =>
    expectedDimensionRevision !== batch.expectedDimensionRevision
  )) {
    return new WorldCommitBlockWriteMismatch({ reason: 'dimension-revision' })
  }
  return undefined
}

const prepareInitialOwner = (registration: ReplicatedOwnerRegistration) =>
  Effect.flatMap(Schema.decodeUnknownEffect(registration.schema)(registration.initialState), (decoded) =>
    Effect.map(Schema.encodeUnknownEffect(registration.schema)(decoded), () => [registration.ownerId, decoded] as const),
  )

const prepareCandidate = (
  candidate: ReplicatedOwnerCandidate,
  registry: OwnerRegistry,
): Effect.Effect<PreparedOwnerChange, Schema.SchemaError | ReplicatedOwnerUnknown> => {
  const schema = registry.get(candidate.ownerId)
  if (schema === undefined) return Effect.fail(new ReplicatedOwnerUnknown({ ownerId: candidate.ownerId }))
  return Effect.flatMap(Schema.decodeUnknownEffect(schema)(candidate.state), (state) =>
    Effect.map(Schema.encodeUnknownEffect(schema)(state), () => ({ owner: candidate.ownerId, state })),
  )
}

type PreparedBlockWrite =
  | Readonly<{ _tag: 'None' }>
  | Readonly<{
      _tag: 'Some'
      batch: WorldWriteBatch
      edits: WorldWriteBatch['edits']
      registry: ChunkStoreRegistryApi
    }>

type PreparedCommitInputs = Readonly<{
  expectedRevision: WorldRevision
  expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>
  changes: ReadonlyArray<ReplicatedOwnerCandidate>
  preparedChanges: ReadonlyArray<PreparedOwnerChange>
  block: PreparedBlockWrite
}>

const prepareBlockWrite = (
  world: WorldId,
  expectedRevision: WorldRevision,
  expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>,
  candidate: unknown,
  chunkStores: ChunkStoreRegistryApi | undefined,
): Effect.Effect<PreparedBlockWrite, WorldCommitCoordinatorError> =>
  Effect.gen(function* () {
    if (candidate === undefined) return { _tag: 'None' }
    const blockWrite = yield* Schema.decodeUnknownEffect(WorldWriteBatchSchema)(candidate)
    const blockEdits = yield* Schema.decodeUnknownEffect(WorldWriteEditsSchema)(blockWrite.edits)
    if (blockEdits.length === 0) return yield* Effect.fail(new WorldWriteInvalidBatch({ reason: 'empty' }))
    if (repeatedBlockPosition(blockEdits) !== undefined) {
      return yield* Effect.fail(new WorldWriteInvalidBatch({ reason: 'duplicate-position' }))
    }
    const outOfWorld = blockEdits.find(({ position }) => position.y < 0 || position.y >= CHUNK_HEIGHT)
    if (outOfWorld !== undefined) {
      return yield* Effect.fail(new WorldCommitBlockWriteInvalidPosition({
        dimension: blockWrite.dimension,
        position: outOfWorld.position,
      }))
    }
    const mismatch = blockWriteMismatch(world, expectedRevision, expectedDimensions, blockWrite)
    if (mismatch !== undefined) return yield* Effect.fail(mismatch)
    if (chunkStores === undefined) {
      return yield* Effect.fail(new WorldCommitChunkStoreUnavailable({ dimension: blockWrite.dimension }))
    }
    return { _tag: 'Some', batch: blockWrite, edits: blockEdits, registry: chunkStores }
  })

const prepareCommitInputs = (
  request: WorldCommitRequest,
  world: WorldId,
  registry: OwnerRegistry,
  chunkStores: ChunkStoreRegistryApi | undefined,
): Effect.Effect<PreparedCommitInputs, WorldCommitCoordinatorError> =>
  Effect.gen(function* () {
    const decodedRequest = yield* Schema.decodeUnknownEffect(WorldCommitRequestSchema)(request)
    const { expectedRevision, expectedDimensions, changes } = decodedRequest
    const duplicateOwner = repeatedOwnerId(changes)
    if (duplicateOwner !== undefined) {
      return yield* Effect.fail(new ReplicatedOwnerDuplicate({ ownerId: duplicateOwner }))
    }
    const preparedChanges = yield* Effect.forEach(changes, (candidate) => prepareCandidate(candidate, registry))
    const block = yield* prepareBlockWrite(
      world,
      expectedRevision,
      expectedDimensions,
      decodedRequest.blockWrite,
      chunkStores,
    )
    if (block._tag === 'None' && changes.length === 0) {
      return yield* Effect.fail(new WorldCommitEmptyRequest({}))
    }
    return { expectedRevision, expectedDimensions, changes, preparedChanges, block }
  })

const revisionConflict = (
  current: CoordinatorState,
  expectedRevision: WorldRevision,
  expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>,
  block: PreparedBlockWrite,
): WorldRevisionConflict | DimensionRevisionConflict | undefined => {
  if (current.revision !== expectedRevision) {
    return new WorldRevisionConflict({ expected: expectedRevision, actual: current.revision })
  }
  for (const expectation of expectedDimensions) {
    const actual = current.dimensionRevisions.get(expectation.dimension) ?? makeDimensionRevision(0)
    if (actual !== expectation.expectedRevision) {
      return new DimensionRevisionConflict({
        dimension: expectation.dimension,
        expected: expectation.expectedRevision,
        actual,
      })
    }
  }
  if (block._tag === 'Some') {
    const expectedBlockRevision = current.dimensionRevisions.get(block.batch.dimension) ?? makeDimensionRevision(0)
    if (expectedBlockRevision !== block.batch.expectedDimensionRevision) {
      return new DimensionRevisionConflict({
        dimension: block.batch.dimension,
        expected: block.batch.expectedDimensionRevision,
        actual: expectedBlockRevision,
      })
    }
  }
  return undefined
}

export const makeWorldCommitCoordinator = (
  options: WorldCommitCoordinatorOptions,
): Effect.Effect<WorldCommitCoordinatorApi, WorldCommitCoordinatorError> =>
  Effect.gen(function* () {
    const decodedOptions = yield* Schema.decodeUnknownEffect(WorldCommitCoordinatorOptionsSchema)(options)
    if (decodedOptions.chunkStores !== undefined && !isChunkStoreRegistryApi(decodedOptions.chunkStores)) {
      return yield* Effect.fail({ _tag: 'WorldCommitCoordinatorInvalidOptions' as const, value: options })
    }

    const registrations: Array<ReplicatedOwnerRegistration> = []
    for (const registration of decodedOptions.owners) {
      if (!isAnyCodec(registration.schema)) {
        return yield* Effect.fail({ _tag: 'WorldCommitCoordinatorInvalidOptions' as const, value: options })
      }
      registrations.push({
        ownerId: registration.ownerId,
        schema: registration.schema,
        initialState: registration.initialState,
      })
    }

    const world = decodedOptions.world
    const chunkStores = isChunkStoreRegistryApi(decodedOptions.chunkStores)
      ? decodedOptions.chunkStores
      : undefined
    const initialRevision = yield* Schema.decodeUnknownEffect(SafeWorldRevisionSchema)(0)
    const initialDimensionRevision = yield* Schema.decodeUnknownEffect(SafeDimensionRevisionSchema)(0)
    const ownerIds = new Set<ReplicatedOwnerId>()
    for (const registration of registrations) {
      if (ownerIds.has(registration.ownerId)) {
        return yield* Effect.fail(new ReplicatedOwnerDuplicate({ ownerId: registration.ownerId }))
      }
      ownerIds.add(registration.ownerId)
    }

    const preparedOwners = yield* Effect.forEach(registrations, prepareInitialOwner)
    const registry = new Map<ReplicatedOwnerId, AnyCodec>()
    for (const registration of registrations) registry.set(registration.ownerId, registration.schema)

    const dimensions = decodedOptions.dimensions ?? defaultDimensions
    const dimensionRevisions = new Map<Dimension, DimensionRevision>()
    for (const dimension of dimensions) dimensionRevisions.set(dimension, initialDimensionRevision)

    const owners = new Map<ReplicatedOwnerId, unknown>(preparedOwners)
    const committed = yield* Ref.make<CoordinatorState>({
      world,
      revision: initialRevision,
      dimensionRevisions,
      owners,
    })
    const semaphore = yield* Semaphore.make(1)

    const snapshot: WorldCommitCoordinatorApi['snapshot'] = (ownerId, schema) =>
      semaphore.withPermit(Effect.gen(function* () {
        const decodedOwnerId = yield* Schema.decodeUnknownEffect(ReplicatedOwnerIdSchema)(ownerId)
        const current = yield* Ref.get(committed)
        const state = current.owners.get(decodedOwnerId)
        if (state === undefined) {
          return yield* Effect.fail(new ReplicatedOwnerUnknown({ ownerId: decodedOwnerId }))
        }
        const decoded = yield* Schema.decodeUnknownEffect(schema)(state)
        return {
          world: current.world,
          revision: current.revision,
          state: decoded,
        }
      }))

    const observe: WorldCommitCoordinatorApi['observe'] = (ownerId, schema, reads) =>
      semaphore.withPermit(Effect.gen(function* () {
        const decodedOwnerId = yield* Schema.decodeUnknownEffect(ReplicatedOwnerIdSchema)(ownerId)
        const decodedReads = yield* Schema.decodeUnknownEffect(Schema.Array(WorldBlockReadRequestSchema))(reads)
        const current = yield* Ref.get(committed)
        const state = current.owners.get(decodedOwnerId)
        if (state === undefined) {
          return yield* Effect.fail(new ReplicatedOwnerUnknown({ ownerId: decodedOwnerId }))
        }
        const decodedState = yield* Schema.decodeUnknownEffect(schema)(state)
        const firstRead = decodedReads[0]
        if (firstRead !== undefined && chunkStores === undefined) {
          return yield* Effect.fail(new WorldCommitChunkStoreUnavailable({ dimension: firstRead.dimension }))
        }

        const blocks: Array<WorldBlockRead> = []
        for (const read of decodedReads) {
          if (chunkStores === undefined) {
            return yield* Effect.fail(new WorldCommitChunkStoreUnavailable({ dimension: read.dimension }))
          }
          const reading = yield* chunkStores.forDimension(read.dimension).getBlock(read.position)
          blocks.push({ ...read, reading })
        }
        return {
          world: current.world,
          revision: current.revision,
          state: decodedState,
          blocks,
        }
      }))

    const commit: WorldCommitCoordinatorApi['commit'] = (request) =>
      semaphore.withPermit(Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
        const inputs = yield* restore(prepareCommitInputs(request, world, registry, chunkStores))
        const { expectedRevision, expectedDimensions, preparedChanges, block } = inputs
        const current = yield* Ref.get(committed)
        const conflict = revisionConflict(current, expectedRevision, expectedDimensions, block)
        if (conflict !== undefined) return yield* Effect.fail(conflict)

        let preparedBlockWrite: Readonly<{
          chunkStore: ReturnType<ChunkStoreRegistryApi['forDimension']>
          dimension: Dimension
          token: PreparedChunkWrite
        }> | undefined
        if (block._tag === 'Some') {
          const chunkStore = block.registry.forDimension(block.batch.dimension)
          const token = yield* restore(chunkStore.prepare(block.edits).pipe(
            Effect.mapError((error) => mapChunkWritePrepareError(block.batch.dimension, block.edits, error)),
          ))
          preparedBlockWrite = { chunkStore, dimension: block.batch.dimension, token }
        }

        const revision = yield* restore(Schema.decodeUnknownEffect(SafeWorldRevisionSchema)(current.revision + 1))
        const nextDimensionRevisions = new Map(current.dimensionRevisions)
        const dimensionsToIncrement = new Set(expectedDimensions.map(({ dimension }) => dimension))
        if (block._tag === 'Some') dimensionsToIncrement.add(block.batch.dimension)
        for (const dimension of dimensionsToIncrement) {
          const actual = nextDimensionRevisions.get(dimension) ?? makeDimensionRevision(0)
          const nextRevision = yield* restore(Schema.decodeUnknownEffect(SafeDimensionRevisionSchema)(actual + 1))
          nextDimensionRevisions.set(dimension, nextRevision)
        }
        const nextOwners = new Map(current.owners)
        for (const change of preparedChanges) nextOwners.set(change.owner, change.state)
        const blockChanges = preparedBlockWrite === undefined
          ? []
          : preparedBlockWrite.token.changes.map(({ position, previous, next }) => ({
              dimension: preparedBlockWrite.dimension,
              position,
              before: previous,
              after: next,
            }))
        const delta: ReplicatedWorldDelta<PreparedOwnerChange> = {
          world: current.world,
          revision,
          changes: preparedChanges,
          blockChanges,
        }
        const nextState: CoordinatorState = {
          world: current.world,
          revision,
          dimensionRevisions: nextDimensionRevisions,
          owners: nextOwners,
        }

        const validatedDelta = yield* restore(Schema.decodeUnknownEffect(
          replicatedWorldDeltaSchema(ReplicatedOwnerChangeSchema),
        )({
          ...delta,
        }))

        if (preparedBlockWrite !== undefined) {
          yield* preparedBlockWrite.chunkStore.publish(preparedBlockWrite.token).pipe(
            Effect.mapError((error) => mapChunkWritePublishError(preparedBlockWrite.dimension, error)),
          )
        }
        yield* Ref.set(committed, nextState)
        return validatedDelta
      })))

    return {
      worldId: world,
      snapshot,
      observe,
      revision: semaphore.withPermit(Effect.map(Ref.get(committed), (current) => current.revision)),
      dimensionRevision: (dimension) => semaphore.withPermit(
        Effect.map(Ref.get(committed), (current) => current.dimensionRevisions.get(dimension) ?? initialDimensionRevision),
      ),
      commit,
    }
  })

export const WorldCommitCoordinatorLayer = (
  options: WorldCommitCoordinatorOptions,
): Layer.Layer<WorldCommitCoordinator, WorldCommitCoordinatorError> =>
  Layer.effect(WorldCommitCoordinator, makeWorldCommitCoordinator(options))
