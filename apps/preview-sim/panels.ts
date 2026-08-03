/**
 * The panels.
 *
 * A dev application, not shipped API.
 *
 * Every function here is a pure function of a `WorldView` and a `Style`. That is
 * not tidiness: the panels ARE the claim this preview makes, and a claim that
 * can only be evaluated by running a terminal UI is a claim nobody checks.
 *
 * The rule the panels are written to: **print the number the picture is
 * claiming.** A row saying "night" is unfalsifiable; a row saying
 * `0.8500  20:24  night` next to `dayLength 600 s  ticks 30600` can be
 * recomputed by hand and found wrong.
 */
import type { ScenarioName } from './script'
import { nextEventFrame, scenarioFor, stepsAt, type Scenario } from './script'
import {
  bar,
  BAD,
  clockFace,
  DAY,
  dayDial,
  degrees,
  fixed,
  GOOD,
  LABEL,
  NIGHT,
  NOTE,
  pad,
  padStart,
  VALUE,
  WARN,
  type Style,
} from './style'
import { MAX_FRAME_DELTA_SECS, MIN_FRAME_DELTA_SECS } from '../../src/domain/frame-timing'
import { INVENTORY_SLOT_COUNT } from '../../src/domain/inventory'
import { MAX_STACK_COUNT } from "@nerima-games/mc-kernel"
import { MAX_RENDER_DISTANCE } from '../../src/domain/settings'
import { MOON_PHASE_COUNT, TICKS_PER_SECOND } from '../../src/domain/time-of-day'
import { EXHAUSTION_PER_POINT, FOOD_TICK_SECS } from '../../src/domain/vitals'
import type { WorldView } from './world'

const LABEL_WIDTH = 14

const row = (style: Style, label: string, value: string): string =>
  `${style.paint(pad(label, LABEL_WIDTH), LABEL)}${value}`

const heading = (style: Style, text: string, width: number): string => {
  const line = `-- ${text} `
  return style.dim(line + '-'.repeat(Math.max(0, width - line.length)))
}

const xyz = (point: { readonly x: number; readonly y: number; readonly z: number }): string =>
  `${padStart(fixed(point.x, 3), 9)} ${padStart(fixed(point.y, 3), 9)} ${padStart(fixed(point.z, 3), 9)}`

// --- clocks ------------------------------------------------------------------

/**
 * The two clocks, side by side.
 *
 * `ClockPort` is the one mc-sim's type signatures talk about. `Effect Clock` is
 * the one `Schedule.spaced` actually sleeps on inside `startAutoSaveDaemon`.
 * `simulated` is neither: it is the SUM of the clamped frame deltas, i.e. the
 * only time the world itself has experienced. In an unremarkable run all three
 * agree; every scenario in `script.ts` that matters pulls them apart.
 */
export const clockPanel = (view: WorldView, style: Style, width: number): ReadonlyArray<string> => {
  const drift = view.clockPortSecs - view.simulatedSecs
  const driftStyle = Math.abs(drift) > 0.001 ? BAD : VALUE
  const effectSecs = view.effectClockMillis / 1000
  const clocksAgree = Math.abs(effectSecs - view.clockPortSecs) < 0.001

  return [
    heading(style, 'clocks', width),
    row(
      style,
      'ClockPort',
      `${style.paint(`${fixed(view.clockPortSecs, 3)} s`, VALUE)}  ${style.dim('injected Port; stamps every CameraPoseSnapshot')}`,
    ),
    row(
      style,
      'Effect Clock',
      `${style.paint(`${fixed(effectSecs, 3)} s`, clocksAgree ? VALUE : BAD)}  ${style.dim('what Schedule.spaced sleeps on — NOT a Port')}`,
    ),
    row(
      style,
      'simulated',
      `${style.paint(`${fixed(view.simulatedSecs, 3)} s`, driftStyle)}  ${style.dim(`sum of the clamped deltas — drift ${fixed(drift, 3)} s`)}`,
    ),
  ]
}

// --- frame -------------------------------------------------------------------

