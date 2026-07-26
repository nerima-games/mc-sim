/**
 * `--stats`: the numeric report.
 *
 * A dev application, not shipped API.
 *
 * The stepper shows a world moving. This shows the boundaries, in numbers, with
 * no picture in the way. The distinction matters for the same reason
 * mc-worldgen's preview keeps `--stats` separate from its views: a coloured
 * frame of a wrong world still looks like a world, and the only defence is a
 * table of quantities somebody can recompute.
 *
 * **Nothing here asserts.** These probes print. Anything in here that turns out
 * to be a real invariant belongs in `test/`, where it can fail CI; the report
 * says so at the foot, and every line that found something names the test that
 * should exist.
 */
import { Duration, Effect, Fiber, Ref, Schedule, TestClock, TestContext, Layer } from 'effect'
import { autoSaveSchedule, startAutoSaveDaemon } from '../../application/autosave'
import { makeGameLoop } from '../../application/game-loop'
import { makeInventoryService } from '../../application/inventory-service'
import { makeTimeService } from '../../application/time-service'
import {
  clampFrameDelta,
  FIRST_FRAME_DELTA_SECS,
  frameDeltaBetween,
  MAX_FRAME_DELTA_SECS,
  MIN_FRAME_DELTA_SECS,
} from '../../domain/frame-timing'
import { emptyInventory, INVENTORY_SLOT_COUNT, removeItem, type Inventory } from '../../domain/inventory'
import { MAX_STACK_COUNT, MonotonicTimeSecs, type StackCount } from '../../domain/kernel-vocabulary'
import * as Time from '../../domain/time-of-day'
import { clockFace, fixed, padStart, pad } from './style'

const line = (text = ''): string => text

const section = (title: string, why: string): ReadonlyArray<string> => ['', `== ${title}`, `   ${why}`, '']

const cell = (text: string, width: number): string => pad(text, width)

const numberCell = (value: number, digits: number, width: number): string =>
  padStart(fixed(value, digits), width)

/** Run a thunk and report either its value or the fact that it threw. */
const attempt = <A>(thunk: () => A): { readonly ok: true; readonly value: A } | { readonly ok: false } => {
  try {
    return { ok: true, value: thunk() }
  } catch {
    return { ok: false }
  }
}

// ---------------------------------------------------------------------------
// FRAME — the delta clamp
// ---------------------------------------------------------------------------

const frameClampProbe = (): ReadonlyArray<string> => {
  const inputs = [
    -30, -0.001, 0, 0.0005, MIN_FRAME_DELTA_SECS, 0.008, 0.016, MAX_FRAME_DELTA_SECS, 0.051, 30,
    Number.NaN,
  ]

  const rows = inputs.map((raw) => {
    const applied = clampFrameDelta(raw)
    const lost = Number.isNaN(raw) ? 0 : raw - applied
    return `   ${cell(Number.isNaN(raw) ? 'NaN' : fixed(raw, 6), 14)}${numberCell(applied, 6, 12)}${numberCell(lost, 6, 14)}`
  })

  return [
    ...section(
      'FRAME-CLAMP',
      `clampFrameDelta over its whole range. Bounds [${String(MIN_FRAME_DELTA_SECS)}, ${String(MAX_FRAME_DELTA_SECS)}] s.`,
    ),
    `   ${cell('raw', 14)}${padStart('applied', 12)}${padStart('lost', 14)}`,
    ...rows,
    '',
    `   NaN maps to FIRST_FRAME_DELTA_SECS ${String(FIRST_FRAME_DELTA_SECS)}, not to a propagated NaN.`,
    `   frameDeltaBetween(undefined, 5) = ${String(frameDeltaBetween(undefined, MonotonicTimeSecs(5)))}  (first frame)`,
    `   frameDeltaBetween(10, 5)        = ${String(frameDeltaBetween(10, MonotonicTimeSecs(5)))}  (clock ran BACKWARDS; simulated time still moves forward)`,
    '',
    '   FINDING SIM-5. Everything in the "lost" column above zero is simulated time the world',
    '   never receives and nothing ever repays. One 30-second background tab costs 29.95 s of',
    '   in-game time permanently. That is the design working — see domain/frame-timing.ts:19-23 —',
    '   but the quantity is written down nowhere, and there is no counter for it on GameLoopApi,',
    '   so a session cannot tell a caller how far behind it has fallen.',
  ]
}

// ---------------------------------------------------------------------------
// TIME — the ordering hazard, and its twin
// ---------------------------------------------------------------------------

