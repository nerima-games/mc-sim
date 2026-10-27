import {
  DIMENSIONS,
  DimensionRevisionSchema,
  EntityIdSchema,
  PositionAxis,
  type Position,
  WorldRevisionSchema,
  type Dimension,
  type DimensionRevision,
  type EntityId,
  type WorldRevision,
  position,
} from '@nerima-games/mc-kernel'
import { Context, Effect, Layer, Result, Schema } from 'effect'
import type { YieldableError } from 'effect/Cause'
import type {
  ExplosionBlockReader,
  ExplosionEntity,
  ExplosionLimits,
  ExplosionPlan,
} from '../domain/explosion.js'
import { MAX_EXPLOSION_RADIUS } from '../domain/explosion.js'
import {
  DEFAULT_TNT_FUSE_SECS,
  planPrimedTnt,
  primeTnt,
  type PrimedTntPlan,
  type PrimedTntState,
} from '../domain/primed-tnt.js'
import {
  makeReplicatedOwnerId,
  ReplicatedOwnerIdSchema,
  replicatedSnapshotSchema,
  type ReplicatedOwnerId,
  type ReplicatedSnapshot,
} from './replicated-state.js'
import {
  DimensionRevisionConflict,
  WorldRevisionConflict,
  WorldCommitCoordinator,
  WorldCommitCoordinatorErrorSchema,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorApi,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'
import { SchemaErrorSchema } from '../schema-errors.js'

const CenterSchema: Schema.Struct<{
  x: typeof Schema.Finite
  y: typeof Schema.Finite
  z: typeof Schema.Finite
}> = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  z: Schema.Finite,
})

const PrimedTntStateSchema: Schema.Codec<PrimedTntState, unknown> = Schema.Union([
  Schema.Struct({
    kind: Schema.Literals(['primed']),
    remainingFuseSecs: Schema.Finite,
  }),
  Schema.Struct({
    kind: Schema.Literals(['detonated']),
  }),
])

const TntDimensionSchema: Schema.Codec<Dimension, unknown> = Schema.Literals(DIMENSIONS)

const PrimedTntRecordSchema: Schema.Struct<{
  id: typeof EntityIdSchema
  dimension: typeof TntDimensionSchema
  center: typeof CenterSchema
  state: typeof PrimedTntStateSchema
}> = Schema.Struct({
  id: EntityIdSchema,
  dimension: TntDimensionSchema,
  center: CenterSchema,
  state: PrimedTntStateSchema,
})

export type PrimedTntRecord = Schema.Schema.Type<typeof PrimedTntRecordSchema>

export type TntServiceSnapshot = Readonly<{
  tnts: ReadonlyArray<PrimedTntRecord>
}>

export const TntServiceSnapshotSchema: Schema.Codec<
  TntServiceSnapshot,
  Readonly<{ tnts: ReadonlyArray<Schema.Codec.Encoded<typeof PrimedTntRecordSchema>> }>
> = Schema.Struct({
  tnts: Schema.Array(PrimedTntRecordSchema),
})

export const TntServiceSnapshotSuccessSchema: Schema.Codec<
  ReplicatedSnapshot<typeof TntServiceSnapshotSchema>,
  unknown
> = replicatedSnapshotSchema(TntServiceSnapshotSchema)

export type TntServiceSnapshotError = Schema.SchemaError | WorldCommitCoordinatorError
export const TntServiceSnapshotErrorSchema: Schema.Codec<TntServiceSnapshotError, unknown> = Schema.Union([
  SchemaErrorSchema,
  WorldCommitCoordinatorErrorSchema,
])

export const TNT_REPLICATED_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('tnt')

export const INITIAL_TNT_SERVICE_SNAPSHOT: TntServiceSnapshot = { tnts: [] }

type TntServiceFailureReason = 'tnt-already-primed' | 'unknown-tnt' | 'invalid-input'

type TntServiceFailureFields = Readonly<{ reason: TntServiceFailureReason }>

