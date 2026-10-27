import { Brand, Result } from 'effect'
import {
  addTick,
  DeltaTimeSecs,
  FixedDurationSecs,
  InterpolationFraction,
  NonNegativeTickCount,
  SimulationTick,
  tickDuration,
  type DeltaTimeSecs as DeltaTimeSecsValue,
  type FixedDurationSecs as FixedDurationSecsValue,
  type InterpolationFraction as InterpolationFractionValue,
  type NonNegativeTickCount as NonNegativeTickCountValue,
  type SimulationTick as SimulationTickValue,
  type TimeOverflow,
} from '@nerima-games/mc-kernel'

/** Default fixed simulation interval: 20 ticks per second. */
export const DEFAULT_TICK_DURATION: FixedDurationSecsValue = tickDuration

/**
 * At most five fixed updates are allowed to catch up in one frame.
 * Five ticks at the default interval cover 250 ms; more would let a slow frame
 * spend its next frame catching up indefinitely (the spiral-of-death failure).
 */
export const MAX_CATCH_UP_TICKS = 5

export type FixedStepAccumulator = {
  readonly accumulator: FixedDurationSecsValue
  readonly tick: SimulationTickValue
  readonly tickDuration: FixedDurationSecsValue
  readonly maxCatchUpTicks: number
  readonly paused: boolean
}

export type FixedStepAdvance = {
  readonly state: FixedStepAccumulator
  readonly ticks: NonNegativeTickCountValue
  readonly interpolationFraction: InterpolationFractionValue
  readonly overloaded: boolean
}

export type InvalidFixedStepConfiguration = {
  readonly _tag: 'InvalidFixedStepConfiguration'
  readonly field: 'catchUpWindow' | 'paused'
}

export type FixedStepFailure = Brand.BrandError | TimeOverflow | InvalidFixedStepConfiguration

const invalidConfiguration = (
  field: InvalidFixedStepConfiguration['field'],
): InvalidFixedStepConfiguration => ({ _tag: 'InvalidFixedStepConfiguration', field })

export const initialFixedStepAccumulator = (
  tick: SimulationTickValue = SimulationTick(0),
  duration: FixedDurationSecsValue = DEFAULT_TICK_DURATION,
  maxCatchUpTicks: number = MAX_CATCH_UP_TICKS,
): FixedStepAccumulator => ({
  accumulator: FixedDurationSecs(0),
  tick,
  tickDuration: duration,
  maxCatchUpTicks,
  paused: false,
})

export const pause = (state: FixedStepAccumulator): FixedStepAccumulator => ({ ...state, paused: true })

export const resume = (state: FixedStepAccumulator): FixedStepAccumulator => ({
  ...state,
  accumulator: FixedDurationSecs(0),
  paused: false,
})

export const advance = (
  state: FixedStepAccumulator,
  delta: DeltaTimeSecsValue,
): Result.Result<FixedStepAdvance, FixedStepFailure> =>
  Result.gen(function* () {
    const validDelta = yield* DeltaTimeSecs.result(delta)
    const accumulator = yield* FixedDurationSecs.result(state.accumulator)
    const tick = yield* SimulationTick.result(state.tick)
    const tickDuration = yield* FixedDurationSecs.result(state.tickDuration)
    const maxCatchUpTicks = yield* NonNegativeTickCount.result(state.maxCatchUpTicks)

    if (typeof state.paused !== 'boolean') {
      return yield* Result.fail(invalidConfiguration('paused'))
    }

    if (state.paused) {
      const fraction = yield* InterpolationFraction.result(accumulator / tickDuration)
      return {
        state,
        ticks: NonNegativeTickCount(0),
        interpolationFraction: fraction,
        overloaded: false,
      }
    }

    const available = accumulator + validDelta
    const maximum = tickDuration * maxCatchUpTicks
    if (!Number.isFinite(maximum)) {
      return yield* Result.fail(invalidConfiguration('catchUpWindow'))
    }

    const overloaded = available > maximum
    const bounded = Math.min(available, maximum)
    const ticks = yield* NonNegativeTickCount.result(
      Math.min(maxCatchUpTicks, Math.floor(bounded / tickDuration)),
    )
    const nextTick = yield* addTick(tick, ticks)
    const remainder = yield* FixedDurationSecs.result(bounded - ticks * tickDuration)
    const fraction = yield* InterpolationFraction.result(remainder / tickDuration)
    const nextState: FixedStepAccumulator = { ...state, accumulator: remainder, tick: nextTick }

    return {
      state: nextState,
      ticks,
      interpolationFraction: fraction,
      overloaded,
    }
  })

export const createFixedStepAccumulator: typeof initialFixedStepAccumulator = initialFixedStepAccumulator
export const advanceFixedStep: typeof advance = advance
export const pauseFixedStep: typeof pause = pause
export const resumeFixedStep: typeof resume = resume