const timeOrderProbe = (): ReadonlyArray<string> => {
  const fresh = Time.INITIAL_TIME_STATE

  const safe = Time.setTimeOfDay(Time.setDayLength(fresh, 600), 0.3)
  const unsafe = Time.setDayLength(Time.setTimeOfDay(fresh, 0.3), 600)
  const combined = Time.setDayLengthThenTimeOfDay(fresh, 600, 0.3)

  // Age a world four in-game days, then "load" it two ways.
  let aged = fresh
  for (let day = 0; day < 4; day += 1) {
    aged = Time.advance(aged, (Time.dayLengthSecs(aged) as unknown) as never)
  }
  const viaRestore = aged
  const viaConfigure = Time.setDayLengthThenTimeOfDay(
    aged,
    Time.dayLengthSecs(aged),
    Time.timeOfDay(aged),
  )

  // The module header's OTHER worked example, with the day length the test uses.
  const unsafeShorter = Time.setDayLength(Time.setTimeOfDay(fresh, 0.3), 200)

  const clockOf = (state: Time.TimeState): string => clockFace(Time.timeOfDay(state))

  return [
    ...section(
      'TIME-ORDER',
      'setDayLength changes a DENOMINATOR and leaves the absolute tick counter alone.',
    ),
    `   ${cell('sequence', 46)}${padStart('timeOfDay', 12)}${padStart('clock', 9)}`,
    `   ${cell('fresh world (INITIAL_TIME_STATE, 400 s day)', 46)}${numberCell(Time.timeOfDay(fresh), 4, 12)}${padStart(clockOf(fresh), 9)}`,
    `   ${cell('setDayLength(600) then setTimeOfDay(0.30)', 46)}${numberCell(Time.timeOfDay(safe), 4, 12)}${padStart(clockOf(safe), 9)}`,
    `   ${cell('setTimeOfDay(0.30) then setDayLength(600)', 46)}${numberCell(Time.timeOfDay(unsafe), 4, 12)}${padStart(clockOf(unsafe), 9)}`,
    `   ${cell('setTimeOfDay(0.30) then setDayLength(200)', 46)}${numberCell(Time.timeOfDay(unsafeShorter), 4, 12)}${padStart(clockOf(unsafeShorter), 9)}`,
    `   ${cell('setDayLengthThenTimeOfDay(600, 0.30)', 46)}${numberCell(Time.timeOfDay(combined), 4, 12)}${padStart(clockOf(combined), 9)}`,
    '',
    '   The hazard itself is known, named and pinned by test/time-of-day.test.ts:43-53.',
    '',
    '   FINDING SIM-11. The canonical statement of it is arithmetically WRONG.',
    '   domain/time-of-day.ts:17-18 reads:',
    '',
    '       setDayLength(600) then setTimeOfDay(0.30)  ->  timeOfDay 0.30   (intended)',
    '       setTimeOfDay(0.30) then setDayLength(600)  ->  timeOfDay 0.60   (a bug)',
    '',
    `   The second line yields ${fixed(Time.timeOfDay(unsafe), 4)}, not 0.60 — see the table above. 0.60 needs the day to get`,
    `   SHORTER (400 s -> 200 s, halving the denominator), which is exactly what the regression test`,
    '   uses: test/time-of-day.test.ts:49 passes 200, and its comment at :47 says "denominator to',
    '   12000". With 600 the day gets LONGER, so the same absolute tick lands EARLIER in it and the',
    '   time of day moves DOWN, to 0.20.',
    '',
    '   Why this matters more than a typo: those two lines are the one place a consumer reads to',
    '   learn the rule, they are presented as a matched pair sharing the argument 600, and the wrong',
    '   half moves in the opposite direction from the truth. Anyone who reproduces it with 600 gets',
    '   0.20, concludes the note is unreliable, and has no reason to trust the rest of it. The test',
    '   cannot catch this: it asserts the code, and the code is right.',
    '   Reproduce: pnpm preview --stats | grep -A6 TIME-ORDER',
    '',
    ...section(
      'TIME-MOON',
      'configureDay is documented as what WORLD LOAD should call. It resets the day counter.',
    ),
    `   ${cell('after 4 in-game days', 40)}ticks ${numberCell(aged.ticks, 0, 10)}   moonPhase ${String(Time.moonPhase(viaRestore))}`,
    `   ${cell('reloaded via restore(snapshot)', 40)}ticks ${numberCell(viaRestore.ticks, 0, 10)}   moonPhase ${String(Time.moonPhase(viaRestore))}`,
    `   ${cell('reloaded via configureDay(same, same)', 40)}ticks ${numberCell(viaConfigure.ticks, 0, 10)}   moonPhase ${String(Time.moonPhase(viaConfigure))}`,
    '',
    '   FINDING SIM-8. application/time-service.ts:47-48 says configureDay is "what world bootstrap',
    '   and world load should call". For BOOTSTRAP that is right. For LOAD it silently discards the',
    '   day number — and domain/time-of-day.ts:39-42 states that the absolute counter is kept',
    '   precisely BECAUSE getMoonPhase needs it. A world reloaded through configureDay comes back on',
    '   moon phase 0 whatever night it was. The load path is restore(snapshot); the doc comment',
    '   should say so. No test covers a load, because no test loads a world.',
  ]
}

