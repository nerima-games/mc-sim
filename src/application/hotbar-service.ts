import { Context, Effect, Layer, Ref } from 'effect'
import * as Hotbar from '../domain/hotbar'
import {
  InventoryService,
  type InventoryCarriedSlot,
} from './inventory-service'

export type HotbarInput = {
  readonly selectedSlot?: number | undefined
  readonly wheelDelta?: number | undefined
}

export type HotbarServiceApi = {
  readonly getSelectedSlot: Effect.Effect<number>
  readonly setSelectedSlot: (slot: number) => Effect.Effect<void>
  readonly scroll: (delta: number) => Effect.Effect<void>
  readonly getSelectedItem: Effect.Effect<InventoryCarriedSlot>
  readonly getSlots: Effect.Effect<ReadonlyArray<InventoryCarriedSlot>>
  readonly update: (input: HotbarInput) => Effect.Effect<void>
}

export class HotbarService extends Context.Tag('@nerima-games/mc-sim/HotbarService')<
  HotbarService,
  HotbarServiceApi
>() {}

export const makeHotbarService = (
  initialSelection = 0,
): Effect.Effect<HotbarServiceApi, never, InventoryService> =>
  Effect.gen(function* () {
    const inventory = yield* InventoryService
    const selectedSlot = yield* Ref.make(Hotbar.clampHotbarIndex(initialSelection))

    return {
      getSelectedSlot: Ref.get(selectedSlot),
      setSelectedSlot: (slot) => Ref.set(selectedSlot, Hotbar.clampHotbarIndex(slot)),
      scroll: (delta) => Ref.update(selectedSlot, (current) => Hotbar.cycleHotbarIndex(current, delta)),
      getSelectedItem: Effect.gen(function* () {
        const selection = yield* Ref.get(selectedSlot)
        return yield* inventory.getSlot(Hotbar.hotbarSlotIndex(selection))
      }),
      getSlots: inventory.getHotbarSlots,
      update: ({ selectedSlot: requestedSlot, wheelDelta }) =>
        Ref.update(selectedSlot, (current) => {
          const next = requestedSlot === undefined
            ? current
            : Hotbar.clampHotbarIndex(requestedSlot)
          return wheelDelta === undefined
            ? next
            : Hotbar.cycleHotbarIndex(next, wheelDelta)
        }),
    } satisfies HotbarServiceApi
  })

export const HotbarServiceLayer: Layer.Layer<HotbarService, never, InventoryService> =
  Layer.effect(HotbarService, makeHotbarService())
