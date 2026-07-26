/**
 * The world under the stepper: mc-sim's services, over clocks the operator owns.
 *
 * A dev application, not shipped API.
 *
 * ---------------------------------------------------------------------------
 * There are TWO clocks here, and that is a finding, not a convenience
 * ---------------------------------------------------------------------------
 *
 * 1. `ClockPort` — mc-kernel's Port, mirrored in `domain/kernel-vocabulary.ts`.
 *    `PlayerService.cameraPose` is typed `Effect<…, never, ClockPort>` precisely
 *    so that the dependency is visible; application/player-service.ts:29-33 says
 *    the visible requirement is what stops someone "simplifying" it into a wall
 *    read. This app backs it with a `Ref<number>` the operator advances.
 *
 * 2. Effect's own `Clock` — what `Schedule.spaced` sleeps on.
 *    `startAutoSaveDaemon` (application/autosave.ts:102-108) is typed
 *    `Effect<Fiber.RuntimeFiber<number, never>>` with NO `ClockPort`
 *    requirement, because it does not use one. This app backs it with
 *    `TestContext.TestContext`, so a five-second autosave interval costs zero
 *    real seconds and the schedule is as reproducible as everything else.
 *
 * Nothing in mc-sim ties the two together, and `scripts/check-dependency-whitelist.ts`
 * cannot see the second one — it greps for `Date.now()` / `new Date()` /
 * `performance.now()`, and `Schedule.spaced` reaches the platform clock through
 * Effect's `Clock` service instead. The `clock-divergence` scenario drives them
 * apart on purpose; `probes.ts` states the consequence.
 *
 * ---------------------------------------------------------------------------
 * Why ManagedRuntime
 * ---------------------------------------------------------------------------
 *
 * The frame loop is a forked daemon and autosave is another. Both must survive
 * across keystrokes, which a per-keystroke `Effect.runPromise` would not allow:
 * each call would build and discard its own runtime, its own `TestClock` and its
 * own fibers. `ManagedRuntime.make(TestContext.TestContext)` is one long-lived
 * runtime that every step runs inside, so the daemons and the virtual clock
 * persist exactly as they do in a real session.
 */
import {
  Duration,
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Ref,
  TestClock,
  TestContext,
} from 'effect'
import { startAutoSaveDaemon, type AutoSaveStatus } from '../../application/autosave'
import { makeGameLoop, type FrameHandler } from '../../application/game-loop'
import { makeInventoryService } from '../../application/inventory-service'
import { makePlayerService } from '../../application/player-service'
import { makeTimeService } from '../../application/time-service'
import * as Camera from '../../domain/camera-pose'
import type { Slot } from '../../domain/inventory'
import {
  ClockPort,
  EpochMillis,
  MAX_STACK_COUNT,
  MonotonicTimeSecs,
  position,
  StackCount,
  type CameraPoseSnapshot,
  type ClockService,
} from '../../domain/kernel-vocabulary'
import * as Time from '../../domain/time-of-day'
import { scenarioFor, stepsAt, type ScenarioName, type ScriptedAction } from './script'

/**
 * A frozen wall-clock reading, deliberately unrelated to the monotonic one.
 *
 * `test/scenario.test.ts:41-45` makes the same choice and states the reason: the
 * wall clock is not a second monotonic clock, and letting the two move together
 * hides any code that used `wallClockEpochMillis` to measure a duration.
 */
const FROZEN_WALL_CLOCK = EpochMillis(1_700_000_000_000)

export type SlotView = {
  readonly index: number
  readonly item: string
  readonly count: number
  /** True when the slot violates `StackCount`'s [0, 64] refinement. */
  readonly overfull: boolean
}

export type LogLine = {
  readonly frame: number
  readonly text: string
  readonly severity: 'note' | 'event' | 'fault'
}

export type WorldView = {
  readonly frame: number
  readonly framesSubmitted: number
  readonly framesProcessed: number
  readonly loopRunning: boolean

  /** The injected `ClockPort` reading, seconds. */
  readonly clockPortSecs: number
  /** Effect's own `Clock` — what the autosave schedule sleeps on. Milliseconds. */
  readonly effectClockMillis: number
  /** Simulated seconds actually delivered to the world: the SUM of clamped deltas. */
  readonly simulatedSecs: number

  readonly lastRawDeltaSecs: number | undefined
  readonly lastDeltaSecs: number | undefined

  readonly pose: Camera.PlayerPose
  readonly cameraPose: CameraPoseSnapshot
  readonly forward: { readonly x: number; readonly y: number; readonly z: number }
  readonly poseSnapshotAgeSecs: number

  readonly timeState: Time.TimeState
  readonly timeOfDay: number
  readonly dayLengthSecs: number
  readonly moonPhase: number
  readonly isNight: boolean

  readonly slots: ReadonlyArray<SlotView>
  readonly slotCount: number
  /** False once a slot exists that `removeItem` would throw on. */
  readonly inventoryUsable: boolean

  readonly autoSaveFired: number
  readonly autoSaveStatus: AutoSaveStatus | undefined
  readonly autoSaveLastAtMillis: number | undefined

  readonly faults: number
  readonly log: ReadonlyArray<LogLine>
}

