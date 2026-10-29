import { it } from '@effect/vitest'
import { NoiseSeed } from '@nerima-games/mc-worldgen'
import { Effect, Layer, Ref, Schema } from 'effect'
import { describe, expect } from 'vitest'
import { IntentSchema } from '../src/application/intent-queue.js'
import {
  HeadlessHarness,
  HeadlessHarnessTestLayer,
  RandomSeedSchema,
  TickCountSchema,
} from '../src/testing/headless-harness.js'
import {
  HeadlessHarnessSessionFactory,
  HeadlessHarnessSessionFactoryLayer,
  disposeOnBuildFailure,
  encodeInventorySaveSlot,
  type HeadlessHarnessSession,
  type HeadlessHarnessStages,
} from '../src/testing/session-factory.js'

const makeNoiseSeed = NoiseSeed
const makeRandomSeed = Schema.decodeUnknownSync(RandomSeedSchema)
const makeTickCount = Schema.decodeUnknownSync(TickCountSchema)
const emptyCandidate = () => ({ changes: [], expectedDimensions: [], events: [] })
const noOpStages = (): HeadlessHarnessStages => ({
  intentsAndRules: () => Effect.succeed(emptyCandidate()),
  stations: () => Effect.succeed(emptyCandidate()),
  environment: () => Effect.succeed(emptyCandidate()),
  entities: () => Effect.succeed(emptyCandidate()),
})
const harnessLayer = (stages: HeadlessHarnessStages) =>
  HeadlessHarnessTestLayer(stages).pipe(
    Layer.provide(HeadlessHarnessSessionFactoryLayer),
  )
const makeIntent = (id: string) => Schema.decodeUnknownSync(IntentSchema)({
  id,
  targetTick: 1,
  source: 'local',
  payload: { _tag: 'MeleeAttack', actor: 'player-1' },
})

const legacySave = {
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
    unlocked: ['minecraft:story/root'],
  },
}

const encodeSlices = (session: HeadlessHarnessSession) =>
  Effect.forEach(session.saveSlices, (slice) =>
    Effect.gen(function* () {
      const snapshot = yield* slice.snapshot
      const data = yield* Schema.encodeUnknownEffect(slice.schema)(snapshot)
      return { id: slice.id, version: slice.version, data }
    }),
  )

