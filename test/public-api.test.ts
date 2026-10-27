import { expect, it } from '@effect/vitest'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import { Effect, Result } from 'effect'
import { advanceFixedStep, initialFixedStepAccumulator } from '../src/domain/fixed-step.js'
import { fixedStepParityCases } from './fixtures/effect4-parity/fixed-step.js'

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
