import fc from 'fast-check'
import { Clock, Effect, Layer, Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import { BlockLength, HalfHeight } from '@nerima-games/mc-physics'
import { NoiseSeed } from '@nerima-games/mc-worldgen'
import * as App from '../src/index.js'
import * as Testing from '../src/testing/index.js'
import {
  assertEffectOutcome,
  assertResultContract,
  hostileValue,
  isRecord,
  invoke,
  invokeEffect,
} from './public-property-helpers.js'

const validResolve = {
  halfWidth: BlockLength(0.3),
  halfHeight: HalfHeight(0.9),
  environment: { blockAt: () => Result.succeed(null) },
  blockPropertiesAt: () => Result.succeed(null),
}

const validConfig = (walkSpeed: unknown, jumpSpeed: unknown) => ({
  resolve: validResolve,
  walkSpeed,
  jumpSpeed,
})

const simulationLayer = Layer.mergeAll(
  App.InventoryServiceLayer(),
  App.PlayerServiceLayer(),
  App.TimeServiceLayer(),
  App.CropServiceLayer,
)

const stageConstructors = [
  { name: 'makeSimStagesWithPhysics', construct: App.makeSimStagesWithPhysics },
  { name: 'makeControllableSimStagesWithPhysics', construct: App.makeControllableSimStagesWithPhysics },
] as const

const expectStageArrayOutcome = (
  propertyName: string,
  outcome: Result.Result<unknown, unknown>,
  expectedSuccess: boolean,
): void => {
  assertEffectOutcome(
    propertyName,
    () => outcome,
    App.SimPhysicsStagesSchema,
    App.SimPhysicsConfigErrorSchema,
  )
  expect(Result.isSuccess(outcome)).toBe(expectedSuccess)
}

const expectControllableStageOutcome = (
  propertyName: string,
  outcome: Result.Result<unknown, unknown>,
  expectedSuccess: boolean,
): void => {
  if (Result.isFailure(outcome)) {
    assertEffectOutcome(propertyName, () => outcome, Schema.Never, App.SimPhysicsConfigErrorSchema)
    expect(expectedSuccess).toBe(false)
    return
  }

  expect(expectedSuccess).toBe(true)
  expect(isRecord(outcome.success)).toBe(true)
  if (!isRecord(outcome.success)) return
  const success = outcome.success
  assertResultContract(
    `${propertyName}.stages`,
    () => Result.succeed(success['stages']),
    App.SimPhysicsStagesSchema,
    Schema.Never,
  )
  expect(isRecord(success['state'])).toBe(true)
  if (isRecord(success['state'])) {
    expect(Object.keys(success['state']).sort()).toStrictEqual([
      'accumulatedFallDistance',
      'isGrounded',
      'jumpIntent',
      'landingImpact',
      'movementIntent',
      'physicsConfig',
      'resolvedFeetPosition',
      'velocity',
    ])
    for (const field of Object.values(success['state'])) expect(field).toBeDefined()
  }
  expect(isRecord(success['input'])).toBe(true)
  if (isRecord(success['input'])) {
    expect(Object.keys(success['input']).sort()).toStrictEqual(['setJumpIntent', 'setMovementIntent'])
    expect(typeof success['input']['setMovementIntent']).toBe('function')
    expect(typeof success['input']['setJumpIntent']).toBe('function')
  }
}

const checks = { numRuns: 32 }

it('stage physics constructors return typed failures for hostile config and resolver envelopes', async () => {
  const hostileConfig: fc.Arbitrary<unknown> = fc.constantFrom(
    null,
    undefined,
    false,
    0,
    'invalid',
    [],
    {},
    { resolve: null, walkSpeed: 4, jumpSpeed: 7 },
    { resolve: {}, walkSpeed: 4, jumpSpeed: 7 },
    { resolve: { environment: null }, walkSpeed: 4, jumpSpeed: 7 },
    { resolve: { environment: { blockAt: 1 }, blockPropertiesAt: 1 }, walkSpeed: 4, jumpSpeed: 7 },
    { resolve: { ...validResolve, halfHeight: Number.NaN }, walkSpeed: 4, jumpSpeed: 7 },
    { resolve: { ...validResolve, stepHeight: Number.POSITIVE_INFINITY }, walkSpeed: 4, jumpSpeed: 7 },
  )

  await fc.assert(
    fc.asyncProperty(hostileConfig, async (config) => {
      await Promise.all(stageConstructors.map(async ({ name, construct }) => {
        let effect: unknown
        expect(() => { effect = invoke(construct, [config]) }).not.toThrow()
        const outcome = await Effect.runPromise(
          Effect.result(Effect.provide(effect as Effect.Effect<unknown, unknown, never>, simulationLayer)),
        )
        if (name === 'makeSimStagesWithPhysics') {
          expectStageArrayOutcome(name, outcome, false)
        } else {
          expectControllableStageOutcome(name, outcome, false)
        }
      }))
    }),
    checks,
  )
})

it('stage physics constructors handle hostile scalar fields without throwing or succeeding invalid configs', async () => {
  await fc.assert(
    fc.asyncProperty(fc.tuple(hostileValue, hostileValue), async ([walkSpeed, jumpSpeed]) => {
      await Promise.all(stageConstructors.map(async ({ name, construct }) => {
        let effect: unknown
        expect(() => { effect = invoke(construct, [validConfig(walkSpeed, jumpSpeed)]) }).not.toThrow()
        const outcome = await Effect.runPromise(
          Effect.result(Effect.provide(effect as Effect.Effect<unknown, unknown, never>, simulationLayer)),
        )

        const validSpeed = (value: unknown): boolean =>
          typeof value === 'number' && Number.isFinite(value) && value >= 0
        const expectedSuccess = validSpeed(walkSpeed) && validSpeed(jumpSpeed)
        if (name === 'makeSimStagesWithPhysics') {
          expectStageArrayOutcome(name, outcome, expectedSuccess)
        } else {
          expectControllableStageOutcome(name, outcome, expectedSuccess)
        }
      }))
    }),
    checks,
  )
})

type SessionRecord = {
  readonly worldSeed: number
  closed: number
  readonly ticks: Array<number>
  readonly clockAtTick: Array<number>
}

const noOpStages: Testing.HeadlessHarnessStages = {
  intentsAndRules: () => Effect.succeed({ changes: [], expectedDimensions: [], events: [] }),
  stations: () => Effect.succeed({ changes: [], expectedDimensions: [], events: [] }),
  environment: () => Effect.succeed({ changes: [], expectedDimensions: [], events: [] }),
  entities: () => Effect.succeed({ changes: [], expectedDimensions: [], events: [] }),
}

const makeFactory = (): {
  readonly service: Testing.HeadlessHarnessSessionFactory['Service']
  readonly sessions: Array<SessionRecord>
} => {
  const sessions: Array<SessionRecord> = []
  const capacity = Schema.decodeUnknownSync(App.IntentQueueCapacitySchema)(8)

  return {
    sessions,
    service: {
      open: (worldSeed) => Effect.gen(function* () {
        const intents = yield* Effect.orDie(
          Effect.gen(function* () {
            return yield* App.IntentQueue
          }).pipe(Effect.provide(App.IntentQueueLayer({ capacity }))),
        )
        const record: SessionRecord = { worldSeed, closed: 0, ticks: [], clockAtTick: [] }
        sessions.push(record)
        return {
          close: Effect.sync(() => { record.closed += 1 }),
          intents,
          runTick: (tick) => Effect.gen(function* () {
            record.ticks.push(tick)
            record.clockAtTick.push(yield* Clock.currentTimeMillis)
          }),
          saveSlices: [],
        }
      }),
    },
  }
}

const harnessLayer = (factory: Testing.HeadlessHarnessSessionFactory['Service']) =>
  Testing.HeadlessHarnessTestLayer(noOpStages).pipe(
    Layer.provide(Layer.succeed(Testing.HeadlessHarnessSessionFactory, factory)),
  )

const randomSeed = (value: number): Testing.RandomSeed =>
  Schema.decodeUnknownSync(Testing.RandomSeedSchema)(value)

const tickCount = (value: number): Testing.TickCount =>
  Schema.decodeUnknownSync(Testing.TickCountSchema)(value)

const malformedReset: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom<unknown>(null, undefined, false, 0, 'invalid', []),
  fc.record({
    worldSeed: fc.constantFrom<unknown>(null, undefined, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 'seed'),
    randomSeed: fc.constant(17),
  }),
  fc.record({
    worldSeed: fc.constant(23),
    randomSeed: fc.constantFrom<unknown>(null, undefined, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 'seed'),
  }),
  fc.record({ worldSeed: fc.constant(23) }),
  fc.record({ randomSeed: fc.constant(17) }),
)

