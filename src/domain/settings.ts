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
import type { Difficulty } from '@nerima-games/mc-kernel/domain/game-mode'
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

const hasNoEnumerableInheritedProperties = (value: UnknownRecord): boolean => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || Object.keys(prototype).every((key) => Object.hasOwn(value, key))
}

export const isGraphicsQuality = (value: unknown): value is GraphicsQuality =>
  GRAPHICS_QUALITIES.some((quality) => quality === value)

const RenderDistanceSchema: Schema.Codec<KernelSettings['renderDistance'], unknown> = Schema.Int.check(
  Schema.isBetween({ minimum: MIN_RENDER_DISTANCE, maximum: MAX_RENDER_DISTANCE }),
).pipe(Schema.brand('RenderDistanceChunks'))

const FovSchema: Schema.Codec<KernelSettings['fovDegrees'], unknown> = Schema.Finite.check(
  Schema.isBetween({ minimum: MIN_FOV_DEGREES, maximum: MAX_FOV_DEGREES }),
).pipe(Schema.brand('FieldOfViewDegrees'))

const VolumeSchema: Schema.Codec<KernelSettings['masterVolume'], unknown> = Schema.Finite.check(
  Schema.isBetween({ minimum: MIN_VOLUME, maximum: MAX_VOLUME }),
).pipe(Schema.brand('VolumeLevel'))

const MouseSensitivitySchema: Schema.Codec<KernelSettings['mouseSensitivity'], unknown> = Schema.Finite.check(
  Schema.isBetween({ minimum: MIN_MOUSE_SENSITIVITY, maximum: MAX_MOUSE_SENSITIVITY }),
).pipe(Schema.brand('MouseSensitivity'))

const GraphicsQualitySchema: Schema.Codec<GraphicsQuality, unknown> = Schema.Literals(GRAPHICS_QUALITIES)
const DifficultySchema: Schema.Codec<Difficulty, unknown> = Schema.Literals(['peaceful', 'easy', 'normal', 'hard'])
const GraphicsPresetSchema: Schema.Codec<GraphicsPreset, unknown> = Schema.Literals(GRAPHICS_PRESETS)
const ReducedMotionSchema: Schema.Codec<ReducedMotionSetting, unknown> = Schema.Literals(REDUCED_MOTION_SETTINGS)
const ColorVisionCorrectionSchema: Schema.Codec<ColorVisionCorrection, unknown> = Schema.Literals(
  COLOR_VISION_CORRECTIONS,
)

const InputActionSchema = Schema.String.check(
  Schema.makeFilter(InputAction.is),
).pipe(Schema.brand('InputAction'))
const KeyCodeSchema = Schema.String.check(Schema.makeFilter(KeyCode.is)).pipe(
  Schema.brand('KeyCode'),
)

const KeyBindingsSchema: Schema.Codec<KernelSettings['keyBindings'], unknown> = Schema.Record(
  InputActionSchema,
  KeyCodeSchema,
)

const SettingsFields = {
  renderDistance: RenderDistanceSchema,
  fovDegrees: FovSchema,
  graphicsQuality: GraphicsQualitySchema,
  graphicsPreset: GraphicsPresetSchema,
  audioEnabled: Schema.Boolean,
  masterVolume: VolumeSchema,
  musicVolume: VolumeSchema,
  sfxVolume: VolumeSchema,
  mouseSensitivity: MouseSensitivitySchema,
  captionsEnabled: Schema.Boolean,
  keyBindings: KeyBindingsSchema,
  difficulty: DifficultySchema,
  uiScale: Schema.Finite.check(Schema.isBetween({ minimum: MIN_UI_SCALE, maximum: MAX_UI_SCALE })),
  reducedMotion: ReducedMotionSchema,
  colorVisionCorrection: ColorVisionCorrectionSchema,
}

const CompleteSettingsSchema: Schema.Codec<Settings, unknown> = Schema.Union([
  Schema.Struct({ ...SettingsFields, graphicsQuality: Schema.Literal('low'), graphicsPreset: Schema.Literal('low') }),
  Schema.Struct({ ...SettingsFields, graphicsQuality: Schema.Literal('medium'), graphicsPreset: Schema.Literal('medium') }),
  Schema.Struct({ ...SettingsFields, graphicsQuality: Schema.Literal('high'), graphicsPreset: Schema.Literal('high') }),
  Schema.Struct({ ...SettingsFields, graphicsQuality: Schema.Literal('ultra'), graphicsPreset: Schema.Literal('ultra') }),
])

