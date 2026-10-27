import {
  DIMENSIONS,
  EntityIdSchema,
  PositionAxis,
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
import {
  DEFAULT_TNT_FUSE_SECS,
  planPrimedTnt,
  primeTnt,
  type PrimedTntPlan,
  type PrimedTntState,
} from '../domain/primed-tnt.js'
import {
  makeReplicatedOwnerId,
  type ReplicatedOwnerId,
  type ReplicatedSnapshot,
} from './replicated-state.js'
import {
  DimensionRevisionConflict,
  WorldRevisionConflict,
  WorldCommitCoordinator,
  type ReplicatedOwnerCandidate,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorApi,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'

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

type TntServiceFailureReason = 'tnt-already-primed' | 'unknown-tnt' | 'invalid-input'

type TntServiceFailureFields = Readonly<{ reason: TntServiceFailureReason }>

const TntServiceFailureBase: new (
  args: TntServiceFailureFields,
) => YieldableError & { readonly _tag: 'TntServiceFailure' } & TntServiceFailureFields =
  Schema.TaggedError<TntServiceFailure>()('TntServiceFailure', {
    reason: Schema.Literals(['tnt-already-primed', 'unknown-tnt', 'invalid-input']),
  })

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
      ownerCandidate: ReplicatedOwnerCandidate
    }>

export type TntServiceError =
  | Schema.SchemaError
  | TntServiceFailure
  | WorldCommitCoordinatorError

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
