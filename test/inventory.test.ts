import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import {
  addItem,
  countOf,
  emptyInventory,
  INVENTORY_SLOT_COUNT,
  isEmpty,
  normaliseInventory,
  removeItem,
  slotAt,
  type Inventory,
} from '../domain/inventory'
import { MAX_STACK_COUNT, type StackCount } from '../domain/kernel-vocabulary'
import { makeInventoryService } from '../application/inventory-service'

/**
 * A slot holding a count `StackCount` would reject.
 *
 * The cast is the point: this is what a save written by another build, or by an
 * older schema, hands `restore`. `itemStack` cannot express it, because
 * `StackCount` is `Brand.refined` and throws — which is exactly why nothing
 * inside the domain may assume a slot is in range.
 */
const corruptSlot = (item: string, count: number): Inventory => ({
  slots: [{ item, count: count as StackCount }, ...emptyInventory().slots.slice(1)],
})

describe('addItem', () => {
  it.effect('tops up an existing partial stack before opening a new slot', () =>
    Effect.sync(() => {
      // Filling empty slots first fragments the inventory into many partial
      // stacks and the player finds 36 slots full while holding nothing.
      const one = addItem(emptyInventory(), 'STONE', 10)
      const two = addItem(one.inventory, 'STONE', 10)

      expect(slotAt(two.inventory, 0)).toStrictEqual({ item: 'STONE', count: 20 })
      expect(slotAt(two.inventory, 1)).toBeUndefined()
      expect(two.leftover).toBe(0)
    }),
  )

  it.effect('spreads a quantity larger than one stack across consecutive slots', () =>
    Effect.sync(() => {
      const outcome = addItem(emptyInventory(), 'COBBLESTONE', 130)

      expect(slotAt(outcome.inventory, 0)).toStrictEqual({ item: 'COBBLESTONE', count: MAX_STACK_COUNT })
      expect(slotAt(outcome.inventory, 1)).toStrictEqual({ item: 'COBBLESTONE', count: MAX_STACK_COUNT })
      expect(slotAt(outcome.inventory, 2)).toStrictEqual({ item: 'COBBLESTONE', count: 2 })
      expect(countOf(outcome.inventory, 'COBBLESTONE')).toBe(130)
      expect(outcome.leftover).toBe(0)
    }),
  )

  it.effect('reports leftover instead of failing when the inventory is full', () =>
    Effect.sync(() => {
      // A full inventory is a game state, not an error: mx-gameplay turns the
      // leftover into a dropped-item entity, which is what a player expects.
      const full = addItem(emptyInventory(), 'DIRT', INVENTORY_SLOT_COUNT * MAX_STACK_COUNT)
      expect(full.leftover).toBe(0)

      const overflow = addItem(full.inventory, 'DIRT', 5)
      expect(overflow.leftover).toBe(5)
      expect(countOf(overflow.inventory, 'DIRT')).toBe(INVENTORY_SLOT_COUNT * MAX_STACK_COUNT)
    }),
  )

  it.effect('does not mutate the inventory it was given', () =>
    Effect.sync(() => {
      const before = emptyInventory()
      addItem(before, 'STONE', 4)

      expect(isEmpty(before)).toBe(true)
    }),
  )

  it.effect('rejects non-positive and non-integer counts without corrupting anything', () =>
    Effect.sync(() => {
      expect(addItem(emptyInventory(), 'STONE', 0).leftover).toBe(0)
      expect(addItem(emptyInventory(), 'STONE', -3).leftover).toBe(0)
      expect(isEmpty(addItem(emptyInventory(), 'STONE', 2.5).inventory)).toBe(true)
      // A rejected quantity comes back as leftover, because the caller turns
      // leftover into dropped items and 2.5 asked for is 2.5 not placed.
      expect(addItem(emptyInventory(), 'STONE', 2.5).leftover).toBe(2.5)
    }),
  )

  it.effect('a quantity that is not a quantity leaves nothing behind, rather than a NaN leftover', () =>
    Effect.sync(() => {
      // `Math.max(0, NaN)` is NaN, and a NaN leftover is a number every caller
      // downstream would believe — mx-gameplay would spawn NaN dropped items.
      for (const count of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const outcome = addItem(emptyInventory(), 'STONE', count)
        expect(outcome.leftover).toBe(0)
        expect(isEmpty(outcome.inventory)).toBe(true)
      }
    }),
  )
})

