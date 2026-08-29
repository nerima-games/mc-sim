/**
 * The frame loop: `forkDaemon` + an explicit, re-entrant lifecycle.
 *
 * ---------------------------------------------------------------------------
 * Why a daemon, and why re-entrancy is designed in rather than retrofitted
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.8 records that the reference implementation's worst bug class was
 * deadlocks and leftover fibers on a second world load. The comments the
 * reference eventually had to write say it better than a summary can:
 *
 *   ts-minecraft/packages/game/application/game-loop.ts:141-148
 *     // Re-entrant: this service is an app-scoped singleton reused across
 *     // worlds, and its fibers are daemons that outlive session teardown.
 *     // A best-effort quit stop() can be cut off by its timeout, so rather
 *     // than fail "already running", tear down any lingering processing
 *     // fiber and start fresh ...
 *     // interruptFork (not interrupt): a previous session's fiber can be
 *     // slow to wind down after its scope closed — awaiting its exit here
 *     // deadlocked the next world's startup behind the loading screen.
 *
 *   ts-minecraft/packages/game/application/game-loop.ts:198-201
 *     // interruptFork (not interrupt): a torn-down session's maintenance
 *     // fiber can take arbitrarily long to acknowledge interruption, and
 *     // awaiting it here left the second world stuck on the loading screen
 *     // forever (save & quit -> load hang).
 *
 * Four rules follow, and all four are here from the first commit:
 *
 * 1. THE LOOP IS A DAEMON. `Effect.forkDaemon`, not `Effect.fork`. A frame loop
 *    tied to the calling scope dies when that scope closes — which for a UI
 *    callback is immediately.
 *
 * 2. TEARDOWN IS EXPLICIT AND NON-BLOCKING. `stop` flips the running flag,
 *    DETACHES every resource before interrupting anything, and uses
 *    `Fiber.interruptFork`. Detaching first means a `stop` that is itself cut
 *    short still leaves no reachable half-state. Not awaiting the interrupt
 *    means a slow fiber cannot deadlock the next `start`.
 *
 * 3. `start` IS RE-ENTRANT. Calling it while running is not an error; it tears
 *    down the previous loop and starts a clean one. "Already running" as a
 *    failure mode only makes sense if teardown is guaranteed, and teardown
 *    under a timeout never is.
 *
 * 4. EACH `start` OWNS ITS OWN STATE. The queue, the three counters and the
 *    previous-instant marker are created per start and captured by that
 *    generation's daemon — they are NOT long-lived fields the loop mutates.
 *    This is what makes rule 2's "do not await the interrupt" safe: a
 *    straggling old fiber that has not yet noticed it was interrupted writes
 *    into its OWN detached state, which nothing will ever read, rather than
 *    corrupting the world that has just started.
 *
 *    The counters are nonetheless READABLE after `stop`, because teardown is
 *    when a caller writes a session report. `stop` takes one reading of the
 *    generation it is retiring and keeps that value; the next `start` zeroes
 *    it. A frozen number is not a shared mutable field, so rule 4 holds.
 *
 * ---------------------------------------------------------------------------
 * Why frames are pushed in rather than pulled from a clock
 * ---------------------------------------------------------------------------
 *
 * `submitFrame` takes the timestamp. In a browser it is called from
 * `requestAnimationFrame`; in a test it is called with whatever instants the
 * test wants. That is what makes the loop testable in Node with no timers and
 * no wall clock, and it is the same inversion as the clock Port one level down.
 *
 * The queue is DROPPING, not backpressured (matching
 * ts-minecraft/packages/game/application/game-loop.ts:106). Under load the
 * right behaviour is to lose frames, not to accumulate a backlog the simulation
 * then replays in fast-forward while the player watches. A backpressured queue
 * would additionally block the caller — in a browser, the rAF callback itself.
 *
 * Dropping is right; dropping SILENTLY was not. `Queue.offer` returns whether
 * the item was accepted, and that boolean is the only evidence a frame was
 * lost — frames submitted is the caller's own count, and frames processed lags
 * it by whatever is still queued, so neither one can be subtracted from the
 * other to get it. It is counted into `framesDropped`. The same argument
 * applies to the delta clamp one level down, which discards simulated time by
 * design and now says how much: `secondsLostToClamp`.
 */
import { Cause, Context, Effect, Fiber, Layer, Option, Queue, Ref } from 'effect'
import { frameDeltaLossBetween } from '../domain/frame-timing'
import { deltaTimeBetween as frameDeltaBetween } from '@nerima-games/mc-physics'
import type { DeltaTimeSecs, MonotonicTimeSecs } from "@nerima-games/mc-kernel"

/**
 * Per-frame work.
 *
 * The error channel is `never` on purpose. There is no sensible frame-level
 * recovery for "physics failed on frame 12048": a handler that can fail must
 * decide what to do about it itself. Defects still escape, and the loop logs
 * them — see `Effect.catchAllCause` below.
 */