const timeRestoreProbe = Effect.gen(function* () {
  const time = yield* makeTimeService()
  yield* time.restore({ ticks: 0, dayLengthTicks: 0 })

  const broken = {
    timeOfDay: yield* time.timeOfDay,
    moonPhase: yield* time.moonPhase,
    isNight: yield* time.isNight,
    dayLengthSecs: yield* time.dayLengthSecs,
  }

  yield* time.setTimeOfDay(0.5)
  const afterSetter = yield* time.timeOfDay

  yield* time.advance((1 as unknown) as never)
  const afterAdvance = yield* time.timeOfDay

  yield* time.setDayLength(600)
  const afterDayLength = yield* time.timeOfDay

  return [
    ...section(
      'TIME-RESTORE',
      'TimeService.restore is the save/load path. It validates nothing.',
    ),
    `   restore({ ticks: 0, dayLengthTicks: 0 })`,
    `   ${cell('timeOfDay', 22)}${String(broken.timeOfDay)}`,
    `   ${cell('moonPhase', 22)}${String(broken.moonPhase)}`,
    `   ${cell('dayLengthSecs', 22)}${String(broken.dayLengthSecs)}`,
    `   ${cell('isNight', 22)}${String(broken.isNight)}     <- FALSE, because NaN < 0.25 and NaN > 0.75 are both false`,
    '',
    `   ${cell('after setTimeOfDay(0.5)', 30)}timeOfDay = ${String(afterSetter)}   (0.5 x 0 = 0; the documented setter cannot recover it)`,
    `   ${cell('after advance(1 s)', 30)}timeOfDay = ${String(afterAdvance)}   (60 % 0 = NaN)`,
    `   ${cell('after setDayLength(600)', 30)}timeOfDay = ${String(afterDayLength)}   (the ONLY way back)`,
    '',
    '   FINDING SIM-1. A truncated or older-schema save reaches restore() unchecked, and the world',
    '   then reports permanent daylight — not an error, not a NaN the UI could notice, but the',
    '   boolean `false`. Mobs never spawn and the sky never darkens. domain/time-of-day.ts documents',
    '   the [120, 1200] clamp on setDayLength and applies none of it on the restore path.',
    '   Reproduce: pnpm preview --scenario corrupt-save --at 90 --once --ascii',
  ]
})

// ---------------------------------------------------------------------------
// INVENTORY
// ---------------------------------------------------------------------------

const inventoryProbe = Effect.gen(function* () {
  const shrunk = yield* makeInventoryService()
  yield* shrunk.restore({ slots: [undefined, undefined] })
  const leftover = yield* shrunk.add('STONE', 1000)
  const held = yield* shrunk.countOf('STONE')

  const overfull: Inventory = {
    slots: [
      { item: 'STONE', count: (200 as unknown) as StackCount },
      ...emptyInventory().slots.slice(1),
    ],
  }
  const removal = attempt(() => removeItem(overfull, 'STONE', 1))
  const addition = attempt(() => {
    const service = emptyInventory()
    return service
  })

  return [
    ...section('INV-SLOTS', 'InventoryService.restore does not check the slot count.'),
    `   INVENTORY_SLOT_COUNT   ${String(INVENTORY_SLOT_COUNT)}`,
    `   restore({ slots: [undefined, undefined] })  ->  a 2-slot player`,
    `   add('STONE', 1000)     accepted ${String(held)}, leftover ${String(leftover)}`,
    '',
    '   FINDING SIM-2. A save written by a build with a different slot count silently resizes the',
    '   player. 872 of 1000 mined blocks go on the floor and the only symptom is a full inventory.',
    '   emptyInventory() is the only constructor that produces the right length, and restore()',
    '   bypasses it. Reproduce: pnpm preview --scenario corrupt-save --at 215 --once --ascii',
    '',
    ...section(
      'INV-STACK',
      'removeItem writes StackCount(left), and StackCount is a Brand.refined constructor.',
    ),
    `   MAX_STACK_COUNT        ${String(MAX_STACK_COUNT)}`,
    `   a restored slot holding 200 STONE`,
    `   removeItem(inventory, 'STONE', 1)   ->   ${removal.ok ? 'returned normally' : 'THREW (Brand refinement rejected 199)'}`,
    `   emptyInventory() length             ->   ${String(addition.ok ? addition.value.slots.length : 'threw')}`,
    '',
    '   FINDING SIM-3. domain/inventory.ts is documented as pure and total — every transition',
    '   "returns the resulting inventory plus whatever the caller has to know about it". removeItem',
    '   is neither, for any slot outside [0, 64], and that is reachable from restore(). In the frame',
    '   loop the throw becomes a Cause.Die, which application/game-loop.ts:167 logs and swallows, so',
    '   the player simply finds that mining and crafting have stopped working. Nothing fails.',
    '   Reproduce: pnpm preview --scenario corrupt-save --at 280 --once --ascii',
  ]
})

