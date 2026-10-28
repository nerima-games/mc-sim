import { describe, expect, it } from '@effect/vitest'
import * as fc from 'fast-check'
import {
  AIR_BLOCK_ID,
  BlockIdSchema,
  BlockPositionSchema,
  chunkCoord,
  ChunkAxis,
  DimensionRevisionSchema,
  EntityIdSchema,
  WorldIdSchema,
  WorldRevisionSchema,
  type DimensionRevision,
} from '@nerima-games/mc-kernel'
import {
  CHUNK_HEIGHT,
  CHUNK_SIZE_XZ,
  ChunkCapacity,
  ChunkStoreRegistry,
  ChunkStoreRegistryLayer,
  type ChunkSource,
} from '@nerima-games/mc-worldgen'
import { Effect, Layer, Result, Schema } from 'effect'
import {
  makeWorldCommitCoordinator,
  WorldCommitCoordinator,
  WorldCommitCoordinatorLayer,
  DimensionRevisionConflict,
  WorldRevisionConflict,
} from '../src/application/world-commit-coordinator.js'
import {
  INITIAL_TNT_SERVICE_SNAPSHOT,
  makeTntService,
  TntService,
  TntAdvanceOutcomeSchema,
  TntDetonationCommitOutcomeSchema,
  TntPrimeOutcomeSchema,
  TntServiceErrorSchema,
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
const affectedEntityOwnerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('tnt-affected-entity')
const solidBlock = Schema.decodeUnknownSync(BlockIdSchema)(23)
const revision = (value: number) => Schema.decodeUnknownSync(WorldRevisionSchema)(value)
const dimensionRevision = (value: number): DimensionRevision =>
  Schema.decodeUnknownSync(DimensionRevisionSchema)(value)
const blockPosition = (x: number, y: number, z: number) =>
  Schema.decodeUnknownSync(BlockPositionSchema)({ x, y, z })

const blocks: NonNullable<TntAdvanceRequest['blocks']> = () => ({
  resistance: 0,
  destructible: true,
})

const chunkSource: ChunkSource = (coord) => Effect.succeed({
  blocks: new Uint16Array(CHUNK_SIZE_XZ * CHUNK_SIZE_XZ * CHUNK_HEIGHT),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS' as const),
  coord,
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

const transactionalFixture = () => Effect.gen(function* () {
  const chunkStores = yield* ChunkStoreRegistry
  const overworld = chunkStores.forDimension('overworld')
  yield* overworld.load(chunkCoord(ChunkAxis(0), ChunkAxis(0)))
  const coordinator = yield* makeWorldCommitCoordinator({
    world,
    chunkStores,
    owners: [
      tntOwnerRegistration(ownerId),
      {
        ownerId: affectedEntityOwnerId,
        schema: Schema.Struct({ health: Schema.Int }),
        initialState: { health: 20 },
      },
    ],
  })
  const tnt = yield* makeTntService(ownerId).pipe(
    Effect.provideService(WorldCommitCoordinator, coordinator),
  )
  return { coordinator, overworld, tnt }
}).pipe(Effect.provide(ChunkStoreRegistryLayer(() => chunkSource, ChunkCapacity(4))))

describe('TntService', () => {
  it('preserves every unrelated TNT record when committing a planned detonation', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 4 }), async (otherFuses) => {
        const { coordinator, tnt } = await Effect.runPromise(transactionalFixture())
        await Effect.runPromise(tnt.prime({
          id: entity,
          dimension: 'overworld',
          center: { x: 8, y: 64, z: 8 },
          fuseSecs: 1,
          expectedRevision: revision(0),
          expectedDimensionRevision: dimensionRevision(0),
        }))

        await Effect.runPromise(Effect.gen(function* () {
          for (const [index, fuseSecs] of otherFuses.entries()) {
            const expectedRevision = yield* coordinator.revision
            const expectedDimensionRevision = yield* coordinator.dimensionRevision('overworld')
            yield* tnt.prime({
              id: Schema.decodeUnknownSync(EntityIdSchema)(`property-other-${index}`),
              dimension: 'overworld',
              center: { x: index + 20, y: 64, z: 0 },
              fuseSecs,
              expectedRevision,
              expectedDimensionRevision,
            })
          }
        }))

        const before = await Effect.runPromise(tnt.snapshot)
        const expectedRevision = await Effect.runPromise(coordinator.revision)
        const expectedDimensionRevision = await Effect.runPromise(coordinator.dimensionRevision('overworld'))
        const planned = await Effect.runPromise(tnt.advance({
          ...advanceRequest(expectedRevision, expectedDimensionRevision, 1),
          radius: 1,
        }))
        expect(Schema.decodeUnknownSync(TntAdvanceOutcomeSchema)(planned)).toEqual(planned)
        expect(planned._tag).toBe('DetonationPlanned')
        if (planned._tag !== 'DetonationPlanned') return
        const targetBefore = before.state.tnts.find(({ id }) => id === planned.id)
        expect(targetBefore).toBeDefined()
        if (targetBefore === undefined) return

        const forgedRequest = {
          id: planned.id,
          planRevision: planned.planRevision,
          ownerCandidate: {
            ownerId,
            state: {
              tnts: [{ ...targetBefore, state: { kind: 'detonated' } }],
            },
          },
        } as unknown as Parameters<typeof tnt.commitDetonation>[0]
        const result = await Effect.runPromise(Effect.result(tnt.commitDetonation(forgedRequest)))
        const decoded = Schema.decodeUnknownSync(
          Schema.Result(TntDetonationCommitOutcomeSchema, TntServiceErrorSchema),
        )(result)
        expect(decoded).toEqual(result)
        expect(Result.isSuccess(decoded), JSON.stringify(decoded)).toBe(true)
        if (Result.isFailure(decoded)) return

        const after = await Effect.runPromise(tnt.snapshot)
        expect(after.state.tnts.filter(({ id }) => id !== planned.id))
          .toEqual(before.state.tnts.filter(({ id }) => id !== planned.id))
        expect(after.state.tnts).toHaveLength(before.state.tnts.length)
        expect(after.state.tnts.find(({ id }) => id === planned.id)?.state).toEqual({ kind: 'detonated' })
      }),
      { numRuns: 12 },
    )
  })

  it.effect('advances the fuse and returns a detonation plan without committing terminal state', () =>
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
      expect(Schema.decodeUnknownSync(TntPrimeOutcomeSchema)(primed)).toEqual(primed)
      expect(primed.revision).toBe(revision(1))
      yield* tnt.prime({
        id: otherEntity,
        dimension: 'overworld',
        center: { x: 4, y: 0, z: 0 },
        expectedRevision: revision(1),
        expectedDimensionRevision: dimensionRevision(1),
      })

      const advanced = yield* tnt.advance(advanceRequest(2, 2, 1))
      expect(Schema.decodeUnknownSync(TntAdvanceOutcomeSchema)(advanced)).toEqual(advanced)
      expect(advanced._tag).toBe('FuseAdvanced')
      if (advanced._tag !== 'FuseAdvanced') return
      expect(advanced.plan.after).toEqual({ kind: 'primed', remainingFuseSecs: 3 })
      expect(advanced.revision).toBe(revision(3))

      const pending = yield* tnt.advance(advanceRequest(3, 3, 16, entity, {
        maxAffectedEntities: 1024,
      }))
      expect(Schema.decodeUnknownSync(TntAdvanceOutcomeSchema)(pending)).toEqual(pending)
      expect(pending._tag).toBe('DetonationPlanned')
      if (pending._tag !== 'DetonationPlanned') return
      expect(pending.plan.after).toEqual({ kind: 'detonated' })
      expect(pending.plan.deferredSecs).toBe(6)
      expect(pending.explosion.destroyedBlocks.length).toBeGreaterThan(0)
      expect(pending.planRevision).toBeGreaterThan(0)
      expect(Number.isSafeInteger(pending.planRevision)).toBe(true)
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
      expect(Schema.decodeUnknownSync(Schema.Result(TntPrimeOutcomeSchema, TntServiceErrorSchema))(duplicate))
        .toMatchObject({ _tag: 'Failure', failure: { _tag: 'TntServiceFailure', reason: 'tnt-already-primed' } })
      expect(Result.isFailure(duplicate)).toBe(true)
      if (Result.isFailure(duplicate)) expect(duplicate.failure).toBeInstanceOf(TntServiceFailure)

      const unknown = yield* Effect.result(tnt.advance(advanceRequest(1, 1, 1, otherEntity)))
      expect(Schema.decodeUnknownSync(Schema.Result(TntAdvanceOutcomeSchema, TntServiceErrorSchema))(unknown))
        .toMatchObject({ _tag: 'Failure', failure: { _tag: 'TntServiceFailure', reason: 'unknown-tnt' } })
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
      expect(Schema.decodeUnknownSync(Schema.Result(TntAdvanceOutcomeSchema, TntServiceErrorSchema))(staleWorld))
        .toEqual(staleWorld)
      expect(Result.isFailure(staleWorld)).toBe(true)
      if (Result.isFailure(staleWorld)) expect(staleWorld.failure).toBeInstanceOf(WorldRevisionConflict)

      const staleDimension = yield* Effect.result(tnt.advance(advanceRequest(1, 0, 1)))
      expect(Schema.decodeUnknownSync(Schema.Result(TntAdvanceOutcomeSchema, TntServiceErrorSchema))(staleDimension))
        .toEqual(staleDimension)
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
      expect(Schema.decodeUnknownSync(Schema.Result(TntPrimeOutcomeSchema, TntServiceErrorSchema))(invalidPrime))
        .toMatchObject({ _tag: 'Failure', failure: { _tag: 'TntServiceFailure', reason: 'invalid-input' } })
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
        expect(Schema.decodeUnknownSync(Schema.Result(TntAdvanceOutcomeSchema, TntServiceErrorSchema))(result))
          .toMatchObject({ _tag: 'Failure', failure: { _tag: 'TntServiceFailure', reason: 'invalid-input' } })
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
      expect(Schema.decodeUnknownSync(TntAdvanceOutcomeSchema)(result)).toEqual(result)
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

  it.effect('commits terminal TNT, destroyed blocks, and affected entity state once', () =>
    Effect.flatMap(transactionalFixture(), ({ coordinator, overworld, tnt }) =>
      Effect.gen(function* () {
        yield* tnt.prime({
          id: entity,
          dimension: 'overworld',
          center: { x: 8, y: 64, z: 8 },
          fuseSecs: 1,
          expectedRevision: revision(0),
          expectedDimensionRevision: dimensionRevision(0),
        })
        const planned = yield* tnt.advance(advanceRequest(1, 1, 1))
        expect(Schema.decodeUnknownSync(TntAdvanceOutcomeSchema)(planned)).toEqual(planned)
        expect(planned._tag).toBe('DetonationPlanned')
        if (planned._tag !== 'DetonationPlanned') return
        expect(planned.explosion.destroyedBlocks.length).toBeGreaterThan(0)
        for (const cell of planned.explosion.destroyedBlocks) {
          yield* overworld.setBlock(blockPosition(cell.x, cell.y, cell.z), solidBlock)
        }

        const revisionBefore = yield* coordinator.revision
        const dimensionBefore = yield* coordinator.dimensionRevision('overworld')
        const tntBefore = yield* tnt.snapshot
        const entityBefore = yield* coordinator.snapshot(affectedEntityOwnerId, Schema.Struct({ health: Schema.Int }))
        const committed = yield* Effect.result(tnt.commitDetonation({ id: planned.id, planRevision: planned.planRevision }, [{
          ownerId: affectedEntityOwnerId,
          state: { health: 8 },
        }]))
        const decoded = Schema.decodeUnknownSync(
          Schema.Result(TntDetonationCommitOutcomeSchema, TntServiceErrorSchema),
        )(committed)

        expect(decoded).toEqual(committed)
        expect(Result.isSuccess(decoded)).toBe(true)
        if (Result.isSuccess(decoded)) expect(decoded.success.revision).toBe(revisionBefore + 1)
        expect(yield* coordinator.revision).toBe(revisionBefore + 1)
        expect(yield* coordinator.dimensionRevision('overworld')).toBe(dimensionBefore + 1)
        const terminalTnt = yield* tnt.snapshot
        expect(terminalTnt.revision).toBe(revisionBefore + 1)
        expect(terminalTnt.state.tnts[0]?.state).toEqual({ kind: 'detonated' })
        expect(tntBefore.state.tnts[0]?.state).toEqual({ kind: 'primed', remainingFuseSecs: 1 })
        const entityAfter = yield* coordinator.snapshot(affectedEntityOwnerId, Schema.Struct({ health: Schema.Int }))
        expect(entityBefore.state).toEqual({ health: 20 })
        expect(entityAfter.revision).toBe(revisionBefore + 1)
        expect(entityAfter.state).toEqual({ health: 8 })
        expect(tntBefore.revision).toBe(revisionBefore)
        for (const cell of planned.explosion.destroyedBlocks) {
          expect(yield* overworld.getBlock(blockPosition(cell.x, cell.y, cell.z)))
            .toEqual({ _tag: 'Block', block: AIR_BLOCK_ID })
        }
      }),
    ),
  )

  it.effect('leaves terminal TNT, entity state, revisions, and blocks unchanged after a rejected detonation commit', () =>
    Effect.flatMap(transactionalFixture(), ({ coordinator, overworld, tnt }) =>
      Effect.gen(function* () {
        yield* tnt.prime({
          id: entity,
          dimension: 'overworld',
          center: { x: 8, y: 64, z: 8 },
          fuseSecs: 1,
          expectedRevision: revision(0),
          expectedDimensionRevision: dimensionRevision(0),
        })
        const planned = yield* tnt.advance(advanceRequest(1, 1, 1))
        expect(Schema.decodeUnknownSync(TntAdvanceOutcomeSchema)(planned)).toEqual(planned)
        expect(planned._tag).toBe('DetonationPlanned')
        if (planned._tag !== 'DetonationPlanned') return
        for (const cell of planned.explosion.destroyedBlocks) {
          yield* overworld.setBlock(blockPosition(cell.x, cell.y, cell.z), solidBlock)
        }
        yield* coordinator.commit({
          expectedRevision: revision(1),
          expectedDimensions: [{ dimension: 'overworld', expectedRevision: dimensionRevision(1) }],
          changes: [{ ownerId: affectedEntityOwnerId, state: { health: 19 } }],
        })
        const tntBefore = yield* tnt.snapshot
        const entityBefore = yield* coordinator.snapshot(affectedEntityOwnerId, Schema.Struct({ health: Schema.Int }))
        const revisionBefore = yield* coordinator.revision
        const dimensionBefore = yield* coordinator.dimensionRevision('overworld')

        const rejected = yield* Effect.result(tnt.commitDetonation({
          id: planned.id,
          planRevision: planned.planRevision,
        }, [{ ownerId: affectedEntityOwnerId, state: { health: 8 } }]))
        expect(Schema.decodeUnknownSync(
          Schema.Result(TntDetonationCommitOutcomeSchema, TntServiceErrorSchema),
        )(rejected)).toEqual(rejected)
        expect(Result.isFailure(rejected)).toBe(true)
        if (Result.isFailure(rejected)) expect(rejected.failure).toBeInstanceOf(WorldRevisionConflict)

        expect(yield* coordinator.revision).toBe(revisionBefore)
        expect(yield* coordinator.dimensionRevision('overworld')).toBe(dimensionBefore)
        expect(yield* tnt.snapshot).toEqual(tntBefore)
        expect(yield* coordinator.snapshot(affectedEntityOwnerId, Schema.Struct({ health: Schema.Int })))
          .toEqual(entityBefore)
        for (const cell of planned.explosion.destroyedBlocks) {
          expect(yield* overworld.getBlock(blockPosition(cell.x, cell.y, cell.z)))
            .toEqual({ _tag: 'Block', block: solidBlock })
        }
      }),
    ),
  )

  it.effect('commits a TNT with no destroyed blocks without submitting an empty block batch', () =>
    Effect.gen(function* () {
      const entitySchema = Schema.Struct({ health: Schema.Int })
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [
          tntOwnerRegistration(ownerId),
          { ownerId: affectedEntityOwnerId, schema: entitySchema, initialState: { health: 20 } },
        ],
      })
      const tnt = yield* makeTntService(ownerId).pipe(
        Effect.provideService(WorldCommitCoordinator, coordinator),
      )
      yield* tnt.prime({
        id: entity,
        dimension: 'overworld',
        center: { x: 8, y: 64, z: 8 },
        fuseSecs: 1,
        expectedRevision: revision(0),
        expectedDimensionRevision: dimensionRevision(0),
      })
      const planned = yield* tnt.advance({
        ...advanceRequest(1, 1, 1),
        blocks: () => ({ resistance: 0, destructible: false }),
      })
      expect(Schema.decodeUnknownSync(TntAdvanceOutcomeSchema)(planned)).toEqual(planned)
      expect(planned._tag).toBe('DetonationPlanned')
      if (planned._tag !== 'DetonationPlanned') return
      expect(planned.explosion.destroyedBlocks).toEqual([])

      const committed = yield* Effect.result(tnt.commitDetonation({ id: planned.id, planRevision: planned.planRevision }, [{
        ownerId: affectedEntityOwnerId,
        state: { health: 8 },
      }]))
      const decoded = Schema.decodeUnknownSync(
        Schema.Result(TntDetonationCommitOutcomeSchema, TntServiceErrorSchema),
      )(committed)
      expect(decoded).toEqual(committed)
      expect(Result.isSuccess(decoded)).toBe(true)
      expect(yield* coordinator.revision).toBe(revision(2))
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(dimensionRevision(2))
      expect((yield* tnt.snapshot).state.tnts[0]?.state).toEqual({ kind: 'detonated' })
      expect((yield* coordinator.snapshot(affectedEntityOwnerId, entitySchema)).state).toEqual({ health: 8 })
    }),
  )

  it.effect('rejects unknown detonation plan revisions without committing', () =>
    Effect.flatMap(transactionalFixture(), ({ coordinator, tnt }) =>
      Effect.gen(function* () {
        yield* tnt.prime({
          id: entity,
          dimension: 'overworld',
          center: { x: 8, y: 64, z: 8 },
          fuseSecs: 1,
          expectedRevision: revision(0),
          expectedDimensionRevision: dimensionRevision(0),
        })
        const planned = yield* tnt.advance(advanceRequest(1, 1, 1))
        expect(planned._tag).toBe('DetonationPlanned')
        if (planned._tag !== 'DetonationPlanned') return
        const before = yield* tnt.snapshot
        const rejected = yield* Effect.result(tnt.commitDetonation({
          id: planned.id,
          planRevision: Number.MAX_SAFE_INTEGER as typeof planned.planRevision,
        }))
        const decoded = Schema.decodeUnknownSync(
          Schema.Result(TntDetonationCommitOutcomeSchema, TntServiceErrorSchema),
        )(rejected)
        expect(Result.isFailure(decoded)).toBe(true)
        if (Result.isFailure(decoded)) {
          expect(decoded.failure).toMatchObject({ _tag: 'TntServiceFailure', reason: 'invalid-input' })
        }
        expect(yield* tnt.snapshot).toEqual(before)
        expect(yield* coordinator.revision).toBe(revision(1))
      }),
    ),
  )

  it('rejects TNT outcomes with missing or null required fields', () => {
    const decodeAdvance = Schema.decodeUnknownSync(TntAdvanceOutcomeSchema)
    const assertRequiredFields = (
      decode: (value: unknown) => unknown,
      sample: Record<string, unknown>,
      fields: ReadonlyArray<string>,
    ) => {
      for (const field of fields) {
        const withoutField = Object.fromEntries(Object.entries(sample).filter(([key]) => key !== field))
        expect(() => decode(withoutField)).toThrow()
        expect(() => decode({ ...sample, [field]: null })).toThrow()
      }
    }
    const assertNestedRequiredFields = (
      decode: (value: unknown) => unknown,
      parent: Record<string, unknown>,
      key: string,
      nested: Record<string, unknown>,
      fields: ReadonlyArray<string>,
    ) => {
      for (const field of fields) {
        const withoutField = Object.fromEntries(Object.entries(nested).filter(([entry]) => entry !== field))
        expect(() => decode({ ...parent, [key]: withoutField })).toThrow()
        expect(() => decode({ ...parent, [key]: { ...nested, [field]: null } })).toThrow()
      }
    }
    const explosionCenter: Record<string, unknown> = { x: 0, y: 0, z: 0 }
    const blockCell: Record<string, unknown> = { x: 1, y: 2, z: 3 }
    const knockback: Record<string, unknown> = { x: 1, y: 0, z: 0 }
    const entityEffect: Record<string, unknown> = {
      id: entity,
      damage: 1,
      knockback,
      exposure: 1,
    }
    const explosionLimits: Record<string, unknown> = {
      maxVisitedBlocks: 1,
      maxRaySteps: 1,
      maxAffectedEntities: 1,
    }
    const explosion: Record<string, unknown> = {
      center: explosionCenter,
      radius: 4,
      seed: 1,
      destroyedBlocks: [blockCell],
      entityEffects: [entityEffect],
      visitedBlocks: 0,
      limits: explosionLimits,
      truncated: false,
    }
    const beforeState: Record<string, unknown> = { kind: 'primed', remainingFuseSecs: 1 }
    const afterState: Record<string, unknown> = { kind: 'detonated' }
    const plan: Record<string, unknown> = {
      before: beforeState,
      after: afterState,
      advancedSecs: 1,
      deferredSecs: 0,
      explosion,
    }
    const validPlan: Record<string, unknown> = { ...plan, explosion: undefined }
    const fuseAdvanced: Record<string, unknown> = { _tag: 'FuseAdvanced', plan: validPlan, revision: 1 }
    assertRequiredFields(decodeAdvance, fuseAdvanced, ['_tag', 'plan', 'revision'])
    assertNestedRequiredFields(decodeAdvance, fuseAdvanced, 'plan', validPlan, [
      'before', 'after', 'advancedSecs', 'deferredSecs', 'explosion',
    ])
    for (const [field, state] of [['before', beforeState], ['after', afterState]] as const) {
      const nestedStateFields = field === 'before' ? ['kind', 'remainingFuseSecs'] : ['kind']
      for (const stateField of nestedStateFields) {
        const withoutStateField = Object.fromEntries(Object.entries(state).filter(([entry]) => entry !== stateField))
        expect(() => decodeAdvance({
          ...fuseAdvanced,
          plan: { ...validPlan, [field]: withoutStateField },
        })).toThrow()
        expect(() => decodeAdvance({
          ...fuseAdvanced,
          plan: { ...validPlan, [field]: { ...state, [stateField]: null } },
        })).toThrow()
      }
    }
    expect(() => decodeAdvance({ ...fuseAdvanced, revision: Number.MAX_SAFE_INTEGER + 1 })).toThrow()
    expect(() => decodeAdvance({})).toThrow()
    expect(() => decodeAdvance({ _tag: null })).toThrow()

    const detonationPlanned: Record<string, unknown> = {
      _tag: 'DetonationPlanned',
      plan,
      explosion,
      dimension: 'overworld',
      id: entity,
      planRevision: 1,
      expectedRevision: 1,
      expectedDimensionRevision: 1,
    }
    assertRequiredFields(decodeAdvance, detonationPlanned, [
      '_tag',
      'plan',
      'explosion',
      'dimension',
      'id',
      'planRevision',
      'expectedRevision',
      'expectedDimensionRevision',
    ])
    assertNestedRequiredFields(decodeAdvance, detonationPlanned, 'plan', plan, [
      'before', 'after', 'advancedSecs', 'deferredSecs', 'explosion',
    ])
    assertNestedRequiredFields(decodeAdvance, detonationPlanned, 'explosion', explosion, [
      'center', 'radius', 'seed', 'destroyedBlocks', 'entityEffects', 'visitedBlocks', 'limits', 'truncated',
    ])
    expect(() => decodeAdvance({ ...detonationPlanned, planRevision: 0 })).toThrow()
    expect(() => decodeAdvance({
      ...detonationPlanned,
      planRevision: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow()
    for (const field of ['x', 'y', 'z']) {
      const withoutField = Object.fromEntries(Object.entries(explosionCenter).filter(([entry]) => entry !== field))
      expect(() => decodeAdvance({ ...detonationPlanned, explosion: { ...explosion, center: withoutField } })).toThrow()
      expect(() => decodeAdvance({
        ...detonationPlanned,
        explosion: { ...explosion, center: { ...explosionCenter, [field]: null } },
      })).toThrow()
    }
    for (const field of ['maxVisitedBlocks', 'maxRaySteps', 'maxAffectedEntities']) {
      const withoutField = Object.fromEntries(Object.entries(explosionLimits).filter(([entry]) => entry !== field))
      expect(() => decodeAdvance({ ...detonationPlanned, explosion: { ...explosion, limits: withoutField } })).toThrow()
      expect(() => decodeAdvance({
        ...detonationPlanned,
        explosion: { ...explosion, limits: { ...explosionLimits, [field]: null } },
      })).toThrow()
    }
    for (const field of ['x', 'y', 'z']) {
      const withoutField = Object.fromEntries(Object.entries(blockCell).filter(([entry]) => entry !== field))
      expect(() => decodeAdvance({
        ...detonationPlanned,
        explosion: { ...explosion, destroyedBlocks: [withoutField] },
      })).toThrow()
      expect(() => decodeAdvance({
        ...detonationPlanned,
        explosion: { ...explosion, destroyedBlocks: [{ ...blockCell, [field]: null }] },
      })).toThrow()
    }
    for (const field of ['id', 'damage', 'knockback', 'exposure']) {
      const withoutField = Object.fromEntries(Object.entries(entityEffect).filter(([entry]) => entry !== field))
      expect(() => decodeAdvance({
        ...detonationPlanned,
        explosion: { ...explosion, entityEffects: [withoutField] },
      })).toThrow()
      expect(() => decodeAdvance({
        ...detonationPlanned,
        explosion: { ...explosion, entityEffects: [{ ...entityEffect, [field]: null }] },
      })).toThrow()
    }
    for (const field of ['x', 'y', 'z']) {
      const withoutField = Object.fromEntries(Object.entries(knockback).filter(([entry]) => entry !== field))
      expect(() => decodeAdvance({
        ...detonationPlanned,
        explosion: {
          ...explosion,
          entityEffects: [{ ...entityEffect, knockback: withoutField }],
        },
      })).toThrow()
      expect(() => decodeAdvance({
        ...detonationPlanned,
        explosion: {
          ...explosion,
          entityEffects: [{ ...entityEffect, knockback: { ...knockback, [field]: null } }],
        },
      })).toThrow()
    }
    expect(decodeAdvance(fuseAdvanced)).toMatchObject({ _tag: 'FuseAdvanced' })
    expect(decodeAdvance({ _tag: 'AlreadyDetonated' })).toEqual({ _tag: 'AlreadyDetonated' })
    expect(decodeAdvance(detonationPlanned)).toMatchObject({ _tag: 'DetonationPlanned' })

    const decodePrime = Schema.decodeUnknownSync(TntPrimeOutcomeSchema)
    assertRequiredFields(decodePrime, { revision: 0 }, ['revision'])
    expect(() => decodePrime({ revision: Number.MAX_SAFE_INTEGER + 1 })).toThrow()
    expect(decodePrime({ revision: 0 })).toEqual({ revision: 0 })

    const decodeCommit = Schema.decodeUnknownSync(TntDetonationCommitOutcomeSchema)
    assertRequiredFields(decodeCommit, { _tag: 'Committed', revision: 0 }, ['_tag', 'revision'])
    expect(() => decodeCommit({ _tag: 'Committed', revision: Number.MAX_SAFE_INTEGER + 1 })).toThrow()
    expect(decodeCommit({ _tag: 'Committed', revision: 0 })).toEqual({ _tag: 'Committed', revision: 0 })

    const decodeError = Schema.decodeUnknownSync(TntServiceErrorSchema)
    assertRequiredFields(decodeError, { _tag: 'TntServiceFailure', reason: 'invalid-input' }, ['_tag', 'reason'])
    expect(decodeError(new TntServiceFailure({ reason: 'invalid-input' })))
      .toMatchObject({ _tag: 'TntServiceFailure', reason: 'invalid-input' })
  })
})
