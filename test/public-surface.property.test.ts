import fc from 'fast-check'
import { Effect, Layer, Option, Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import { PositionAxis } from '@nerima-games/mc-kernel'
import { NoiseSeed } from '@nerima-games/mc-worldgen'
import {
  EntityHealthPoints,
  EntityKind,
  IntentQueueCapacitySchema,
  IntentQueueFull,
  IntentQueueEnqueueFailureSchema,
  IntentQueueLayer,
  IntentQueue,
  IntentSchema,
  IntentSequenceSchema,
  QueuedIntentSchema,
  SchemaErrorSchema,
  WEATHERS,
  WitherChargeRemainingSecs,
  WitherHealthPoints,
  WITHER_MAX_HEALTH,
  WITHER_SPAWN_CHARGE_SECS,
  isEntityId,
  isEntityKind,
  isValidSettings,
  isValidTimeState,
  isValidWeatherState,
  makeWeatherTransition,
  normaliseRoster,
  normaliseSettings,
  normaliseTimeState,
  normaliseWeatherState,
  restoreWither,
  setDayLength,
  setDayLengthThenTimeOfDay,
  setTimeOfDay,
  targetBlockFromCamera,
  targetBlockFromPlayerPose,
  validateWeatherState,
} from '../src/index.js'
import {
  HeadlessHarness,
  HeadlessHarnessNotInitialized,
  HeadlessHarnessSessionFactory,
  HeadlessHarnessSessionFactoryLayer,
  HeadlessHarnessTestLayer,
  RandomSeedSchema,
  StateHashSchema,
  StateHashNonJsonValue,
  TickCountSchema,
  type HeadlessHarnessSession,
  type HeadlessHarnessSessionFactoryApi,
  type HeadlessHarnessStages,
} from '../src/testing/index.js'
import {
  assertEffectOutcome,
  assertResultContract,
  finiteTree,
  hostileScalarInput,
  isRecord,
  invoke,
  structuredInput,
} from './public-property-helpers.js'

const HeadlessHarnessNotInitializedSchema = Schema.instanceOf(HeadlessHarnessNotInitialized)
const HeadlessHarnessStepErrorSchema = Schema.Union([
  HeadlessHarnessNotInitializedSchema,
  SchemaErrorSchema,
])
const HeadlessHarnessStateHashErrorSchema = Schema.Union([
  HeadlessHarnessNotInitializedSchema,
  SchemaErrorSchema,
  Schema.instanceOf(StateHashNonJsonValue),
])
const HeadlessHarnessEnqueueErrorSchema = Schema.Union([
  HeadlessHarnessNotInitializedSchema,
  IntentQueueEnqueueFailureSchema,
])

const hostileValue = hostileScalarInput({
  numbers: fc.oneof(
    fc.double(),
    fc.constantFrom<unknown>(
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      -1,
      0,
      1,
    ),
  ),
  maxStringLength: 16,
})

const unknownInput = structuredInput(hostileValue)

const checks = { numRuns: 100 }

it('root settings normalization returns valid finite settings for hostile values', () => {
  const settingsInput = fc.oneof(
    unknownInput,
    fc.record({
      renderDistance: hostileValue,
      fovDegrees: hostileValue,
      graphicsQuality: hostileValue,
      graphicsPreset: hostileValue,
      masterVolume: hostileValue,
      musicVolume: hostileValue,
      sfxVolume: hostileValue,
      mouseSensitivity: hostileValue,
      keyBindings: unknownInput,
      difficulty: hostileValue,
      uiScale: hostileValue,
      reducedMotion: hostileValue,
      colorVisionCorrection: hostileValue,
    }),
  )

  fc.assert(
    fc.property(settingsInput, (input) => {
      const settings = normaliseSettings(input)
      expect(isValidSettings(settings)).toBe(true)
      expect(finiteTree(settings)).toBe(true)
    }),
    checks,
  )
})

it('time normalization and setters keep the clock valid for hostile state and scalar values', () => {
  const timeStateInput = fc.record({ ticks: hostileValue, dayLengthTicks: hostileValue })

  fc.assert(
    fc.property(fc.tuple(timeStateInput, hostileValue, hostileValue), ([input, dayLength, fraction]) => {
      const normalized = invoke(normaliseTimeState, [input])
      const nextStates = [
        normalized,
        invoke(setDayLength, [normalized, dayLength]),
        invoke(setTimeOfDay, [normalized, fraction]),
        invoke(setDayLengthThenTimeOfDay, [normalized, dayLength, fraction]),
      ]

      for (const state of nextStates) {
        expect(invoke(isValidTimeState, [state])).toBe(true)
        expect(finiteTree(state)).toBe(true)
      }
    }),
    checks,
  )
})

it('weather validation, normalization, and transitions preserve their result contracts', () => {
  const weatherValue = fc.oneof(fc.constantFrom(...WEATHERS), hostileValue)

  fc.assert(
    fc.property(fc.tuple(weatherValue, hostileValue), ([weather, remainingSecs]) => {
      const input = { weather, remainingSecs }
      const normalized = normaliseWeatherState(input)
      expect(invoke(isValidWeatherState, [normalized])).toBe(true)
      expect(finiteTree(normalized)).toBe(true)

      const validated = validateWeatherState(input)
      const transitioned = makeWeatherTransition(weather, remainingSecs)
      for (const result of [validated, transitioned]) {
        if (Result.isFailure(result)) {
          expect(isRecord(result.failure) && result.failure['_tag'] === 'WeatherValidationFailure').toBe(true)
        } else {
          expect(invoke(isValidWeatherState, [result.success])).toBe(true)
          expect(finiteTree(result.success)).toBe(true)
        }
      }
    }),
    checks,
  )
})

it('public block targeting returns a typed failure or finite target for hostile aim fields', () => {
  const aimInput = fc.record({
    position: fc.record({ x: hostileValue, y: hostileValue, z: hostileValue }),
    yawRadians: hostileValue,
    pitchRadians: hostileValue,
  })
  const distanceInput = fc.oneof(
    fc.double({ min: -4, max: 16 }),
    fc.constantFrom<unknown>(null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1),
  )

  fc.assert(
    fc.property(fc.tuple(aimInput, distanceInput), ([aim, distance]) => {
      const camera = { ...aim, capturedAtSecs: 0 }
      const playerPose = {
        feetPosition: aim.position,
        yawRadians: aim.yawRadians,
        pitchRadians: aim.pitchRadians,
      }
      const results = [
        invoke(targetBlockFromCamera, [camera, distance, () => true]),
        invoke(targetBlockFromPlayerPose, [playerPose, distance, () => true]),
      ] as Array<Result.Result<Option.Option<unknown>, unknown>>

      for (const result of results) {
        if (Result.isFailure(result)) {
          expect(result.failure).toBeDefined()
          continue
        }

        expect(Option.isOption(result.success)).toBe(true)
        if (Option.isNone(result.success)) continue

        const target = result.success.value
        expect(isRecord(target)).toBe(true)
        if (!isRecord(target)) continue
        expect(finiteTree(target)).toBe(true)
        expect(isRecord(target['position'])).toBe(true)
        expect(isRecord(target['adjacentPosition'])).toBe(true)
        expect(typeof target['distance']).toBe('number')
        if (typeof target['distance'] === 'number') {
          expect(Number.isFinite(target['distance'])).toBe(true)
          expect(target['distance']).toBeGreaterThanOrEqual(0)
        }
      }
    }),
    checks,
  )
})

it('entity roster normalization repairs hostile scalar fields or returns its typed exhaustion failure', () => {
  const entityId = fc.oneof(
    fc.integer({ min: 0, max: 100 }).map((serial) => `e:${serial}`),
    fc.constantFrom<unknown>(null, undefined, 'invalid-id'),
  )
  const entityInput = fc.record({
    id: entityId,
    kind: fc.constant(EntityKind('creeper')),
    feetPosition: fc.record({ x: hostileValue, y: hostileValue, z: hostileValue }),
    healthPoints: hostileValue,
    behaviour: fc.constantFrom<unknown>(undefined, null, 'idle'),
  })
  const rosterInput = fc.record({
    entities: fc.array(entityInput, { maxLength: 6 }),
    nextSerial: hostileValue,
  })

  fc.assert(
    fc.property(rosterInput, (roster) => {
      const result = invoke(normaliseRoster, [roster]) as Result.Result<unknown, unknown>
      if (Result.isFailure(result)) {
        expect(isRecord(result.failure) && result.failure['_tag'] === 'EntitySerialExhausted').toBe(true)
        return
      }

      expect(isRecord(result.success)).toBe(true)
      if (!isRecord(result.success)) return
      const repairedRoster = result.success['roster']
      expect(isRecord(repairedRoster)).toBe(true)
      if (!isRecord(repairedRoster)) return
      expect(Array.isArray(repairedRoster['entities'])).toBe(true)
      expect(Number.isSafeInteger(repairedRoster['nextSerial'])).toBe(true)
      expect(finiteTree(result.success)).toBe(true)

      if (!Array.isArray(repairedRoster['entities'])) return
      const ids: Array<unknown> = []
      for (const entity of repairedRoster['entities']) {
        expect(isRecord(entity)).toBe(true)
        if (!isRecord(entity)) continue
        expect(isEntityId(entity['id'])).toBe(true)
        expect(isEntityKind(entity['kind'])).toBe(true)
        ids.push(entity['id'])
        const feetPosition = entity['feetPosition']
        expect(isRecord(feetPosition)).toBe(true)
        if (isRecord(feetPosition)) {
          for (const axis of ['x', 'y', 'z']) {
            const coordinate = feetPosition[axis]
            expect(typeof coordinate === 'number' && PositionAxis.is(coordinate)).toBe(true)
          }
        }
        const healthPoints = entity['healthPoints']
        expect(typeof healthPoints === 'number' && EntityHealthPoints.is(healthPoints)).toBe(true)
      }
      expect(new Set(ids).size).toBe(ids.length)
    }),
    checks,
  )
})

it('wither snapshot restoration returns finite state with repaired branded fields', () => {
  const positionInput = fc.record({ x: hostileValue, y: hostileValue, z: hostileValue })
  const witherStateInput = fc.record({
    phase: fc.constantFrom('charging', 'airborne', 'armoured', 'dead'),
    healthPoints: hostileValue,
    chargeRemainingSecs: hostileValue,
    feetPosition: positionInput,
    velocity: positionInput,
  })

  fc.assert(
    fc.property(witherStateInput, (state) => {
      const restored = invoke(restoreWither, [{ kind: 'wither', version: 1, state }])
      expect(isRecord(restored)).toBe(true)
      if (!isRecord(restored)) return
      expect(['charging', 'airborne', 'armoured', 'dead']).toContain(restored['phase'])
      expect(typeof restored['healthPoints'] === 'number' && WitherHealthPoints.is(restored['healthPoints'])).toBe(true)
      expect(restored['healthPoints']).toBeLessThanOrEqual(WITHER_MAX_HEALTH)
      expect(
        typeof restored['chargeRemainingSecs'] === 'number' &&
          WitherChargeRemainingSecs.is(restored['chargeRemainingSecs']),
      ).toBe(true)
      expect(restored['chargeRemainingSecs']).toBeLessThanOrEqual(WITHER_SPAWN_CHARGE_SECS)
      expect(finiteTree(restored)).toBe(true)
      for (const key of ['feetPosition', 'velocity']) {
        const vector = restored[key]
        expect(isRecord(vector)).toBe(true)
        if (isRecord(vector)) {
          for (const axis of ['x', 'y', 'z']) {
            const coordinate = vector[axis]
            expect(typeof coordinate === 'number' && PositionAxis.is(coordinate)).toBe(true)
          }
        }
      }
    }),
    checks,
  )
})

it('testing-barrel schemas reject hostile values or decode values matching their public formats', () => {
  fc.assert(
    fc.property(unknownInput, (input) => {
      const randomSeed = Schema.decodeUnknownResult(RandomSeedSchema)(input)
      const tickCount = Schema.decodeUnknownResult(TickCountSchema)(input)
      const stateHash = Schema.decodeUnknownResult(StateHashSchema)(input)

      expect(Result.isFailure(randomSeed) || Result.isSuccess(randomSeed)).toBe(true)
      expect(Result.isFailure(tickCount) || Result.isSuccess(tickCount)).toBe(true)
      expect(Result.isFailure(stateHash) || Result.isSuccess(stateHash)).toBe(true)
      if (Result.isSuccess(randomSeed)) expect(Number.isInteger(randomSeed.success)).toBe(true)
      if (Result.isSuccess(tickCount)) {
        expect(Number.isInteger(tickCount.success)).toBe(true)
        expect(tickCount.success).toBeGreaterThan(0)
      }
      if (Result.isSuccess(stateHash)) expect(stateHash.success).toMatch(/^[0-9a-f]{64}$/)
    }),
    checks,
  )
})

const emptyCandidate = () => ({ changes: [], expectedDimensions: [], events: [] })

const noOpStages: HeadlessHarnessStages = {
  intentsAndRules: () => Effect.succeed(emptyCandidate()),
  stations: () => Effect.succeed(emptyCandidate()),
  environment: () => Effect.succeed(emptyCandidate()),
  entities: () => Effect.succeed(emptyCandidate()),
}

const makeHarnessSessionFactory = (observed: {
  readonly openedWorldSeeds: Array<number>
  readonly steppedTicks: Array<number>
  closedSessions: number
}): HeadlessHarnessSessionFactoryApi => ({
  open: (worldSeed) => Effect.sync(() => {
    observed.openedWorldSeeds.push(worldSeed)
    const intents: IntentQueue['Service'] = {
      enqueue: () => Effect.succeed(Schema.decodeUnknownSync(IntentSequenceSchema)(0)),
      takeReady: () => Effect.succeed([]),
    }
    const session: HeadlessHarnessSession = {
      close: Effect.sync(() => {
        observed.closedSessions += 1
      }),
      intents,
      runTick: (tick) => Effect.sync(() => {
        observed.steppedTicks.push(tick)
      }),
      saveSlices: [],
    }
    return session
  }),
})

const inspectSessionSnapshots = (session: HeadlessHarnessSession) =>
  Effect.gen(function* () {
    expect(session.saveSlices.length).toBe(4)
    for (const slice of session.saveSlices) {
      const snapshot = yield* slice.snapshot
      expect(finiteTree(snapshot)).toBe(true)
      const encoded = yield* Schema.encodeUnknownEffect(slice.schema)(snapshot)
      expect(finiteTree(encoded)).toBe(true)
    }
  })

const harnessChecks = { numRuns: 24 }
const factoryChecks = { numRuns: 8 }

it('HeadlessHarness validates hostile seeds and ticks before reset and exercises bounded reset, step, and stateHash', async () => {
  const resetSeedInput = fc.oneof(fc.integer({ min: -32, max: 32 }), hostileValue)
  const tickCountInput = fc.oneof(fc.integer({ min: -1, max: 4 }), hostileValue)

  await fc.assert(
    fc.asyncProperty(
      fc.tuple(fc.integer({ min: -16, max: 16 }), resetSeedInput, tickCountInput),
      async ([worldSeed, randomSeedInput, rawTickCount]) => {
        const observed = { openedWorldSeeds: [] as Array<number>, steppedTicks: [] as Array<number>, closedSessions: 0 }
        const factory = makeHarnessSessionFactory(observed)
        const layer = HeadlessHarnessTestLayer(noOpStages).pipe(
          Layer.provide(Layer.succeed(HeadlessHarnessSessionFactory, factory)),
        )

        const steppedCount = await Effect.runPromise(
          Effect.gen(function* () {
            const harness = yield* HeadlessHarness
            const oneTick = Schema.decodeUnknownSync(TickCountSchema)(1)
            const beforeResetStep = yield* Effect.result(harness.step(oneTick))
            const beforeResetHash = yield* Effect.result(harness.stateHash)
            assertEffectOutcome(
              'HeadlessHarness.step before reset',
              () => beforeResetStep,
              Schema.Void,
              HeadlessHarnessStepErrorSchema,
            )
            assertEffectOutcome(
              'HeadlessHarness.stateHash before reset',
              () => beforeResetHash,
              StateHashSchema,
              HeadlessHarnessStateHashErrorSchema,
            )
            expect(Result.isFailure(beforeResetStep)).toBe(true)
            expect(Result.isFailure(beforeResetHash)).toBe(true)

            const randomSeed = Schema.decodeUnknownResult(RandomSeedSchema)(randomSeedInput)
            expect(Result.isFailure(randomSeed) || Result.isSuccess(randomSeed)).toBe(true)
            if (Result.isFailure(randomSeed) || Math.abs(randomSeed.success) > 32) return undefined

            const resetInput = { worldSeed: NoiseSeed(worldSeed), randomSeed: randomSeed.success }
            yield* harness.reset(resetInput)

            const tickCount = Schema.decodeUnknownResult(TickCountSchema)(rawTickCount)
            expect(Result.isFailure(tickCount) || Result.isSuccess(tickCount)).toBe(true)
            let executedTicks = 0
            if (Result.isSuccess(tickCount) && tickCount.success <= 4) {
              executedTicks = tickCount.success
              yield* harness.step(tickCount.success)
            }

            const hash = yield* Effect.result(harness.stateHash)
            assertEffectOutcome(
              'HeadlessHarness.stateHash after reset',
              () => hash,
              StateHashSchema,
              HeadlessHarnessStateHashErrorSchema,
            )
            expect(Result.isSuccess(hash)).toBe(true)

            yield* harness.reset(resetInput)
            const repeatedHash = yield* Effect.result(harness.stateHash)
            assertEffectOutcome(
              'HeadlessHarness.stateHash after repeated reset',
              () => repeatedHash,
              StateHashSchema,
              HeadlessHarnessStateHashErrorSchema,
            )
            expect(Result.isSuccess(repeatedHash)).toBe(true)
            return executedTicks
          }).pipe(Effect.provide(layer)),
        )

        if (steppedCount === undefined) {
          expect(observed.openedWorldSeeds).toEqual([])
          expect(observed.steppedTicks).toEqual([])
          expect(observed.closedSessions).toBe(0)
          return
        }

        expect(observed.openedWorldSeeds).toEqual([worldSeed, worldSeed])
        expect(observed.steppedTicks).toEqual(Array.from({ length: steppedCount }, (_, index) => index + 1))
        expect(observed.closedSessions).toBe(1)
      },
    ),
    harnessChecks,
  )
})

const legacySaveFixture = {
  dimension: 'nether',
  tick: 87654,
  player: {
    position: { x: 8.25, y: -12, z: 30 },
    inventory: [
      { item: 'iron_ingot', count: 2, components: null },
      null,
    ],
    selectedHotbarSlot: 7,
  },
  statistics: {
    counters: { mined: 9, jumped: 3 },
    unlocked: ['first-night'],
  },
}

const legacyRestoreInput = fc.oneof(
  fc.constant(legacySaveFixture),
  unknownInput,
  fc.record({
    dimension: fc.constant('nether'),
    tick: hostileValue,
    player: fc.record({
      position: fc.record({ x: hostileValue, y: hostileValue, z: hostileValue }),
      inventory: fc.array(
        fc.oneof(
          fc.constant(null),
          fc.record({
            item: fc.constant('iron_ingot'),
            count: hostileValue,
            components: fc.constant(null),
          }),
        ),
        { maxLength: 2 },
      ),
      selectedHotbarSlot: hostileValue,
    }),
    statistics: fc.record({
      counters: fc.dictionary(fc.string({ maxLength: 8 }), hostileValue, { maxKeys: 4 }),
      unlocked: fc.array(hostileValue, { maxLength: 4 }),
    }),
  }),
)

it('HeadlessHarnessSessionFactory open and openRestored return valid sessions or typed restore failures', async () => {
  await fc.assert(
    fc.asyncProperty(fc.tuple(fc.integer({ min: -8, max: 8 }), legacyRestoreInput), async ([seed, restoreInput]) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const factory = yield* HeadlessHarnessSessionFactory
          const worldSeed = NoiseSeed(seed)
          const session = yield* factory.open(worldSeed, noOpStages)
          yield* Effect.ensuring(inspectSessionSnapshots(session), session.close)

          const openRestored = factory.openRestored
          if (openRestored === undefined) throw new Error('openRestored must be available on the public factory')
          const restored = yield* Effect.result(openRestored(worldSeed, restoreInput, noOpStages))
          if (Result.isFailure(restored)) {
            // The test subpath has no serializable session-restore error Schema; each declared failure is an Error.
            expect(restored.failure).toBeInstanceOf(Error)
            if (restored.failure instanceof Error) expect(restored.failure.message.length).toBeGreaterThan(0)
            return
          }

          yield* Effect.ensuring(inspectSessionSnapshots(restored.success), restored.success.close)
        }).pipe(Effect.provide(HeadlessHarnessSessionFactoryLayer)),
      )
    }),
    factoryChecks,
  )
})

