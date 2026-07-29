import { type Damage, type Vitals } from './vitals-model'
import { delta } from './vitals-number'

export const isDead = (vitals: Vitals): boolean => vitals.healthPoints <= 0

export const applyDamage = (vitals: Vitals, damage: Damage): Vitals => {
  const amount = delta(damage.amount)
  if (isDead(vitals) || amount <= 0) return vitals

  const healthPoints = Math.max(0, vitals.healthPoints - amount)
  return {
    ...vitals,
    healthPoints,
    lastDamageCause: healthPoints <= 0 ? damage.cause : vitals.lastDamageCause,
  }
}

export const heal = (vitals: Vitals, amount: number): Vitals => {
  const healed = delta(amount)
  if (isDead(vitals) || healed <= 0) return vitals

  return {
    ...vitals,
    healthPoints: Math.min(vitals.maxHealthPoints, vitals.healthPoints + healed),
  }
}
