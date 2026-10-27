import fc from 'fast-check'
import { Effect, Layer, Ref, Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import {
  AchievementIdSchema,
  ChunkAxis,
  chunkCoord,
  DIMENSIONS,
  PositionAxis,
  position,
  WorldIdSchema,
  type Dimension,
} from '@nerima-games/mc-kernel'
import type { Chunk } from '@nerima-games/mc-worldgen'
import { InMemoryStorageLayer } from '@nerima-games/mc-save'
import * as App from '../src/index.js'
import {
  assertResultContract,
  assertEffectOutcome,
  hostileNumber,
  hostileScalarInput,
  invokeEffect,
} from './public-property-helpers.js'

const hostileScalar = hostileScalarInput({ numbers: hostileNumber, maxStringLength: 24 })

const checks = { numRuns: 40, seed: 0x4d435349 }
const world = Schema.decodeUnknownSync(WorldIdSchema)('public-application-state-property')
const hostileDimension: fc.Arbitrary<unknown> = fc.oneof(hostileScalar, fc.constant('moon'), fc.constantFrom(...DIMENSIONS))

const fakeChunk = (cx: number, cz: number): Chunk => ({
  coord: chunkCoord(Result.getOrThrow(ChunkAxis.result(cx)), Result.getOrThrow(ChunkAxis.result(cz))),
  blocks: new Uint16Array(1),
  biomes: [],
})

const dimensionChunk = (cx: number, cz: number, dimension: Dimension) => ({
  dimension,
  chunk: fakeChunk(cx, cz),
})

it('makeTimeService returns a Schema-valid brand failure for a null constructor input', async () => {
  await fc.assert(
    fc.asyncProperty(fc.constant(null), async (initial) => {
      const outcome = await Effect.runPromise(Effect.result(invokeEffect(App.makeTimeService, [initial])))
      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(Schema.is(App.BrandErrorSchema)(outcome.failure)).toBe(true)
      }
    }),
    checks,
  )
})

it('SaveCoordinator retainChunk and save listing handle bounded hostile external values', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.record({
        x: fc.integer({ min: -128, max: 128 }),
        z: fc.integer({ min: -128, max: 128 }),
        dimension: fc.constantFrom(...DIMENSIONS),
      }), { maxLength: 6 }),
      async (chunks) => {
        const publications = await Effect.runPromise(
          Ref.make<ReadonlyArray<App.SaveCoordinatorPublication<{ readonly tick: number }>>>([]),
        )
        const coordinator = await Effect.runPromise(App.makeSaveCoordinator({
          initialKnownChunks: [],
          snapshotResidents: Effect.succeed([]),
          currentGeneration: Effect.succeed(0),
          snapshotState: Effect.succeed({ tick: 0 }),
          publish: (publication) => Ref.update(publications, (all) => [...all, publication]),
        }))
        await Effect.runPromise(Effect.forEach(chunks, (chunk) =>
          coordinator.retainChunk(dimensionChunk(chunk.x, chunk.z, chunk.dimension)),
        ))
        await Effect.runPromise(coordinator.requestSave)
        const [publication] = await Effect.runPromise(Ref.get(publications))
        expect(publication).toBeDefined()
        if (publication === undefined) return
        const expected = new Set(chunks.map(({ dimension, x, z }) => `${dimension}:${x},${z}`))
        const actual = publication.chunks.map(({ dimension, chunk }) =>
          `${dimension}:${chunk.coord.cx},${chunk.coord.cz}`,
        )
        expect(new Set(actual)).toStrictEqual(expected)
        expect(actual).toHaveLength(expected.size)
        expect(await Effect.runPromise(coordinator.retainedChunkCount)).toBe(0)
      },
    ),
    checks,
  )

  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 5 }), fc.integer({ min: -1_000_000, max: 1_000_000 }), async (count, tick) => {
      const save = {
        dimension: 'overworld' as const,
        tick: Math.abs(tick),
        player: {
          position: { x: tick, y: 64, z: -tick },
          inventory: [] as ReadonlyArray<null>,
          selectedHotbarSlot: 0,
        },
        statistics: { counters: {}, unlocked: [] as ReadonlyArray<string> },
      }
      const listing = await Effect.runPromise(Effect.gen(function* () {
        for (let index = 0; index < count; index += 1) {
          yield* App.saveSimulation(App.simulationSaveKey(`property:${index}`), { ...save, tick: Math.abs(tick) + index })
        }
        return yield* App.listSimulationSaves()
      }).pipe(Effect.provide(InMemoryStorageLayer)))
      expect(listing.corrupt).toHaveLength(0)
      expect(listing.valid).toHaveLength(count)
      expect(listing.valid.every(({ value }) => Schema.is(App.SIMULATION_SAVE_SCHEMA)(value))).toBe(true)
      expect(new Set(listing.valid.map(({ key }) => String(key)))).toStrictEqual(
        new Set(Array.from({ length: count }, (_, index) => `property:${index}`)),
      )
    }),
    checks,
  )
})

