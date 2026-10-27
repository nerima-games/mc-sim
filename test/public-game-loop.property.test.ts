import fc from 'fast-check'
import { Effect } from 'effect'
import { expect, it } from 'vitest'
import { makeGameLoop } from '../src/application/game-loop.js'

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
        if (hasValidInitialTick(value)) {
          expect(started._tag).toBe('Success')
          expect(await Effect.runPromise(loop.isRunning)).toBe(true)
        } else {
          expect(started._tag).toBe('Failure')
          if (started._tag === 'Failure') expect(started.failure._tag).toBe('BrandError')
          expect(await Effect.runPromise(loop.isRunning)).toBe(false)
        }
      } finally {
        await Effect.runPromise(loop.stop)
      }
    }),
    { numRuns: 100, seed: 0x474c4f50 },
  )
})
