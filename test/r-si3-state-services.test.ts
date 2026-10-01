import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeFishingService } from '../src/application/fishing-service.js'
import { makeFluidService } from '../src/application/fluid-service.js'
import { makeEndStateService } from '../src/application/end-state-service.js'
import { makePortalService } from '../src/application/portal-service.js'
import { makeProjectileChargeService } from '../src/application/projectile-charge-service.js'
import { makeVillagerService } from '../src/application/villager-service.js'

describe('R-SI3 state services', () => {
  it.effect('holds portal state and applies concurrent updates atomically', () =>
    Effect.gen(function* () {
      const service = yield* makePortalService()
      yield* Effect.all([
        service.update((state) => ({ entries: [...state.entries, { id: 'a', active: true }] })),
        service.update((state) => ({ entries: [...state.entries, { id: 'b', active: false }] })),
      ], { concurrency: 'unbounded' })
      expect((yield* service.snapshot).entries).toHaveLength(2)
      yield* service.reset
      expect(yield* service.snapshot).toStrictEqual({ entries: [] })
    }))

  it.effect('holds end state and restores a complete typed value', () =>
    Effect.gen(function* () {
      const service = yield* makeEndStateService()
      yield* service.update((state) => ({ entries: [...state.entries, 'frame:0'] }))
      yield* service.restore({ entries: ['frame:1'] })
      expect(yield* service.snapshot).toStrictEqual({ entries: ['frame:1'] })
    }))

  it.effect('holds projectile charge state without applying charge rules', () =>
    Effect.gen(function* () {
      const service = yield* makeProjectileChargeService()
      const updated = yield* service.update((state) => ({
        charges: [...state.charges, { id: 'arrow:0', charge: 0.5 }],
      }))
      expect(updated).toStrictEqual({ charges: [{ id: 'arrow:0', charge: 0.5 }] })
      expect(yield* service.snapshot).toStrictEqual(updated)
    }))

  it.effect('holds fluid state and reset replaces the whole snapshot', () =>
    Effect.gen(function* () {
      const service = yield* makeFluidService({ entries: [{ key: '0,64,0', fluid: 'water', level: 3 }] })
      yield* service.update((state) => ({
        entries: [...state.entries, { key: '1,64,0', fluid: 'water', level: 2 }],
      }))
      yield* service.reset
      expect(yield* service.snapshot).toStrictEqual({ entries: [] })
    }))

  it.effect('holds fishing state and leaves update decisions to the caller', () =>
    Effect.gen(function* () {
      const service = yield* makeFishingService()
      yield* service.update((state) => ({ entries: [...state.entries, { id: 'player:0', active: true }] }))
      expect(yield* service.snapshot).toStrictEqual({ entries: [{ id: 'player:0', active: true }] })
    }))

  it.effect('holds villager trade state and updates it in one atomic value', () =>
    Effect.gen(function* () {
      const service = yield* makeVillagerService()
      yield* service.update((state) => ({ entries: [...state.entries, { id: 'trade:0', uses: 1 }] }))
      yield* service.restore({ entries: [{ id: 'trade:0', uses: 2 }] })
      expect(yield* service.snapshot).toStrictEqual({ entries: [{ id: 'trade:0', uses: 2 }] })
    }))

})
