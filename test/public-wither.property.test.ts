import fc from 'fast-check'
import { PositionAxis } from '@nerima-games/mc-kernel'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { hostileValue, invoke, unknownValue } from './public-property-helpers.js'

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

it('wither state APIs handle hostile envelopes without throwing', () => {
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
    invoke(Sim.createWither, [origin])
    invoke(Sim.stepWither, [state, 1, target])
    invoke(Sim.damageWither, [state, 2, 'melee'])
    invoke(Sim.restoreWither, [snapshot])

    const serialized = invoke(Sim.serializeWither, [state])
    expect(serialized).toMatchObject({ kind: 'wither', version: 1 })

    const projectile = invoke(Sim.witherSkullProjectile, [origin, target, variant])
    expect(projectile).toMatchObject({
      kind: 'wither_skull',
      variant: variant === 'blue' ? 'blue' : 'normal',
      destroysResistantBlocks: variant === 'blue',
    })

    invoke(Sim.matchWitherSummon, [base, blockAt])
  }), checks)
})

it('wither arithmetic handles hostile scalar envelopes without throwing', () => {
  const state = Sim.createWither({ x: PositionAxis(0), y: PositionAxis(0), z: PositionAxis(0) })

  fc.assert(fc.property(hostileValue, (value) => {
    invoke(Sim.stepWither, [state, value])
    invoke(Sim.damageWither, [state, value, 'melee'])
  }), checks)
})
