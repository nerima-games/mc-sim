import { DomainEventSchema } from '@nerima-games/mc-kernel'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as PubSub from 'effect/PubSub'
import * as Ref from 'effect/Ref'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import type * as Brand from 'effect/Brand'
import { SchemaErrorSchema } from '../schema-errors.js'

interface GateTicket {
  readonly signal: Deferred.Deferred<void>
}

interface GateState {
  readonly owner: GateTicket | undefined
  readonly waiters: ReadonlyArray<GateTicket>
}

export type DomainEvent = Schema.Schema.Type<typeof DomainEventSchema>

export type EventSubscriberCapacity = number & Brand.Brand<'EventSubscriberCapacity'>

const MAX_EVENT_SUBSCRIBER_CAPACITY = 65_536

export const EventSubscriberCapacitySchema: Schema.Codec<EventSubscriberCapacity, number> = Schema.Int
  .check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(MAX_EVENT_SUBSCRIBER_CAPACITY))
  .pipe(Schema.brand('EventSubscriberCapacity'))

export type DomainEventBusApi = {
  readonly publish: (event: DomainEvent) => Effect.Effect<void, Schema.SchemaError>
  readonly events: Stream.Stream<DomainEvent>
}

export const DomainEventBusErrorSchema: Schema.Schema<unknown> = SchemaErrorSchema

const DomainEventBusBase: Context.ServiceClass<
  DomainEventBus,
  'mc-sim/application/DomainEventBus',
  DomainEventBusApi
> = Context.Service<DomainEventBus, DomainEventBusApi>()('mc-sim/application/DomainEventBus')

export class DomainEventBus extends DomainEventBusBase {}

export const DomainEventBusLayer = (
  capacity: EventSubscriberCapacity,
): Layer.Layer<DomainEventBus, Schema.SchemaError> =>
  Layer.effect(
    DomainEventBus,
    Effect.gen(function* () {
      const validCapacity = yield* Schema.decodeUnknownEffect(EventSubscriberCapacitySchema)(capacity)
      const pubsub = yield* Effect.acquireRelease(
        PubSub.bounded<DomainEvent>({ capacity: validCapacity, replay: 0 }),
        (value) => PubSub.shutdown(value),
      )
      const gate = yield* Ref.make<GateState>({ owner: undefined, waiters: [] })
      const releaseTicket = (ticket: GateTicket) =>
        Effect.gen(function* () {
          const next = yield* Ref.modify(gate, (state) => {
            if (state.owner === ticket) {
              const [nextOwner, ...waiters] = state.waiters
              return [
                nextOwner,
                { owner: nextOwner, waiters } satisfies GateState,
              ]
            }
            return [
              undefined,
              {
                owner: state.owner,
                waiters: state.waiters.filter((waiter) => waiter !== ticket),
              } satisfies GateState,
            ]
          })
          if (next !== undefined) yield* Deferred.succeed(next.signal, undefined)
        })
      const withGate = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const signal = yield* Deferred.make<void>()
            const ticket: GateTicket = { signal }
            const acquired = yield* Ref.modify(gate, (state) =>
              state.owner === undefined
                ? [true, { owner: ticket, waiters: state.waiters } satisfies GateState]
                : [false, { owner: state.owner, waiters: [...state.waiters, ticket] } satisfies GateState],
            )
            if (!acquired) {
              yield* restore(Deferred.await(ticket.signal)).pipe(
                Effect.onInterrupt(() => releaseTicket(ticket)),
              )
            }
            return yield* restore(effect).pipe(Effect.ensuring(releaseTicket(ticket)))
          }),
        )

      return {
        publish: (event) =>
          Effect.flatMap(
            Schema.decodeUnknownEffect(DomainEventSchema)(event),
            (validEvent) => withGate(PubSub.publish(pubsub, validEvent).pipe(Effect.asVoid)),
          ),
        events: Stream.unwrap(
          withGate(
            PubSub.subscribe(pubsub).pipe(Effect.map(Stream.fromSubscription)),
          ),
        ),
      }
    }),
  )
