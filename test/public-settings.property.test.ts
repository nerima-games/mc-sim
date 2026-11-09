import fc from 'fast-check'
import { Brand, Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { finiteTree, hostileValue, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 40, seed: 0x53455454 }
const decodeSettingsSchema = Schema.decodeUnknownResult(Sim.SettingsSchema)
const settingsKeys = new Set([
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
])

const isJsonRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype

const isNonBlankString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const numberInRange = (value: unknown, minimum: number, maximum: number, integer = false): boolean =>
  typeof value === 'number' && Number.isFinite(value) &&
  (!integer || Number.isInteger(value)) && value >= minimum && value <= maximum

const optionalNumberInRange = (
  settings: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  integer = false,
): boolean => !Object.hasOwn(settings, key) || numberInRange(settings[key], minimum, maximum, integer)

const optionalChoice = (settings: Record<string, unknown>, key: string, values: ReadonlyArray<unknown>): boolean =>
  !Object.hasOwn(settings, key) || values.includes(settings[key])

const optionalBoolean = (settings: Record<string, unknown>, key: string): boolean =>
  !Object.hasOwn(settings, key) || typeof settings[key] === 'boolean'

const hasOnlySettingsKeys = (settings: Record<string, unknown>): boolean =>
  Reflect.ownKeys(settings).every((key) => typeof key === 'string' && settingsKeys.has(key))

const hasValidSettingsRanges = (settings: Record<string, unknown>): boolean =>
  optionalNumberInRange(settings, 'renderDistance', 2, 16, true) &&
  optionalNumberInRange(settings, 'fovDegrees', 30, 110) &&
  optionalNumberInRange(settings, 'masterVolume', 0, 1) &&
  optionalNumberInRange(settings, 'musicVolume', 0, 1) &&
  optionalNumberInRange(settings, 'sfxVolume', 0, 1) &&
  optionalNumberInRange(settings, 'mouseSensitivity', 0.1, 3) &&
  optionalNumberInRange(settings, 'uiScale', 0.75, 1.5)

const hasValidSettingsChoices = (settings: Record<string, unknown>): boolean =>
  optionalChoice(settings, 'graphicsQuality', ['low', 'medium', 'high', 'ultra']) &&
  optionalChoice(settings, 'graphicsPreset', ['low', 'medium', 'high', 'ultra']) &&
  optionalChoice(settings, 'difficulty', ['peaceful', 'easy', 'normal', 'hard']) &&
  optionalChoice(settings, 'reducedMotion', ['system', 'full', 'reduced']) &&
  optionalChoice(settings, 'colorVisionCorrection', ['off', 'protanopia', 'deuteranopia', 'tritanopia'])

const hasConsistentGraphicsAliases = (settings: Record<string, unknown>): boolean =>
  !Object.hasOwn(settings, 'graphicsQuality') || !Object.hasOwn(settings, 'graphicsPreset') ||
  settings['graphicsQuality'] === settings['graphicsPreset']

const hasValidKeyBindings = (settings: Record<string, unknown>): boolean => {
  if (!Object.hasOwn(settings, 'keyBindings')) return true
  const bindings = settings['keyBindings']
  return isJsonRecord(bindings) &&
    Object.entries(bindings).every(([action, code]) => isNonBlankString(action) && isNonBlankString(code))
}

const isAcceptedJsonSettingsInput = (value: unknown): boolean => {
  if (!isJsonRecord(value)) return false
  return hasOnlySettingsKeys(value) && hasValidSettingsRanges(value) && hasValidSettingsChoices(value) &&
    optionalBoolean(value, 'audioEnabled') && optionalBoolean(value, 'captionsEnabled') &&
    hasConsistentGraphicsAliases(value) && hasValidKeyBindings(value)
}

const assertValidSettings = (value: unknown): void => {
  expect(finiteTree(value)).toBe(true)
  expect(Result.isSuccess(decodeSettingsSchema(value))).toBe(true)
}

it('decodeSettings classifies arbitrary JSON without throwing', () => {
  let successes = 0
  let typedFailures = 0

  fc.assert(
    fc.property(fc.oneof(fc.jsonValue(), fc.constant({})), (input) => {
      const expectedSuccess = isAcceptedJsonSettingsInput(input)
      const outcome = Sim.decodeSettings(input)
      expect(Result.isSuccess(outcome)).toBe(expectedSuccess)
      if (Result.isSuccess(outcome)) {
        successes += 1
        expect(Result.isSuccess(decodeSettingsSchema(outcome.success))).toBe(true)
      } else {
        typedFailures += 1
        expect(Schema.is(Sim.SchemaErrorSchema)(outcome.failure)).toBe(true)
      }
    }),
    checks,
  )

  expect(successes + typedFailures).toBe(checks.numRuns)
  expect(successes).toBeGreaterThan(0)
  expect(typedFailures).toBeGreaterThan(0)
})

it('normaliseSettings either decodes a valid value or returns a typed failure for hostile input', () => {
  fc.assert(
    fc.property(unknownValue, (input) => {
      const outcome = Sim.normaliseSettings(input)
      if (Result.isSuccess(outcome)) {
        assertValidSettings(outcome.success)
        expect(Result.isSuccess(decodeSettingsSchema(outcome.success))).toBe(true)
      } else {
        expect(Schema.is(Sim.SchemaErrorSchema)(outcome.failure)).toBe(true)
      }
    }),
    checks,
  )
})

it('applySettings returns valid finite settings for hostile current and patch envelopes', () => {
  fc.assert(
    fc.property(unknownValue, unknownValue, (current, patch) => {
      const outcome = Reflect.apply(Sim.applySettings, undefined, [current, patch]) as Result.Result<unknown, unknown>
      if (Result.isSuccess(outcome)) {
        assertValidSettings(outcome.success)
        expect(Result.isSuccess(decodeSettingsSchema(outcome.success))).toBe(true)
      } else {
        expect(Schema.is(Sim.SchemaErrorSchema)(outcome.failure)).toBe(true)
      }
    }),
    checks,
  )
})

it('isValidSettings, keyBindingFor, rebindKey, and unbindKey handle hostile envelopes', () => {
  fc.assert(
    fc.property(unknownValue, hostileValue, hostileValue, (settings, action, code) => {
      expect(typeof Sim.isValidSettings(settings)).toBe('boolean')
      expect(typeof Sim.isGraphicsQuality(settings)).toBe('boolean')

      const binding = Reflect.apply(Sim.keyBindingFor, undefined, [settings, action]) as unknown
      expect(binding === undefined || typeof binding === 'string').toBe(true)

      const rebound = Reflect.apply(Sim.rebindKey, undefined, [settings, action, code]) as Result.Result<unknown, unknown>
      const unbound = Reflect.apply(Sim.unbindKey, undefined, [settings, action]) as Result.Result<unknown, unknown>
      if (Result.isSuccess(rebound)) {
        assertValidSettings(rebound.success)
        expect(Result.isSuccess(decodeSettingsSchema(rebound.success))).toBe(true)
      } else {
        expect(Schema.is(Sim.SchemaErrorSchema)(rebound.failure) || rebound.failure instanceof Brand.BrandError).toBe(true)
      }
      if (Result.isSuccess(unbound)) {
        assertValidSettings(unbound.success)
        expect(Result.isSuccess(decodeSettingsSchema(unbound.success))).toBe(true)
      } else {
        expect(Schema.is(Sim.SchemaErrorSchema)(unbound.failure) || unbound.failure instanceof Brand.BrandError).toBe(true)
      }
    }),
    checks,
  )
})
