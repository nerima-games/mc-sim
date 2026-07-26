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
 * 4. EACH `start` OWNS ITS OWN STATE. The queue, the frame counter and the
 *    previous-instant marker are created per start and captured by that
 *    generation's daemon — they are NOT long-lived fields the loop mutates.
 *    This is what makes rule 2's "do not await the interrupt" safe: a
 *    straggling old fiber that has not yet noticed it was interrupted writes
 *    into its OWN detached state, which nothing will ever read, rather than
 *    corrupting the world that has just started.
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
 */
import { Cause, Context, Effect, Fiber, Layer, Option, Queue, Ref } from 'effect'
import { frameDeltaBetween } from '../domain/frame-timing'
import type { DeltaTimeSecs, MonotonicTimeSecs } from '../domain/kernel-vocabulary'

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
   * Frames the handler has been invoked for since the CURRENT `start`.
   * Zero while stopped: the counter belongs to the generation, not to the loop.
   */
  readonly framesProcessed: Effect.Effect<number>
}

export class GameLoop extends Context.Tag('@nerima-games/mc-sim/GameLoop')<GameLoop, GameLoopApi>() {}

/** One `start`'s worth of state. Detached wholesale by `stop`. */
type Generation = {
  readonly queue: Queue.Queue<MonotonicTimeSecs>
  readonly frames: Ref.Ref<number>
}

/** Take ownership of an optional resource and clear the slot in one atomic step. */
const detach = <A>(ref: Ref.Ref<Option.Option<A>>): Effect.Effect<Option.Option<A>> =>
  Ref.getAndSet(ref, Option.none())

export const makeGameLoop = (): Effect.Effect<GameLoopApi> =>
  Effect.gen(function* () {
    const runningRef = yield* Ref.make(false)
    const fiberRef = yield* Ref.make<Option.Option<Fiber.RuntimeFiber<void, never>>>(Option.none())
    const generationRef = yield* Ref.make<Option.Option<Generation>>(Option.none())

    const stop: Effect.Effect<void> = Effect.gen(function* () {
      yield* Ref.set(runningRef, false)

      // Detach BEFORE interrupting. A stop that is itself abandoned partway
      // through then leaves no reachable half-state for the next start to trip
      // over — which is exactly the failure the reference hit when its
      // best-effort quit step timed out mid-teardown.
      const fiber = yield* detach(fiberRef)
      const generation = yield* detach(generationRef)

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

        // Fresh state for this generation. A straggling previous daemon holds
        // references to the PREVIOUS queue and refs, and can do no harm here.
        const queue = yield* Queue.dropping<MonotonicTimeSecs>(FRAME_QUEUE_CAPACITY)
        const frames = yield* Ref.make(0)
        const lastInstant = yield* Ref.make<number | undefined>(undefined)

        const processOneFrame = Queue.take(queue).pipe(
          Effect.flatMap((now) =>
            Ref.modify(lastInstant, (previous): [DeltaTimeSecs, number] => [
              frameDeltaBetween(previous, now),
              now,
            ]),
          ),
          Effect.flatMap((dt) =>
            handler(dt).pipe(
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

        yield* Ref.set(generationRef, Option.some({ queue, frames }))
        yield* Ref.set(runningRef, true)
        const fiber = yield* Effect.forkDaemon(processOneFrame)
        yield* Ref.set(fiberRef, Option.some(fiber))
      })

    const withGeneration = <A>(
      whenStopped: A,
      whenRunning: (generation: Generation) => Effect.Effect<A>,
    ): Effect.Effect<A> =>
      Ref.get(generationRef).pipe(
        Effect.flatMap(
          Option.match({ onNone: () => Effect.succeed(whenStopped), onSome: whenRunning }),
        ),
      )

    return {
      start,
      submitFrame: (at) =>
        withGeneration<void>(undefined, (generation) =>
          Queue.offer(generation.queue, at).pipe(Effect.asVoid),
        ),
      stop,
      isRunning: Ref.get(runningRef),
      framesProcessed: withGeneration(0, (generation) => Ref.get(generation.frames)),
    }
  })

export const GameLoopLayer: Layer.Layer<GameLoop> = Layer.effect(GameLoop, makeGameLoop())
