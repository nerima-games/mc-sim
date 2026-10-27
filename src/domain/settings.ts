import {
  DEFAULT_SETTINGS as KERNEL_DEFAULT_SETTINGS,
  GRAPHICS_QUALITIES,
  MAX_FOV_DEGREES,
  MAX_MOUSE_SENSITIVITY,
  MAX_RENDER_DISTANCE,
  MAX_VOLUME,
  MIN_FOV_DEGREES,
  MIN_MOUSE_SENSITIVITY,
  MIN_RENDER_DISTANCE,
  MIN_VOLUME,
  normaliseSettings as normaliseKernelSettings,
  rebindKey as kernelRebindKey,
  unbindKey as kernelUnbindKey,
  type GraphicsQuality,
  type Settings as KernelSettings,
  type InputAction,
  type KeyCode,
} from '@nerima-games/mc-kernel/domain/settings'
import { isDifficulty, type Difficulty } from '@nerima-games/mc-kernel/domain/game-mode'

export {
  GRAPHICS_QUALITIES,
  MAX_FOV_DEGREES,
  MAX_MOUSE_SENSITIVITY,
  MAX_RENDER_DISTANCE,
  MAX_VOLUME,
  MIN_FOV_DEGREES,
  MIN_MOUSE_SENSITIVITY,
  MIN_RENDER_DISTANCE,
  MIN_VOLUME,
}
export type { GraphicsQuality, Difficulty }

export const GRAPHICS_PRESETS: typeof GRAPHICS_QUALITIES = GRAPHICS_QUALITIES
export type GraphicsPreset = GraphicsQuality
export const REDUCED_MOTION_SETTINGS = ['system', 'full', 'reduced'] as const
export type ReducedMotionSetting = (typeof REDUCED_MOTION_SETTINGS)[number]
export const COLOR_VISION_CORRECTIONS = ['off', 'protanopia', 'deuteranopia', 'tritanopia'] as const
export type ColorVisionCorrection = (typeof COLOR_VISION_CORRECTIONS)[number]

export type Settings = KernelSettings & Readonly<{
  difficulty: Difficulty
  uiScale: number
  reducedMotion: ReducedMotionSetting
  colorVisionCorrection: ColorVisionCorrection
  graphicsPreset: GraphicsPreset
}>

export const DEFAULT_SETTINGS: Settings = {
  ...KERNEL_DEFAULT_SETTINGS,
  difficulty: 'normal',
  uiScale: 1,
  reducedMotion: 'system',
  colorVisionCorrection: 'off',
  graphicsPreset: KERNEL_DEFAULT_SETTINGS.graphicsQuality,
}

type UnknownRecord = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const valueAt = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined

const isFiniteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum

const clampWithDefault = (value: unknown, minimum: number, maximum: number, fallback: number): number => {
  const number = typeof value === 'number' && !Number.isNaN(value) ? value : fallback
  return Math.min(maximum, Math.max(minimum, number))
}

const isGraphicsPreset = (value: unknown): value is GraphicsPreset =>
  GRAPHICS_QUALITIES.some((preset) => preset === value)

const isReducedMotionSetting = (value: unknown): value is ReducedMotionSetting =>
  REDUCED_MOTION_SETTINGS.some((setting) => setting === value)

const isColorVisionCorrection = (value: unknown): value is ColorVisionCorrection =>
  COLOR_VISION_CORRECTIONS.some((correction) => correction === value)

export const normaliseSettings = (settings: unknown): Settings => {
  const kernelSettings = normaliseKernelSettings(settings)
  const requestedPreset = valueAt(settings, 'graphicsPreset')
  const legacyQuality = valueAt(settings, 'graphicsQuality')
  const difficulty = valueAt(settings, 'difficulty')
  const reducedMotion = valueAt(settings, 'reducedMotion')
  const colorVisionCorrection = valueAt(settings, 'colorVisionCorrection')
  const graphicsPreset = isGraphicsPreset(requestedPreset)
    ? requestedPreset
    : isGraphicsPreset(legacyQuality)
      ? legacyQuality
      : DEFAULT_SETTINGS.graphicsPreset

  return {
    ...kernelSettings,
    graphicsQuality: graphicsPreset,
    difficulty: isDifficulty(difficulty) ? difficulty : DEFAULT_SETTINGS.difficulty,
    uiScale: clampWithDefault(valueAt(settings, 'uiScale'), 0.75, 1.5, DEFAULT_SETTINGS.uiScale),
    reducedMotion: isReducedMotionSetting(reducedMotion) ? reducedMotion : DEFAULT_SETTINGS.reducedMotion,
    colorVisionCorrection: isColorVisionCorrection(colorVisionCorrection)
      ? colorVisionCorrection
      : DEFAULT_SETTINGS.colorVisionCorrection,
    graphicsPreset,
  }
}

export const applySettings = (current: Settings, patch: Partial<Settings>): Settings => {
  const alignedPatch =
    patch.graphicsPreset !== undefined
      ? { ...patch, graphicsQuality: patch.graphicsPreset }
      : patch.graphicsQuality !== undefined
        ? { ...patch, graphicsPreset: patch.graphicsQuality }
        : patch
  return normaliseSettings({ ...current, ...alignedPatch })
}

export const isGraphicsQuality = (value: unknown): value is GraphicsQuality =>
  GRAPHICS_QUALITIES.some((quality) => quality === value)

const isValidKeyBindings = (value: unknown): value is Readonly<Record<string, string>> => {
  if (!isRecord(value)) return false
  return Object.entries(value).every(
    ([action, code]) => action.length > 0 && typeof code === 'string' && code.length > 0,
  )
}

export const isValidSettings = (value: unknown): value is Settings => {
  if (!isRecord(value)) return false

  return (
    isIntegerInRange(value['renderDistance'], MIN_RENDER_DISTANCE, MAX_RENDER_DISTANCE) &&
    isFiniteInRange(value['fovDegrees'], MIN_FOV_DEGREES, MAX_FOV_DEGREES) &&
    isGraphicsQuality(value['graphicsQuality']) &&
    isGraphicsPreset(value['graphicsPreset']) &&
    value['graphicsPreset'] === value['graphicsQuality'] &&
    typeof value['audioEnabled'] === 'boolean' &&
    isFiniteInRange(value['masterVolume'], MIN_VOLUME, MAX_VOLUME) &&
    isFiniteInRange(value['musicVolume'], MIN_VOLUME, MAX_VOLUME) &&
    isFiniteInRange(value['sfxVolume'], MIN_VOLUME, MAX_VOLUME) &&
    isFiniteInRange(value['mouseSensitivity'], MIN_MOUSE_SENSITIVITY, MAX_MOUSE_SENSITIVITY) &&
    typeof value['captionsEnabled'] === 'boolean' &&
    isValidKeyBindings(value['keyBindings']) &&
    isDifficulty(value['difficulty']) &&
    isFiniteInRange(value['uiScale'], 0.75, 1.5) &&
    isReducedMotionSetting(value['reducedMotion']) &&
    isColorVisionCorrection(value['colorVisionCorrection'])
  )
}

export const keyBindingFor = (settings: Settings, action: string): string | undefined =>
  Object.entries(settings.keyBindings).find(([candidate]) => candidate === action)?.[1]

export const rebindKey = (settings: Settings, action: InputAction, code: KeyCode): Settings => {
  const next = kernelRebindKey(settings, action, code)
  return next === settings ? settings : normaliseSettings(next)
}

export const unbindKey = (settings: Settings, action: InputAction): Settings => {
  const next = kernelUnbindKey(settings, action)
  return next === settings ? settings : normaliseSettings(next)
}
