import fc from 'fast-check'
import { Schema } from 'effect'
import { EntityIdSchema, PositionAxis, position } from '@nerima-games/mc-kernel'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { assertResultContract, hostileNumber } from './public-property-helpers.js'

const checks = { numRuns: 30, seed: 0x4558504c }

const makePosition = (x: number, y: number, z: number) =>
  position(PositionAxis(x), PositionAxis(y), PositionAxis(z))

it('explosion block resistance and limits remain typed and finite for hostile numbers', () => {
  const input = fc.record({
    resistance: hostileNumber,
    maxVisitedBlocks: hostileNumber,
    seed: hostileNumber,
  })

  fc.assert(fc.property(input, (value) => {
    const request = {
      center: makePosition(0.5, 0.5, 0.5),
      radius: 1,
      seed: value.seed,
      blocks: () => ({ resistance: value.resistance, destructible: false }),
      entities: [],
      limits: { maxVisitedBlocks: value.maxVisitedBlocks },
    }
    assertResultContract('validateExplosionRequest', () => Sim.validateExplosionRequest(request as never), Schema.Void, Sim.ExplosionValidationFailureSchema)
    assertResultContract('planExplosion', () => Sim.planExplosion(request as never), Sim.ExplosionPlanSchema, Sim.ExplosionValidationFailureSchema)
  }), checks)
})

it('ExplosionPlanSchema rejects unsafe block coordinates and invalid entity effects', () => {
  const plan = {
    center: makePosition(0, 0, 0),
    radius: 1,
    seed: 1,
    destroyedBlocks: [{ x: 0, y: 1, z: 2 }],
    entityEffects: [{
      id: Schema.decodeUnknownSync(EntityIdSchema)('explosion-schema-test'),
      damage: 2,
      knockback: makePosition(0, 1, 0),
      exposure: 0.5,
    }],
    visitedBlocks: 1,
    limits: Sim.DEFAULT_EXPLOSION_LIMITS,
    truncated: false,
  }

  expect(Schema.is(Sim.ExplosionPlanSchema)(plan)).toBe(true)
  expect(Schema.is(Sim.ExplosionPlanSchema)({
    ...plan,
    destroyedBlocks: [{ x: 0.5, y: 1, z: 2 }],
  })).toBe(false)
  expect(Schema.is(Sim.ExplosionPlanSchema)({
    ...plan,
    entityEffects: [{ ...plan.entityEffects[0], damage: -1 }],
  })).toBe(false)
  expect(Schema.is(Sim.ExplosionPlanSchema)({
    ...plan,
    entityEffects: [{ ...plan.entityEffects[0], exposure: -0.1 }],
  })).toBe(false)
  expect(Schema.is(Sim.ExplosionPlanSchema)({
    ...plan,
    entityEffects: [{ ...plan.entityEffects[0], exposure: 1.1 }],
  })).toBe(false)
})
