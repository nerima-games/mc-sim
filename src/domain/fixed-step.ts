import { Brand, Result, Schema } from 'effect'
import {
  addTick,
  DeltaTimeSecs,
  FixedDurationSecs,
  InterpolationFraction,
  NonNegativeTickCount,
  SimulationTick,
  SimulationTickSchema,
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

const ELAPSED_TIME_UNITS_PER_SECOND = 60_000_000

type FixedTimeUnits = number & Brand.Brand<'FixedTimeUnits'>
const makeFixedTimeUnits = Brand.nominal<FixedTimeUnits>()

export type FixedStepAccumulator = {
  readonly accumulator: FixedDurationSecsValue
  /** Exact integer form used for accumulation; optional for older constructed states. */
  readonly accumulatorUnits?: FixedTimeUnits
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

const FixedDurationSecsSchema = Schema.Finite.check(
  Schema.makeFilter((value) => FixedDurationSecs.is(value)),
).pipe(Schema.brand('FixedDurationSecs'))

const NonNegativeTickCountSchema = Schema.Int.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && NonNegativeTickCount.is(value)),
).pipe(Schema.brand('NonNegativeTickCount'))

const FixedTimeUnitsSchema: Schema.Codec<FixedTimeUnits, number> = Schema.Int.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
).pipe(Schema.brand('FixedTimeUnits'))

const InterpolationFractionSchema = Schema.Finite.check(
  Schema.makeFilter((value) => InterpolationFraction.is(value)),
).pipe(Schema.brand('InterpolationFraction'))

export const FixedStepAccumulatorSchema: Schema.Codec<FixedStepAccumulator, unknown> = Schema.Struct({
  accumulator: FixedDurationSecsSchema,
  accumulatorUnits: Schema.optionalKey(FixedTimeUnitsSchema),
  tick: SimulationTickSchema,
  tickDuration: FixedDurationSecsSchema,
  maxCatchUpTicks: NonNegativeTickCountSchema,
  paused: Schema.Boolean,
})

export const FixedStepAdvanceSchema: Schema.Codec<FixedStepAdvance, unknown> = Schema.Struct({
  state: FixedStepAccumulatorSchema,
  ticks: NonNegativeTickCountSchema,
  interpolationFraction: InterpolationFractionSchema,
  overloaded: Schema.Boolean,
})

const InvalidFixedStepConfigurationSchema: Schema.Codec<InvalidFixedStepConfiguration, unknown> =
  Schema.TaggedStruct('InvalidFixedStepConfiguration', {
    field: Schema.Literals(['catchUpWindow', 'paused']),
  })

const TimeOverflowSchema: Schema.Codec<TimeOverflow, unknown> = Schema.TaggedStruct('TimeOverflow', {})

const BrandErrorSchema: Schema.Codec<Brand.BrandError, unknown> = Schema.instanceOf(Brand.BrandError)

export const FixedStepFailureSchema: Schema.Codec<FixedStepFailure, unknown> = Schema.Union([
  BrandErrorSchema,
  TimeOverflowSchema,
  InvalidFixedStepConfigurationSchema,
])

const invalidConfiguration = (
  field: InvalidFixedStepConfiguration['field'],
): InvalidFixedStepConfiguration => ({ _tag: 'InvalidFixedStepConfiguration', field })

export const initialFixedStepAccumulator = (
  tick: SimulationTickValue = SimulationTick(0),
  duration: FixedDurationSecsValue = DEFAULT_TICK_DURATION,
  maxCatchUpTicks: number = MAX_CATCH_UP_TICKS,
): FixedStepAccumulator => ({
  accumulator: FixedDurationSecs(0),
  accumulatorUnits: makeFixedTimeUnits(0),
  tick,
  tickDuration: duration,
  maxCatchUpTicks,
  paused: false,
})

export const pause = (state: FixedStepAccumulator): FixedStepAccumulator => ({ ...state, paused: true })

export const resume = (state: FixedStepAccumulator): FixedStepAccumulator => ({
  ...state,
  accumulator: FixedDurationSecs(0),
  accumulatorUnits: makeFixedTimeUnits(0),
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
    const fixedIntervalSecs = yield* FixedDurationSecs.result(state.tickDuration)
    const maxCatchUpTicks = yield* NonNegativeTickCount.result(state.maxCatchUpTicks)

    if (typeof state.paused !== 'boolean') {
      return yield* Result.fail(invalidConfiguration('paused'))
    }

    const rawAccumulatorUnits = state.accumulatorUnits === undefined
      ? Math.trunc(Number(accumulator) * ELAPSED_TIME_UNITS_PER_SECOND)
      : state.accumulatorUnits
    const accumulatorUnits = makeFixedTimeUnits(
      Number(yield* NonNegativeTickCount.result(rawAccumulatorUnits)),
    )
    const fixedIntervalUnits = Math.round(Number(fixedIntervalSecs) * ELAPSED_TIME_UNITS_PER_SECOND)
    if (!Number.isSafeInteger(fixedIntervalUnits)) {
      return yield* Result.fail(invalidConfiguration('catchUpWindow'))
    }

    const normalizedAccumulator = yield* FixedDurationSecs.result(
      accumulatorUnits / ELAPSED_TIME_UNITS_PER_SECOND,
    )
    const normalizedState: FixedStepAccumulator = {
      ...state,
      accumulator: normalizedAccumulator,
      accumulatorUnits,
    }

    if (state.paused) {
      const fraction = yield* InterpolationFraction.result(accumulatorUnits / fixedIntervalUnits)
      return {
        state: normalizedState,
        ticks: NonNegativeTickCount(0),
        interpolationFraction: fraction,
        overloaded: false,
      }
    }

    const maximumUnits = fixedIntervalUnits * maxCatchUpTicks
    if (!Number.isSafeInteger(maximumUnits) || maximumUnits >= Number.MAX_SAFE_INTEGER) {
      return yield* Result.fail(invalidConfiguration('catchUpWindow'))
    }

    // Units are 1/60,000,000 s, so 20, 60, and 120 Hz frame deltas are integral.
    // Truncate non-negative elapsed input to avoid crediting time that has not elapsed.
    const elapsedUnits = Math.trunc(Number(validDelta) * ELAPSED_TIME_UNITS_PER_SECOND)
    const availableUnits = elapsedUnits > maximumUnits - accumulatorUnits
      ? maximumUnits + 1
      : accumulatorUnits + elapsedUnits
    const overloaded = availableUnits > maximumUnits
    const boundedUnits = Math.min(availableUnits, maximumUnits)
    const ticks = yield* NonNegativeTickCount.result(
      Math.min(maxCatchUpTicks, Math.floor(boundedUnits / fixedIntervalUnits)),
    )
    const nextTick = yield* addTick(tick, ticks)
    const remainderUnits = boundedUnits - Number(ticks) * fixedIntervalUnits
    const remainder = yield* FixedDurationSecs.result(remainderUnits / ELAPSED_TIME_UNITS_PER_SECOND)
    const fraction = yield* InterpolationFraction.result(remainderUnits / fixedIntervalUnits)
    const nextState: FixedStepAccumulator = {
      ...normalizedState,
      accumulator: remainder,
      accumulatorUnits: makeFixedTimeUnits(remainderUnits),
      tick: nextTick,
    }

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
