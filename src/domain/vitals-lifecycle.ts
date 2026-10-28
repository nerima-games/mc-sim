import { EntityHealthPoints, FoodSaturation } from '@nerima-games/mc-kernel'
import {
  DamageCause,
  ExhaustionAmount,
  FoodTimerSecs,
  HungerPoints,
  SPAWN_SATURATION,
  TotalExperience,
  type Vitals,
} from './vitals-model.js'
import { isValidVitals, normaliseVitals } from './vitals-validation.js'

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

export const respawn = (vitals: Vitals): Vitals => {
  const base = safeVitals(vitals)
  return {
    ...base,
    healthPoints: base.maxHealthPoints,
    hungerPoints: base.maxHungerPoints,
    saturation: FoodSaturation(Math.min(SPAWN_SATURATION, base.maxHungerPoints)),
    exhaustion: ExhaustionAmount(0),
    foodTimerSecs: FoodTimerSecs(0),
    lastDamageCause: undefined,
  }
}
