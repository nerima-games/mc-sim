import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import {
  addItem,
  countOf,
  emptyInventory,
  INVENTORY_SLOT_COUNT,
  isEmpty,
  removeItem,
  slotAt,
} from '../domain/inventory'
import { MAX_STACK_COUNT } from '../domain/kernel-vocabulary'
import { makeInventoryService } from '../application/inventory-service'

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
