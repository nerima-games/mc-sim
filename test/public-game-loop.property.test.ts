import fc from 'fast-check'
import { Effect, Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { makeGameLoop } from '../src/application/game-loop.js'
import { assertEffectOutcome, hostileNumberOrNullish, invokeEffect } from './public-property-helpers.js'

const initialTickInput = fc.oneof(
  fc.anything({ maxDepth: 2 }),
  fc.constant({ toString: '' }),
)

const hasValidInitialTick = (value: unknown): boolean =>
  value === undefined ||
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

it('starts for valid initial ticks and returns a typed failure for other values', async () => {
  await fc.assert(
    fc.asyncProperty(initialTickInput, async (value) => {
      const loop = await Effect.runPromise(makeGameLoop(value as never))

      try {
        const started = await Effect.runPromise(Effect.result(loop.start(() => Effect.void)))
        assertEffectOutcome(
          'GameLoop.start',
          () => started,
          Schema.Void,
          Sim.BrandErrorSchema,
        )
        if (hasValidInitialTick(value)) {
          expect(Result.isSuccess(started)).toBe(true)
          expect(await Effect.runPromise(loop.isRunning)).toBe(true)
        } else {
          expect(Result.isFailure(started)).toBe(true)
          if (Result.isFailure(started)) expect(started.failure._tag).toBe('BrandError')
          expect(await Effect.runPromise(loop.isRunning)).toBe(false)
        }
      } finally {
        await Effect.runPromise(loop.stop)
      }
    }),
    { numRuns: 100, seed: 0x474c4f50 },
  )
})

it('decodes advanceFrame success and failure values and preserves state on invalid deltas', async () => {
  await fc.assert(
    fc.asyncProperty(hostileNumberOrNullish, async (delta) => {
      const loop = await Effect.runPromise(makeGameLoop())
      await Effect.runPromise(loop.start(() => Effect.void))

      try {
        const beforeTick = await Effect.runPromise(loop.simulationTick)
        const outcome = await Effect.runPromise(Effect.result(invokeEffect(loop.advanceFrame, [delta])))
        assertEffectOutcome(
          'GameLoop.advanceFrame',
          () => outcome,
          Sim.FixedStepAdvanceSchema,
          Sim.FixedStepFailureSchema,
        )

        if (Result.isFailure(outcome)) {
          expect(await Effect.runPromise(loop.simulationTick)).toBe(beforeTick)
        } else {
          expect(outcome.success.state.accumulator).toBeGreaterThanOrEqual(0)
          expect(outcome.success.state.accumulator).toBeLessThan(outcome.success.state.tickDuration)
          expect(outcome.success.interpolationFraction).toBeGreaterThanOrEqual(0)
          expect(outcome.success.interpolationFraction).toBeLessThan(1)
          expect(outcome.success.ticks).toBeGreaterThanOrEqual(0)
        }
      } finally {
        await Effect.runPromise(loop.stop)
      }
    }),
    { numRuns: 100, seed: 0x474c4156 },
  )
})
