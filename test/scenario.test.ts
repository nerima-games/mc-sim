/**
 * The deterministic scenario test (plan.md §3.8 検証).
 *
 * "Spawn -> mine -> assert the inventory", run headless in Node at whatever
 * speed the CPU allows, with the clock injected so a simulated week costs
 * microseconds. This file is the template every later scenario follows.
 *
 * Two properties are being pinned down, and they are the two that plan.md §5.1
 * says had to be designed in on day one because they cannot be retrofitted:
 *
 *   3. determinism through an injected clock — no `Date.now()` anywhere, so
 *      the same script produces the same world every time and can be replayed;
 *   2. the camera pose is owned by the simulation — the pose is computed and
 *      asserted with no renderer in the process at all, which is only possible
 *      because nothing here asks a THREE camera anything.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref } from 'effect'
import { forwardVector, snapshotAgeSecs } from '../domain/camera-pose'
import { DeltaTimeSecs, EpochMillis, MonotonicTimeSecs, position } from '../domain/kernel-vocabulary'
import { ClockPort, FixedClockLayer } from '../domain/kernel-vocabulary'
import {
  InventoryService,
  InventoryServiceLayer,
  makeInventoryService,
} from '../application/inventory-service'
import { PlayerService, PlayerServiceLayer } from '../application/player-service'
import { TimeService, TimeServiceLayer } from '../application/time-service'

/**
 * A clock the test drives by hand.
 *
 * This is the fast-forward mechanism. `tick(secs)` moves simulated time without
 * any real time passing, so "wait until the next in-game dawn" is an
 * arithmetic operation rather than a twenty-minute test.
 */
const controllableClock = Effect.gen(function* () {
  const nowRef = yield* Ref.make(0)
  const layer = Layer.succeed(ClockPort, {
    monotonicSecs: Ref.get(nowRef).pipe(Effect.map((value) => MonotonicTimeSecs(value))),
    // Frozen, and deliberately unrelated to `nowRef`: the wall clock is not a
    // second monotonic clock, and a test that let the two move together would
    // hide a `wallClockEpochMillis` used for a duration. See
    // domain/kernel-vocabulary.ts on why the mirror carries both fields.
    wallClockEpochMillis: Effect.succeed(EpochMillis(1_700_000_000_000)),
  })
  return {
    layer,
    tick: (seconds: number) => Ref.update(nowRef, (value) => value + seconds),
  }
})

const SimulationLayer = Layer.mergeAll(
  InventoryServiceLayer(),
  PlayerServiceLayer(),
  TimeServiceLayer(),
)

describe('deterministic scenario: spawn -> look -> mine -> assert', () => {
  it.effect('runs the whole loop headless, with time supplied rather than observed', () =>
    Effect.gen(function* () {
      const clock = yield* controllableClock

      const scenario = Effect.gen(function* () {
        const player = yield* PlayerService
        const inventory = yield* InventoryService
        const time = yield* TimeService

        // --- spawn -------------------------------------------------------
        yield* time.configureDay(600, 0.25)
        yield* player.moveTo(position(8, 64, -8))

        expect(yield* time.timeOfDay).toBeCloseTo(0.25, 12)
        expect(yield* time.isNight).toBe(false)
        expect(yield* inventory.countOf('STONE')).toBe(0)

        // --- look --------------------------------------------------------
        yield* player.look(Math.PI / 2, -0.4)
        const pose = yield* player.cameraPose

        // The eye is 1.62 above the feet: the simulation applies the offset,
        // not the renderer. If this ever moves to the renderer the block the
        // player targets and the block they see highlighted will disagree.
        expect(pose.position).toStrictEqual(position(8, 64 + 1.62, -8))
        expect(pose.capturedAtSecs).toBe(0)

        // Yaw pi/2 with zero pitch looks down -X. Computed from the snapshot,
        // with no THREE camera in the process to ask.
        const flat = forwardVector({ ...pose, pitchRadians: 0 })
        expect(flat.x).toBeCloseTo(-1, 12)
        expect(flat.z).toBeCloseTo(0, 12)

        // --- mine, twice, and once more into a partially-filled stack -----
        expect(yield* inventory.add('STONE', 1)).toBe(0)
        expect(yield* inventory.add('STONE', 1)).toBe(0)
        expect(yield* inventory.add('DIRT', 3)).toBe(0)
        expect(yield* inventory.countOf('STONE')).toBe(2)
        expect(yield* inventory.countOf('DIRT')).toBe(3)

        // --- fast-forward six in-game minutes ----------------------------
        yield* clock.tick(360)
        yield* time.advance(DeltaTimeSecs(360))

        // 360 s into a 600 s day, starting at 0.25 -> 0.85. Past dusk.
        expect(yield* time.timeOfDay).toBeCloseTo(0.85, 12)
        expect(yield* time.isNight).toBe(true)

        // The pose the renderer would mirror is now stamped later, and the
        // earlier snapshot is measurably stale.
        const later = yield* player.cameraPose
        expect(later.capturedAtSecs).toBe(360)
        expect(snapshotAgeSecs(pose, later.capturedAtSecs)).toBe(360)

        // --- craft: spend the stone --------------------------------------
        expect(yield* inventory.remove('STONE', 5)).toBe(2)
        expect(yield* inventory.countOf('STONE')).toBe(0)
        expect(yield* inventory.countOf('DIRT')).toBe(3)
      })

      yield* scenario.pipe(Effect.provide(SimulationLayer), Effect.provide(clock.layer))
    }),
  )

  it.effect('is reproducible: the same script twice produces byte-identical state', () =>
    Effect.gen(function* () {
      const run = Effect.gen(function* () {
        const player = yield* PlayerService
        const inventory = yield* InventoryService
        const time = yield* TimeService

        yield* time.configureDay(600, 0.1)
        yield* player.moveTo(position(1, 70, 2))
        yield* player.look(0.7, 0.2)
        yield* inventory.add('COBBLESTONE', 130)
        yield* Effect.forEach([1, 2, 3, 4, 5], (step) => time.advance(DeltaTimeSecs(step * 10)))

        return {
          pose: yield* player.cameraPose,
          time: yield* time.snapshot,
          inventory: yield* inventory.snapshot,
        }
      }).pipe(
        Effect.provide(SimulationLayer),
        Effect.provide(
          FixedClockLayer({
            monotonicSecs: MonotonicTimeSecs(42),
            wallClockEpochMillis: EpochMillis(1_700_000_000_000),
          }),
        ),
      )

      const first = yield* run
      const second = yield* run

      expect(second).toStrictEqual(first)
      // 130 cobblestone is three slots: 64 + 64 + 2.
      expect(first.inventory.slots.filter((slot) => slot !== undefined)).toHaveLength(3)
    }),
  )

  it.effect('each Layer build is an independent world, which is what re-entrancy needs', () =>
    Effect.gen(function* () {
      // Two worlds in one process, as mc-playground-kit will run two previews
      // side by side. The reference's app-scoped singletons made the second
      // world inherit the first world's player and fail to start
      // (ts-minecraft/packages/game/application/game-state-service.ts:87-92).
      const worldA = yield* makeInventoryService()
      const worldB = yield* makeInventoryService()

      yield* worldA.add('STONE', 7)

      expect(yield* worldA.countOf('STONE')).toBe(7)
      expect(yield* worldB.countOf('STONE')).toBe(0)

      // ...and a reset makes a world reusable, so a second `start` on the same
      // instance is a clean slate rather than an inherited one.
      yield* worldA.reset
      expect(yield* worldA.countOf('STONE')).toBe(0)
    }),
  )
})
