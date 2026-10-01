import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { EndStateServiceLayer, makeEndStateService } from '../src/application/end-state-service.js'
import { FishingServiceLayer, makeFishingService } from '../src/application/fishing-service.js'
import { FluidServiceLayer, makeFluidService } from '../src/application/fluid-service.js'
import { PortalServiceLayer, makePortalService } from '../src/application/portal-service.js'
import { ProjectileChargeServiceLayer, makeProjectileChargeService } from '../src/application/projectile-charge-service.js'
import { VillagerServiceLayer, makeVillagerService } from '../src/application/villager-service.js'

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
      yield* service.restore({ entries: [{ id: 'restored', active: true }] })
      expect(yield* service.snapshot).toStrictEqual({ entries: [{ id: 'restored', active: true }] })
      expect(PortalServiceLayer()).toBeDefined()
    }))

  it.effect('holds end state and restores a complete typed value', () =>
    Effect.gen(function* () {
      const service = yield* makeEndStateService()
      yield* service.update((state) => ({ entries: [...state.entries, 'frame:0'] }))
      yield* service.restore({ entries: ['frame:1'] })
      expect(yield* service.snapshot).toStrictEqual({ entries: ['frame:1'] })
      yield* service.reset
      expect(yield* service.snapshot).toStrictEqual({ entries: [] })
      expect(EndStateServiceLayer()).toBeDefined()
    }))

  it.effect('holds projectile charge state without applying charge rules', () =>
    Effect.gen(function* () {
      const service = yield* makeProjectileChargeService()
      const updated = yield* service.update((state) => ({
        charges: [...state.charges, { id: 'arrow:0', charge: 0.5 }],
      }))
      expect(updated).toStrictEqual({ charges: [{ id: 'arrow:0', charge: 0.5 }] })
      expect(yield* service.snapshot).toStrictEqual(updated)
      yield* service.restore({ charges: [{ id: 'arrow:1', charge: 1 }] })
      yield* service.reset
      expect(yield* service.snapshot).toStrictEqual({ charges: [] })
      expect(ProjectileChargeServiceLayer()).toBeDefined()
    }))

  it.effect('holds fluid state and reset replaces the whole snapshot', () =>
    Effect.gen(function* () {
      const service = yield* makeFluidService({ entries: [{ key: '0,64,0', fluid: 'water', level: 3 }] })
      yield* service.update((state) => ({
        entries: [...state.entries, { key: '1,64,0', fluid: 'water', level: 2 }],
      }))
      yield* service.reset
      expect(yield* service.snapshot).toStrictEqual({ entries: [] })
      yield* service.restore({ entries: [{ key: '2,64,0', fluid: 'water', level: 1 }] })
      expect(yield* service.snapshot).toStrictEqual({ entries: [{ key: '2,64,0', fluid: 'water', level: 1 }] })
      expect(FluidServiceLayer()).toBeDefined()
    }))

  it.effect('holds fishing state and leaves update decisions to the caller', () =>
    Effect.gen(function* () {
      const service = yield* makeFishingService()
      yield* service.update((state) => ({ entries: [...state.entries, { id: 'player:0', active: true }] }))
      expect(yield* service.snapshot).toStrictEqual({ entries: [{ id: 'player:0', active: true }] })
      yield* service.restore({ entries: [{ id: 'player:1', active: false }] })
      yield* service.reset
      expect(yield* service.snapshot).toStrictEqual({ entries: [] })
      expect(FishingServiceLayer()).toBeDefined()
    }))

  it.effect('holds villager trade state and updates it in one atomic value', () =>
    Effect.gen(function* () {
      const service = yield* makeVillagerService()
      yield* service.update((state) => ({ entries: [...state.entries, { id: 'trade:0', uses: 1 }] }))
      yield* service.restore({ entries: [{ id: 'trade:0', uses: 2 }] })
      expect(yield* service.snapshot).toStrictEqual({ entries: [{ id: 'trade:0', uses: 2 }] })
      yield* service.reset
      expect(yield* service.snapshot).toStrictEqual({ entries: [] })
      expect(VillagerServiceLayer()).toBeDefined()
    }))

})