export const framePanel = (view: WorldView, style: Style, width: number): ReadonlyArray<string> => {
  const raw = view.lastRawDeltaSecs
  const applied = view.lastDeltaSecs
  const clamped =
    raw !== undefined &&
    applied !== undefined &&
    Math.abs(raw - applied) > 1e-9

  const rawText =
    raw === undefined ? 'first frame (no previous instant)' : `${fixed(raw, 6)} s`
  const appliedText = applied === undefined ? '—' : `${fixed(applied, 6)} s`

  // Submitted minus processed is "in flight or gone" and was the closest thing
  // to a drop count available. It is kept as a cross-check against the real
  // one, which the loop now counts at the offer.
  const unaccounted = view.framesSubmitted - view.framesProcessed

  return [
    heading(style, 'frame', width),
    row(
      style,
      'delta',
      `raw ${style.paint(padStart(rawText, 32), clamped ? WARN : VALUE)}  ->  applied ${style.paint(appliedText, clamped ? WARN : VALUE)}` +
        (clamped ? style.paint('   CLAMPED', WARN) : ''),
    ),
    row(
      style,
      'clamp',
      style.dim(
        `[${String(MIN_FRAME_DELTA_SECS)}, ${String(MAX_FRAME_DELTA_SECS)}] s — a 20 fps floor; anything above is lost, never repaid`,
      ),
    ),
    row(
      style,
      'lost',
      `${style.paint(`${fixed(view.secondsLostToClamp, 3)} s`, view.secondsLostToClamp > 0 ? WARN : VALUE)}  ` +
        style.dim('simulated time the clamp discarded — GameLoopApi.secondsLostToClamp'),
    ),
    row(
      style,
      'loop',
      `${view.loopRunning ? style.paint('running', GOOD) : style.paint('STOPPED', BAD)}   ` +
        `submitted ${style.paint(String(view.framesSubmitted), VALUE)}   ` +
        `processed ${style.paint(String(view.framesProcessed), VALUE)}   ` +
        `dropped ${style.paint(String(view.framesDropped), view.framesDropped === 0 ? VALUE : BAD)}   ` +
        style.dim(`unaccounted ${String(unaccounted)}`),
    ),
  ]
}

// --- pose --------------------------------------------------------------------

export const posePanel = (view: WorldView, style: Style, width: number): ReadonlyArray<string> => {
  const stale = view.poseSnapshotAgeSecs > 0.001

  return [
    heading(style, 'pose  (mc-sim is the AUTHORITY; mc-render only mirrors)', width),
    row(style, 'feet', style.paint(xyz(view.pose.feetPosition), VALUE)),
    row(
      style,
      'eye',
      `${style.paint(xyz(view.cameraPose.position), VALUE)}  ${style.dim('+1.62 applied HERE, not in the renderer')}`,
    ),
    row(
      style,
      'yaw / pitch',
      `${style.paint(padStart(degrees(view.pose.yawRadians), 10), VALUE)} ${style.paint(padStart(degrees(view.pose.pitchRadians), 10), VALUE)}   ` +
        style.dim('pitch clamps at +-(PI/2 - 0.01); yaw is NOT wrapped'),
    ),
    row(style, 'forward', style.paint(xyz(view.forward), VALUE)),
    row(
      style,
      'snapshot',
      `capturedAt ${style.paint(`${fixed(view.cameraPose.capturedAtSecs, 3)} s`, VALUE)}   ` +
        `age ${style.paint(`${fixed(view.poseSnapshotAgeSecs, 3)} s`, stale ? WARN : GOOD)}`,
    ),
  ]
}

// --- time --------------------------------------------------------------------

