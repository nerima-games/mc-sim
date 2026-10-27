import { Effect, Result } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { FurnaceService, FurnaceServiceLayer, makeFurnaceService } from '../src/application/furnace-service.js'
import { emptyInventory, itemStack } from '../src/domain/inventory.js'
import { VANILLA_SMELTING_RECIPES } from '../src/domain/smelting.js'

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

describe('FurnaceService', () => {
  it.effect('ticks a vanilla recipe, collects output and resets collected experience', () =>
    Effect.gen(function* () {
      const furnace = yield* makeFurnaceService()
      yield* furnace.setInput(must(itemStack('iron_ore', 1)))
      yield* furnace.setFuel(must(itemStack('coal', 1)))

      const recipe = VANILLA_SMELTING_RECIPES.find((candidate) => candidate.input === 'iron_ore')
      expect(recipe).toBeDefined()
      const outcome = yield* furnace.advance(10)
      expect(outcome.smeltedCount).toBe(1)
      expect((yield* furnace.snapshot).output?.item).toBe('iron_ingot')

      const collected = yield* furnace.collectOutput(emptyInventory())
      expect(collected.result._tag).toBe('Collected')
      expect(collected.inventory.slots.some((slot) => slot?.item === 'iron_ingot')).toBe(true)
      expect((yield* furnace.snapshot).output).toBeUndefined()

      const experience = yield* furnace.collectExperience
      expect(experience).toBeGreaterThan(0)
      expect(yield* furnace.collectExperience).toBe(0)
    }),
  )

  it.effect('keeps state when advance, collection or restore fails', () =>
    Effect.gen(function* () {
      const furnace = yield* makeFurnaceService()
      yield* furnace.setInput(must(itemStack('iron_ore', 1)))
      yield* furnace.setFuel(must(itemStack('coal', 1)))
      const before = yield* furnace.snapshot

      const invalidAdvance = yield* Effect.result(furnace.advance(-1))
      expect(Result.isFailure(invalidAdvance)).toBe(true)
      expect(yield* furnace.snapshot).toBe(before)

      yield* furnace.advance(10)
      const readyToCollect = yield* furnace.snapshot

      const blocked = yield* furnace.collectOutput({
        slots: Array.from({ length: 36 }, () => must(itemStack('cobblestone', 64))),
      })
      expect(blocked.result._tag).toBe('NoRoom')
      expect(yield* furnace.snapshot).toBe(readyToCollect)

      const invalidRestore = yield* Effect.result(furnace.restore({}))
      expect(Result.isFailure(invalidRestore)).toBe(true)
      expect(yield* furnace.snapshot).toBe(readyToCollect)
    }),
  )

  it.effect('validates initial state, restores snapshots and resets the service', () =>
    Effect.gen(function* () {
      const invalidInitial = yield* Effect.result(makeFurnaceService({ station: 'campfire' }))
      expect(Result.isFailure(invalidInitial)).toBe(true)

      const furnace = yield* makeFurnaceService()
      yield* furnace.setInput(must(itemStack('iron_ore', 1)))
      const saved = yield* furnace.snapshot
      yield* furnace.reset
      expect((yield* furnace.snapshot).input).toBeUndefined()
      yield* furnace.restore(saved)
      expect((yield* furnace.snapshot).input?.item).toBe('iron_ore')
    }),
  )

  it.effect('provides a fresh service from its layer', () =>
    Effect.gen(function* () {
      const furnace = yield* FurnaceService
      expect((yield* furnace.snapshot).station).toBe('furnace')
    }).pipe(Effect.provide(FurnaceServiceLayer)),
  )
})
