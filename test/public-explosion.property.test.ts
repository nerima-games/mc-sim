import fc from 'fast-check'
import { PositionAxis, position } from '@nerima-games/mc-kernel'
import { it } from 'vitest'
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
    assertResultContract(Sim.validateExplosionRequest(request as never))
    assertResultContract(Sim.planExplosion(request as never))
  }), checks)
})
