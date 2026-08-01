/** Core immutable state and configuration for the vitals simulation. */

export const DEFAULT_MAX_HEALTH_POINTS = 20
export const DEFAULT_MAX_HUNGER_POINTS = 20
export const SPAWN_SATURATION = 5
export const EXHAUSTION_PER_POINT = 4
export const MAX_EXHAUSTION = 40
export const FOOD_TICK_SECS = 4
export const REGEN_HUNGER_THRESHOLD = 18
export const EXHAUSTION_PER_REGEN = 6

export type DamageCause = string

export type Damage = {
  readonly amount: number
  readonly cause: DamageCause
}

export type Vitals = {
  readonly healthPoints: number
  readonly maxHealthPoints: number
  readonly hungerPoints: number
  readonly maxHungerPoints: number
  readonly saturation: number
  readonly exhaustion: number
  readonly foodTimerSecs: number
  readonly totalExperience: number
  readonly lastDamageCause: DamageCause | undefined
}

export type VitalsView = {
  readonly healthPoints: number
  readonly maxHealthPoints: number
  readonly hungerPoints: number
  readonly maxHungerPoints: number
  readonly experienceLevel: number
  readonly experienceProgress: number
}

export const SPAWN_VITALS: Vitals = {
  healthPoints: DEFAULT_MAX_HEALTH_POINTS,
  maxHealthPoints: DEFAULT_MAX_HEALTH_POINTS,
  hungerPoints: DEFAULT_MAX_HUNGER_POINTS,
  maxHungerPoints: DEFAULT_MAX_HUNGER_POINTS,
  saturation: SPAWN_SATURATION,
  exhaustion: 0,
  foodTimerSecs: 0,
  totalExperience: 0,
  lastDamageCause: undefined,
}
