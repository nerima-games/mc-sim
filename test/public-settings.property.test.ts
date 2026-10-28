import fc from 'fast-check'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { finiteTree, hostileValue, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 40, seed: 0x53455454 }

const assertValidSettings = (value: unknown): void => {
  expect(finiteTree(value)).toBe(true)
  expect(Sim.isValidSettings(value)).toBe(true)
}

it('normaliseSettings repairs every hostile value into valid finite settings', () => {
  fc.assert(
    fc.property(unknownValue, (input) => {
      const settings = Sim.normaliseSettings(input)
      assertValidSettings(settings)
    }),
    checks,
  )
})

it('applySettings returns valid finite settings for hostile current and patch envelopes', () => {
  fc.assert(
    fc.property(unknownValue, unknownValue, (current, patch) => {
      const settings = Reflect.apply(Sim.applySettings, undefined, [current, patch]) as unknown
      assertValidSettings(settings)
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

      const rebound = Reflect.apply(Sim.rebindKey, undefined, [settings, action, code]) as unknown
      const unbound = Reflect.apply(Sim.unbindKey, undefined, [settings, action]) as unknown
      assertValidSettings(rebound)
      assertValidSettings(unbound)
    }),
    checks,
  )
})
