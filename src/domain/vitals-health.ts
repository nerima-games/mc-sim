import { EntityHealthPoints, type HealthAmount } from '@nerima-games/mc-kernel'
import { type Damage, type Vitals } from './vitals-model.js'
import { delta } from './vitals-number.js'

export const isDead = (vitals: Vitals): boolean => vitals.healthPoints <= 0

export const applyDamage = (vitals: Vitals, damage: Damage): Vitals => {
  const amount = delta(damage.amount)
  if (isDead(vitals) || amount <= 0) return vitals

  const healthPoints = EntityHealthPoints(Math.max(0, vitals.healthPoints - amount))
  return {
    ...vitals,
    healthPoints,
    lastDamageCause: healthPoints <= 0 ? damage.cause : vitals.lastDamageCause,
  }
}

export const heal = (vitals: Vitals, amount: HealthAmount): Vitals => {
  const healed = delta(amount)
  if (isDead(vitals) || healed <= 0) return vitals

  return {
    ...vitals,
    healthPoints: EntityHealthPoints(Math.min(vitals.maxHealthPoints, vitals.healthPoints + healed)),
  }
}
