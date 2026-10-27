import fc from 'fast-check'
import { PositionAxis } from '@nerima-games/mc-kernel'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { finiteTree, hostileValue, isRecord, invoke, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 80, seed: 0x57495448 }

const malformedEnvelope = fc.oneof(
  fc.constantFrom<unknown>(null, undefined, false, 0, 'invalid', []),
  unknownValue,
)

const malformedState: fc.Arbitrary<unknown> = fc.oneof(
  malformedEnvelope,
  fc.record({
    phase: hostileValue,
    healthPoints: hostileValue,
    chargeRemainingSecs: hostileValue,
    feetPosition: malformedEnvelope,
    velocity: malformedEnvelope,
  }),
)

const isAxis = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && PositionAxis.is(value)

const isBrandedNumber = (value: unknown, brand: (candidate: number) => boolean): boolean =>
  typeof value === 'number' && brand(value)

const isPosition = (value: unknown): boolean =>
  isRecord(value) && isAxis(value['x']) && isAxis(value['y']) && isAxis(value['z'])

const isWitherState = (value: unknown): boolean =>
  isRecord(value) &&
  ['charging', 'airborne', 'armoured', 'dead'].includes(String(value['phase'])) &&
  isBrandedNumber(value['healthPoints'], Sim.WitherHealthPoints.is) &&
  isBrandedNumber(value['chargeRemainingSecs'], Sim.WitherChargeRemainingSecs.is) &&
  isPosition(value['feetPosition']) && isPosition(value['velocity']) && finiteTree(value)

const isTypedFailure = (value: unknown): boolean =>
  isRecord(value) && value['_tag'] === 'Failure' &&
  isRecord(value['failure']) && value['failure']['_tag'] === 'BrandError'

const assertResult = <A>(value: unknown, isSuccess: (success: unknown) => success is A): void => {
  expect(isRecord(value)).toBe(true)
  if (!isRecord(value)) return
  if (value['_tag'] === 'Failure') {
    expect(isTypedFailure(value)).toBe(true)
    return
  }
  expect(value['_tag']).toBe('Success')
  expect(isSuccess(value['success'])).toBe(true)
}

const isWitherStep = (value: unknown): value is Sim.WitherStep =>
  isRecord(value) && isWitherState(value['state']) &&
  (value['spawnExplosion'] === undefined || (
    isRecord(value['spawnExplosion']) && value['spawnExplosion']['power'] === 7 &&
    isPosition(value['spawnExplosion']['position'])
  ))

const isWitherDamage = (value: unknown): value is Sim.WitherDamageResult =>
  isRecord(value) && isWitherState(value['state']) &&
  typeof value['appliedDamage'] === 'number' && Sim.WitherDamageAmount.is(value['appliedDamage']) &&
  typeof value['ignored'] === 'boolean' && finiteTree(value)

it('wither state APIs return typed failures or repaired finite branded state for hostile envelopes', () => {
  const positionInput = malformedEnvelope
  const snapshotInput = fc.oneof(
    malformedEnvelope,
    fc.record({ kind: hostileValue, version: hostileValue, state: malformedState }),
  )
  const cellInput = fc.oneof(
    malformedEnvelope,
    fc.record({ x: hostileValue, y: hostileValue, z: hostileValue }),
  )
  const callbackInput = fc.oneof(
    hostileValue,
    fc.constant<unknown>(() => undefined),
  )

  fc.assert(fc.property(fc.tuple(
    malformedState,
    positionInput,
    snapshotInput,
    cellInput,
    callbackInput,
    malformedEnvelope,
    hostileValue,
  ), ([state, target, snapshot, base, blockAt, origin, variant]) => {
    const created = invoke(Sim.createWither, [origin])
    expect(isWitherState(created)).toBe(true)

    assertResult(invoke(Sim.stepWither, [state, 1, target]), isWitherStep)
    assertResult(invoke(Sim.damageWither, [state, 2, 'melee']), isWitherDamage)

    const restored = invoke(Sim.restoreWither, [snapshot])
    expect(isWitherState(restored)).toBe(true)

    const serialized = invoke(Sim.serializeWither, [state])
    expect(isRecord(serialized)).toBe(true)
    if (isRecord(serialized)) {
      expect(serialized['kind']).toBe('wither')
      expect(serialized['version']).toBe(1)
      expect(isWitherState(serialized['state'])).toBe(true)
    }

    const projectile = invoke(Sim.witherSkullProjectile, [origin, target, variant])
    expect(isRecord(projectile)).toBe(true)
    if (isRecord(projectile)) {
      expect(projectile['kind']).toBe('wither_skull')
      expect(['normal', 'blue']).toContain(projectile['variant'])
      expect(isPosition(projectile['origin'])).toBe(true)
      expect(isPosition(projectile['direction'])).toBe(true)
      expect(isBrandedNumber(projectile['speed'], Sim.WitherProjectileSpeed.is)).toBe(true)
      expect(isBrandedNumber(projectile['explosivePower'], Sim.WitherExplosionPower.is)).toBe(true)
      expect(typeof projectile['destroysResistantBlocks']).toBe('boolean')
    }

    assertResult(invoke(Sim.matchWitherSummon, [base, blockAt]), (success): success is unknown =>
      success === undefined || (
        isRecord(success) && (success['axis'] === 'x' || success['axis'] === 'z') &&
        isPosition(success['spawnPosition']) && Array.isArray(success['consumedBlocks']) &&
        success['consumedBlocks'].every(isRecord)
      ),
    )
  }), checks)
})

it('wither arithmetic rejects malformed scalar envelopes with typed failures', () => {
  const state = Sim.createWither({ x: PositionAxis(0), y: PositionAxis(0), z: PositionAxis(0) })

  fc.assert(fc.property(hostileValue, (value) => {
    assertResult(invoke(Sim.stepWither, [state, value]), isWitherStep)
    assertResult(invoke(Sim.damageWither, [state, value, 'melee']), isWitherDamage)
  }), checks)
})
