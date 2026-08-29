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
 * now holds it.
 *
 * Eleven findings were reported here and are now fixed. The sections did NOT
 * become "OK" lines: each one still prints the quantity that was wrong, next to
 * the value it has now and the test that pins it. A report that deleted its
 * findings on the day they were fixed would leave the next reader unable to
 * tell a boundary that was checked from one that was never looked at.
 */
import { Duration, Effect, Fiber, Ref, Schedule, TestClock, TestContext, Layer } from 'effect'
import { autoSaveSchedule, startAutoSaveDaemon } from '../../src/application/autosave'
import { makeGameLoop } from '../../src/application/game-loop'
import { makeInventoryService } from '../../src/application/inventory-service'
import { makeTimeService } from '../../src/application/time-service'
import {
  clampFrameDelta,
  FIRST_FRAME_DELTA_SECS,
  frameDeltaBetween,
  frameDeltaLossSecs,
  MAX_FRAME_DELTA_SECS,
  MIN_FRAME_DELTA_SECS,
} from '../../src/domain/frame-timing'
import {
  emptyInventory,
  INVENTORY_SLOT_COUNT,
  maxStackCountForItem,
  normaliseInventory,
  removeItem,
  type Inventory,
} from '../../src/domain/inventory'
import { MonotonicTimeSecs, type StackCount } from '@nerima-games/mc-kernel'
import * as Time from '../../src/domain/time-of-day'
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
    return (
      `   ${cell(Number.isNaN(raw) ? 'NaN' : fixed(raw, 6), 14)}${numberCell(applied, 6, 12)}` +
      `${numberCell(lost, 6, 14)}${numberCell(frameDeltaLossSecs(raw), 6, 14)}`
    )
  })

  return [
    ...section(
      'FRAME-CLAMP',
      `clampFrameDelta over its whole range. Bounds [${String(MIN_FRAME_DELTA_SECS)}, ${String(MAX_FRAME_DELTA_SECS)}] s.`,
    ),
    `   ${cell('raw', 14)}${padStart('applied', 12)}${padStart('raw-applied', 14)}${padStart('counted lost', 14)}`,
    ...rows,
    '',
    `   NaN maps to FIRST_FRAME_DELTA_SECS ${String(FIRST_FRAME_DELTA_SECS)}, not to a propagated NaN.`,
    `   frameDeltaBetween(undefined, 5) = ${String(frameDeltaBetween(undefined, MonotonicTimeSecs(5)))}  (first frame)`,
    `   frameDeltaBetween(10, 5)        = ${String(frameDeltaBetween(10, MonotonicTimeSecs(5)))}  (clock ran BACKWARDS; simulated time still moves forward)`,
    '',
    '   SIM-5 FIXED. The fourth column is new: domain/frame-timing.ts exports frameDeltaLossSecs,',
    '   and application/game-loop.ts sums it across a generation as GameLoopApi.secondsLostToClamp.',
    '   The clamp is unchanged — it is the design working, see domain/frame-timing.ts:19-23 — but',
    '   the 29.95 s a 30-second background tab costs is now a number a session can report instead',
    '   of one only this table could compute.',
    '',
    '   Only the UPPER clamp counts. The negative rows hand the world MORE time than elapsed,',
    '   which is bounded by one frame and cannot drift; counting them would let the two cancel',
    '   and read as zero. Pinned by test/frame-timing.test.ts',
    '   `the LOWER clamp is not a loss — it hands the world more time, not less` and',
    '   `loss and applied delta always add back up to the raw interval`.',
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
    '   The hazard itself is known, named and pinned by test/time-of-day.test.ts.',
    '',
    '   SIM-11 FIXED. The canonical statement of the hazard was arithmetically WRONG.',
    '   domain/time-of-day.ts:17-18 used to read:',
    '',
    '       setDayLength(600) then setTimeOfDay(0.30)  ->  timeOfDay 0.30   (intended)',
    '       setTimeOfDay(0.30) then setDayLength(600)  ->  timeOfDay 0.60   (a bug)',
    '',
    `   The second line yields ${fixed(Time.timeOfDay(unsafe), 4)}, not 0.60 — see the table above. 0.60 needs the day to get`,
    '   SHORTER (400 s -> 200 s, halving the denominator); with 600 the day gets LONGER, the same',
    '   absolute tick lands EARLIER in it, and the time of day moves DOWN. The header now states',
    '   0.20 for the 600 s case and spells out both directions, since both are real.',
    '',
    '   Why this mattered more than a typo: those two lines are the one place a consumer reads to',
    '   learn the rule, they are presented as a matched pair sharing the argument 600, and the wrong',
    '   half moved in the OPPOSITE direction from the truth. Anyone who reproduced it with 600 got',
    '   0.20, concluded the note was unreliable, and had no reason to trust the rest of it — a',
    '   correct and load-bearing warning discredited by its own worked example.',
    '',
    '   No existing test could catch it: every one of them asserts the CODE, and the code was',
    '   right. test/time-of-day.test.ts now carries one that asserts the NUMBER THE COMMENT PRINTS',
    '   — `REGRESSION: the module header worked example is the arithmetic — a LONGER day moves the',
    '   time of day DOWN, to 0.20` — so the doc and the arithmetic cannot separate again.',
    '   Reproduce: pnpm preview --stats | grep -A6 TIME-ORDER',
    '',
    ...section(
      'TIME-MOON',
      'configureDay resets the day counter. That is right for bootstrap and wrong for a load.',
    ),
    `   ${cell('after 4 in-game days', 40)}ticks ${numberCell(aged.ticks, 0, 10)}   moonPhase ${String(Time.moonPhase(viaRestore))}`,
    `   ${cell('reloaded via restore(snapshot)', 40)}ticks ${numberCell(viaRestore.ticks, 0, 10)}   moonPhase ${String(Time.moonPhase(viaRestore))}`,
    `   ${cell('reloaded via configureDay(same, same)', 40)}ticks ${numberCell(viaConfigure.ticks, 0, 10)}   moonPhase ${String(Time.moonPhase(viaConfigure))}`,
    '',
    '   SIM-8 FIXED. application/time-service.ts used to say configureDay was "what world bootstrap',
    '   and world load should call". For BOOTSTRAP that is right. For LOAD it silently discards the',
    '   day number — and domain/time-of-day.ts states that the absolute counter is kept precisely',
    '   BECAUSE moonPhase needs it, so a world reloaded that way came back on moon phase 0 whatever',
    '   night it was saved on. The behaviour above is UNCHANGED and correct: setTimeOfDay moves the',
    '   state into day zero by design, which is what a bootstrap wants.',
    '',
    '   What changed is the instruction. The doc comment now reads "WORLD BOOTSTRAP CALLS THIS.',
    '   WORLD LOAD CALLS restore, NOT THIS", and says why. "No test covers a load, because no test',
    '   loads a world" is no longer true either: test/time-service.test.ts loads one both ways and',
    '   pins the difference, in `restore keeps the absolute tick counter, so the moon phase comes',
    '   back as saved` and `configureDay with the SAME arguments throws the day number away`.',
  ]
}

