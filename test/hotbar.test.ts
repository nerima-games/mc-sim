import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import {
  HotbarService,
  HotbarServiceLayer,
} from '../src/application/hotbar-service'
import {
  InventoryService,
  InventoryServiceLayer,
} from '../src/application/inventory-service'
import {
  HOTBAR_SIZE,
  HOTBAR_START,
  clampHotbarIndex,
  cycleHotbarIndex,
  hotbarSlotIndex,
  isHotbarIndex,
} from '../src/domain/hotbar'
import { emptyInventory, itemStack } from '../src/domain/inventory'

const hotbarInventory = () => {
  const slots = [...emptyInventory().slots]
  slots[HOTBAR_START] = itemStack('stone', 4)
  slots[HOTBAR_START + HOTBAR_SIZE - 1] = itemStack('wooden_pickaxe', 1)
  return { slots }
}

const serviceLayer = () =>
  Layer.provideMerge(InventoryServiceLayer(hotbarInventory()))(HotbarServiceLayer)

describe('hotbar domain', () => {
  it.effect('recognises only integer selections in the nine-slot range', () =>
    Effect.sync(() => {
      expect(HOTBAR_SIZE).toBe(9)
      expect(HOTBAR_START).toBe(27)
      expect(isHotbarIndex(0)).toBe(true)
      expect(isHotbarIndex(8)).toBe(true)
      expect(isHotbarIndex(-1)).toBe(false)
      expect(isHotbarIndex(9)).toBe(false)
      expect(isHotbarIndex(1.5)).toBe(false)
      expect(isHotbarIndex(Number.NaN)).toBe(false)
    }),
  )

  it.effect('clamps invalid external selections to vanilla boundaries', () =>
    Effect.sync(() => {
      expect(clampHotbarIndex(-1)).toBe(0)
      expect(clampHotbarIndex(2.9)).toBe(2)
      expect(clampHotbarIndex(8)).toBe(8)
      expect(clampHotbarIndex(9)).toBe(8)
      expect(clampHotbarIndex(Number.NaN)).toBe(0)
      expect(clampHotbarIndex(Number.POSITIVE_INFINITY)).toBe(0)
    }),
  )

  it.effect('cycles selections with positive and negative wheel deltas', () =>
    Effect.sync(() => {
      expect(cycleHotbarIndex(0, 0)).toBe(0)
      expect(cycleHotbarIndex(0, Number.NaN)).toBe(0)
      expect(cycleHotbarIndex(8, 1)).toBe(0)
      expect(cycleHotbarIndex(0, -1)).toBe(8)
      expect(cycleHotbarIndex(8, 1.9)).toBe(0)
      expect(cycleHotbarIndex(1, -2.9)).toBe(8)
      expect(hotbarSlotIndex(-1)).toBe(HOTBAR_START)
      expect(hotbarSlotIndex(8)).toBe(HOTBAR_START + 8)
    }),
  )
})

describe('HotbarService', () => {
  it.effect('starts at slot zero and clamps direct selection', () =>
    Effect.gen(function* () {
      const hotbar = yield* HotbarService
      expect(yield* hotbar.getSelectedSlot).toBe(0)
      yield* hotbar.setSelectedSlot(-1)
      expect(yield* hotbar.getSelectedSlot).toBe(0)
      yield* hotbar.setSelectedSlot(9)
      expect(yield* hotbar.getSelectedSlot).toBe(8)
      yield* hotbar.setSelectedSlot(Number.POSITIVE_INFINITY)
      expect(yield* hotbar.getSelectedSlot).toBe(0)
    }).pipe(Effect.provide(serviceLayer())),
  )

  it.effect('reads the selected item and all hotbar slots from InventoryService', () =>
    Effect.gen(function* () {
      const hotbar = yield* HotbarService
      const slots = yield* hotbar.getSlots
      expect(slots).toHaveLength(HOTBAR_SIZE)
      expect(slots[0]).toStrictEqual({ item: 'stone', count: 4 })
      expect(slots[1]).toBeUndefined()
      expect(slots[8]).toStrictEqual({
        item: 'wooden_pickaxe',
        count: 1,
        durability: { current: 59, max: 59 },
      })
      expect(yield* hotbar.getSelectedItem).toStrictEqual({ item: 'stone', count: 4 })
      yield* hotbar.setSelectedSlot(8)
      expect(yield* hotbar.getSelectedItem).toStrictEqual({
        item: 'wooden_pickaxe',
        count: 1,
        durability: { current: 59, max: 59 },
      })
    }).pipe(Effect.provide(serviceLayer())),
  )

  it.effect('wraps scrolling and applies combined input updates atomically', () =>
    Effect.gen(function* () {
      const hotbar = yield* HotbarService
      yield* hotbar.scroll(-1)
      expect(yield* hotbar.getSelectedSlot).toBe(8)
      yield* hotbar.scroll(1)
      expect(yield* hotbar.getSelectedSlot).toBe(0)
      yield* hotbar.update({ selectedSlot: 2 })
      expect(yield* hotbar.getSelectedSlot).toBe(2)
      yield* hotbar.update({ wheelDelta: -1 })
      expect(yield* hotbar.getSelectedSlot).toBe(1)
      yield* hotbar.update({ selectedSlot: 8, wheelDelta: 1 })
      expect(yield* hotbar.getSelectedSlot).toBe(0)
      yield* hotbar.update({})
      expect(yield* hotbar.getSelectedSlot).toBe(0)
    }).pipe(Effect.provide(serviceLayer())),
  )

  it.effect('exposes the same service through the composed inventory layer', () =>
    Effect.gen(function* () {
      const inventory = yield* InventoryService
      const hotbar = yield* HotbarService
      expect(yield* inventory.getHotbarSlots).toHaveLength(HOTBAR_SIZE)
      expect(yield* hotbar.getSelectedSlot).toBe(0)
    }).pipe(Effect.provide(serviceLayer())),
  )
})
