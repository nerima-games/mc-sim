import {
  DEFAULT_SETTINGS,
  GRAPHICS_QUALITIES,
  MAX_FOV_DEGREES,
  MAX_MOUSE_SENSITIVITY,
  MAX_RENDER_DISTANCE,
  MAX_VOLUME,
  MIN_FOV_DEGREES,
  MIN_MOUSE_SENSITIVITY,
  MIN_RENDER_DISTANCE,
  MIN_VOLUME,
  normaliseSettings,
  rebindKey,
  unbindKey,
} from '@nerima-games/mc-kernel/domain/settings'
import type { GraphicsQuality, Settings } from '@nerima-games/mc-kernel/domain/settings'

export {
  DEFAULT_SETTINGS,
  GRAPHICS_QUALITIES,
  MAX_FOV_DEGREES,
  MAX_MOUSE_SENSITIVITY,
  MAX_RENDER_DISTANCE,
  MAX_VOLUME,
  MIN_FOV_DEGREES,
  MIN_MOUSE_SENSITIVITY,
  MIN_RENDER_DISTANCE,
  MIN_VOLUME,
  normaliseSettings,
  rebindKey,
  unbindKey,
}
export type { GraphicsQuality, Settings }

type UnknownRecord = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isGraphicsQuality = (value: unknown): value is GraphicsQuality =>
  GRAPHICS_QUALITIES.some((quality) => quality === value)

export const applySettings = (current: Settings, patch: Partial<Settings>): Settings =>
  normaliseSettings({ ...current, ...patch })

export const keyBindingFor = (settings: Settings, action: string): string | undefined =>
  Object.entries(settings.keyBindings).find(([candidate]) => candidate === action)?.[1]

const isFiniteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= minimum && value <= maximum

const isValidKeyBindings = (value: unknown): value is Readonly<Record<string, string>> => {
  if (!isRecord(value)) {
    return false
  }
  return Object.entries(value).every(
    ([action, code]) => action.length > 0 && typeof code === 'string' && code.length > 0,
  )
}

export const isValidSettings = (settings: unknown): settings is Settings => {
  if (!isRecord(settings)) {
    return false
  }
  return (
    isIntegerInRange(settings['renderDistance'], MIN_RENDER_DISTANCE, MAX_RENDER_DISTANCE) &&
    isFiniteInRange(settings['fovDegrees'], MIN_FOV_DEGREES, MAX_FOV_DEGREES) &&
    isGraphicsQuality(settings['graphicsQuality']) &&
    typeof settings['audioEnabled'] === 'boolean' &&
    isFiniteInRange(settings['masterVolume'], MIN_VOLUME, MAX_VOLUME) &&
    isFiniteInRange(settings['musicVolume'], MIN_VOLUME, MAX_VOLUME) &&
    isFiniteInRange(settings['sfxVolume'], MIN_VOLUME, MAX_VOLUME) &&
    isFiniteInRange(
      settings['mouseSensitivity'],
      MIN_MOUSE_SENSITIVITY,
      MAX_MOUSE_SENSITIVITY,
    ) &&
    typeof settings['captionsEnabled'] === 'boolean' &&
    isValidKeyBindings(settings['keyBindings'])
  )
}
