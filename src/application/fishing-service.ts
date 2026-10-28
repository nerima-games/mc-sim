import {
  ITEM_TYPES,
  EntityIdSchema,
  ProjectileIdSchema,
  SimulationTickSchema,
  StackCount,
  itemIdOf,
} from '@nerima-games/mc-kernel'
import type { EntityId, ItemType, ProjectileId, SimulationTick, WorldId, WorldRevision } from '@nerima-games/mc-kernel'
import { Brand, Context, Effect, Layer, Random, Result, Schema } from 'effect'
import type {
  ReplicatedOwnerId,
} from './replicated-state.js'
import {
  DomainEventBus,
  type DomainEvent,
} from './domain-event-bus.js'
import {
  WorldCommitCoordinator,
  WorldCommitCoordinatorErrorSchema,
  type WorldCommitCoordinatorApi,
  type WorldCommitCoordinatorError,
  type ReplicatedOwnerRegistration,
} from './world-commit-coordinator.js'
import type {
  WorldCommitPlanFragment,
  WorldCommitPlanSnapshot,
} from './world-commit-plan.js'
import {
  worldCommitPlanFragmentSchema,
  worldCommitPlanSnapshotSchema,
} from './world-commit-plan.js'
import {
  FishingStateSchema,
  FishingFailureSchema,
  FishingCancelOutcomeSchema,
  FishingProgressOutcomeSchema,
  FishingElapsedTicksSchema,
  FishingWaitTicksSchema,
  FishingApproachTicksSchema,
  FishingBiteWindowTicksSchema,
  cancelFishingRod,
  advanceFishingRod,
  castFishingRod,
  emptyFishingState,
  fishingLootForSample,
  reelFishingRod,
  registerFishingBite,
  type FishingCancelOutcome,
  type FishingFailure,
  type FishingProgressOutcome,
  type FishingState,
} from '../domain/fishing.js'
import { BrandErrorSchema } from '../domain/inventory.js'
import { SchemaErrorSchema } from '../schema-errors.js'

export type FishingReelOutcome =
  | Readonly<{ _tag: 'NoBite' }>
  | Readonly<{ _tag: 'Caught'; item: ItemType }>

export const FishingServiceErrorSchema: Schema.Codec<FishingServiceError, unknown> = Schema.Union([
  FishingFailureSchema,
  SchemaErrorSchema,
  BrandErrorSchema,
  WorldCommitCoordinatorErrorSchema,
])

export const FishingServiceSnapshotSuccessSchema: Schema.Codec<FishingState, unknown> = FishingStateSchema
export const FishingServiceCastSuccessSchema: Schema.Codec<void, undefined> = Schema.Undefined
export const FishingServiceBiteSuccessSchema: Schema.Codec<void, undefined> = Schema.Undefined
export const FishingServiceReelSuccessSchema: Schema.Codec<FishingReelOutcome, unknown> = Schema.Union([
  Schema.TaggedStruct('NoBite', {}),
  Schema.TaggedStruct('Caught', { item: Schema.Literals(ITEM_TYPES) }),
])

export type FishingLootSample = number & Brand.Brand<'FishingLootSample'>
export const FishingLootSampleSchema: Schema.Codec<FishingLootSample, number> = Schema.Finite
  .check(Schema.makeFilter((sample) => sample >= 0 && sample < 1))
  .pipe(Schema.brand('FishingLootSample'))

export type FishingCastIntent = Readonly<{ actor: EntityId; bobber: ProjectileId }>
export const FishingCastIntentSchema: Schema.Codec<FishingCastIntent, unknown> = Schema.Struct({
  actor: EntityIdSchema,
  bobber: ProjectileIdSchema,
})

export type FishingBiteIntent = Readonly<{ actor: EntityId }>
export const FishingBiteIntentSchema: Schema.Codec<FishingBiteIntent, unknown> = Schema.Struct({
  actor: EntityIdSchema,
})