export const timePanel = (view: WorldView, style: Style, width: number): ReadonlyArray<string> => {
  const broken = !Number.isFinite(view.timeOfDay)
  const face = clockFace(view.timeOfDay)
  const phaseColour = broken ? BAD : view.isNight ? NIGHT : DAY

  return [
    heading(style, 'time of day', width),
    row(
      style,
      'now',
      `${style.paint(pad(face, 7), phaseColour)}${style.paint(pad(fixed(view.timeOfDay, 4), 9), broken ? BAD : VALUE)}` +
        `${style.paint(pad(view.isNight ? 'night' : 'day', 7), phaseColour)}` +
        style.dim('0 = MIDNIGHT, 0.25 = dawn, 0.5 = noon, 0.75 = dusk'),
    ),
    row(style, 'dial', `${style.paint(dayDial(view.timeOfDay, 48), phaseColour)}  ${style.dim('n = night half')}`),
    row(
      style,
      'state',
      `ticks ${style.paint(padStart(fixed(view.timeState.ticks, 1), 12), VALUE)}   ` +
        `dayLengthTicks ${style.paint(String(view.timeState.dayLengthTicks), broken ? BAD : VALUE)}   ` +
        style.dim(`(${String(TICKS_PER_SECOND)} ticks/s)`),
    ),
    row(
      style,
      'day',
      `length ${style.paint(`${fixed(view.dayLengthSecs, 1)} s`, VALUE)}   ` +
        `moon phase ${style.paint(`${fixed(view.moonPhase, 0)}/${String(MOON_PHASE_COUNT)}`, broken ? BAD : VALUE)}   ` +
        style.dim('moonPhase needs the ABSOLUTE tick counter — setTimeOfDay resets it'),
    ),
    ...(broken
      ? [
          row(
            style,
            '',
            style.paint(
              'dayLengthTicks is 0: every reader is NaN, and isNight reports FALSE for NaN — permanent daylight.',
              BAD,
            ),
          ),
        ]
      : []),
  ]
}

// --- inventory ---------------------------------------------------------------

export const inventoryPanel = (view: WorldView, style: Style, width: number): ReadonlyArray<string> => {
  const shrunk = view.slotCount !== INVENTORY_SLOT_COUNT

  const lines = view.slots.slice(0, 6).map((slot) => {
    const colour = slot.overfull ? BAD : VALUE
    return row(
      style,
      '',
      `${style.dim(`[${padStart(String(slot.index), 2)}]`)} ${style.paint(pad(slot.item, 14), colour)}` +
        `${style.paint(padStart(String(slot.count), 4), colour)}${style.dim(`/${String(MAX_STACK_COUNT)}`)} ` +
        style.paint(bar(slot.count, MAX_STACK_COUNT, 16), colour) +
        (slot.overfull ? style.paint('  OVER MAX_STACK_COUNT', BAD) : ''),
    )
  })

  return [
    heading(style, 'inventory', width),
    row(
      style,
      'slots',
      `${style.paint(String(view.slots.length), VALUE)} used of ` +
        `${style.paint(String(view.slotCount), shrunk ? BAD : VALUE)}` +
        (shrunk ? style.paint(`   NOT ${String(INVENTORY_SLOT_COUNT)} — restore() never checked`, BAD) : '') +
        (view.inventoryUsable ? '' : style.paint('   remove() now THROWS on this item', BAD)),
    ),
    ...(lines.length === 0 ? [row(style, '', style.dim('(empty)'))] : lines),
    ...(view.slots.length > 6
      ? [row(style, '', style.dim(`… and ${String(view.slots.length - 6)} more`))]
      : []),
  ]
}

// --- vitals ------------------------------------------------------------------

/**
 * Health, hunger and experience, with the numbers the picture is claiming.
 *
 * Every value on these rows comes out of `Vitals.vitalsView` — the same function
 * mx-ui's `VitalsSnapshot` is built from — rather than being recomputed here. A
 * panel with its own arithmetic could not disagree with the library about
 * anything, which would make it decorative.
 *
 * The SATURATION row is the one worth watching. It is invisible in vanilla and
 * invisible in mx-ui, so this is the only place in the whole chain where the
 * hidden reserve draining ahead of the visible bar can actually be seen.
 */
