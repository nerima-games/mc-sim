import fc from 'fast-check'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { finiteTree, hostileValue } from './public-property-helpers.js'

const checks = { numRuns: 100, seed: 0x504c4143 }
const itemLists = fc.array(fc.string({ maxLength: 12 }), { maxLength: 12 })
const outerInput = fc.oneof(itemLists, hostileValue, fc.constant({ toString: '' }))

const countsOf = (items: ReadonlyArray<string>): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return counts
}

it('excludeReservedPlacementConsumptions is total over hostile outer envelopes and preserves multiset counts', () => {
  fc.assert(
    fc.property(outerInput, outerInput, (consumed, reserved) => {
      const result = Reflect.apply(Sim.excludeReservedPlacementConsumptions, undefined, [consumed, reserved]) as unknown
      expect(Array.isArray(result)).toBe(true)
      expect(finiteTree(result)).toBe(true)
      if (!Array.isArray(result)) return
      expect(result.every((item) => typeof item === 'string')).toBe(true)

      if (!Array.isArray(consumed)) {
        expect(result).toStrictEqual([])
        return
      }

      if (!Array.isArray(reserved)) {
        expect(result).toStrictEqual(consumed)
        return
      }

      const consumedCounts = countsOf(consumed)
      const reservedCounts = countsOf(reserved)
      const resultCounts = countsOf(result as ReadonlyArray<string>)
      expect(result.length).toBeLessThanOrEqual(consumed.length)
      for (const [item, count] of consumedCounts) {
        expect(resultCounts.get(item) ?? 0).toBe(count - Math.min(count, reservedCounts.get(item) ?? 0))
      }
    }),
    checks,
  )
})