it('replicated-state public schemas reject hostile fields or decode finite schema-valid values', () => {
  const scalar = Schema.Struct({ value: Schema.Finite })
  const genericSnapshot = App.replicatedSnapshotSchema(scalar)
  const genericChange = App.replicatedOwnerChangeSchema('property-owner', scalar)
  const genericDelta = App.replicatedWorldDeltaSchema(genericChange)
  const fixedDelta = App.replicatedWorldDeltaSchema(App.ReplicatedOwnerChangeSchema)

  fc.assert(
    fc.property(hostileScalar, (hostile) => {
      assertResultContract(
        'ReplicatedOwnerIdSchema.decodeUnknownResult',
        () => Schema.decodeUnknownResult(App.ReplicatedOwnerIdSchema)(hostile),
        App.ReplicatedOwnerIdSchema,
        App.SchemaErrorSchema,
      )

      assertResultContract(
        'replicatedSnapshotSchema.decodeUnknownResult',
        () => Schema.decodeUnknownResult(genericSnapshot)({
          world,
          revision: hostile,
          state: { value: hostile },
        }),
        genericSnapshot,
        App.SchemaErrorSchema,
      )

      assertResultContract(
        'replicatedOwnerChangeSchema.decodeUnknownResult',
        () => Schema.decodeUnknownResult(genericChange)({
          owner: hostile,
          state: { value: hostile },
        }),
        genericChange,
        App.SchemaErrorSchema,
      )

      assertResultContract(
        'ReplicatedOwnerChangeSchema.decodeUnknownResult',
        () => Schema.decodeUnknownResult(App.ReplicatedOwnerChangeSchema)({
          owner: hostile,
          state: { safe: 1 },
        }),
        App.ReplicatedOwnerChangeSchema,
        App.SchemaErrorSchema,
      )

      assertResultContract(
        'replicatedWorldDeltaSchema.decodeUnknownResult',
        () => Schema.decodeUnknownResult(genericDelta)({
          world,
          revision: hostile,
          changes: [{ owner: 'property-owner', state: { value: hostile } }],
        }),
        genericDelta,
        App.SchemaErrorSchema,
      )

      assertResultContract(
        'replicatedWorldDeltaSchema(fixed).decodeUnknownResult',
        () => Schema.decodeUnknownResult(fixedDelta)({
          world,
          revision: hostile,
          changes: [{ owner: hostile, state: { safe: 1 } }],
        }),
        fixedDelta,
        App.SchemaErrorSchema,
      )

      for (const schema of [App.YawRadiansSchema, App.PitchRadiansSchema]) {
        assertResultContract(
          'angle Schema.decodeUnknownResult',
          () => Schema.decodeUnknownResult(schema)(hostile),
          schema,
          App.SchemaErrorSchema,
        )
      }

      const pose = {
        feetPosition: { dimension: 'overworld', x: hostile, y: hostile, z: hostile },
        yawRadians: hostile,
        pitchRadians: hostile,
      }
      assertResultContract(
        'ReplicatedPlayerPoseSchema.decodeUnknownResult',
        () => Schema.decodeUnknownResult(App.ReplicatedPlayerPoseSchema)(pose),
        App.ReplicatedPlayerPoseSchema,
        App.SchemaErrorSchema,
      )
      assertResultContract(
        'PlayerServiceSnapshotSchema.decodeUnknownResult',
        () => Schema.decodeUnknownResult(App.PlayerServiceSnapshotSchema)({ pose }),
        App.PlayerServiceSnapshotSchema,
        App.SchemaErrorSchema,
      )
    }),
    checks,
  )
})

