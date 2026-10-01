import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeFurnaceService } from '../src/application/furnace-service.js'
import { itemStack } from '../src/domain/inventory.js'

describe('FurnaceService', () => {
  it.effect('advances the domain furnace through the Ref boundary', () =>
    Effect.gen(function* () {
      const service = yield* makeFurnaceService()
      yield* service.setInput(itemStack('raw_iron', 1))
      yield* service.setFuel(itemStack('coal', 1))

      const outcome = yield* service.advance(10)

      expect(outcome.smelted).toBe(1)
      expect((yield* service.snapshot).output?.item).toBe('iron_ingot')
    }))

  it.effect('rejects malformed restore input without changing state', () =>
    Effect.gen(function* () {
      const service = yield* makeFurnaceService()
      yield* service.setInput(itemStack('raw_iron', 1))
      const before = yield* service.snapshot

      const error = yield* service.restore({ input: 'raw_iron' }).pipe(Effect.flip)

      expect(error._tag).toBe('FurnaceSnapshotValidationError')
      expect(yield* service.snapshot).toStrictEqual(before)
    }))
})
