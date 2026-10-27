import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { weightedCandidate } from '../src/domain/enchantment-table-selection'
import type { EnchantmentTableRandom } from '../src/domain/enchantment-table'

describe('weighted enchantment selection', () => {
  it('returns the typed failure when inconsistent weights select no candidate', () => {
    const candidates = [-5.3, -8.6, 1.4, -0.3, 8, 7.9, 1.9].map((weight) => ({ weight }))
    const random: EnchantmentTableRandom = { nextInt: () => 5, nextFloat: () => 0 }
    const result = weightedCandidate(candidates, random)

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: 'EnchantmentTableFailure',
        reason: 'empty-candidate-set',
        message: 'Weighted selection did not match a candidate',
      })
    }
  })
})
