import fc from 'fast-check'
import { it } from 'vitest'
import { PositionAxis, position } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import * as Wither from '../src/domain/wither.js'
import { assertResultContract, hostileValue, invoke } from './public-property-helpers.js'

const checks = { numRuns: 100 }

it('wither stepping and damage decode every Result branch for arbitrary scalar inputs', () => {
  const initial = Wither.createWither(position(PositionAxis(0), PositionAxis(64), PositionAxis(0)))
  fc.assert(
    fc.property(hostileValue, (value) => {
      const stepped = invoke(Wither.stepWither, [initial, value]) as Result.Result<unknown, unknown>
      assertResultContract('Wither.stepWither', () => stepped, Wither.WitherStepSchema, Wither.WitherStepFailureSchema)

      const damaged = invoke(Wither.damageWither, [initial, value, 'melee']) as Result.Result<unknown, unknown>
      assertResultContract(
        'Wither.damageWither',
        () => damaged,
        Wither.WitherDamageResultSchema,
        Wither.WitherStepFailureSchema,
      )
    }),
    checks,
  )
})
