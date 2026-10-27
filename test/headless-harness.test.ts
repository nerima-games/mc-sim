import { createHash } from 'node:crypto'
import { describe, expect, it } from '@effect/vitest'
import { Brand, Clock, Duration, Effect, Layer, Random, Result, Schema } from 'effect'
import {
  IntentIdSchema,
  IntentPayloadSchema,
  IntentQueue,
  IntentQueueCapacitySchema,
  IntentQueueFull,
  IntentQueueLayer,
  IntentSchema,
} from '../src/application/intent-queue.js'
import {
  HeadlessHarness,
  HeadlessHarnessNotInitialized,
  HeadlessHarnessSessionFactory,
  HeadlessHarnessTestLayer,
  RandomSeedSchema,
  StateHashNonJsonValue,
  StateHashSchema,
  TickCountSchema,
  type HeadlessHarnessResetInput,
  type HeadlessSaveSlice,
} from '../src/testing/index.js'
import { NoiseSeed } from '@nerima-games/mc-worldgen'
import {
  SaveSliceIdSchema,
  SaveVersionSchema,
  SimulationTickSchema,
} from '@nerima-games/mc-kernel'
import type { IntentQueue as IntentQueueType } from '../src/application/intent-queue.js'
import type { NoiseSeed as NoiseSeedType } from '@nerima-games/mc-worldgen'
import type { SaveVersion } from '@nerima-games/mc-kernel'

type SessionRecord = {
  readonly worldSeed: NoiseSeedType
  readonly closed: Array<boolean>
  readonly ticks: Array<number>
  readonly ready: Array<ReadonlyArray<string>>
  readonly clockAtTick: Array<number>
  readonly monotonicAtTick: Array<bigint>
  readonly unsafeClockAtTick: Array<number>
  readonly unsafeNanosAtTick: Array<bigint>
  readonly unsafeMonotonicAtTick: Array<bigint>
  readonly randomAtOpen: number
  readonly randomAtTick: Array<number>
}

const makeNoiseSeed = NoiseSeed
const makeRandomSeed = (value: number) => Schema.decodeUnknownSync(RandomSeedSchema)(value)
const makeTickCount = (value: number) => Schema.decodeUnknownSync(TickCountSchema)(value)
const makeSaveSliceId = (value: string) => Schema.decodeUnknownSync(SaveSliceIdSchema)(value)
const makeSaveVersion = (value: number) => Schema.decodeUnknownSync(SaveVersionSchema)(value)
const makeTick = (value: number) => Schema.decodeUnknownSync(SimulationTickSchema)(value)
const makeQueueCapacity = (value: number) => Schema.decodeUnknownSync(IntentQueueCapacitySchema)(value)

const makeSlice = (
  id: string,
  version: number,
  value: unknown,
  schema: Schema.Codec<unknown, unknown> = Schema.Unknown,
): HeadlessSaveSlice => ({
  id: makeSaveSliceId(id),
  version: makeSaveVersion(version),
  schema,
  snapshot: Effect.succeed(value),
})

const makeIntent = (id: string, targetTick: number) =>
  Schema.decodeUnknownSync(IntentSchema)({
    id: Schema.decodeUnknownSync(IntentIdSchema)(id),
    targetTick: makeTick(targetTick),
    source: 'local',
    payload: Schema.decodeUnknownSync(IntentPayloadSchema)({
      _tag: 'UseItem',
      actor: 'actor-1',
      item: 1,
    }),
  })