const TntServiceFailureBase: new (
  args: TntServiceFailureFields,
) => YieldableError & { readonly _tag: 'TntServiceFailure' } & TntServiceFailureFields =
  Schema.TaggedError<TntServiceFailure>()('TntServiceFailure', {
    reason: Schema.Literals(['tnt-already-primed', 'unknown-tnt', 'invalid-input']),
  })

export class TntServiceFailure extends TntServiceFailureBase {}

export const TntServiceFailureSchema: Schema.Codec<TntServiceFailure, unknown> = Schema.instanceOf(TntServiceFailure)

export type TntPrimeRequest = Readonly<{
  id: EntityId
  dimension: Dimension
  center: Readonly<{ x: number; y: number; z: number }>
  fuseSecs?: number
  expectedRevision: WorldRevision
  expectedDimensionRevision: DimensionRevision
}>

export type TntPrimeOutcome = Readonly<{ revision: WorldRevision }>

export const TntPrimeOutcomeSchema: Schema.Codec<TntPrimeOutcome, unknown> = Schema.Struct({
  revision: WorldRevisionSchema,
})

export type TntAdvanceRequest = Readonly<{
  id: EntityId
  deltaTimeSecs: number
  expectedRevision: WorldRevision
  expectedDimensionRevision: DimensionRevision
  radius: number
  seed: number
  blocks: ExplosionBlockReader
  entities: ReadonlyArray<ExplosionEntity>
  limits?: Partial<ExplosionLimits>
}>

export type TntAdvanceOutcome =
  | Readonly<{ _tag: 'FuseAdvanced'; plan: PrimedTntPlan; revision: WorldRevision }>
  | Readonly<{ _tag: 'AlreadyDetonated' }>
  | Readonly<{
      _tag: 'DetonationPlanned'
      plan: PrimedTntPlan
      explosion: ExplosionPlan
      expectedRevision: WorldRevision
      expectedDimensionRevision: DimensionRevision
      ownerCandidate: TntOwnerCandidate
    }>

export type TntOwnerCandidate = Readonly<{
  ownerId: ReplicatedOwnerId
  state: TntServiceSnapshot
}>

const TntPositionAxisSchema = Schema.Finite.pipe(Schema.brand('PositionAxis'))
const TntPositionSchema: Schema.Codec<Position, unknown> = Schema.Struct({
  x: TntPositionAxisSchema,
  y: TntPositionAxisSchema,
  z: TntPositionAxisSchema,
})
const TntNonNegativeFiniteSchema = Schema.Finite.check(Schema.makeFilter((value) => value >= 0))
const TntSafeIntegerSchema = Schema.Int.check(Schema.makeFilter((value) => Number.isSafeInteger(value)))
const TntNonNegativeSafeIntegerSchema = Schema.Int.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
)
const TntExplosionPlanSchema: Schema.Codec<ExplosionPlan, unknown> = Schema.Struct({
  center: TntPositionSchema,
  radius: Schema.Finite.check(Schema.makeFilter((value) => value >= 0 && value <= MAX_EXPLOSION_RADIUS)),
  seed: Schema.Finite.check(Schema.makeFilter((value) => Math.abs(value) <= Number.MAX_SAFE_INTEGER)),
  destroyedBlocks: Schema.Array(Schema.Struct({
    x: TntSafeIntegerSchema,
    y: TntSafeIntegerSchema,
    z: TntSafeIntegerSchema,
  })),
  entityEffects: Schema.Array(Schema.Struct({
    id: EntityIdSchema,
    damage: TntNonNegativeFiniteSchema,
    knockback: TntPositionSchema,
    exposure: Schema.Finite.check(Schema.makeFilter((value) => value >= 0 && value <= 1)),
  })),
  visitedBlocks: TntNonNegativeSafeIntegerSchema,
  limits: Schema.Struct({
    maxVisitedBlocks: TntNonNegativeSafeIntegerSchema,
    maxRaySteps: TntNonNegativeSafeIntegerSchema,
    maxAffectedEntities: TntNonNegativeSafeIntegerSchema,
  }),
  truncated: Schema.Boolean,
})

