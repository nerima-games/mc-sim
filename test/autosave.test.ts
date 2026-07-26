/**
 * REGRESSION: an autosave tick is TOTAL, and the schedule is `spaced`.
 *
 * `Effect.repeat(effect, schedule)` re-runs the effect only while it SUCCEEDS.
 * If a failure escapes the repeated effect, autosave dies silently after the
 * first transient IndexedDB error and every later edit is lost at the next
 * crash. So recovery has to be INSIDE the tick, and it has to be
 * `catchAllCause` — a thrown exception is a `Cause.Die` that `catchAll` does
 * not see.
 */
import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Fiber, Ref, Schedule, TestClock } from 'effect'
import {
  AUTO_SAVE_INTERVAL,
  autoSaveSchedule,
  performAutoSaveTick,
  startAutoSaveDaemon,
  type AutoSaveStatus,
} from '../application/autosave'

const collectStatuses = Effect.gen(function* () {
  const seen = yield* Ref.make<ReadonlyArray<AutoSaveStatus>>([])
  return {
    seen,
    reporter: (status: AutoSaveStatus) => Ref.update(seen, (all) => [...all, status]),
  }
})

describe('performAutoSaveTick', () => {
  it.effect('reports saving then saved on the happy path', () =>
    Effect.gen(function* () {
      const probe = yield* collectStatuses
      yield* performAutoSaveTick(Effect.void, probe.reporter)

      expect(yield* Ref.get(probe.seen)).toStrictEqual(['saving', 'saved'])
    }),
  )

  it.effect('recovers from a TYPED failure and stays total', () =>
    Effect.gen(function* () {
      const probe = yield* collectStatuses
      yield* performAutoSaveTick(Effect.fail('quota exceeded' as const), probe.reporter)

      expect(yield* Ref.get(probe.seen)).toStrictEqual(['saving', 'error'])
    }),
  )

  it.effect('recovers from a DEFECT too — this is why it is catchAllCause, not catchAll', () =>
    Effect.gen(function* () {
      const probe = yield* collectStatuses
      yield* performAutoSaveTick(
        Effect.sync(() => {
          throw new Error('IDBTransaction aborted')
        }),
        probe.reporter,
      )

      expect(yield* Ref.get(probe.seen)).toStrictEqual(['saving', 'error'])
    }),
  )

  it.effect('a DEFECT in the status reporter cannot abort persistence', () =>
    Effect.gen(function* () {
      const saved = yield* Ref.make(false)
      yield* performAutoSaveTick(Ref.set(saved, true), () =>
        Effect.sync(() => {
          throw new Error('the saving indicator blew up')
        }),
      )

      expect(yield* Ref.get(saved)).toBe(true)
    }),
  )

  it.effect('works with no reporter at all', () =>
    Effect.gen(function* () {
      const saved = yield* Ref.make(0)
      yield* performAutoSaveTick(Ref.update(saved, (count) => count + 1))
      yield* performAutoSaveTick(Effect.fail('nope' as const))

      expect(yield* Ref.get(saved)).toBe(1)
    }),
  )
})

describe('REGRESSION: Schedule.spaced, not Schedule.fixed', () => {
  it.effect('the interval is measured from the END of the previous run', () =>
    Effect.gen(function* () {
      // The observable difference: with a 100 ms interval and a tick that takes
      // 40 ms, `spaced` fires every 140 ms and `fixed` every 100 ms. Over
      // 1000 ms of virtual time that is 7 runs versus 10 — and after a tab has
      // been backgrounded, `fixed` additionally fires every missed slot back to
      // back the moment it resumes, which is the stall the player sees.
      const runs = yield* Ref.make(0)
      const tick = Effect.sleep(Duration.millis(40)).pipe(
        Effect.zipRight(Ref.update(runs, (count) => count + 1)),
      )

      const fiber = yield* Effect.fork(
        Effect.repeat(tick, autoSaveSchedule(Duration.millis(100))),
      )

      yield* TestClock.adjust(Duration.millis(1000))
      yield* Fiber.interrupt(fiber)

      // Runs complete at 40, 180, 320, 460, 600, 740, 880 — the eighth would
      // land at 1020, past the window. Seven.
      expect(yield* Ref.get(runs)).toBe(7)
    }),
  )

  it.effect('Schedule.fixed would have produced a different, larger count', () =>
    Effect.gen(function* () {
      // Same tick, same window, the combinator we must NOT use. Asserting the
      // contrast is what makes the first test meaningful: without it, a change
      // from spaced to fixed could go unnoticed if the counts happened to
      // coincide for the chosen numbers.
      const runs = yield* Ref.make(0)
      const tick = Effect.sleep(Duration.millis(40)).pipe(
        Effect.zipRight(Ref.update(runs, (count) => count + 1)),
      )

      const fiber = yield* Effect.fork(Effect.repeat(tick, Schedule.fixed(Duration.millis(100))))

      yield* TestClock.adjust(Duration.millis(1000))
      yield* Fiber.interrupt(fiber)

      expect(yield* Ref.get(runs)).toBe(10)
    }),
  )

  it.effect('the default interval is the reference implementation value', () =>
    Effect.sync(() => {
      expect(Duration.toMillis(AUTO_SAVE_INTERVAL)).toBe(5000)
    }),
  )
})

describe('startAutoSaveDaemon', () => {
  it.effect('keeps saving after a failing tick, which fixed-outside-repeat would not', () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const persist = Ref.updateAndGet(attempts, (count) => count + 1).pipe(
        Effect.flatMap((count) => (count === 2 ? Effect.fail('transient' as const) : Effect.void)),
      )

      const fiber = yield* startAutoSaveDaemon(persist, Duration.millis(100))
      yield* TestClock.adjust(Duration.millis(450))
      yield* Fiber.interrupt(fiber)

      // Attempt 2 failed; attempts 3, 4 and 5 still happened.
      expect(yield* Ref.get(attempts)).toBeGreaterThanOrEqual(4)
    }),
  )
})
