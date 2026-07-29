/**
 * Autosave: `Schedule.spaced`, and a tick that cannot fail.
 *
 * ---------------------------------------------------------------------------
 * spaced, not fixed
 * ---------------------------------------------------------------------------
 *
 * `Schedule.fixed(d)` fires on an absolute grid: at 0, d, 2d, 3d ... If the
 * effect (or the whole tab) is suspended for a while, every missed slot is due
 * the instant it resumes, and Effect fires them back to back to catch up. For a
 * browser game that means: switch tabs for two minutes, switch back, and 24
 * autosaves stampede into IndexedDB at once — a multi-second stall on the very
 * frame the player is looking at again.
 *
 * `Schedule.spaced(d)` measures d from the END of the previous run. Missed time
 * is simply missed; there is no catch-up burst. The reference uses `spaced`
 * throughout (ts-minecraft/packages/app/application/main/session-autosave.ts:65,
 * and the four overlay sync loops in session-runtime-overlays.ts), and never
 * uses `Schedule.fixed` anywhere — a fact worth preserving deliberately rather
 * than by accident.
 *
 * The distinction is observable and therefore testable: with a 100 ms interval
 * and a tick that takes 30 ms, `spaced` fires every 130 ms and `fixed` every
 * 100 ms. See docs/design-notes.md.
 *
 * ---------------------------------------------------------------------------
 * The tick must be total, and the catch must be INSIDE the repeated effect
 * ---------------------------------------------------------------------------
 *
 * A scheduled effect is re-run only while it SUCCEEDS — that is true of
 * `Effect.repeat` and of `Effect.schedule` alike. A failure escaping it stops
 * the repetition, so autosave would die silently after the first transient
 * IndexedDB quota error and every later edit would be lost on the next crash.
 * The recovery therefore lives inside the tick, making it `Effect<void, never>`,
 * and the loop can never stop.
 *
 * `catchAllCause`, not `catchAll`: a thrown exception inside a save surfaces as
 * `Cause.Die`, which `catchAll` does not see. This mirrors
 * ts-minecraft/packages/app/application/main/session-autosave.ts:20-33, whose
 * comment block is the clearest statement of the rule in the reference.
 *
 * ---------------------------------------------------------------------------
 * The first save is due after one interval, not on the fork
 * ---------------------------------------------------------------------------
 *
 * `Effect.repeat(effect, schedule)` runs the effect FIRST and consults the
 * schedule afterwards. The daemon is forked during world load, so that meant a
 * save landed the instant the world came up — writing the state that had just
 * been read back over the save it came from, before the player had done
 * anything, and turning the load path into a write path. Nothing had changed;
 * a crash during load could only lose data.
 *
 * `Effect.schedule` consults the schedule first, so the sequence is
 * sleep-then-save and the first save is due at t = interval. Everything else is
 * identical, `spaced` still measures from the END of the previous run, and the
 * teardown save — if one is wanted — belongs at teardown where it can be
 * awaited, not at startup where it happens to fire.
 *
 * ---------------------------------------------------------------------------
 * Which clock this sleeps on, and why it is NOT `ClockPort`
 * ---------------------------------------------------------------------------
 *
 * `application/player-service.ts:29-33` argues that a clock requirement visible
 * in the type is what stops the read being "simplified" into `Date.now()`, and
 * this is the one service whose whole job is deciding WHEN — so the question of
 * moving it onto `ClockPort` is a fair one. The answer is no, and the reason is
 * that the two are different mechanisms rather than two spellings of one:
 *
 *   - `ClockPort` READS AN INSTANT. `monotonicSecs` and `wallClockEpochMillis`
 *     are its whole surface (`domain/kernel-vocabulary.ts`), and it is mirrored
 *     from mc-kernel — a mirror that may not grow a field here, because a wider
 *     or narrower copy of a `Context.Tag` resolved by textual key is the exact
 *     runtime hazard `test/kernel-mirror.test.ts` exists to prevent.
 *   - A schedule SLEEPS FOR A DURATION. There is no `sleep` on `ClockPort` and
 *     there cannot be one, so a Port-driven daemon would have to poll
 *     `monotonicSecs` in a loop — which needs something else to drive the poll,
 *     and which `TestClock.adjust` would no longer advance. Every test in
 *     `test/autosave.test.ts` would become a hand-driven polling harness, and
 *     the schedule would stop being the thing under test.
 *
 * Effect's ambient `Clock` is itself an injectable service, and it is the one
 * `TestClock` replaces: the whole schedule is already driven in virtual time
 * with no wall-clock read anywhere, which is what makes a five-second interval
 * cost zero real seconds in a test and in `apps/preview-sim`. The requirement a
 * caller must actually know is therefore not "provide a Port" but "a
 * deterministic replay must set the Effect Clock", and
 * `test/autosave.test.ts` pins that the daemon obeys one.
 *
 * `scripts/check-dependency-whitelist.ts` cannot see this dependency — it greps
 * for `Date.now()` / `new Date()` / `performance.now()`, and a schedule reaches
 * the platform clock through a service. That is a limit of the gate, not a
 * wall-clock read, and it is written down here so the next reader does not have
 * to rediscover it from the type.
 */
