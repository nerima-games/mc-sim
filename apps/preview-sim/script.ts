/**
 * The scripted scenarios.
 *
 * A dev application, not shipped API.
 *
 * A scenario is DATA: a list of `(frame, action)` pairs. Nothing here runs
 * anything, which is what makes a scenario quotable in a bug report — the whole
 * reproduction is `--scenario <name> --at <frame>`, and the reader can see what
 * the frame does without running it.
 *
 * ---------------------------------------------------------------------------
 * Why this app scripts input instead of accepting it
 * ---------------------------------------------------------------------------
 *
 * docs/testing.md names this repository's preview an OBSTACLE COURSE: walk,
 * swim, jump, sneak, confirmed by operation. That form needs first-person
 * control, and the natural conclusion is that the preview must wait for
 * mc-render and mc-playground-kit.
 *
 * It must not, and the reason is not scheduling. **mc-sim owns no movement.**
 * `PlayerServiceApi` (application/player-service.ts:20-39) is `pose`, `look`,
 * `moveTo`, `cameraPose`, `restore`, `reset`. There is no velocity, no
 * acceleration, no grounded flag, no crouch state, no buoyancy and no collider.
 * `moveTo` is a teleport: it writes a feet position and nothing objects. So a
 * first-person obstacle course driven against today's mc-sim would let the
 * player walk through the obstacles, and the only thing it could demonstrate is
 * that the pose the renderer mirrors is the pose the script wrote — which is
 * `scenario.test.ts` with a camera attached.
 *
 * Walking, jumping and sneaking are mc-physics' and mx-gameplay's verbs
 * (plan.md §2.3-1: the foundation tier owns nouns, the experience tier owns
 * verbs). The obstacle course belongs to whichever repository first owns a
 * character controller. See `apps/preview-sim/README.md` for what specifically
 * is missing, and note that no amount of mc-playground-kit changes it.
 *
 * What mc-sim DOES own is eight state machines driven by an injected clock, and
 * every one of them has an interesting boundary. Those boundaries are what these
 * scenarios drive.
 */

import type { ItemType } from '../../src/domain/kernel-vocabulary'
import type { Settings } from '../../src/domain/settings'
import type { DamageCause, Vitals } from '../../src/domain/vitals'

/** One scripted action, applied at the top of a frame, before the frame is submitted. */
export type ScriptedAction =
  /** Rotate the view. Pitch is clamped by the library; yaw is not wrapped. */
  | { readonly kind: 'look'; readonly deltaYaw: number; readonly deltaPitch: number }
  /** Teleport. `moveTo` is all mc-sim has — see the module header. */
  | { readonly kind: 'moveTo'; readonly x: number; readonly y: number; readonly z: number }
  | { readonly kind: 'mine'; readonly item: ItemType; readonly count: number }
  | { readonly kind: 'spend'; readonly item: ItemType; readonly count: number }
  | { readonly kind: 'setDayLength'; readonly seconds: number }
  | { readonly kind: 'setTimeOfDay'; readonly fraction: number }
  | { readonly kind: 'configureDay'; readonly seconds: number; readonly fraction: number }
  /** Write a `TimeState` straight in, as a world load would. */
  | { readonly kind: 'restoreTime'; readonly ticks: number; readonly dayLengthTicks: number }
  /** Write an inventory straight in, as a world load would. `slots` is the slot count. */
  | {
      readonly kind: 'restoreInventory'
      readonly slots: number
      readonly stack: { readonly item: ItemType; readonly count: number } | undefined
    }
  /**
   * The injected monotonic clock jumps forward without frames being submitted:
   * the tab was in the background. The next frame's raw delta is therefore huge,
   * and `clampFrameDelta` is what stands between it and a teleporting player.
   */
  | { readonly kind: 'hiccup'; readonly seconds: number }
  /**
   * Advance the injected `ClockPort` WITHOUT advancing Effect's own `Clock`.
   * The two are different clocks and nothing in mc-sim ties them together —
   * see the `clock-divergence` scenario.
   */
  | { readonly kind: 'skewClockPort'; readonly seconds: number }
  /** Tear the world down and stand a new one up on the same service instances. */
  | { readonly kind: 'secondWorld' }
  /**
   * Take damage.
   *
   * `cause` is a bare string here for the same reason it is one in
   * `domain/vitals.ts`: the roster of things that can kill a player belongs to
   * mx-gameplay, and neither mc-sim nor this app reads it. The strings below are
   * mx-gameplay's `DeathCause` members, written out to show that they cross
   * unchanged.
   */
  | { readonly kind: 'damage'; readonly amount: number; readonly cause: DamageCause }
  | { readonly kind: 'heal'; readonly amount: number }
  /** Charge exhaustion. The COST is mx-gameplay's; the accumulator is mc-sim's. */
  | { readonly kind: 'exhaust'; readonly amount: number }
  | {
      readonly kind: 'eat'
      readonly foodPoints: number
      readonly saturationModifier: number
    }
  | { readonly kind: 'award'; readonly experience: number }
  | { readonly kind: 'respawn' }
  | { readonly kind: 'unlock'; readonly id: string }
  /** Write settings values. Held, never applied — that is the whole row. */
  | { readonly kind: 'setting'; readonly patch: Partial<Settings> }
  /** Write vitals straight in, as a world load would. */
  | { readonly kind: 'restoreVitals'; readonly vitals: Vitals }
  /** Stop the frame loop without restarting it. Frames submitted after are dropped. */
  | { readonly kind: 'stopLoop' }
  /** A caption for the timeline. Changes nothing. */
  | { readonly kind: 'note'; readonly text: string }

