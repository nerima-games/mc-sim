import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeVitalsService, VitalsServiceLayer, VitalsService } from '../src/application/vitals-service'
import { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import { isDead, isValidVitals, SPAWN_VITALS, type Vitals } from '../src/domain/vitals'

const dt = (seconds: number): DeltaTimeSecs => DeltaTimeSecs(seconds)

/**
 * THE regression test for the death signal.
 *
 * "Did this blow kill the player" is a comparison of the state before a write
 * with the state after it. Computed outside the write it is a read-decide-write
 * that another fiber can interleave with, and the two failures are symmetric: a
 * death screen that appears twice, and one that never appears. The reference
 * fuses the same decision into one `Ref.modify`
 * (ts-minecraft/packages/entity/application/health-service.ts:68-85).
 */
describe('REGRESSION: exactly one blow reports the kill', () => {
  it.effect('the fatal blow reports died, and the next one does not', () =>
    Effect.gen(function* () {
      const vitals = yield* makeVitalsService()

      const survived = yield* vitals.damage({ amount: 19, cause: 'fall' })
      expect(survived.died).toBe(false)
      expect(survived.vitals.healthPoints).toBe(1)

      const fatal = yield* vitals.damage({ amount: 1, cause: 'lava' })
      expect(fatal.died).toBe(true)
      expect(fatal.vitals.lastDamageCause).toBe('lava')

      const posthumous = yield* vitals.damage({ amount: 100, cause: 'explosion' })
      expect(posthumous.died).toBe(false)
      expect(posthumous.vitals.lastDamageCause).toBe('lava')
    }),
  )

  /**
   * A NOTE ON WHAT THIS TEST DOES NOT CATCH, measured rather than assumed.
   *
   * The obvious mutation — rewriting `damage` as a `Ref.get` followed by a
   * separate `Ref.updateAndGet` and deciding `died` across the two — leaves this
   * test GREEN. Effect's fibers did not interleave between those two operations
   * under `Effect.all({ concurrency: 'unbounded' })`, so the read-decide-write
   * was never actually torn. The test above it, which mutates `died` into
   * `isDead(next)`, is the one that goes red.
   *
   * So this test pins the INVARIANT and not the implementation, and the atomic
   * form in `application/vitals-service.ts` rests on the argument in its header
   * rather than on this assertion. That is worth knowing before anyone deletes
   * the `Ref.modify` on the grounds that the suite still passes.
   */
  it.effect('twenty concurrent blows produce exactly one kill between them', () =>
    Effect.gen(function* () {
      const vitals = yield* makeVitalsService()

      // Each blow is one point against twenty health. Whatever order the fibers
      // interleave in, precisely one of them must be the transition.
      const outcomes = yield* Effect.all(
        Array.from({ length: 20 }, () => vitals.damage({ amount: 1, cause: 'suffocation' })),
        { concurrency: 'unbounded' },
      )

      expect(outcomes.filter((outcome) => outcome.died).length).toBe(1)
      expect(isDead(yield* vitals.snapshot)).toBe(true)
    }),
  )

  it.effect('a NaN blow reports no death and leaves a killable player', () =>
    Effect.gen(function* () {
      const vitals = yield* makeVitalsService()

      const nothing = yield* vitals.damage({ amount: Number.NaN, cause: 'generic' })
      expect(nothing.died).toBe(false)
      expect(nothing.vitals.healthPoints).toBe(20)

      const fatal = yield* vitals.damage({ amount: 20, cause: 'void' })
      expect(fatal.died).toBe(true)
    }),
  )
})

describe('the service reads no clock', () => {
  it.effect('the food timer advances only by the delta it is handed', () =>
    Effect.gen(function* () {
      const vitals = yield* makeVitalsService({ ...SPAWN_VITALS, healthPoints: 10 })

      // `it.effect` supplies a TestClock that nothing here touches. Four seconds
      // of world time cost zero seconds of anything, which is what
      // `pnpm check:deps`' ban on wall-clock reads is protecting.
      expect(yield* vitals.advanceFoodTimer(dt(2))).toBe('none')
      expect(yield* vitals.advanceFoodTimer(dt(1.9))).toBe('none')
      expect(yield* vitals.advanceFoodTimer(dt(0.1))).toBe('regen')
    }),
  )

  it.effect('the same deltas from the same start reach the same state, always', () =>
    Effect.gen(function* () {
      const runOnce = Effect.gen(function* () {
        const vitals = yield* makeVitalsService()
        yield* vitals.damage({ amount: 7, cause: 'fall' })
        yield* vitals.addExhaustion(9.5)
        yield* vitals.addExperience(123)
        for (let frame = 0; frame < 500; frame++) {
          yield* vitals.advanceFoodTimer(dt(0.016))
        }
        return yield* vitals.snapshot
      })

      expect(yield* runOnce).toEqual(yield* runOnce)
    }),
  )
})

describe('the world-load path', () => {
  it.effect('restore repairs rather than refuses, and leaves a valid state', () =>
    Effect.gen(function* () {
      const vitals = yield* makeVitalsService()

      const fromDisk: Vitals = {
        healthPoints: Number.NaN,
        maxHealthPoints: 0,
        hungerPoints: 99,
        maxHungerPoints: Number.POSITIVE_INFINITY,
        saturation: -3,
        exhaustion: 1e9,
        foodTimerSecs: Number.NaN,
        totalExperience: Number.NEGATIVE_INFINITY,
        lastDamageCause: undefined,
      }

      yield* vitals.restore(fromDisk)
      const restored = yield* vitals.snapshot

      expect(isValidVitals(restored)).toBe(true)
      expect(isValidVitals(fromDisk)).toBe(false)
    }),
  )

  it.effect('a layer constructed from a corrupt save is repaired too', () =>
    Effect.gen(function* () {
      // The second entry point. `makeTimeService`'s header records what happened
      // in this repository when only `restore` was guarded.
      const restored = yield* Effect.flatMap(VitalsService, (service) => service.snapshot).pipe(
        Effect.provide(
          VitalsServiceLayer({ ...SPAWN_VITALS, healthPoints: Number.NaN, saturation: 400 }),
        ),
      )

      expect(isValidVitals(restored)).toBe(true)
    }),
  )

  it.effect('reset returns the spawn vitals, so a second world inherits nothing (DN-09)', () =>
    Effect.gen(function* () {
      const vitals = yield* makeVitalsService()

      yield* vitals.damage({ amount: 20, cause: 'lava' })
      yield* vitals.addExperience(500)
      yield* vitals.reset

      expect(yield* vitals.snapshot).toEqual(SPAWN_VITALS)
    }),
  )

  it.effect('respawn is not reset: the record of what a rule owns survives it', () =>
    Effect.gen(function* () {
      const vitals = yield* makeVitalsService()

      yield* vitals.addExperience(500)
      yield* vitals.damage({ amount: 20, cause: 'lava' })
      yield* vitals.respawn

      const alive = yield* vitals.snapshot
      expect(alive.healthPoints).toBe(20)
      expect(alive.lastDamageCause).toBeUndefined()
      expect(alive.totalExperience).toBe(500)
    }),
  )
})

describe('the view the HUD reads', () => {
  it.effect('it moves with the state, through the service', () =>
    Effect.gen(function* () {
      const vitals = yield* makeVitalsService()

      yield* vitals.damage({ amount: 5, cause: 'fall' })
      yield* vitals.addExhaustion(24)
      yield* vitals.addExperience(16)

      expect(yield* vitals.view).toEqual({
        healthPoints: 15,
        maxHealthPoints: 20,
        hungerPoints: 19,
        maxHungerPoints: 20,
        experienceLevel: 2,
        experienceProgress: 0,
      })
    }),
  )

  it.effect('two independent services do not share a player', () =>
    Effect.gen(function* () {
      // `makeVitalsService` is exported separately from the Layer for the reason
      // `makeTimeService` is: mc-playground-kit runs several worlds in one
      // process, and an app-scoped singleton would make them fight.
      const first = yield* makeVitalsService()
      const second = yield* makeVitalsService()

      yield* first.damage({ amount: 20, cause: 'void' })

      expect(isDead(yield* first.snapshot)).toBe(true)
      expect(isDead(yield* second.snapshot)).toBe(false)
    }),
  )
})
