import {
  ExperienceDelta,
  ExperienceCost,
  ExperienceLevel,
  ExperienceProgress,
  TotalExperience,
  type Vitals,
} from './vitals-model.js'
import { clamp, delta } from './vitals-number.js'

const MAX_EXPERIENCE_LEVEL = Number.MAX_SAFE_INTEGER

const costAtLevel = (atLevel: number): number => {
  if (atLevel <= 15) return 2 * atLevel + 7
  if (atLevel <= 30) return 5 * atLevel - 38
  return 9 * atLevel - 158
}

const totalAtLevel = (atLevel: number): number => {
  if (atLevel <= 16) return atLevel * atLevel + 6 * atLevel
  if (atLevel <= 31) return 352 + ((atLevel - 16) * (5 * atLevel - 1)) / 2
  return 1507 + ((atLevel - 31) * (9 * atLevel - 46)) / 2
}

export const experienceCostOfLevel = (level: ExperienceLevel): ExperienceCost => {
  const atLevel = Math.max(0, Math.floor(delta(level)))
  return ExperienceCost(Math.min(Number.MAX_VALUE, costAtLevel(atLevel)))
}

export const totalExperienceAtLevel = (level: ExperienceLevel): TotalExperience => {
  const atLevel = Math.max(0, Math.floor(delta(level)))
  return TotalExperience(Math.min(Number.MAX_VALUE, totalAtLevel(atLevel)))
}

export const levelForTotalExperience = (totalExperience: TotalExperience): ExperienceLevel => {
  const total = Number.isFinite(totalExperience) ? Math.max(0, totalExperience) : 0
  let low = 0
  let high = 1

  while (high < MAX_EXPERIENCE_LEVEL && totalAtLevel(high) <= total) {
    high = Math.min(MAX_EXPERIENCE_LEVEL, high * 2)
  }
  if (high === MAX_EXPERIENCE_LEVEL && totalAtLevel(high) <= total) return ExperienceLevel(high)

  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2)
    if (totalAtLevel(middle) <= total) low = middle
    else high = middle
  }
  return ExperienceLevel(low)
}

export const experienceLevel = (vitals: Vitals): ExperienceLevel =>
  levelForTotalExperience(vitals.totalExperience)

export const experienceProgress = (vitals: Vitals): ExperienceProgress => {
  const level = experienceLevel(vitals)
  const cost = experienceCostOfLevel(level)
  const total = Number.isFinite(vitals.totalExperience)
    ? Math.max(0, vitals.totalExperience)
    : 0
  return ExperienceProgress(clamp((total - totalExperienceAtLevel(level)) / cost, 0, 1))
}

export const addExperience = (vitals: Vitals, amount: ExperienceDelta): Vitals => {
  const awarded = delta(amount)
  if (awarded === 0) return vitals

  return {
    ...vitals,
    totalExperience: TotalExperience(Math.min(Number.MAX_VALUE, Math.max(0, vitals.totalExperience + awarded))),
  }
}