export type ScriptedStep = {
  readonly frame: number
  readonly action: ScriptedAction
  /** Why this step is here. Shown in the timeline panel. */
  readonly why: string
}

export type Scenario = {
  readonly name: string
  readonly headline: string
  readonly detail: ReadonlyArray<string>
  readonly steps: ReadonlyArray<ScriptedStep>
}

const step = (frame: number, why: string, action: ScriptedAction): ScriptedStep => ({
  frame,
  action,
  why,
})

/**
 * plan.md §3.8's own scenario, made watchable.
 *
 * "Spawn → mine → assert the inventory, fast-forward via the clock Port" is
 * already `test/scenario.test.ts`. What a test cannot do is let a person watch
 * the pose, the camera snapshot, the inventory and the day advance TOGETHER and
 * notice that one of them is wrong — an assertion only fails on the thing
 * someone already thought to assert.
 */
const MINE_AND_NIGHTFALL: Scenario = {
  name: 'mine-and-nightfall',
  headline: 'spawn → look → mine → fast-forward past dusk (plan.md §3.8)',
  detail: [
    'The deterministic scenario test, drawn instead of asserted. Watch the four',
    'panels move together: the camera snapshot is stamped from ClockPort, the day',
    'advances from the frame delta, and the inventory tops up partial stacks',
    'before it opens new slots.',
  ],
  steps: [
    step(0, 'day length BEFORE time of day — the only safe order', {
      kind: 'configureDay',
      seconds: 600,
      fraction: 0.25,
    }),
    step(0, 'spawn at a plausible surface height', { kind: 'moveTo', x: 8, y: 64, z: -8 }),
    step(30, 'turn a quarter turn and look down at the block being mined', {
      kind: 'look',
      deltaYaw: Math.PI / 2,
      deltaPitch: -0.4,
    }),
    step(60, 'first block', { kind: 'mine', item: 'stone', count: 1 }),
    step(75, 'second block: tops up the SAME slot, it does not open a new one', {
      kind: 'mine',
      item: 'stone',
      count: 1,
    }),
    step(90, 'a different item takes the next free slot', { kind: 'mine', item: 'dirt', count: 3 }),
    step(
      120,
      'a creative-sized drop: 130 spreads over three slots as 64 + 64 + 2',
      { kind: 'mine', item: 'cobblestone', count: 130 },
    ),
    step(200, 'spend more than is held: removed is 2, not 5, and it is not an error', {
      kind: 'spend',
      item: 'stone',
      count: 5,
    }),
    step(240, 'look up hard: pitch clamps at PI/2 - 0.01, yaw does not wrap', {
      kind: 'look',
      deltaYaw: 12,
      deltaPitch: 3,
    }),
    step(300, 'nightfall is arithmetic here, not a wait', { kind: 'note', text: 'watch isNight' }),
  ],
}

