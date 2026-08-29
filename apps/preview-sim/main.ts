/**
 * `apps/preview-sim` — mc-sim's built-in preview: a deterministic scenario stepper.
 *
 * plan.md §2.3-4 requires a preview to live with the thing it verifies, and
 * plan.md §4.1 puts it under `apps/preview-<name>/`: a dev application INSIDE
 * mc-sim,
 * not a package, not part of `index.ts`, and not something a consumer can
 * import.
 *
 * ---------------------------------------------------------------------------
 * Why a stepper and not the obstacle course docs/testing.md asks for
 * ---------------------------------------------------------------------------
 *
 * docs/testing.md §1 quotes plan.md §3.8: 内蔵障害物コースプレビュー
 * （歩く/泳ぐ/跳ぶ/スニークを操作確認）. It also records the assumption that this
 * has to wait for mc-render and mc-playground-kit, because a first-person course
 * needs rendering and input.
 *
 * The dependency is real and the conclusion is still wrong, because the missing
 * piece is not the harness. **mc-sim owns no movement.** `PlayerServiceApi`
 * (application/player-service.ts:20-39) is exactly:
 *
 *     pose · look · moveTo · cameraPose · restore · reset
 *
 * There is no velocity, no acceleration, no grounded flag, no crouch state, no
 * buoyancy, no collider and no step-height. `moveTo` writes a feet position and
 * nothing objects to it. So an obstacle course built on today's mc-sim would let
 * the player walk through every obstacle, and the only property it could
 * demonstrate is that the pose the renderer mirrors is the pose the script
 * wrote — which is `test/scenario.test.ts` with a camera bolted on.
 *
 * Walking, swimming, jumping and sneaking are mc-physics' and mx-gameplay's
 * verbs (plan.md §2.3-1: the foundation tier owns nouns, the experience tier
 * owns verbs). The obstacle course belongs wherever the character controller
 * lands. `--scenario obstacle-course` runs the course anyway, as a teleport
 * script, precisely so that a reader can see what is and is not there.
 *
 * What mc-sim DOES own is eight state machines driven by an injected clock:
 * game-loop, time-service, inventory-service, player-service, autosave,
 * camera-pose, frame-timing and time-of-day. Every one of them has a boundary
 * worth watching, and every one is invisible from inside a first-person view —
 * you cannot see a `setDayLength → setTimeOfDay` ordering hazard by standing in
 * a field. A stepper that feeds a scripted sequence, advances frames one at a
 * time and prints pose, camera snapshot, both clocks, the day, the inventory and
 * the autosave schedule together is closer to what plan.md §3.8 actually asks
 * for ("Node 決定論シナリオテスト … クロックPortでfast-forward") than a 3D walk
 * would be, and it can show things a walk cannot.
 *
 * ---------------------------------------------------------------------------
 * Constraints this app is written under
 * ---------------------------------------------------------------------------
 *
 *  - The preview is included by `tsconfig.preview.json` and the repository lint
 *    gate, so its imports are checked like any other source here. It imports this
 *    repository's own modules and `effect`, which is already a declared
 *    dependency. No org package, no new npm dependency.
 *  - The `Date.now()` / `new Date()` / `performance.now()` ban applies, and this
 *    app is the one that must take it most seriously, because driving its own
 *    clock is the property under display. Both clocks are injected: `ClockPort`
 *    from a `Ref`, and Effect's own `Clock` from `TestContext`. The
 *    no time-source escape hatch is needed.
 *  - `pnpm verify` typechecks this app through `tsconfig.preview.json` and lints
 *    it. `pnpm preview` remains an interactive smoke test rather than a CI gate.
 */
import { Effect } from 'effect'
import { parseArguments, USAGE, type PreviewOptions } from './options'
import { renderFrame, scenarioCatalogue, type PanelToggles } from './panels'
import { statsReport } from './probes'
import { nextEventFrame, scenarioFor, SCENARIO_NAMES, type ScenarioName } from './script'
import { ANSI_STYLE, PLAIN_STYLE, dim, type Style } from './style'
import {
  enterFullScreen,
  isInteractive,
  leaveFullScreen,
  onExit,
  onInputEnd,
  onKey,
  onResize,
  paintFrame,
  screenSize,
  writeLine,
} from './terminal'
import { makeWorld, type World, type WorldConfig } from './world'

type State = {
  world: World
  scenario: ScenarioName
  toggles: PanelToggles
  showHelp: boolean
  /** True while a step is in flight, so a held key cannot interleave two steps. */
  busy: boolean
}

const frameWidth = (options: PreviewOptions): number =>
  Math.max(60, options.width ?? screenSize().columns)

const configFor = (options: PreviewOptions, scenario: ScenarioName): WorldConfig => ({
  scenario,
  fps: options.fps,
  dayLengthSecs: options.dayLengthSecs,
  timeOfDay: options.timeOfDay,
  autoSaveSecs: options.autoSaveSecs,
})

const styleFor = (options: PreviewOptions): Style => (options.ascii ? PLAIN_STYLE : ANSI_STYLE)

/**
 * Build a world and run it to `frames`.
 *
 * Every entry point goes through this, so `--once --at 300` and pressing `.`
 * three hundred times reach byte-identical state. That is the reproduction
 * guarantee the whole app rests on, and it holds because nothing in the step
 * path reads anything the caller did not supply.
 */