const isKnownSettingsRecord = (value: unknown): value is UnknownRecord =>
  isRecord(value) &&
  hasEnumerableDataProperties(value) &&
  hasNoEnumerableInheritedProperties(value) &&
  Object.keys(SettingsFields).every((key) => Object.hasOwn(value, key)) &&
  Reflect.ownKeys(value).every((key) => typeof key === 'string' && Object.hasOwn(SettingsFields, key))

const KnownSettingsRecordSchema = Schema.Unknown.check(Schema.makeFilter(isKnownSettingsRecord))

/** Complete settings values reject unknown properties even with default decode options. */
export const SettingsSchema: Schema.Codec<Settings, unknown> = Schema.decodeTo(CompleteSettingsSchema)(
  KnownSettingsRecordSchema,
)

const SettingsInputSchema: Schema.Codec<Partial<Settings>, unknown> = Schema.Struct({
  renderDistance: Schema.optionalKey(RenderDistanceSchema),
  fovDegrees: Schema.optionalKey(FovSchema),
  graphicsQuality: Schema.optionalKey(GraphicsQualitySchema),
  graphicsPreset: Schema.optionalKey(GraphicsPresetSchema),
  audioEnabled: Schema.optionalKey(Schema.Boolean),
  masterVolume: Schema.optionalKey(VolumeSchema),
  musicVolume: Schema.optionalKey(VolumeSchema),
  sfxVolume: Schema.optionalKey(VolumeSchema),
  mouseSensitivity: Schema.optionalKey(MouseSensitivitySchema),
  captionsEnabled: Schema.optionalKey(Schema.Boolean),
  keyBindings: Schema.optionalKey(KeyBindingsSchema),
  difficulty: Schema.optionalKey(DifficultySchema),
  uiScale: Schema.optionalKey(
    Schema.Finite.check(Schema.isBetween({ minimum: MIN_UI_SCALE, maximum: MAX_UI_SCALE })),
  ),
  reducedMotion: Schema.optionalKey(ReducedMotionSchema),
  colorVisionCorrection: Schema.optionalKey(ColorVisionCorrectionSchema),
})

const decodeCompleteSettings = Schema.decodeUnknownResult(SettingsSchema, { onExcessProperty: 'error' })
const decodeSettingsInput = Schema.decodeUnknownResult(SettingsInputSchema, { onExcessProperty: 'error' })

export const isValidSettings = (value: unknown): value is Settings => {
  if (!isRecord(value) || !hasEnumerableDataProperties(value)) return false
  return Result.isSuccess(decodeCompleteSettings(value))
}

type MutableSettings = { -readonly [K in keyof Settings]: Settings[K] }

const withDefaults = (candidate: Partial<Settings>): MutableSettings => {
  const settings: MutableSettings = { ...DEFAULT_SETTINGS, ...candidate }
  const hasPreset = Object.hasOwn(candidate, 'graphicsPreset')
  const hasQuality = Object.hasOwn(candidate, 'graphicsQuality')

  if (hasPreset && !hasQuality && candidate.graphicsPreset !== undefined) {
    settings.graphicsQuality = candidate.graphicsPreset
  }
  if (hasQuality && !hasPreset && candidate.graphicsQuality !== undefined) {
    settings.graphicsPreset = candidate.graphicsQuality
  }

  return settings
}

/**
 * Decode settings from persistence or an update. Missing fields receive their
 * defaults; every supplied field and unknown key must pass the strict schema.
 */
export const decodeSettings = (candidate: unknown): Result.Result<Settings, SettingsValidationError> => {
  if (!isRecord(candidate) || !hasEnumerableDataProperties(candidate)) return decodeCompleteSettings(candidate)

  const decodedInput = decodeSettingsInput(candidate)
  if (Result.isFailure(decodedInput)) return Result.fail(decodedInput.failure)

  const decoded = decodeCompleteSettings(withDefaults(decodedInput.success))
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

  const decodedPatch = decodeSettingsInput(patch)
  if (Result.isFailure(decodedPatch)) return Result.fail(decodedPatch.failure)

  const candidate: MutableSettings = { ...base.success, ...decodedPatch.success }
  const hasPreset = Object.hasOwn(decodedPatch.success, 'graphicsPreset')
  const hasQuality = Object.hasOwn(decodedPatch.success, 'graphicsQuality')
  if (hasPreset && !hasQuality && decodedPatch.success.graphicsPreset !== undefined) {
    candidate.graphicsQuality = decodedPatch.success.graphicsPreset
  }
  if (hasQuality && !hasPreset && decodedPatch.success.graphicsQuality !== undefined) {
    candidate.graphicsPreset = decodedPatch.success.graphicsQuality
  }
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
  return decodeSettings(next)
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