const makeRuntime = (
  slices: () => ReadonlyArray<HeadlessSaveSlice> = () => [],
  capacity = 8,
): {
  readonly service: HeadlessHarnessSessionFactory['Service']
  readonly sessions: Array<SessionRecord>
  readonly events: Array<string>
} => {
  const sessions: Array<SessionRecord> = []
  const events: Array<string> = []

  return {
    sessions,
    events,
    service: {
      open: (worldSeed) => Effect.gen(function* () {
        const index = sessions.length
        events.push(`open:${index}`)
        const randomAtOpen = yield* Random.next
        const intents: IntentQueueType['Service'] = yield* Effect.gen(function* () {
          return yield* IntentQueue
        }).pipe(Effect.provide(IntentQueueLayer({ capacity: makeQueueCapacity(capacity) })))
        const record: SessionRecord = {
          worldSeed,
          closed: [],
          ticks: [],
          ready: [],
          clockAtTick: [],
          monotonicAtTick: [],
          unsafeClockAtTick: [],
          unsafeNanosAtTick: [],
          unsafeMonotonicAtTick: [],
          randomAtOpen,
          randomAtTick: [],
        }
        sessions.push(record)

        return {
          close: Effect.sync(() => {
            record.closed.push(true)
            events.push(`close:${index}`)
          }),
          intents,
          runTick: (tick, ready) => Effect.gen(function* () {
            const clock = yield* Clock.Clock
            record.ticks.push(tick)
            record.ready.push(ready.map(({ intent }) => intent.id))
            record.clockAtTick.push(yield* Clock.currentTimeMillis)
            record.monotonicAtTick.push(yield* Clock.monotonicTimeNanos)
            record.unsafeClockAtTick.push(clock.currentTimeMillisUnsafe())
            record.unsafeNanosAtTick.push(clock.currentTimeNanosUnsafe())
            record.unsafeMonotonicAtTick.push(clock.monotonicTimeNanosUnsafe())
            yield* clock.sleep(Duration.seconds(0))
            record.randomAtTick.push(yield* Random.next)
          }),
          saveSlices: slices(),
        }
      }),
    },
  }
}

const harnessLayer = (runtime: HeadlessHarnessSessionFactory['Service']) =>
  HeadlessHarnessTestLayer.pipe(
    Layer.provide(Layer.succeed(HeadlessHarnessSessionFactory, runtime)),
  )

const resetInput = (worldSeed: number, randomSeed: number): HeadlessHarnessResetInput => ({
  worldSeed: makeNoiseSeed(worldSeed),
  randomSeed: makeRandomSeed(randomSeed),
})

describe('headless harness schemas', () => {
  it('accepts named seed, tick-count, and hash values and rejects invalid values', () => {
    expect(Schema.decodeUnknownResult(TickCountSchema)(1)._tag).toBe('Success')
    expect(Schema.decodeUnknownResult(RandomSeedSchema)(-12)._tag).toBe('Success')
    expect(Schema.decodeUnknownResult(StateHashSchema)('a'.repeat(64))._tag).toBe('Success')
    expect(Result.isFailure(Schema.decodeUnknownResult(TickCountSchema)(0))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(TickCountSchema)(1.5))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(RandomSeedSchema)(1.5))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(StateHashSchema)('A'.repeat(64)))).toBe(true)
  })
})

