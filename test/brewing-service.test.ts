import { Effect, Result } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { BrewingService, BrewingServiceLayer, makeBrewingService } from '../src/application/brewing-service.js'
import { BREWING_FUEL_ITEM, BREWING_TIME_SECS } from '../src/domain/brewing.js'
import { itemStack } from '../src/domain/inventory.js'

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

describe('BrewingService', () => {
  it.effect('loads bottles and ingredient, charges fuel and brews through the service', () =>
    Effect.gen(function* () {
      const brewing = yield* makeBrewingService()
      yield* brewing.setBottle(0, must(itemStack('water_bottle', 1)))
      yield* brewing.setBottle(1, must(itemStack('water_bottle', 1)))
      yield* brewing.setIngredient(must(itemStack('nether_wart', 1)))
      yield* brewing.setFuel(must(itemStack(BREWING_FUEL_ITEM, 1)))
      yield* brewing.addFuel

      const outcome = yield* brewing.advance(BREWING_TIME_SECS)
      expect(outcome.brewedCount).toBe(1)
      expect((yield* brewing.snapshot).bottles).toEqual([
        must(itemStack('awkward_potion', 1)),
        must(itemStack('awkward_potion', 1)),
        undefined,
      ])
    }),
  )

  it.effect('preserves state after invalid commands and failed restore', () =>
    Effect.gen(function* () {
      const brewing = yield* makeBrewingService()
      yield* brewing.setBottle(0, must(itemStack('water_bottle', 1)))
      const before = yield* brewing.snapshot

      const invalidBottle = yield* Effect.result(brewing.setBottle(3, undefined))
      expect(Result.isFailure(invalidBottle)).toBe(true)
      const invalidAdvance = yield* Effect.result(brewing.advance(-1))
      expect(Result.isFailure(invalidAdvance)).toBe(true)
      const invalidRestore = yield* Effect.result(brewing.restore({ bottles: [] }))
      expect(Result.isFailure(invalidRestore)).toBe(true)
      expect(yield* brewing.snapshot).toBe(before)
    }),
  )

  it.effect('caps fuel, restores a snapshot and resets the service', () =>
    Effect.gen(function* () {
      const brewing = yield* makeBrewingService()
      yield* brewing.setFuel(must(itemStack(BREWING_FUEL_ITEM, 64)))
      for (let charge = 0; charge < 21; charge += 1) yield* brewing.addFuel
      expect((yield* brewing.snapshot).fuelCharges).toBe(20)

      const saved = yield* brewing.snapshot
      yield* brewing.reset
      expect((yield* brewing.snapshot).fuelCharges).toBe(0)
      yield* brewing.restore(saved)
      expect((yield* brewing.snapshot).fuelCharges).toBe(20)
    }),
  )

  it.effect('validates initial state and provides a fresh service from its layer', () =>
    Effect.gen(function* () {
      const invalidInitial = yield* Effect.result(makeBrewingService({ bottles: [] }))
      expect(Result.isFailure(invalidInitial)).toBe(true)

      const brewing = yield* BrewingService
      expect((yield* brewing.snapshot).fuelCharges).toBe(0)
    }).pipe(Effect.provide(BrewingServiceLayer)),
  )
})
