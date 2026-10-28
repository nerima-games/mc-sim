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
  type Position,
  position,
} from '@nerima-games/mc-kernel'
import { Brand, Context, Effect, Layer, Result, Schema } from 'effect'
import type { YieldableError } from 'effect/Cause'
import { SchemaErrorSchema } from '../schema-errors.js'
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
  type PrimedTntState,
  type PrimedTntPlan,
} from '../domain/primed-tnt.js'
import {
  makeReplicatedOwnerId,
  replicatedSnapshotSchema,
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

const TntPositionAxisSchema: Schema.Codec<Position['x'], number> =
  Schema.Finite.pipe(Schema.brand('PositionAxis'))
const TntPositionSchema: Schema.Codec<Position, Readonly<{ x: number; y: number; z: number }>> = Schema.Struct({
  x: TntPositionAxisSchema,
  y: TntPositionAxisSchema,
  z: TntPositionAxisSchema,
})
const TntSafeIntegerSchema: Schema.Codec<number, number> = Schema.Int.check(
  Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
)
const TntNonNegativeSafeIntegerSchema: Schema.Codec<number, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
)
const TntExplosionPlanSchema: Schema.Codec<ExplosionPlan, unknown> = Schema.Struct({
  center: TntPositionSchema,
  radius: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: MAX_EXPLOSION_RADIUS })),
  seed: Schema.Finite.check(Schema.isBetween({
    minimum: -Number.MAX_SAFE_INTEGER,
    maximum: Number.MAX_SAFE_INTEGER,
  })),
  destroyedBlocks: Schema.Array(Schema.Struct({
    x: TntSafeIntegerSchema,
    y: TntSafeIntegerSchema,
    z: TntSafeIntegerSchema,
  })),
  entityEffects: Schema.Array(Schema.Struct({
    id: EntityIdSchema,
    damage: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
    knockback: TntPositionSchema,
    exposure: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
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

type TntDetonationPlanRevision = number & Brand.Brand<'TntDetonationPlanRevision'>
const TntDetonationPlanRevisionSchema: Schema.Codec<TntDetonationPlanRevision, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
).pipe(Schema.brand('TntDetonationPlanRevision'))

const TntDetonationReferenceSchema: Schema.Struct<{
  id: typeof EntityIdSchema
  planRevision: typeof TntDetonationPlanRevisionSchema
}> = Schema.Struct({
  id: EntityIdSchema,
  planRevision: TntDetonationPlanRevisionSchema,
})
type TntDetonationReference = Schema.Schema.Type<typeof TntDetonationReferenceSchema>

type PendingTntDetonation = Readonly<{
  id: EntityId
  dimension: Dimension
  expectedRevision: WorldRevision
  expectedDimensionRevision: DimensionRevision
  plan: PrimedTntPlan
}>

type TntDetonationPlanned = Readonly<{
  _tag: 'DetonationPlanned'
  plan: PrimedTntPlan
  explosion: ExplosionPlan
  dimension: Dimension
  id: EntityId
  planRevision: TntDetonationPlanRevision
  expectedRevision: WorldRevision
  expectedDimensionRevision: DimensionRevision
}>

const TntDetonationPlannedSchema: Schema.Codec<TntDetonationPlanned, unknown> = Schema.Struct({
  _tag: Schema.Literal('DetonationPlanned'),
  plan: PrimedTntPlanSchema,
  explosion: TntExplosionPlanSchema,
  dimension: TntDimensionSchema,
  id: EntityIdSchema,
  planRevision: TntDetonationPlanRevisionSchema,
  expectedRevision: SafeWorldRevisionSchema,
  expectedDimensionRevision: SafeDimensionRevisionSchema,
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
    reference: TntDetonationReference,
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
    const pendingDetonations = new Map<TntDetonationPlanRevision, PendingTntDetonation>()
    const planRevisionByTnt = new Map<EntityId, TntDetonationPlanRevision>()
    let latestPlanRevision = 0

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
        const planRevision = yield* Schema.decodeUnknownEffect(TntDetonationPlanRevisionSchema)(
          latestPlanRevision + 1,
        )
        latestPlanRevision = planRevision
        const previousPlanRevision = planRevisionByTnt.get(request.id)
        if (previousPlanRevision !== undefined) pendingDetonations.delete(previousPlanRevision)
        const explosion = plan.explosion
        const storedPlan = structuredClone(plan)
        pendingDetonations.set(planRevision, {
          id: request.id,
          dimension: tnt.dimension,
          expectedRevision: request.expectedRevision,
          expectedDimensionRevision: request.expectedDimensionRevision,
          plan: storedPlan,
        })
        planRevisionByTnt.set(request.id, planRevision)
        return {
          _tag: 'DetonationPlanned',
          plan: structuredClone(storedPlan),
          explosion: structuredClone(explosion),
          dimension: tnt.dimension,
          id: request.id,
          planRevision,
          expectedRevision: request.expectedRevision,
          expectedDimensionRevision: request.expectedDimensionRevision,
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

    const commitDetonation: TntServiceApi['commitDetonation'] = (reference, affectedEntityChanges = []) =>
      Effect.flatMap(Schema.decodeUnknownEffect(TntDetonationReferenceSchema)(reference), (decoded) =>
        Effect.gen(function* () {
          const pending = pendingDetonations.get(decoded.planRevision)
          if (
            pending === undefined ||
            pending.id !== decoded.id ||
            pending.plan.after.kind !== 'detonated' ||
            pending.plan.explosion === undefined
          ) {
            return yield* Effect.fail(new TntServiceFailure({ reason: 'invalid-input' }))
          }
          const explosion = pending.plan.explosion
          const terminalState = pending.plan.after
          const blockWrite = yield* Schema.decodeUnknownEffect(WorldWriteBatchSchema)({
            world: coordinator.worldId,
            expectedWorldRevision: pending.expectedRevision,
            dimension: pending.dimension,
            expectedDimensionRevision: pending.expectedDimensionRevision,
            edits: explosion.destroyedBlocks.map(({ x, y, z }) => ({
              position: { x, y, z },
              block: AIR_BLOCK_ID,
            })),
          })
          const committed = yield* coordinator.commitFromSnapshot(
            ownerId,
            TntServiceSnapshotSchema,
            (current) => Effect.gen(function* () {
              if (current.revision !== pending.expectedRevision) {
                return yield* Effect.fail(new WorldRevisionConflict({
                  expected: pending.expectedRevision,
                  actual: current.revision,
                }))
              }
              const target = current.state.tnts.find(({ id }) => id === decoded.id)
              if (
                target === undefined ||
                target.dimension !== pending.dimension ||
                target.state.kind !== 'primed'
              ) {
                return yield* Effect.fail(new TntServiceFailure({ reason: 'invalid-input' }))
              }
              const nextState: TntServiceSnapshot = {
                tnts: current.state.tnts.map((record) => record.id === decoded.id
                  ? { ...record, state: terminalState }
                  : record),
              }
              return {
                expectedRevision: pending.expectedRevision,
                expectedDimensions: [{
                  dimension: pending.dimension,
                  expectedRevision: pending.expectedDimensionRevision,
                }],
                changes: [{ ownerId, state: nextState }, ...affectedEntityChanges],
                ...(blockWrite.edits.length === 0 ? {} : { blockWrite }),
              }
            }),
          )
          pendingDetonations.delete(decoded.planRevision)
          if (planRevisionByTnt.get(decoded.id) === decoded.planRevision) {
            planRevisionByTnt.delete(decoded.id)
          }
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
