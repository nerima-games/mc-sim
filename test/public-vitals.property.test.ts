import fc from 'fast-check'
import { Effect } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { finiteTree, hostileValue, isRecord, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 40, seed: 0x56495441 }
const finiteNonNegative = fc.double({ min: 0, max: Number.MAX_VALUE, noNaN: true })
const finitePositive = fc.double({ min: Number.MIN_VALUE, max: Number.MAX_VALUE, noNaN: true })

const hostileVitals: fc.Arbitrary<unknown> = fc.oneof(
  unknownValue,
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
  expect(finiteTree(value)).toBe(true)
  expect(Sim.isValidVitals(value)).toBe(true)
  expect(isRecord(value)).toBe(true)
}

const validVitals = fc.record({
  healthPoints: finiteNonNegative,
  maxHealthPoints: finitePositive,
  hungerPoints: finiteNonNegative,
  maxHungerPoints: finiteNonNegative,
  saturation: finiteNonNegative,
  exhaustion: finiteNonNegative,
  foodTimerSecs: finiteNonNegative,
  totalExperience: finiteNonNegative,
  lastDamageCause: fc.oneof(fc.constant(undefined), fc.string({ maxLength: 24 })),
}).map(Sim.normaliseVitals)

it('vitals normalization repairs hostile records to finite valid state and validation stays total', () => {
  fc.assert(
    fc.property(hostileVitals, (input) => {
      expect(typeof Sim.isValidVitals(input)).toBe('boolean')
      const before = JSON.stringify(input)
      const normalized = Sim.normaliseVitals(input)
      assertValidVitals(normalized)
      expect(JSON.stringify(input)).toBe(before)
    }),
    checks,
  )
})

it('vitals service construction and restore retain finite valid branded snapshots for hostile saves', async () => {
  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileVitals, hostileVitals), async ([initial, restored]) => {
      const service = await Effect.runPromise(Sim.makeVitalsService(initial))
      const initialSnapshot = await Effect.runPromise(service.snapshot)
      assertValidVitals(initialSnapshot)

      await Effect.runPromise(service.restore(restored))
      const restoredSnapshot = await Effect.runPromise(service.snapshot)
      assertValidVitals(restoredSnapshot)
    }),
    checks,
  )
})

it('vitals dead checks, views, respawn and experience queries preserve finite domain state', () => {
  fc.assert(
    fc.property(validVitals, (state) => {
      expect(Sim.isDead(state)).toBe(state.healthPoints <= 0)

      const view = Sim.vitalsView(state)
      expect(finiteTree(view)).toBe(true)
      expect(view.healthPoints).toBeLessThanOrEqual(view.maxHealthPoints)
      expect(view.experienceLevel).toBeGreaterThanOrEqual(0)
      expect(Number.isSafeInteger(view.experienceLevel)).toBe(true)
      expect(view.experienceProgress).toBeGreaterThanOrEqual(0)
      expect(view.experienceProgress).toBeLessThanOrEqual(1)

      const respawned = Sim.respawn(state)
      assertValidVitals(respawned)
      expect(respawned.healthPoints).toBe(respawned.maxHealthPoints)
      expect(respawned.hungerPoints).toBe(respawned.maxHungerPoints)
      expect(respawned.totalExperience).toBe(state.totalExperience)

      const level = Sim.experienceLevel(state)
      expect(level).toBe(Sim.levelForTotalExperience(Sim.TotalExperience(state.totalExperience)))
      expect(Number.isSafeInteger(level)).toBe(true)
      expect(level).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(Sim.experienceCostOfLevel(level))).toBe(true)
      expect(Sim.experienceCostOfLevel(level)).toBeGreaterThan(0)
      expect(Number.isFinite(Sim.totalExperienceAtLevel(level))).toBe(true)
      expect(Sim.totalExperienceAtLevel(level)).toBeGreaterThanOrEqual(0)
    }),
    checks,
  )
})

it('experience progress remains finite and in range for extreme valid totals', () => {
  fc.assert(
    fc.property(finiteNonNegative, (total) => {
      const state = Sim.normaliseVitals({ ...Sim.SPAWN_VITALS, totalExperience: total })
      const progress = Sim.experienceProgress(state)

      assertValidVitals(state)
      expect(Number.isFinite(progress)).toBe(true)
      expect(progress).toBeGreaterThanOrEqual(0)
      expect(progress).toBeLessThanOrEqual(1)
    }),
    checks,
  )
})

it('VitalsService view, respawn and reset expose only finite valid snapshots', async () => {
  const input = fc.record({
    initial: hostileVitals,
    totalExperience: finiteNonNegative,
  })

  await fc.assert(
    fc.asyncProperty(input, async (value) => {
      const service = await Effect.runPromise(Sim.makeVitalsService(value.initial))
      assertValidVitals(await Effect.runPromise(service.snapshot))

      const view = await Effect.runPromise(service.view)
      expect(finiteTree(view)).toBe(true)
      expect(view.healthPoints).toBeLessThanOrEqual(view.maxHealthPoints)
      expect(view.experienceProgress).toBeGreaterThanOrEqual(0)
      expect(view.experienceProgress).toBeLessThanOrEqual(1)

      await Effect.runPromise(service.restore({
        ...Sim.SPAWN_VITALS,
        healthPoints: 0,
        totalExperience: value.totalExperience,
      }))
      const beforeRespawn = await Effect.runPromise(service.snapshot)
      assertValidVitals(beforeRespawn)
      await Effect.runPromise(service.respawn)
      const afterRespawn = await Effect.runPromise(service.snapshot)
      assertValidVitals(afterRespawn)
      expect(afterRespawn.healthPoints).toBe(afterRespawn.maxHealthPoints)
      expect(afterRespawn.totalExperience).toBe(beforeRespawn.totalExperience)

      await Effect.runPromise(service.reset)
      expect(await Effect.runPromise(service.snapshot)).toEqual(Sim.SPAWN_VITALS)
      const resetView = await Effect.runPromise(service.view)
      expect(finiteTree(resetView)).toBe(true)
      expect(resetView.healthPoints).toBe(Sim.SPAWN_VITALS.healthPoints)
    }),
    checks,
  )
})
