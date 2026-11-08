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
  InputAction,
  KeyCode,
  normaliseSettings as normaliseKernelSettings,
  rebindKey as kernelRebindKey,
  unbindKey as kernelUnbindKey,
  type GraphicsQuality,
  type Settings as KernelSettings,
} from '@nerima-games/mc-kernel/domain/settings'
import { isDifficulty, type Difficulty } from '@nerima-games/mc-kernel/domain/game-mode'
import { Brand, Result, Schema, SchemaIssue } from 'effect'

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
export const MIN_UI_SCALE = 0.75
export const MAX_UI_SCALE = 1.5
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

export type SettingsValidationError = Schema.SchemaError

const invalidKeyString = (value: unknown): Brand.BrandError =>
  new Brand.BrandError(new SchemaIssue.InvalidType(Schema.String.ast, value))

type UnknownRecord = Readonly<Record<string, unknown>>

const SETTINGS_FIELDS = [
  'renderDistance',
  'fovDegrees',
  'graphicsQuality',
  'graphicsPreset',
  'audioEnabled',
  'masterVolume',
  'musicVolume',
  'sfxVolume',
  'mouseSensitivity',
  'captionsEnabled',
  'keyBindings',
  'difficulty',
  'uiScale',
  'reducedMotion',
  'colorVisionCorrection',
] as const

const isRecord = (value: unknown): value is UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const hasEnumerableDataProperties = (value: UnknownRecord): boolean =>
  Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && descriptor.enumerable && Object.hasOwn(descriptor, 'value')
  })

const isFiniteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum

const isGraphicsPreset = (value: unknown): value is GraphicsPreset =>
  GRAPHICS_QUALITIES.some((preset) => preset === value)

const isReducedMotionSetting = (value: unknown): value is ReducedMotionSetting =>
  REDUCED_MOTION_SETTINGS.some((setting) => setting === value)

const isColorVisionCorrection = (value: unknown): value is ColorVisionCorrection =>
  COLOR_VISION_CORRECTIONS.some((correction) => correction === value)

const isExactSettingsRecord = (value: unknown): value is UnknownRecord =>
  isRecord(value) &&
  hasEnumerableDataProperties(value) &&
  Reflect.ownKeys(value).every((key) => typeof key === 'string' && SETTINGS_FIELDS.some((field) => field === key))

export const isGraphicsQuality = (value: unknown): value is GraphicsQuality =>
  GRAPHICS_QUALITIES.some((quality) => quality === value)

const isValidKeyBindings = (value: unknown): value is Readonly<Record<string, string>> => {
  if (!isRecord(value) || !hasEnumerableDataProperties(value)) return false
  return Object.entries(value).every(
    ([action, code]) => InputAction.is(action) && typeof code === 'string' && KeyCode.is(code),
  )
}

export const isValidSettings = (value: unknown): value is Settings => {
  if (!isExactSettingsRecord(value) || Reflect.ownKeys(value).length !== SETTINGS_FIELDS.length) return false
  if (!SETTINGS_FIELDS.every((field) => Object.hasOwn(value, field))) return false

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
    isFiniteInRange(value['uiScale'], MIN_UI_SCALE, MAX_UI_SCALE) &&
    isReducedMotionSetting(value['reducedMotion']) &&
    isColorVisionCorrection(value['colorVisionCorrection'])
  )
}

/** Strict schema for a complete, stored settings value. */
export const SettingsSchema: Schema.Codec<Settings, unknown> = Schema.declare(isValidSettings)

const withDefaults = (candidate: UnknownRecord): UnknownRecord => {
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS, ...candidate }
  const hasPreset = Object.hasOwn(candidate, 'graphicsPreset')
  const hasQuality = Object.hasOwn(candidate, 'graphicsQuality')

  if (hasPreset && !hasQuality) settings['graphicsQuality'] = candidate['graphicsPreset']
  if (hasQuality && !hasPreset) settings['graphicsPreset'] = candidate['graphicsQuality']

  return settings
}

