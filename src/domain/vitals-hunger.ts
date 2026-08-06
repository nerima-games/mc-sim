import { type DeltaTimeSecs } from '@nerima-games/mc-kernel'
import {
  EXHAUSTION_PER_POINT,
  EXHAUSTION_PER_REGEN,
  FOOD_TICK_SECS,
  MAX_EXHAUSTION,
  REGEN_HUNGER_THRESHOLD,
  type Vitals,
} from './vitals-model'
import { clamp, delta } from './vitals-number'

export type FoodTickSignal = 'none' | 'regen' | 'starve'

const cascadeExhaustion = (vitals: Vitals, rawExhaustion: number): Vitals => {
  let exhaustion = clamp(rawExhaustion, 0, MAX_EXHAUSTION)
  let saturation = vitals.saturation
  let hungerPoints = vitals.hungerPoints

  while (exhaustion >= EXHAUSTION_PER_POINT) {
    exhaustion -= EXHAUSTION_PER_POINT
    if (saturation > 0) saturation = Math.max(0, saturation - 1)
    else hungerPoints = Math.max(0, hungerPoints - 1)
  }

  return { ...vitals, hungerPoints, saturation, exhaustion }
}

export const addExhaustion = (vitals: Vitals, amount: number): Vitals => {
  const added = delta(amount)
  return added <= 0
    ? vitals
    : cascadeExhaustion(vitals, vitals.exhaustion + added)
}

export const eat = (
  vitals: Vitals,
  foodPoints: number,
  saturationModifier: number,
): Vitals => {
  const food = delta(foodPoints)
  if (food <= 0) return vitals

  const hungerPoints = clamp(vitals.hungerPoints + food, 0, vitals.maxHungerPoints)
  const saturation = clamp(
    vitals.saturation + food * delta(saturationModifier) * 2,
    0,
    hungerPoints,
  )
  return { ...vitals, hungerPoints, saturation }
}

export const advanceFoodTimer = (
  vitals: Vitals,
  dt: DeltaTimeSecs,
): readonly [FoodTickSignal, Vitals] => {
  const elapsed = Math.max(0, delta(dt))
  const foodTimerSecs = vitals.foodTimerSecs + elapsed
  if (foodTimerSecs < FOOD_TICK_SECS) {
    return ['none', { ...vitals, foodTimerSecs }]
  }

  const ticked = { ...vitals, foodTimerSecs: foodTimerSecs % FOOD_TICK_SECS }
  const canRegenerate =
    ticked.healthPoints > 0 &&
    ticked.healthPoints < ticked.maxHealthPoints &&
    ticked.hungerPoints >= REGEN_HUNGER_THRESHOLD
  if (canRegenerate) {
    return ['regen', addExhaustion(ticked, EXHAUSTION_PER_REGEN)]
  }

  return ticked.hungerPoints <= 0 ? ['starve', ticked] : ['none', ticked]
}
