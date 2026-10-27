import { FoodSaturation } from '@nerima-games/mc-kernel'
import { ExhaustionAmount, FoodTimerSecs, SPAWN_SATURATION, type Vitals } from './vitals-model.js'

export const respawn = (vitals: Vitals): Vitals => ({
  ...vitals,
  healthPoints: vitals.maxHealthPoints,
  hungerPoints: vitals.maxHungerPoints,
  saturation: FoodSaturation(Math.min(SPAWN_SATURATION, vitals.maxHungerPoints)),
  exhaustion: ExhaustionAmount(0),
  foodTimerSecs: FoodTimerSecs(0),
  lastDamageCause: undefined,
})