/**
 * The scenario docs/testing.md actually asks for, run against what mc-sim has.
 *
 * This is not a joke at the spec's expense. It is the demonstration: every
 * waypoint below is a teleport, because `moveTo` is the only way to change a
 * position in this repository. Nothing decelerates, nothing lands, nothing
 * floats and nothing refuses to enter a wall. Run it and read the pose panel:
 * the player "jumps" 1.25 blocks in ONE frame and is at the apex with no
 * velocity, which is the whole finding.
 */
const OBSTACLE_COURSE: Scenario = {
  name: 'obstacle-course',
  headline: 'docs/testing.md §1 walk / swim / jump / sneak, against what mc-sim owns',
  detail: [
    'Every waypoint is a teleport. mc-sim has moveTo and nothing else: no',
    'velocity, no grounded flag, no crouch, no buoyancy, no collider. The jump',
    'is instantaneous and the sneak is invisible because there is no state to',
    'show. This is what a first-person obstacle course would be built on today,',
    'and it is why this preview is a stepper instead. See README.md.',
  ],
  steps: [
    step(0, 'stand on the course', { kind: 'moveTo', x: 0, y: 64, z: 0 }),
    step(0, 'course start', { kind: 'note', text: 'WALK' }),
    step(30, 'walk: one block per 30 frames — a script, not a speed', {
      kind: 'moveTo',
      x: 0,
      y: 64,
      z: -1,
    }),
    step(60, 'walk', { kind: 'moveTo', x: 0, y: 64, z: -2 }),
    step(90, 'JUMP: apex reached in one frame, with no velocity anywhere', {
      kind: 'moveTo',
      x: 0,
      y: 65.25,
      z: -3,
    }),
    step(105, 'land: nothing detected the ground, the script simply chose 64', {
      kind: 'moveTo',
      x: 0,
      y: 64,
      z: -4,
    }),
    step(135, 'SNEAK: the eye should drop ~0.28 blocks. EYE_LEVEL_OFFSET is a constant', {
      kind: 'moveTo',
      x: 0,
      y: 64,
      z: -5,
    }),
    step(165, 'SWIM: y below the surface. Nothing in mc-sim knows what water is', {
      kind: 'moveTo',
      x: 0,
      y: 62,
      z: -6,
    }),
    step(195, 'walk out', { kind: 'moveTo', x: 0, y: 64, z: -7 }),
    step(210, 'course end', { kind: 'note', text: 'nothing resisted' }),
  ],
}

/**
 * The delta-time clamp at both of its boundaries, and its first frame.
 *
 * `domain/frame-timing.ts` fixes 0.001 / 0.05 / 0.016 and explains each. The
 * numbers are pinned by `test/frame-timing.test.ts`; what the test cannot show
 * is the CONSEQUENCE, which is that the world clock falls behind the injected
 * clock permanently after a background tab and never catches up.
 */
const TAB_REFOCUS: Scenario = {
  name: 'tab-refocus',
  headline: 'the deltaTime clamp at both boundaries (DN-03)',
  detail: [
    'A 30-second background gap arrives as ONE frame with a 30-second raw delta.',
    'Clamped to 0.05 the simulation runs slow rather than wrong — but nothing',
    'ever repays the lost 29.95 s, so the world clock and the injected clock',
    'diverge permanently. The CLOCK panel prints both. That divergence is the',
    'design working; it is also a number nobody has written down anywhere.',
  ],
  steps: [
    step(0, 'a 600 s day makes the drift easy to read as a fraction', {
      kind: 'configureDay',
      seconds: 600,
      fraction: 0.25,
    }),
    step(60, 'a 0.5 s stall: above the clamp, so 0.45 s is lost here too', {
      kind: 'hiccup',
      seconds: 0.5,
    }),
    step(120, 'the tab was in the background for thirty seconds', {
      kind: 'hiccup',
      seconds: 30,
    }),
    step(180, 'a 240 Hz frame pair: raw delta below 0.001, clamped UP', {
      kind: 'hiccup',
      seconds: -0.004,
    }),
    step(240, 'and again, to show the clamp is not a one-off', {
      kind: 'hiccup',
      seconds: 30,
    }),
  ],
}

