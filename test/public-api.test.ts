import { expect, it } from '@effect/vitest'
import { DeltaTimeSecs, SimulationTick } from '@nerima-games/mc-kernel'
import { Effect, Result } from 'effect'
import {
  advanceFixedStep,
  initialFixedStepAccumulator,
  pauseFixedStep,
  resumeFixedStep,
} from '../src/index.js'
import {
  fixedStepMainParityExpected,
  fixedStepMainParityInput,
  fixedStepParityCases,
} from './fixtures/effect4-parity/fixed-step.js'

const normalizeFixedStepResult = (result: ReturnType<typeof advanceFixedStep>) =>
  Result.isFailure(result)
    ? { _tag: 'Failure', error: result.failure }
    : { _tag: 'Success', value: result.success }

it.effect('preserves fixed-step outputs for Effect 4 parity inputs', () =>
  Effect.sync(() => {
    for (const row of fixedStepParityCases) {
      const result = advanceFixedStep(initialFixedStepAccumulator(), DeltaTimeSecs(row.delta))
      if (Result.isFailure(result)) throw new Error('fixed-step parity input failed')

      expect(result.success.ticks).toBe(row.ticks)
      expect(result.success.state.tick).toBe(row.tick)
      expect(result.success.state.accumulator).toBeCloseTo(row.remainder)
      expect(result.success.interpolationFraction).toBeCloseTo(row.fraction)
      expect(result.success.overloaded).toBe(row.overloaded)
    }
  }),
)

it.effect('matches fixed-step outputs recorded from the pre-migration main revision', () =>
  Effect.sync(() => {
    let state = initialFixedStepAccumulator(SimulationTick(fixedStepMainParityInput.initialTick))
    const sequence = fixedStepMainParityInput.deltas.map((delta) => {
      const result = advanceFixedStep(state, DeltaTimeSecs(delta))
      if (Result.isFailure(result)) return normalizeFixedStepResult(result)

      state = result.success.state
      return normalizeFixedStepResult(result)
    })
    const paused = pauseFixedStep(state)
    const pausedAdvance = normalizeFixedStepResult(
      advanceFixedStep(paused, DeltaTimeSecs(fixedStepMainParityInput.pausedDelta)),
    )
    const resumeAdvance = normalizeFixedStepResult(
      advanceFixedStep(resumeFixedStep(paused), DeltaTimeSecs(fixedStepMainParityInput.resumedDelta)),
    )
    const overflow = normalizeFixedStepResult(
      advanceFixedStep(
        initialFixedStepAccumulator(SimulationTick(fixedStepMainParityInput.overflowTick)),
        DeltaTimeSecs(fixedStepMainParityInput.overflowDelta),
      ),
    )

    expect({ sequence, pausedAdvance, resumeAdvance, overflow }).toEqual(fixedStepMainParityExpected)
  }),
)
