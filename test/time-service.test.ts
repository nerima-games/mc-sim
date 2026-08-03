/**
 * REGRESSION: the world-LOAD path.
 *
 * `--stats` recorded that "no test covers a load, because no test loads a
 * world", and two defects lived in exactly that gap:
 *
 *   - `restore` installed whatever it was handed, so a save with
 *     `dayLengthTicks: 0` made every reader NaN while `isNight` answered
 *     `false` — a world stuck in permanent daylight that nothing could detect.
 *   - `configureDay` was documented as what "world bootstrap AND world load"
 *     should call, and for a load it silently reset the absolute day counter,
 *     so a world reloaded that way came back on moon phase 0 whatever night it
 *     had been saved on.
 *
 * Both are about the same thing: a load must put back the state that was saved,
 * and the only method that can is `restore`.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { DeltaTimeSecs } from "@nerima-games/mc-kernel"
import { INITIAL_TIME_STATE } from '../src/domain/time-of-day'
import { makeTimeService } from '../src/application/time-service'

describe('REGRESSION: restore repairs a corrupt save instead of reporting permanent daylight', () => {
  it.effect('a zero day length no longer makes every reader NaN', () =>
    Effect.gen(function* () {
      const time = yield* makeTimeService()
      yield* time.restore({ ticks: 0, dayLengthTicks: 0 })

      expect(Number.isNaN(yield* time.timeOfDay)).toBe(false)
      expect(Number.isNaN(yield* time.moonPhase)).toBe(false)
      expect(yield* time.dayLengthSecs).toBe(120)
      expect(yield* time.timeOfDay).toBe(0)
    }),
  )

  it.effect('isNight reports a real answer, where a NaN fraction made it report DAY forever', () =>
    Effect.gen(function* () {
      // The failure this guards is not "NaN leaked". It is that NaN < 0.25 and
      // NaN > 0.75 are BOTH false, so the corrupt world reported the boolean
      // `false` — daylight — and mobs never spawned. A caller acting on the
      // boolean had nothing to check.
      const time = yield* makeTimeService()
      yield* time.restore({ ticks: 0, dayLengthTicks: 0 })

      expect(yield* time.isNight).toBe(true)
    }),
  )

  it.effect('the repaired world responds to the documented setters again', () =>
    Effect.gen(function* () {
      // Previously `setTimeOfDay` could not recover it, because it writes
      // `fraction * dayLengthTicks` and 0.5 x 0 is 0; `advance` could not
      // either, because 60 % 0 is NaN. Only `setDayLength` could, which is the
      // one method the corruption report did not point a reader at.
      const time = yield* makeTimeService()
      yield* time.restore({ ticks: 0, dayLengthTicks: 0 })

      yield* time.setTimeOfDay(0.5)
      expect(yield* time.timeOfDay).toBeCloseTo(0.5, 12)

      yield* time.advance(DeltaTimeSecs(30))
      expect(yield* time.timeOfDay).toBeCloseTo(0.75, 12)
      expect(yield* time.isNight).toBe(false)
    }),
  )

  it.effect('a HEALTHY save round-trips byte-identically, so the repair costs a good world nothing', () =>
    Effect.gen(function* () {
      const time = yield* makeTimeService()
      yield* time.configureDay(600, 0.25)
      yield* time.advance(DeltaTimeSecs(600 * 4))
      const saved = yield* time.snapshot

      const loaded = yield* makeTimeService()
      yield* loaded.restore(saved)

      expect(yield* loaded.snapshot).toStrictEqual(saved)
    }),
  )

  it.effect('the CONSTRUCTOR is guarded too — a Layer cannot start life in permanent daylight', () =>
    Effect.gen(function* () {
      // `TimeServiceLayer(loadedState)` is the natural way a host supplies a
      // loaded world at layer-construction time, and it bypasses `restore`
      // entirely. Guarding only `restore` would have left the defect with a
      // second entry point and no test on it.
      const time = yield* makeTimeService({ ticks: 100, dayLengthTicks: 0 })

      expect(Number.isNaN(yield* time.timeOfDay)).toBe(false)
      expect(Number.isNaN(yield* time.moonPhase)).toBe(false)
      expect(yield* time.dayLengthSecs).toBe(120)
      // The tick counter was legal and is therefore untouched.
      expect((yield* time.snapshot).ticks).toBe(100)
    }),
  )

  it.effect('the default constructor is unaffected, so a fresh world is still the documented one', () =>
    Effect.gen(function* () {
      const time = yield* makeTimeService()

      expect(yield* time.snapshot).toStrictEqual(INITIAL_TIME_STATE)
    }),
  )
})

describe('REGRESSION: world load is restore, not configureDay — the day counter must survive', () => {
  it.effect('restore keeps the absolute tick counter, so the moon phase comes back as saved', () =>
    Effect.gen(function* () {
      const time = yield* makeTimeService()
      // Four in-game days at the fresh-world 400 s day: 7200 + 4 * 24000.
      yield* time.advance(DeltaTimeSecs(400 * 4))
      const saved = yield* time.snapshot

      expect(saved.ticks).toBe(103_200)
      expect(yield* time.moonPhase).toBe(4)

      const loaded = yield* makeTimeService()
      yield* loaded.restore(saved)

      expect((yield* loaded.snapshot).ticks).toBe(103_200)
      expect(yield* loaded.moonPhase).toBe(4)
    }),
  )

  it.effect('configureDay with the SAME arguments throws the day number away — hence bootstrap only', () =>
    Effect.gen(function* () {
      // This is not a bug in `configureDay`: `setTimeOfDay` moves the state
      // into day zero by design, and bootstrap wants that. It is a bug in
      // calling it on the load path, which the doc comment used to invite.
      // Asserting the loss keeps the two paths visibly different.
      const time = yield* makeTimeService()
      yield* time.advance(DeltaTimeSecs(400 * 4))

      const dayLength = yield* time.dayLengthSecs
      const fraction = yield* time.timeOfDay
      expect(yield* time.moonPhase).toBe(4)

      yield* time.configureDay(dayLength, fraction)

      expect((yield* time.snapshot).ticks).toBe(7200)
      expect(yield* time.moonPhase).toBe(0)
      // The time of day is preserved. Only the day NUMBER is gone, which is
      // why nothing shorter than a four-day fast-forward can see it.
      expect(yield* time.timeOfDay).toBeCloseTo(fraction, 12)
    }),
  )

  it.effect('configureDay is still the right call for BOOTSTRAP, in the only safe order', () =>
    Effect.gen(function* () {
      const time = yield* makeTimeService()
      yield* time.configureDay(600, 0.3)

      expect(yield* time.dayLengthSecs).toBe(600)
      expect(yield* time.timeOfDay).toBeCloseTo(0.3, 12)
      expect(yield* time.moonPhase).toBe(0)
    }),
  )

  it.effect('reset-to-fresh is a restore, and lands on the documented fresh-world state', () =>
    Effect.gen(function* () {
      const time = yield* makeTimeService()
      yield* time.advance(DeltaTimeSecs(4000))
      yield* time.restore(INITIAL_TIME_STATE)

      expect(yield* time.snapshot).toStrictEqual({ ticks: 7200, dayLengthTicks: 24000 })
      expect(yield* time.isNight).toBe(false)
    }),
  )
})
