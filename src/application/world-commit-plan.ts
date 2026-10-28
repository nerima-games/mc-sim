import {
  BlockIdSchema,
  DIMENSIONS,
  DimensionIdSchema,
  DimensionRevisionSchema,
  DomainEventSchema,
  WorldIdSchema,
  WorldRevisionSchema,
  WorldWriteBatchSchema,
  blockPositionKeyOf,
} from '@nerima-games/mc-kernel'
import type {
  Dimension,
  DimensionRevision,
  WorldId,
  WorldRevision,
  WorldWriteBatch,
} from '@nerima-games/mc-kernel'
import { Result, Schema } from 'effect'
import type { DomainEvent } from './domain-event-bus.js'
import {
  ReplicatedOwnerIdSchema,
  WorldBlockPositionSchema,
} from './replicated-state.js'
import type { ReplicatedOwnerId } from './replicated-state.js'
import type {
  DimensionRevisionExpectation,
  ReplicatedOwnerCandidate,
  WorldCommitRequest,
} from './world-commit-coordinator.js'

export type WorldCommitPlanFragment<ResultValue> = Readonly<{
  world: WorldId
  expectedRevision: WorldRevision
  expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>
  changes: ReadonlyArray<ReplicatedOwnerCandidate>
  blockEdits?: Readonly<{
    dimension: Dimension
    edits: WorldWriteBatch['edits']
  }>
  result: ResultValue
  postCommitEvents: ReadonlyArray<DomainEvent>
}>

export type WorldCommitPlanSnapshot<State> = Readonly<{
  world: WorldId
  expectedRevision: WorldRevision
  expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>
  state: State
}>

