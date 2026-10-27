import {
  AIR_BLOCK_ID,
  DIMENSIONS,
  DimensionRevisionSchema,
  EntityIdSchema,
  PositionAxis,
  WorldRevisionSchema,
  WorldWriteBatchSchema,
  type Dimension,
  type DimensionRevision,
  type EntityId,
  type WorldRevision,
  position,
} from '@nerima-games/mc-kernel'
import { Context, Effect, Layer, Result, Schema } from 'effect'
import type { YieldableError } from 'effect/Cause'
import { SchemaErrorSchema } from '../schema-errors.js'
import {
  ExplosionPlanSchema,
} from '../domain/explosion.js'
import type {
  ExplosionBlockReader,
  ExplosionEntity,
  ExplosionLimits,
  ExplosionPlan,
} from '../domain/explosion.js'
import {
  DEFAULT_TNT_FUSE_SECS,
  planPrimedTnt,
  primeTnt,
  type PrimedTntState,
  type PrimedTntPlan,
} from '../domain/primed-tnt.js'
import {
  makeReplicatedOwnerId,
  ReplicatedOwnerIdSchema,
  type ReplicatedOwnerId,
  type ReplicatedSnapshot,
} from './replicated-state.js'
import {
  DimensionRevisionConflict,
  WorldRevisionConflict,
  WorldCommitCoordinator,
  WorldCommitCoordinatorErrorSchema,
  type ReplicatedOwnerCandidate,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorApi,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'

const SafeWorldRevisionSchema: Schema.Codec<WorldRevision, number> = WorldRevisionSchema.check(
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
const SafeDimensionRevisionSchema: Schema.Codec<DimensionRevision, number> = DimensionRevisionSchema.check(
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)

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

export const TNT_REPLICATED_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('tnt')

export const INITIAL_TNT_SERVICE_SNAPSHOT: TntServiceSnapshot = { tnts: [] }

type TntServiceFailureFields = Readonly<{ reason: 'tnt-already-primed' | 'unknown-tnt' | 'invalid-input' }>
const TntServiceFailureReasonSchema: Schema.Codec<TntServiceFailureFields['reason'], string> =
  Schema.Literals(['tnt-already-primed', 'unknown-tnt', 'invalid-input'])
const TntServiceFailureFieldsSchema: Readonly<{ reason: typeof TntServiceFailureReasonSchema }> = {
  reason: TntServiceFailureReasonSchema,
}
type TntServiceFailureShape = YieldableError &
  Readonly<{ _tag: 'TntServiceFailure' }> & TntServiceFailureFields
const TntServiceFailureBase: Schema.Class<
  TntServiceFailureShape,
  Schema.TaggedStruct<'TntServiceFailure', typeof TntServiceFailureFieldsSchema>,
  YieldableError
> = Schema.TaggedError<TntServiceFailureShape>()('TntServiceFailure', TntServiceFailureFieldsSchema)
export class TntServiceFailure extends TntServiceFailureBase {}

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
  revision: SafeWorldRevisionSchema,
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

const TntExplosionPlanSchema: Schema.Codec<ExplosionPlan, unknown> = Schema.declare(
  Schema.is(ExplosionPlanSchema),
)

const PrimedTntPlanSchema: Schema.Codec<PrimedTntPlan, unknown> = Schema.Struct({
  before: PrimedTntStateSchema,
  after: PrimedTntStateSchema,
  advancedSecs: Schema.Finite,
  deferredSecs: Schema.Finite,
  explosion: Schema.Union([Schema.Undefined, TntExplosionPlanSchema]),
})

export type TntServiceError =
  | Schema.SchemaError
  | TntServiceFailureShape
  | WorldCommitCoordinatorError

export const TntServiceErrorSchema: Schema.Codec<TntServiceError, unknown> = Schema.Union([
  SchemaErrorSchema,
  TntServiceFailureBase,
  WorldCommitCoordinatorErrorSchema,
])

export type TntDetonationCommitOutcome = Readonly<{ _tag: 'Committed'; revision: WorldRevision }>

export const TntDetonationCommitOutcomeSchema: Schema.Codec<TntDetonationCommitOutcome, unknown> = Schema.Struct({
  _tag: Schema.Literal('Committed'),
  revision: SafeWorldRevisionSchema,
})

type TntDetonationPlanned = Readonly<{
  _tag: 'DetonationPlanned'
  plan: PrimedTntPlan
  explosion: ExplosionPlan
  dimension: Dimension
  id: EntityId
  expectedRevision: WorldRevision
  expectedDimensionRevision: DimensionRevision
  ownerCandidate: Readonly<{ ownerId: ReplicatedOwnerId; state: TntServiceSnapshot }>
}>

const TntOwnerCandidateSchema: Schema.Codec<TntDetonationPlanned['ownerCandidate'], unknown> = Schema.Struct({
  ownerId: ReplicatedOwnerIdSchema,
  state: TntServiceSnapshotSchema,
})

const TntDetonationPlannedSchema: Schema.Codec<TntDetonationPlanned, unknown> = Schema.Struct({
  _tag: Schema.Literal('DetonationPlanned'),
  plan: PrimedTntPlanSchema,
  explosion: TntExplosionPlanSchema,
  dimension: TntDimensionSchema,
  id: EntityIdSchema,
  expectedRevision: SafeWorldRevisionSchema,
  expectedDimensionRevision: SafeDimensionRevisionSchema,
  ownerCandidate: TntOwnerCandidateSchema,
})

export type TntAdvanceOutcome =
  | Readonly<{ _tag: 'FuseAdvanced'; plan: PrimedTntPlan; revision: WorldRevision }>
  | Readonly<{ _tag: 'AlreadyDetonated' }>
  | TntDetonationPlanned

const TntFuseAdvancedOutcomeSchema: Schema.Codec<Extract<TntAdvanceOutcome, { readonly _tag: 'FuseAdvanced' }>, unknown> = Schema.Struct({
  _tag: Schema.Literal('FuseAdvanced'),
  plan: PrimedTntPlanSchema,
  revision: SafeWorldRevisionSchema,
})

const TntAlreadyDetonatedOutcomeSchema: Schema.Codec<Extract<TntAdvanceOutcome, { readonly _tag: 'AlreadyDetonated' }>, unknown> = Schema.Struct({
  _tag: Schema.Literal('AlreadyDetonated'),
})

export const TntAdvanceOutcomeSchema: Schema.Codec<TntAdvanceOutcome, unknown> = Schema.Union([
  TntFuseAdvancedOutcomeSchema,
  TntAlreadyDetonatedOutcomeSchema,
  TntDetonationPlannedSchema,
])

export type TntServiceApi = Readonly<{
  snapshot: Effect.Effect<
    ReplicatedSnapshot<typeof TntServiceSnapshotSchema>,
    Schema.SchemaError | WorldCommitCoordinatorError
  >
  prime: (request: TntPrimeRequest) => Effect.Effect<TntPrimeOutcome, TntServiceError>
  advance: (request: TntAdvanceRequest) => Effect.Effect<TntAdvanceOutcome, TntServiceError>
  commitDetonation: (
    planned: Extract<TntAdvanceOutcome, { readonly _tag: 'DetonationPlanned' }>,
    affectedEntityChanges?: ReadonlyArray<ReplicatedOwnerCandidate>,
  ) => Effect.Effect<TntDetonationCommitOutcome, TntServiceError>
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
          dimension: tnt.dimension,
          id: request.id,
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

    const commitDetonation: TntServiceApi['commitDetonation'] = (planned, affectedEntityChanges = []) =>
      Effect.flatMap(Schema.decodeUnknownEffect(TntDetonationPlannedSchema)(planned), (decoded) =>
      Effect.gen(function* () {
        if (
          decoded.plan.after.kind !== 'detonated' ||
          decoded.plan.explosion === undefined ||
          decoded.ownerCandidate.ownerId !== ownerId ||
          JSON.stringify(decoded.plan.explosion) !== JSON.stringify(decoded.explosion)
        ) {
          return yield* Effect.fail(new TntServiceFailure({ reason: 'invalid-input' }))
        }
        const candidate = yield* Schema.decodeUnknownEffect(TntServiceSnapshotSchema)(decoded.ownerCandidate.state)
        const detonatedTnt = candidate.tnts.find(({ id }) => id === decoded.id)
        if (
          detonatedTnt === undefined ||
          detonatedTnt.dimension !== decoded.dimension ||
          detonatedTnt.state.kind !== 'detonated'
        ) {
          return yield* Effect.fail(new TntServiceFailure({ reason: 'invalid-input' }))
        }

        const blockWrite = yield* Schema.decodeUnknownEffect(WorldWriteBatchSchema)({
          world: coordinator.worldId,
          expectedWorldRevision: decoded.expectedRevision,
          dimension: decoded.dimension,
          expectedDimensionRevision: decoded.expectedDimensionRevision,
          edits: decoded.explosion.destroyedBlocks.map(({ x, y, z }) => ({
            position: { x, y, z },
            block: AIR_BLOCK_ID,
          })),
        })
        const committed = yield* coordinator.commit({
          expectedRevision: decoded.expectedRevision,
          expectedDimensions: [{
            dimension: decoded.dimension,
            expectedRevision: decoded.expectedDimensionRevision,
          }],
          changes: [decoded.ownerCandidate, ...affectedEntityChanges],
          ...(blockWrite.edits.length === 0 ? {} : { blockWrite }),
        })
        return { _tag: 'Committed', revision: committed.revision } as const
      }))

    return {
      snapshot: snapshot(),
      prime,
      advance,
      commitDetonation,
    }
  })

export const TntServiceLayer = (
  ownerId: ReplicatedOwnerId = TNT_REPLICATED_OWNER_ID,
): Layer.Layer<TntService, never, WorldCommitCoordinator> =>
  Layer.effect(TntService, makeTntService(ownerId))