// ---------------------------------------------------------------------------
// AUTOSAVE
// ---------------------------------------------------------------------------

const autoSaveProbe = Effect.gen(function* () {
  const spacedRuns = yield* Ref.make(0)
  const spacedTick = Effect.sleep(Duration.millis(40)).pipe(
    Effect.zipRight(Ref.update(spacedRuns, (count) => count + 1)),
  )
  const spacedFiber = yield* Effect.fork(
    Effect.repeat(spacedTick, autoSaveSchedule(Duration.millis(100))),
  )
  yield* TestClock.adjust(Duration.millis(1000))
  yield* Fiber.interrupt(spacedFiber)

  const fixedRuns = yield* Ref.make(0)
  const fixedTick = Effect.sleep(Duration.millis(40)).pipe(
    Effect.zipRight(Ref.update(fixedRuns, (count) => count + 1)),
  )
  const fixedFiber = yield* Effect.fork(
    Effect.repeat(fixedTick, Schedule.fixed(Duration.millis(100))),
  )
  yield* TestClock.adjust(Duration.millis(1000))
  yield* Fiber.interrupt(fixedFiber)

  // When does the FIRST save happen?
  const firstRuns = yield* Ref.make(0)
  const firstFiber = yield* startAutoSaveDaemon(
    Ref.update(firstRuns, (count) => count + 1),
    Duration.seconds(5),
  )
  yield* TestClock.adjust(Duration.zero)
  const atZero = yield* Ref.get(firstRuns)
  yield* TestClock.adjust(Duration.seconds(5))
  const atFive = yield* Ref.get(firstRuns)
  yield* Fiber.interrupt(firstFiber)

  return [
    ...section(
      'AUTOSAVE-SCHEDULE',
      'spaced measures from the END of the previous run; fixed fires on an absolute grid.',
    ),
    `   100 ms interval, 40 ms tick, 1000 ms window`,
    `   ${cell('Schedule.spaced (what mc-sim uses)', 40)}${String(yield* Ref.get(spacedRuns))} runs`,
    `   ${cell('Schedule.fixed  (what it must not)', 40)}${String(yield* Ref.get(fixedRuns))} runs`,
    '',
    ...section('AUTOSAVE-FIRST', 'When does the first save happen?'),
    `   ${cell('saves at t = 0', 24)}${String(atZero)}`,
    `   ${cell('saves at t = 5 s', 24)}${String(atFive)}`,
    '',
    '   FINDING SIM-9. Effect.repeat runs its effect BEFORE consulting the schedule, so',
    '   startAutoSaveDaemon writes a save the instant it is forked — i.e. during world load, over',
    '   the save that was just read, before the player has done anything. Whether that is wanted is',
    '   a decision; application/autosave.ts documents the spaced-versus-fixed choice at length and',
    '   does not mention this one, and test/autosave.test.ts:141 asserts only a lower bound',
    '   (toBeGreaterThanOrEqual(4)), which is satisfied either way.',
    '',
    ...section(
      'AUTOSAVE-CLOCK',
      'Which clock does the autosave schedule read?',
    ),
    '   PlayerService.cameraPose   Effect<CameraPoseSnapshot, never, ClockPort>     <- Port in the type',
    '   startAutoSaveDaemon        Effect<Fiber.RuntimeFiber<number, never>>        <- no Port at all',
    '',
    '   FINDING SIM-6. domain/time-of-day.ts:46-49 says "Time enters the simulation at exactly one',
    '   place, the frame loop, and is passed down." Autosave is a second place, and its clock is',
    '   Effect\'s ambient Clock rather than ClockPort. application/player-service.ts:29-33 argues',
    '   that making the clock requirement visible in the type is what stops someone simplifying it',
    '   into a wall read; the one service in this repository whose entire job is deciding WHEN does',
    '   not do that. scripts/check-dependency-whitelist.ts cannot see it either: it greps for',
    '   Date.now() / new Date() / performance.now(), and Schedule.spaced reaches the platform clock',
    '   through a service. A replay or a headless fast-forward therefore autosaves on wall time.',
    '   Reproduce: pnpm preview --scenario clock-divergence --at 200 --once --ascii',
  ]
})

