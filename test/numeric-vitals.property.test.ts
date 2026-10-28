import fc from 'fast-check'
import { expect, it } from 'vitest'
import { Effect, Result } from 'effect'
import * as VitalsService from '../src/application/vitals-service.js'
import * as Vitals from '../src/domain/vitals.js'
import { assertEffectOutcome, hostileValue, invoke, invokeEffect, isRecord } from './public-property-helpers.js'

const containsOnlyFiniteNumbers = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(containsOnlyFiniteNumbers)
  if (isRecord(value)) return Object.values(value).every(containsOnlyFiniteNumbers)
  return true
}

const checks = { numRuns: 100 }

it('vitals normalizer and pure mutators preserve valid state for arbitrary numeric inputs', async () => {
  await fc.assert(
    fc.asyncProperty(hostileValue, async (value) => {
      const normalized = Vitals.normaliseVitals(value)
      expect(Vitals.isValidVitals(normalized)).toBe(true)
      expect(containsOnlyFiniteNumbers(normalized)).toBe(true)

      const operations = [
        invoke(Vitals.applyDamage, [Vitals.SPAWN_VITALS, { amount: value, cause: 'property-test' }]),
        invoke(Vitals.heal, [Vitals.SPAWN_VITALS, value]),
        invoke(Vitals.addExhaustion, [Vitals.SPAWN_VITALS, value]),
        invoke(Vitals.eat, [Vitals.SPAWN_VITALS, value, value]),
        invoke(Vitals.advanceFoodTimer, [Vitals.SPAWN_VITALS, value]),
        invoke(Vitals.addExperience, [Vitals.SPAWN_VITALS, value]),
      ]

      for (const operation of operations) {
        const state = Array.isArray(operation) ? operation[1] : operation
        expect(Vitals.isValidVitals(state)).toBe(true)
        expect(containsOnlyFiniteNumbers(state)).toBe(true)
      }

      const serviceResults = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* VitalsService.makeVitalsService()
          const snapshot = yield* Effect.result(service.snapshot)
          const view = yield* Effect.result(service.view)
          const damage = yield* Effect.result(invokeEffect(service.damage, [{ amount: value, cause: 'property-test' }]))
          const healed = yield* Effect.result(invokeEffect(service.heal, [value]))
          const exhausted = yield* Effect.result(invokeEffect(service.addExhaustion, [value]))
          const eaten = yield* Effect.result(invokeEffect(service.eat, [value, value]))
          const foodTick = yield* Effect.result(invokeEffect(service.advanceFoodTimer, [value]))
          const experience = yield* Effect.result(invokeEffect(service.addExperience, [value]))
          const restored = yield* Effect.result(service.restore(value))
          const respawned = yield* Effect.result(service.respawn)
          const reset = yield* Effect.result(service.reset)
          return {
            snapshot, view, damage, healed, exhausted, eaten, foodTick, experience,
            restored, respawned, reset, finalSnapshot: yield* Effect.result(service.snapshot),
          }
        }),
      )
      assertEffectOutcome('VitalsService.snapshot', () => serviceResults.snapshot, Vitals.VitalsSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.view', () => serviceResults.view, Vitals.VitalsViewSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.damage', () => serviceResults.damage, VitalsService.DamageOutcomeSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.heal', () => serviceResults.healed, Vitals.VitalsSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.addExhaustion', () => serviceResults.exhausted, VitalsService.VitalsServiceVoidSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.eat', () => serviceResults.eaten, VitalsService.VitalsServiceVoidSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.advanceFoodTimer', () => serviceResults.foodTick, Vitals.FoodTickSignalSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.addExperience', () => serviceResults.experience, Vitals.VitalsSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.restore', () => serviceResults.restored, VitalsService.VitalsServiceVoidSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.respawn', () => serviceResults.respawned, VitalsService.VitalsServiceVoidSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.reset', () => serviceResults.reset, VitalsService.VitalsServiceVoidSchema, VitalsService.VitalsServiceNoErrorSchema)
      assertEffectOutcome('VitalsService.snapshot after reset', () => serviceResults.finalSnapshot, Vitals.VitalsSchema, VitalsService.VitalsServiceNoErrorSchema)
      const finalSnapshot = Result.getOrThrow(serviceResults.finalSnapshot)
      expect(Vitals.isValidVitals(finalSnapshot)).toBe(true)
      expect(containsOnlyFiniteNumbers(finalSnapshot)).toBe(true)
    }),
    checks,
  )
})
