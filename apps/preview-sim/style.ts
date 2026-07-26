/**
 * Colour and small pure formatters.
 *
 * A dev application, not shipped API.
 *
 * `--ascii` exists so a frame can be pasted into an issue, and a panel full of
 * `ESC[38;2;…m` underneath it would defeat that entirely. Threading a `Style`
 * rather than reading a module-level flag keeps every panel a pure function of
 * its arguments — which is also why `panels.ts` can be read as a specification
 * of what the preview claims, instead of as terminal plumbing.
 */
import { ESC } from './terminal'

export type Rgb = readonly [number, number, number]

export const LABEL: Rgb = [150, 160, 175]
export const VALUE: Rgb = [235, 240, 246]
export const GOOD: Rgb = [120, 205, 130]
export const WARN: Rgb = [255, 175, 70]
export const BAD: Rgb = [255, 105, 105]
export const NOTE: Rgb = [130, 175, 235]
export const DAY: Rgb = [250, 220, 120]
export const NIGHT: Rgb = [125, 140, 210]

const RESET = `${ESC}[0m`

export const paint = (text: string, color: Rgb): string =>
  `${ESC}[38;2;${String(color[0])};${String(color[1])};${String(color[2])}m${text}${RESET}`

export const bold = (text: string): string => `${ESC}[1m${text}${RESET}`

export const dim = (text: string): string => `${ESC}[2m${text}${RESET}`

export type Style = {
  readonly paint: (text: string, color: Rgb) => string
  readonly bold: (text: string) => string
  readonly dim: (text: string) => string
}

export const ANSI_STYLE: Style = { paint, bold, dim }

export const PLAIN_STYLE: Style = {
  paint: (text) => text,
  bold: (text) => text,
  dim: (text) => text,
}

// --- pure formatters ---------------------------------------------------------

/** Right-pad to `width`. Never truncates: a clipped number is a wrong number. */
export const pad = (text: string, width: number): string =>
  text.length >= width ? text : text + ' '.repeat(width - text.length)

/** Left-pad to `width`, for columns of numbers. */
export const padStart = (text: string, width: number): string =>
  text.length >= width ? text : ' '.repeat(width - text.length) + text

/**
 * Fixed-point, and NaN-honest.
 *
 * `Number.prototype.toFixed` renders NaN as the string `NaN`, which is exactly
 * what this preview wants: `domain/time-of-day.ts` can be driven into a state
 * where every reader returns NaN (see `probes.ts`, TIME-RESTORE), and a
 * formatter that hid it behind `0.00` would hide the defect the panel exists to
 * show.
 */
export const fixed = (value: number, digits: number): string => value.toFixed(digits)

export const degrees = (radians: number): string => `${(radians * (180 / Math.PI)).toFixed(1)}°`

/**
 * A time-of-day fraction rendered as a 24-hour clock face.
 *
 * 0 is MIDNIGHT — `domain/time-of-day.ts` fixes that convention and `isNight`
 * depends on it. Rendering the fraction as a wall time is the fastest way for a
 * person to notice that a "0.30 fresh world" is 07:12 in the morning and not,
 * as the number alone suggests, something near the start of the night.
 */
export const clockFace = (fraction: number): string => {
  if (!Number.isFinite(fraction)) {
    return '--:--'
  }
  // The +1e-9 is not sloppiness: 0.3 * 1440 is 431.99999999999994 in binary
  // floating point, and a bare floor renders the canonical 0.30 fresh world as
  // 07:11 instead of 07:12. A clock face that is one minute out is a clock face
  // a reader stops trusting.
  const minutesOfDay = Math.floor(fraction * 24 * 60 + 1e-9)
  const hours = Math.floor(minutesOfDay / 60) % 24
  const minutes = ((minutesOfDay % 60) + 60) % 60
  return `${padStart(String(hours), 2).replace(' ', '0')}:${padStart(String(minutes), 2).replace(' ', '0')}`
}

const BAR_FULL = '#'
const BAR_EMPTY = '.'

/** A proportion bar. `total <= 0` renders empty rather than dividing by zero. */
export const bar = (value: number, total: number, width: number): string => {
  const ratio = total > 0 && Number.isFinite(value) ? Math.max(0, Math.min(1, value / total)) : 0
  const filled = Math.round(ratio * width)
  return BAR_FULL.repeat(filled) + BAR_EMPTY.repeat(Math.max(0, width - filled))
}

/** A day-cycle dial: where in the 24 hours the world currently is. */
export const dayDial = (fraction: number, width: number): string => {
  if (!Number.isFinite(fraction)) {
    return '?'.repeat(width)
  }
  const cells: Array<string> = Array.from({ length: width }, (_unused, index) => {
    const at = (index + 0.5) / width
    return at < 0.25 || at > 0.75 ? 'n' : 'D'
  })
  const cursor = Math.min(width - 1, Math.max(0, Math.floor(fraction * width)))
  cells[cursor] = '|'
  return cells.join('')
}
