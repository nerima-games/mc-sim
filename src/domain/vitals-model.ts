/** Core immutable state and configuration for the vitals simulation. */

import { Brand } from 'effect'
import {
  EntityHealthPoints,
  FoodSaturation,
  type DamageAmount as KernelDamageAmount,
  type ExperienceAmount as KernelExperienceAmount,
  type ExperienceLevel as KernelExperienceLevel,
  type HealthAmount as KernelHealthAmount,
} from '@nerima-games/mc-kernel'

export { EntityHealthPoints, FoodSaturation }

export type DamageAmount = KernelDamageAmount
export const DamageAmount: Brand.Constructor<DamageAmount> = Brand.make((value) =>
  Number.isFinite(value) && value > 0 ? true : `DamageAmount must be finite and positive, received ${String(value)}`,
)

export type HealthAmount = KernelHealthAmount
export const HealthAmount: Brand.Constructor<HealthAmount> = Brand.make((value) =>
  Number.isFinite(value) && value > 0 ? true : `HealthAmount must be finite and positive, received ${String(value)}`,
)

export type ExperienceAmount = KernelExperienceAmount
export const ExperienceAmount: Brand.Constructor<ExperienceAmount> = Brand.make((value) =>
  Number.isSafeInteger(value) && value >= 1
    ? true
    : `ExperienceAmount must be a positive safe integer, received ${String(value)}`,
)

export type ExperienceDelta = number & Brand.Brand<'ExperienceDelta'>
export const ExperienceDelta: Brand.Constructor<ExperienceDelta> = Brand.make((value) =>
  Number.isFinite(value)
    ? true
    : `ExperienceDelta must be finite, received ${String(value)}`,
)

export type ExperienceLevel = KernelExperienceLevel
export const ExperienceLevel: Brand.Constructor<ExperienceLevel> = Brand.make((value) =>
  Number.isSafeInteger(value) && value >= 0
    ? true
    : `ExperienceLevel must be a non-negative safe integer, received ${String(value)}`,
)

export const DEFAULT_MAX_HEALTH_POINTS = 20
export const DEFAULT_MAX_HUNGER_POINTS = 20
export const SPAWN_SATURATION = 5
export const EXHAUSTION_PER_POINT = 4
export const MAX_EXHAUSTION = 40
export const FOOD_TICK_SECS = 4
export const REGEN_HUNGER_THRESHOLD = 18
export const EXHAUSTION_PER_REGEN = 6

export type DamageCause = string & Brand.Brand<'SimDamageCause'>
export const DamageCause: Brand.Constructor<DamageCause> = Brand.make((value) =>
  typeof value === 'string' ? true : `DamageCause must be a string, received ${String(value)}`,
)

export type HungerPoints = number & Brand.Brand<'HungerPoints'>
export const HungerPoints: Brand.Constructor<HungerPoints> = Brand.make((value) =>
  Number.isFinite(value) && value >= 0
    ? true
    : `HungerPoints must be finite and non-negative, received ${String(value)}`,
)

export type ExhaustionAmount = number & Brand.Brand<'ExhaustionAmount'>
export const ExhaustionAmount: Brand.Constructor<ExhaustionAmount> = Brand.make((value) =>
  Number.isFinite(value) && value >= 0
    ? true
    : `ExhaustionAmount must be finite and non-negative, received ${String(value)}`,
)

export type FoodTimerSecs = number & Brand.Brand<'FoodTimerSecs'>
export const FoodTimerSecs: Brand.Constructor<FoodTimerSecs> = Brand.make((value) =>
  Number.isFinite(value) && value >= 0
    ? true
    : `FoodTimerSecs must be finite and non-negative, received ${String(value)}`,
)

export type TotalExperience = number & Brand.Brand<'TotalExperience'>
export const TotalExperience: Brand.Constructor<TotalExperience> = Brand.make((value) =>
  Number.isFinite(value) && value >= 0
    ? true
    : `TotalExperience must be finite and non-negative, received ${String(value)}`,
)

export type ExperienceCost = number & Brand.Brand<'ExperienceCost'>
export const ExperienceCost: Brand.Constructor<ExperienceCost> = Brand.make((value) =>
  Number.isFinite(value) && value > 0
    ? true
    : `ExperienceCost must be finite and positive, received ${String(value)}`,
)

export type ExperienceProgress = number & Brand.Brand<'ExperienceProgress'>
export const ExperienceProgress: Brand.Constructor<ExperienceProgress> = Brand.make((value) =>
  Number.isFinite(value) && value >= 0 && value <= 1
    ? true
    : `ExperienceProgress must be finite and in [0, 1], received ${String(value)}`,
)

export type SaturationModifier = number & Brand.Brand<'SaturationModifier'>
export const SaturationModifier: Brand.Constructor<SaturationModifier> = Brand.make((value) =>
  Number.isFinite(value) && value >= 0
    ? true
    : `SaturationModifier must be finite and non-negative, received ${String(value)}`,
)

export type Damage = {
  readonly amount: DamageAmount
  readonly cause: DamageCause
}

export type Vitals = {
  readonly healthPoints: EntityHealthPoints
  readonly maxHealthPoints: EntityHealthPoints
  readonly hungerPoints: HungerPoints
  readonly maxHungerPoints: HungerPoints
  readonly saturation: FoodSaturation
  readonly exhaustion: ExhaustionAmount
  readonly foodTimerSecs: FoodTimerSecs
  readonly totalExperience: TotalExperience
  readonly lastDamageCause: DamageCause | undefined
}

export type VitalsView = {
  readonly healthPoints: EntityHealthPoints
  readonly maxHealthPoints: EntityHealthPoints
  readonly hungerPoints: HungerPoints
  readonly maxHungerPoints: HungerPoints
  readonly experienceLevel: ExperienceLevel
  readonly experienceProgress: ExperienceProgress
}

export const SPAWN_VITALS: Vitals = {
  healthPoints: EntityHealthPoints(DEFAULT_MAX_HEALTH_POINTS),
  maxHealthPoints: EntityHealthPoints(DEFAULT_MAX_HEALTH_POINTS),
  hungerPoints: HungerPoints(DEFAULT_MAX_HUNGER_POINTS),
  maxHungerPoints: HungerPoints(DEFAULT_MAX_HUNGER_POINTS),
  saturation: FoodSaturation(SPAWN_SATURATION),
  exhaustion: ExhaustionAmount(0),
  foodTimerSecs: FoodTimerSecs(0),
  totalExperience: TotalExperience(0),
  lastDamageCause: undefined,
}