export const vitalsPanel = (view: WorldView, style: Style, width: number): ReadonlyArray<string> => {
  const vitals = view.vitals
  const projected = view.vitalsView
  const dead = projected.healthPoints <= 0
  const healthStyle = dead ? BAD : projected.healthPoints < projected.maxHealthPoints ? WARN : GOOD

  return [
    heading(style, 'vitals  (the NUMBERS are mc-sim’s; what causes them is not)', width),
    row(
      style,
      'health',
      `${style.paint(padStart(fixed(projected.healthPoints, 1), 6), healthStyle)}${style.dim(`/${fixed(projected.maxHealthPoints, 0)}`)} ` +
        `${style.paint(bar(projected.healthPoints, projected.maxHealthPoints, 20), healthStyle)}  ` +
        (dead
          ? style.paint(`DEAD — cause ${vitals.lastDamageCause ?? '(none recorded)'}`, BAD)
          : style.dim(`deaths ${String(view.deaths)}; the cause is carried, never interpreted`)),
    ),
    row(
      style,
      'hunger',
      `${style.paint(padStart(fixed(vitals.hungerPoints, 1), 6), VALUE)}${style.dim(`/${fixed(vitals.maxHungerPoints, 0)}`)} ` +
        `${style.paint(bar(vitals.hungerPoints, vitals.maxHungerPoints, 20), VALUE)}  ` +
        style.dim('the visible bar — the only half mx-ui draws'),
    ),
    row(
      style,
      'saturation',
      `${style.paint(padStart(fixed(vitals.saturation, 2), 6), NOTE)}${style.dim(`/${fixed(vitals.hungerPoints, 0)}`)} ` +
        `${style.paint(bar(vitals.saturation, Math.max(1, vitals.hungerPoints), 20), NOTE)}  ` +
        style.dim('HIDDEN reserve, spent before the bar; capped at it'),
    ),
    row(
      style,
      'exhaustion',
      `${style.paint(padStart(fixed(vitals.exhaustion, 3), 6), VALUE)}${style.dim(`/${String(EXHAUSTION_PER_POINT)}`)}  ` +
        style.dim('four spends one reserve point. The COST of an action is mx-gameplay’s'),
    ),
    row(
      style,
      'food tick',
      `${style.paint(`${fixed(vitals.foodTimerSecs, 3)} s`, VALUE)}${style.dim(`/${String(FOOD_TICK_SECS)} s`)}   ` +
        `regen ${style.paint(String(view.foodSignals.regen), VALUE)}   ` +
        `starve ${style.paint(String(view.foodSignals.starve), view.foodSignals.starve > 0 ? WARN : VALUE)}   ` +
        style.dim('signals EMITTED; mc-sim applies neither, because both are amounts'),
    ),
    row(
      style,
      'experience',
      `level ${style.paint(padStart(String(projected.experienceLevel), 4), VALUE)}   ` +
        `${style.paint(bar(projected.experienceProgress, 1, 20), VALUE)} ` +
        `${style.paint(`${String(Math.floor(projected.experienceProgress * 100))}%`, VALUE)}   ` +
        style.dim(`total ${fixed(vitals.totalExperience, 0)} — the level is DERIVED from it`),
    ),
  ]
}

// --- settings and statistics --------------------------------------------------

/**
 * The values held, and the record kept.
 *
 * Both rows exist to show an ABSENCE. Nothing in mc-sim reads a render distance
 * or a volume, and nothing here decides that a block was mined — the panel is
 * printing a ledger, and the ledger is the whole responsibility.
 */