describe('HeadlessHarnessSessionFactory', () => {
  it.effect('projects the four real save registrations', () =>
    Effect.gen(function* () {
      const factory = yield* HeadlessHarnessSessionFactory
      const session = yield* factory.open(makeNoiseSeed(19), noOpStages())

      yield* Effect.ensuring(
        Effect.gen(function* () {
          const slices = yield* encodeSlices(session)
          expect(slices.map(({ id, version }) => [id, version])).toEqual([
            ['player', 1],
            ['time', 1],
            ['inventory', 1],
            ['statistics', 1],
          ])
          expect(slices.map(({ data }) => data)).toEqual([
            {
              dimension: 'overworld',
              pose: {
                feetPosition: { x: 0, y: 0, z: 0 },
                yawRadians: 0,
                pitchRadians: 0,
              },
            },
            { ticks: 7200, dayLengthTicks: 24000 },
            {
              inventory: { slots: Array.from({ length: 36 }, () => null) },
              selectedHotbarSlot: 0,
            },
            { counters: {}, unlocked: [] },
          ])
        }),
        session.close,
      )
    }).pipe(Effect.provide(HeadlessHarnessSessionFactoryLayer)),
  )

  it.effect('passes queued intents through step to the explicitly injected intents-and-rules stage', () => {
    const seen: Array<string> = []
    const stages: HeadlessHarnessStages = {
      ...noOpStages(),
      intentsAndRules: ({ ready }) => Effect.sync(() => {
        seen.push(...ready.map(({ intent }) => intent.id))
        return emptyCandidate()
      }),
    }
    return Effect.gen(function* () {
      const harness = yield* HeadlessHarness
      yield* harness.reset({ worldSeed: makeNoiseSeed(20), randomSeed: makeRandomSeed(7) })
      yield* harness.enqueue(makeIntent('handled-by-stage'))
      yield* harness.step(makeTickCount(1))
      expect(seen).toEqual(['handled-by-stage'])
    }).pipe(Effect.provide(harnessLayer(stages)))
  })

  it.effect('rejects malformed inventory stacks when decoding saves and encoding snapshots', () =>
    Effect.gen(function* () {
      const factory = yield* HeadlessHarnessSessionFactory
      const session = yield* factory.open(makeNoiseSeed(21), noOpStages())

      yield* Effect.ensuring(
        Effect.gen(function* () {
          const inventorySlice = session.saveSlices.find(({ id }) => id === 'inventory')
          if (inventorySlice === undefined) {
            return yield* Effect.fail(new Error('The inventory save slice must be registered'))
          }

          const malformedWire = yield* Effect.result(
            Schema.decodeUnknownEffect(inventorySlice.schema)({
              inventory: { slots: [{ item: 'not-a-kernel-item', count: 1, components: null }] },
              selectedHotbarSlot: 0,
            }),
          )
          expect(malformedWire._tag).toBe('Failure')

          const malformedSnapshot = yield* Effect.result(
            Schema.encodeUnknownEffect(inventorySlice.schema)({
              inventory: { slots: [{ item: 'not-a-kernel-item', count: 1, components: null }] },
              selectedHotbarSlot: 0,
            }),
          )
          expect(malformedSnapshot._tag).toBe('Failure')

          const malformedInternalStack = yield* Effect.exit(encodeInventorySaveSlot({
            item: 'not-a-kernel-item',
            count: 1,
            components: null,
          } as never))
          expect(malformedInternalStack._tag).toBe('Failure')
        }),
        session.close,
      )
    }).pipe(Effect.provide(HeadlessHarnessSessionFactoryLayer)),
  )

  it.effect('restores legacy v3 data through the real registrations before returning the session', () =>
    Effect.gen(function* () {
      const factory = yield* HeadlessHarnessSessionFactory
      const openRestored = factory.openRestored
      if (openRestored === undefined) {
        return yield* Effect.fail(new Error('The headless factory must support legacy restore'))
      }
      const session = yield* openRestored(makeNoiseSeed(23), legacySave, noOpStages())

      yield* Effect.ensuring(
        Effect.gen(function* () {
          const slices = yield* encodeSlices(session)
          expect(slices.map(({ id }) => id)).toEqual([
            'player',
            'time',
            'inventory',
            'statistics',
          ])
          expect(slices.map(({ data }) => data)).toEqual([
            {
              dimension: 'nether',
              pose: {
                feetPosition: { x: 8.25, y: -12, z: 30 },
                yawRadians: 0,
                pitchRadians: 0,
              },
            },
            { ticks: 87654, dayLengthTicks: 24000 },
            {
              inventory: {
                slots: [
                  { item: 'iron_ingot', count: 2, components: null },
                  ...Array.from({ length: 35 }, () => null),
                ],
              },
              selectedHotbarSlot: 7,
            },
            { counters: { mined: 9, jumped: 3 }, unlocked: ['minecraft:story/root'] },
          ])
        }),
        session.close,
      )
    }).pipe(Effect.provide(HeadlessHarnessSessionFactoryLayer)),
  )

  it.effect('disposes the session runtime idempotently', () =>
    Effect.gen(function* () {
      const factory = yield* HeadlessHarnessSessionFactory
      const session = yield* factory.open(makeNoiseSeed(29), noOpStages())
      yield* session.close
      yield* session.close
    }).pipe(Effect.provide(HeadlessHarnessSessionFactoryLayer)),
  )

  it.effect('disposes the runtime only when session construction fails', () =>
    Effect.gen(function* () {
      const disposed = yield* Ref.make(false)
      const onBuildFailure = disposeOnBuildFailure(Ref.set(disposed, true))

      const success = yield* Effect.exit(Effect.onError(Effect.succeed(undefined), onBuildFailure))
      expect(success._tag).toBe('Success')
      expect(yield* Ref.get(disposed)).toBe(false)

      const failure = yield* Effect.exit(Effect.onError(Effect.fail('build failed'), onBuildFailure))
      expect(failure._tag).toBe('Failure')
      expect(yield* Ref.get(disposed)).toBe(true)
    }),
  )

  it.effect('runs the real harness with a fixed save-state hash golden', () =>
    Effect.gen(function* () {
      const harness = yield* HeadlessHarness
      yield* harness.reset({
        worldSeed: makeNoiseSeed(31),
        randomSeed: makeRandomSeed(7),
      })
      const initialHash = yield* harness.stateHash
      yield* harness.step(makeTickCount(2))
      expect(yield* harness.stateHash).toBe(initialHash)

      yield* harness.reset({
        worldSeed: makeNoiseSeed(31),
        randomSeed: makeRandomSeed(7),
      })
      expect(yield* harness.stateHash).toBe(initialHash)
      expect(initialHash).toBe('d9d0c917df69016483e6a85577cd8bdc881a4ba5d09602909ebbbee8ac187fe3')
    }).pipe(Effect.provide(harnessLayer(noOpStages()))),
  )

  it.effect('rejects a malformed save and does not publish a partial session', () =>
    Effect.gen(function* () {
      const factory = yield* HeadlessHarnessSessionFactory
      const openRestored = factory.openRestored
      if (openRestored === undefined) {
        return yield* Effect.fail(new Error('The headless factory must support legacy restore'))
      }
      const result = yield* Effect.result(
        openRestored(makeNoiseSeed(37), { tick: -1 }, noOpStages()),
      )
      expect(result._tag).toBe('Failure')
    }).pipe(Effect.provide(HeadlessHarnessSessionFactoryLayer)),
  )
})
