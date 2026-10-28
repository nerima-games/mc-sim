import fc from 'fast-check'
import { expect, it } from 'vitest'
import { DeltaTimeSecs, FoodNutrition } from '@nerima-games/mc-kernel'
import * as Sim from '../src/index.js'
import { finiteTree, hostileValue, isRecord, invoke, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 100, seed: 0x56495445 }
const isNumberBrand = (value: unknown, brand: (candidate: number) => boolean): boolean =>
  typeof value === 'number' && brand(value)

const malformedVitals: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom<unknown>(null, undefined, false, 0, 'invalid', []),
  unknownValue,
  fc.constant<unknown>({
    healthPoints: 10,
    maxHealthPoints: 20,
    hungerPoints: 10,
    maxHungerPoints: 20,
    saturation: 5,
    exhaustion: 0,
    foodTimerSecs: 0,
    totalExperience: 0,
    lastDamageCause: undefined,
  }),
  fc.record({
    healthPoints: hostileValue,
    maxHealthPoints: hostileValue,
    hungerPoints: hostileValue,
    maxHungerPoints: hostileValue,
    saturation: hostileValue,
    exhaustion: hostileValue,
    foodTimerSecs: hostileValue,
    totalExperience: hostileValue,
    lastDamageCause: hostileValue,
  }),
)

const assertValidVitals = (value: unknown): void => {
  expect(isRecord(value)).toBe(true)
  expect(Sim.isValidVitals(value)).toBe(true)
  expect(finiteTree(value)).toBe(true)
  if (!isRecord(value)) return
  expect(isNumberBrand(value['healthPoints'], Sim.EntityHealthPoints.is)).toBe(true)
  expect(isNumberBrand(value['maxHealthPoints'], Sim.EntityHealthPoints.is)).toBe(true)
  expect(isNumberBrand(value['hungerPoints'], Sim.HungerPoints.is)).toBe(true)
  expect(isNumberBrand(value['maxHungerPoints'], Sim.HungerPoints.is)).toBe(true)
  expect(isNumberBrand(value['saturation'], Sim.FoodSaturation.is)).toBe(true)
  expect(isNumberBrand(value['exhaustion'], Sim.ExhaustionAmount.is)).toBe(true)
  expect(isNumberBrand(value['foodTimerSecs'], Sim.FoodTimerSecs.is)).toBe(true)
  expect(isNumberBrand(value['totalExperience'], Sim.TotalExperience.is)).toBe(true)
  expect(value['lastDamageCause'] === undefined || (
    typeof value['lastDamageCause'] === 'string' && Sim.DamageCause.is(value['lastDamageCause'])
  )).toBe(true)
}

it('direct vitals APIs repair malformed state envelopes to finite branded domain values', () => {
  const damage = { amount: Sim.DamageAmount(3), cause: Sim.DamageCause('property') }

  fc.assert(fc.property(malformedVitals, (candidate) => {
    expect(typeof invoke(Sim.isDead, [candidate])).toBe('boolean')

    const outcomes = [
      invoke(Sim.applyDamage, [candidate, damage]),
      invoke(Sim.heal, [candidate, Sim.HealthAmount(2)]),
      invoke(Sim.addExhaustion, [candidate, Sim.ExhaustionAmount(2)]),
      invoke(Sim.eat, [candidate, FoodNutrition(2), Sim.SaturationModifier(0.5)]),
      invoke(Sim.advanceFoodTimer, [candidate, DeltaTimeSecs(1)]),
      invoke(Sim.addExperience, [candidate, Sim.ExperienceDelta(2)]),
      invoke(Sim.respawn, [candidate]),
    ]

    for (const outcome of outcomes.slice(0, 4).concat(outcomes.slice(5))) assertValidVitals(outcome)

    const tick = outcomes[4]
    expect(Array.isArray(tick)).toBe(true)
    if (Array.isArray(tick)) {
      expect(['none', 'regen', 'starve']).toContain(tick[0])
      assertValidVitals(tick[1])
    }

    const level = invoke(Sim.experienceLevel, [candidate])
    const progress = invoke(Sim.experienceProgress, [candidate])
    expect(typeof level === 'number' && Sim.ExperienceLevel.is(level)).toBe(true)
    expect(typeof progress === 'number' && Sim.ExperienceProgress.is(progress)).toBe(true)
  }), checks)
})

it('damage rejects malformed outer envelopes by preserving a valid vitals state', () => {
  const damageInput = fc.oneof(
    fc.constantFrom<unknown>(null, undefined, false, 0, 'invalid', []),
    unknownValue,
    fc.record({ amount: hostileValue, cause: hostileValue }),
  )

  fc.assert(fc.property(damageInput, (candidate) => {
    const outcome = invoke(Sim.applyDamage, [Sim.SPAWN_VITALS, candidate])
    assertValidVitals(outcome)
  }), checks)
})
