import { describe, expect, it } from '@effect/vitest'
import { Cause, Deferred, Effect, Exit, Fiber, Schema, Stream } from 'effect'
import { DomainEventSchema } from '@nerima-games/mc-kernel'
import {
  DomainEventBus,
  DomainEventBusLayer,
  EventSubscriberCapacitySchema,
} from '../src/application/domain-event-bus'

const decodeEvent = Schema.decodeUnknownEffect(DomainEventSchema)

const decodeEvents = () =>
  Effect.all({
    entityDamaged: decodeEvent({
      _tag: 'EntityDamaged',
      tick: 0,
      entity: 'zombie',
      position: { dimension: 'overworld', x: 1.5, y: 64, z: -2 },
      amount: 0.5,
      cause: 'mob',
    }),
    blockBroken: decodeEvent({
      _tag: 'BlockBroken',
      tick: 1,
      actor: 'player-1',
      address: { dimension: 'overworld', position: { x: 1, y: 64, z: -2 } },
      block: 1,
    }),
    explosion: decodeEvent({
      _tag: 'Explosion',
      tick: 2,
      position: { dimension: 'nether', x: 0, y: 32, z: 0 },
      power: 6,
      source: 'creeper',
    }),
    levelUp: decodeEvent({
      _tag: 'LevelUp',
      tick: 3,
      entity: 'player-1',
      position: { dimension: 'overworld', x: 1, y: 64, z: -2 },
      level: 1,
    }),
    achievementUnlocked: decodeEvent({
      _tag: 'AchievementUnlocked',
      tick: 4,
      player: 'player-1',
      achievement: 'minecraft:story/mine_stone',
    }),
  })

