/**
 * Command-line options for the scenario stepper.
 *
 * A dev application, not shipped API.
 *
 * Pure: `parseArguments` reads an array and returns a value. It never touches
 * `process`, so the whole option surface is exercisable without running the app
 * — which matters because "the preview accepts a scenario and a frame count" is
 * the entire reproduction recipe for anything this app finds, and a parser that
 * can only be tested by launching a terminal UI is a parser nobody tests.
 */
import { SCENARIO_NAMES, type ScenarioName } from './script'

/**
 * The default nominal frame rate.
 *
 * A literal, not a clock read. The stepper synthesises the monotonic instants it
 * feeds to `GameLoop.submitFrame`, so this number is the entire definition of
 * "one frame" here: 60 fps means each step advances the injected clock by
 * 1/60 s. `domain/frame-timing.ts` calls 0.016 "one frame at 60 Hz" for the same
 * reason, and the two agreeing is not a coincidence — it is what makes the very
 * first frame's `FIRST_FRAME_DELTA_SECS` indistinguishable from the second's
 * measured delta, which is the point of that constant.
 */
export const DEFAULT_FPS = 60

/** Default scripted length. Long enough to cross an in-game dawn at --day-length 120. */
export const DEFAULT_FRAMES = 600

export type PreviewOptions = {
  readonly scenario: ScenarioName
  /** Frames the script runs for. */
  readonly frames: number
  /** Nominal frames per second. Defines the injected clock's step. */
  readonly fps: number
  /** In-game day length, seconds. Clamped by the library to [120, 1200]. */
  readonly dayLengthSecs: number
  /** Starting time-of-day fraction. 0 is MIDNIGHT. */
  readonly timeOfDay: number
  /** Autosave interval, seconds. */
  readonly autoSaveSecs: number
  /**
   * Frames to run before drawing anything. `--once --at 300` is how a finding
   * gets a one-line reproduction command.
   */
  readonly at: number
  /** Render one frame to stdout and exit. Pipe-safe: no raw mode. */
  readonly once: boolean
  /** Glyphs instead of colour — pasteable into an issue or a diff. */
  readonly ascii: boolean
  /** Print the numeric probe report instead of a picture. */
  readonly stats: boolean
  /** List the scenarios and exit. */
  readonly list: boolean
  readonly help: boolean
  readonly width: number | undefined
  readonly errors: ReadonlyArray<string>
}

const DEFAULTS = {
  scenario: 'mine-and-nightfall',
  frames: DEFAULT_FRAMES,
  fps: DEFAULT_FPS,
  dayLengthSecs: 600,
  timeOfDay: 0.25,
  autoSaveSecs: 5,
  at: 0,
  once: false,
  ascii: false,
  stats: false,
  list: false,
  help: false,
  width: undefined,
  errors: [],
} satisfies PreviewOptions

const isScenario = (value: string): value is ScenarioName =>
  (SCENARIO_NAMES as ReadonlyArray<string>).includes(value)

type Accumulator = {
  -readonly [Key in keyof PreviewOptions]: PreviewOptions[Key]
}

const readNumber = (
  accumulator: Accumulator,
  flag: string,
  raw: string | undefined,
): number | undefined => {
  if (raw === undefined) {
    accumulator.errors = [...accumulator.errors, `${flag} needs a value`]
    return undefined
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    accumulator.errors = [...accumulator.errors, `${flag}: "${raw}" is not a number`]
    return undefined
  }
  return value
}

/**
 * Accepts `--flag value` and `--flag=value`.
 *
 * Unknown flags are collected as errors rather than ignored. A silently dropped
 * `--scenario` is a preview confidently showing the wrong run, and this app's
 * only value is that the run it shows is the run you asked for.
 */