describe('removeItem', () => {
  it.effect('drains the last matching slots first, so add-then-remove restores the layout', () =>
    Effect.sync(() => {
      const stocked = addItem(emptyInventory(), 'STONE', 100).inventory
      const taken = removeItem(stocked, 'STONE', 36)

      expect(taken.removed).toBe(36)
      expect(slotAt(taken.inventory, 0)).toStrictEqual({ item: 'STONE', count: MAX_STACK_COUNT })
      expect(slotAt(taken.inventory, 1)).toBeUndefined()
    }),
  )

  it.effect('takes what it can and reports the shortfall via `removed`', () =>
    Effect.sync(() => {
      const stocked = addItem(emptyInventory(), 'STONE', 3).inventory
      const taken = removeItem(stocked, 'STONE', 10)

      expect(taken.removed).toBe(3)
      expect(isEmpty(taken.inventory)).toBe(true)
    }),
  )

  it.effect('ignores items it does not hold', () =>
    Effect.sync(() => {
      const stocked = addItem(emptyInventory(), 'STONE', 3).inventory
      const taken = removeItem(stocked, 'DIAMOND', 1)

      expect(taken.removed).toBe(0)
      expect(countOf(taken.inventory, 'STONE')).toBe(3)
    }),
  )
})

/**
 * REGRESSION: this module is PURE AND TOTAL, as its header claims — including
 * on an inventory it did not build.
 *
 * `removeItem` wrote `StackCount(left)`, and `StackCount` is `Brand.refined`:
 * it THREW for any remainder outside [0, 64], which a slot restored from
 * another build's save reaches immediately. In the frame loop that throw
 * becomes a `Cause.Die` that `application/game-loop.ts` logs and swallows, so
 * the observable symptom was that mining and crafting silently stopped working
 * and one line went into a log nobody reads. Nothing failed; nothing could.
 *
 * These tests assert on functions that must not throw. `expect(...).not
 * .toThrow()` is written explicitly rather than left implicit in a passing
 * assertion, because a throw and a wrong answer are different failures and only
 * one of them is being guarded here.
 */
describe('REGRESSION: the domain is total on a corrupt slot, and never dies inside a frame', () => {
  it.effect('removeItem does not throw on a slot holding more than MAX_STACK_COUNT', () =>
    Effect.sync(() => {
      const corrupt = corruptSlot('STONE', 200)

      expect(() => removeItem(corrupt, 'STONE', 1)).not.toThrow()

      const taken = removeItem(corrupt, 'STONE', 1)
      expect(taken.removed).toBe(1)
      // The slot is REPAIRED to the representable range on the way out. That
      // loses the surplus, which is why this is the total path and not the
      // sanctioned one: `normaliseInventory` is what accounts for it, and
      // `InventoryService.restore` runs it before a slot like this can exist.
      expect(slotAt(taken.inventory, 0)).toStrictEqual({ item: 'STONE', count: MAX_STACK_COUNT })
    }),
  )

  it.effect('removeItem drains an over-full slot entirely when asked for all of it', () =>
    Effect.sync(() => {
      const taken = removeItem(corruptSlot('STONE', 200), 'STONE', 200)

      expect(taken.removed).toBe(200)
      expect(isEmpty(taken.inventory)).toBe(true)
    }),
  )

  it.effect('a NaN or fractional count cannot poison `removed` with arithmetic', () =>
    Effect.sync(() => {
      // Math.min(NaN, remaining) is NaN, `remaining -= NaN` ends the loop, and
      // `removed` came back NaN — a number every caller would have believed.
      const poisoned = removeItem(corruptSlot('STONE', Number.NaN), 'STONE', 5)
      expect(Number.isNaN(poisoned.removed)).toBe(false)
      expect(poisoned.removed).toBe(0)

      const fractional = removeItem(corruptSlot('STONE', 7.5), 'STONE', 3)
      expect(fractional.removed).toBe(3)
      expect(slotAt(fractional.inventory, 0)).toStrictEqual({ item: 'STONE', count: 4 })
    }),
  )

  it.effect('addItem and countOf are total on the same slots', () =>
    Effect.sync(() => {
      expect(() => addItem(corruptSlot('STONE', Number.NaN), 'STONE', 5)).not.toThrow()
      expect(countOf(corruptSlot('STONE', Number.NaN), 'STONE')).toBe(0)
      // An over-full slot is reported honestly rather than clamped by a reader:
      // 200 items really are in there until something repairs them.
      expect(countOf(corruptSlot('STONE', 200), 'STONE')).toBe(200)
      // ...and it is full, so a top-up opens the next slot instead.
      const added = addItem(corruptSlot('STONE', 200), 'STONE', 10)
      expect(added.leftover).toBe(0)
      expect(slotAt(added.inventory, 1)).toStrictEqual({ item: 'STONE', count: 10 })
    }),
  )
})

