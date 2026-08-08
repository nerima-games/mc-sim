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
 *    `startAutoSaveDaemon` is typed `Effect<Fiber.RuntimeFiber<number, never>>`
 *    with NO `ClockPort` requirement, because it does not use one. This app
 *    backs it with `TestContext.TestContext`, so a five-second autosave
 *    interval costs zero real seconds and the schedule is as reproducible as
 *    everything else.
 *
 * That second clock is NOT an oversight, and `application/autosave.ts` now
 * carries the reasoning: a Port READS AN INSTANT, a schedule SLEEPS FOR A
 * DURATION, and `ClockPort` is mirrored from mc-kernel and may not grow a
 * `sleep`. Both clocks here are injected and both are deterministic; they are
 * simply two mechanisms, and this app is the place that shows they can
 * disagree.
 *
 * `scripts/check-dependency-whitelist.ts` cannot see the second one — it greps
 * for `Date.now()` / `new Date()` / `performance.now()`, and `Schedule.spaced`
 * reaches the platform clock through Effect's `Clock` service instead. The
 * `clock-divergence` scenario drives them apart on purpose; `probes.ts` states
 * the consequence.
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
import { startAutoSaveDaemon, type AutoSaveStatus } from '../../src/application/autosave'
import { makeGameLoop, type FrameHandler } from '../../src/application/game-loop'
import { makeInventoryService } from '../../src/application/inventory-service'
import { makePlayerService } from '../../src/application/player-service'
import { makeSettingsService } from '../../src/application/settings-service'
import { makeStatisticsService } from '../../src/application/statistics-service'
import { makeTimeService } from '../../src/application/time-service'
import { makeVitalsService } from '../../src/application/vitals-service'
import * as Camera from '../../src/domain/camera-pose'
import { INVENTORY_SLOT_COUNT, type Inventory, type Slot } from '../../src/domain/inventory'
import * as Settings from '../../src/domain/settings'
import * as Statistics from '../../src/domain/statistics'
import * as Vitals from '../../src/domain/vitals'
import {
  ClockPort,
  EpochMillis,
  MAX_STACK_COUNT,
  MonotonicTimeSecs,
  position,
  StackCount,
  type CameraPoseSnapshot,
  type ClockService,
} from '../../src/domain/kernel-vocabulary'
import * as Time from '../../src/domain/time-of-day'
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
  /** Frames the dropping queue refused. Counted at the offer, not inferred. */
  readonly framesDropped: number
  /** Simulated seconds the delta clamp discarded over this generation. */
  readonly secondsLostToClamp: number
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
  /**
   * False once a slot exists that `StackCount` would reject.
   *
   * This used to mean "the next remove() of that item dies". It no longer does
   * — `removeItem` is total — but the panel keeps watching, because such a slot
   * should now be unreachable: `InventoryService.restore` normalises, so one
   * appearing here would mean something bypassed the load path.
   */
  readonly inventoryUsable: boolean
  /**
   * Items `restore()` could not fit, cumulative.
   *
   * The number that used to be silently dropped when a save resized the player.
   */
  readonly restoreLeftover: number
  /**
   * How many restores handed the services a state they had to repair.
   *
   * Counted HERE, at the call, rather than inferred from the world afterwards:
   * a repaired state is by design indistinguishable from one that was always
   * legal, so the only honest place to observe the repair is where the bad
   * value went in.
   */
  readonly timeStatesRepaired: number
  readonly inventoriesResized: number

  readonly autoSaveFired: number
  readonly autoSaveStatus: AutoSaveStatus | undefined
  readonly autoSaveLastAtMillis: number | undefined

  readonly vitals: Vitals.Vitals
  /** The six numbers mx-ui's `VitalsSnapshot` is built from. */
  readonly vitalsView: Vitals.VitalsView
  /** Food-tick signals seen, by kind. mc-sim EMITS these and applies none of them. */
  readonly foodSignals: Readonly<Record<Vitals.FoodTickSignal, number>>
  /** Blows whose amount had no magnitude, counted at the call. */
  readonly blowsWithoutMagnitude: number
  /** Vitals a restore had to repair, counted at the call for the same reason. */
  readonly vitalsRepaired: number
  readonly deaths: number
  readonly statistics: Statistics.Statistics
  readonly settings: Settings.Settings
  /** Settings writes the clamp had to move, counted at the call. */
  readonly settingsClamped: number

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
  restoreLeftover: number
  timeStatesRepaired: number
  inventoriesResized: number
  foodSignals: Record<Vitals.FoodTickSignal, number>
  blowsWithoutMagnitude: number
  vitalsRepaired: number
  deaths: number
  settingsClamped: number
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
    restoreLeftover: 0,
    timeStatesRepaired: 0,
    inventoriesResized: 0,
    foodSignals: { none: 0, regen: 0, starve: 0 },
    blowsWithoutMagnitude: 0,
    vitalsRepaired: 0,
    deaths: 0,
    settingsClamped: 0,
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
        vitals: yield* makeVitalsService(),
        statistics: yield* makeStatisticsService(),
        settings: yield* makeSettingsService(),
        loop: yield* makeGameLoop(),
      }
    }),
  )

  const { clockSecs, clockLayer, player, inventory, time, vitals, statistics, settings, loop } = built

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
    }).pipe(
      Effect.zipRight(time.advance(dt)),
      // The food timer takes THE SAME delta the world clock does, and this app
      // is the only place the two are visibly one number. The signal is counted
      // and DELIBERATELY NOT ACTED ON: `'starve'` means mx-gameplay would now
      // choose a damage amount and a cause, and this preview has neither, which
      // is what the boundary looks like from mc-sim's side.
      Effect.zipRight(
        Effect.flatMap(vitals.advanceFoodTimer(dt), (signal) =>
          Effect.sync(() => {
            book.foodSignals[signal] += 1
            if (signal !== 'none') {
              pushLog(book, `food tick -> ${signal} (mc-sim emits it and applies nothing)`, 'event')
            }
          }),
        ),
      ),
    )

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

  /** Movement and inventory actions. `undefined` means "not one of mine". */
  const applyMovementAction = (action: ScriptedAction): Effect.Effect<void> | undefined => {
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

      default:
        return undefined
    }
  }

  /** Time-of-day actions. `undefined` means "not one of mine". */
  const applyTimeAction = (action: ScriptedAction): Effect.Effect<void> | undefined => {
    switch (action.kind) {
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

      case 'restoreTime': {
        const incoming: Time.TimeState = {
          ticks: action.ticks,
          dayLengthTicks: action.dayLengthTicks,
        }
        const repairable = !Time.isValidTimeState(incoming)
        return Effect.sync(() => {
          if (repairable) {
            book.timeStatesRepaired += 1
          }
        }).pipe(
          Effect.zipRight(guarded('time.restore', time.restore(incoming))),
          Effect.zipRight(
            note(
              `time.restore({ticks:${String(action.ticks)}, dayLengthTicks:${String(action.dayLengthTicks)}})${
                repairable ? ' — INVALID, repaired by normaliseTimeState' : ''}`,
              'event',
            ),
          ),
        )
      }

      default:
        return undefined
    }
  }

  /** Save-restore and world-lifecycle actions. `undefined` means "not one of mine". */
  const applyRestoreAction = (action: ScriptedAction): Effect.Effect<void> | undefined => {
    switch (action.kind) {
      case 'restoreInventory': {
        const incoming: Inventory = {
          slots: Array.from({ length: action.slots }, (_unused, index) =>
            index === 0 && action.stack !== undefined
              ? { item: action.stack.item, count: action.stack.count as StackCount }
              : undefined,
          ),
        }
        return Effect.sync(() => {
          if (action.slots !== INVENTORY_SLOT_COUNT) {
            book.inventoriesResized += 1
          }
        }).pipe(
          Effect.zipRight(
            guarded(
              'inventory.restore',
              // The leftover is the number that used to vanish when a save
              // resized the player. Recording it is the point of the scenario.
              inventory.restore(incoming).pipe(
                Effect.tap((leftover) =>
                  Effect.sync(() => {
                    book.restoreLeftover += leftover
                  }),
                ),
              ),
            ),
          ),
          Effect.zipRight(
            note(
              `inventory.restore(${String(action.slots)} slots${action.stack === undefined ? '' : `, [0] = ${String(action.stack.count)} ${action.stack.item}`}) — normalised to ${String(INVENTORY_SLOT_COUNT)} slots`,
              'event',
            ),
          ),
        )
      }

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

      default:
        return undefined
    }
  }

  /** Vitals and progression actions. `undefined` means "not one of mine". */
  const applyVitalsAction = (action: ScriptedAction): Effect.Effect<void> | undefined => {
    switch (action.kind) {
      case 'damage': {
        // Counted HERE, at the call, because a blow that did nothing is by
        // design indistinguishable from a blow that was never thrown. The
        // panels can only show that mc-sim absorbed a `NaN` if the app records
        // having thrown one.
        const withoutMagnitude = Number.isNaN(action.amount)
        return Effect.sync(() => {
          if (withoutMagnitude) {
            book.blowsWithoutMagnitude += 1
          }
        }).pipe(
          Effect.zipRight(
            guarded(
              'vitals.damage',
              vitals
                .damage({ amount: action.amount, cause: action.cause })
                .pipe(
                  Effect.tap((outcome) =>
                    Effect.sync(() => {
                      if (outcome.died) {
                        book.deaths += 1
                      }
                    }).pipe(
                      Effect.zipRight(
                        note(
                          `damage ${String(action.amount)} (${action.cause}) -> ${outcome.vitals.healthPoints.toFixed(1)} hp${
                            outcome.died ? ' — DIED' : ''
                            }${withoutMagnitude ? ' — NO MAGNITUDE, absorbed' : ''}`,
                          outcome.died || withoutMagnitude ? 'fault' : 'event',
                        ),
                      ),
                    ),
                  ),
                ),
            ),
          ),
          Effect.zipRight(statistics.record(`damage.taken.${action.cause}`)),
        )
      }

      case 'heal':
        return guarded('vitals.heal', vitals.heal(action.amount)).pipe(
          Effect.zipRight(note(`heal ${String(action.amount)}`, 'event')),
        )

      case 'exhaust':
        return guarded('vitals.addExhaustion', vitals.addExhaustion(action.amount)).pipe(
          Effect.zipRight(
            note(`exhaustion +${String(action.amount)} (the COST is mx-gameplay's)`, 'event'),
          ),
        )

      case 'eat':
        return guarded(
          'vitals.eat',
          vitals.eat(action.foodPoints, action.saturationModifier),
        ).pipe(
          Effect.zipRight(
            note(
              `eat ${String(action.foodPoints)} food, modifier ${String(action.saturationModifier)}`,
              'event',
            ),
          ),
        )

      case 'award':
        return guarded('vitals.addExperience', vitals.addExperience(action.experience)).pipe(
          Effect.zipRight(note(`experience ${action.experience >= 0 ? '+' : ''}${String(action.experience)}`, 'event')),
        )

      case 'respawn':
        return guarded('vitals.respawn', vitals.respawn).pipe(
          Effect.zipRight(statistics.record('deaths')),
          Effect.zipRight(note('respawn — experience survives, because the penalty is a RULE', 'event')),
        )

      case 'restoreVitals': {
        const repairable = !Vitals.isValidVitals(action.vitals)
        return Effect.sync(() => {
          if (repairable) {
            book.vitalsRepaired += 1
          }
        }).pipe(
          Effect.zipRight(guarded('vitals.restore', vitals.restore(action.vitals))),
          Effect.zipRight(
            note(
              `vitals.restore(...)${  repairable ? ' — INVALID, repaired by normaliseVitals' : ''}`,
              repairable ? 'fault' : 'event',
            ),
          ),
        )
      }

      default:
        return undefined
    }
  }

  /** Statistics, settings, and loop-control actions. `undefined` means "not one of mine". */
  const applyMiscAction = (action: ScriptedAction): Effect.Effect<void> | undefined => {
    switch (action.kind) {
      case 'unlock':
        return guarded('statistics.unlock', statistics.unlock(action.id)).pipe(
          Effect.zipRight(note(`unlock ${action.id} (mc-sim holds no registry)`, 'event')),
        )

      case 'setting': {
        const patch = action.patch
        return guarded(
          'settings.update',
          settings.update(patch).pipe(
            Effect.tap((next) =>
              Effect.sync(() => {
                // A write the clamp moved is the only interesting kind, and it
                // has to be noticed at the call — the stored value afterwards
                // looks exactly like one that was always legal.
                const moved = Object.entries(patch).some(
                  ([key, value]) => next[key as keyof typeof next] !== value,
                )
                if (moved) {
                  book.settingsClamped += 1
                }
              }),
            ),
          ),
        ).pipe(
          Effect.zipRight(
            note(`settings.update(${JSON.stringify(patch)}) — held, never applied`, 'event'),
          ),
        )
      }

      case 'stopLoop':
        return loop.stop.pipe(
          Effect.zipRight(note('loop.stop — submitFrame is a silent no-op from here', 'event')),
        )

      case 'note':
        return note(action.text, 'note')

      default:
        return undefined
    }
  }

  const applyAction = (action: ScriptedAction): Effect.Effect<void> =>
    applyMovementAction(action) ??
    applyTimeAction(action) ??
    applyRestoreAction(action) ??
    applyVitalsAction(action) ??
    applyMiscAction(action) ??
    Effect.void

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
        const vitalsSnapshot = yield* vitals.snapshot

        return {
          frame: book.frame,
          framesSubmitted: book.framesSubmitted,
          framesProcessed: yield* loop.framesProcessed,
          framesDropped: yield* loop.framesDropped,
          secondsLostToClamp: yield* loop.secondsLostToClamp,
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
          // An over-full slot no longer kills the next `remove` — `removeItem`
          // is total and repairs it — but it should now be UNREACHABLE, since
          // `InventoryService.restore` normalises everything it installs. The
          // panel keeps watching so that one appearing here is visible as
          // something having bypassed the load path.
          inventoryUsable: !slots.some((slot) => slot.overfull),
          restoreLeftover: book.restoreLeftover,
          timeStatesRepaired: book.timeStatesRepaired,
          inventoriesResized: book.inventoriesResized,
          autoSaveFired: book.autoSaveFired,
          autoSaveStatus: book.autoSaveStatus,
          autoSaveLastAtMillis: book.autoSaveLastAtMillis,
          vitals: vitalsSnapshot,
          // Produced by the library, not by the panel. A preview that rebuilt
          // the six numbers itself would be showing its own arithmetic and
          // could not disagree with mc-sim about anything.
          vitalsView: Vitals.vitalsView(vitalsSnapshot),
          foodSignals: { ...book.foodSignals },
          blowsWithoutMagnitude: book.blowsWithoutMagnitude,
          vitalsRepaired: book.vitalsRepaired,
          deaths: book.deaths,
          statistics: yield* statistics.snapshot,
          settings: yield* settings.snapshot,
          settingsClamped: book.settingsClamped,
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
