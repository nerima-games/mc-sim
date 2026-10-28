import { Context, Effect, Layer, Ref, Schema } from 'effect'
import * as Hotbar from '../domain/hotbar.js'
import {
  InventoryService,
  type InventoryCarriedSlot,
} from './inventory-service.js'

export type HotbarInput = {
  readonly selectedSlot?: number | undefined
  readonly wheelDelta?: number | undefined
}

export type HotbarServiceApi = {
  readonly getSelectedSlot: Effect.Effect<number>
  readonly setSelectedSlot: (slot: number) => Effect.Effect<void, Schema.SchemaError>
  readonly scroll: (delta: number) => Effect.Effect<void, Schema.SchemaError>
  readonly getSelectedItem: Effect.Effect<InventoryCarriedSlot>
  readonly getSlots: Effect.Effect<ReadonlyArray<InventoryCarriedSlot>>
  readonly update: (input: HotbarInput) => Effect.Effect<void, Schema.SchemaError>
}

const HotbarInputSchema = Schema.Struct({
  selectedSlot: Schema.optional(Schema.Number),
  wheelDelta: Schema.optional(Schema.Number),
})

const HotbarServiceBase: Context.ServiceClass<HotbarService, '@nerima-games/mc-sim/HotbarService', HotbarServiceApi> =
  Context.Service<HotbarService, HotbarServiceApi>()('@nerima-games/mc-sim/HotbarService')

export class HotbarService extends HotbarServiceBase {}

export const makeHotbarService = (
  initialSelection = 0,
): Effect.Effect<HotbarServiceApi, Schema.SchemaError, InventoryService> =>
  Effect.gen(function* () {
    const validatedInitialSelection = yield* Schema.decodeUnknownEffect(Schema.Number)(initialSelection)
    const inventory = yield* InventoryService
    const selectedSlot = yield* Ref.make(Hotbar.clampHotbarIndex(validatedInitialSelection))

    return {
      getSelectedSlot: Ref.get(selectedSlot),
      setSelectedSlot: (slot) => Schema.decodeUnknownEffect(Schema.Number)(slot).pipe(
        Effect.flatMap((validatedSlot) => Ref.set(selectedSlot, Hotbar.clampHotbarIndex(validatedSlot))),
        Effect.asVoid,
      ),
      scroll: (delta) => Schema.decodeUnknownEffect(Schema.Number)(delta).pipe(
        Effect.flatMap((validatedDelta) =>
          Ref.update(selectedSlot, (current) => Hotbar.cycleHotbarIndex(current, validatedDelta)),
        ),
        Effect.asVoid,
      ),
      getSelectedItem: Effect.gen(function* () {
        const selection = yield* Ref.get(selectedSlot)
        return yield* inventory.getSlot(Hotbar.hotbarSlotIndex(selection))
      }),
      getSlots: inventory.getHotbarSlots,
      update: (input) => Schema.decodeUnknownEffect(HotbarInputSchema)(input).pipe(
        Effect.flatMap(({ selectedSlot: requestedSlot, wheelDelta }) =>
          Ref.update(selectedSlot, (current) => {
            const next = requestedSlot === undefined
              ? current
              : Hotbar.clampHotbarIndex(requestedSlot)
            return wheelDelta === undefined
              ? next
              : Hotbar.cycleHotbarIndex(next, wheelDelta)
          }),
        ),
        Effect.asVoid,
      ),
    } satisfies HotbarServiceApi
  })

export const HotbarServiceLayer: Layer.Layer<HotbarService, Schema.SchemaError, InventoryService> =
  Layer.effect(HotbarService, makeHotbarService())