const runTo = async (config: WorldConfig, frames: number): Promise<World> => {
  const world = await makeWorld(config)
  if (frames > 0) {
    await world.advance(frames)
  }
  return world
}

const drawInto = async (state: State, options: PreviewOptions): Promise<ReadonlyArray<string>> => {
  const style = styleFor(options)
  const width = frameWidth(options)

  if (state.showHelp) {
    return [...USAGE, '', dim('press any key to return')]
  }

  const view = await state.world.view()
  return renderFrame(view, state.scenario, state.toggles, style, width)
}

const cycleScenario = (current: ScenarioName, by: number): ScenarioName => {
  const index = SCENARIO_NAMES.indexOf(current)
  const next = (index + by + SCENARIO_NAMES.length) % SCENARIO_NAMES.length
  return SCENARIO_NAMES[next] ?? current
}

/**
 * How many frames a key is worth.
 *
 * `undefined` means the key is not a step. Returning a number rather than
 * stepping directly keeps the key table a pure function, which is why the
 * interactive path and `--at` cannot disagree about what a step is.
 */
const framesForKey = (key: string, options: PreviewOptions): number | undefined => {
  switch (key) {
    case 'space':
    case '.':
    case 'right':
      return 1
    case '>':
      return 10
    case 's':
      return options.fps
    case 'm':
      return options.fps * 60
    default:
      return undefined
  }
}

const runInteractive = async (state: State, options: PreviewOptions): Promise<void> => {
  enterFullScreen()

  let restored = false
  const restore = (): void => {
    if (!restored) {
      restored = true
      leaveFullScreen()
    }
  }
  onExit(restore)

  const draw = (): void => {
    void drawInto(state, options).then((lines) => {
      paintFrame(lines)
    })
  }

  const quit = (): void => {
    restore()
    process.exit(0)
  }

  const rebuild = (scenario: ScenarioName): void => {
    if (state.busy) {
      return
    }
    state.busy = true
    void state.world
      .dispose()
      .then(() => makeWorld(configFor(options, scenario)))
      .then((world) => {
        state.world = world
        state.scenario = scenario
        state.busy = false
        draw()
      })
  }

  const stepBy = (frames: number): void => {
    if (state.busy) {
      return
    }
    state.busy = true
    void state.world.advance(frames).then(() => {
      state.busy = false
      draw()
    })
  }

  onResize(draw)
  onInputEnd(quit)
  onKey((key) => {
    if (state.showHelp) {
      state.showHelp = false
      draw()
      return
    }

    const frames = framesForKey(key, options)
    if (frames !== undefined) {
      stepBy(frames)
      return
    }

    switch (key) {
      case 'x':
      case 'escape':
      case 'ctrl-c':
        quit()
        return
      case 'n':
        // Step to the next scripted event. `advance` stays the only stepping
        // primitive, so "next event" is arithmetic over the script rather than a
        // second code path that could drift from the first.
        if (!state.busy) {
          state.busy = true
          void state.world.view().then((view) => {
            const target = nextEventFrame(scenarioFor(state.scenario), view.frame)
            state.busy = false
            stepBy(target === undefined ? 1 : target - view.frame)
          })
        }
        return
      case 'r':
        rebuild(state.scenario)
        return
      case '[':
        rebuild(cycleScenario(state.scenario, -1))
        return
      case ']':
        rebuild(cycleScenario(state.scenario, 1))
        return
      case 't':
        state.toggles = { ...state.toggles, timeline: !state.toggles.timeline }
        break
      case 'p':
        state.toggles = { ...state.toggles, findings: !state.toggles.findings }
        break
      case '?':
      case 'h':
        state.showHelp = true
        break
      default:
        break
    }

    draw()
  })

  draw()
}

const main = async (): Promise<number> => {
  const options = parseArguments(process.argv.slice(2))

  if (options.errors.length > 0) {
    for (const error of options.errors) {
      writeLine(`preview-sim: ${error}`)
    }
    writeLine('')
    for (const usage of USAGE) {
      writeLine(usage)
    }
    return 1
  }

  if (options.help) {
    for (const usage of USAGE) {
      writeLine(usage)
    }
    return 0
  }

  if (options.list) {
    for (const entry of scenarioCatalogue(styleFor(options), frameWidth(options))) {
      writeLine(entry)
    }
    return 0
  }

  if (options.stats) {
    const report = await Effect.runPromise(statsReport)
    for (const entry of report) {
      writeLine(entry)
    }
    return 0
  }

  const config = configFor(options, options.scenario)
  const world = await runTo(config, options.at)

  const state: State = {
    world,
    scenario: options.scenario,
    toggles: { timeline: true, findings: true },
    showHelp: false,
    busy: false,
  }

  if (options.once || !isInteractive()) {
    if (!options.once) {
      writeLine(
        dim('preview-sim: stdin/stdout is not a TTY, drawing a single frame (same as --once)'),
      )
    }
    const lines = await drawInto(state, options)
    for (const entry of lines) {
      writeLine(entry)
    }
    await world.dispose()
    return 0
  }

  await runInteractive(state, options)
  return 0
}

void main().then((exitCode) => {
  if (exitCode !== 0) {
    process.exit(exitCode)
  }
})
