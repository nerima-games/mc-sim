import { describe, expect, it } from '@effect/vitest'
import { Brand, Cause, Deferred, Effect, Exit, Fiber, Schema, SchemaGetter } from 'effect'
import {
  DimensionRevisionSchema,
  WorldIdSchema,
  WorldRevisionSchema,
} from '@nerima-games/mc-kernel'
import type { ReplicatedOwnerId } from '../src/application/replicated-state'
import {
  replicatedOwnerChangeSchema,
  replicatedSnapshotSchema,
  replicatedWorldDeltaSchema,
} from '../src/application/replicated-state'
import {
  DimensionRevisionConflict,
  makeWorldCommitCoordinator,
  ReplicatedOwnerDuplicate,
  ReplicatedOwnerUnknown,
  WorldRevisionConflict,
  WorldCommitCoordinator,
  WorldCommitCoordinatorLayer,
} from '../src/application/world-commit-coordinator'

const makeOwnerId = Brand.nominal<ReplicatedOwnerId>()
const ownerA = makeOwnerId('owner-a')
const ownerB = makeOwnerId('owner-b')
const unknownOwner = makeOwnerId('unknown-owner')

describe('replicated state schemas', () => {
  it('builds typed snapshot, owner-change, and world-delta codecs', () => {
    const stateSchema = Schema.Struct({ enabled: Schema.Boolean })
    const ownerChangeSchema = replicatedOwnerChangeSchema('owner-a', stateSchema)
    const snapshot = Schema.decodeUnknownResult(replicatedSnapshotSchema(stateSchema))({
      world: 'world-a',
      revision: 3,
      state: { enabled: true },
    })
    const ownerChange = Schema.decodeUnknownResult(ownerChangeSchema)({
      owner: 'owner-a',
      state: { enabled: false },
    })
    const delta = Schema.decodeUnknownResult(replicatedWorldDeltaSchema(ownerChangeSchema))({
      world: 'world-a',
      revision: 4,
      changes: [{ owner: 'owner-a', state: { enabled: true } }],
    })

    expect(snapshot._tag).toBe('Success')
    expect(ownerChange._tag).toBe('Success')
    expect(Schema.decodeUnknownResult(ownerChangeSchema)({
      owner: 'owner-b',
      state: { enabled: false },
    })._tag).toBe('Failure')
    expect(delta._tag).toBe('Success')
    if (delta._tag === 'Success') expect(delta.success.changes).toHaveLength(1)
  })
})

