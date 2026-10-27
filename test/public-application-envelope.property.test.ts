import fc from 'fast-check'
import { Effect, Schema } from 'effect'
import { expect, it } from 'vitest'
import { WorldIdSchema } from '@nerima-games/mc-kernel'
import * as Sim from '../src/index.js'
import { makeCoreTick } from '../src/application/core.js'
import { makeWorldCommitCoordinator } from '../src/application/world-commit-coordinator.js'
import { invokeEffect } from './public-property-helpers.js'

const malformedEnvelope: fc.Arbitrary<unknown> = fc.constantFrom(
  null,
  undefined,
  false,
  0,
  'invalid',
  [],
  {},
)

it('core tick constructor returns a typed failure for malformed options envelopes', async () => {
  await fc.assert(
    fc.asyncProperty(malformedEnvelope, async (options) => {
      const outcome = await Effect.runPromise(
        Effect.result(invokeEffect(makeCoreTick, [options])),
      )
      expect(outcome._tag).toBe('Failure')
      if (outcome._tag === 'Failure') expect(outcome.failure._tag).toBe('CoreTickInvalidOptions')
    }),
    { numRuns: 100 },
  )
})

it('world commit coordinator constructor returns typed failures for malformed option envelopes', async () => {
  await fc.assert(
    fc.asyncProperty(malformedEnvelope, async (options) => {
      const outcome = await Effect.runPromise(
        Effect.result(invokeEffect(makeWorldCommitCoordinator, [options])),
      )
      expect(outcome._tag).toBe('Failure')
    }),
    { numRuns: 100 },
  )

  const world = Schema.decodeUnknownSync(WorldIdSchema)('invalid-owner-schema-world')
  const invalidOwner = await Effect.runPromise(Effect.result(
    makeWorldCommitCoordinator({
      world,
      owners: [{ ownerId: Sim.makeReplicatedOwnerId('invalid-owner-schema'), schema: null as never, initialState: {} }],
    }),
  ))
  expect(invalidOwner._tag).toBe('Failure')
  if (invalidOwner._tag === 'Failure') {
    expect(invalidOwner.failure._tag).toBe('WorldCommitCoordinatorInvalidOptions')
  }
})

it('save coordinator constructor returns a typed failure for a null options envelope', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constant(null), async (options) => {
      const outcome = await Effect.runPromise(
        Effect.result(invokeEffect(Sim.makeSaveCoordinator, [options])),
      )
      expect(outcome._tag).toBe('Failure')
    }),
    { numRuns: 100 },
  )
})
