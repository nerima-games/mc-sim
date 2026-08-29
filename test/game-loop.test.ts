/**
 * REGRESSION: the frame loop is a daemon, stops explicitly, and `start` is
 * re-entrant.
 *
 * plan.md §3.8 names deadlocks and leftover fibers on a SECOND world load as
 * the reference implementation's worst bug class. Those bugs are only
 * observable across a stop/start cycle, so that cycle is what these tests
 * exercise — a test that only ever starts a loop once cannot see any of them.
 *
 * The tests drive the loop by pushing timestamps rather than by waiting for
 * real time, which is why they finish in milliseconds and cannot flake on a
 * loaded CI machine.
 */
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Ref } from 'effect'
import { FIRST_FRAME_DELTA_SECS, MAX_FRAME_DELTA_SECS } from '../src/domain/frame-timing'
import { DeltaTimeSecs, MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import { FRAME_QUEUE_CAPACITY, makeGameLoop } from '../src/application/game-loop'

/** A handler that records deltas and signals once it has seen `target` frames. */
const recordingHandler = (target: number) =>
  Effect.gen(function* () {
    const seen = yield* Ref.make<ReadonlyArray<DeltaTimeSecs>>([])
    const reached = yield* Deferred.make<void>()
    return {
      seen,
      reached,
      handler: (dt: DeltaTimeSecs) =>
        Ref.updateAndGet(seen, (deltas) => [...deltas, dt]).pipe(
          Effect.flatMap((deltas) =>
            deltas.length >= target ? Deferred.succeed(reached, undefined) : Effect.succeed(false),
          ),
          Effect.asVoid,
        ),
    }
  })

describe('game loop lifecycle', () => {
  it.effect('processes submitted frames and clamps the deltas it derives', () =>
    Effect.gen(function* () {
      const loop = yield* makeGameLoop()
      const probe = yield* recordingHandler(3)

      yield* loop.start(probe.handler)
      expect(yield* loop.isRunning).toBe(true)

      yield* loop.submitFrame(MonotonicTimeSecs(10))
      yield* loop.submitFrame(MonotonicTimeSecs(10.02))
      // A 30-second gap: the tab was in the background.
      yield* loop.submitFrame(MonotonicTimeSecs(40.02))

      yield* Deferred.await(probe.reached)
      yield* loop.stop

      const deltas = yield* Ref.get(probe.seen)
      expect(deltas).toHaveLength(3)
      expect(deltas[0]).toBe(FIRST_FRAME_DELTA_SECS)
      expect(deltas[1]).toBeCloseTo(0.02, 12)
      expect(deltas[2]).toBe(MAX_FRAME_DELTA_SECS)
    }),
  )

  it.effect('stop() halts processing, and submitting afterwards is a silent no-op', () =>
    Effect.gen(function* () {
      const loop = yield* makeGameLoop()
      const probe = yield* recordingHandler(1)

      yield* loop.start(probe.handler)
      yield* loop.submitFrame(MonotonicTimeSecs(1))
      yield* Deferred.await(probe.reached)

      yield* loop.stop
      expect(yield* loop.isRunning).toBe(false)

      // No queue is attached any more. This must not throw and must not
      // resurrect the loop — a stopped world silently ignoring a stray
      // requestAnimationFrame callback is the correct behaviour.
      yield* loop.submitFrame(MonotonicTimeSecs(2))
      yield* loop.submitFrame(MonotonicTimeSecs(3))

      expect(yield* loop.isRunning).toBe(false)
      expect(yield* Ref.get(probe.seen)).toHaveLength(1)
    }),
  )

  it.effect('stop() is idempotent, so a best-effort teardown may run twice', () =>
    Effect.gen(function* () {
      const loop = yield* makeGameLoop()

      yield* loop.stop
      yield* loop.stop
      expect(yield* loop.isRunning).toBe(false)

      yield* loop.start(() => Effect.void)
      yield* loop.stop
      yield* loop.stop
      expect(yield* loop.isRunning).toBe(false)
    }),
  )

  it.effect('REGRESSION: a second start() succeeds — this is the second-world-load bug', () =>
    Effect.gen(function* () {
      const loop = yield* makeGameLoop()

      const firstWorld = yield* recordingHandler(1)
      yield* loop.start(firstWorld.handler)
      yield* loop.submitFrame(MonotonicTimeSecs(100))
      yield* Deferred.await(firstWorld.reached)
      yield* loop.stop

      // Load a second world WITHOUT constructing a new loop, exactly as an
      // app-scoped singleton would be reused.
      const secondWorld = yield* recordingHandler(1)
      yield* loop.start(secondWorld.handler)
      expect(yield* loop.isRunning).toBe(true)

      yield* loop.submitFrame(MonotonicTimeSecs(500))
      yield* Deferred.await(secondWorld.reached)
      yield* loop.stop

      // The first world's handler saw nothing from the second world: its fiber
      // was interrupted and its queue shut down, not left running.
      expect(yield* Ref.get(firstWorld.seen)).toHaveLength(1)
      expect(yield* Ref.get(secondWorld.seen)).toHaveLength(1)
      // Frame timing restarted from scratch, so the second world's first frame
      // is a first frame — not a 400-second jump inherited from the first.
      expect((yield* Ref.get(secondWorld.seen))[0]).toBe(FIRST_FRAME_DELTA_SECS)
    }),
  )

  it.effect('REGRESSION: start() while ALREADY running replaces the loop instead of failing', () =>
    Effect.gen(function* () {
      // The reference had to make this re-entrant after a quit-with-timeout
      // could leave a fiber alive; "already running" as an error meant the
      // next world could never start. See game-loop.ts:141-148 there.
      const loop = yield* makeGameLoop()

      const stale = yield* recordingHandler(1)
      yield* loop.start(stale.handler)
      yield* loop.submitFrame(MonotonicTimeSecs(1))
      yield* Deferred.await(stale.reached)

      const fresh = yield* recordingHandler(1)
      yield* loop.start(fresh.handler)
      expect(yield* loop.isRunning).toBe(true)
      expect(yield* loop.framesProcessed).toBe(0)

      yield* loop.submitFrame(MonotonicTimeSecs(2))
      yield* Deferred.await(fresh.reached)
      yield* loop.stop

      expect(yield* Ref.get(stale.seen)).toHaveLength(1)
      expect(yield* Ref.get(fresh.seen)).toHaveLength(1)
    }),
  )

  it.effect('a handler DEFECT is logged and the loop keeps running', () =>
    Effect.gen(function* () {
      // catchAllCause, not catchAll: a thrown exception is a Cause.Die that
      // catchAll would let through, killing the loop on the first bad frame.
      const loop = yield* makeGameLoop()
      const calls = yield* Ref.make(0)
      const reached = yield* Deferred.make<void>()

      yield* loop.start(() =>
        Ref.updateAndGet(calls, (count) => count + 1).pipe(
          Effect.flatMap((count) =>
            count >= 3
              ? Deferred.succeed(reached, undefined).pipe(Effect.asVoid)
              : Effect.sync(() => {
                  throw new Error(`stage exploded on frame ${String(count)}`)
                }),
          ),
        ),
      )

      yield* loop.submitFrame(MonotonicTimeSecs(1))
      yield* loop.submitFrame(MonotonicTimeSecs(2))
      yield* loop.submitFrame(MonotonicTimeSecs(3))

      yield* Deferred.await(reached)
      expect(yield* loop.isRunning).toBe(true)
      expect(yield* Ref.get(calls)).toBe(3)

      yield* loop.stop
    }),
  )

  it.effect('the frame queue drops rather than backpressures, so it cannot build a backlog', () =>
    Effect.gen(function* () {
      const loop = yield* makeGameLoop()
      expect(FRAME_QUEUE_CAPACITY).toBe(60)

      // Never started: no queue is attached, so every offer is discarded and
      // none of them blocks. A backpressured queue here would deadlock the
      // caller — which in a browser is the requestAnimationFrame callback.
      yield* Effect.forEach(
        Array.from({ length: FRAME_QUEUE_CAPACITY * 3 }, (_, index) => MonotonicTimeSecs(index)),
        (at) => loop.submitFrame(at),
      )

      expect(yield* loop.framesProcessed).toBe(0)
      expect(yield* loop.isRunning).toBe(false)
      // Not counted as drops. There is no queue to refuse them; a stopped
      // world ignoring a stray rAF callback is documented behaviour, and
      // counting it would report a torn-down world as a lossy one.
      expect(yield* loop.framesDropped).toBe(0)
    }),
  )
})

/**
 * REGRESSION: what the loop discards, it counts.
 *
 * Dropping frames under load and clamping a huge delta are both correct and
 * both argued for in the module headers. What was wrong is that neither was
 * OBSERVABLE: `Queue.offer` returns whether the item was accepted and the
 * boolean was thrown away, and the time above the clamp was computed nowhere.
 * Nothing — not the loop, not a HUD, not a bug report — could say the
 * simulation had lost anything.
 *
 * Frames submitted minus frames processed does NOT recover the drop count:
 * submitted is the caller's own number and processed lags it by whatever is
 * still queued, which is why the signal had to be kept at the offer.
 */
describe('loop observability', () => {
  it.effect('REGRESSION: frames the dropping queue refuses are counted, not silently discarded', () =>
    Effect.gen(function* () {
      const loop = yield* makeGameLoop()
      // Park the daemon inside the handler FIRST, so that the flood below meets
      // an empty queue and a consumer that cannot drain it. Without the
      // handshake the daemon may or may not have taken one frame before the
      // flood starts, and the drop count would be off by one at random — a
      // flaky assertion is not a pin.
      const entered = yield* Deferred.make<void>()
      const blocked = yield* Deferred.make<void>()

      yield* loop.start(() =>
        Deferred.succeed(entered, undefined).pipe(Effect.zipRight(Deferred.await(blocked))),
      )
      yield* loop.submitFrame(MonotonicTimeSecs(0))
      yield* Deferred.await(entered)

      const submitted = FRAME_QUEUE_CAPACITY * 3
      yield* Effect.forEach(
        Array.from({ length: submitted }, (_, index) => MonotonicTimeSecs(index + 1)),
        (at) => loop.submitFrame(at),
        { discard: true },
      )

      // FRAME_QUEUE_CAPACITY are held; every frame after that was refused.
      expect(yield* loop.framesDropped).toBe(submitted - FRAME_QUEUE_CAPACITY)
      // And the count is not derivable from the other two numbers: nothing has
      // been processed, yet 120 frames are demonstrably gone.
      expect(yield* loop.framesProcessed).toBe(0)

      yield* Deferred.succeed(blocked, undefined)
      yield* loop.stop
    }),
  )

  it.effect('REGRESSION: the counters survive stop, which is when a teardown report reads them', () =>
    Effect.gen(function* () {
      // They used to read 0 the moment the loop stopped, because the counter
      // belongs to the generation. The one moment a caller most wants the
      // count — after teardown, writing a session report — was the one moment
      // it was unavailable.
      const loop = yield* makeGameLoop()
      const probe = yield* recordingHandler(3)

      yield* loop.start(probe.handler)
      yield* loop.submitFrame(MonotonicTimeSecs(10))
      yield* loop.submitFrame(MonotonicTimeSecs(10.02))
      yield* loop.submitFrame(MonotonicTimeSecs(40.02))
      yield* Deferred.await(probe.reached)

      expect(yield* loop.framesProcessed).toBe(3)
      yield* loop.stop

      expect(yield* loop.isRunning).toBe(false)
      expect(yield* loop.framesProcessed).toBe(3)
      // The 30-second gap above, priced: 30 - 0.05 delivered.
      expect(yield* loop.secondsLostToClamp).toBeCloseTo(29.95, 9)
    }),
  )

  it.effect('a fresh start zeroes them, so one run never reports the previous run’s numbers', () =>
    Effect.gen(function* () {
      const loop = yield* makeGameLoop()
      const first = yield* recordingHandler(1)

      yield* loop.start(first.handler)
      yield* loop.submitFrame(MonotonicTimeSecs(100))
      yield* Deferred.await(first.reached)
      yield* loop.stop
      expect(yield* loop.framesProcessed).toBe(1)

      const second = yield* recordingHandler(1)
      yield* loop.start(second.handler)
      expect(yield* loop.framesProcessed).toBe(0)
      expect(yield* loop.framesDropped).toBe(0)
      expect(yield* loop.secondsLostToClamp).toBe(0)

      yield* loop.stop
    }),
  )

  it.effect('a loop that was never started reports zeroes rather than anything invented', () =>
    Effect.gen(function* () {
      const loop = yield* makeGameLoop()

      expect(yield* loop.framesProcessed).toBe(0)
      expect(yield* loop.framesDropped).toBe(0)
      expect(yield* loop.secondsLostToClamp).toBe(0)
    }),
  )

  it.effect('REGRESSION: an ordinary 60 Hz session loses nothing, so the counter is not noise', () =>
    Effect.gen(function* () {
      // A counter that ticks up on every normal frame would be ignored within a
      // day. Only the upper clamp counts, and a 60 Hz frame is nowhere near it.
      const loop = yield* makeGameLoop()
      const probe = yield* recordingHandler(4)

      yield* loop.start(probe.handler)
      yield* Effect.forEach(
        [10, 10.016, 10.032, 10.048],
        (at) => loop.submitFrame(MonotonicTimeSecs(at)),
        { discard: true },
      )
      yield* Deferred.await(probe.reached)

      expect(yield* loop.secondsLostToClamp).toBe(0)
      yield* loop.stop
    }),
  )
})