export const heldStatePanel = (view: WorldView, style: Style, width: number): ReadonlyArray<string> => {
  const counters = Object.entries(view.statistics.counters)

  return [
    heading(style, 'held state  (settings: 値の保持 only · statistics: 記録 only)', width),
    row(
      style,
      'graphics',
      `renderDistance ${style.paint(String(view.settings.renderDistance), VALUE)}${style.dim(`/${String(MAX_RENDER_DISTANCE)}`)}   ` +
        `fov ${style.paint(fixed(view.settings.fovDegrees, 0), VALUE)}   ` +
        `quality ${style.paint(view.settings.graphicsQuality, VALUE)}   ` +
        style.dim('applied by mc-render, which mc-sim cannot see'),
    ),
    row(
      style,
      'volume',
      `audio ${style.paint(view.settings.audioEnabled ? 'on' : 'off', view.settings.audioEnabled ? GOOD : LABEL)}   ` +
        `master ${style.paint(fixed(view.settings.masterVolume, 2), VALUE)}   ` +
        `music ${style.paint(fixed(view.settings.musicVolume, 2), VALUE)}   ` +
        `sfx ${style.paint(fixed(view.settings.sfxVolume, 2), VALUE)}`,
    ),
    row(
      style,
      'controls',
      `sensitivity ${style.paint(fixed(view.settings.mouseSensitivity, 2), VALUE)}   ` +
        `rebinds ${style.paint(String(Object.keys(view.settings.keyBindings).length), VALUE)}   ` +
        style.dim('the roster of ACTIONS is mc-render’s; this map is overrides only'),
    ),
    row(
      style,
      'statistics',
      counters.length === 0
        ? style.dim('(nothing counted yet — mc-sim never decides that something happened)')
        : counters
            .slice(0, 3)
            .map(([key, count]) => `${style.dim(key)} ${style.paint(String(count), VALUE)}`)
            .join('   ') + (counters.length > 3 ? style.dim(`   +${String(counters.length - 3)} more`) : ''),
    ),
    row(
      style,
      'achievements',
      view.statistics.unlocked.length === 0
        ? style.dim('(none — the registry and its predicates are mx-gameplay’s)')
        : `${style.paint(view.statistics.unlocked.join(', '), VALUE)}   ` +
          style.dim('recorded here, decided elsewhere'),
    ),
  ]
}

// --- autosave ----------------------------------------------------------------

export const autoSavePanel = (view: WorldView, style: Style, width: number): ReadonlyArray<string> => [
  heading(style, 'autosave', width),
  row(
    style,
    'schedule',
    `${style.paint('Schedule.spaced', VALUE)} ${style.dim('— measured from the END of the previous run; no catch-up burst')}`,
  ),
  row(
    style,
    'fired',
    `${style.paint(String(view.autoSaveFired), VALUE)}   ` +
      `status ${style.paint(view.autoSaveStatus ?? '—', view.autoSaveStatus === 'error' ? BAD : GOOD)}   ` +
      `last at ${style.paint(view.autoSaveLastAtMillis === undefined ? '—' : `${String(view.autoSaveLastAtMillis)} ms`, VALUE)}   ` +
      style.dim('on the EFFECT clock, not ClockPort'),
  ),
]

// --- timeline ----------------------------------------------------------------

export const timelinePanel = (
  scenario: Scenario,
  frame: number,
  style: Style,
  width: number,
): ReadonlyArray<string> => {
  const here = stepsAt(scenario, frame)
  const next = nextEventFrame(scenario, frame)

  const upcoming = scenario.steps
    .filter((scripted) => scripted.frame >= frame)
    .slice(0, 4)
    .map((scripted) =>
      row(
        style,
        '',
        `${style.paint(padStart(`f${String(scripted.frame)}`, 7), scripted.frame === frame ? WARN : LABEL)} ` +
          `${style.paint(pad(scripted.action.kind, 18), scripted.frame === frame ? VALUE : LABEL)}` +
          style.dim(scripted.why),
      ),
    )

  return [
    heading(style, `timeline · ${scenario.name}`, width),
    row(
      style,
      'now',
      here.length === 0
        ? style.dim(`nothing scripted at f${String(frame)}` + (next === undefined ? ' — script exhausted' : `; next at f${String(next)}`))
        : style.paint(here.map((scripted) => scripted.action.kind).join(', '), WARN),
    ),
    ...upcoming,
  ]
}

// --- findings ----------------------------------------------------------------

/**
 * The findings, evaluated against the world as it stands.
 *
 * These are not decorations and not assertions. Each one is a predicate over the
 * current `WorldView`, TRUE once the corresponding scenario has driven the world
 * into the state described. Keeping them here, next to the numbers they read, is
 * what stops the README's claims and the app's behaviour from drifting apart.
 *
 * The defects these named are fixed, and the predicates were rewritten to match
 * rather than deleted. Two kinds remain:
 *
 *   - a REPAIRED condition — the corrupt input still arrives, and the panel now
 *     shows that the world absorbed it. `HIT` there means the repair ran, and a
 *     `corrupt-save` run that shows no hits would mean the scenario stopped
 *     reaching the boundary it exists to reach.
 *   - a QUANTITY that was previously uncountable and is now published. `HIT`
 *     means there is something to report, not that something is wrong.
 *
 * The distinction is in the text of each line, because a panel of green ticks
 * would say nothing about whether these boundaries are still being exercised.
 */