/**
 * The ordering hazard, live.
 *
 * `domain/time-of-day.ts`'s header states it and `test/time-of-day.test.ts`
 * pins it. Watching the wall clock jump from 07:12 to 14:24 because a settings
 * slider moved is a different kind of knowing.
 */
const DAY_LENGTH_HAZARD: Scenario = {
  name: 'day-length-hazard',
  headline: 'setDayLength → setTimeOfDay does not commute (DN-04)',
  detail: [
    'The state is an ABSOLUTE tick counter over a DENOMINATOR, so changing the',
    'denominator moves the time of day. Frame 60 does it the safe way. Frame 180',
    'does it the way a mid-session settings change does, and the clock face',
    'jumps. Frame 300 shows the twin hazard nothing has written down: configureDay',
    'is documented as what WORLD LOAD should call, and it resets the day counter',
    'to zero, which is where moonPhase lives.',
  ],
  steps: [
    step(0, 'a fresh world: ticks 7200 over 24000, i.e. 0.30 — mid-morning', {
      kind: 'note',
      text: 'INITIAL_TIME_STATE',
    }),
    step(60, 'the SAFE order, via configureDay', {
      kind: 'configureDay',
      seconds: 600,
      fraction: 0.3,
    }),
    step(120, 'age the world four in-game days so moonPhase has something to lose', {
      kind: 'restoreTime',
      ticks: 36000 * 4 + 10800,
      dayLengthTicks: 36000,
    }),
    step(180, 'the UNSAFE half: a settings slider changing only the day length', {
      kind: 'setDayLength',
      seconds: 1200,
    }),
    step(300, 'a world load done with configureDay: moonPhase falls back to 0', {
      kind: 'configureDay',
      seconds: 1200,
      fraction: 0.6,
    }),
  ],
}

/**
 * The second world load — plan.md §3.8's worst bug class.
 *
 * Every service exposes `reset` and the loop's `start` is re-entrant. The
 * scenario stops the loop, resets all three services and starts again on the
 * SAME instances, exactly as an app-scoped singleton would be reused.
 */
const SECOND_WORLD: Scenario = {
  name: 'second-world',
  headline: 'teardown and reload on the same service instances (DN-02 / DN-09)',
  detail: [
    'Frame 120 stops the loop, resets player + inventory + time, and starts a',
    'fresh loop. Watch framesProcessed fall back to 0, the first frame after the',
    'restart be a FIRST frame (0.016, not a 2-second jump) and the inventory be',
    'empty rather than inherited. Frame 240 stops the loop and leaves it stopped:',
    'submitted frames climb and processed frames do not.',
  ],
  steps: [
    step(0, 'first world', { kind: 'configureDay', seconds: 600, fraction: 0.25 }),
    step(20, 'something to inherit, if anything were going to be inherited', {
      kind: 'mine',
      item: 'wooden_pickaxe',
      count: 5,
    }),
    step(60, 'and a pose to inherit', { kind: 'moveTo', x: 128, y: 12, z: -64 }),
    step(120, 'save & quit → load', { kind: 'secondWorld' }),
    step(150, 'second world mines its own', { kind: 'mine', item: 'stone', count: 2 }),
    step(240, 'stop and stay stopped: submitFrame is a silent no-op after this', {
      kind: 'stopLoop',
    }),
  ],
}