export const parseArguments = (argv: ReadonlyArray<string>): PreviewOptions => {
  const accumulator: Accumulator = { ...DEFAULTS }
  const queue = [...argv]

  while (queue.length > 0) {
    const token = queue.shift()
    if (token === undefined) {
      break
    }

    const equalsAt = token.indexOf('=')
    const flag = equalsAt === -1 ? token : token.slice(0, equalsAt)
    const inlineValue = equalsAt === -1 ? undefined : token.slice(equalsAt + 1)
    const takeValue = (): string | undefined => inlineValue ?? queue.shift()

    switch (flag) {
      // pnpm 9 forwards a literal `--` into argv when someone writes
      // `pnpm preview -- --stats` out of npm habit. Rejecting it as an unknown
      // option would be technically correct and completely unhelpful.
      case '--':
        break
      case '--help':
      case '-h':
        accumulator.help = true
        break
      case '--list':
        accumulator.list = true
        break
      case '--stats':
        accumulator.stats = true
        break
      case '--once':
        accumulator.once = true
        break
      case '--ascii':
        accumulator.ascii = true
        break
      case '--scenario': {
        const value = takeValue()
        if (value !== undefined && isScenario(value)) {
          accumulator.scenario = value
        } else {
          accumulator.errors = [
            ...accumulator.errors,
            `--scenario: "${String(value)}" is not one of ${SCENARIO_NAMES.join(', ')}`,
          ]
        }
        break
      }
      case '--frames':
        accumulator.frames = Math.max(
          1,
          Math.trunc(readNumber(accumulator, flag, takeValue()) ?? accumulator.frames),
        )
        break
      case '--fps':
        accumulator.fps = Math.max(
          1,
          readNumber(accumulator, flag, takeValue()) ?? accumulator.fps,
        )
        break
      case '--at':
        accumulator.at = Math.max(
          0,
          Math.trunc(readNumber(accumulator, flag, takeValue()) ?? accumulator.at),
        )
        break
      case '--day-length':
        accumulator.dayLengthSecs =
          readNumber(accumulator, flag, takeValue()) ?? accumulator.dayLengthSecs
        break
      case '--time':
        accumulator.timeOfDay = readNumber(accumulator, flag, takeValue()) ?? accumulator.timeOfDay
        break
      case '--autosave':
        accumulator.autoSaveSecs = Math.max(
          0.001,
          readNumber(accumulator, flag, takeValue()) ?? accumulator.autoSaveSecs,
        )
        break
      case '--width':
        accumulator.width = readNumber(accumulator, flag, takeValue()) ?? accumulator.width
        break
      default:
        accumulator.errors = [...accumulator.errors, `unknown option: ${flag}`]
        break
    }
  }

  return { ...accumulator }
}

export const USAGE: ReadonlyArray<string> = [
  'pnpm preview [options]        deterministic scenario stepper for @nerima-games/mc-sim',
  '',
  'options',
  `  --scenario <name>   ${SCENARIO_NAMES.join(' | ')}`,
  '                      (default mine-and-nightfall; --list describes them)',
  `  --frames <n>        scripted length in frames (default ${String(DEFAULT_FRAMES)})`,
  `  --fps <n>           nominal frame rate; defines the injected clock step (default ${String(DEFAULT_FPS)})`,
  '  --at <n>            run n frames before drawing — the reproduction handle',
  '  --day-length <n>    in-game day length in seconds (default 600; library clamps to [120,1200])',
  '  --time <f>          starting time-of-day fraction, 0 = MIDNIGHT (default 0.25 = dawn)',
  '  --autosave <n>      autosave interval in seconds (default 5)',
  '  --once              render one frame to stdout and exit (no raw mode, pipe-safe)',
  '  --ascii             glyphs instead of colour — pasteable into an issue or a diff',
  '  --stats             print the numeric probe report instead of a picture',
  '  --list              describe the scenarios and exit',
  '  --width <n>         force the panel width in terminal cells',
  '  --help              this text',
  '',
  'keys (interactive)',
  '  space  .  ->  step 1 frame              |   >   step 10 frames',
  '  n             step to the next scripted event',
  '  s             step 1 in-game second (fps frames)',
  '  m             step 1 in-game minute',
  '  r             restart the scenario from frame 0',
  '  [ ]           previous / next scenario',
  '  t             toggle the timeline panel',
  '  p             toggle the probe panel (the findings, live)',
  '  ? h           this help   |   x  Esc  Ctrl-C   quit',
]
