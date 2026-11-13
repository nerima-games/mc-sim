import fc from 'fast-check'
import { Result } from 'effect'
import { expect, it } from '@effect/vitest'
import { NonNegativeTickCount, secondsForTicks } from '@nerima-games/mc-kernel'
import { itemStack } from '../src/domain/inventory.js'
import {
  advanceFurnace,
  advanceFurnaceTicks,
  emptyFurnaceState,
  furnaceState,
} from '../src/domain/smelting.js'
import { TICKS_PER_SECOND } from '../src/domain/time-of-day.js'
import { invoke } from './public-property-helpers.js'

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const ironFurnace = must(furnaceState({
  input: must(itemStack('iron_ore', 1)),
  fuel: must(itemStack('coal', 1)),
}))

it('furnace tick advancement matches elapsed-time advancement at the fixed tick rate', () => {
  expect(TICKS_PER_SECOND).toBe(20)
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 400 }), (elapsedTicks) => {
      const elapsedSecs = must(secondsForTicks(NonNegativeTickCount(elapsedTicks)))
      expect(advanceFurnaceTicks(ironFurnace, NonNegativeTickCount(elapsedTicks))).toStrictEqual(
        advanceFurnace(ironFurnace, elapsedSecs),
      )
    }),
    { numRuns: 64, seed: 0x4655524e },
  )
})

it('furnace tick advancement accepts zero and one tick and rejects values outside integer bounds', () => {
  expect(Result.isSuccess(advanceFurnaceTicks(must(emptyFurnaceState()), NonNegativeTickCount(0)))).toBe(true)
  expect(Result.isSuccess(advanceFurnaceTicks(must(emptyFurnaceState()), NonNegativeTickCount(1)))).toBe(true)

  for (const ticks of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    expect(invoke(advanceFurnaceTicks, [must(emptyFurnaceState()), ticks])).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'FurnaceStateValidationFailure',
        path: 'elapsedTicks',
      },
    })
  }
})
