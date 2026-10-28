import { describe, expect, it } from '@effect/vitest'
import {
  EntityIdSchema,
  ProjectileIdSchema,
  SimulationTickSchema,
  WorldIdSchema,
  WorldRevisionSchema,
  itemIdOf,
} from '@nerima-games/mc-kernel'
import { Effect, Layer, Random, Result, Schema, Stream } from 'effect'
import {
  WorldCommitCoordinator,
  WorldCommitCoordinatorLayer,
  WorldRevisionConflict,
} from '../src/application/world-commit-coordinator.js'
import type { WorldCommitCoordinatorApi } from '../src/application/world-commit-coordinator.js'
import {
  DomainEventBus,
  type DomainEvent,
  type DomainEventBusApi,
} from '../src/application/domain-event-bus.js'
import { ReplicatedOwnerIdSchema } from '../src/application/replicated-state.js'
import {
  FishingService,
  FishingServiceLayer,
  fishingOwnerRegistration,
} from '../src/application/fishing-service.js'
import {
  castFishingRod,
  emptyFishingState,
  fishingLootForSample,
  registerFishingBite,
  reelFishingRod,
  FishingStateSchema,
} from '../src/domain/fishing.js'
import { RandomSeedSchema } from '../src/testing/headless-harness.js'

const ownerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('fishing')
const world = Schema.decodeUnknownSync(WorldIdSchema)('fishing-test-world')
const actor = Schema.decodeUnknownSync(EntityIdSchema)('angler-1')
const actorA = Schema.decodeUnknownSync(EntityIdSchema)('angler-a')
const actorZ = Schema.decodeUnknownSync(EntityIdSchema)('angler-z')
const bobber = Schema.decodeUnknownSync(ProjectileIdSchema)('bobber-1')
const secondBobber = Schema.decodeUnknownSync(ProjectileIdSchema)('bobber-2')
const thirdBobber = Schema.decodeUnknownSync(ProjectileIdSchema)('bobber-3')
const tick = Schema.decodeUnknownSync(SimulationTickSchema)(7)

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const eventRecorder = (published: DomainEvent[]) =>
  Layer.succeed(DomainEventBus, {
    publish: (event) => Effect.sync(() => { published.push(event) }),
    events: Stream.empty,
  } satisfies DomainEventBusApi)

const coordinatorLayer = (ownerState = emptyFishingState()) =>
  WorldCommitCoordinatorLayer({
    world,
    owners: [{
      ...fishingOwnerRegistration(ownerId),
      initialState: ownerState,
    }],
  })

const fishingLayer = (
  published: DomainEvent[],
  ownerState = emptyFishingState(),
) => FishingServiceLayer(ownerId).pipe(
  Layer.provide(Layer.mergeAll(coordinatorLayer(ownerState), eventRecorder(published))),
)

const failingCoordinator = (
  coordinator: WorldCommitCoordinatorApi,
): WorldCommitCoordinatorApi => ({
  ...coordinator,
  commit: (request) => Schema.decodeUnknownEffect(WorldRevisionSchema)(request.expectedRevision + 1).pipe(
    Effect.flatMap((actual) => Effect.fail(new WorldRevisionConflict({
      expected: request.expectedRevision,
      actual,
    }))),
  ),
})

