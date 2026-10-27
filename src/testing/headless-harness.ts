import { createHash } from 'node:crypto'
import { Brand, Clock, Context, Duration, Effect, Layer, Random, Ref, Schema, Semaphore } from 'effect'
import type { YieldableError } from 'effect/Cause'
import { TestClock } from 'effect/testing'
import { SaveSliceIdSchema, tickDuration } from '@nerima-games/mc-kernel'
import type { Intent, IntentSequence, IntentQueueFull } from '../application/intent-queue.js'
import type { SimulationTick } from '@nerima-games/mc-kernel'
import type { NoiseSeed } from '@nerima-games/mc-worldgen'
import {
  HeadlessHarnessSessionFactory,
  type HeadlessHarnessSession,
  type HeadlessHarnessStages,
} from './session-factory.js'

export type TickCount = number & Brand.Brand<'TickCount'>
export type RandomSeed = number & Brand.Brand<'RandomSeed'>
export type StateHash = string & Brand.Brand<'StateHash'>

export const TickCountSchema: Schema.Codec<TickCount, number> = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand('TickCount'))
export const RandomSeedSchema: Schema.Codec<RandomSeed, number> = Schema.Int.pipe(Schema.brand('RandomSeed'))
const NoiseSeedSchema: Schema.Codec<NoiseSeed, number> = Schema.Int.check(
  Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
).pipe(Schema.brand('NoiseSeed'))

export const StateHashSchema: Schema.Codec<StateHash, string> = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(Schema.brand('StateHash'))

export type HeadlessHarnessResetInput = {
  readonly worldSeed: NoiseSeed
  readonly randomSeed: RandomSeed
}

const HeadlessHarnessResetInputSchema: Schema.Codec<HeadlessHarnessResetInput, unknown> = Schema.Struct({
  worldSeed: NoiseSeedSchema,
  randomSeed: RandomSeedSchema,
})

type StateHashNonJsonValueFields = Readonly<{
  sliceId: Schema.Schema.Type<typeof SaveSliceIdSchema>
  path: string
}>
const StateHashNonJsonValueBase: new (args: StateHashNonJsonValueFields) =>
  YieldableError & { readonly _tag: 'StateHashNonJsonValue' } & StateHashNonJsonValueFields =
  Schema.TaggedError<StateHashNonJsonValue>()('StateHashNonJsonValue', {
    sliceId: SaveSliceIdSchema,
    path: Schema.NonEmptyString,
  })
export class StateHashNonJsonValue extends StateHashNonJsonValueBase {}

const HeadlessHarnessNotInitializedBase: new () =>
  YieldableError & { readonly _tag: 'HeadlessHarnessNotInitialized' } =
  Schema.TaggedError<HeadlessHarnessNotInitialized>()('HeadlessHarnessNotInitialized', {})
export class HeadlessHarnessNotInitialized extends HeadlessHarnessNotInitializedBase {}

export type HeadlessHarnessApi = {
  readonly reset: (input: HeadlessHarnessResetInput) => Effect.Effect<void, Schema.SchemaError>
  readonly enqueue: (intent: Intent) => Effect.Effect<
    IntentSequence,
    IntentQueueFull | HeadlessHarnessNotInitialized | Schema.SchemaError
  >
  readonly step: (count: TickCount) => Effect.Effect<void, HeadlessHarnessNotInitialized | Schema.SchemaError>
  readonly stateHash: Effect.Effect<
    StateHash,
    Schema.SchemaError | StateHashNonJsonValue | HeadlessHarnessNotInitialized
  >
}

const HeadlessHarnessBase: Context.ServiceClass<
  HeadlessHarness,
  'mc-sim/testing/HeadlessHarness',
  HeadlessHarnessApi
> = Context.Service<HeadlessHarness, HeadlessHarnessApi>()('mc-sim/testing/HeadlessHarness')

export class HeadlessHarness extends HeadlessHarnessBase {}

type ActiveSession = {
  readonly tick: SimulationTick
  readonly random: Random.Random
  readonly clock: Clock.Clock
  readonly session: HeadlessHarnessSession
}

const makeSimulationTick = Brand.nominal<SimulationTick>()