it('EntityManager construction repairs hostile saved fields and sweep keeps its roster valid', async () => {
  await fc.assert(
    fc.asyncProperty(hostileNumber, async (hostile) => {
      const roster = {
        nextSerial: hostile,
        entities: [{
          id: hostile,
          kind: 'property-kind',
          feetPosition: { x: hostile, y: hostile, z: hostile },
          healthPoints: hostile,
          behaviour: { _tag: 'Idle' },
        }],
      }
      const managerOutcome = await Effect.runPromise(Effect.result(invokeEffect(App.makeEntityManager, [roster])))
      if (Result.isFailure(managerOutcome)) return
      const snapshot = await Effect.runPromise(managerOutcome.success.snapshot)
      expect(Number.isSafeInteger(snapshot.nextSerial)).toBe(true)
      expect(new Set(snapshot.entities.map(({ id }) => id)).size).toBe(snapshot.entities.length)
    }),
    checks,
  )

  await fc.assert(
    fc.asyncProperty(hostileNumber, async (hostile) => {
      const manager = await Effect.runPromise(App.makeEntityManager())
      await Effect.runPromise(manager.spawn({
        kind: App.EntityKind('sweep-property'),
        feetPosition: position(PositionAxis(1), PositionAxis(64), PositionAxis(2)),
        healthPoints: App.EntityHealthPoints(20),
        behaviour: { _tag: 'Idle' },
      }))
      const emitted = await Effect.runPromise(invokeEffect(manager.sweep, [() => ({
        transition: {
          _tag: 'Changed',
          state: {
            feetPosition: { x: hostile, y: hostile, z: hostile },
            healthPoints: hostile,
            behaviour: { _tag: 'Idle' },
          },
        },
        emit: undefined,
      })]))
      expect(emitted).toStrictEqual([])
      const snapshot = await Effect.runPromise(manager.snapshot)
      expect(snapshot.entities).toHaveLength(1)
      expect(Number.isFinite(snapshot.entities[0]?.healthPoints)).toBe(true)
    }),
    checks,
  )
})

it('PlayerService moveTo, setDimension, and replicated candidate submission preserve valid state', async () => {
  await fc.assert(
    fc.asyncProperty(hostileNumber, hostileDimension, fc.tuple(hostileScalar, hostileScalar), async (hostile, dimension, revisions) => {
      const player = await Effect.runPromise(App.makePlayerService())
      const initialCandidate = await Effect.runPromise(player.replicatedCandidate)
      const coordinator = await Effect.runPromise(App.makeWorldCommitCoordinator({
        world,
        owners: [{
          ownerId: App.PLAYER_REPLICATED_OWNER_ID,
          schema: App.PlayerServiceSnapshotSchema,
          initialState: initialCandidate,
        }],
      }))
      const coordinatorLayer = Layer.succeed(App.WorldCommitCoordinator, coordinator)

      const move = await Effect.runPromise(Effect.result(invokeEffect(player.moveTo, [{
        x: hostile,
        y: hostile,
        z: hostile,
      }])))
      assertEffectOutcome('PlayerService.moveTo', () => move, Schema.Void, App.PlayerServiceInputErrorSchema)
      const dimensionResult = await Effect.runPromise(
        Effect.result(invokeEffect(player.setDimension, [dimension])),
      )
      assertEffectOutcome('PlayerService.setDimension', () => dimensionResult, Schema.Void, App.PlayerServiceInputErrorSchema)
      if (Result.isSuccess(dimensionResult)) expect(DIMENSIONS).toContain(dimension)

      const candidate = await Effect.runPromise(Effect.result(player.replicatedCandidate))
      assertEffectOutcome(
        'PlayerService.replicatedCandidate',
        () => candidate,
        App.PlayerServiceSnapshotSchema,
        App.SchemaErrorSchema,
      )
      const submitted = await Effect.runPromise(Effect.provide(
        Effect.result(invokeEffect(player.submitReplicatedCandidate, revisions)),
        coordinatorLayer,
      ))
      assertEffectOutcome(
        'PlayerService.submitReplicatedCandidate',
        () => submitted,
        App.replicatedWorldDeltaSchema(App.ReplicatedOwnerChangeSchema),
        App.WorldCommitCoordinatorErrorSchema,
      )
      const committed = await Effect.runPromise(Effect.provide(
        player.snapshot,
        coordinatorLayer,
      ))
      expect(Result.isSuccess(Schema.decodeUnknownResult(App.PlayerServiceSnapshotSchema)(committed.state))).toBe(true)
    }),
    checks,
  )
})

