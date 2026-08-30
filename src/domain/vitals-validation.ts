import {
  DEFAULT_MAX_HEALTH_POINTS,
  DEFAULT_MAX_HUNGER_POINTS,
  EXHAUSTION_PER_POINT,
  FOOD_TICK_SECS,
  type Vitals,
} from './vitals-model.js'
import { clamp, settle } from './vitals-number.js'

const isValidHealth = (vitals: Vitals): boolean =>
  Number.isFinite(vitals.maxHealthPoints) &&
  vitals.maxHealthPoints > 0 &&
  Number.isFinite(vitals.healthPoints) &&
  vitals.healthPoints >= 0 &&
  vitals.healthPoints <= vitals.maxHealthPoints

const isValidHungerAndSaturation = (vitals: Vitals): boolean =>
  Number.isFinite(vitals.maxHungerPoints) &&
  vitals.maxHungerPoints >= 0 &&
  Number.isFinite(vitals.hungerPoints) &&
  vitals.hungerPoints >= 0 &&
  vitals.hungerPoints <= vitals.maxHungerPoints &&
  Number.isFinite(vitals.saturation) &&
  vitals.saturation >= 0 &&
  vitals.saturation <= vitals.hungerPoints

const isValidExhaustionAndFoodTimer = (vitals: Vitals): boolean =>
  Number.isFinite(vitals.exhaustion) &&
  vitals.exhaustion >= 0 &&
  vitals.exhaustion < EXHAUSTION_PER_POINT &&
  Number.isFinite(vitals.foodTimerSecs) &&
  vitals.foodTimerSecs >= 0 &&
  vitals.foodTimerSecs < FOOD_TICK_SECS

const isValidExperience = (vitals: Vitals): boolean =>
  Number.isFinite(vitals.totalExperience) && vitals.totalExperience >= 0

export const isValidVitals = (vitals: Vitals): boolean =>
  isValidHealth(vitals) &&
  isValidHungerAndSaturation(vitals) &&
  isValidExhaustionAndFoodTimer(vitals) &&
  isValidExperience(vitals)

export const normaliseVitals = (vitals: Vitals): Vitals => {
  const maxHealthPoints = Number.isFinite(vitals.maxHealthPoints)
    ? Math.max(1, vitals.maxHealthPoints)
    : DEFAULT_MAX_HEALTH_POINTS
  const maxHungerPoints = Number.isFinite(vitals.maxHungerPoints)
    ? Math.max(0, vitals.maxHungerPoints)
    : DEFAULT_MAX_HUNGER_POINTS
  const hungerPoints = clamp(vitals.hungerPoints, 0, maxHungerPoints)

  return {
    healthPoints: clamp(vitals.healthPoints, 0, maxHealthPoints),
    maxHealthPoints,
    hungerPoints,
    maxHungerPoints,
    saturation: clamp(vitals.saturation, 0, hungerPoints),
    exhaustion: settle(vitals.exhaustion, EXHAUSTION_PER_POINT),
    foodTimerSecs: settle(vitals.foodTimerSecs, FOOD_TICK_SECS),
    totalExperience: Number.isFinite(vitals.totalExperience)
      ? Math.max(0, vitals.totalExperience)
      : 0,
    lastDamageCause:
      typeof vitals.lastDamageCause === 'string'
        ? vitals.lastDamageCause
        : undefined,
  }
}