const SafeWorldRevisionSchema: Schema.Codec<WorldRevision, number> = WorldRevisionSchema.check(
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
const SafeDimensionRevisionSchema: Schema.Codec<DimensionRevision, number> = DimensionRevisionSchema.check(
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
const DimensionSchema: Schema.Codec<Dimension> = Schema.Literals(DIMENSIONS)

const DimensionRevisionExpectationSchema: Schema.Struct<{
  readonly dimension: typeof DimensionSchema
  readonly expectedRevision: typeof SafeDimensionRevisionSchema
}> = Schema.Struct({
  dimension: DimensionSchema,
  expectedRevision: SafeDimensionRevisionSchema,
})
const DimensionRevisionExpectationsSchema: Schema.$Array<typeof DimensionRevisionExpectationSchema> =
  Schema.Array(DimensionRevisionExpectationSchema)

const ReplicatedOwnerCandidateSchema: Schema.Codec<ReplicatedOwnerCandidate, unknown> = Schema.Struct({
  ownerId: ReplicatedOwnerIdSchema,
  state: Schema.Unknown,
})
const ReplicatedOwnerCandidatesSchema: Schema.$Array<typeof ReplicatedOwnerCandidateSchema> =
  Schema.Array(ReplicatedOwnerCandidateSchema)

const BlockEditSchema = Schema.Struct({
  position: WorldBlockPositionSchema,
  block: BlockIdSchema,
})

const BlockEditsSchema: Schema.Codec<Readonly<{
  dimension: Dimension
  edits: WorldWriteBatch['edits']
}>, unknown> = Schema.Struct({
  dimension: DimensionSchema,
  edits: Schema.Array(BlockEditSchema),
})
const OptionalBlockEditsSchema: Schema.optionalKey<typeof BlockEditsSchema> = Schema.optionalKey(BlockEditsSchema)
const PostCommitEventsSchema: Schema.$Array<typeof DomainEventSchema> = Schema.Array(DomainEventSchema)

type AnyCodec = Schema.Codec<any, any>
type WorldCommitPlanFragmentFields<ResultSchema extends AnyCodec> = {
  readonly world: typeof WorldIdSchema
  readonly expectedRevision: typeof SafeWorldRevisionSchema
  readonly expectedDimensions: typeof DimensionRevisionExpectationsSchema
  readonly changes: typeof ReplicatedOwnerCandidatesSchema
  readonly blockEdits: typeof OptionalBlockEditsSchema
  readonly result: ResultSchema
  readonly postCommitEvents: typeof PostCommitEventsSchema
}
type WorldCommitPlanSnapshotFields<StateSchema extends AnyCodec> = {
  readonly world: typeof WorldIdSchema
  readonly expectedRevision: typeof SafeWorldRevisionSchema
  readonly expectedDimensions: typeof DimensionRevisionExpectationsSchema
  readonly state: StateSchema
}

export const worldCommitPlanFragmentSchema = <ResultSchema extends AnyCodec>(
  resultSchema: ResultSchema,
): Schema.Struct<WorldCommitPlanFragmentFields<ResultSchema>> => Schema.Struct({
  world: WorldIdSchema,
  expectedRevision: SafeWorldRevisionSchema,
  expectedDimensions: DimensionRevisionExpectationsSchema,
  changes: ReplicatedOwnerCandidatesSchema,
  blockEdits: OptionalBlockEditsSchema,
  result: resultSchema,
  postCommitEvents: PostCommitEventsSchema,
})

export const worldCommitPlanSnapshotSchema = <StateSchema extends AnyCodec>(
  stateSchema: StateSchema,
): Schema.Struct<WorldCommitPlanSnapshotFields<StateSchema>> => Schema.Struct({
  world: WorldIdSchema,
  expectedRevision: SafeWorldRevisionSchema,
  expectedDimensions: DimensionRevisionExpectationsSchema,
  state: stateSchema,
})

const WorldCommitPlanWorldConflictSchema = Schema.Struct({
  _tag: Schema.Literal('WorldCommitPlanWorldConflict'),
  expected: WorldIdSchema,
  actual: WorldIdSchema,
})

const WorldCommitPlanRevisionConflictSchema = Schema.Struct({
  _tag: Schema.Literal('WorldCommitPlanRevisionConflict'),
  expected: SafeWorldRevisionSchema,
  actual: SafeWorldRevisionSchema,
})

const WorldCommitPlanDimensionRevisionConflictSchema = Schema.Struct({
  _tag: Schema.Literal('WorldCommitPlanDimensionRevisionConflict'),
  dimension: DimensionSchema,
  expected: SafeDimensionRevisionSchema,
  actual: SafeDimensionRevisionSchema,
})

const WorldCommitPlanDimensionRevisionMissingSchema = Schema.Struct({
  _tag: Schema.Literal('WorldCommitPlanDimensionRevisionMissing'),
  dimension: DimensionSchema,
})
const WorldCommitPlanDimensionIdInvalidSchema = Schema.Struct({
  _tag: Schema.Literal('WorldCommitPlanDimensionIdInvalid'),
})

const WorldCommitPlanOwnerConflictSchema = Schema.Struct({
  _tag: Schema.Literal('WorldCommitPlanOwnerConflict'),
  ownerId: ReplicatedOwnerIdSchema,
})

const WorldCommitPlanDimensionConflictSchema = Schema.Struct({
  _tag: Schema.Literal('WorldCommitPlanDimensionConflict'),
  dimensions: Schema.Array(DimensionSchema),
})

const WorldCommitPlanBlockConflictSchema = Schema.Struct({
  _tag: Schema.Literal('WorldCommitPlanBlockConflict'),
  dimension: DimensionSchema,
  position: WorldBlockPositionSchema,
})

const WorldCommitPlanEmptySchema = Schema.Struct({
  _tag: Schema.Literal('WorldCommitPlanEmpty'),
})

export type WorldCommitPlanConflict =
  | Readonly<{ _tag: 'WorldCommitPlanWorldConflict'; expected: WorldId; actual: WorldId }>
  | Readonly<{ _tag: 'WorldCommitPlanRevisionConflict'; expected: WorldRevision; actual: WorldRevision }>
  | Readonly<{
      _tag: 'WorldCommitPlanDimensionRevisionConflict'
      dimension: Dimension
      expected: DimensionRevision
      actual: DimensionRevision
    }>
  | Readonly<{ _tag: 'WorldCommitPlanDimensionRevisionMissing'; dimension: Dimension }>
  | Readonly<{ _tag: 'WorldCommitPlanDimensionIdInvalid' }>
  | Readonly<{ _tag: 'WorldCommitPlanOwnerConflict'; ownerId: ReplicatedOwnerId }>
  | Readonly<{ _tag: 'WorldCommitPlanDimensionConflict'; dimensions: ReadonlyArray<Dimension> }>
  | Readonly<{
      _tag: 'WorldCommitPlanBlockConflict'
      dimension: Dimension
      position: Schema.Schema.Type<typeof WorldBlockPositionSchema>
    }>
  | Readonly<{ _tag: 'WorldCommitPlanEmpty' }>

export const WorldCommitPlanConflictSchema: Schema.Codec<WorldCommitPlanConflict, unknown> = Schema.Union([
  WorldCommitPlanWorldConflictSchema,
  WorldCommitPlanRevisionConflictSchema,
  WorldCommitPlanDimensionRevisionConflictSchema,
  WorldCommitPlanDimensionRevisionMissingSchema,
  WorldCommitPlanDimensionIdInvalidSchema,
  WorldCommitPlanOwnerConflictSchema,
  WorldCommitPlanDimensionConflictSchema,
  WorldCommitPlanBlockConflictSchema,
  WorldCommitPlanEmptySchema,
])

export const WorldCommitPlanRequestSchema: Schema.Codec<WorldCommitRequest, unknown> = Schema.Struct({
  expectedRevision: SafeWorldRevisionSchema,
  expectedDimensions: DimensionRevisionExpectationsSchema,
  changes: ReplicatedOwnerCandidatesSchema,
  blockWrite: Schema.optionalKey(WorldWriteBatchSchema),
})

export const WorldCommitPlanMergeResultSchema: Schema.Codec<
  Result.Result<WorldCommitRequest, WorldCommitPlanConflict>,
  unknown
> = Schema.Result(WorldCommitPlanRequestSchema, WorldCommitPlanConflictSchema)

const collectDimensionExpectations = (
  plans: ReadonlyArray<WorldCommitPlanFragment<unknown>>,
): Result.Result<Map<Dimension, DimensionRevision>, WorldCommitPlanConflict> => {
  const dimensions = new Map<Dimension, DimensionRevision>()
  for (const plan of plans) {
    for (const expectation of plan.expectedDimensions) {
      const existingRevision = dimensions.get(expectation.dimension)
      if (existingRevision !== undefined && existingRevision !== expectation.expectedRevision) {
        return Result.fail({
          _tag: 'WorldCommitPlanDimensionRevisionConflict',
          dimension: expectation.dimension,
          expected: existingRevision,
          actual: expectation.expectedRevision,
        })
      }
      dimensions.set(expectation.dimension, expectation.expectedRevision)
    }
  }
  return Result.succeed(dimensions)
}

const collectOwnerChanges = (
  plans: ReadonlyArray<WorldCommitPlanFragment<unknown>>,
): Result.Result<Array<ReplicatedOwnerCandidate>, WorldCommitPlanConflict> => {
  const ownerIds = new Set<ReplicatedOwnerId>()
  const changes: Array<ReplicatedOwnerCandidate> = []
  for (const plan of plans) {
    for (const change of plan.changes) {
      if (ownerIds.has(change.ownerId)) {
        return Result.fail({
          _tag: 'WorldCommitPlanOwnerConflict',
          ownerId: change.ownerId,
        })
      }
      ownerIds.add(change.ownerId)
      changes.push(change)
    }
  }
  return Result.succeed(changes)
}

const collectBlockWrite = (
  plans: ReadonlyArray<WorldCommitPlanFragment<unknown>>,
  first: WorldCommitPlanFragment<unknown>,
  dimensions: ReadonlyMap<Dimension, DimensionRevision>,
): Result.Result<WorldWriteBatch | undefined, WorldCommitPlanConflict> => {
  const blockDimensions: Array<Dimension> = []
  const plannedBlockEdits: Array<Readonly<{
    dimension: Dimension
    edit: WorldWriteBatch['edits'][number]
  }>> = []
  for (const plan of plans) {
    if (plan.blockEdits === undefined) continue
    const { dimension, edits } = plan.blockEdits
    if (!blockDimensions.includes(dimension)) blockDimensions.push(dimension)
    for (const edit of edits) plannedBlockEdits.push({ dimension, edit })
  }

  if (blockDimensions.length > 1) {
    return Result.fail({
      _tag: 'WorldCommitPlanDimensionConflict',
      dimensions: blockDimensions,
    })
  }

  const blockDimension = blockDimensions[0]
  if (blockDimension === undefined) return Result.succeed(undefined)

  const blockPositions = new Set<string>()
  const edits: Array<WorldWriteBatch['edits'][number]> = []
  for (const planned of plannedBlockEdits) {
    const key = blockPositionKeyOf(planned.edit.position)
    if (blockPositions.has(key)) {
      return Result.fail({
        _tag: 'WorldCommitPlanBlockConflict',
        dimension: planned.dimension,
        position: planned.edit.position,
      })
    }
    blockPositions.add(key)
    edits.push(planned.edit)
  }

  const expectedDimensionRevision = dimensions.get(blockDimension)
  if (expectedDimensionRevision === undefined) {
    return Result.fail({
      _tag: 'WorldCommitPlanDimensionRevisionMissing',
      dimension: blockDimension,
    })
  }
  const dimensionId = Schema.decodeUnknownResult(DimensionIdSchema)(blockDimension)
  if (Result.isFailure(dimensionId)) {
    return Result.fail({ _tag: 'WorldCommitPlanDimensionIdInvalid' })
  }
  return Result.succeed({
    world: first.world,
    expectedWorldRevision: first.expectedRevision,
    dimension: dimensionId.success,
    expectedDimensionRevision,
    edits,
  })
}

export const mergeWorldCommitPlans = (
  plans: ReadonlyArray<WorldCommitPlanFragment<unknown>>,
): Result.Result<WorldCommitRequest, WorldCommitPlanConflict> => {
  const first = plans[0]
  if (first === undefined) return Result.fail({ _tag: 'WorldCommitPlanEmpty' })

  for (const plan of plans.slice(1)) {
    if (plan.world !== first.world) {
      return Result.fail({
        _tag: 'WorldCommitPlanWorldConflict',
        expected: first.world,
        actual: plan.world,
      })
    }
    if (plan.expectedRevision !== first.expectedRevision) {
      return Result.fail({
        _tag: 'WorldCommitPlanRevisionConflict',
        expected: first.expectedRevision,
        actual: plan.expectedRevision,
      })
    }
  }

  const dimensionsResult = collectDimensionExpectations(plans)
  if (Result.isFailure(dimensionsResult)) return Result.fail(dimensionsResult.failure)

  const changesResult = collectOwnerChanges(plans)
  if (Result.isFailure(changesResult)) return Result.fail(changesResult.failure)

  const blockWriteResult = collectBlockWrite(plans, first, dimensionsResult.success)
  if (Result.isFailure(blockWriteResult)) return Result.fail(blockWriteResult.failure)

  return Result.succeed({
    expectedRevision: first.expectedRevision,
    expectedDimensions: Array.from(dimensionsResult.success, ([dimension, expectedRevision]) => ({
      dimension,
      expectedRevision,
    })),
    changes: changesResult.success,
    ...(blockWriteResult.success === undefined ? {} : { blockWrite: blockWriteResult.success }),
  })
}