it('PlayerService constructor and restore schema-gate dimension outcomes', () => {
  fc.assert(fc.property(fc.constant('moon'), (dimension) => {
    const initial = Effect.runSync(Effect.result(
      App.makePlayerService(App.INITIAL_PLAYER_POSE, dimension as Dimension),
    ))
    expect(Result.isFailure(initial)).toBe(true)
    if (Result.isFailure(initial)) {
      expect(Schema.is(App.PlayerServiceInputErrorSchema)(initial.failure)).toBe(true)
      expect(initial.failure).toMatchObject({ reason: 'invalid-dimension', field: 'dimension' })
    }
  }), checks)

  fc.assert(fc.property(fc.constantFrom(...DIMENSIONS), (dimension) => {
    const initial = Effect.runSync(Effect.result(
      App.makePlayerService(App.INITIAL_PLAYER_POSE, dimension),
    ))
    expect(Result.isSuccess(initial)).toBe(true)
    if (Result.isSuccess(initial)) {
      expect(Effect.runSync(initial.success.dimension)).toBe(dimension)
      expect(Effect.runSync(initial.success.pose)).toStrictEqual(App.INITIAL_PLAYER_POSE)
    }
  }), checks)

  fc.assert(fc.property(fc.constant('moon'), (dimension) => {
    const player = Effect.runSync(App.makePlayerService())
    const previousPose = Effect.runSync(player.pose)
    const previousDimension = Effect.runSync(player.dimension)
    const restored = Effect.runSync(Effect.result(player.restore(
      App.INITIAL_PLAYER_POSE,
      dimension as Dimension,
    )))
    assertEffectOutcome(
      'PlayerService.restore(pose, dimension)',
      () => restored,
      Schema.Void,
      App.PlayerServiceInputErrorSchema,
    )
    expect(Result.isFailure(restored)).toBe(true)
    expect(Effect.runSync(player.pose)).toStrictEqual(previousPose)
    expect(Effect.runSync(player.dimension)).toBe(previousDimension)
  }), checks)

  fc.assert(fc.property(fc.constantFrom(...DIMENSIONS), (dimension) => {
    const player = Effect.runSync(App.makePlayerService())
    const restored = Effect.runSync(Effect.result(player.restore(App.INITIAL_PLAYER_POSE, dimension)))
    assertEffectOutcome(
      'PlayerService.restore(pose, dimension)',
      () => restored,
      Schema.Void,
      App.PlayerServiceInputErrorSchema,
    )
    expect(Result.isSuccess(restored)).toBe(true)
    expect(Effect.runSync(player.dimension)).toBe(dimension)
  }), checks)
})

