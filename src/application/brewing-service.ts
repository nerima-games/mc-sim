import { Context, Effect, Layer, Result, Schema } from 'effect'
import type { ItemStack } from '@nerima-games/mc-kernel'
import {
  addBrewingFuel,
  advanceBrewing,
  brewingState,
  emptyBrewingState,
  setBrewingBottle,
  setBrewingIngredient,
  validateBrewingSnapshot,
  BrewingFailureSchema,
  BrewingStateSchema,
  type BrewingFailure,
  type BrewingOutcome,
  type BrewingState,
} from '../domain/brewing.js'
import { SchemaErrorSchema } from '../schema-errors.js'
import type { ReplicatedOwnerId } from './replicated-state.js'
import {
  type ReplicatedOwnerRegistration,
  WorldCommitCoordinatorErrorSchema,
  WorldCommitCoordinator,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'

export const BrewingServiceStateSchema: Schema.Codec<BrewingState, unknown> =
  BrewingStateSchema

export type BrewingServiceError =
  | BrewingFailure
  | Schema.SchemaError
  | WorldCommitCoordinatorError

export const BrewingServiceErrorSchema: Schema.Schema<BrewingServiceError> = Schema.Union([
  BrewingFailureSchema,
  SchemaErrorSchema,
  WorldCommitCoordinatorErrorSchema,
])

export type BrewingServiceApi = {
  readonly snapshot: Effect.Effect<
    BrewingState,
    Schema.SchemaError | WorldCommitCoordinatorError,
    WorldCommitCoordinator
  >
  readonly setBottle: (
    index: number,
    bottle: ItemStack | undefined,
  ) => Effect.Effect<BrewingState, BrewingServiceError, WorldCommitCoordinator>
  readonly setIngredient: (
    ingredient: ItemStack | undefined,
  ) => Effect.Effect<BrewingState, BrewingServiceError, WorldCommitCoordinator>
  readonly setFuel: (
    fuel: ItemStack | undefined,
  ) => Effect.Effect<BrewingState, BrewingServiceError, WorldCommitCoordinator>
  readonly addFuel: Effect.Effect<BrewingState, BrewingServiceError, WorldCommitCoordinator>
  readonly advance: (
    elapsedSecs: number,
  ) => Effect.Effect<BrewingOutcome, BrewingServiceError, WorldCommitCoordinator>
  readonly restore: (
    snapshot: unknown,
  ) => Effect.Effect<void, BrewingServiceError, WorldCommitCoordinator>
  readonly reset: Effect.Effect<void, BrewingServiceError, WorldCommitCoordinator>
}

const BrewingServiceBase: Context.ServiceClass<
  BrewingService,
  '@nerima-games/mc-sim/BrewingService',
  BrewingServiceApi
> = Context.Service<BrewingService, BrewingServiceApi>()('@nerima-games/mc-sim/BrewingService')

export class BrewingService extends BrewingServiceBase {}

const fromResult = <A, E>(result: Result.Result<A, E>): Effect.Effect<A, E> =>
  Result.isSuccess(result) ? Effect.succeed(result.success) : Effect.fail(result.failure)

export const makeBrewingServiceRegistration = (
  ownerId: ReplicatedOwnerId,
  initial?: unknown,
): Result.Result<ReplicatedOwnerRegistration<typeof BrewingServiceStateSchema>, BrewingFailure> => {
  const state = initial === undefined ? emptyBrewingState() : brewingState(initial)
  return Result.map(state, (initialState) => ({
    ownerId,
    schema: BrewingServiceStateSchema,
    initialState,
  }))
}

type BrewingUpdate<A> = Readonly<{
  value: A
  state: BrewingState
}>

const updateBrewingState = <A>(
  ownerId: ReplicatedOwnerId,
  update: (current: BrewingState) => Result.Result<BrewingUpdate<A>, BrewingFailure>,
): Effect.Effect<A, BrewingServiceError, WorldCommitCoordinator> =>
  Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
    Effect.flatMap(coordinator.snapshot(ownerId, BrewingServiceStateSchema), (snapshot) =>
      Effect.flatMap(fromResult(update(snapshot.state)), ({ value, state }) =>
        Effect.map(
          coordinator.commit({
            expectedRevision: snapshot.revision,
            expectedDimensions: [],
            changes: [{ ownerId, state }],
          }),
          () => value,
        ),
      ),
    ),
  )

export const makeBrewingService = (
  ownerId: ReplicatedOwnerId,
): Effect.Effect<BrewingServiceApi> =>
  Effect.succeed({
    snapshot: Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
      Effect.map(
        coordinator.snapshot(ownerId, BrewingServiceStateSchema),
        ({ state }) => state,
      ),
    ),
    setBottle: (index, bottle) => updateBrewingState(ownerId, (current) =>
      Result.map(setBrewingBottle(current, index, bottle), (state) => ({
        value: state,
        state,
      })),
    ),
    setIngredient: (ingredient) => updateBrewingState(ownerId, (current) =>
      Result.map(setBrewingIngredient(current, ingredient), (state) => ({
        value: state,
        state,
      })),
    ),
    setFuel: (fuel) => updateBrewingState(ownerId, (current) =>
      Result.map(brewingState({ ...current, fuel }), (state) => ({
        value: state,
        state,
      })),
    ),
    addFuel: updateBrewingState(ownerId, (current) =>
      Result.map(addBrewingFuel(current), (state) => ({
        value: state,
        state,
      })),
    ),
    advance: (elapsedSecs) => updateBrewingState(ownerId, (current) =>
      Result.map(advanceBrewing(current, elapsedSecs), (outcome) => ({
        value: outcome,
        state: outcome.state,
      })),
    ),
    restore: (snapshot) => {
      const validated = validateBrewingSnapshot(snapshot)
      if (validated._tag !== 'Valid') return Effect.fail(validated.error)
      return updateBrewingState(ownerId, (_current) =>
        Result.succeed({
          value: undefined,
          state: validated.state,
        }),
      )
    },
    reset: fromResult(emptyBrewingState()).pipe(
      Effect.flatMap((state) =>
        updateBrewingState(ownerId, (_current) =>
          Result.succeed({
            value: undefined,
            state,
          }),
        ),
      ),
    ),
  })

export const BrewingServiceLayer = (ownerId: ReplicatedOwnerId): Layer.Layer<BrewingService> =>
  Layer.effect(BrewingService, makeBrewingService(ownerId))
