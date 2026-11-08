import { Effect, Ref, Result } from 'effect'
import { type DeltaTimeSecs, SimulationTick } from '@nerima-games/mc-kernel'
import {
  advance as advanceFixedStep,
  initialFixedStepAccumulator,
  pause as pauseFixedStep,
  resume as resumeFixedStep,
  type FixedStepAccumulator,
  type FixedStepAdvance,
  type FixedStepFailure,
} from '../domain/fixed-step.js'

export type TickServiceApi = {
  readonly advanceFrame: (delta: DeltaTimeSecs) => Effect.Effect<FixedStepAdvance, FixedStepFailure>
  readonly pause: Effect.Effect<void>
  readonly resume: Effect.Effect<void>
}

export const makeTickService = (
  initialTick: SimulationTick = SimulationTick(0),
): Effect.Effect<TickServiceApi> =>
  Effect.gen(function* () {
    const state = yield* Ref.make(initialFixedStepAccumulator(initialTick))
    const advanceFrame = (delta: DeltaTimeSecs): Effect.Effect<FixedStepAdvance, FixedStepFailure> =>
      Ref.modify(state, (current): readonly [
        Result.Result<FixedStepAdvance, FixedStepFailure>,
        FixedStepAccumulator,
      ] => {
        const advanced = advanceFixedStep(current, delta)
        return Result.match(advanced, {
          onFailure: (failure) => [Result.fail(failure), current],
          onSuccess: (next) => [Result.succeed(next), next.state],
        })
      }).pipe(Effect.flatMap((result) => Effect.fromResult(result)))

    return {
      advanceFrame,
      pause: Ref.update(state, pauseFixedStep),
      resume: Ref.update(state, resumeFixedStep),
    }
  })