const enqueueIntentInput = fc.oneof(
  fc.record({
    id: fc.integer({ min: 0, max: 100 }).map((serial) => `intent-${serial}`),
    targetTick: fc.integer({ min: 0, max: 2 }),
    actor: fc.constant('e:1'),
    item: fc.constant(1),
  }).map(({ id, targetTick, actor, item }) => ({
    id,
    targetTick,
    source: 'local',
    payload: { _tag: 'UseItem', actor, item },
  })),
  fc.record({
    id: hostileValue,
    targetTick: hostileValue,
    actor: hostileValue,
    item: hostileValue,
  }).map(({ id, targetTick, actor, item }) => ({
    id,
    targetTick,
    source: 'local',
    payload: { _tag: 'UseItem', actor, item },
  })),
)

it('Hostile intent fields return typed HeadlessHarness.enqueue outcomes without escaping schema contracts', async () => {
  const queueCapacity = Schema.decodeUnknownSync(IntentQueueCapacitySchema)(1)

  await fc.assert(
    fc.asyncProperty(enqueueIntentInput, async (input) => {
      const decodedIntent = Schema.decodeUnknownResult(IntentSchema)(input)

      const observedQueued: Array<unknown> = []
      const factory: HeadlessHarnessSessionFactoryApi = {
        open: () => Effect.gen(function* () {
          const intents = yield* Effect.orDie(Effect.gen(function* () {
            return yield* IntentQueue
          }).pipe(Effect.provide(IntentQueueLayer({ capacity: queueCapacity }))))

          const session: HeadlessHarnessSession = {
            close: Effect.succeed(undefined),
            intents,
            runTick: (_tick, ready) => Effect.sync(() => {
              observedQueued.push(...ready)
            }),
            saveSlices: [],
          }
          return session
        }),
      }
      const layer = HeadlessHarnessTestLayer(noOpStages).pipe(
        Layer.provide(Layer.succeed(HeadlessHarnessSessionFactory, factory)),
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const harness = yield* HeadlessHarness
          assertResultContract(
            'IntentSchema.decodeUnknownResult',
            () => decodedIntent,
            IntentSchema,
            SchemaErrorSchema,
          )
          const beforeReset = yield* Effect.result(
            invoke(harness.enqueue, [input]) as Effect.Effect<unknown, unknown>,
          )
          assertEffectOutcome(
            'HeadlessHarness.enqueue before reset',
            () => beforeReset,
            IntentSequenceSchema,
            HeadlessHarnessEnqueueErrorSchema,
          )
          expect(Result.isFailure(beforeReset)).toBe(true)
          if (Result.isFailure(beforeReset)) {
            expect(beforeReset.failure).toBeInstanceOf(HeadlessHarnessNotInitialized)
          }

          if (Result.isFailure(decodedIntent)) {
            expect(decodedIntent.failure).toBeDefined()
            return
          }

          yield* harness.reset({
            worldSeed: NoiseSeed(1),
            randomSeed: Schema.decodeUnknownSync(RandomSeedSchema)(1),
          })
          const admitted = yield* Effect.result(harness.enqueue(decodedIntent.success))
          assertEffectOutcome(
            'HeadlessHarness.enqueue admitted intent',
            () => admitted,
            IntentSequenceSchema,
            HeadlessHarnessEnqueueErrorSchema,
          )
          expect(Result.isSuccess(admitted)).toBe(true)
          if (Result.isSuccess(admitted)) {
            expect(Number.isSafeInteger(admitted.success)).toBe(true)
            expect(admitted.success).toBe(0)
          }

          const full = yield* Effect.result(harness.enqueue(decodedIntent.success))
          assertEffectOutcome(
            'HeadlessHarness.enqueue full queue',
            () => full,
            IntentSequenceSchema,
            HeadlessHarnessEnqueueErrorSchema,
          )
          expect(Result.isFailure(full)).toBe(true)
          if (Result.isFailure(full)) expect(full.failure).toBeInstanceOf(IntentQueueFull)

          yield* harness.step(Schema.decodeUnknownSync(TickCountSchema)(1))
        }).pipe(Effect.provide(layer)),
      )

      for (const queued of observedQueued) {
        const decodedQueued = Schema.decodeUnknownResult(QueuedIntentSchema)(queued)
        assertResultContract(
          'QueuedIntentSchema.decodeUnknownResult',
          () => decodedQueued,
          QueuedIntentSchema,
          SchemaErrorSchema,
        )
        expect(Result.isSuccess(decodedQueued)).toBe(true)
        if (Result.isSuccess(decodedQueued)) {
          expect(Number.isSafeInteger(decodedQueued.success.sequence)).toBe(true)
          expect(finiteTree(decodedQueued.success)).toBe(true)
        }
      }
    }),
    { numRuns: 24 },
  )
})