const PrimedTntPlanSchema: Schema.Codec<PrimedTntPlan, unknown> = Schema.Struct({
  before: PrimedTntStateSchema,
  after: PrimedTntStateSchema,
  advancedSecs: Schema.Finite,
  deferredSecs: Schema.Finite,
  explosion: Schema.Union([TntExplosionPlanSchema, Schema.Undefined]),
})

const TntOwnerCandidateSchema: Schema.Codec<TntOwnerCandidate, unknown> = Schema.Struct({
  ownerId: ReplicatedOwnerIdSchema,
  state: TntServiceSnapshotSchema,
})

export const TntAdvanceOutcomeSchema: Schema.Codec<TntAdvanceOutcome, unknown> = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('FuseAdvanced'),
    plan: PrimedTntPlanSchema,
    revision: WorldRevisionSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal('AlreadyDetonated'),
  }),
  Schema.Struct({
    _tag: Schema.Literal('DetonationPlanned'),
    plan: PrimedTntPlanSchema,
    explosion: TntExplosionPlanSchema,
    expectedRevision: WorldRevisionSchema,
    expectedDimensionRevision: DimensionRevisionSchema,
    ownerCandidate: TntOwnerCandidateSchema,
  }),
])

export type TntServiceError =
  | Schema.SchemaError
  | TntServiceFailure
  | WorldCommitCoordinatorError

export const TntServiceErrorSchema: Schema.Codec<TntServiceError, unknown> = Schema.Union([
  SchemaErrorSchema,
  TntServiceFailureSchema,
  WorldCommitCoordinatorErrorSchema,
])

export type TntServiceApi = Readonly<{
  snapshot: Effect.Effect<
    ReplicatedSnapshot<typeof TntServiceSnapshotSchema>,
    Schema.SchemaError | WorldCommitCoordinatorError
  >
  prime: (request: TntPrimeRequest) => Effect.Effect<TntPrimeOutcome, TntServiceError>
  advance: (request: TntAdvanceRequest) => Effect.Effect<TntAdvanceOutcome, TntServiceError>
}>

const TntServiceBase: Context.ServiceClass<
  TntService,
  '@nerima-games/mc-sim/TntService',
  TntServiceApi
> = Context.Service<TntService, TntServiceApi>()('@nerima-games/mc-sim/TntService')

export class TntService extends TntServiceBase {}

export const tntOwnerRegistration = (
  ownerId: ReplicatedOwnerId = TNT_REPLICATED_OWNER_ID,
  initialState: TntServiceSnapshot = INITIAL_TNT_SERVICE_SNAPSHOT,
): ReplicatedOwnerRegistration<typeof TntServiceSnapshotSchema> => ({
  ownerId,
  schema: TntServiceSnapshotSchema,
  initialState,
})

const recordCenter = (center: PrimedTntRecord['center']) =>
  position(PositionAxis(center.x), PositionAxis(center.y), PositionAxis(center.z))

const commitState = (
  coordinator: WorldCommitCoordinatorApi,
  ownerId: ReplicatedOwnerId,
  expectedRevision: WorldRevision,
  dimension: Dimension,
  expectedDimensionRevision: DimensionRevision,
  state: TntServiceSnapshot,
): ReturnType<WorldCommitCoordinatorApi['commit']> => coordinator.commit({
  expectedRevision,
  expectedDimensions: [{ dimension, expectedRevision: expectedDimensionRevision }],
  changes: [{ ownerId, state }],
})

