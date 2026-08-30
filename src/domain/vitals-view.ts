import { type Vitals, type VitalsView } from './vitals-model.js'
import { experienceLevel, experienceProgress } from './vitals-experience.js'

export const vitalsView = (vitals: Vitals): VitalsView => ({
  healthPoints: vitals.healthPoints,
  maxHealthPoints: vitals.maxHealthPoints,
  hungerPoints: vitals.hungerPoints,
  maxHungerPoints: vitals.maxHungerPoints,
  experienceLevel: experienceLevel(vitals),
  experienceProgress: experienceProgress(vitals),
})