const timeRestoreProbe = Effect.gen(function* () {
  const corrupt: Time.TimeState = { ticks: 0, dayLengthTicks: 0 }
  const time = yield* makeTimeService()
  yield* time.restore(corrupt)

  const repaired = {
    timeOfDay: yield* time.timeOfDay,
    moonPhase: yield* time.moonPhase,
    isNight: yield* time.isNight,
    dayLengthSecs: yield* time.dayLengthSecs,
  }

  yield* time.setTimeOfDay(0.5)
  const afterSetter = yield* time.timeOfDay

  yield* time.advance((1 as unknown) as never)
  const afterAdvance = yield* time.timeOfDay

  // A world that was saved four in-game days in must come back on the same
  // night, which is the half of `restore` that was always right and that the
  // repair must not disturb.
  const aged: Time.TimeState = { ticks: 103_200, dayLengthTicks: 24000 }
  const loaded = yield* makeTimeService()
  yield* loaded.restore(aged)

  return [
    ...section(
      'TIME-RESTORE',
      'TimeService.restore is the save/load path. It repairs what it cannot answer for.',
    ),
    `   restore({ ticks: 0, dayLengthTicks: 0 })      valid beforehand? ${String(Time.isValidTimeState(corrupt))}`,
    `   ${cell('timeOfDay', 22)}${String(repaired.timeOfDay)}${cell('', 12)}was NaN`,
    `   ${cell('moonPhase', 22)}${String(repaired.moonPhase)}${cell('', 12)}was NaN`,
    `   ${cell('dayLengthSecs', 22)}${String(repaired.dayLengthSecs)}${cell('', 10)}was 0, now the MIN_DAY_LENGTH_SECS clamp`,
    `   ${cell('isNight', 22)}${String(repaired.isNight)}${cell('', 9)}was FALSE — permanent daylight, because`,
    `   ${cell('', 22)}${cell('', 14)}NaN < 0.25 and NaN > 0.75 are BOTH false`,
    '',
    `   ${cell('after setTimeOfDay(0.5)', 30)}timeOfDay = ${String(afterSetter)}   (was stuck: 0.5 x 0 = 0)`,
    `   ${cell('after advance(1 s)', 30)}timeOfDay = ${String(afterAdvance)}   (was stuck: 60 % 0 = NaN)`,
    '',
    `   restore({ ticks: 103200, dayLengthTicks: 24000 })   a healthy 4-day-old save`,
    `   ${cell('ticks', 22)}${String((yield* loaded.snapshot).ticks)}${cell('', 6)}unchanged — a good save is never rewritten`,
    `   ${cell('moonPhase', 22)}${String(yield* loaded.moonPhase)}`,
    '',
    '   SIM-1 FIXED. A truncated or older-schema save reached restore() unchecked, and the world',
    '   then reported permanent daylight — not an error, not a NaN the UI could notice, but the',
    '   boolean `false`. Mobs never spawned and the sky never darkened, and no setter could',
    '   recover it. domain/time-of-day.ts now exports normaliseTimeState, which applies the SAME',
    '   [120, 1200] clamp setDayLength applies, and restore runs it.',
    '',
    '   The repair is at the boundary and NOT in isNight, deliberately: mx-gameplay/domain/',
    '   day-night.ts restates that predicate character for character (docs/public-api.md §2-0),',
    '   and it lives in a repository this one cannot edit. A NaN branch here would have made the',
    '   two silently disagree. Pinned by test/time-service.test.ts `isNight reports a real answer,',
    '   where a NaN fraction made it report DAY forever` and test/time-of-day.test.ts',
    '   `REGRESSION: the predicate is still exactly `< 0.25 || > 0.75``.',
    '   Reproduce: pnpm preview --scenario corrupt-save --at 90 --once --ascii',
  ]
})

