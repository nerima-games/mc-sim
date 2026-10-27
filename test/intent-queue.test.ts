import { describe, expect, it } from '@effect/vitest'
import { Brand, Effect, Result, Schema } from 'effect'
import type { SimulationTick } from '@nerima-games/mc-kernel'
import type { IntentQueueCapacity } from '../src/application/intent-queue'
import {
  IntentIdSchema,
  IntentPayloadSchema,
  IntentQueue,
  IntentQueueCapacitySchema,
  IntentQueueFull,
  IntentQueueLayer,
  IntentSchema,
  IntentSequenceSchema,
} from '../src/application/intent-queue'

const address = {
  dimension: 'overworld',
  position: { x: 0, y: 64, z: 0 },
}

const validPayloads: ReadonlyArray<Readonly<Record<string, unknown>>> = [
  { _tag: 'BreakBlock', actor: 'actor-1', address },
  { _tag: 'PlaceBlock', actor: 'actor-1', address, block: 1 },
  { _tag: 'UseItem', actor: 'actor-1', item: 1 },
  { _tag: 'MineBlockInput', actor: 'actor-1', address, action: 'start' },
  { _tag: 'UseBlock', actor: 'actor-1', address, face: 'up' },
  { _tag: 'LeaveSleep', actor: 'actor-1' },
  { _tag: 'UseItemOnBlock', actor: 'actor-1', item: 1, address, face: 'north' },
  { _tag: 'UseItemOnEntity', actor: 'actor-1', item: 1, target: 'target-1' },
  { _tag: 'MeleeAttack', actor: 'actor-1' },
  { _tag: 'BowAction', actor: 'actor-1', action: 'release', aimDirection: { x: 0, y: 1, z: 0 } },
  { _tag: 'FishingAction', actor: 'actor-1', action: 'cast' },
  { _tag: 'TradeVillager', actor: 'actor-1', villager: 'villager-1', offerId: 'offer-1' },
  { _tag: 'VehicleAction', actor: 'actor-1', vehicle: 'vehicle-1', action: 'mount' },
  {
    _tag: 'VehicleControl',
    actor: 'actor-1',
    vehicle: 'vehicle-1',
    throttle: 1,
    steering: -1,
  },
  { _tag: 'ApplyEnchantmentOffer', actor: 'actor-1', station: address, offerSlot: 2 },
  { _tag: 'SetShieldBlocking', actor: 'actor-1', blocking: true },
  { _tag: 'ThrowEnderPearl', actor: 'actor-1', aimDirection: { x: 0, y: 0, z: -1 } },
]

const makeIntentQueueCapacity = Brand.nominal<IntentQueueCapacity>()
const makeSimulationTick = Brand.nominal<SimulationTick>()

const decodeIntent = (input: unknown) =>
  Effect.fromResult(Schema.decodeUnknownResult(IntentSchema)(input))

const localIntent = (id: string, targetTick: number, payload: unknown): unknown => ({
  id,
  targetTick,
  source: 'local',
  payload,
})

const useItemPayload = { _tag: 'UseItem', actor: 'actor-1', item: 1 }

describe('IntentQueue schemas', () => {
  it.effect('decodes local and network envelopes for all payload tags', () =>
    Effect.gen(function* () {
      for (const [index, payload] of validPayloads.entries()) {
        const decoded = yield* decodeIntent(localIntent(`local-${index}`, 4, payload))
        expect(decoded.payload).toStrictEqual(payload)
      }

      const network = yield* decodeIntent({
        id: 'network-1',
        targetTick: 5,
        source: 'network',
        payload: useItemPayload,
        expectedRevision: 8,
        expectedDimensionRevision: 3,
      })
      expect(network.source).toBe('network')
      if (network.source === 'network') {
        expect(network.expectedRevision).toBe(8)
        expect(network.expectedDimensionRevision).toBe(3)
      }
    }),
  )

  it('rejects unknown tags, invalid action and numeric values, missing network revisions, and invalid brands', () => {
    const decode = Schema.decodeUnknownResult(IntentSchema)
    const invalidInputs: ReadonlyArray<unknown> = [
      localIntent('unknown', 1, { _tag: 'NotAnIntent', actor: 'actor-1' }),
      localIntent('action', 1, { _tag: 'MineBlockInput', actor: 'actor-1', address, action: 'dig' }),
      localIntent('throttle', 1, {
        _tag: 'VehicleControl',
        actor: 'actor-1',
        vehicle: 'vehicle-1',
        throttle: 1.01,
        steering: 0,
      }),
      localIntent('vehicle-id', 1, {
        _tag: 'VehicleAction',
        actor: 'actor-1',
        vehicle: '   ',
        action: 'mount',
      }),
      localIntent('slot', 1, { _tag: 'ApplyEnchantmentOffer', actor: 'actor-1', station: address, offerSlot: 3 }),
      localIntent('direction', 1, {
        _tag: 'ThrowEnderPearl',
        actor: 'actor-1',
        aimDirection: { x: 0, y: Number.POSITIVE_INFINITY, z: 0 },
      }),
      {
        id: 'network-missing-revisions',
        targetTick: 1,
        source: 'network',
        payload: useItemPayload,
      },
    ]

    for (const input of invalidInputs) {
      expect(Result.isFailure(decode(input))).toBe(true)
    }
    expect(Result.isFailure(Schema.decodeUnknownResult(IntentQueueCapacitySchema)(0))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(IntentSequenceSchema)(-1))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(IntentIdSchema)(''))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(IntentPayloadSchema)({ _tag: 'Missing' }))).toBe(true)
  })
})