describe('DomainEventBus', () => {
  it.effect('rejects a zero subscriber capacity', () =>
    Effect.sync(() => {
      const capacity = Schema.decodeUnknownResult(EventSubscriberCapacitySchema)(0)
      expect(capacity._tag).toBe('Failure')
    }),
  )

  it.effect('rejects subscriber capacities that exceed the bounded buffer limit', () =>
    Effect.sync(() => {
      const capacity = Schema.decodeUnknownResult(EventSubscriberCapacitySchema)(1_000_000_000_000)
      expect(capacity._tag).toBe('Failure')
    }),
  )

  it.effect('publishes the kernel event variants to every active subscriber in order', () =>
    Effect.gen(function* () {
      const capacity = yield* Schema.decodeUnknownEffect(EventSubscriberCapacitySchema)(64)
      const events = yield* decodeEvents()
      const ordered = [
        events.entityDamaged,
        events.blockBroken,
        events.explosion,
        events.levelUp,
        events.achievementUnlocked,
      ]

      yield* Effect.gen(function* () {
        const bus = yield* DomainEventBus
        const collectFive = bus.events.pipe(Stream.take(5), Stream.runCollect)
        const first = yield* Effect.forkChild(collectFive)
        const second = yield* Effect.forkChild(collectFive)
        yield* Effect.yieldNow

        yield* Effect.forEach(ordered, (event) => bus.publish(event), { discard: true })

        const [firstEvents, secondEvents] = yield* Effect.all([
          Fiber.join(first),
          Fiber.join(second),
        ])
        expect(ordered.map((event) => event._tag)).toStrictEqual([
          'EntityDamaged',
          'BlockBroken',
          'Explosion',
          'LevelUp',
          'AchievementUnlocked',
        ])
        expect(firstEvents).toStrictEqual(ordered)
        expect(secondEvents).toStrictEqual(ordered)
      }).pipe(Effect.provide(DomainEventBusLayer(capacity)))
    }),
  )

  it.effect('subscribes during stream execution, drops without subscribers, and closes on completion or interruption', () =>
    Effect.gen(function* () {
      const capacity = yield* Schema.decodeUnknownEffect(EventSubscriberCapacitySchema)(1)
      const events = yield* decodeEvents()

      yield* Effect.gen(function* () {
        const bus = yield* DomainEventBus

        yield* bus.publish(events.entityDamaged)
        const completedSubscriber = yield* Effect.forkChild(
          bus.events.pipe(Stream.take(1), Stream.runCollect),
        )
        yield* Effect.yieldNow
        yield* bus.publish(events.blockBroken)
        expect(yield* Fiber.join(completedSubscriber)).toStrictEqual([events.blockBroken])

        yield* bus.publish(events.explosion)
        yield* bus.publish(events.levelUp)

        const interruptedSubscriber = yield* Effect.forkChild(
          bus.events.pipe(Stream.take(1), Stream.runCollect),
        )
        yield* Effect.yieldNow
        yield* Fiber.interrupt(interruptedSubscriber)
        yield* bus.publish(events.explosion)
        yield* bus.publish(events.levelUp)

        const nextSubscriber = yield* Effect.forkChild(
          bus.events.pipe(Stream.take(1), Stream.runCollect),
        )
        yield* Effect.yieldNow
        yield* bus.publish(events.achievementUnlocked)
        expect(yield* Fiber.join(nextSubscriber)).toStrictEqual([events.achievementUnlocked])
      }).pipe(Effect.provide(DomainEventBusLayer(capacity)))
    }),
  )

  it.effect('backpressures a full subscriber and interruption sends no event', () =>
    Effect.gen(function* () {
      const capacity = yield* Schema.decodeUnknownEffect(EventSubscriberCapacitySchema)(1)
      const events = yield* decodeEvents()

      yield* Effect.gen(function* () {
        const bus = yield* DomainEventBus
        const firstRead = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const consumer = yield* Effect.forkChild(
          bus.events.pipe(
            Stream.take(3),
            Stream.tap((event) =>
              event._tag === 'EntityDamaged'
                ? Deferred.succeed(firstRead, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst)))
                : Effect.void,
            ),
            Stream.runCollect,
          ),
        )

        yield* Effect.yieldNow
        yield* bus.publish(events.entityDamaged)
        yield* Deferred.await(firstRead)
        yield* bus.publish(events.blockBroken)

        const interruptedPublish = yield* Effect.forkChild(bus.publish(events.explosion))
        yield* Effect.yieldNow
        yield* Fiber.interrupt(interruptedPublish)
        const publishExit = yield* Fiber.await(interruptedPublish)
        expect(Exit.isFailure(publishExit)).toBe(true)
        if (Exit.isFailure(publishExit)) {
          expect(Cause.hasInterruptsOnly(publishExit.cause)).toBe(true)
        }

        yield* Deferred.succeed(releaseFirst, undefined)
        yield* bus.publish(events.levelUp)
        expect(yield* Fiber.join(consumer)).toStrictEqual([
          events.entityDamaged,
          events.blockBroken,
          events.levelUp,
        ])
      }).pipe(Effect.provide(DomainEventBusLayer(capacity)))
    }),
  )

  it.effect('removes an interrupted subscription waiting behind a publication', () =>
    Effect.gen(function* () {
      const capacity = yield* Schema.decodeUnknownEffect(EventSubscriberCapacitySchema)(1)
      const events = yield* decodeEvents()

      yield* Effect.gen(function* () {
        const bus = yield* DomainEventBus
        const firstRead = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const consumer = yield* Effect.forkChild(
          bus.events.pipe(
            Stream.take(3),
            Stream.tap((event) =>
              event._tag === 'EntityDamaged'
                ? Deferred.succeed(firstRead, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst)))
                : Effect.void,
            ),
            Stream.runCollect,
          ),
        )

        yield* Effect.yieldNow
        yield* bus.publish(events.entityDamaged)
        yield* Deferred.await(firstRead)
        yield* bus.publish(events.blockBroken)

        const pendingPublication = yield* Effect.forkChild(bus.publish(events.explosion))
        yield* Effect.yieldNow
        const interruptedSubscriber = yield* Effect.forkChild(
          bus.events.pipe(Stream.take(1), Stream.runCollect),
        )
        yield* Effect.yieldNow
        yield* Fiber.interrupt(interruptedSubscriber)
        const subscriptionExit = yield* Fiber.await(interruptedSubscriber)
        expect(Exit.isFailure(subscriptionExit)).toBe(true)
        if (Exit.isFailure(subscriptionExit)) {
          expect(Cause.hasInterruptsOnly(subscriptionExit.cause)).toBe(true)
        }

        yield* Deferred.succeed(releaseFirst, undefined)
        yield* Fiber.join(pendingPublication)
        expect(yield* Fiber.join(consumer)).toStrictEqual([
          events.entityDamaged,
          events.blockBroken,
          events.explosion,
        ])

        const nextSubscriber = yield* Effect.forkChild(
          bus.events.pipe(Stream.take(1), Stream.runCollect),
        )
        yield* Effect.yieldNow
        yield* bus.publish(events.levelUp)
        expect(yield* Fiber.join(nextSubscriber)).toStrictEqual([events.levelUp])
      }).pipe(Effect.provide(DomainEventBusLayer(capacity)))
    }),
  )

  it.effect('does not send an in-flight publication to a subscriber that acquires during backpressure', () =>
    Effect.gen(function* () {
      const capacity = yield* Schema.decodeUnknownEffect(EventSubscriberCapacitySchema)(1)
      const events = yield* decodeEvents()

      yield* Effect.gen(function* () {
        const bus = yield* DomainEventBus
        const firstRead = yield* Deferred.make<void>()
        const releaseFirst = yield* Deferred.make<void>()
        const probeReceived = yield* Deferred.make<void>()
        const publicationAttempted = yield* Deferred.make<void>()
        const acquisitionAttempted = yield* Deferred.make<void>()
        const originalSubscriber = yield* Effect.forkChild(
          bus.events.pipe(
            Stream.take(3),
            Stream.tap((event) =>
              event._tag === 'EntityDamaged'
                ? Deferred.succeed(firstRead, undefined).pipe(Effect.andThen(Deferred.await(releaseFirst)))
                : Effect.void,
            ),
            Stream.runCollect,
          ),
        )

        yield* Effect.yieldNow
        yield* bus.publish(events.entityDamaged)
        yield* Deferred.await(firstRead)
        yield* bus.publish(events.blockBroken)

        const pendingPublication = yield* Effect.forkChild(
          Effect.gen(function* () {
            yield* Deferred.succeed(publicationAttempted, undefined)
            yield* bus.publish(events.explosion)
          }),
        )
        yield* Deferred.await(publicationAttempted)
        yield* Effect.yieldNow
        const lateSubscriber = yield* Effect.forkChild(
          Stream.unwrap(
            Deferred.succeed(acquisitionAttempted, undefined).pipe(Effect.as(bus.events)),
          ).pipe(
            Stream.tap((event) =>
              event._tag === 'AchievementUnlocked'
                ? Deferred.succeed(probeReceived, undefined)
                : Effect.void,
            ),
            Stream.take(2),
            Stream.runCollect,
          ),
        )
        // This barrier places the late subscription attempt after publish starts
        // while the original subscriber still blocks the full queue.
        yield* Deferred.await(acquisitionAttempted)
        yield* Effect.yieldNow

        yield* Deferred.succeed(releaseFirst, undefined)
        yield* Fiber.join(pendingPublication)
        expect(yield* Fiber.join(originalSubscriber)).toStrictEqual([
          events.entityDamaged,
          events.blockBroken,
          events.explosion,
        ])

        yield* bus.publish(events.achievementUnlocked)
        yield* Deferred.await(probeReceived)
        yield* bus.publish(events.levelUp)
        expect(yield* Fiber.join(lateSubscriber)).toStrictEqual([
          events.achievementUnlocked,
          events.levelUp,
        ])
      }).pipe(Effect.provide(DomainEventBusLayer(capacity)))
    }),
  )

  it.effect('publishes the kernel 0.10 EntityDied event to active subscribers', () =>
    Effect.gen(function* () {
      const capacity = yield* Schema.decodeUnknownEffect(EventSubscriberCapacitySchema)(1)
      const event = yield* decodeEvent({
        _tag: 'EntityDied',
        tick: 5,
        entity: 'zombie',
        kind: 'zombie',
        position: { dimension: 'overworld', x: 1, y: 64, z: -2 },
        cause: 'fall',
      })

      yield* Effect.gen(function* () {
        const bus = yield* DomainEventBus
        const subscriber = yield* Effect.forkChild(bus.events.pipe(Stream.take(1), Stream.runCollect))

        yield* Effect.yieldNow
        yield* bus.publish(event)

        expect(yield* Fiber.join(subscriber)).toStrictEqual([event])
      }).pipe(Effect.provide(DomainEventBusLayer(capacity)))
    }),
  )
})
