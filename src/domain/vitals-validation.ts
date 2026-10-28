import {
  DEFAULT_MAX_HEALTH_POINTS,
  DEFAULT_MAX_HUNGER_POINTS,
  DamageCause,
  EntityHealthPoints,
  ExhaustionAmount,
  FoodSaturation,
  FoodTimerSecs,
  HungerPoints,
  TotalExperience,
  EXHAUSTION_PER_POINT,
  FOOD_TICK_SECS,
  type Vitals,
} from './vitals-model.js'
import { clamp, settle } from './vitals-number.js'

type VitalsRecord = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is VitalsRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const numberAt = (vitals: VitalsRecord, key: string): number => {
  const value = vitals[key]
  return typeof value === 'number' ? value : Number.NaN
}

const isValidHealth = (vitals: VitalsRecord): boolean => {
  const maxHealthPoints = numberAt(vitals, 'maxHealthPoints')
  const healthPoints = numberAt(vitals, 'healthPoints')
  return Number.isFinite(maxHealthPoints) &&
    maxHealthPoints > 0 &&
    Number.isFinite(healthPoints) &&
    healthPoints >= 0 &&
    healthPoints <= maxHealthPoints
}

const isValidHungerAndSaturation = (vitals: VitalsRecord): boolean => {
  const maxHungerPoints = numberAt(vitals, 'maxHungerPoints')
  const hungerPoints = numberAt(vitals, 'hungerPoints')
  const saturation = numberAt(vitals, 'saturation')
  return Number.isFinite(maxHungerPoints) &&
    maxHungerPoints >= 0 &&
    Number.isFinite(hungerPoints) &&
    hungerPoints >= 0 &&
    hungerPoints <= maxHungerPoints &&
    Number.isFinite(saturation) &&
    saturation >= 0 &&
    saturation <= hungerPoints
}

const isValidExhaustionAndFoodTimer = (vitals: VitalsRecord): boolean => {
  const exhaustion = numberAt(vitals, 'exhaustion')
  const foodTimerSecs = numberAt(vitals, 'foodTimerSecs')
  return Number.isFinite(exhaustion) &&
    exhaustion >= 0 &&
    exhaustion < EXHAUSTION_PER_POINT &&
    Number.isFinite(foodTimerSecs) &&
    foodTimerSecs >= 0 &&
    foodTimerSecs < FOOD_TICK_SECS
}

const isValidExperience = (vitals: VitalsRecord): boolean => {
  const totalExperience = numberAt(vitals, 'totalExperience')
  return Number.isFinite(totalExperience) && totalExperience >= 0
}

export const isValidVitals = (vitals: unknown): boolean =>
  isRecord(vitals) &&
  isValidHealth(vitals) &&
  isValidHungerAndSaturation(vitals) &&
  isValidExhaustionAndFoodTimer(vitals) &&
  isValidExperience(vitals)

export const normaliseVitals = (value: unknown): Vitals => {
  const vitals = isRecord(value) ? value : {}
  const maxHealthValue = numberAt(vitals, 'maxHealthPoints')
  const maxHungerValue = numberAt(vitals, 'maxHungerPoints')
  const maxHealthPoints = EntityHealthPoints(
    Number.isFinite(maxHealthValue) ? Math.max(1, maxHealthValue) : DEFAULT_MAX_HEALTH_POINTS,
  )
  const maxHungerPoints = HungerPoints(
    Number.isFinite(maxHungerValue) ? Math.max(0, maxHungerValue) : DEFAULT_MAX_HUNGER_POINTS,
  )
  const hungerPoints = HungerPoints(clamp(numberAt(vitals, 'hungerPoints'), 0, maxHungerPoints))
  const rawCause = vitals['lastDamageCause']

  return {
    healthPoints: EntityHealthPoints(clamp(numberAt(vitals, 'healthPoints'), 0, maxHealthPoints)),
    maxHealthPoints,
    hungerPoints,
    maxHungerPoints,
    saturation: FoodSaturation(clamp(numberAt(vitals, 'saturation'), 0, hungerPoints)),
    exhaustion: ExhaustionAmount(settle(numberAt(vitals, 'exhaustion'), EXHAUSTION_PER_POINT)),
    foodTimerSecs: FoodTimerSecs(settle(numberAt(vitals, 'foodTimerSecs'), FOOD_TICK_SECS)),
    totalExperience: TotalExperience(
      Number.isFinite(numberAt(vitals, 'totalExperience'))
        ? Math.max(0, numberAt(vitals, 'totalExperience'))
        : 0,
    ),
    lastDamageCause: typeof rawCause === 'string' ? DamageCause(rawCause) : undefined,
  }
}
