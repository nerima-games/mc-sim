import { SPAWN_SATURATION, type Vitals } from './vitals-model'

export const respawn = (vitals: Vitals): Vitals => ({
  ...vitals,
  healthPoints: vitals.maxHealthPoints,
  hungerPoints: vitals.maxHungerPoints,
  saturation: Math.min(SPAWN_SATURATION, vitals.maxHungerPoints),
  exhaustion: 0,
  foodTimerSecs: 0,
  lastDamageCause: undefined,
})
