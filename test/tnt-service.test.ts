import { describe, expect, it } from '@effect/vitest'
import {
  DimensionRevisionSchema,
  EntityIdSchema,
  WorldIdSchema,
  WorldRevisionSchema,
  type DimensionRevision,
} from '@nerima-games/mc-kernel'
import { Effect, Layer, Result, Schema } from 'effect'
import {
  WorldCommitCoordinatorLayer,
  DimensionRevisionConflict,
  WorldRevisionConflict,
} from '../src/application/world-commit-coordinator.js'
import {
  INITIAL_TNT_SERVICE_SNAPSHOT,
  TntService,
  TntServiceFailure,
  TntServiceLayer,
  tntOwnerRegistration,
} from '../src/application/tnt-service.js'
import type { TntAdvanceRequest, TntServiceSnapshot } from '../src/application/tnt-service.js'
import { ReplicatedOwnerIdSchema } from '../src/application/replicated-state.js'

const ownerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('tnt-test')
const world = Schema.decodeUnknownSync(WorldIdSchema)('tnt-test-world')
const entity = Schema.decodeUnknownSync(EntityIdSchema)('primed-tnt-1')
const otherEntity = Schema.decodeUnknownSync(EntityIdSchema)('primed-tnt-2')
const revision = (value: number) => Schema.decodeUnknownSync(WorldRevisionSchema)(value)
const dimensionRevision = (value: number): DimensionRevision =>
  Schema.decodeUnknownSync(DimensionRevisionSchema)(value)

const blocks: NonNullable<TntAdvanceRequest['blocks']> = () => ({
  resistance: 0,
  destructible: true,
})

const advanceRequest = (
  expectedRevision: number,
  expectedDimensionRevision: number,
  deltaTimeSecs: number,
  id = entity,
  limits?: TntAdvanceRequest['limits'],
): TntAdvanceRequest => ({
  id,
  expectedRevision: revision(expectedRevision),
  expectedDimensionRevision: dimensionRevision(expectedDimensionRevision),
  deltaTimeSecs,
  radius: 4,
  seed: 17,
  blocks,
  entities: [],
  ...(limits === undefined ? {} : { limits }),
})

const layer = (initialState: TntServiceSnapshot = INITIAL_TNT_SERVICE_SNAPSHOT) =>
  TntServiceLayer(ownerId).pipe(
    Layer.provide(WorldCommitCoordinatorLayer({
      world,
      owners: [{
        ...tntOwnerRegistration(ownerId),
        initialState,
      }],
    })),
  )