describe('FishingService', () => {
  it.effect('commits cast, bite and reel transitions and returns a typed no-bite result', () => {
    const published: DomainEvent[] = []
    return Effect.gen(function* () {
      const fishing = yield* FishingService

      const invalidBite = yield* Effect.result(fishing.bite(actor))
      expect(Result.isFailure(invalidBite)).toBe(true)
      if (Result.isFailure(invalidBite)) expect(invalidBite.failure._tag).toBe('FishingInvalidState')

      const malformedCast = yield* Effect.result(fishing.cast([] as never, bobber))
      const malformedBite = yield* Effect.result(fishing.bite([] as never))
      const malformedReel = yield* Effect.result(fishing.reel([] as never, [] as never))
      for (const outcome of [malformedCast, malformedBite]) {
        expect(Result.isFailure(outcome)).toBe(true)
        if (Result.isFailure(outcome)) expect(outcome.failure._tag).toBe('SchemaError')
      }
      expect(Result.isFailure(malformedReel)).toBe(true)
      if (Result.isFailure(malformedReel)) expect(malformedReel.failure._tag).toBe('SchemaError')
      expect(yield* fishing.snapshot).toEqual(emptyFishingState())
      expect(published).toEqual([])

      yield* fishing.cast(actor, bobber)
      const castState = yield* fishing.snapshot
      expect(castState.rods).toEqual([{ actor, bobber, phase: 'cast' }])

      const duplicateCast = yield* Effect.result(fishing.cast(actor, secondBobber))
      expect(Result.isFailure(duplicateCast)).toBe(true)
      expect(yield* fishing.snapshot).toEqual(castState)

      const noBite = yield* fishing.reel(actor, tick)
      expect(noBite).toEqual({ _tag: 'NoBite' })
      expect((yield* fishing.snapshot).rods).toEqual([])
      expect(published).toEqual([])
    }).pipe(Effect.provide(fishingLayer(published)))
  });

  it.effect('uses the C5 seed through Effect Random for a stable loot golden', () => {
    const published: DomainEvent[] = []
    const round = Effect.gen(function* () {
      const fishing = yield* FishingService
      yield* fishing.cast(actor, bobber)
      yield* fishing.bite(actor)
      const outcome = yield* fishing.reel(actor, tick)
      return { outcome, snapshot: yield* fishing.snapshot }
    }).pipe(Effect.provide(fishingLayer(published)))
    const seed = String(Schema.decodeUnknownSync(RandomSeedSchema)(0))
    return Effect.gen(function* () {
      const first = yield* round.pipe(Random.withSeed(seed))
      const second = yield* round.pipe(Random.withSeed(seed))
      expect(first.outcome).toEqual({ _tag: 'Caught', item: 'cod' })
      expect(second.outcome).toEqual(first.outcome)
      expect(first.snapshot.rods).toEqual([])
      expect(published).toHaveLength(2)
      expect(published[0]).toMatchObject({
        _tag: 'ItemPickedUp',
        tick,
        actor,
        source: { _tag: 'Projectile', id: bobber },
        item: itemIdOf('cod'),
        count: 1,
      })
    })
  });

  it.effect('keeps the owner snapshot unchanged and publishes no event when commit fails', () => {
    const published: DomainEvent[] = []
    const started = must(castFishingRod(emptyFishingState(), actor, bobber))
    const before = must(registerFishingBite(started, actor))
    const rejectingCoordinatorLayer = Layer.effect(
      WorldCommitCoordinator,
      Effect.map(WorldCommitCoordinator, failingCoordinator),
    ).pipe(Layer.provide(coordinatorLayer(before)))
    const serviceLayer = FishingServiceLayer(ownerId).pipe(
      Layer.provide(Layer.mergeAll(
        rejectingCoordinatorLayer,
        eventRecorder(published),
      )),
    )
    return Effect.gen(function* () {
      const fishing = yield* FishingService

      const failed = yield* Effect.result(fishing.reel(actor, tick))
      expect(Result.isFailure(failed)).toBe(true)
      if (Result.isFailure(failed)) expect(failed.failure._tag).toBe('WorldRevisionConflict')
      expect(yield* fishing.snapshot).toEqual(before)
      expect(published).toEqual([])
    }).pipe(Effect.provide(serviceLayer), Random.withSeed('0'))
  });

  it('rejects finite loot samples whose multiplication could overflow', () => {
    const result = fishingLootForSample(Number.MAX_VALUE)
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) expect(result.failure._tag).toBe('FishingInvalidLootRoll')
  });

  it('returns typed invalid-state outcomes for illegal domain transitions', () => {
    const noRod = reelFishingRod(emptyFishingState(), actor)
    expect(Result.isFailure(noRod)).toBe(true)
    if (Result.isFailure(noRod)) expect(noRod.failure._tag).toBe('FishingInvalidState')

    const sample = fishingLootForSample(0.1633802591287037)
    expect(sample).toEqual(Result.succeed('cod'))
    const invalidLoot = fishingLootForSample(1)
    expect(Result.isFailure(invalidLoot)).toBe(true)
    if (Result.isFailure(invalidLoot)) {
      expect(invalidLoot.failure._tag).toBe('FishingInvalidLootRoll')
      expect(invalidLoot.failure.reason).toBe('outside-unit-interval')
    }
  });

  it('orders multiple actors in both directions and preserves equal-ID sort order', () => {
    const zThenA = must(castFishingRod(
      must(castFishingRod(emptyFishingState(), actorZ, bobber)),
      actorA,
      secondBobber,
    ))
    const aThenZ = must(castFishingRod(
      must(castFishingRod(emptyFishingState(), actorA, bobber)),
      actorZ,
      secondBobber,
    ))
    const duplicateActors = Schema.decodeUnknownSync(FishingStateSchema)({
      rods: [
        { actor: actorA, bobber, phase: 'cast' },
        { actor: actorA, bobber: secondBobber, phase: 'bite' },
      ],
    })
    const equalIdsThenZ = must(castFishingRod(duplicateActors, actorZ, thirdBobber))

    expect(zThenA.rods.map((rod) => rod.actor)).toEqual([actorA, actorZ])
    expect(aThenZ.rods.map((rod) => rod.actor)).toEqual([actorA, actorZ])
    expect(equalIdsThenZ.rods.map((rod) => rod.actor)).toEqual([actorA, actorA, actorZ])
    expect(equalIdsThenZ.rods.map((rod) => rod.bobber)).toEqual([bobber, secondBobber, thirdBobber])
  });

  it('rejects a second bite for an already-bitten rod', () => {
    const cast = must(castFishingRod(emptyFishingState(), actor, bobber))
    const bitten = must(registerFishingBite(cast, actor))
    const repeatedBite = registerFishingBite(bitten, actor)

    expect(Result.isFailure(repeatedBite)).toBe(true)
    if (Result.isFailure(repeatedBite)) {
      expect(repeatedBite.failure._tag).toBe('FishingInvalidState')
      expect(repeatedBite.failure.reason).toBe('rod-already-bitten')
    }
    expect(bitten.rods).toEqual([{ actor, bobber, phase: 'bite' }])
  });

  it('decodes the registered public state schema and rejects an unknown rod phase', () => {
    const registration = fishingOwnerRegistration(ownerId)
    const invalid = Schema.decodeUnknownResult(registration.schema)({
      rods: [{ actor, bobber, phase: 'hooked' }],
    })

    expect(Result.isFailure(invalid)).toBe(true)
  });

  it('maps samples from every weighted loot band to its item', () => {
    const cases = [
      { sample: 0.255, item: 'cod' },
      { sample: 0.615, item: 'salmon' },
      { sample: 0.73, item: 'tropical_fish' },
      { sample: 0.795, item: 'pufferfish' },
      { sample: 0.865, item: 'bowl' },
      { sample: 0.895, item: 'leather' },
      { sample: 0.93, item: 'bone' },
      { sample: 0.96, item: 'name_tag' },
      { sample: 0.975, item: 'fishing_rod' },
      { sample: 0.99, item: 'enchanted_book' },
    ] as const

    for (const { sample, item } of cases) {
      expect(fishingLootForSample(sample)).toEqual(Result.succeed(item))
    }
  });
})