it('SettingsService candidates, updates, and key mutations keep a valid snapshot', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.tuple(hostileScalar, hostileScalar, hostileScalar),
      fc.tuple(hostileScalar, hostileScalar),
      async ([renderDistance, volume, uiScale], [action, code]) => {
      const settings = await Effect.runPromise(App.makeSettingsService())
      const patch = { renderDistance, masterVolume: volume, uiScale }
      await Effect.runPromise(invokeEffect(settings.candidate, [patch]))
      const beforeUpdate = await Effect.runPromise(settings.snapshot)
      expect(App.isValidSettings(beforeUpdate)).toBe(true)

      await Effect.runPromise(invokeEffect(settings.update, [patch]))
      for (const [propertyName, outcome] of [
        ['SettingsService.rebindKey', await Effect.runPromise(Effect.result(invokeEffect(settings.rebindKey, [action, code])))],
        ['SettingsService.unbindKey', await Effect.runPromise(Effect.result(invokeEffect(settings.unbindKey, [action])))],
      ] as const) {
        assertEffectOutcome(propertyName, () => outcome, Schema.Void, App.BrandErrorSchema)
      }
      expect(App.isValidSettings(await Effect.runPromise(settings.snapshot))).toBe(true)
      },
    ),
    checks,
  )
})

it('StatisticsService unlock and restore repair hostile saved counters and achievement IDs', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.dictionary(fc.string({ maxLength: 16 }), hostileNumber, { maxKeys: 5 }),
      fc.array(hostileScalar, { maxLength: 5 }),
      fc.integer({ min: 0, max: 10_000 }),
      async (counters, unlocked, suffix) => {
        const service = await Effect.runPromise(App.makeStatisticsService())
        await Effect.runPromise(invokeEffect(service.restore, [{ counters, unlocked }]))
        const achievement = Schema.decodeUnknownSync(AchievementIdSchema)(`property-${suffix}`)
        await Effect.runPromise(service.unlock(achievement))
        await Effect.runPromise(service.unlock(achievement))
        const snapshot = await Effect.runPromise(service.snapshot)
        expect(App.isValidStatistics(snapshot)).toBe(true)
        expect(snapshot.unlocked.filter((id) => id === achievement)).toHaveLength(1)
      },
    ),
    checks,
  )
})

it('TimeService candidate, setters, configureDay, and restore keep a finite valid clock', async () => {
  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileScalar, hostileScalar), async ([first, second]) => {
      const time = await Effect.runPromise(App.makeTimeService())
      const candidate = await Effect.runPromise(Effect.result(invokeEffect(time.advanceCandidate, [first])))
      assertEffectOutcome('TimeService.advanceCandidate', () => candidate, App.TimeStateSchema, App.BrandErrorSchema)

      await Effect.runPromise(invokeEffect(time.setDayLength, [first]))
      expect(App.isValidTimeState(await Effect.runPromise(time.snapshot))).toBe(true)
      await Effect.runPromise(invokeEffect(time.setTimeOfDay, [second]))
      expect(App.isValidTimeState(await Effect.runPromise(time.snapshot))).toBe(true)
      await Effect.runPromise(invokeEffect(time.configureDay, [first, second]))
      expect(App.isValidTimeState(await Effect.runPromise(time.snapshot))).toBe(true)
      await Effect.runPromise(invokeEffect(time.restore, [{ ticks: first, dayLengthTicks: second }]))

      const snapshot = await Effect.runPromise(time.snapshot)
      expect(App.isValidTimeState(snapshot)).toBe(true)
      expect(Schema.is(App.TimeStateSchema)(snapshot)).toBe(true)
      expect(Number.isFinite(await Effect.runPromise(time.moonPhase))).toBe(true)
      expect(typeof await Effect.runPromise(time.isNight)).toBe('boolean')
    }),
    checks,
  )
})

it('physics stage registration reports jumpSpeed for invalid magnitudes', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.oneof(
        fc.double({ max: -Number.MIN_VALUE }),
        fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
      ),
      async (jumpSpeed) => {
        const result = await Effect.runPromise(Effect.result(invokeEffect(App.makeSimStagesWithPhysics, [{
          resolve: {},
          walkSpeed: 1,
          jumpSpeed,
        }])).pipe(Effect.provide(App.simModule.layers)))
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toStrictEqual({ _tag: 'SimPhysicsConfigError', field: 'jumpSpeed' })
        }
      },
    ),
    checks,
  )
})