/**
 * A corrupt save, restored.
 *
 * `snapshot` / `restore` are documented as the persistence pair. Persistence is
 * where malformed values come from — a truncated IndexedDB write, an older
 * schema, a hand-edited file. Neither restore validated anything, and all three
 * of the results below were unrecoverable: a world in permanent daylight, a
 * player silently resized to two slots, and a domain function that threw inside
 * the frame loop where the throw was logged and swallowed.
 *
 * THE SCRIPT IS UNCHANGED. It still feeds exactly the same malformed values,
 * because a scenario rewritten to feed legal ones would no longer reach the
 * boundary it exists to reach. What changed is what the panels show afterwards:
 * every value is now repaired at the point it goes in, and the `findings` panel
 * says which repair ran.
 */
const CORRUPT_SAVE: Scenario = {
  name: 'corrupt-save',
  headline: 'restore() accepts anything a save can contain, and repairs what it cannot answer for',
  detail: [
    'Frame 60 restores a TimeState with dayLengthTicks 0. Every reader used to',
    'return NaN from then on — and isNight returns FALSE for NaN, so the world',
    'reported permanent daylight. normaliseTimeState now clamps it to the legal',
    'minimum, and the setters at 120 and 150 work rather than being the only',
    'escape. Frame 180 restores a 2-slot inventory into a 36-slot player: the',
    'length is re-established, so the 1000 blocks mined at 210 all fit instead',
    'of 872 of them hitting the floor. Frame 240 installs a slot holding 200 of',
    'a 64-max item, which is spilled across four slots; the remove at 270 then',
    'returns normally where it used to throw out of a pure domain function and',
    'stop the INVENTORY panel dead.',
  ],
  steps: [
    step(0, 'a healthy world first, so the change is visible', {
      kind: 'configureDay',
      seconds: 600,
      fraction: 0.3,
    }),
    step(30, 'ordinary mining', { kind: 'mine', item: 'stone', count: 20 }),
    step(60, 'a truncated save: dayLengthTicks 0', {
      kind: 'restoreTime',
      ticks: 0,
      dayLengthTicks: 0,
    }),
    step(120, 'the documented setter, which a repaired world now obeys', {
      kind: 'setTimeOfDay',
      fraction: 0.5,
    }),
    step(150, 'setDayLength was once the ONLY way back', { kind: 'setDayLength', seconds: 600 }),
    step(180, 'a save from a build with a smaller inventory', {
      kind: 'restoreInventory',
      slots: 2,
      stack: undefined,
    }),
    step(210, 'the player still has 36 slots, so all 1000 fit', {
      kind: 'mine',
      item: 'stone',
      count: 1000,
    }),
    step(240, 'a slot holding 200 of a 64-max item', {
      kind: 'restoreInventory',
      slots: 36,
      stack: { item: 'stone', count: 200 },
    }),
    step(270, 'remove one. 199 is no longer an unrepresentable remainder', {
      kind: 'spend',
      item: 'stone',
      count: 1,
    }),
  ],
}

/**
 * mc-sim has TWO clocks, and only one of them is a Port.
 *
 * `PlayerService.cameraPose` is `Effect<CameraPoseSnapshot, never, ClockPort>`,
 * and application/player-service.ts:29-33 says the visible requirement is the
 * point — it is what stops someone simplifying the call into a wall-clock read.
 *
 * `startAutoSaveDaemon` is `Effect<Fiber.RuntimeFiber<number, never>>`. No
 * `ClockPort`. Its schedule sleeps on Effect's ambient `Clock`, and NOTHING
 * connects the two — which is what this scenario shows by pulling them apart.
 *
 * That is a deliberate split rather than a defect, and application/autosave.ts
 * now carries the argument: a Port reads an INSTANT, a schedule sleeps for a
 * DURATION, `ClockPort` has no `sleep` and may not grow one (it is mirrored
 * from mc-kernel), and Effect's `Clock` is itself injectable — `TestClock` is
 * what this app replaces it with. Both clocks here are deterministic. The thing
 * a caller must know is that a replay has to set BOTH, and that is exactly what
 * the divergence below looks like when it forgets one.
 */
