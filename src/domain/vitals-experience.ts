import { type Vitals } from './vitals-model.js'
import { clamp, delta } from './vitals-number.js'

export const experienceCostOfLevel = (level: number): number => {
  const atLevel = Math.max(0, Math.floor(delta(level)))
  if (atLevel <= 15) return 2 * atLevel + 7
  if (atLevel <= 30) return 5 * atLevel - 38
  return 9 * atLevel - 158
}

export const totalExperienceAtLevel = (level: number): number => {
  const atLevel = Math.max(0, Math.floor(delta(level)))
  if (atLevel <= 16) return atLevel * atLevel + 6 * atLevel
  if (atLevel <= 31) return 352 + ((atLevel - 16) * (5 * atLevel - 1)) / 2
  return 1507 + ((atLevel - 31) * (9 * atLevel - 46)) / 2
}

export const levelForTotalExperience = (totalExperience: number): number => {
  const total = Number.isFinite(totalExperience) ? Math.max(0, totalExperience) : 0
  let low = 0
  let high = 1

  while (totalExperienceAtLevel(high) <= total) high *= 2
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (totalExperienceAtLevel(middle) <= total) low = middle
    else high = middle
  }
  return low
}

export const experienceLevel = (vitals: Vitals): number =>
  levelForTotalExperience(vitals.totalExperience)

export const experienceProgress = (vitals: Vitals): number => {
  const level = experienceLevel(vitals)
  // `cost` is never <= 0 here: `experienceCostOfLevel` clamps its own input to
  // a non-negative integer (or +Infinity) before evaluating the three-piece
  // formula, and every piece is strictly positive and increasing from 7 at
  // atLevel 0. A `cost <= 0` guard would be dead code no input can reach —
  // pinned by the "REGRESSION: experienceCostOfLevel must never return zero or
  // negative" test in test/vitals.test.ts, which is what would go red if that
  // stopped being true.
  const cost = experienceCostOfLevel(level)

  const total = Number.isFinite(vitals.totalExperience)
    ? Math.max(0, vitals.totalExperience)
    : 0
  return clamp((total - totalExperienceAtLevel(level)) / cost, 0, 1)
}

export const addExperience = (vitals: Vitals, amount: number): Vitals => {
  const awarded = delta(amount)
  if (awarded === 0) return vitals

  return {
    ...vitals,
    totalExperience: Math.max(0, vitals.totalExperience + awarded),
  }
}
