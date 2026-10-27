import { EntityHealthPoints, FoodSaturation, type HealthAmount } from '@nerima-games/mc-kernel'
import { isValidVitals, normaliseVitals } from './vitals-validation.js'
import {
  DamageCause,
  ExhaustionAmount,
  FoodTimerSecs,
  HungerPoints,
  TotalExperience,
  type Damage,
  type Vitals,
} from './vitals-model.js'
import { delta } from './vitals-number.js'

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

const isDeadState = (vitals: Vitals): boolean => vitals.healthPoints <= 0

export const isDead = (vitals: Vitals): boolean => isDeadState(safeVitals(vitals))

export const applyDamage = (vitals: Vitals, damage: Damage): Vitals => {
  const base = safeVitals(vitals)
  const damageEnvelope = typeof damage === 'object' && damage !== null && !Array.isArray(damage)
    ? damage as Damage
    : undefined
  const amount = delta((damageEnvelope?.amount ?? Number.NaN) as number)
  if (isDeadState(base) || amount <= 0) return base

  const healthPoints = EntityHealthPoints(Math.max(0, base.healthPoints - amount))
  return {
    ...base,
    healthPoints,
    lastDamageCause: healthPoints <= 0 && typeof damageEnvelope?.cause === 'string'
      ? DamageCause(damageEnvelope.cause)
      : base.lastDamageCause,
  }
}

export const heal = (vitals: Vitals, amount: HealthAmount): Vitals => {
  const base = safeVitals(vitals)
  const healed = delta(amount)
  if (isDeadState(base) || healed <= 0) return base

  return {
    ...base,
    healthPoints: EntityHealthPoints(Math.min(base.maxHealthPoints, base.healthPoints + healed)),
  }
}
