import { Either } from 'effect'
import {
  addTick,
  FixedDurationSecs,
  interpolationFraction,
  NonNegativeTickCount,
  SimulationTick,
  tickDuration,
  type DeltaTimeSecs,
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
  delta: DeltaTimeSecs,
): Either.Either<FixedStepAdvance, TimeOverflow> => {
  if (state.paused) {
    return Either.right({
      state,
      ticks: NonNegativeTickCount(0),
      interpolationFraction: interpolationFraction(state.accumulator),
      overloaded: false,
    })
  }

  const available = state.accumulator + delta
  const maximum = state.tickDuration * state.maxCatchUpTicks
  const overloaded = available > maximum
  const bounded = Math.min(available, maximum)
  const ticks = Math.min(state.maxCatchUpTicks, Math.floor(bounded / state.tickDuration))
  const nextTick = addTick(state.tick, NonNegativeTickCount(ticks))

  if (Either.isLeft(nextTick)) return Either.left(nextTick.left)

  const remainder = FixedDurationSecs(bounded - ticks * state.tickDuration)
  const nextState: FixedStepAccumulator = { ...state, accumulator: remainder, tick: nextTick.right }

  return Either.right({
    state: nextState,
    ticks: NonNegativeTickCount(ticks),
    interpolationFraction: interpolationFraction(remainder),
    overloaded,
  })
}

export const createFixedStepAccumulator: typeof initialFixedStepAccumulator = initialFixedStepAccumulator
export const advanceFixedStep: typeof advance = advance
export const pauseFixedStep: typeof pause = pause
export const resumeFixedStep: typeof resume = resume