const CLOCK_DIVERGENCE: Scenario = {
  name: 'clock-divergence',
  headline: 'ClockPort and Effect Clock are two clocks; a replay must set both',
  detail: [
    'The CLOCK panel prints both. From frame 60 the injected ClockPort runs',
    'ahead: camera snapshots are stamped later and later, exactly as a replay or',
    'a fast-forward would stamp them. Autosave does not notice, because its',
    'schedule sleeps on Effect Clock and nothing connects the two. Reverse the',
    'skew and autosave fires during a simulation that has not moved. Neither',
    'clock is a wall clock here — the point is that they are two, not that one',
    'of them is uninjected.',
  ],
  steps: [
    step(0, 'ordinary world', { kind: 'configureDay', seconds: 600, fraction: 0.25 }),
    step(60, 'ClockPort jumps 20 s ahead of Effect Clock: a replay seeking forward', {
      kind: 'skewClockPort',
      seconds: 20,
    }),
    step(120, 'and again', { kind: 'skewClockPort', seconds: 20 }),
    step(180, 'the snapshot stamp is now 40 s ahead of the autosave schedule', {
      kind: 'note',
      text: 'compare the two clock rows',
    }),
  ],
}

/**
 * The vitals boundary, driven until it shows.
 *
 * `domain/vitals.ts` claims four things that a reader has to take on trust from
 * the module header. This scenario makes each of them a number on the screen:
 *
 *   1. A `NaN` blow is ABSORBED, and the player stays killable. The failure it
 *      prevents — permanent immortality — is invisible from inside a green
 *      suite, because nothing throws and the player simply stops dying.
 *   2. mc-sim EMITS a food-tick signal and applies nothing. `starve` appears in
 *      the panel while health does not move, which is the boundary made
 *      visible: the amount and the cause are mx-gameplay's, and this app has
 *      neither.
 *   3. Exhaustion drains the hidden reserve before the visible bar, four at a
 *      time, and the COST of each action came from the caller.
 *   4. A level-up is arithmetic over one stored total, so the bar and the
 *      counter cannot disagree.
 */