// ---------------------------------------------------------------------------
// INVENTORY
// ---------------------------------------------------------------------------

const inventoryProbe = Effect.gen(function* () {
  const shrunk = yield* makeInventoryService()
  const restoreLeftover = yield* shrunk.restore({ slots: [undefined, undefined] })
  const restoredSlotCount = (yield* shrunk.snapshot).slots.length
  const leftover = yield* shrunk.add('stone', 1000)
  const held = yield* shrunk.countOf('stone')

  const overfull: Inventory = {
    slots: [
      { item: 'stone', count: (200 as unknown) as StackCount },
      ...emptyInventory().slots.slice(1),
    ],
  }
  const removal = attempt(() => removeItem(overfull, 'stone', 1))
  const addition = attempt(() => {
    const service = emptyInventory()
    return service
  })

  // The sanctioned repair, which accounts for the surplus instead of dropping it.
  const normalised = normaliseInventory(overfull)
  const usable = yield* makeInventoryService()
  yield* usable.restore(overfull)
  const removedFromRepaired = yield* usable.remove('stone', 70)

  return [
    ...section('INV-SLOTS', 'InventoryService.restore re-establishes the slot count.'),
    `   INVENTORY_SLOT_COUNT   ${String(INVENTORY_SLOT_COUNT)}`,
    `   restore({ slots: [undefined, undefined] })  ->  ${String(restoredSlotCount)} slots, leftover ${String(restoreLeftover)}   (was a 2-slot player)`,
    `   add('stone', 1000)     accepted ${String(held)}, leftover ${String(leftover)}   (was accepted 128, leftover 872)`,
    '',
    '   SIM-2 FIXED. A save written by a build with a different slot count silently RESIZED the',
    '   player, and a snapshot crosses a version boundary — exactly when a slot count changes. 872',
    '   of 1000 mined blocks went on the floor with no symptom but an inventory that was always',
    '   full. domain/inventory.ts now exports normaliseInventory, and both restore() and the',
    '   service constructor run it, so emptyInventory() is no longer the only path to the right',
    '   length. A LONGER save has its tail re-inserted rather than truncated, and whatever',
    '   genuinely does not fit comes back as restore()\'s return value — the same currency as add,',
    '   which the caller turns into dropped-item entities. Pinned by test/inventory.test.ts',
    '   `a two-slot save no longer resizes a 36-slot player`.',
    '   Reproduce: pnpm preview --scenario corrupt-save --at 215 --once --ascii',
    '',
    ...section(
      'INV-STACK',
      'removeItem writes a derived count, and StackCount is a Brand.refined constructor.',
    ),
    `   stone item stack limit     ${String(maxStackCountForItem('stone'))}`,
    `   a restored slot holding 200 stone`,
    `   removeItem(inventory, 'stone', 1)   ->   ${removal.ok ? 'returned normally' : 'THREW (Brand refinement rejected 199)'}   (was: THREW)`,
    `   emptyInventory() length             ->   ${String(addition.ok ? addition.value.slots.length : 'threw')}`,
    '',
    `   normaliseInventory(that inventory)  ->   ${String(normalised.inventory.slots.length)} slots, all 200 stone kept, leftover ${String(normalised.leftover)}`,
    `   restore(it) then remove('stone', 70) ->  removed ${String(removedFromRepaired)}   (the service path, end to end)`,
    '',
    '   SIM-3 FIXED. domain/inventory.ts is documented as pure and total — every transition',
    '   "returns the resulting inventory plus whatever the caller has to know about it". removeItem',
    "   was neither, for any slot outside its item's kernel limit, and that was reachable from restore(). In the",
    '   frame loop the throw became a Cause.Die, which application/game-loop.ts logs and SWALLOWS,',
    '   so the player simply found that mining and crafting had stopped working. Nothing failed;',
    '   nothing could.',
    '',
    '   Every read of a slot count now goes through a guard and every derived write through a',
    '   clamp, so the module is total on an inventory it did not build — including one holding NaN,',
    '   which used to poison `removed` with arithmetic rather than a throw. The clamp DOES lose the',
    '   surplus, which is why it is the total path and not the sanctioned one: normaliseInventory',
    '   spills 200 stone across four slots and reports what will not fit, and restore() runs it',
    '   before a slot like this can exist. Pinned by test/inventory.test.ts',
    "   `removeItem does not throw on a slot holding more than the item's stack limit` and",
    '   `an over-full slot keeps a full stack and the surplus spills into free slots`.',
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
    `   ${cell('saves at t = 0', 24)}${String(atZero)}   (was 1 — a save on the fork)`,
    `   ${cell('saves at t = 5 s', 24)}${String(atFive)}   (was 2)`,
    '',
    '   SIM-9 FIXED. Effect.repeat runs its effect BEFORE consulting the schedule, so',
    '   startAutoSaveDaemon wrote a save the instant it was forked — i.e. during world load, over',
    '   the save that was just read, before the player had done anything. Nothing had changed, so',
    '   a crash during load could only lose data. application/autosave.ts documented the',
    '   spaced-versus-fixed choice at length and did not mention this one.',
    '',
    '   Effect.schedule consults the schedule first, so the sequence is sleep-then-save and the',
    '   first save is due at t = interval. Nothing else moves: AUTOSAVE-SCHEDULE above still reads',
    '   7 against 10, so `spaced` still measures from the END of the previous run.',
    '',
    '   The old pin could not see any of this: test/autosave.test.ts asserted only',
    '   toBeGreaterThanOrEqual(4), which four saves and five saves both satisfy. It is now an',
    '   exact count, alongside `REGRESSION: the first save is due after one interval, NOT the',
    '   instant it is forked`.',
    '',
    ...section(
      'AUTOSAVE-CLOCK',
      'Which clock does the autosave schedule read?',
    ),
    '   PlayerService.cameraPose   Effect<CameraPoseSnapshot, never, ClockPort>     <- Port in the type',
    '   startAutoSaveDaemon        Effect<Fiber.RuntimeFiber<number, never>>        <- Effect Clock',
    '',
    '   SIM-6 DECIDED — NOT MOVED, and the reasoning is now in application/autosave.ts rather',
    '   than only here. The complaint was fair: domain/time-of-day.ts says "Time enters the',
    '   simulation at exactly one place, the frame loop", autosave is a second place, and',
    '   application/player-service.ts argues that a clock requirement visible in the TYPE is what',
    '   stops someone simplifying it into a wall read.',
    '',
    '   ClockPort cannot carry a schedule. It READS AN INSTANT — monotonicSecs and',
    '   wallClockEpochMillis are its whole surface — while a schedule SLEEPS FOR A DURATION. There',
    '   is no sleep on the Port and there cannot be one: it is mirrored from mc-kernel, and a',
    '   wider copy of a Context.Tag resolved by textual key is the exact runtime hazard',
    '   the direct mc-kernel ClockPort boundary is meant to prevent. A Port-driven daemon would have to poll,',
    '   which needs something else to drive the poll and which TestClock.adjust would no longer',
    '   advance — every autosave test would become a hand-driven polling harness and the schedule',
    '   would stop being the thing under test.',
    '',
    '   Effect\'s ambient Clock is itself an injectable service, and TestClock is what replaces it:',
    '   the schedule is already driven entirely in virtual time with no wall-clock read anywhere,',
    '   which is why five-second intervals cost zero real seconds in this app. The requirement a',
    '   caller must know is therefore "a deterministic replay must set the Effect Clock", not',
    '   "provide a Port", and test/autosave.test.ts now pins it: `the schedule is driven entirely',
    '   by the Effect Clock, with no wall-clock read` fast-forwards ten simulated minutes.',
    '',
    '   static import rules still cannot see this service dependency — it is governed by',
    '   deterministic TestClock coverage and by the explicit Effect Clock boundary in',
    '   application/autosave.ts, not by a direct wall-clock read.',
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
  const framesDroppedWhileRunning = yield* loop.framesDropped
  yield* loop.stop
  const framesProcessedWhenStopped = yield* loop.framesProcessed
  const framesDroppedWhenStopped = yield* loop.framesDropped
  const lostWhenStopped = yield* loop.secondsLostToClamp

  return [
    ...section(
      'LOOP-DROP',
      'The frame queue is Queue.dropping(60). What does a caller learn when it drops?',
    ),
    `   ${cell('frames submitted back to back', 34)}${String(submitted)}`,
    `   ${cell('handler invocations', 34)}${String(seen)}`,
    `   ${cell('framesProcessed (running)', 34)}${String(framesProcessedWhileRunning)}`,
    `   ${cell('framesDropped  (running)', 34)}${String(framesDroppedWhileRunning)}`,
    `   ${cell('framesProcessed (after stop)', 34)}${String(framesProcessedWhenStopped)}   (was 0)`,
    `   ${cell('framesDropped  (after stop)', 34)}${String(framesDroppedWhenStopped)}`,
    `   ${cell('secondsLostToClamp (after stop)', 34)}${fixed(lostWhenStopped, 3)}`,
    '',
    '   SIM-7 FIXED. Dropping under load is the right behaviour and is argued for in',
    '   application/game-loop.ts. But Queue.offer RETURNS whether the item was accepted, and that',
    '   boolean was discarded with Effect.asVoid — so nothing, not the loop, not a HUD, not a bug',
    '   report, could say the simulation had lost frames. It is not recoverable by subtraction',
    '   either: frames submitted is the caller\'s own count and frames processed lags it by',
    '   whatever is still queued. GameLoopApi now publishes framesDropped, counted at the offer.',
    '',
    '   SIM-10 FIXED. framesProcessed used to read 0 once the loop was stopped, because the',
    '   counter belongs to the generation — so the one moment a caller most wants the count, after',
    '   teardown while writing a session report, was the one moment it was unavailable. stop() now',
    '   takes one reading of the generation it is retiring and keeps it, and the next start()',
    '   zeroes it. Rule 4 in the module header still holds: a frozen number is not a shared',
    '   mutable field a straggling fiber could write through.',
    '',
    '   Pinned by test/game-loop.test.ts `REGRESSION: frames the dropping queue refuses are',
    '   counted, not silently discarded`, `REGRESSION: the counters survive stop, which is when a',
    '   teardown report reads them`, and `a fresh start zeroes them`.',
  ]
})

// ---------------------------------------------------------------------------

const HEADER: ReadonlyArray<string> = [
  'mc-sim --stats — the deterministic scenario stepper, in numbers',
  '',
  'Nothing here asserts. Every line is a quantity, and every SIM-nn line names the test in test/',
  'that holds it — that is where a claim can fail CI. Run with --ascii for a pasteable copy.',
  '',
  'All eleven findings this report raised are now closed: ten fixed, one (SIM-6) decided against',
  'with the reasoning moved into the source. The sections still print what was wrong next to what',
  'it reads now, because a boundary that was checked and a boundary nobody looked at should not',
  'be indistinguishable in a report whose whole job is to be recomputable.',
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