export type FrameHandler = (dt: DeltaTimeSecs) => Effect.Effect<void>

/** Frames the dropping queue will hold before it starts discarding. */
export const FRAME_QUEUE_CAPACITY = 60

export type GameLoopApi = {
  /**
   * Install a handler and start the loop. Safe to call while already running:
   * the previous loop is torn down first and the frame clock restarts.
   */
  readonly start: (handler: FrameHandler) => Effect.Effect<void>
  /** Offer a frame instant. A no-op when the loop is stopped. */
  readonly submitFrame: (at: MonotonicTimeSecs) => Effect.Effect<void>
  /** Stop and detach everything. Never blocks on a slow fiber. Idempotent. */
  readonly stop: Effect.Effect<void>
  readonly isRunning: Effect.Effect<boolean>
  /**
   * Frames the handler has been invoked for since the current `start`.
   *
   * SURVIVES `stop`. The counters belong to a generation, but a reading of them
   * has to outlive it: teardown is exactly when a caller writes a session
   * report, and this used to read 0 from that moment on — unavailable at the
   * one moment it was wanted. `stop` freezes the generation's final tally and
   * the next `start` zeroes it, so a stopped loop reports the run that just
   * finished and a fresh loop reports 0.
   */
  readonly framesProcessed: Effect.Effect<number>
  /**
   * Frames `submitFrame` offered that the dropping queue refused.
   *
   * Dropping under load is the right behaviour and is argued for in the module
   * header — but `Queue.offer` RETURNS whether the item was accepted, and that
   * signal used to be discarded, so nothing could say the simulation had lost
   * frames. A HUD showing a stutter, a bug report, and a decision to lower the
   * quality settings all need this number, and none of them could derive it:
   * frames submitted is the caller's own count and frames processed lags it by
   * whatever is still in the queue.
   *
   * Same lifetime as `framesProcessed`. Frames submitted while the loop is
   * STOPPED are not counted here: there is no queue to refuse them, the
   * behaviour is a documented no-op rather than a drop, and counting them would
   * report a torn-down world as a lossy one.
   */
  readonly framesDropped: Effect.Effect<number>
  /**
   * Simulated seconds the delta clamp discarded, summed over the generation.
   *
   * `domain/frame-timing.ts` clamps a delta to 0.05 s so that a backgrounded
   * tab cannot teleport the player through a collider. The time above the clamp
   * is simply not delivered to the world and nothing repays it — one 30-second
   * background tab costs 29.95 s of in-game time — so a session drifts behind
   * the clock driving it by an amount that was, until now, computed nowhere.
   *
   * This is the design working, not a fault, and it is published so that a
   * caller can SAY how far behind it has fallen. Same lifetime as
   * `framesProcessed`.
   */
  readonly secondsLostToClamp: Effect.Effect<number>
}

export class GameLoop extends Context.Tag('@nerima-games/mc-sim/GameLoop')<GameLoop, GameLoopApi>() {}

/**
 * What a generation counted. Published by `GameLoopApi`, and the value `stop`
 * freezes so that a teardown report can still read it.
 */
type Counters = {
  readonly framesProcessed: number
  readonly framesDropped: number
  readonly secondsLostToClamp: number
}

const NO_FRAMES: Counters = { framesProcessed: 0, framesDropped: 0, secondsLostToClamp: 0 }

/** One `start`'s worth of state. Detached wholesale by `stop`. */
type Generation = {
  readonly queue: Queue.Queue<MonotonicTimeSecs>
  readonly frames: Ref.Ref<number>
  readonly dropped: Ref.Ref<number>
  readonly lostSecs: Ref.Ref<number>
}

const countersOf = (generation: Generation): Effect.Effect<Counters> =>
  Effect.all({
    framesProcessed: Ref.get(generation.frames),
    framesDropped: Ref.get(generation.dropped),
    secondsLostToClamp: Ref.get(generation.lostSecs),
  })

/** Take ownership of an optional resource and clear the slot in one atomic step. */
const detach = <A>(ref: Ref.Ref<Option.Option<A>>): Effect.Effect<Option.Option<A>> =>
  Ref.getAndSet(ref, Option.none())