describe('TntService', () => {
  it.effect('advances the fuse and returns a detonation candidate with the sim explosion plan', () =>
    Effect.gen(function* () {
      const tnt = yield* TntService
      const primed = yield* tnt.prime({
        id: entity,
        dimension: 'overworld',
        center: { x: 0, y: 0, z: 0 },
        fuseSecs: 4,
        expectedRevision: revision(0),
        expectedDimensionRevision: dimensionRevision(0),
      })
      expect(primed.revision).toBe(revision(1))
      yield* tnt.prime({
        id: otherEntity,
        dimension: 'overworld',
        center: { x: 4, y: 0, z: 0 },
        expectedRevision: revision(1),
        expectedDimensionRevision: dimensionRevision(1),
      })

      const advanced = yield* tnt.advance(advanceRequest(2, 2, 1))
      expect(advanced._tag).toBe('FuseAdvanced')
      if (advanced._tag !== 'FuseAdvanced') return
      expect(advanced.plan.after).toEqual({ kind: 'primed', remainingFuseSecs: 3 })
      expect(advanced.revision).toBe(revision(3))

      const pending = yield* tnt.advance(advanceRequest(3, 3, 16, entity, {
        maxAffectedEntities: 1024,
      }))
      expect(pending._tag).toBe('DetonationPlanned')
      if (pending._tag !== 'DetonationPlanned') return
      expect(pending.plan.after).toEqual({ kind: 'detonated' })
      expect(pending.plan.deferredSecs).toBe(6)
      expect(pending.explosion.destroyedBlocks.length).toBeGreaterThan(0)
      expect(pending.ownerCandidate).toEqual({
        ownerId,
        state: { tnts: [
          {
            id: entity,
            dimension: 'overworld',
            center: { x: 0, y: 0, z: 0 },
            state: { kind: 'detonated' },
          },
          {
            id: otherEntity,
            dimension: 'overworld',
            center: { x: 4, y: 0, z: 0 },
            state: { kind: 'primed', remainingFuseSecs: 4 },
          },
        ] },
      })
      expect((yield* tnt.snapshot).state.tnts[0]?.state).toEqual({
        kind: 'primed',
        remainingFuseSecs: 3,
      })
      expect((yield* tnt.snapshot).state.tnts[1]?.state).toEqual({
        kind: 'primed',
        remainingFuseSecs: 4,
      })
      expect((yield* tnt.snapshot).revision).toBe(revision(3))
    }).pipe(Effect.provide(layer())))

  it.effect('rejects duplicate and unknown TNT records without changing the owner', () =>
    Effect.gen(function* () {
      const tnt = yield* TntService
      yield* tnt.prime({
        id: entity,
        dimension: 'overworld',
        center: { x: 1, y: 2, z: 3 },
        expectedRevision: revision(0),
        expectedDimensionRevision: dimensionRevision(0),
      })

      const duplicate = yield* Effect.result(tnt.prime({
        id: entity,
        dimension: 'overworld',
        center: { x: 0, y: 0, z: 0 },
        expectedRevision: revision(1),
        expectedDimensionRevision: dimensionRevision(1),
      }))
      expect(Result.isFailure(duplicate)).toBe(true)
      if (Result.isFailure(duplicate)) expect(duplicate.failure).toBeInstanceOf(TntServiceFailure)

      const unknown = yield* Effect.result(tnt.advance(advanceRequest(1, 1, 1, otherEntity)))
      expect(Result.isFailure(unknown)).toBe(true)
      if (Result.isFailure(unknown)) expect(unknown.failure).toBeInstanceOf(TntServiceFailure)
      expect((yield* tnt.snapshot).state.tnts).toHaveLength(1)
      expect((yield* tnt.snapshot).revision).toBe(revision(1))
    }).pipe(Effect.provide(layer())))

  it.effect('rejects stale world and dimension revisions for fuse advancement', () =>
    Effect.gen(function* () {
      const tnt = yield* TntService
      yield* tnt.prime({
        id: entity,
        dimension: 'overworld',
        center: { x: 0, y: 0, z: 0 },
        expectedRevision: revision(0),
        expectedDimensionRevision: dimensionRevision(0),
      })

      const staleWorld = yield* Effect.result(tnt.advance(advanceRequest(0, 1, 1)))
      expect(Result.isFailure(staleWorld)).toBe(true)
      if (Result.isFailure(staleWorld)) expect(staleWorld.failure).toBeInstanceOf(WorldRevisionConflict)

      const staleDimension = yield* Effect.result(tnt.advance(advanceRequest(1, 0, 1)))
      expect(Result.isFailure(staleDimension)).toBe(true)
      if (Result.isFailure(staleDimension)) {
        expect(staleDimension.failure).toBeInstanceOf(DimensionRevisionConflict)
      }
      expect((yield* tnt.snapshot).state.tnts[0]?.state).toEqual({
        kind: 'primed',
        remainingFuseSecs: 4,
      })
      expect((yield* tnt.snapshot).revision).toBe(revision(1))
    }).pipe(Effect.provide(layer())))

  it.effect('rejects invalid fuse and explosion inputs without committing the TNT owner', () =>
    Effect.gen(function* () {
      const tnt = yield* TntService
      const invalidPrime = yield* Effect.result(tnt.prime({
        id: entity,
        dimension: 'overworld',
        center: { x: 0, y: 0, z: 0 },
        fuseSecs: -1,
        expectedRevision: revision(0),
        expectedDimensionRevision: dimensionRevision(0),
      }))
      expect(Result.isFailure(invalidPrime)).toBe(true)
      if (Result.isFailure(invalidPrime)) {
        expect(invalidPrime.failure).toMatchObject({ _tag: 'TntServiceFailure', reason: 'invalid-input' })
      }
      expect((yield* tnt.snapshot).state.tnts).toHaveLength(0)
      expect((yield* tnt.snapshot).revision).toBe(revision(0))

      yield* tnt.prime({
        id: entity,
        dimension: 'overworld',
        center: { x: 0, y: 0, z: 0 },
        fuseSecs: 4,
        expectedRevision: revision(0),
        expectedDimensionRevision: dimensionRevision(0),
      })
      const invalidAdvances = [
        advanceRequest(1, 1, -1),
        { ...advanceRequest(1, 1, 1), radius: -1 },
        { ...advanceRequest(1, 1, 1), radius: 65 },
        { ...advanceRequest(1, 1, 1), seed: Number.NaN },
      ]
      for (const request of invalidAdvances) {
        const result = yield* Effect.result(tnt.advance(request))
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toMatchObject({ _tag: 'TntServiceFailure', reason: 'invalid-input' })
        }
      }
      expect((yield* tnt.snapshot).state.tnts[0]?.state).toEqual({
        kind: 'primed',
        remainingFuseSecs: 4,
      })
      expect((yield* tnt.snapshot).revision).toBe(revision(1))
    }).pipe(Effect.provide(layer())))

  it.effect('returns already-detonated without committing another change', () =>
    Effect.gen(function* () {
      const tnt = yield* TntService
      const initialState: TntServiceSnapshot = {
        tnts: [{
          id: entity,
          dimension: 'overworld',
          center: { x: 0, y: 0, z: 0 },
          state: { kind: 'detonated' },
        }],
      }
      const result = yield* tnt.advance(advanceRequest(0, 0, 1))
      expect(result).toEqual({ _tag: 'AlreadyDetonated' })
      expect((yield* tnt.snapshot).state).toEqual(initialState)
      expect((yield* tnt.snapshot).revision).toBe(revision(0))
    }).pipe(Effect.provide(layer({
      tnts: [{
        id: entity,
        dimension: 'overworld',
        center: { x: 0, y: 0, z: 0 },
        state: { kind: 'detonated' },
      }],
    })))
  )
})