export const makeTntService = (
  ownerId: ReplicatedOwnerId = TNT_REPLICATED_OWNER_ID,
): Effect.Effect<TntServiceApi, never, WorldCommitCoordinator> =>
  Effect.gen(function* () {
    const coordinator = yield* WorldCommitCoordinator

    const snapshot = () => coordinator.snapshot(ownerId, TntServiceSnapshotSchema)

    const prime: TntServiceApi['prime'] = (request) => Effect.gen(function* () {
      const primedState = primeTnt(
        request.fuseSecs === undefined ? DEFAULT_TNT_FUSE_SECS : request.fuseSecs,
      )
      if (Result.isFailure(primedState)) {
        return yield* Effect.fail(new TntServiceFailure({ reason: 'invalid-input' }))
      }
      const current = yield* snapshot()
      if (current.state.tnts.some(({ id }) => id === request.id)) {
        return yield* Effect.fail(new TntServiceFailure({ reason: 'tnt-already-primed' }))
      }

      const next: TntServiceSnapshot = {
        tnts: [
          ...current.state.tnts,
          {
            id: request.id,
            dimension: request.dimension,
            center: request.center,
            state: primedState.success,
          },
        ],
      }
      const committed = yield* commitState(
        coordinator,
        ownerId,
        request.expectedRevision,
        request.dimension,
        request.expectedDimensionRevision,
        next,
      )
      return { revision: committed.revision }
    })

    const advance: TntServiceApi['advance'] = (request) => Effect.gen(function* () {
      const current = yield* snapshot()
      const tnt = current.state.tnts.find(({ id }) => id === request.id)
      if (tnt === undefined) {
        return yield* Effect.fail(new TntServiceFailure({ reason: 'unknown-tnt' }))
      }
      if (tnt.state.kind === 'detonated') return { _tag: 'AlreadyDetonated' } as const

      const actualDimensionRevision = yield* coordinator.dimensionRevision(tnt.dimension)
      if (current.revision !== request.expectedRevision) {
        return yield* Effect.fail(new WorldRevisionConflict({
          expected: request.expectedRevision,
          actual: current.revision,
        }))
      }
      if (actualDimensionRevision !== request.expectedDimensionRevision) {
        return yield* Effect.fail(new DimensionRevisionConflict({
          dimension: tnt.dimension,
          expected: request.expectedDimensionRevision,
          actual: actualDimensionRevision,
        }))
      }

      const planResult = planPrimedTnt({
        state: tnt.state,
        deltaTimeSecs: request.deltaTimeSecs,
        center: recordCenter(tnt.center),
        radius: request.radius,
        seed: request.seed,
        blocks: request.blocks,
        entities: request.entities,
        ...(request.limits === undefined ? {} : { limits: request.limits }),
      })
      if (Result.isFailure(planResult)) {
        return yield* Effect.fail(new TntServiceFailure({ reason: 'invalid-input' }))
      }
      const plan = planResult.success

      if (plan.explosion !== undefined) {
        const next: TntServiceSnapshot = {
          tnts: current.state.tnts.map((record) => record.id === request.id
            ? { ...record, state: plan.after }
            : record),
        }
        return {
          _tag: 'DetonationPlanned',
          plan,
          explosion: plan.explosion,
          expectedRevision: request.expectedRevision,
          expectedDimensionRevision: request.expectedDimensionRevision,
          ownerCandidate: { ownerId, state: next },
        } as const
      }

      const next: TntServiceSnapshot = {
        tnts: current.state.tnts.map((record) => record.id === request.id
          ? { ...record, state: plan.after }
          : record),
      }
      const committed = yield* commitState(
        coordinator,
        ownerId,
        request.expectedRevision,
        tnt.dimension,
        request.expectedDimensionRevision,
        next,
      )
      return { _tag: 'FuseAdvanced', plan, revision: committed.revision } as const
    })

    return {
      snapshot: snapshot(),
      prime,
      advance,
    }
  })

export const TntServiceLayer = (
  ownerId: ReplicatedOwnerId = TNT_REPLICATED_OWNER_ID,
): Layer.Layer<TntService, never, WorldCommitCoordinator> =>
  Layer.effect(TntService, makeTntService(ownerId))
