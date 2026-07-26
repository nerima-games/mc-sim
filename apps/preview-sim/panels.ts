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
import { MAX_FRAME_DELTA_SECS, MIN_FRAME_DELTA_SECS } from '../../domain/frame-timing'
import { INVENTORY_SLOT_COUNT } from '../../domain/inventory'
import { MAX_STACK_COUNT } from '../../domain/kernel-vocabulary'
import { MOON_PHASE_COUNT, TICKS_PER_SECOND } from '../../domain/time-of-day'
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

  const dropped = view.framesSubmitted - view.framesProcessed

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
      'loop',
      `${view.loopRunning ? style.paint('running', GOOD) : style.paint('STOPPED', BAD)}   ` +
        `submitted ${style.paint(String(view.framesSubmitted), VALUE)}   ` +
        `processed ${style.paint(String(view.framesProcessed), VALUE)}   ` +
        `unaccounted ${style.paint(String(dropped), dropped === 0 ? VALUE : BAD)}`,
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
 * current `WorldView` that is FALSE in an ordinary run and TRUE once the
 * corresponding scenario has driven the world into the state described. Keeping
 * them here, next to the numbers they read, is what stops the README's claims
 * and the app's behaviour from drifting apart.
 */
export const findingsPanel = (view: WorldView, style: Style, width: number): ReadonlyArray<string> => {
  const findings: Array<{ readonly id: string; readonly hit: boolean; readonly text: string }> = [
    {
      id: 'SIM-1',
      hit: !Number.isFinite(view.timeOfDay),
      text: 'TimeService.restore accepted dayLengthTicks 0; isNight now reports day forever',
    },
    {
      id: 'SIM-2',
      hit: view.slotCount !== INVENTORY_SLOT_COUNT,
      text:
        view.slotCount === INVENTORY_SLOT_COUNT
          ? `InventoryService.restore does not check the slot count against INVENTORY_SLOT_COUNT (${String(INVENTORY_SLOT_COUNT)})`
          : `InventoryService.restore accepted ${String(view.slotCount)} slots, not ${String(INVENTORY_SLOT_COUNT)}`,
    },
    {
      id: 'SIM-3',
      hit: !view.inventoryUsable,
      text: 'a slot exceeds MAX_STACK_COUNT; the next remove() of it throws out of removeItem',
    },
    {
      id: 'SIM-4',
      hit: view.faults > 0,
      text: `${String(view.faults)} pure-domain call(s) threw and were swallowed, exactly as the frame loop would swallow them`,
    },
    {
      id: 'SIM-5',
      hit: view.clockPortSecs - view.simulatedSecs > 0.1,
      text: `the world is ${fixed(view.clockPortSecs - view.simulatedSecs, 3)} s behind the injected clock, and nothing repays it`,
    },
    {
      id: 'SIM-6',
      hit: Math.abs(view.effectClockMillis / 1000 - view.clockPortSecs) > 0.001,
      text: 'ClockPort and the Effect clock disagree; autosave follows the one that is not a Port',
    },
    {
      id: 'SIM-7',
      hit: view.loopRunning && view.framesSubmitted > view.framesProcessed,
      text: view.loopRunning
        ? `${String(view.framesSubmitted - view.framesProcessed)} submitted frame(s) unaccounted for; Queue.offer's drop signal is discarded at game-loop.ts:193-195`
        : "Queue.offer's drop signal is discarded at game-loop.ts:193-195; there is no framesDropped to read",
    },
    {
      id: 'SIM-10',
      hit: !view.loopRunning && view.framesSubmitted > 0,
      text: `framesProcessed reads ${String(view.framesProcessed)} because the loop is stopped, though ${String(view.framesSubmitted)} frames were submitted; the counter belongs to the generation, so it is unreadable exactly when a teardown report wants it`,
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
    ...inventoryPanel(view, style, width),
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
