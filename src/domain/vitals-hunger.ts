import {
  EntityHealthPoints,
  FoodNutrition,
  FoodSaturation,
  type DeltaTimeSecs,
} from '@nerima-games/mc-kernel'
import { Schema } from 'effect'
import {
  EXHAUSTION_PER_POINT,
  EXHAUSTION_PER_REGEN,
  FOOD_TICK_SECS,
  MAX_EXHAUSTION,
  REGEN_HUNGER_THRESHOLD,
  SATURATED_REGEN_TICK_SECS,
  ExhaustionAmount,
  FoodTimerSecs,
  HungerPoints,
  SaturationModifier,
  TotalExperience,
  DamageCause,
  type Vitals,
} from './vitals-model.js'
import { isValidVitals, normaliseVitals } from './vitals-validation.js'
import { clamp, delta } from './vitals-number.js'

export type FoodTickSignal = 'none' | 'regen' | 'starve'
export const FoodTickSignalSchema: Schema.Schema<FoodTickSignal> = Schema.Literals(['none', 'regen', 'starve'])

const safeVitals = (vitals: Vitals): Vitals => {
  if (
    isValidVitals(vitals) &&
    EntityHealthPoints.is(vitals.healthPoints) &&
    EntityHealthPoints.is(vitals.maxHealthPoints) &&
    HungerPoints.is(vitals.hungerPoints) &&
    HungerPoints.is(vitals.maxHungerPoints) &&
    FoodSaturation.is(vitals.saturation) &&
    ExhaustionAmount.is(vitals.exhaustion) &&
    FoodTimerSecs.is(vitals.foodTimerSecs) &&
    TotalExperience.is(vitals.totalExperience) &&
    (vitals.lastDamageCause === undefined || DamageCause.is(vitals.lastDamageCause))
  ) {
    return vitals
  }
  return normaliseVitals(vitals)
}

const cascadeExhaustion = (vitals: Vitals, rawExhaustion: number): Vitals => {
  let exhaustion = clamp(rawExhaustion, 0, MAX_EXHAUSTION)
  let saturation: number = vitals.saturation
  let hungerPoints: number = vitals.hungerPoints

  while (exhaustion >= EXHAUSTION_PER_POINT) {
    exhaustion -= EXHAUSTION_PER_POINT
    if (saturation > 0) saturation = Math.max(0, saturation - 1)
    else hungerPoints = Math.max(0, hungerPoints - 1)
  }

  return {
    ...vitals,
    hungerPoints: HungerPoints(hungerPoints),
    saturation: FoodSaturation(saturation),
    exhaustion: ExhaustionAmount(exhaustion),
  }
}

export const addExhaustion = (vitals: Vitals, amount: ExhaustionAmount): Vitals => {
  const base = safeVitals(vitals)
  const added = delta(amount)
  return added <= 0
    ? base
    : cascadeExhaustion(base, base.exhaustion + added)
}

export const eat = (
  vitals: Vitals,
  foodPoints: FoodNutrition,
  saturationModifier: SaturationModifier,
): Vitals => {
  const base = safeVitals(vitals)
  const food = delta(foodPoints)
  if (food <= 0) return base

  const hungerPoints = HungerPoints(clamp(base.hungerPoints + food, 0, base.maxHungerPoints))
  const saturation = FoodSaturation(clamp(
    base.saturation + food * delta(saturationModifier) * 2,
    0,
    hungerPoints,
  ))
  return { ...base, hungerPoints, saturation }
}

export const advanceFoodTimer = (
  vitals: Vitals,
  dt: DeltaTimeSecs,
): readonly [FoodTickSignal, Vitals] => {
  const base = safeVitals(vitals)
  const elapsed = Math.max(0, delta(dt))
  const fastRegenAvailable =
    base.healthPoints > 0 &&
    base.healthPoints < base.maxHealthPoints &&
    base.hungerPoints === base.maxHungerPoints &&
    base.saturation > 0
  const regenInterval = fastRegenAvailable ? SATURATED_REGEN_TICK_SECS : FOOD_TICK_SECS
  const accumulatedElapsed = base.foodTimerSecs + elapsed
  const tickTolerance = Number.EPSILON * Math.max(1, regenInterval, accumulatedElapsed)
  const crossesTick =
    elapsed > 0 && !Number.isNaN(accumulatedElapsed) && accumulatedElapsed + tickTolerance >= regenInterval
  const elapsedModulo = Number.isFinite(elapsed) ? elapsed % FOOD_TICK_SECS : 0
  const timerWithRemainder = base.foodTimerSecs + elapsedModulo
  const remainderTolerance = Number.EPSILON * Math.max(1, regenInterval, timerWithRemainder)
  const completedIntervals = crossesTick
    ? Math.floor((timerWithRemainder + remainderTolerance) / regenInterval)
    : 0
  const foodTimerSecs = FoodTimerSecs(Math.max(0, timerWithRemainder - completedIntervals * regenInterval))
  if (!crossesTick) {
    return ['none', { ...base, foodTimerSecs }]
  }

  const ticked = { ...base, foodTimerSecs }
  const canRegenerate =
    ticked.healthPoints > 0 &&
    ticked.healthPoints < ticked.maxHealthPoints &&
    ticked.hungerPoints >= REGEN_HUNGER_THRESHOLD
  if (canRegenerate) {
    return ['regen', addExhaustion(ticked, ExhaustionAmount(EXHAUSTION_PER_REGEN))]
  }

  return ticked.hungerPoints <= 0 ? ['starve', ticked] : ['none', ticked]
}