describe('HeadlessHarness lifecycle and stepping', () => {
  it.effect('initializes from both seeds, closes the previous session, resets clock, and reproduces Random', () => {
    const runtime = makeRuntime()
    return Effect.gen(function* () {
      const harness = yield* HeadlessHarness

      yield* harness.reset(resetInput(23, 91))
      yield* harness.step(makeTickCount(2))
      yield* harness.reset(resetInput(23, 91))
      yield* harness.step(makeTickCount(1))

      expect(runtime.sessions).toHaveLength(2)
      expect(runtime.sessions.map(({ worldSeed }) => worldSeed)).toEqual([makeNoiseSeed(23), makeNoiseSeed(23)])
      expect(runtime.sessions[0]?.closed).toEqual([true])
      expect(runtime.events).toEqual(['open:0', 'close:0', 'open:1'])
      expect(runtime.sessions[0]?.ticks).toEqual([1, 2])
      expect(runtime.sessions[1]?.ticks).toEqual([1])
      expect(runtime.sessions[0]?.clockAtTick).toEqual([50, 100])
      expect(runtime.sessions[1]?.clockAtTick).toEqual([50])
      expect(runtime.sessions[0]?.monotonicAtTick).toEqual([50_000_000n, 100_000_000n])
      expect(runtime.sessions[1]?.monotonicAtTick).toEqual([50_000_000n])
      expect(runtime.sessions[1]?.randomAtOpen).toBe(runtime.sessions[0]?.randomAtOpen)
      expect(runtime.sessions[1]?.randomAtTick[0]).toBe(runtime.sessions[0]?.randomAtTick[0])
    }).pipe(Effect.provide(harnessLayer(runtime.service)))
  })

  it.effect('forwards typed intents, processes due entries once per exact tick, and preserves queue failures', () => {
    const runtime = makeRuntime(() => [], 1)
    return Effect.gen(function* () {
      const harness = yield* HeadlessHarness
      yield* harness.reset(resetInput(5, 7))

      expect(yield* harness.enqueue(makeIntent('due-at-two', 2))).toBe(0)
      const full = yield* Effect.result(harness.enqueue(makeIntent('capacity-rejected', 3)))
      expect(Result.isFailure(full)).toBe(true)
      if (Result.isFailure(full)) {
        expect(full.failure).toBeInstanceOf(IntentQueueFull)
        if (full.failure instanceof IntentQueueFull) expect(full.failure.capacity).toBe(makeQueueCapacity(1))
      }

      yield* harness.step(makeTickCount(2))
      expect(yield* harness.enqueue(makeIntent('next-admission', 3))).toBe(1)
      yield* harness.step(makeTickCount(1))

      expect(runtime.sessions[0]?.ticks).toEqual([1, 2, 3])
      expect(runtime.sessions[0]?.ready).toEqual([[], ['due-at-two'], ['next-admission']])
      expect(runtime.sessions[0]?.clockAtTick).toEqual([50, 100, 150])
    }).pipe(Effect.provide(harnessLayer(runtime.service)))
  })

  it.effect('requires reset before using the session and reset discards the prior C2 queue', () => {
    const runtime = makeRuntime()
    return Effect.gen(function* () {
      const harness = yield* HeadlessHarness
      const uninitializedStep = yield* Effect.result(harness.step(makeTickCount(1)))
      const uninitializedEnqueue = yield* Effect.result(harness.enqueue(makeIntent('before-reset', 1)))
      expect(Result.isFailure(uninitializedStep)).toBe(true)
      expect(Result.isFailure(uninitializedEnqueue)).toBe(true)
      if (Result.isFailure(uninitializedStep)) {
        expect(uninitializedStep.failure).toBeInstanceOf(HeadlessHarnessNotInitialized)
      }
      const uninitializedHash = yield* Effect.result(harness.stateHash)
      expect(Result.isFailure(uninitializedHash)).toBe(true)
      if (Result.isFailure(uninitializedHash)) {
        expect(uninitializedHash.failure).toBeInstanceOf(HeadlessHarnessNotInitialized)
      }

      yield* harness.reset(resetInput(1, 2))
      yield* harness.enqueue(makeIntent('discarded', 1))
      yield* harness.reset(resetInput(3, 4))
      expect(yield* harness.enqueue(makeIntent('new-session', 1))).toBe(0)
      yield* harness.step(makeTickCount(1))

      expect(runtime.sessions[0]?.closed).toEqual([true])
      expect(runtime.sessions[0]?.ready).toEqual([])
      expect(runtime.sessions[1]?.ready).toEqual([['new-session']])
      expect(runtime.events).toEqual(['open:0', 'close:0', 'open:1'])
    }).pipe(Effect.provide(harnessLayer(runtime.service)))
  })

  it.effect('advances the test Clock by exactly the number of stepped ticks', () => {
    let observedClock = -1
    let observedMonotonicClock = -1n
    const runtime = makeRuntime(() => [{
      ...makeSlice('clock', 1, 0, Schema.Number),
      snapshot: Effect.gen(function* () {
        observedClock = yield* Clock.currentTimeMillis
        observedMonotonicClock = yield* Clock.monotonicTimeNanos
        return observedClock
      }),
    }])
    return Effect.gen(function* () {
      const harness = yield* HeadlessHarness
      yield* harness.reset(resetInput(8, 13))
      yield* harness.step(makeTickCount(3))
      yield* harness.stateHash

      expect(observedClock).toBe(150)
      expect(observedMonotonicClock).toBe(150_000_000n)
      expect(runtime.sessions[0]?.ticks).toEqual([1, 2, 3])
      expect(runtime.sessions[0]?.unsafeClockAtTick).toEqual([50, 100, 150])
      expect(runtime.sessions[0]?.unsafeNanosAtTick).toEqual([50_000_000n, 100_000_000n, 150_000_000n])
      expect(runtime.sessions[0]?.unsafeMonotonicAtTick).toEqual([50_000_000n, 100_000_000n, 150_000_000n])
    }).pipe(Effect.provide(harnessLayer(runtime.service)))
  })
})