export type FishingReelIntent = Readonly<{ actor: EntityId; tick: SimulationTick; sample: FishingLootSample }>
export const FishingReelIntentSchema: Schema.Codec<FishingReelIntent, unknown> = Schema.Struct({
  actor: EntityIdSchema,
  tick: SimulationTickSchema,
  sample: FishingLootSampleSchema,
})

export type FishingCancelIntent = Readonly<{ actor: EntityId }>
export const FishingCancelIntentSchema: Schema.Codec<FishingCancelIntent, unknown> = Schema.Struct({
  actor: EntityIdSchema,
})

export type FishingAdvanceIntent = Readonly<{
  actor: EntityId
  elapsedTicks: Schema.Schema.Type<typeof FishingElapsedTicksSchema>
  waitTicks: Schema.Schema.Type<typeof FishingWaitTicksSchema>
  approachTicks: Schema.Schema.Type<typeof FishingApproachTicksSchema>
  biteWindowTicks: Schema.Schema.Type<typeof FishingBiteWindowTicksSchema>
  hasWater: boolean
}>

export const FishingAdvanceIntentSchema: Schema.Codec<FishingAdvanceIntent, unknown> = Schema.Struct({
  actor: EntityIdSchema,
  elapsedTicks: FishingElapsedTicksSchema,
  waitTicks: FishingWaitTicksSchema,
  approachTicks: FishingApproachTicksSchema,
  biteWindowTicks: FishingBiteWindowTicksSchema,
  hasWater: Schema.Boolean,
})

export const FishingServicePlanSnapshotSchema: Schema.Codec<WorldCommitPlanSnapshot<FishingState>, unknown> =
  worldCommitPlanSnapshotSchema(FishingStateSchema)
export const FishingCancelPlanSchema: Schema.Codec<WorldCommitPlanFragment<FishingCancelOutcome>, unknown> =
  worldCommitPlanFragmentSchema(FishingCancelOutcomeSchema)
export const FishingAdvancePlanSchema: Schema.Codec<WorldCommitPlanFragment<FishingProgressOutcome>, unknown> =
  worldCommitPlanFragmentSchema(FishingProgressOutcomeSchema)

export type FishingServiceError = FishingFailure
  | Schema.SchemaError
  | Brand.BrandError
  | WorldCommitCoordinatorError

export type FishingServiceApi = Readonly<{
  snapshot: Effect.Effect<FishingState, FishingServiceError>
  cast: (actor: EntityId, bobber: ProjectileId) => Effect.Effect<void, FishingServiceError>
  bite: (actor: EntityId) => Effect.Effect<void, FishingServiceError>
  reel: (actor: EntityId, tick: SimulationTick) => Effect.Effect<FishingReelOutcome, FishingServiceError>
  cancel: (actor: EntityId) => Effect.Effect<FishingCancelOutcome, FishingServiceError>
  advance: (intent: FishingAdvanceIntent) => Effect.Effect<FishingProgressOutcome, FishingServiceError>
  planCast: (snapshot: WorldCommitPlanSnapshot<FishingState>, intent: FishingCastIntent) => Effect.Effect<WorldCommitPlanFragment<void>, FishingServiceError>
  planBite: (snapshot: WorldCommitPlanSnapshot<FishingState>, intent: FishingBiteIntent) => Effect.Effect<WorldCommitPlanFragment<void>, FishingServiceError>
  planReel: (snapshot: WorldCommitPlanSnapshot<FishingState>, intent: FishingReelIntent) => Effect.Effect<WorldCommitPlanFragment<FishingReelOutcome>, FishingServiceError>
  planCancel: (snapshot: WorldCommitPlanSnapshot<FishingState>, intent: FishingCancelIntent) => Effect.Effect<WorldCommitPlanFragment<FishingCancelOutcome>, FishingServiceError>
  planAdvance: (snapshot: WorldCommitPlanSnapshot<FishingState>, intent: FishingAdvanceIntent) => Effect.Effect<WorldCommitPlanFragment<FishingProgressOutcome>, FishingServiceError>
}>