export type WorldConfig = {
  readonly scenario: ScenarioName
  readonly fps: number
  readonly dayLengthSecs: number
  readonly timeOfDay: number
  readonly autoSaveSecs: number
}

/** Mutable bookkeeping the preview owns. The library's state lives in its own Refs. */
type Bookkeeping = {
  frame: number
  framesSubmitted: number
  clockPortSecs: number
  simulatedSecs: number
  lastRawDeltaSecs: number | undefined
  lastDeltaSecs: number | undefined
  autoSaveFired: number
  autoSaveStatus: AutoSaveStatus | undefined
  autoSaveLastAtMillis: number | undefined
  faults: number
  log: Array<LogLine>
}

export type World = {
  readonly config: WorldConfig
  /** Run `count` frames. Resolves once every one of them has been processed. */
  readonly advance: (count: number) => Promise<void>
  readonly view: () => Promise<WorldView>
  readonly dispose: () => Promise<void>
}

const LOG_LIMIT = 10

const pushLog = (book: Bookkeeping, text: string, severity: LogLine['severity']): void => {
  book.log.push({ frame: book.frame, text, severity })
  if (book.log.length > LOG_LIMIT) {
    book.log.splice(0, book.log.length - LOG_LIMIT)
  }
}

const slotViews = (slots: ReadonlyArray<Slot>): ReadonlyArray<SlotView> => {
  const views: Array<SlotView> = []
  slots.forEach((slot, index) => {
    if (slot !== undefined) {
      views.push({
        index,
        item: slot.item,
        count: slot.count,
        overfull: !(Number.isInteger(slot.count) && slot.count >= 0 && slot.count <= MAX_STACK_COUNT),
      })
    }
  })
  return views
}

/**
 * Build a world.
 *
 * Everything the library owns is created here and NOT shared across worlds:
 * `test/scenario.test.ts:161-179` makes the same point — each build is an
 * independent world, which is what re-entrancy needs. The `second-world`
 * scenario then reuses these instances deliberately, to exercise the other half.
 */
