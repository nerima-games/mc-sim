import { Result } from 'effect'
import type { EnchantmentTableFailure, EnchantmentTableRandom } from './enchantment-table.js'

export type WeightedCandidate = Readonly<{ readonly weight: number }>

export const assertRandomInteger = (
  random: EnchantmentTableRandom,
  bound: number,
): Result.Result<number, EnchantmentTableFailure> => {
  const value = random.nextInt(bound)
  return Number.isSafeInteger(value) && value >= 0 && value < bound
    ? Result.succeed(value)
    : Result.fail({
        _tag: 'EnchantmentTableFailure',
        reason: 'invalid-random-integer',
        value,
        message: `Random integer is outside [0, ${bound})`,
      })
}

export const weightedCandidate = <A extends WeightedCandidate>(
  candidates: ReadonlyArray<A>,
  random: EnchantmentTableRandom,
): Result.Result<A, EnchantmentTableFailure> => {
  const totalWeight = candidates.reduce((total, candidate) => total + candidate.weight, 0)
  const selectedWeight = assertRandomInteger(random, totalWeight)
  if (Result.isFailure(selectedWeight)) return Result.fail(selectedWeight.failure)

  let remainingWeight = selectedWeight.success
  for (const candidate of candidates) {
    if (remainingWeight < candidate.weight) return Result.succeed(candidate)
    remainingWeight -= candidate.weight
  }
  return Result.fail({
    _tag: 'EnchantmentTableFailure',
    reason: 'empty-candidate-set',
    value: candidates,
    message: 'Weighted selection did not match a candidate',
  })
}
