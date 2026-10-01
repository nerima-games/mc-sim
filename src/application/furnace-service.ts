import { Context, Effect, Layer, Ref } from 'effect'
import * as Domain from '../domain/smelting.js'
import * as State from '../domain/furnace-state.js'
import type { ItemStack } from '@nerima-games/mc-kernel'

export type FurnaceServiceApi = {
  readonly snapshot: Effect.Effect<State.FurnaceState>
  readonly advance: (deltaTimeSecs: number) => Effect.Effect<Domain.FurnaceOutcome>
  readonly setInput: (input: ItemStack | null) => Effect.Effect<void>
  readonly setFuel: (fuel: ItemStack | null) => Effect.Effect<void>
  readonly setOutput: (output: ItemStack | null) => Effect.Effect<void>
  readonly restore: (snapshot: unknown) => Effect.Effect<void, State.FurnaceSnapshotValidationError>
  readonly reset: Effect.Effect<void>
}

const FurnaceServiceBase: Context.TagClass<FurnaceService, '@nerima-games/mc-sim/FurnaceService', FurnaceServiceApi> =
  Context.Tag('@nerima-games/mc-sim/FurnaceService')<FurnaceService, FurnaceServiceApi>()

export class FurnaceService extends FurnaceServiceBase {}

export const makeFurnaceService = (
  initial: State.FurnaceState = State.emptyFurnaceState(),
): Effect.Effect<FurnaceServiceApi> =>
  Effect.map(Ref.make(initial), (state) => ({
    snapshot: Ref.get(state),
    advance: (deltaTimeSecs) => Ref.modify(state, (current) => {
      const outcome = Domain.advanceFurnace(current, deltaTimeSecs)
      return [outcome, outcome.state]
    }),
    setInput: (input) => Ref.update(state, (current) => ({ ...current, input })),
    setFuel: (fuel) => Ref.update(state, (current) => ({ ...current, fuel })),
    setOutput: (output) => Ref.update(state, (current) => ({ ...current, output })),
    restore: (snapshot) => {
      const validated = Domain.validateFurnaceSnapshot(snapshot)
      return validated._tag === 'Invalid'
        ? Effect.fail(validated.error)
        : Ref.update(state, () => validated.state)
    },
    reset: Ref.set(state, State.emptyFurnaceState()),
  }))

export const FurnaceServiceLayer: Layer.Layer<FurnaceService> = Layer.effect(
  FurnaceService,
  makeFurnaceService(),
)