const VITALS: Scenario = {
  name: 'vitals',
  headline: 'health / hunger / XP, and the line 「何がダメージを与えるか」 sits on',
  detail: [
    'A food tick is FOUR SECONDS, which at the default 60 fps is every 240th',
    'frame — so the steps below are placed around f240 / f480 / f720 / f960 on',
    'purpose, and the FOOD row is the thing to watch. (The reference stores 80',
    'TICKS for the same four seconds because it runs at 20 t/s; carrying that',
    '80 across would fire every 1.33 s here and starve a player three times too',
    'fast, while looking like a faithful port.)',
    'Frame 60 throws a NaN blow: health must NOT move and the player must stay',
    'killable — the alternative is an immortal player no assertion caught.',
    'f240 signals regen. f300-f420 drain the hidden saturation reserve before',
    'the visible bar, so f480 signals starve. NOTHING APPLIES EITHER SIGNAL:',
    'the amount and the cause are mx-gameplay’s, and this app has neither.',
    'f960 kills the player; f1020 respawns them with their experience intact,',
    'because the death penalty is a rule and rules are not held here.',
  ],
  steps: [
    step(0, 'a long day, so the vitals rows are what moves', {
      kind: 'configureDay',
      seconds: 1200,
      fraction: 0.3,
    }),
    step(0, 'settings are VALUES: this render distance is held and applied by nobody', {
      kind: 'setting',
      patch: { renderDistance: 12, masterVolume: 0.4 },
    }),
    step(30, 'an ordinary blow: 6 of 20, no cause recorded because nobody died', {
      kind: 'damage',
      amount: 6,
      cause: 'fall',
    }),
    step(60, 'A BLOW WITH NO MAGNITUDE. Health must not move, and must stay killable', {
      kind: 'damage',
      amount: Number.NaN,
      cause: 'explosion',
    }),
    step(120, 'hurt and well fed, which is the only state that signals regen', {
      kind: 'note',
      text: 'the first food tick is at f240',
    }),
    step(300, 'sprinting, priced by mx-gameplay at 0.1 per block: 40 blocks', {
      kind: 'exhaust',
      amount: 4,
    }),
    step(330, 'and again — the RESERVE drains first, the shanks do not move', {
      kind: 'exhaust',
      amount: 4,
    }),
    step(360, 'a long sprint. One call is capped at 40, i.e. ten points at a time', {
      kind: 'exhaust',
      amount: 100,
    }),
    step(390, 'the reserve is gone; from here every four takes a visible shank', {
      kind: 'exhaust',
      amount: 40,
    }),
    step(420, 'and the bar reaches zero', { kind: 'exhaust', amount: 40 }),
    step(450, 'still empty at the second tick, which is what makes it a starve', {
      kind: 'note',
      text: 'the second food tick is at f480',
    }),
    step(600, 'bread: 5 food, saturation modifier 0.6 — the numbers are the CALLER’s', {
      kind: 'eat',
      foodPoints: 5,
      saturationModifier: 0.6,
    }),
    step(620, 'and a full meal, so the third tick at f720 signals regen again', {
      kind: 'eat',
      foodPoints: 20,
      saturationModifier: 1.2,
    }),
    step(660, 'mining pays experience; the level is derived from one stored total', {
      kind: 'award',
      experience: 16,
    }),
    step(700, 'enough to cross a level boundary: the bar resets, the counter climbs', {
      kind: 'award',
      experience: 20,
    }),
    step(760, 'an achievement is RECORDED here and DECIDED somewhere else', {
      kind: 'unlock',
      id: 'time-to-mine',
    }),
    step(800, 'a settings write the clamp has to move: 400 chunks is not loadable', {
      kind: 'setting',
      patch: { renderDistance: 400, fovDegrees: Number.NaN },
    }),
    step(960, 'the killing blow. Its cause is the one that survives', {
      kind: 'damage',
      amount: 40,
      cause: 'lava',
    }),
    step(990, 'a corpse struck again: the death message must NOT be rewritten', {
      kind: 'damage',
      amount: 100,
      cause: 'explosion',
    }),
    step(1020, 'respawn — health returns, experience does not reset', { kind: 'respawn' }),
    step(1100, 'a save no transition here could have produced. Read every row after', {
      kind: 'restoreVitals',
      vitals: {
        healthPoints: 20,
        maxHealthPoints: Number.NaN,
        hungerPoints: 99,
        maxHungerPoints: Number.POSITIVE_INFINITY,
        saturation: -3,
        exhaustion: 1e9,
        foodTimerSecs: Number.NaN,
        totalExperience: Number.POSITIVE_INFINITY,
        lastDamageCause: undefined,
      },
    }),
  ],
}

export const SCENARIOS: ReadonlyArray<Scenario> = [
  MINE_AND_NIGHTFALL,
  OBSTACLE_COURSE,
  TAB_REFOCUS,
  DAY_LENGTH_HAZARD,
  SECOND_WORLD,
  CORRUPT_SAVE,
  CLOCK_DIVERGENCE,
  VITALS,
]

export const SCENARIO_NAMES = [
  'mine-and-nightfall',
  'obstacle-course',
  'tab-refocus',
  'day-length-hazard',
  'second-world',
  'corrupt-save',
  'clock-divergence',
  'vitals',
] as const

export type ScenarioName = (typeof SCENARIO_NAMES)[number]

export const scenarioFor = (name: ScenarioName): Scenario =>
  SCENARIOS.find((scenario) => scenario.name === name) ?? MINE_AND_NIGHTFALL

/** Steps scheduled exactly at `frame`. Several may share one frame. */
export const stepsAt = (scenario: Scenario, frame: number): ReadonlyArray<ScriptedStep> =>
  scenario.steps.filter((scripted) => scripted.frame === frame)

/** The next frame at or after `frame` that has a scripted step, or undefined. */
export const nextEventFrame = (scenario: Scenario, frame: number): number | undefined => {
  const upcoming = scenario.steps
    .map((scripted) => scripted.frame)
    .filter((at) => at > frame)
    .sort((left, right) => left - right)
  return upcoming[0]
}