const makeSessionClock = (testClock: Clock.Clock): Clock.Clock => {
  const monotonicOrigin = testClock.monotonicTimeNanosUnsafe()
  return {
    currentTimeMillisUnsafe: () => testClock.currentTimeMillisUnsafe(),
    currentTimeMillis: testClock.currentTimeMillis,
    currentTimeNanosUnsafe: () => testClock.currentTimeNanosUnsafe(),
    currentTimeNanos: testClock.currentTimeNanos,
    monotonicTimeNanosUnsafe: () => testClock.monotonicTimeNanosUnsafe() - monotonicOrigin,
    monotonicTimeNanos: Effect.map(
      testClock.monotonicTimeNanos,
      (now) => now - monotonicOrigin,
    ),
    sleep: (duration) => testClock.sleep(duration),
  }
}

type JsonSerialization =
  | { readonly _tag: 'Valid'; readonly json: string }
  | { readonly _tag: 'Invalid'; readonly path: string }

type JsonSerializer = (
  value: unknown,
  path: string,
  ancestors?: ReadonlySet<object>,
) => JsonSerialization

const validJson = (json: string): JsonSerialization => ({ _tag: 'Valid', json })
const invalidJson = (path: string): JsonSerialization => ({ _tag: 'Invalid', path })

const pathForProperty = (path: string, property: string): string => `${path}[${JSON.stringify(property)}]`

const isArrayIndex = (key: string, length: number): boolean => {
  const index = Number(key)
  return Number.isInteger(index) && index >= 0 && index < length && String(index) === key
}

const validateArrayKeys = (value: ReadonlyArray<unknown>, path: string): JsonSerialization | undefined => {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') return invalidJson(path)
    if (key !== 'length' && !isArrayIndex(key, value.length)) return invalidJson(pathForProperty(path, key))
  }
  return undefined
}

const serializeArray = (
  value: ReadonlyArray<unknown>,
  path: string,
  ancestors: ReadonlySet<object>,
  serialize: JsonSerializer,
): JsonSerialization => {
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return invalidJson(path)
  } catch {
    return invalidJson(path)
  }

  const invalidKey = validateArrayKeys(value, path)
  if (invalidKey !== undefined) return invalidKey

  const elements: Array<string> = []
  for (let index = 0; index < value.length; index += 1) {
    const elementPath = `${path}[${index}]`
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return invalidJson(elementPath)
    }
    const serialized = serialize(descriptor.value, elementPath, ancestors)
    if (serialized._tag === 'Invalid') return serialized
    elements.push(serialized.json)
  }
  return validJson(`[${elements.join(',')}]`)
}

const serializeObject = (
  value: object,
  path: string,
  ancestors: ReadonlySet<object>,
  serialize: JsonSerializer,
): JsonSerialization => {
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    return invalidJson(path)
  }
  if (prototype !== Object.prototype && prototype !== null) return invalidJson(path)

  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key === 'symbol')) return invalidJson(path)
  const keys = ownKeys.filter((key): key is string => typeof key === 'string').sort()
  const properties: Array<string> = []

  for (const key of keys) {
    const propertyPath = pathForProperty(path, key)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return invalidJson(propertyPath)
    }
    const serialized = serialize(descriptor.value, propertyPath, ancestors)
    if (serialized._tag === 'Invalid') return serialized
    properties.push(`${JSON.stringify(key)}:${serialized.json}`)
  }

  return validJson(`{${properties.join(',')}}`)
}

const serializeJson = (
  value: unknown,
  path: string,
  ancestors: ReadonlySet<object> = new Set(),
): JsonSerialization => {
  if (value === null) return validJson('null')
  if (typeof value === 'string' || typeof value === 'boolean') return validJson(JSON.stringify(value))
  if (typeof value === 'number') return Number.isFinite(value) ? validJson(JSON.stringify(value)) : invalidJson(path)
  if (typeof value !== 'object') return invalidJson(path)

  if (ancestors.has(value)) return invalidJson(path)
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(value)

  return Array.isArray(value)
    ? serializeArray(value, path, nextAncestors, serializeJson)
    : serializeObject(value, path, nextAncestors, serializeJson)
}

