import { FoodNutrition, FoodSaturation, type DeltaTimeSecs } from '@nerima-games/mc-kernel'
import {
  EXHAUSTION_PER_POINT,
  EXHAUSTION_PER_REGEN,
  FOOD_TICK_SECS,
  MAX_EXHAUSTION,
  REGEN_HUNGER_THRESHOLD,
  ExhaustionAmount,
  FoodTimerSecs,
  HungerPoints,
  SaturationModifier,
  type Vitals,
} from './vitals-model.js'
import { clamp, delta } from './vitals-number.js'

export type FoodTickSignal = 'none' | 'regen' | 'starve'

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
  const added = delta(amount)
  return added <= 0
    ? vitals
    : cascadeExhaustion(vitals, vitals.exhaustion + added)
}

export const eat = (
  vitals: Vitals,
  foodPoints: FoodNutrition,
  saturationModifier: SaturationModifier,
): Vitals => {
  const food = delta(foodPoints)
  if (food <= 0) return vitals

  const hungerPoints = HungerPoints(clamp(vitals.hungerPoints + food, 0, vitals.maxHungerPoints))
  const saturation = FoodSaturation(clamp(
    vitals.saturation + food * delta(saturationModifier) * 2,
    0,
    hungerPoints,
  ))
  return { ...vitals, hungerPoints, saturation }
}

export const advanceFoodTimer = (
  vitals: Vitals,
  dt: DeltaTimeSecs,
): readonly [FoodTickSignal, Vitals] => {
  const elapsed = Math.max(0, delta(dt))
  const crossesTick = vitals.foodTimerSecs + elapsed >= FOOD_TICK_SECS
  const elapsedModulo = Number.isFinite(elapsed) ? elapsed % FOOD_TICK_SECS : 0
  const foodTimerSecs = FoodTimerSecs((vitals.foodTimerSecs + elapsedModulo) % FOOD_TICK_SECS)
  if (!crossesTick) {
    return ['none', { ...vitals, foodTimerSecs }]
  }

  const ticked = { ...vitals, foodTimerSecs }
  const canRegenerate =
    ticked.healthPoints > 0 &&
    ticked.healthPoints < ticked.maxHealthPoints &&
    ticked.hungerPoints >= REGEN_HUNGER_THRESHOLD
  if (canRegenerate) {
    return ['regen', addExhaustion(ticked, ExhaustionAmount(EXHAUSTION_PER_REGEN))]
  }

  return ticked.hungerPoints <= 0 ? ['starve', ticked] : ['none', ticked]
}