export const findingsPanel = (view: WorldView, style: Style, width: number): ReadonlyArray<string> => {
  const behindSecs = view.clockPortSecs - view.simulatedSecs
  const findings: Array<{ readonly id: string; readonly hit: boolean; readonly text: string }> = [
    {
      id: 'SIM-1',
      hit: view.timeStatesRepaired > 0,
      text: !Number.isFinite(view.timeOfDay)
        ? 'timeOfDay is NOT FINITE — normaliseTimeState was bypassed, and isNight is about to report day forever'
        : view.timeStatesRepaired > 0
          ? `${String(view.timeStatesRepaired)} un-answerable TimeState(s) repaired on restore; the world reads ${fixed(view.dayLengthSecs, 0)} s days and isNight is a real ${String(view.isNight)}`
          : 'no restore has handed TimeService a state it had to repair; isValidTimeState is what a caller asks first',
    },
    {
      id: 'SIM-2',
      hit: view.inventoriesResized > 0,
      text:
        view.slotCount === INVENTORY_SLOT_COUNT
          ? `${String(view.inventoriesResized)} save(s) of the wrong length restored, all held at ${String(INVENTORY_SLOT_COUNT)} slots; ${String(view.restoreLeftover)} item(s) reported as leftover for the caller to drop`
          : `InventoryService.restore accepted ${String(view.slotCount)} slots, not ${String(INVENTORY_SLOT_COUNT)} — the resize defect is back`,
    },
    {
      id: 'SIM-3',
      hit: !view.inventoryUsable,
      text: view.inventoryUsable
        ? 'no slot exceeds MAX_STACK_COUNT: restore() normalises, and removeItem is total even if one did'
        : 'a slot exceeds MAX_STACK_COUNT — removeItem repairs it rather than throwing, but nothing should have produced it',
    },
    {
      id: 'SIM-4',
      hit: view.faults > 0,
      text: `${String(view.faults)} pure-domain call(s) threw and were swallowed, exactly as the frame loop would swallow them`,
    },
    {
      id: 'SIM-5',
      hit: behindSecs > 0.1,
      text: `the world is ${fixed(behindSecs, 3)} s behind the injected clock; the loop counts ${fixed(view.secondsLostToClamp, 3)} s of that as clamp loss`,
    },
    {
      id: 'SIM-6',
      hit: Math.abs(view.effectClockMillis / 1000 - view.clockPortSecs) > 0.001,
      text: 'ClockPort and the Effect clock disagree; autosave follows the Effect clock, deliberately — a schedule sleeps, and a Port only reads an instant',
    },
    {
      id: 'SIM-7',
      hit: view.framesDropped > 0,
      text: `${String(view.framesDropped)} frame(s) refused by the dropping queue, counted at the offer — submitted minus processed could never have told you`,
    },
    {
      id: 'SIM-12',
      hit: view.blowsWithoutMagnitude > 0,
      text:
        view.blowsWithoutMagnitude === 0
          ? 'no blow with a NaN amount has been thrown; the vitals scenario throws one at f60'
          : Number.isFinite(view.vitals.healthPoints)
            ? `${String(view.blowsWithoutMagnitude)} blow(s) with no magnitude absorbed; health is a real ${fixed(view.vitals.healthPoints, 1)} and the player is still killable`
            : 'health is NOT FINITE — the delta guard was bypassed, and this player can no longer die',
    },
    {
      id: 'SIM-13',
      hit: view.foodSignals.starve > 0 || view.foodSignals.regen > 0,
      text: `${String(view.foodSignals.regen)} regen and ${String(view.foodSignals.starve)} starve signal(s) emitted and NONE applied — the amount and the cause are mx-gameplay's, and this app has neither`,
    },
    {
      id: 'SIM-14',
      hit: view.settingsClamped > 0 || view.vitalsRepaired > 0,
      text: `${String(view.settingsClamped)} settings write(s) the clamp had to move and ${String(view.vitalsRepaired)} vitals state(s) repaired on restore; both are counted at the CALL, because a repaired value is indistinguishable from one that was always legal`,
    },
    {
      id: 'SIM-10',
      hit: !view.loopRunning && view.framesSubmitted > 0,
      text: view.loopRunning
        ? `framesProcessed reads ${String(view.framesProcessed)} while running; stop the loop (the second-world scenario does) to see that the reading survives its generation`
        : `the loop is stopped and framesProcessed still reads ${String(view.framesProcessed)} of ${String(view.framesSubmitted)} submitted; the teardown reading survives the generation that produced it`,
    },
  ]

  return [
    heading(style, 'findings (live predicates, not assertions)', width),
    ...findings.map((finding) =>
      row(
        style,
        '',
        `${style.paint(pad(finding.id, 7), finding.hit ? BAD : LABEL)}` +
          `${style.paint(pad(finding.hit ? 'HIT' : '·', 5), finding.hit ? BAD : LABEL)}` +
          (finding.hit ? style.paint(finding.text, BAD) : style.dim(finding.text)),
      ),
    ),
  ]
}

