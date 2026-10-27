import { Context, Effect, Layer, Ref, Result } from 'effect'
import { RecipeExperience, type ItemStack, type RecipeExperience as RecipeExperienceValue } from '@nerima-games/mc-kernel'
import type { Inventory } from '../domain/inventory.js'
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

type FurnaceServiceState = Readonly<{
  readonly furnace: FurnaceState
  readonly experience: number
}>

export type FurnaceServiceApi = {
  readonly snapshot: Effect.Effect<FurnaceState>
  readonly setInput: (input: ItemStack | undefined) => Effect.Effect<void, FurnaceFailure>
  readonly setFuel: (fuel: ItemStack | undefined) => Effect.Effect<void, FurnaceFailure>
  readonly advance: (elapsedSecs: number) => Effect.Effect<FurnaceOutcome, FurnaceFailure>
  readonly collectOutput: (inventory: Inventory) => Effect.Effect<FurnaceCollectionOutcome>
  readonly collectExperience: Effect.Effect<RecipeExperienceValue, FurnaceFailure>
  readonly restore: (snapshot: unknown) => Effect.Effect<void, FurnaceFailure>
  readonly reset: Effect.Effect<void, FurnaceFailure>
}

const FurnaceServiceBase: Context.ServiceClass<
  FurnaceService,
  '@nerima-games/mc-sim/FurnaceService',
  FurnaceServiceApi
> = Context.Service<FurnaceService, FurnaceServiceApi>()('@nerima-games/mc-sim/FurnaceService')

export class FurnaceService extends FurnaceServiceBase {}

const fromResult = <A, E>(result: Result.Result<A, E>): Effect.Effect<A, E> =>
  Result.isSuccess(result) ? Effect.succeed(result.success) : Effect.fail(result.failure)

const modifyFurnaceState = <A>(
  state: Ref.Ref<FurnaceServiceState>,
  update: (current: FurnaceServiceState) => Result.Result<Readonly<{ value: A; state: FurnaceServiceState }>, FurnaceFailure>,
): Effect.Effect<A, FurnaceFailure> =>
  Ref.modify(state, (current): readonly [Result.Result<A, FurnaceFailure>, FurnaceServiceState] => {
    const next = update(current)
    return Result.isFailure(next)
      ? [Result.fail(next.failure), current]
      : [Result.succeed(next.success.value), next.success.state]
  }).pipe(Effect.flatMap((result) => fromResult(result)))

export const makeFurnaceService = (
  initial?: unknown,
): Effect.Effect<FurnaceServiceApi, FurnaceFailure> => {
  const initialFurnace = initial === undefined ? emptyFurnaceState() : furnaceState(initial)
  if (Result.isFailure(initialFurnace)) return Effect.fail(initialFurnace.failure)
  return Effect.map(Ref.make<FurnaceServiceState>({ furnace: initialFurnace.success, experience: 0 }), (state) => ({
    snapshot: Ref.get(state).pipe(Effect.map((current) => current.furnace)),
    setInput: (input) => modifyFurnaceState(state, (current) =>
      Result.map(furnaceState({ ...current.furnace, input }), (furnace) => ({
        value: undefined,
        state: { ...current, furnace },
      })),
    ),
    setFuel: (fuel) => modifyFurnaceState(state, (current) =>
      Result.map(furnaceState({ ...current.furnace, fuel }), (furnace) => ({
        value: undefined,
        state: { ...current, furnace },
      })),
    ),
    advance: (elapsedSecs) => modifyFurnaceState(state, (current) =>
      Result.flatMap(advanceFurnace(current.furnace, elapsedSecs), (outcome) =>
        Result.map(RecipeExperience.result(current.experience + outcome.experienceGained), (experience) => ({
          value: outcome,
          state: { furnace: outcome.state, experience },
        })),
      ),
    ),
    collectOutput: (inventory) =>
      Ref.modify(state, (current) => {
        const outcome = collectFurnaceOutput(inventory, current.furnace)
        return outcome.result._tag === 'Collected'
          ? [outcome, { ...current, furnace: outcome.furnace }] as const
          : [outcome, current] as const
      }),
    collectExperience: modifyFurnaceState(state, (current) =>
      Result.map(RecipeExperience.result(current.experience), (experience) => ({
        value: experience,
        state: { ...current, experience: 0 },
      })),
    ),
    restore: (snapshot) => {
      const validated = validateFurnaceSnapshot(snapshot)
      if (validated._tag !== 'Valid') return Effect.fail(validated.error)
      return Ref.set(state, { furnace: validated.state, experience: 0 })
    },
    reset: fromResult(emptyFurnaceState()).pipe(
      Effect.flatMap((furnace) => Ref.set(state, { furnace, experience: 0 })),
    ),
  }))
}

export const FurnaceServiceLayer: Layer.Layer<FurnaceService, FurnaceFailure> = Layer.effect(
  FurnaceService,
  makeFurnaceService(),
)
