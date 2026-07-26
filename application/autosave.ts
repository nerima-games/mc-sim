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
 * The tick must be total, and the catch must be INSIDE the repeat
 * ---------------------------------------------------------------------------
 *
 * `Effect.repeat(effect, schedule)` re-runs `effect` only while it SUCCEEDS. A
 * failure escaping the repeated effect stops the repetition — autosave would
 * die silently after the first transient IndexedDB quota error and every later
 * edit would be lost on the next crash. So the recovery lives inside the tick,
 * making it `Effect<void, never>`, and repeat can never stop.
 *
 * `catchAllCause`, not `catchAll`: a thrown exception inside a save surfaces as
 * `Cause.Die`, which `catchAll` does not see. This mirrors
 * ts-minecraft/packages/app/application/main/session-autosave.ts:20-33, whose
 * comment block is the clearest statement of the rule in the reference.
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
 */
export const startAutoSaveDaemon = <E>(
  persist: Effect.Effect<void, E>,
  interval: Duration.Duration = AUTO_SAVE_INTERVAL,
  reporter?: AutoSaveStatusReporter,
): Effect.Effect<Fiber.RuntimeFiber<number, never>> =>
  Effect.forkDaemon(Effect.repeat(performAutoSaveTick(persist, reporter), autoSaveSchedule(interval)))
