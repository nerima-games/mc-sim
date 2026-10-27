import { Context, Effect, Layer, Ref, Result } from 'effect'
import type { ItemStack } from '@nerima-games/mc-kernel'
import {
  addBrewingFuel,
  advanceBrewing,
  brewingState,
  emptyBrewingState,
  setBrewingBottle,
  setBrewingIngredient,
  validateBrewingSnapshot,
  type BrewingFailure,
  type BrewingOutcome,
  type BrewingState,
} from '../domain/brewing.js'

export type BrewingServiceApi = {
  readonly snapshot: Effect.Effect<BrewingState>
  readonly setBottle: (index: number, bottle: ItemStack | undefined) => Effect.Effect<BrewingState, BrewingFailure>
  readonly setIngredient: (ingredient: ItemStack | undefined) => Effect.Effect<BrewingState, BrewingFailure>
  readonly setFuel: (fuel: ItemStack | undefined) => Effect.Effect<BrewingState, BrewingFailure>
  readonly addFuel: Effect.Effect<BrewingState, BrewingFailure>
  readonly advance: (elapsedSecs: number) => Effect.Effect<BrewingOutcome, BrewingFailure>
  readonly restore: (snapshot: unknown) => Effect.Effect<void, BrewingFailure>
  readonly reset: Effect.Effect<void, BrewingFailure>
}

const BrewingServiceBase: Context.ServiceClass<
  BrewingService,
  '@nerima-games/mc-sim/BrewingService',
  BrewingServiceApi
> = Context.Service<BrewingService, BrewingServiceApi>()('@nerima-games/mc-sim/BrewingService')

export class BrewingService extends BrewingServiceBase {}

const fromResult = <A, E>(result: Result.Result<A, E>): Effect.Effect<A, E> =>
  Result.isSuccess(result) ? Effect.succeed(result.success) : Effect.fail(result.failure)

const updateState = <A>(
  state: Ref.Ref<BrewingState>,
  update: (current: BrewingState) => Result.Result<Readonly<{ value: A; state: BrewingState }>, BrewingFailure>,
): Effect.Effect<A, BrewingFailure> =>
  Ref.modify(state, (current): readonly [Result.Result<A, BrewingFailure>, BrewingState] => {
    const result = update(current)
    return Result.isFailure(result)
      ? [Result.fail(result.failure), current]
      : [Result.succeed(result.success.value), result.success.state]
  }).pipe(Effect.flatMap((result) => fromResult(result)))

export const makeBrewingService = (
  initial?: unknown,
): Effect.Effect<BrewingServiceApi, BrewingFailure> => {
  const initialState = initial === undefined ? emptyBrewingState() : brewingState(initial)
  if (Result.isFailure(initialState)) return Effect.fail(initialState.failure)
  return Effect.map(Ref.make(initialState.success), (state) => ({
    snapshot: Ref.get(state),
    setBottle: (index, bottle) => updateState(state, (current) =>
      Result.map(setBrewingBottle(current, index, bottle), (next) => ({ value: next, state: next })),
    ),
    setIngredient: (ingredient) => updateState(state, (current) =>
      Result.map(setBrewingIngredient(current, ingredient), (next) => ({ value: next, state: next })),
    ),
    setFuel: (fuel) => updateState(state, (current) =>
      Result.map(brewingState({ ...current, fuel }), (next) => ({ value: next, state: next })),
    ),
    addFuel: updateState(state, (current) =>
      Result.map(addBrewingFuel(current), (next) => ({ value: next, state: next })),
    ),
    advance: (elapsedSecs) => updateState(state, (current) =>
      Result.map(advanceBrewing(current, elapsedSecs), (outcome) => ({ value: outcome, state: outcome.state })),
    ),
    restore: (snapshot) => {
      const validated = validateBrewingSnapshot(snapshot)
      if (validated._tag !== 'Valid') return Effect.fail(validated.error)
      return Ref.set(state, validated.state)
    },
    reset: fromResult(emptyBrewingState()).pipe(Effect.flatMap((next) => Ref.set(state, next))),
  }))
}

export const BrewingServiceLayer: Layer.Layer<BrewingService, BrewingFailure> = Layer.effect(
  BrewingService,
  makeBrewingService(),
)