// --- log ---------------------------------------------------------------------

export const logPanel = (view: WorldView, style: Style, width: number): ReadonlyArray<string> => [
  heading(style, 'log', width),
  ...view.log
    .slice(-6)
    .map((line) =>
      row(
        style,
        '',
        `${style.paint(padStart(`f${String(line.frame)}`, 7), LABEL)} ` +
          style.paint(line.text, line.severity === 'fault' ? BAD : line.severity === 'note' ? NOTE : VALUE),
      ),
    ),
]

// --- the whole frame ---------------------------------------------------------

export type PanelToggles = {
  readonly timeline: boolean
  readonly findings: boolean
}

export const renderFrame = (
  view: WorldView,
  scenarioName: ScenarioName,
  toggles: PanelToggles,
  style: Style,
  width: number,
): ReadonlyArray<string> => {
  const scenario = scenarioFor(scenarioName)

  return [
    style.bold(`mc-sim · deterministic scenario stepper`),
    `${style.paint(pad(scenario.name, 22), NOTE)}${style.dim(scenario.headline)}`,
    row(
      style,
      'frame',
      `${style.paint(padStart(String(view.frame), 6), VALUE)}   ` +
        style.dim('every number below is a function of this frame and nothing else'),
    ),
    '',
    ...clockPanel(view, style, width),
    '',
    ...framePanel(view, style, width),
    '',
    ...posePanel(view, style, width),
    '',
    ...timePanel(view, style, width),
    '',
    ...vitalsPanel(view, style, width),
    '',
    ...inventoryPanel(view, style, width),
    '',
    ...heldStatePanel(view, style, width),
    '',
    ...autoSavePanel(view, style, width),
    ...(toggles.timeline ? ['', ...timelinePanel(scenario, view.frame, style, width)] : []),
    ...(toggles.findings ? ['', ...findingsPanel(view, style, width)] : []),
    '',
    ...logPanel(view, style, width),
  ]
}

/** `--list`: what each scenario is for. */
export const scenarioCatalogue = (style: Style, width: number): ReadonlyArray<string> => {
  const lines: Array<string> = [heading(style, 'scenarios', width)]
  for (const scenario of [
    'mine-and-nightfall',
    'obstacle-course',
    'tab-refocus',
    'day-length-hazard',
    'second-world',
    'corrupt-save',
    'clock-divergence',
    'vitals',
  ] as const) {
    const found = scenarioFor(scenario)
    lines.push('')
    lines.push(`${style.bold(found.name)}  ${style.dim(found.headline)}`)
    for (const line of found.detail) {
      lines.push(`  ${style.dim(line)}`)
    }
  }
  return lines
}