const makeHeadlessHarness = (
  stages: HeadlessHarnessStages,
): Effect.Effect<HeadlessHarnessApi, never, HeadlessHarnessSessionFactory> =>
  Effect.gen(function* () {
    const factory = yield* HeadlessHarnessSessionFactory
    const testClock = yield* TestClock.testClockWith((clock) => Effect.succeed(clock))
    const state = yield* Ref.make<ActiveSession | undefined>(undefined)
    const semaphore = yield* Semaphore.make(1)

    const withSession = <A, E extends YieldableError>(
      f: (current: ActiveSession) => Effect.Effect<A, E>,
    ): Effect.Effect<A, E | HeadlessHarnessNotInitialized> =>
      Effect.flatMap(Ref.get(state), (current): Effect.Effect<A, E | HeadlessHarnessNotInitialized> =>
        current === undefined
          ? Effect.fail(new HeadlessHarnessNotInitialized())
          : f(current),
      )

    const withRuntimeServices = <A, E>(
      effect: Effect.Effect<A, E>,
      random: Random.Random,
      clock: Clock.Clock,
    ): Effect.Effect<A, E> =>
      Effect.provideService(
        Effect.provideService(effect, Clock.Clock, clock),
        Random.Random,
        random,
      )

    return {
      reset: (input: HeadlessHarnessResetInput) =>
        semaphore.withPermit(Effect.gen(function* () {
          const validInput = yield* Schema.decodeUnknownEffect(HeadlessHarnessResetInputSchema)(input)
          const previous = yield* Ref.get(state)
          if (previous !== undefined) {
            yield* withRuntimeServices(previous.session.close, previous.random, previous.clock)
          }

          yield* Ref.set(state, undefined)
          yield* testClock.setTime(0)

          const random = yield* Random.withSeed(validInput.randomSeed)(Random.Random)
          const clock = makeSessionClock(testClock)
          const session = yield* withRuntimeServices(factory.open(validInput.worldSeed, stages), random, clock)
          yield* Ref.set(state, { tick: makeSimulationTick(0), random, clock, session })
        })),
      enqueue: (intent: Intent): Effect.Effect<
        IntentSequence,
        IntentQueueFull | HeadlessHarnessNotInitialized | Schema.SchemaError
      > =>
        semaphore.withPermit(withSession((current) => current.session.intents.enqueue(intent))),
      step: (count: TickCount): Effect.Effect<void, HeadlessHarnessNotInitialized | Schema.SchemaError> =>
        semaphore.withPermit(
          Schema.decodeUnknownEffect(TickCountSchema)(count).pipe(
            Effect.flatMap((validCount) => Effect.gen(function* () {
              for (let index = 0; index < validCount; index += 1) {
                const current = yield* withSession(Effect.succeed)
                const nextTick = makeSimulationTick(current.tick + 1)
                yield* testClock.adjust(Duration.seconds(tickDuration))
                const ready = yield* current.session.intents.takeReady(nextTick)
                yield* withRuntimeServices(current.session.runTick(nextTick, ready), current.random, current.clock)
                yield* Ref.set(state, { ...current, tick: nextTick })
              }
            })),
          ),
        ),
      stateHash: semaphore.withPermit(Effect.gen(function* () {
        const current = yield* withSession(Effect.succeed)
        const entries: Array<readonly [string, string]> = []

        for (const slice of current.session.saveSlices) {
          const snapshot = yield* withRuntimeServices(slice.snapshot, current.random, current.clock)
          const data = yield* Schema.encodeUnknownEffect(slice.schema)(snapshot)
          const dataJson = serializeJson(data, '$')
          if (dataJson._tag === 'Invalid') {
            return yield* Effect.fail(new StateHashNonJsonValue({ sliceId: slice.id, path: dataJson.path }))
          }

          const versionJson = serializeJson(slice.version, '$["version"]')
          if (versionJson._tag === 'Invalid') {
            return yield* Effect.fail(new StateHashNonJsonValue({ sliceId: slice.id, path: versionJson.path }))
          }

          const valueJson = `{"data":${dataJson.json},"version":${versionJson.json}}`
          entries.push([slice.id, valueJson])
        }

        entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        const canonical = `{${entries.map(([id, value]) => `${JSON.stringify(id)}:${value}`).join(',')}}`
        const digest = createHash('sha256').update(canonical, 'utf8').digest('hex')
        return yield* Schema.decodeUnknownEffect(StateHashSchema)(digest)
      })),
    }
  })

export const HeadlessHarnessTestLayer = (
  stages: HeadlessHarnessStages,
): Layer.Layer<HeadlessHarness, never, HeadlessHarnessSessionFactory> =>
  Layer.effect(HeadlessHarness, makeHeadlessHarness(stages)).pipe(Layer.provide(TestClock.layer()))