/**
 * REGRESSION: a save cannot resize the player.
 *
 * `InventoryService.restore` installed whatever it was handed, and a snapshot
 * crosses a version boundary — which is exactly when a slot count changes. A
 * two-slot save turned a 36-slot player into a two-slot one, and the next 1000
 * mined blocks became 128 accepted and 872 on the floor, with no symptom beyond
 * an inventory that was mysteriously always full.
 */
describe('REGRESSION: normaliseInventory re-establishes the slot count without losing items', () => {
  it.effect('a short save is padded back to INVENTORY_SLOT_COUNT', () =>
    Effect.sync(() => {
      const repaired = normaliseInventory({ slots: [undefined, undefined] })

      expect(repaired.inventory.slots).toHaveLength(36)
      expect(repaired.leftover).toBe(0)
      expect(isEmpty(repaired.inventory)).toBe(true)
    }),
  )

  it.effect('a LONGER save has its tail re-inserted, not truncated away', () =>
    Effect.sync(() => {
      // Truncating would be the same defect facing the other way: items that
      // vanish on load with nothing said about them.
      const long: Inventory = {
        slots: [
          ...emptyInventory().slots,
          { item: 'DIAMOND', count: 5 as StackCount },
          { item: 'DIAMOND', count: 3 as StackCount },
        ],
      }
      const repaired = normaliseInventory(long)

      expect(repaired.inventory.slots).toHaveLength(36)
      expect(countOf(repaired.inventory, 'DIAMOND')).toBe(8)
      expect(repaired.leftover).toBe(0)
    }),
  )

  it.effect('an over-full slot keeps a full stack and the surplus spills into free slots', () =>
    Effect.sync(() => {
      const repaired = normaliseInventory(corruptSlot('STONE', 200))

      // Every one of the 200 is still there, now representable: 64 + 64 + 64 + 8.
      expect(countOf(repaired.inventory, 'STONE')).toBe(200)
      expect(repaired.leftover).toBe(0)
      expect(slotAt(repaired.inventory, 0)).toStrictEqual({ item: 'STONE', count: 64 })
      expect(slotAt(repaired.inventory, 3)).toStrictEqual({ item: 'STONE', count: 8 })
    }),
  )

  it.effect('what genuinely does not fit is REPORTED, in the same currency as add', () =>
    Effect.sync(() => {
      // A save whose every slot is over-full cannot be made to fit. The excess
      // becomes dropped-item entities on the ground, which is what the caller
      // does with `add`'s leftover — so it must not be swallowed here either.
      const crammed: Inventory = {
        slots: Array.from({ length: INVENTORY_SLOT_COUNT }, () => ({
          item: 'DIRT',
          count: 100 as StackCount,
        })),
      }
      const repaired = normaliseInventory(crammed)

      expect(countOf(repaired.inventory, 'DIRT')).toBe(INVENTORY_SLOT_COUNT * MAX_STACK_COUNT)
      expect(repaired.leftover).toBe(INVENTORY_SLOT_COUNT * (100 - MAX_STACK_COUNT))
    }),
  )

  it.effect('an empty, fractional or NaN stack becomes an empty slot', () =>
    Effect.sync(() => {
      expect(isEmpty(normaliseInventory(corruptSlot('STONE', 0)).inventory)).toBe(true)
      expect(isEmpty(normaliseInventory(corruptSlot('STONE', Number.NaN)).inventory)).toBe(true)
      expect(isEmpty(normaliseInventory(corruptSlot('STONE', -4)).inventory)).toBe(true)
      // A fraction keeps its whole part rather than being discarded outright.
      expect(slotAt(normaliseInventory(corruptSlot('STONE', 7.5)).inventory, 0)).toStrictEqual({
        item: 'STONE',
        count: 7,
      })
    }),
  )

  it.effect('a HEALTHY inventory round-trips unchanged, so the repair costs a good save nothing', () =>
    Effect.sync(() => {
      const stocked = addItem(emptyInventory(), 'COBBLESTONE', 130).inventory
      const repaired = normaliseInventory(stocked)

      expect(repaired.inventory).toStrictEqual(stocked)
      expect(repaired.leftover).toBe(0)
      expect(normaliseInventory(emptyInventory()).inventory).toStrictEqual(emptyInventory())
    }),
  )
})