describe('HeadlessHarness stateHash', () => {
  it.effect('hashes all slices with UTF-16 key sorting, JS scalar formatting, and array order', () => {
    const astralKey = '\u{10000}'
    const privateUseKey = '\uE000'
    const slices = [
      makeSlice('b', 1, { middle: true }),
      makeSlice('z', 1, {
        '2': 'two',
        '10': 'ten',
        nested: { [privateUseKey]: 'private', [astralKey]: 'astral', β: 'b', a: 1 },
      }),
      makeSlice('a', 2, [true, null, -0, 1e21, 1e-7, 1e-6, '🧠']),
      makeSlice('a', 3, { duplicate: true }),
    ]
    const runtime = makeRuntime(() => slices)
    return Effect.gen(function* () {
      const harness = yield* HeadlessHarness
      yield* harness.reset(resetInput(8, 13))

      const actual = yield* harness.stateHash
      const canonical = `{"a":{"data":[true,null,0,1e+21,1e-7,0.000001,"🧠"],"version":2},"a":{"data":{"duplicate":true},"version":3},"b":{"data":{"middle":true},"version":1},"z":{"data":{"10":"ten","2":"two","nested":{"a":1,"β":"b","${astralKey}":"astral","${privateUseKey}":"private"}},"version":1}}`
      const expected = createHash('sha256').update(canonical, 'utf8').digest('hex')
      expect(actual).toBe(expected)
      expect(Schema.decodeUnknownResult(StateHashSchema)(actual)._tag).toBe('Success')
    }).pipe(Effect.provide(harnessLayer(runtime.service)))
  })

  it.effect('includes each slice ID, version, and encoded data in the hash', () => {
    let slices = [makeSlice('player', 1, { health: 20 })]
    const runtime = makeRuntime(() => slices)
    return Effect.gen(function* () {
      const harness = yield* HeadlessHarness
      yield* harness.reset(resetInput(8, 13))
      const baseline = yield* harness.stateHash

      slices = [makeSlice('player', 2, { health: 20 })]
      yield* harness.reset(resetInput(8, 13))
      const versionChanged = yield* harness.stateHash
      slices = [makeSlice('player', 2, { health: 19 })]
      yield* harness.reset(resetInput(8, 13))
      const dataChanged = yield* harness.stateHash
      slices = [makeSlice('player-state', 2, { health: 19 })]
      yield* harness.reset(resetInput(8, 13))
      const idChanged = yield* harness.stateHash

      expect(versionChanged).not.toBe(baseline)
      expect(dataChanged).not.toBe(versionChanged)
      expect(idChanged).not.toBe(dataChanged)
    }).pipe(Effect.provide(harnessLayer(runtime.service)))
  })

  it.effect('rejects every non-JSON value with the slice ID and exact path', () => {
    let value: unknown = null
    const slice = makeSlice('problem', 1, null)
    const runtime = makeRuntime(() => [{ ...slice, snapshot: Effect.sync(() => value) }])
    return Effect.gen(function* () {
      const harness = yield* HeadlessHarness
      yield* harness.reset(resetInput(2, 3))

      let getterCalls = 0
      const accessor = Object.defineProperty({}, 'hidden', {
        get: () => { getterCalls += 1; return 'never-read' },
        enumerable: true,
      })
      const nonEnumerable = Object.defineProperty({}, 'hidden', { value: 1, enumerable: false })
      const symbolKey = { [Symbol('hidden')]: 1 }
      const sparse = new Array(1)
      const sparsePrototype = Object.setPrototypeOf([1], Object.create(Array.prototype))
      const symbolArrayProperty = Object.assign([1], { [Symbol('hidden')]: 1 })
      const accessorArrayElement = Object.defineProperty([], '0', {
        get: () => { getterCalls += 1; return 'never-read' },
        enumerable: true,
      })
      const extraArrayProperty = [1]
      Object.defineProperty(extraArrayProperty, 'extra', { value: 2, enumerable: true })
      const nonEnumerableArrayElement = [1]
      Object.defineProperty(nonEnumerableArrayElement, '0', { value: 1, enumerable: false })
      const cyclic: Record<string, unknown> = {}
      cyclic['self'] = cyclic
      const shared = {}
      const sharedReference = { left: shared, right: shared }
      const cases: ReadonlyArray<readonly [unknown, string]> = [
        [undefined, '$'],
        [[undefined], '$[0]'],
        [1n, '$'],
        [Symbol('value'), '$'],
        [() => undefined, '$'],
        [Number.POSITIVE_INFINITY, '$'],
        [{ nested: undefined }, '$["nested"]'],
        [sparse, '$[0]'],
        [sparsePrototype, '$'],
        [symbolArrayProperty, '$'],
        [accessorArrayElement, '$[0]'],
        [accessor, '$["hidden"]'],
        [nonEnumerable, '$["hidden"]'],
        [symbolKey, '$'],
        [new Map(), '$'],
        [Object.create({ inherited: true }), '$'],
        [extraArrayProperty, '$["extra"]'],
        [nonEnumerableArrayElement, '$[0]'],
        [cyclic, '$["self"]'],
      ]

      for (const [invalid, path] of cases) {
        value = invalid
        const result = yield* Effect.result(harness.stateHash)
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(StateHashNonJsonValue)
          if (result.failure instanceof StateHashNonJsonValue) {
            expect(result.failure.sliceId).toBe(makeSaveSliceId('problem'))
            expect(result.failure.path).toBe(path)
          }
        }
      }

      value = Object.assign(Object.create(null), { accepted: [null, true, 1, 'text'] })
      expect(Result.isSuccess(yield* Effect.result(harness.stateHash))).toBe(true)
      value = sharedReference
      expect(Result.isSuccess(yield* Effect.result(harness.stateHash))).toBe(true)
      expect(getterCalls).toBe(0)
    }).pipe(Effect.provide(harnessLayer(runtime.service)))
  })

  it.effect('returns a typed failure when stateHash cannot inspect a proxy prototype', () => {
    const proxy = new Proxy({}, {
      getPrototypeOf: () => { throw new Error('prototype inspection failed') },
    })
    const runtime = makeRuntime(() => [makeSlice('proxy', 1, proxy)])
    return Effect.gen(function* () {
      const harness = yield* HeadlessHarness
      yield* harness.reset(resetInput(2, 3))

      const result = yield* Effect.result(harness.stateHash)
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(StateHashNonJsonValue)
        if (result.failure instanceof StateHashNonJsonValue) {
          expect(result.failure.sliceId).toBe(makeSaveSliceId('proxy'))
          expect(result.failure.path).toBe('$')
        }
      }
    }).pipe(Effect.provide(harnessLayer(runtime.service)))
  })

  it.effect('propagates slice codec errors and does not return a partial hash', () => {
    const runtime = makeRuntime(() => [
      makeSlice('good', 1, { ok: true }),
      makeSlice('bad', 1, { value: 1 }, Schema.Struct({ value: Schema.String })),
    ])
    return Effect.gen(function* () {
      const harness = yield* HeadlessHarness
      yield* harness.reset(resetInput(2, 3))
      const result = yield* Effect.result(harness.stateHash)

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) expect(result.failure._tag).toBe('SchemaError')
    }).pipe(Effect.provide(harnessLayer(runtime.service)))
  })

  it.effect('hashes an empty registry as an empty object and rejects non-JSON versions', () => {
    let slices: ReadonlyArray<HeadlessSaveSlice> = []
    const runtime = makeRuntime(() => slices)
    return Effect.gen(function* () {
      const harness = yield* HeadlessHarness
      yield* harness.reset(resetInput(2, 3))
      expect(yield* harness.stateHash).toBe(createHash('sha256').update('{}', 'utf8').digest('hex'))

      const badVersion = Brand.nominal<SaveVersion>()(Number.NaN)
      slices = [{ ...makeSlice('bad-version', 1, null), version: badVersion }]
      yield* harness.reset(resetInput(2, 3))
      const result = yield* Effect.result(harness.stateHash)
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(StateHashNonJsonValue)
        if (result.failure instanceof StateHashNonJsonValue) expect(result.failure.path).toBe('$["version"]')
      }
    }).pipe(Effect.provide(harnessLayer(runtime.service)))
  })
})