// ---------------------------------------------------------------------------
// GAME LOOP
// ---------------------------------------------------------------------------

const gameLoopProbe = Effect.gen(function* () {
  const loop = yield* makeGameLoop()
  const processed = yield* Ref.make(0)

  yield* loop.start(() => Ref.update(processed, (count) => count + 1))

  const submitted = 200
  yield* Effect.forEach(
    Array.from({ length: submitted }, (_unused, index) => MonotonicTimeSecs(index)),
    (at) => loop.submitFrame(at),
    { discard: true },
  )
  yield* Effect.yieldNow()
  yield* TestClock.adjust(Duration.millis(1))

  const seen = yield* Ref.get(processed)
  const framesProcessedWhileRunning = yield* loop.framesProcessed
  yield* loop.stop
  const framesProcessedWhenStopped = yield* loop.framesProcessed

  return [
    ...section(
      'LOOP-DROP',
      'The frame queue is Queue.dropping(60). What does a caller learn when it drops?',
    ),
    `   ${cell('frames submitted back to back', 34)}${String(submitted)}`,
    `   ${cell('handler invocations', 34)}${String(seen)}`,
    `   ${cell('framesProcessed (running)', 34)}${String(framesProcessedWhileRunning)}`,
    `   ${cell('framesProcessed (after stop)', 34)}${String(framesProcessedWhenStopped)}`,
    '',
    '   FINDING SIM-7. Dropping under load is the right behaviour and is argued for at',
    '   application/game-loop.ts:62-66. But Queue.offer RETURNS whether the item was accepted, and',
    '   application/game-loop.ts:193-195 discards it with Effect.asVoid. The information exists and',
    '   is thrown away at that line, so nothing — not the loop, not the HUD, not a bug report — can',
    '   say that the simulation lost frames. GameLoopApi has framesProcessed and no framesDropped.',
    '',
    '   The second row above is the other half: framesProcessed reads 0 once the loop is stopped,',
    '   because the counter belongs to the generation (documented at game-loop.ts:96-100). So the',
    '   one moment a caller most wants the count — after teardown, writing a report — is the one',
    '   moment it is unavailable.',
  ]
})

// ---------------------------------------------------------------------------

const HEADER: ReadonlyArray<string> = [
  'mc-sim --stats — the deterministic scenario stepper, in numbers',
  '',
  'Nothing here asserts. Every line is a quantity, and every FINDING names what should become a',
  'test in test/ — that is where a claim can fail CI. Run with --ascii for a pasteable copy.',
]

const FOOTER: ReadonlyArray<string> = [
  '',
  '== what this report does NOT cover',
  '',
  '   walk / swim / jump / sneak. docs/testing.md §1 asks the preview to confirm those by',
  '   operation, and mc-sim owns none of them: PlayerServiceApi is pose / look / moveTo /',
  '   cameraPose / restore / reset, and moveTo is a teleport that nothing resists. There is no',
  '   velocity, no grounded flag, no crouch state, no buoyancy and no collider anywhere in this',
  '   repository. That is a boundary, not an omission — plan.md §2.3-1 gives verbs to the',
  '   experience tier — but it means the obstacle course cannot be built here today, and',
  '   mc-playground-kit does not change it. See apps/preview-sim/README.md.',
  '',
  '   pnpm preview --scenario obstacle-course      runs the course anyway, to show exactly that.',
]

/** The whole report. */
export const statsReport = Effect.gen(function* () {
  const parts = [
    ...HEADER,
    ...frameClampProbe(),
    ...timeOrderProbe(),
    ...(yield* timeRestoreProbe),
    ...(yield* inventoryProbe),
    ...(yield* autoSaveProbe),
    ...(yield* gameLoopProbe),
    ...FOOTER,
  ]
  return parts.map(line)
}).pipe(Effect.provide(TestContext.TestContext as Layer.Layer<never>))