describe('WorldCommitCoordinator', () => {
  it.effect('provides the coordinator layer and starts unregistered dimensions at revision zero', () =>
    Effect.gen(function* () {
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const dimensionRevisionZero = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(0)
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const coordinator = yield* WorldCommitCoordinator
      const absentDimension = yield* coordinator.dimensionRevision('end')
      const unknownSnapshot = yield* Effect.result(coordinator.snapshot(unknownOwner, counterSchema))
      const delta = yield* coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'end', expectedRevision: dimensionRevisionZero }],
        changes: [{ ownerId: ownerA, state: { count: 1 } }],
      })

      expect(absentDimension).toBe(0)
      expect(unknownSnapshot._tag).toBe('Failure')
      if (unknownSnapshot._tag === 'Failure') expect(unknownSnapshot.failure).toBeInstanceOf(ReplicatedOwnerUnknown)
      expect(delta.revision).toBe(1)
      expect(yield* coordinator.dimensionRevision('end')).toBe(1)
    }).pipe(Effect.provide(WorldCommitCoordinatorLayer({
      world: Schema.decodeUnknownSync(WorldIdSchema)('world-a'),
      dimensions: [],
      owners: [{ ownerId: ownerA, schema: Schema.Struct({ count: Schema.Int }), initialState: { count: 0 } }],
    }))),
  )

  it.effect('publishes all owner candidates at one world revision and advances each dimension once', () =>
    Effect.gen(function* () {
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('world-a')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const dimensionRevisionZero = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(0)
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const flagSchema = Schema.Struct({ enabled: Schema.Boolean })
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [
          { ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } },
          { ownerId: ownerB, schema: flagSchema, initialState: { enabled: false } },
        ],
      })

      const delta = yield* coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [
          { dimension: 'overworld', expectedRevision: dimensionRevisionZero },
          { dimension: 'nether', expectedRevision: dimensionRevisionZero },
          { dimension: 'overworld', expectedRevision: dimensionRevisionZero },
        ],
        changes: [
          { ownerId: ownerA, state: { count: 1 } },
          { ownerId: ownerB, state: { enabled: true } },
        ],
      })

      expect(delta.revision).toBe(1)
      expect(delta.changes.map(({ owner }) => owner)).toStrictEqual([ownerA, ownerB])
      expect(yield* coordinator.revision).toBe(1)
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(1)
      expect(yield* coordinator.dimensionRevision('nether')).toBe(1)
      expect(yield* coordinator.dimensionRevision('end')).toBe(0)

      const player = yield* coordinator.snapshot(ownerA, counterSchema)
      const inventory = yield* coordinator.snapshot(ownerB, flagSchema)
      expect(player).toStrictEqual({ world, revision: delta.revision, state: { count: 1 } })
      expect(inventory).toStrictEqual({ world, revision: delta.revision, state: { enabled: true } })
    }),
  )

  it.effect('a decode failure in one owner candidate leaves every owner and revision unchanged', () =>
    Effect.gen(function* () {
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('world-a')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const dimensionRevisionZero = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(0)
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const flagSchema = Schema.Struct({ enabled: Schema.Boolean })
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [
          { ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } },
          { ownerId: ownerB, schema: flagSchema, initialState: { enabled: false } },
        ],
      })

      const outcome = yield* Effect.result(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
        changes: [
          { ownerId: ownerA, state: { count: 8 } },
          { ownerId: ownerB, state: { enabled: 'invalid' } },
        ],
      }))

      expect(outcome._tag).toBe('Failure')
      expect(yield* coordinator.revision).toBe(0)
      expect((yield* coordinator.snapshot(ownerA, counterSchema)).state).toStrictEqual({ count: 0 })
      expect((yield* coordinator.snapshot(ownerB, flagSchema)).state).toStrictEqual({ enabled: false })
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(0)
    }),
  )

  it.effect('an encode failure in one owner candidate leaves earlier candidates unpublished', () =>
    Effect.gen(function* () {
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('world-a')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const dimensionRevisionZero = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(0)
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const nonNegativeInt: Schema.Int = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
      const encodeGuardedInt = Schema.decodeTo<Schema.Int, Schema.Int>(Schema.Int, {
        decode: SchemaGetter.transform<number, number>((value) => value),
        encode: SchemaGetter.transform<number, number>((value) => value === 0 ? 0 : -1),
      })(nonNegativeInt)
      const guardedSchema = Schema.Struct({ count: encodeGuardedInt })
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [
          { ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } },
          { ownerId: ownerB, schema: guardedSchema, initialState: { count: 0 } },
        ],
      })

      const outcome = yield* Effect.result(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
        changes: [
          { ownerId: ownerA, state: { count: 7 } },
          { ownerId: ownerB, state: { count: 1 } },
        ],
      }))

      expect(outcome._tag).toBe('Failure')
      expect(yield* coordinator.revision).toBe(0)
      expect((yield* coordinator.snapshot(ownerA, counterSchema)).state).toStrictEqual({ count: 0 })
      expect((yield* coordinator.snapshot(ownerB, guardedSchema)).state).toStrictEqual({ count: 0 })
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(0)
    }),
  )

  it.effect('interrupting preflight leaves owner state, revisions, and the returned delta unchanged', () =>
    Effect.gen(function* () {
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('world-a')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const dimensionRevisionZero = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(0)
      const decodeStarted = yield* Deferred.make<void>()
      const releaseDecode = yield* Deferred.make<void>()
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const gatedCount = Schema.Int.pipe(Schema.decode({
        decode: SchemaGetter.transformEffect((value: number) => value === 1
          ? Effect.andThen(
              Deferred.succeed(decodeStarted, undefined),
              Effect.map(Deferred.await(releaseDecode), () => value),
            )
          : Effect.succeed(value)),
        encode: SchemaGetter.passthrough(),
      }))
      const gatedSchema = Schema.Struct({ count: gatedCount })
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [
          { ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } },
          { ownerId: ownerB, schema: gatedSchema, initialState: { count: 0 } },
        ],
      })

      const fiber = yield* Effect.forkChild(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionZero }],
        changes: [
          { ownerId: ownerA, state: { count: 5 } },
          { ownerId: ownerB, state: { count: 1 } },
        ],
      }))
      yield* Deferred.await(decodeStarted)
      yield* Fiber.interrupt(fiber)
      const exit = yield* Fiber.await(fiber)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(yield* coordinator.revision).toBe(0)
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(0)
      expect((yield* coordinator.snapshot(ownerA, counterSchema)).state).toStrictEqual({ count: 0 })
      expect((yield* coordinator.snapshot(ownerB, gatedSchema)).state).toStrictEqual({ count: 0 })
    }),
  )

  it.effect('returns the three contract conflicts without publishing a candidate', () =>
    Effect.gen(function* () {
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('world-a')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const revisionOne = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(1)
      const dimensionRevisionOne = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(1)
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
      })
      const candidate = { ownerId: ownerA, state: { count: 1 } }

      const invalidRevision = yield* Effect.result(coordinator.commit({
        expectedRevision: Brand.nominal<typeof revisionZero>()(0.5),
        expectedDimensions: [],
        changes: [candidate],
      }))
      const worldConflict = yield* Effect.result(coordinator.commit({
        expectedRevision: revisionOne,
        expectedDimensions: [],
        changes: [candidate],
      }))
      const dimensionConflict = yield* Effect.result(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevisionOne }],
        changes: [candidate],
      }))
      const ownerConflict = yield* Effect.result(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [],
        changes: [{ ownerId: unknownOwner, state: { count: 1 } }],
      }))

      expect(invalidRevision._tag).toBe('Failure')
      if (invalidRevision._tag === 'Failure') expect(invalidRevision.failure._tag).toBe('SchemaError')
      expect(worldConflict._tag).toBe('Failure')
      if (worldConflict._tag === 'Failure') expect(worldConflict.failure).toBeInstanceOf(WorldRevisionConflict)
      expect(dimensionConflict._tag).toBe('Failure')
      if (dimensionConflict._tag === 'Failure') expect(dimensionConflict.failure).toBeInstanceOf(DimensionRevisionConflict)
      expect(ownerConflict._tag).toBe('Failure')
      if (ownerConflict._tag === 'Failure') expect(ownerConflict.failure).toBeInstanceOf(ReplicatedOwnerUnknown)
      expect(yield* coordinator.revision).toBe(0)
      expect((yield* coordinator.snapshot(ownerA, counterSchema)).state).toStrictEqual({ count: 0 })
    }),
  )

  it.effect('rejects duplicate owner registrations and duplicate owners in a group', () =>
    Effect.gen(function* () {
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('world-a')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const counterSchema = Schema.Struct({ count: Schema.Int })
      const duplicateRegistration = yield* Effect.result(makeWorldCommitCoordinator({
        world,
        owners: [
          { ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } },
          { ownerId: ownerA, schema: counterSchema, initialState: { count: 1 } },
        ],
      }))
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [{ ownerId: ownerA, schema: counterSchema, initialState: { count: 0 } }],
      })
      const duplicateChange = yield* Effect.result(coordinator.commit({
        expectedRevision: revisionZero,
        expectedDimensions: [],
        changes: [
          { ownerId: ownerA, state: { count: 1 } },
          { ownerId: ownerA, state: { count: 2 } },
        ],
      }))

      expect(duplicateRegistration._tag).toBe('Failure')
      if (duplicateRegistration._tag === 'Failure') expect(duplicateRegistration.failure).toBeInstanceOf(ReplicatedOwnerDuplicate)
      expect(duplicateChange._tag).toBe('Failure')
      if (duplicateChange._tag === 'Failure') expect(duplicateChange.failure).toBeInstanceOf(ReplicatedOwnerDuplicate)
      expect(yield* coordinator.revision).toBe(0)
    }),
  )
})
