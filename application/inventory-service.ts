/**
 * InventoryService — the Ref wrapper around `domain/inventory.ts`.
 *
 * `add` and `remove` are `Ref.modify`, not get-then-set. Two mining stages, a
 * network item-sync and an autosave read can all be in flight at once; a
 * read-modify-write split across two Effects loses one of them. This is the
 * TOCTOU convention from plan.md §3.8, and it is the reason the domain
 * functions return `{ inventory, leftover }` rather than mutating: the tuple is
 * exactly what `Ref.modify` wants.
 */
import { Context, Effect, Layer, Ref } from 'effect'
import * as Inv from '../domain/inventory'

export type InventoryServiceApi = {
  /**
   * Insert items. Resolves to the number that did NOT fit.
   *
   * A non-zero leftover is not an error — see `domain/inventory.ts`. The caller
   * in mx-gameplay turns it into a dropped-item entity.
   */
  readonly add: (item: Inv.ItemId, count: number) => Effect.Effect<number>
  /** Take items. Resolves to the number actually taken. */
  readonly remove: (item: Inv.ItemId, count: number) => Effect.Effect<number>
  readonly countOf: (item: Inv.ItemId) => Effect.Effect<number>
  readonly snapshot: Effect.Effect<Inv.Inventory>
  readonly restore: (inventory: Inv.Inventory) => Effect.Effect<void>
  /**
   * Empty the inventory.
   *
   * Present from day one because this service is reused across world loads.
   * The reference's equivalent omission is documented at
   * ts-minecraft/packages/game/application/game-state-service.ts:87-92: the
   * second world inherited the first world's state and `player.create` failed
   * with "Player already exists", killing session init.
   */
  readonly reset: Effect.Effect<void>
}

export class InventoryService extends Context.Tag('@nerima-games/mc-sim/InventoryService')<
  InventoryService,
  InventoryServiceApi
>() {}

export const makeInventoryService = (
  initial: Inv.Inventory = Inv.emptyInventory(),
): Effect.Effect<InventoryServiceApi> =>
  Effect.map(Ref.make(initial), (state) => ({
    add: (item, count) =>
      Ref.modify(state, (current) => {
        const outcome = Inv.addItem(current, item, count)
        return [outcome.leftover, outcome.inventory]
      }),
    remove: (item, count) =>
      Ref.modify(state, (current) => {
        const outcome = Inv.removeItem(current, item, count)
        return [outcome.removed, outcome.inventory]
      }),
    countOf: (item) => Ref.get(state).pipe(Effect.map((current) => Inv.countOf(current, item))),
    snapshot: Ref.get(state),
    restore: (inventory) => Ref.set(state, inventory),
    reset: Ref.set(state, Inv.emptyInventory()),
  }))

export const InventoryServiceLayer = (
  initial: Inv.Inventory = Inv.emptyInventory(),
): Layer.Layer<InventoryService> => Layer.effect(InventoryService, makeInventoryService(initial))