/**
 * Decode settings from persistence or an update. Missing fields receive their
 * defaults; every supplied field and unknown key must pass the strict schema.
 */
export const decodeSettings = (candidate: unknown): Result.Result<Settings, SettingsValidationError> => {
  const input = isExactSettingsRecord(candidate) ? withDefaults(candidate) : candidate
  const decoded = Schema.decodeUnknownResult(SettingsSchema)(input)
  if (Result.isFailure(decoded)) return decoded

  const kernelSettings = normaliseKernelSettings(decoded.success)
  return Result.succeed({
    ...kernelSettings,
    difficulty: decoded.success.difficulty,
    uiScale: decoded.success.uiScale,
    reducedMotion: decoded.success.reducedMotion,
    colorVisionCorrection: decoded.success.colorVisionCorrection,
    graphicsPreset: decoded.success.graphicsPreset,
  })
}

/** Kept as the existing entry point; invalid input now remains a typed failure. */
export const normaliseSettings: (
  candidate: unknown,
) => Result.Result<Settings, SettingsValidationError> = decodeSettings

export const applySettings = (
  current: Settings,
  patch: Partial<Settings>,
): Result.Result<Settings, SettingsValidationError> => {
  const base = decodeSettings(current)
  if (Result.isFailure(base)) return base
  if (!isExactSettingsRecord(patch)) return decodeSettings(patch)

  const candidate: Record<string, unknown> = { ...base.success, ...patch }
  const hasPreset = Object.hasOwn(patch, 'graphicsPreset')
  const hasQuality = Object.hasOwn(patch, 'graphicsQuality')
  if (hasPreset && !hasQuality) candidate['graphicsQuality'] = patch.graphicsPreset
  if (hasQuality && !hasPreset) candidate['graphicsPreset'] = patch.graphicsQuality
  return decodeSettings(candidate)
}

export const keyBindingFor = (settings: Settings, action: string): string | undefined => {
  const keyBindings = isRecord(settings) ? settings['keyBindings'] : undefined
  if (typeof action !== 'string' || !isRecord(keyBindings) || !hasEnumerableDataProperties(keyBindings)) return undefined
  const binding = Object.entries(keyBindings).find(([candidate, code]) => candidate === action && typeof code === 'string')
  return typeof binding?.[1] === 'string' ? binding[1] : undefined
}

export const rebindKey = (
  settings: Settings,
  action: InputAction,
  code: KeyCode,
): Result.Result<Settings, Brand.BrandError | SettingsValidationError> => {
  if (typeof action !== 'string') return Result.fail(invalidKeyString(action))
  const checkedAction = InputAction.result(action)
  if (Result.isFailure(checkedAction)) return Result.fail(checkedAction.failure)
  if (typeof code !== 'string') return Result.fail(invalidKeyString(code))
  const checkedCode = KeyCode.result(code)
  if (Result.isFailure(checkedCode)) return Result.fail(checkedCode.failure)

  const base = decodeSettings(settings)
  if (Result.isFailure(base)) return base
  const next = kernelRebindKey(base.success, checkedAction.success, checkedCode.success)
  return next === base.success
    ? Result.succeed(isValidSettings(settings) ? settings : base.success)
    : decodeSettings(next)
}

export const unbindKey = (
  settings: Settings,
  action: InputAction,
): Result.Result<Settings, Brand.BrandError | SettingsValidationError> => {
  if (typeof action !== 'string') return Result.fail(invalidKeyString(action))
  const checkedAction = InputAction.result(action)
  if (Result.isFailure(checkedAction)) return Result.fail(checkedAction.failure)

  const base = decodeSettings(settings)
  if (Result.isFailure(base)) return base
  const next = kernelUnbindKey(base.success, checkedAction.success)
  return next === base.success
    ? Result.succeed(isValidSettings(settings) ? settings : base.success)
    : decodeSettings(next)
}