describe('REGRESSION: InventoryService.restore is the guarded path, and reports what did not fit', () => {
  it.effect('a two-slot save no longer resizes a 36-slot player', () =>
    Effect.gen(function* () {
      // The numbers from `--stats` INV-SLOTS before the fix: a 2-slot player
      // accepted 128 of 1000 and dropped 872. All 1000 - 36 * 64 = -1304, so
      // the whole 1000 now fits.
      const service = yield* makeInventoryService()
      expect(yield* service.restore({ slots: [undefined, undefined] })).toBe(0)

      expect((yield* service.snapshot).slots).toHaveLength(36)
      expect(yield* service.add('STONE', 1000)).toBe(0)
      expect(yield* service.countOf('STONE')).toBe(1000)
    }),
  )

  it.effect('a restored over-full slot leaves remove() working, where it used to die', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.restore(corruptSlot('STONE', 200))

      expect(yield* service.countOf('STONE')).toBe(200)
      expect(yield* service.remove('STONE', 70)).toBe(70)
      expect(yield* service.countOf('STONE')).toBe(130)
    }),
  )

  it.effect('the constructor is guarded too, so a Layer cannot start life with two slots', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService({ slots: [undefined, undefined] })

      expect((yield* service.snapshot).slots).toHaveLength(36)
    }),
  )

  it.effect('restore resolves to the leftover, which the caller drops on the ground', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const crammed: Inventory = {
        slots: Array.from({ length: INVENTORY_SLOT_COUNT }, () => ({
          item: 'DIRT',
          count: 100 as StackCount,
        })),
      }

      expect(yield* service.restore(crammed)).toBe(INVENTORY_SLOT_COUNT * 36)
      expect(yield* service.countOf('DIRT')).toBe(INVENTORY_SLOT_COUNT * MAX_STACK_COUNT)
    }),
  )
})

describe('InventoryService concurrency', () => {
  it.effect('REGRESSION: concurrent adds all land — Ref.modify, not get-then-set', () =>
    Effect.gen(function* () {
      // A get-then-set implementation loses writes here: two fibers read the
      // same inventory and the second overwrites the first. This is the TOCTOU
      // hazard plan.md §3.8 names among the Effect conventions to carry over.
      const service = yield* makeInventoryService()

      const fibers = yield* Effect.forEach(
        Array.from({ length: 50 }, (_, index) => index),
        () => Effect.fork(service.add('STONE', 1)),
        { concurrency: 'unbounded' },
      )
      yield* Effect.forEach(fibers, Fiber.join)

      expect(yield* service.countOf('STONE')).toBe(50)
    }),
  )

  it.effect('concurrent removes never take more than exists', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      yield* service.add('STONE', 10)

      const fibers = yield* Effect.forEach(
        Array.from({ length: 20 }, (_, index) => index),
        () => Effect.fork(service.remove('STONE', 1)),
        { concurrency: 'unbounded' },
      )
      const removals = yield* Effect.forEach(fibers, Fiber.join)

      expect(removals.reduce((total, removed) => total + removed, 0)).toBe(10)
      expect(yield* service.countOf('STONE')).toBe(0)
    }),
  )

  it.effect('add resolves to the leftover, which is the value the caller must act on', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()

      expect(yield* service.add('DIRT', INVENTORY_SLOT_COUNT * MAX_STACK_COUNT)).toBe(0)
      expect(yield* service.add('DIRT', 7)).toBe(7)
    }),
  )
})
