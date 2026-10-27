import { expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import { afterEach, vi } from 'vitest'
import { makeGameLoop } from '../src/application/game-loop.js'

const injectedStepFailure = vi.hoisted(() => ({ active: false, calls: 0 }))

vi.mock('../src/domain/fixed-step.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/domain/fixed-step.js')>()
  const { Result: EffectResult } = await import('effect')
  return {
    ...actual,
    advance: (...args: Parameters<typeof actual.advance>) => {
      if (!injectedStepFailure.active) return actual.advance(...args)
      injectedStepFailure.active = false
      injectedStepFailure.calls += 1
      return EffectResult.fail({ _tag: 'InvalidFixedStepConfiguration', field: 'paused' })
    },
  }
})

afterEach(() => {
  injectedStepFailure.active = false
  injectedStepFailure.calls = 0
})

it.effect('does not report an unexpected fixed-step failure as time overflow', () =>
  Effect.gen(function* () {
    const loop = yield* makeGameLoop()
    injectedStepFailure.active = true

    yield* loop.start(() => Effect.void)
    yield* loop.submitFrame(MonotonicTimeSecs(0))

    for (let attempt = 0; attempt < 100 && injectedStepFailure.calls === 0; attempt += 1) {
      yield* Effect.yieldNow
    }

    expect(injectedStepFailure.calls).toBe(1)
    expect(Option.isNone(yield* loop.timeOverflow)).toBe(true)
    yield* loop.stop
  }),
)