const FishingServiceBase: Context.ServiceClass<
  FishingService,
  '@nerima-games/mc-sim/FishingService',
  FishingServiceApi
> = Context.Service<FishingService, FishingServiceApi>()('@nerima-games/mc-sim/FishingService')

export class FishingService extends FishingServiceBase {}

export const fishingOwnerRegistration = (
  ownerId: ReplicatedOwnerId,
): ReplicatedOwnerRegistration<typeof FishingStateSchema> => ({
  ownerId,
  schema: FishingStateSchema,
  initialState: emptyFishingState(),
})

const fromResult = <A, E>(result: Result.Result<A, E>): Effect.Effect<A, E> =>
  Result.isSuccess(result) ? Effect.succeed(result.success) : Effect.fail(result.failure)

const asPlanSnapshot = (snapshot: Readonly<{ world: WorldId; revision: WorldRevision; state: FishingState }>): WorldCommitPlanSnapshot<FishingState> => ({
  world: snapshot.world,
  expectedRevision: snapshot.revision,
  expectedDimensions: [],
  state: snapshot.state,
})

const fragment = <A>(
  ownerId: ReplicatedOwnerId,
  snapshot: WorldCommitPlanSnapshot<FishingState>,
  state: FishingState,
  result: A,
  postCommitEvents: ReadonlyArray<DomainEvent> = [],
): WorldCommitPlanFragment<A> => ({
  world: snapshot.world,
  expectedRevision: snapshot.expectedRevision,
  expectedDimensions: snapshot.expectedDimensions,
  changes: [{ ownerId, state }],
  result,
  postCommitEvents,
})

const commitPlan = <A>(
  coordinator: WorldCommitCoordinatorApi,
  events: DomainEventBus['Service'],
  plan: WorldCommitPlanFragment<A>,
): Effect.Effect<A, FishingServiceError> => Effect.flatMap(
  coordinator.commit({
    expectedRevision: plan.expectedRevision,
    expectedDimensions: plan.expectedDimensions,
    changes: plan.changes,
  }),
  () => Effect.as(
    Effect.forEach(plan.postCommitEvents, (event) => events.publish(event), { discard: true }),
    plan.result,
  ),
)

const snapshotForPlan = (
  coordinator: WorldCommitCoordinatorApi,
  ownerId: ReplicatedOwnerId,
): Effect.Effect<WorldCommitPlanSnapshot<FishingState>, FishingServiceError> => Effect.map(
  coordinator.snapshot(ownerId, FishingStateSchema),
  asPlanSnapshot,
)

export const makeFishingService = (
  ownerId: ReplicatedOwnerId,
): Effect.Effect<
  FishingServiceApi,
  never,
  WorldCommitCoordinator | DomainEventBus