import { Cause, Duration, Effect, Fiber, Schedule } from 'effect'

export type AutoSaveStatus = 'saving' | 'saved' | 'error'

export type AutoSaveStatusReporter = (status: AutoSaveStatus) => Effect.Effect<void>

/** ts-minecraft/packages/app/application/main/session-autosave.ts:54. */
export const AUTO_SAVE_INTERVAL = Duration.seconds(5)

/**
 * Status reporting is itself made total. A defect in the UI that renders the
 * "saving..." indicator must never be able to abort persistence.
 */
const report = (
  reporter: AutoSaveStatusReporter | undefined,
  status: AutoSaveStatus,
): Effect.Effect<void> =>
  reporter === undefined
    ? Effect.void
    : reporter(status).pipe(
        Effect.catchAllCause((cause) => Effect.logError(`Auto-save status error: ${Cause.pretty(cause)}`)),
      )

/**
 * One autosave tick. Total by construction: `Effect<void, never>`.
 *
 * `persist` is a parameter rather than a `StoragePort` dependency because
 * mc-save owns persistence and mc-sim only owns WHEN it happens. Keeping the
 * what injectable is also what lets the failure-recovery tests run with no
 * storage at all.
 */
export const performAutoSaveTick = <E>(
  persist: Effect.Effect<void, E>,
  reporter?: AutoSaveStatusReporter,
): Effect.Effect<void> =>
  report(reporter, 'saving').pipe(
    Effect.zipRight(persist.pipe(Effect.zipLeft(report(reporter, 'saved')))),
    Effect.catchAllCause((cause) =>
      Effect.logError(`Auto-save error: ${Cause.pretty(cause)}`).pipe(
        Effect.zipRight(report(reporter, 'error')),
      ),
    ),
  )

/**
 * The schedule, exported so a test can assert on it directly rather than on a
 * comment claiming it is `spaced`.
 */
export const autoSaveSchedule = (
  interval: Duration.Duration = AUTO_SAVE_INTERVAL,
): Schedule.Schedule<number> => Schedule.spaced(interval)

/**
 * Start the autosave daemon.
 *
 * `forkDaemon` for the same reason as the frame loop: autosave must outlive the
 * scope that happened to start it. The caller keeps the returned Fiber and
 * `Fiber.interruptFork`s it at world teardown — a leftover autosave daemon
 * writing the previous world's state into the new world's save is precisely the
 * class of bug plan.md §3.8 warns about.
 *
 * THE FIRST SAVE IS DUE AT t = `interval`, NOT AT t = 0. `Effect.schedule`, not
 * `Effect.repeat`: see the module header. The daemon is forked during world
 * load, and a save on the fork writes over the save that was just read.
 */
export const startAutoSaveDaemon = <E>(
  persist: Effect.Effect<void, E>,
  interval: Duration.Duration = AUTO_SAVE_INTERVAL,
  reporter?: AutoSaveStatusReporter,
): Effect.Effect<Fiber.RuntimeFiber<number, never>> =>
  Effect.forkDaemon(
    Effect.schedule(performAutoSaveTick(persist, reporter), autoSaveSchedule(interval)),
  )