export const makeWorld = async (config: WorldConfig): Promise<World> => {
  const runtime = ManagedRuntime.make(TestContext.TestContext as Layer.Layer<never>)

  const book: Bookkeeping = {
    frame: 0,
    framesSubmitted: 0,
    clockPortSecs: 0,
    simulatedSecs: 0,
    lastRawDeltaSecs: undefined,
    lastDeltaSecs: undefined,
    autoSaveFired: 0,
    autoSaveStatus: undefined,
    autoSaveLastAtMillis: undefined,
    faults: 0,
    log: [],
  }

  const built = await runtime.runPromise(
    Effect.gen(function* () {
      const clockSecs = yield* Ref.make(0)
      const clockLayer = Layer.succeed(ClockPort, {
        monotonicSecs: Ref.get(clockSecs).pipe(Effect.map((value) => MonotonicTimeSecs(value))),
        wallClockEpochMillis: Effect.succeed(FROZEN_WALL_CLOCK),
      } satisfies ClockService)

      return {
        clockSecs,
        clockLayer,
        player: yield* makePlayerService(),
        inventory: yield* makeInventoryService(),
        time: yield* makeTimeService(),
        loop: yield* makeGameLoop(),
      }
    }),
  )

  const { clockSecs, clockLayer, player, inventory, time, loop } = built

  /**
   * The frame handler.
   *
   * This is the ONE place the simulated world advances, and it advances by the
   * delta the loop derived — never by a number this app chose. That is the
   * property the whole preview exists to show, so short-circuiting it here would
   * be the app arguing against its own subject.
   */
  const frameHandler: FrameHandler = (dt) =>
    Effect.sync(() => {
      book.lastDeltaSecs = dt
      book.simulatedSecs += dt
    }).pipe(Effect.zipRight(time.advance(dt)))

  const autoSaveTick = Effect.gen(function* () {
    book.autoSaveFired += 1
    const at = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
    book.autoSaveLastAtMillis = at
    pushLog(
      book,
      `autosave #${String(book.autoSaveFired)} at ${String(at)} ms on the EFFECT clock`,
      'event',
    )
  })

  const autoSaveFiber = await runtime.runPromise(
    startAutoSaveDaemon(
      autoSaveTick,
      Duration.seconds(config.autoSaveSecs),
      (status: AutoSaveStatus) =>
        Effect.sync(() => {
          book.autoSaveStatus = status
        }),
    ),
  )

  await runtime.runPromise(loop.start(frameHandler))
  await runtime.runPromise(time.configureDay(config.dayLengthSecs, config.timeOfDay))

  const scenario = scenarioFor(config.scenario)

  /** A fault is recorded and swallowed: a stepper that dies is a stepper that shows nothing. */
  const guarded = (label: string, effect: Effect.Effect<unknown>): Effect.Effect<void> =>
    effect.pipe(
      Effect.asVoid,
      Effect.catchAllCause(() =>
        Effect.sync(() => {
          book.faults += 1
          pushLog(book, `${label} THREW — a pure domain function raised`, 'fault')
        }),
      ),
    )

  const note = (text: string, severity: LogLine['severity']): Effect.Effect<void> =>
    Effect.sync(() => {
      pushLog(book, text, severity)
    })

  const applyAction = (action: ScriptedAction): Effect.Effect<void> => {
    switch (action.kind) {
      case 'look':
        return guarded('look', player.look(action.deltaYaw, action.deltaPitch))

      case 'moveTo':
        return guarded('moveTo', player.moveTo(position(action.x, action.y, action.z)))

      case 'mine':
        return guarded(
          'inventory.add',
          inventory
            .add(action.item, action.count)
            .pipe(
              Effect.tap((leftover) =>
                note(
                  `+${String(action.count)} ${action.item}${leftover > 0 ? ` — ${String(leftover)} DID NOT FIT` : ''}`,
                  leftover > 0 ? 'fault' : 'event',
                ),
              ),
            ),
        )

      case 'spend':
        return guarded(
          'inventory.remove',
          inventory
            .remove(action.item, action.count)
            .pipe(
              Effect.tap((removed) =>
                note(`-${String(removed)} ${action.item} (asked for ${String(action.count)})`, 'event'),
              ),
            ),
        )

      case 'setDayLength':
        return guarded('setDayLength', time.setDayLength(action.seconds)).pipe(
          Effect.zipRight(note(`setDayLength(${String(action.seconds)}) ALONE — watch the clock face`, 'fault')),
        )

      case 'setTimeOfDay':
        return guarded('setTimeOfDay', time.setTimeOfDay(action.fraction)).pipe(
          Effect.zipRight(note(`setTimeOfDay(${String(action.fraction)})`, 'event')),
        )

      case 'configureDay':
        return guarded('configureDay', time.configureDay(action.seconds, action.fraction)).pipe(
          Effect.zipRight(
            note(`configureDay(${String(action.seconds)} s, ${String(action.fraction)})`, 'event'),
          ),
        )

      case 'restoreTime':
        return guarded('time.restore', time.restore({ ticks: action.ticks, dayLengthTicks: action.dayLengthTicks })).pipe(
          Effect.zipRight(
            note(
              `time.restore({ticks:${String(action.ticks)}, dayLengthTicks:${String(action.dayLengthTicks)}})`,
              action.dayLengthTicks === 0 ? 'fault' : 'event',
            ),
          ),
        )

      case 'restoreInventory':
        return guarded(
          'inventory.restore',
          inventory.restore({
            slots: Array.from({ length: action.slots }, (_unused, index) =>
              index === 0 && action.stack !== undefined
                ? { item: action.stack.item, count: action.stack.count as StackCount }
                : undefined,
            ),
          }),
        ).pipe(
          Effect.zipRight(
            note(
              `inventory.restore(${String(action.slots)} slots${action.stack === undefined ? '' : `, [0] = ${String(action.stack.count)} ${action.stack.item}`})`,
              'fault',
            ),
          ),
        )

      case 'hiccup':
        return Ref.update(clockSecs, (value) => value + action.seconds).pipe(
          Effect.zipRight(
            Effect.sync(() => {
              book.clockPortSecs += action.seconds
            }),
          ),
          Effect.zipRight(note(`clock gap of ${action.seconds.toFixed(3)} s with no frame`, 'event')),
          Effect.zipRight(
            action.seconds > 0
              ? TestClock.adjust(Duration.nanos(BigInt(Math.round(action.seconds * 1_000_000_000))))
              : Effect.void,
          ),
        )

      case 'skewClockPort':
        return Ref.update(clockSecs, (value) => value + action.seconds).pipe(
          Effect.zipRight(
            Effect.sync(() => {
              book.clockPortSecs += action.seconds
            }),
          ),
          Effect.zipRight(
            note(`ClockPort +${String(action.seconds)} s; the Effect clock did NOT move`, 'fault'),
          ),
        )

      case 'secondWorld':
        return loop.stop.pipe(
          Effect.zipRight(player.reset),
          Effect.zipRight(inventory.reset),
          Effect.zipRight(time.restore(Time.INITIAL_TIME_STATE)),
          Effect.zipRight(loop.start(frameHandler)),
          Effect.zipRight(
            Effect.sync(() => {
              book.lastDeltaSecs = undefined
              book.lastRawDeltaSecs = undefined
            }),
          ),
          Effect.zipRight(note('teardown + reload on the SAME service instances', 'event')),
        )

      case 'stopLoop':
        return loop.stop.pipe(
          Effect.zipRight(note('loop.stop — submitFrame is a silent no-op from here', 'event')),
        )

      case 'note':
        return note(action.text, 'note')

      default:
        return Effect.void
    }
  }

  const frameStepSecs = 1 / config.fps
  // Nanoseconds, not milliseconds. `Duration.millis(Math.round(1000 / fps))` at
  // 60 fps is 17 ms against a 16.667 ms frame, and the two clocks would then
  // drift apart by a third of a millisecond per frame — an artefact of this app
  // that the CLOCK panel would report as a finding. The panel's job is to show
  // mc-sim diverging from itself, so the harness must not add a divergence of
  // its own.
  const frameStep = Duration.nanos(BigInt(Math.round(frameStepSecs * 1_000_000_000)))

  /** One frame: script it, move the clocks, submit it, let the daemon take it. */
  const oneFrame = Effect.gen(function* () {
    yield* Effect.forEach(stepsAt(scenario, book.frame), (scripted) => applyAction(scripted.action), {
      discard: true,
    })

    const previous = book.clockPortSecs
    book.clockPortSecs += frameStepSecs
    yield* Ref.set(clockSecs, book.clockPortSecs)

    book.lastRawDeltaSecs = book.framesSubmitted === 0 ? undefined : book.clockPortSecs - previous
    book.framesSubmitted += 1
    yield* loop.submitFrame(MonotonicTimeSecs(book.clockPortSecs))

    // Let the loop's daemon take the frame and run the handler before the next
    // frame is scripted. Without this the frames would queue up and then be
    // processed in a burst, and the panels would show a state that no single
    // frame ever produced.
    yield* Effect.yieldNow()
    yield* Effect.yieldNow()

    // Effect's own Clock, which is what the autosave schedule sleeps on.
    yield* TestClock.adjust(frameStep)

    book.frame += 1
  })

  const advance = (count: number): Promise<void> => {
    const frames = Math.max(0, Math.trunc(count))
    return frames === 0
      ? Promise.resolve()
      : runtime.runPromise(Effect.repeatN(oneFrame, frames - 1).pipe(Effect.asVoid))
  }

  const view = (): Promise<WorldView> =>
    runtime.runPromise(
      Effect.gen(function* () {
        const inventorySnapshot = yield* inventory.snapshot
        const slots = slotViews(inventorySnapshot.slots)
        const snapshot = yield* player.cameraPose.pipe(Effect.provide(clockLayer))
        const timeState = yield* time.snapshot

        return {
          frame: book.frame,
          framesSubmitted: book.framesSubmitted,
          framesProcessed: yield* loop.framesProcessed,
          loopRunning: yield* loop.isRunning,
          clockPortSecs: book.clockPortSecs,
          effectClockMillis: yield* Effect.clockWith((clock) => clock.currentTimeMillis),
          simulatedSecs: book.simulatedSecs,
          lastRawDeltaSecs: book.lastRawDeltaSecs,
          lastDeltaSecs: book.lastDeltaSecs,
          pose: yield* player.pose,
          cameraPose: snapshot,
          forward: Camera.forwardVector(snapshot),
          poseSnapshotAgeSecs: Camera.snapshotAgeSecs(snapshot, MonotonicTimeSecs(book.clockPortSecs)),
          timeState,
          timeOfDay: Time.timeOfDay(timeState),
          dayLengthSecs: Time.dayLengthSecs(timeState),
          moonPhase: Time.moonPhase(timeState),
          isNight: Time.isNight(timeState),
          slots,
          slotCount: inventorySnapshot.slots.length,
          // `removeItem` writes `StackCount(left)`, and `StackCount` is a
          // `Brand.refined` constructor: it THROWS when the remainder is outside
          // [0, 64]. One overfull slot therefore makes every later `remove` of
          // that item die. The panel says so rather than finding out.
          inventoryUsable: !slots.some((slot) => slot.overfull),
          autoSaveFired: book.autoSaveFired,
          autoSaveStatus: book.autoSaveStatus,
          autoSaveLastAtMillis: book.autoSaveLastAtMillis,
          faults: book.faults,
          log: [...book.log],
        } satisfies WorldView
      }),
    )

  const dispose = async (): Promise<void> => {
    await runtime.runPromise(loop.stop)
    await runtime.runPromise(Fiber.interruptFork(autoSaveFiber))
    await runtime.dispose()
  }

  return { config, advance, view, dispose }
}