> => Effect.gen(function* () {
  const coordinator = yield* WorldCommitCoordinator
  const events = yield* DomainEventBus

  const planCast = (snapshot: WorldCommitPlanSnapshot<FishingState>, rawIntent: FishingCastIntent) => Effect.flatMap(
    Schema.decodeUnknownEffect(FishingCastIntentSchema)(rawIntent),
    ({ actor, bobber }) => fromResult(castFishingRod(snapshot.state, actor, bobber)).pipe(
      Effect.map((state) => fragment(ownerId, snapshot, state, undefined)),
    ),
  )

  const planBite = (snapshot: WorldCommitPlanSnapshot<FishingState>, rawIntent: FishingBiteIntent) => Effect.flatMap(
    Schema.decodeUnknownEffect(FishingBiteIntentSchema)(rawIntent),
    ({ actor }) => fromResult(registerFishingBite(snapshot.state, actor)).pipe(
      Effect.map((state) => fragment(ownerId, snapshot, state, undefined)),
    ),
  )

  const planReel = (
    snapshot: WorldCommitPlanSnapshot<FishingState>,
    rawIntent: FishingReelIntent,
  ): Effect.Effect<WorldCommitPlanFragment<FishingReelOutcome>, FishingServiceError> =>
    Effect.flatMap(Schema.decodeUnknownEffect(FishingReelIntentSchema)(rawIntent), ({ actor, tick, sample }) =>
      Effect.flatMap(fromResult(reelFishingRod(snapshot.state, actor)), (reel) => {
        const reelOutcome = reel.outcome
        if (reelOutcome._tag === 'NoBite') {
          const outcome: FishingReelOutcome = { _tag: 'NoBite' }
          return Effect.succeed(fragment<FishingReelOutcome>(ownerId, snapshot, reel.state, outcome))
        }

        const bobberId = reelOutcome.bobber
        return Effect.flatMap(fromResult(fishingLootForSample(sample)), (item) => Effect.flatMap(
          fromResult(StackCount.result(1)),
          (count) => {
            const event: DomainEvent = {
              _tag: 'ItemPickedUp',
              tick,
              actor,
              source: { _tag: 'Projectile', id: bobberId },
              item: itemIdOf(item),
              count,
            }
            const outcome: FishingReelOutcome = { _tag: 'Caught', item }
            return Effect.succeed(fragment<FishingReelOutcome>(ownerId, snapshot, reel.state, outcome, [event]))
          },
        ))
      }),
    )

  const planCancel = (snapshot: WorldCommitPlanSnapshot<FishingState>, rawIntent: FishingCancelIntent) => Effect.flatMap(
    Schema.decodeUnknownEffect(FishingCancelIntentSchema)(rawIntent),
    ({ actor }) => fromResult(cancelFishingRod(snapshot.state, actor)).pipe(
      Effect.map(({ state, outcome }) => fragment(ownerId, snapshot, state, outcome)),
    ),
  )

  const planAdvance = (snapshot: WorldCommitPlanSnapshot<FishingState>, rawIntent: FishingAdvanceIntent) => Effect.flatMap(
    Schema.decodeUnknownEffect(FishingAdvanceIntentSchema)(rawIntent),
    ({ actor, elapsedTicks, waitTicks, approachTicks, biteWindowTicks, hasWater }) => fromResult(
      advanceFishingRod(snapshot.state, actor, elapsedTicks, waitTicks, approachTicks, biteWindowTicks, hasWater),
    ).pipe(
      Effect.map(({ state, outcome }) => fragment(ownerId, snapshot, state, outcome)),
    ),
  )

  const execute = <A>(
    buildPlan: (snapshot: WorldCommitPlanSnapshot<FishingState>) => Effect.Effect<WorldCommitPlanFragment<A>, FishingServiceError>,
  ): Effect.Effect<A, FishingServiceError> => Effect.flatMap(
    snapshotForPlan(coordinator, ownerId),
    (snapshot) => Effect.flatMap(buildPlan(snapshot), (plan) => commitPlan(coordinator, events, plan)),
  )

  return {
    snapshot: Effect.map(coordinator.snapshot(ownerId, FishingStateSchema), (snapshot) => snapshot.state),
    planCast,
    planBite,
    planReel,
    planCancel,
    planAdvance,
    cast: (actor, bobber) => execute((snapshot) => planCast(snapshot, { actor, bobber })),
    bite: (actor) => execute((snapshot) => planBite(snapshot, { actor })),
    reel: (actor, tick) => Effect.flatMap(Random.next, (sample) => execute((snapshot) =>
      planReel(snapshot, { actor, tick, sample: Brand.nominal<FishingLootSample>()(sample) }),
    )),
    cancel: (actor) => execute((snapshot) => planCancel(snapshot, { actor })),
    advance: (intent) => execute((snapshot) => planAdvance(snapshot, intent)),
  }
})

export const FishingServiceLayer = (
  ownerId: ReplicatedOwnerId,
): Layer.Layer<FishingService, FishingServiceError, WorldCommitCoordinator | DomainEventBus> =>
  Layer.effect(FishingService, makeFishingService(ownerId))
