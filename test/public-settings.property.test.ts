import fc from 'fast-check'
import { Brand, Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { finiteTree, hostileValue, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 40, seed: 0x53455454 }
const decodeStrictSettings = Schema.decodeUnknownResult(Sim.SettingsSchema, { onExcessProperty: 'error' })

const assertValidSettings = (value: unknown): void => {
  expect(finiteTree(value)).toBe(true)
  expect(Result.isSuccess(decodeStrictSettings(value))).toBe(true)
}

it('decodeSettings classifies arbitrary JSON without throwing', () => {
  let successes = 0
  let typedFailures = 0

  fc.assert(
    fc.property(fc.jsonValue(), (input) => {
      const outcome = Sim.decodeSettings(input)
      if (Result.isSuccess(outcome)) {
        successes += 1
        expect(Result.isSuccess(decodeStrictSettings(outcome.success))).toBe(true)
      } else {
        typedFailures += 1
        expect(Schema.is(Sim.SchemaErrorSchema)(outcome.failure)).toBe(true)
      }
    }),
    checks,
  )

  expect(successes + typedFailures).toBe(checks.numRuns)
  expect(typedFailures).toBeGreaterThan(0)
})

it('normaliseSettings either decodes a valid value or returns a typed failure for hostile input', () => {
  fc.assert(
    fc.property(unknownValue, (input) => {
      const outcome = Sim.normaliseSettings(input)
      if (Result.isSuccess(outcome)) {
        assertValidSettings(outcome.success)
        expect(Result.isSuccess(decodeStrictSettings(outcome.success))).toBe(true)
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
        expect(Result.isSuccess(decodeStrictSettings(outcome.success))).toBe(true)
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
        expect(Result.isSuccess(decodeStrictSettings(rebound.success))).toBe(true)
      } else {
        expect(Schema.is(Sim.SchemaErrorSchema)(rebound.failure) || rebound.failure instanceof Brand.BrandError).toBe(true)
      }
      if (Result.isSuccess(unbound)) {
        assertValidSettings(unbound.success)
        expect(Result.isSuccess(decodeStrictSettings(unbound.success))).toBe(true)
      } else {
        expect(Schema.is(Sim.SchemaErrorSchema)(unbound.failure) || unbound.failure instanceof Brand.BrandError).toBe(true)
      }
    }),
    checks,
  )
})