describe('IntentQueue', () => {
  it.effect('assigns zero-based admission sequences and orders due entries by tick then sequence', () =>
    Effect.gen(function* () {
      const queue = yield* IntentQueue
      const later = yield* decodeIntent(localIntent('later', 5, useItemPayload))
      const earlierA = yield* decodeIntent(localIntent('earlier-a', 3, useItemPayload))
      const earlierB = yield* decodeIntent(localIntent('earlier-b', 3, useItemPayload))

      expect(yield* queue.enqueue(later)).toBe(0)
      expect(yield* queue.enqueue(earlierA)).toBe(1)
      expect(yield* queue.enqueue(earlierB)).toBe(2)

      const readyAtThree = yield* queue.takeReady(makeSimulationTick(3))
      expect(readyAtThree.map(({ sequence, intent }) => [sequence, intent.id])).toStrictEqual([
        [1, 'earlier-a'],
        [2, 'earlier-b'],
      ])

      const future = yield* decodeIntent(localIntent('future', 4, useItemPayload))
      yield* queue.enqueue(future)
      const readyAtFive = yield* queue.takeReady(makeSimulationTick(5))
      expect(readyAtFive.map(({ sequence, intent }) => [sequence, intent.id])).toStrictEqual([
        [3, 'future'],
        [0, 'later'],
      ])
      expect(yield* queue.takeReady(makeSimulationTick(6))).toStrictEqual([])
    }).pipe(Effect.provide(IntentQueueLayer({ capacity: makeIntentQueueCapacity(4) }))),
  )

  it.effect('returns typed capacity failure without allocating a sequence', () =>
    Effect.gen(function* () {
      const queue = yield* IntentQueue
      const first = yield* decodeIntent(localIntent('first', 1, useItemPayload))
      const second = yield* decodeIntent(localIntent('second', 2, useItemPayload))

      expect(yield* queue.enqueue(first)).toBe(0)
      const rejected = yield* Effect.result(queue.enqueue(second))
      expect(Result.isFailure(rejected)).toBe(true)
      if (Result.isFailure(rejected)) {
        expect(rejected.failure).toBeInstanceOf(IntentQueueFull)
        expect(rejected.failure.capacity).toBe(makeIntentQueueCapacity(1))
      }

      const consumed = yield* queue.takeReady(makeSimulationTick(1))
      expect(consumed.map(({ sequence }) => sequence)).toStrictEqual([0])
      expect(yield* queue.enqueue(second)).toBe(1)
    }).pipe(Effect.provide(IntentQueueLayer({ capacity: makeIntentQueueCapacity(1) }))),
  )

  it.effect('consumes ready entries once and does not requeue them', () =>
    Effect.gen(function* () {
      const queue = yield* IntentQueue
      const intent = yield* decodeIntent(localIntent('once', 2, useItemPayload))
      yield* queue.enqueue(intent)

      const firstTake = yield* queue.takeReady(makeSimulationTick(2))
      const secondTake = yield* queue.takeReady(makeSimulationTick(2))

      expect(firstTake.map(({ intent: ready }) => ready.id)).toStrictEqual(['once'])
      expect(secondTake).toStrictEqual([])
    }).pipe(Effect.provide(IntentQueueLayer({ capacity: makeIntentQueueCapacity(1) }))),
  )
})