it('headless harness rejects malformed reset envelopes before closing or replacing its active session', async () => {
  await fc.assert(
    fc.asyncProperty(malformedReset, async (input) => {
      const runtime = makeFactory()
      await Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const harness = yield* Testing.HeadlessHarness
            yield* harness.reset({
              worldSeed: NoiseSeed(23),
              randomSeed: randomSeed(17),
            })
            yield* harness.step(tickCount(2))

            let resetEffect: unknown
            expect(() => { resetEffect = invokeEffect(harness.reset, [input]) }).not.toThrow()
            const resetOutcome = yield* Effect.result(
              resetEffect as Effect.Effect<void, unknown, never>,
            )
            assertEffectOutcome(
              'HeadlessHarness.reset malformed input',
              () => resetOutcome,
              Schema.Void,
              App.SchemaErrorSchema,
            )
            expect(Result.isFailure(resetOutcome)).toBe(true)

            expect(runtime.sessions).toHaveLength(1)
            expect(runtime.sessions[0]?.closed).toBe(0)
            expect(runtime.sessions[0]?.ticks).toEqual([1, 2])
            expect(runtime.sessions[0]?.clockAtTick).toEqual([50, 100])

            yield* harness.step(tickCount(1))
            expect(runtime.sessions[0]?.closed).toBe(0)
            expect(runtime.sessions[0]?.ticks).toEqual([1, 2, 3])
            expect(runtime.sessions[0]?.clockAtTick).toEqual([50, 100, 150])
          }),
          harnessLayer(runtime.service),
        ),
      )
    }),
    { numRuns: 24 },
  )
})