export const makeGameLoop = (): Effect.Effect<GameLoopApi> =>
  Effect.gen(function* () {
    const runningRef = yield* Ref.make(false)
    const fiberRef = yield* Ref.make<Option.Option<Fiber.RuntimeFiber<void, never>>>(Option.none())
    const generationRef = yield* Ref.make<Option.Option<Generation>>(Option.none())
    // The final tally of the generation that stopped last. Rule 4 in the module
    // header says each start owns its state and nothing long-lived is mutated;
    // this holds a READING of that state, taken once at teardown, and never a
    // handle a straggling daemon could write through.
    const lastCountersRef = yield* Ref.make(NO_FRAMES)

    const stop: Effect.Effect<void> = Effect.gen(function* () {
      yield* Ref.set(runningRef, false)

      // Detach BEFORE interrupting. A stop that is itself abandoned partway
      // through then leaves no reachable half-state for the next start to trip
      // over — which is exactly the failure the reference hit when its
      // best-effort quit step timed out mid-teardown.
      const fiber = yield* detach(fiberRef)
      const generation = yield* detach(generationRef)

      // Freeze the counters while the generation is still readable, and BEFORE
      // interrupting: a frame the daemon is halfway through is counted or not
      // counted, and either answer is a real reading of a real instant.
      yield* Option.match(generation, {
        onNone: () => Effect.void,
        onSome: (previous) =>
          Effect.flatMap(countersOf(previous), (counters) => Ref.set(lastCountersRef, counters)),
      })

      // interruptFork, never interrupt: awaiting a fiber suspended deep inside
      // a chunk-streaming operation is how the next world load deadlocks.
      yield* Option.match(fiber, {
        onNone: () => Effect.void,
        onSome: (running) => Fiber.interruptFork(running),
      })
      yield* Option.match(generation, {
        onNone: () => Effect.void,
        onSome: (previous) => Queue.shutdown(previous.queue),
      })
    })

    const start = (handler: FrameHandler): Effect.Effect<void> =>
      Effect.gen(function* () {
        // Re-entrant. Not "fail if already running" — see the module header.
        yield* stop

        // A new run reports its own numbers from zero, not the previous run's.
        yield* Ref.set(lastCountersRef, NO_FRAMES)

        // Fresh state for this generation. A straggling previous daemon holds
        // references to the PREVIOUS queue and refs, and can do no harm here.
        const queue = yield* Queue.dropping<MonotonicTimeSecs>(FRAME_QUEUE_CAPACITY)
        const frames = yield* Ref.make(0)
        const dropped = yield* Ref.make(0)
        const lostSecs = yield* Ref.make(0)
        const lastInstant = yield* Ref.make<number | undefined>(undefined)

        const processOneFrame = Queue.take(queue).pipe(
          Effect.flatMap((now) =>
            // Delta and clamp loss are derived from the SAME pair of readings,
            // inside the one atomic step that consumes them. Reading the marker
            // twice would let a concurrent frame land in between and attribute
            // the loss to the wrong interval.
            Ref.modify(
              lastInstant,
              (previous): [{ readonly dt: DeltaTimeSecs; readonly lostSecs: number }, number] => [
                { dt: frameDeltaBetween(previous, now), lostSecs: frameDeltaLossBetween(previous, now) },
                now,
              ],
            ),
          ),
          Effect.tap((frame) =>
            frame.lostSecs === 0
              ? Effect.void
              : Ref.update(lostSecs, (total) => total + frame.lostSecs),
          ),
          Effect.flatMap((frame) =>
            handler(frame.dt).pipe(
              // catchAllCause, not catchAll: a thrown exception inside a stage
              // surfaces as Cause.Die, which catchAll would miss and let kill
              // the loop. Logging the whole Cause is what makes a defect
              // visible at all — plan.md §3.8's Effect conventions.
              Effect.catchAllCause((cause) => Effect.logError(`Frame error: ${Cause.pretty(cause)}`)),
            ),
          ),
          Effect.flatMap(() => Ref.update(frames, (count) => count + 1)),
          Effect.forever,
        )

        yield* Ref.set(generationRef, Option.some({ queue, frames, dropped, lostSecs }))
        yield* Ref.set(runningRef, true)
        const fiber = yield* Effect.forkDaemon(processOneFrame)
        yield* Ref.set(fiberRef, Option.some(fiber))
      })

    const withGeneration = <A>(
      whenStopped: Effect.Effect<A>,
      whenRunning: (generation: Generation) => Effect.Effect<A>,
    ): Effect.Effect<A> =>
      Ref.get(generationRef).pipe(
        Effect.flatMap(Option.match({ onNone: () => whenStopped, onSome: whenRunning })),
      )

    /** Live while a generation is attached; the frozen teardown reading after. */
    const counters: Effect.Effect<Counters> = withGeneration(Ref.get(lastCountersRef), countersOf)

    return {
      start,
      submitFrame: (at) =>
        withGeneration<void>(Effect.void, (generation) =>
          Effect.flatMap(Queue.offer(generation.queue, at), (accepted) =>
            // Queue.offer's boolean IS the drop signal. Discarding it was the
            // whole of SIM-7: the queue is dropping by design, so a `false`
            // here is expected under load and is the only evidence it happened.
            accepted ? Effect.void : Ref.update(generation.dropped, (count) => count + 1),
          ),
        ),
      stop,
      isRunning: Ref.get(runningRef),
      framesProcessed: Effect.map(counters, (current) => current.framesProcessed),
      framesDropped: Effect.map(counters, (current) => current.framesDropped),
      secondsLostToClamp: Effect.map(counters, (current) => current.secondsLostToClamp),
    }
  })

export const GameLoopLayer: Layer.Layer<GameLoop> = Layer.effect(GameLoop, makeGameLoop())
