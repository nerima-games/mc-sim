import {
  EntityIdSchema,
  ProjectileIdSchema,
  SimulationTickSchema,
  StackCount,
  itemIdOf,
} from '@nerima-games/mc-kernel'
import type { EntityId, ItemType, ProjectileId, SimulationTick } from '@nerima-games/mc-kernel'
import { Brand, Context, Effect, Layer, Random, Result, Schema } from 'effect'
import type {
  ReplicatedOwnerId,
  ReplicatedSnapshot,
} from './replicated-state.js'
import {
  DomainEventBus,
  type DomainEvent,
} from './domain-event-bus.js'
import {
  WorldCommitCoordinator,
  type WorldCommitCoordinatorApi,
  type WorldCommitCoordinatorError,
  type ReplicatedOwnerRegistration,
} from './world-commit-coordinator.js'
import {
  FishingStateSchema,
  castFishingRod,
  emptyFishingState,
  fishingLootForSample,
  reelFishingRod,
  registerFishingBite,
  type FishingFailure,
  type FishingState,
} from '../domain/fishing.js'

export type FishingReelOutcome =
  | Readonly<{ _tag: 'NoBite' }>
  | Readonly<{ _tag: 'Caught'; item: ItemType }>

export type FishingServiceError = FishingFailure
  | Schema.SchemaError
  | Brand.BrandError
  | WorldCommitCoordinatorError

export type FishingServiceApi = Readonly<{
  snapshot: Effect.Effect<FishingState, FishingServiceError>
  cast: (actor: EntityId, bobber: ProjectileId) => Effect.Effect<void, FishingServiceError>
  bite: (actor: EntityId) => Effect.Effect<void, FishingServiceError>
  reel: (actor: EntityId, tick: SimulationTick) => Effect.Effect<FishingReelOutcome, FishingServiceError>
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

const commitState = (
  coordinator: WorldCommitCoordinatorApi,
  ownerId: ReplicatedOwnerId,
  snapshot: ReplicatedSnapshot<typeof FishingStateSchema>,
  state: FishingState,
) => coordinator.commit({
  expectedRevision: snapshot.revision,
  expectedDimensions: [],
  changes: [{ ownerId, state }],
})

const transition = (
  coordinator: WorldCommitCoordinatorApi,
  ownerId: ReplicatedOwnerId,
  update: (state: FishingState) => Result.Result<FishingState, FishingFailure>,
): Effect.Effect<void, FishingServiceError> => Effect.gen(function* () {
  const snapshot = yield* coordinator.snapshot(ownerId, FishingStateSchema)
  const state = yield* fromResult(update(snapshot.state))
  yield* commitState(coordinator, ownerId, snapshot, state)
})

export const makeFishingService = (
  ownerId: ReplicatedOwnerId,
): Effect.Effect<
  FishingServiceApi,
  FishingServiceError,
  WorldCommitCoordinator | DomainEventBus
> => Effect.gen(function* () {
  const coordinator = yield* WorldCommitCoordinator
  const events = yield* DomainEventBus

  return {
    snapshot: Effect.map(
      coordinator.snapshot(ownerId, FishingStateSchema),
      (snapshot) => snapshot.state,
    ),
    cast: (actor, bobber) => Effect.gen(function* () {
      const validActor = yield* Schema.decodeUnknownEffect(EntityIdSchema)(actor)
      const validBobber = yield* Schema.decodeUnknownEffect(ProjectileIdSchema)(bobber)
      yield* transition(
        coordinator,
        ownerId,
        (state) => castFishingRod(state, validActor, validBobber),
      )
    }),
    bite: (actor) => Effect.gen(function* () {
      const validActor = yield* Schema.decodeUnknownEffect(EntityIdSchema)(actor)
      yield* transition(
        coordinator,
        ownerId,
        (state) => registerFishingBite(state, validActor),
      )
    }),
    reel: (actor, tick) => Effect.gen(function* () {
      const validActor = yield* Schema.decodeUnknownEffect(EntityIdSchema)(actor)
      const validTick = yield* Schema.decodeUnknownEffect(SimulationTickSchema)(tick)
      const snapshot = yield* coordinator.snapshot(ownerId, FishingStateSchema)
      const plan = yield* fromResult(reelFishingRod(snapshot.state, validActor))
      if (plan.outcome._tag === 'NoBite') {
        yield* commitState(coordinator, ownerId, snapshot, plan.state)
        return { _tag: 'NoBite' } as const
      }

      const sample = yield* Random.next
      const item = yield* fromResult(fishingLootForSample(sample))
      const count = yield* fromResult(StackCount.result(1))
      yield* commitState(coordinator, ownerId, snapshot, plan.state)

      const event: DomainEvent = {
        _tag: 'ItemPickedUp',
        tick: validTick,
        actor: validActor,
        source: { _tag: 'Projectile', id: plan.outcome.bobber },
        item: itemIdOf(item),
        count,
      }
      yield* events.publish(event)
      return { _tag: 'Caught', item } as const
    }),
  }
})

export const FishingServiceLayer = (
  ownerId: ReplicatedOwnerId,
): Layer.Layer<FishingService, FishingServiceError, WorldCommitCoordinator | DomainEventBus> =>
  Layer.effect(FishingService, makeFishingService(ownerId))
