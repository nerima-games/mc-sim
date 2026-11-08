import { Brand, Effect, Result, Schema } from 'effect'
import {
  DeltaTimeSecs,
  NonNegativeTickCount,
  type NonNegativeTickCount as NonNegativeTickCountValue,
  type FrameServices,
  type StageRegistration,
} from '@nerima-games/mc-kernel'
import { DEFAULT_TICK_DURATION, MAX_CATCH_UP_TICKS } from '../domain/fixed-step.js'

export type TickCountExceedsCatchUpLimit = {
  readonly _tag: 'TickCountExceedsCatchUpLimit'
}

export type RunStagesForTicksFailure = Brand.BrandError | TickCountExceedsCatchUpLimit

const BrandErrorSchema: Schema.Codec<Brand.BrandError, unknown> = Schema.instanceOf(Brand.BrandError)
const TickCountExceedsCatchUpLimitSchema: Schema.Codec<TickCountExceedsCatchUpLimit, unknown> =
  Schema.TaggedStruct('TickCountExceedsCatchUpLimit', {})

export const RunStagesForTicksFailureSchema: Schema.Codec<RunStagesForTicksFailure, unknown> =
  Schema.Union([BrandErrorSchema, TickCountExceedsCatchUpLimitSchema])

const TICK_DELTA = DeltaTimeSecs(Number(DEFAULT_TICK_DURATION))
const TICK_COUNT_EXCEEDS_CATCH_UP_LIMIT: TickCountExceedsCatchUpLimit = {
  _tag: 'TickCountExceedsCatchUpLimit',
}

/** Run an already ordered registration list once for each fixed simulation tick. */
export const runStagesForTicks = (
  stages: ReadonlyArray<StageRegistration>,
  ticks: NonNegativeTickCountValue,
): Effect.Effect<void, RunStagesForTicksFailure, FrameServices> => {
  const validTicks = NonNegativeTickCount.result(ticks)
  if (Result.isFailure(validTicks)) return Effect.fail(validTicks.failure)
  if (Number(validTicks.success) > MAX_CATCH_UP_TICKS) {
    return Effect.fail(TICK_COUNT_EXCEEDS_CATCH_UP_LIMIT)
  }

  return Effect.forEach(
    Array.from({ length: Number(validTicks.success) }),
    () => Effect.forEach(stages, (stage) => stage.run(TICK_DELTA), { discard: true }),
    { discard: true },
  )
}
