import { Context, Effect, Layer, Result, Schema } from 'effect'
import { isItemStack, RecipeExperience, type ItemStack, type RecipeExperience as RecipeExperienceValue, type WorldRevision } from '@nerima-games/mc-kernel'
import type { Inventory } from '../domain/inventory.js'
import { INVENTORY_SLOT_COUNT } from '../domain/inventory.js'
import {
  advanceFurnace,
  collectFurnaceOutput,
  emptyFurnaceState,
  furnaceState,
  validateFurnaceSnapshot,
  type FurnaceCollectionOutcome,
  type FurnaceFailure,
  type FurnaceOutcome,
  type FurnaceState,
} from '../domain/smelting.js'
import type { ReplicatedOwnerId } from './replicated-state.js'
import {
  type ReplicatedOwnerCandidate,
  type ReplicatedOwnerRegistration,
  WorldCommitCoordinator,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'

export type FurnaceServiceState = Readonly<{
  readonly furnace: FurnaceState
  readonly experience: RecipeExperienceValue
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isValidInventory = (value: unknown): value is Inventory =>
  isRecord(value) &&
  Array.isArray(value['slots']) &&
  value['slots'].length === INVENTORY_SLOT_COUNT &&
  value['slots'].every((slot) => slot === undefined || isItemStack(slot))

const isFurnaceServiceState = (value: unknown): value is FurnaceServiceState => {
  if (!isRecord(value) || Object.keys(value).length !== 2) return false
  if (!Object.hasOwn(value, 'furnace') || !Object.hasOwn(value, 'experience')) return false
  if (validateFurnaceSnapshot(value['furnace'])._tag !== 'Valid') return false
  const experience = value['experience']
  return typeof experience === 'number' && Result.isSuccess(RecipeExperience.result(experience))
}

export const FurnaceServiceStateSchema: Schema.Codec<FurnaceServiceState, FurnaceServiceState> =
  Schema.declare<FurnaceServiceState>(isFurnaceServiceState)

export type FurnaceServiceError =
  | FurnaceFailure
  | Schema.SchemaError
  | WorldCommitCoordinatorError

export type FurnaceCollectionCandidate = Readonly<{
  outcome: FurnaceCollectionOutcome
  expectedRevision: WorldRevision
  ownerCandidate: ReplicatedOwnerCandidate | undefined
}>

export type FurnaceExperienceCandidate = Readonly<{
  experience: RecipeExperienceValue
  expectedRevision: WorldRevision
  ownerCandidate: ReplicatedOwnerCandidate | undefined
}>

export type FurnaceServiceApi = {
  readonly snapshot: Effect.Effect<
    FurnaceState,
    Schema.SchemaError | WorldCommitCoordinatorError,
    WorldCommitCoordinator
  >
  readonly setInput: (
    input: ItemStack | undefined,
  ) => Effect.Effect<void, FurnaceServiceError, WorldCommitCoordinator>
  readonly setFuel: (
    fuel: ItemStack | undefined,
  ) => Effect.Effect<void, FurnaceServiceError, WorldCommitCoordinator>
  readonly advance: (
    elapsedSecs: number,
  ) => Effect.Effect<FurnaceOutcome, FurnaceServiceError, WorldCommitCoordinator>
  readonly prepareCollectOutput: (
    inventory: Inventory,
  ) => Effect.Effect<FurnaceCollectionCandidate, FurnaceServiceError, WorldCommitCoordinator>
  readonly prepareCollectExperience: Effect.Effect<
    FurnaceExperienceCandidate,
    FurnaceServiceError,
    WorldCommitCoordinator
  >
  readonly restore: (
    snapshot: unknown,
  ) => Effect.Effect<void, FurnaceServiceError, WorldCommitCoordinator>
  readonly reset: Effect.Effect<void, FurnaceServiceError, WorldCommitCoordinator>
}

const FurnaceServiceBase: Context.ServiceClass<
  FurnaceService,
  '@nerima-games/mc-sim/FurnaceService',
  FurnaceServiceApi
> = Context.Service<FurnaceService, FurnaceServiceApi>()('@nerima-games/mc-sim/FurnaceService')

export class FurnaceService extends FurnaceServiceBase {}

const fromResult = <A, E>(result: Result.Result<A, E>): Effect.Effect<A, E> =>
  Result.isSuccess(result) ? Effect.succeed(result.success) : Effect.fail(result.failure)

export const makeFurnaceServiceRegistration = (
  ownerId: ReplicatedOwnerId,
  initial?: unknown,
): Result.Result<ReplicatedOwnerRegistration<typeof FurnaceServiceStateSchema>, FurnaceFailure> => {
  const initialFurnace = initial === undefined ? emptyFurnaceState() : furnaceState(initial)
  return Result.flatMap(initialFurnace, (furnace) =>
    Result.map(RecipeExperience.result(0), (experience) => ({
      ownerId,
      schema: FurnaceServiceStateSchema,
      initialState: { furnace, experience },
    })),
  )
}

type FurnaceUpdate<A> = Readonly<{
  value: A
  state: FurnaceServiceState
}>

const updateFurnaceState = <A>(
  ownerId: ReplicatedOwnerId,
  update: (current: FurnaceServiceState) => Result.Result<FurnaceUpdate<A>, FurnaceFailure>,
): Effect.Effect<A, FurnaceServiceError, WorldCommitCoordinator> =>
  Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
    Effect.flatMap(coordinator.snapshot(ownerId, FurnaceServiceStateSchema), (snapshot) =>
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

const prepareFurnaceOutputCollection = (
  ownerId: ReplicatedOwnerId,
  inventory: Inventory,
): Effect.Effect<FurnaceCollectionCandidate, FurnaceServiceError, WorldCommitCoordinator> =>
  !isValidInventory(inventory)
    ? Effect.fail({
        _tag: 'FurnaceStateValidationFailure',
        path: 'inventory',
        reason: 'expected a valid player inventory',
      })
    : Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
    Effect.map(coordinator.snapshot(ownerId, FurnaceServiceStateSchema), (snapshot) => {
      const outcome = collectFurnaceOutput(inventory, snapshot.state.furnace)
      const ownerCandidate = outcome.result._tag === 'Collected'
        ? { ownerId, state: { ...snapshot.state, furnace: outcome.furnace } }
        : undefined
      return { outcome, expectedRevision: snapshot.revision, ownerCandidate }
    }),
  )

const prepareFurnaceExperienceCollection = (
  ownerId: ReplicatedOwnerId,
): Effect.Effect<FurnaceExperienceCandidate, FurnaceServiceError, WorldCommitCoordinator> =>
  Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
    Effect.flatMap(coordinator.snapshot(ownerId, FurnaceServiceStateSchema), (snapshot) =>
      Effect.flatMap(fromResult(RecipeExperience.result(snapshot.state.experience)), (experience) =>
        Effect.map(fromResult(RecipeExperience.result(0)), (remaining) => ({
          experience,
          expectedRevision: snapshot.revision,
          ownerCandidate: experience > 0
            ? { ownerId, state: { ...snapshot.state, experience: remaining } }
            : undefined,
        })),
      ),
    ),
  )

export const makeFurnaceService = (
  ownerId: ReplicatedOwnerId,
): Effect.Effect<FurnaceServiceApi> =>
  Effect.succeed({
    snapshot: Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
      Effect.map(
        coordinator.snapshot(ownerId, FurnaceServiceStateSchema),
        ({ state }) => state.furnace,
      ),
    ),
    setInput: (input) => updateFurnaceState(ownerId, (current) =>
      Result.map(furnaceState({ ...current.furnace, input }), (furnace) => ({
        value: undefined,
        state: { ...current, furnace },
      })),
    ),
    setFuel: (fuel) => updateFurnaceState(ownerId, (current) =>
      Result.map(furnaceState({ ...current.furnace, fuel }), (furnace) => ({
        value: undefined,
        state: { ...current, furnace },
      })),
    ),
    advance: (elapsedSecs) => updateFurnaceState(ownerId, (current) =>
      Result.flatMap(advanceFurnace(current.furnace, elapsedSecs), (outcome) =>
        Result.map(RecipeExperience.result(current.experience + outcome.experienceGained), (experience) => ({
          value: outcome,
          state: { furnace: outcome.state, experience },
        })),
      ),
    ),
    prepareCollectOutput: (inventory) => prepareFurnaceOutputCollection(ownerId, inventory),
    prepareCollectExperience: prepareFurnaceExperienceCollection(ownerId),
    restore: (snapshot) => {
      const validated = validateFurnaceSnapshot(snapshot)
      if (validated._tag !== 'Valid') return Effect.fail(validated.error)
      return updateFurnaceState(ownerId, (_current) =>
        Result.map(RecipeExperience.result(0), (experience) => ({
          value: undefined,
          state: { furnace: validated.state, experience },
        })),
      )
    },
    reset: fromResult(emptyFurnaceState()).pipe(
      Effect.flatMap((furnace) =>
        updateFurnaceState(ownerId, (_current) =>
          Result.map(RecipeExperience.result(0), (experience) => ({
            value: undefined,
            state: { furnace, experience },
          })),
        ),
      ),
    ),
  })

export const FurnaceServiceLayer = (ownerId: ReplicatedOwnerId): Layer.Layer<FurnaceService> =>
  Layer.effect(FurnaceService, makeFurnaceService(ownerId))
