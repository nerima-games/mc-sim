import fc from 'fast-check'
import { Effect, Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import { WorldIdSchema } from '@nerima-games/mc-kernel'
import * as Sim from '../src/index.js'
import { makeCoreTick, makeCoreTickErrorSchema } from '../src/application/core.js'
import { makeWorldCommitCoordinator } from '../src/application/world-commit-coordinator.js'
import { assertEffectOutcome, invokeEffect } from './public-property-helpers.js'

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
      assertEffectOutcome(
        'makeCoreTick malformed options',
        () => outcome,
        Schema.Never,
        makeCoreTickErrorSchema(Schema.Never),
      )
      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) expect(outcome.failure._tag).toBe('CoreTickInvalidOptions')
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
      assertEffectOutcome(
        'makeWorldCommitCoordinator malformed options',
        () => outcome,
        Schema.Never,
        Sim.WorldCommitCoordinatorErrorSchema,
      )
      expect(Result.isFailure(outcome)).toBe(true)
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
  assertEffectOutcome(
    'makeWorldCommitCoordinator invalid owner schema',
    () => invalidOwner,
    Schema.Never,
    Sim.WorldCommitCoordinatorErrorSchema,
  )
  expect(Result.isFailure(invalidOwner)).toBe(true)
  if (Result.isFailure(invalidOwner)) {
    expect(invalidOwner.failure._tag).toBe('WorldCommitCoordinatorInvalidOptions')
  }
})

it('save coordinator constructor returns a typed failure for a null options envelope', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constant(null), async (options) => {
      const outcome = await Effect.runPromise(
        Effect.result(invokeEffect(Sim.makeSaveCoordinator, [options])),
      )
      assertEffectOutcome(
        'makeSaveCoordinator null options',
        () => outcome,
        Schema.Never,
        Sim.BrandErrorSchema,
      )
      expect(Result.isFailure(outcome)).toBe(true)
    }),
    { numRuns: 100 },
  )
})
