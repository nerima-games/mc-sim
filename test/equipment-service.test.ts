import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeEquipmentService } from '../application/equipment-service'
import { durability, equipmentItem, type EquipmentItem } from '../domain/equipment'
import { itemStack } from '../domain/inventory'

const pickaxe = (current = 3, max = 3): EquipmentItem =>
  equipmentItem(itemStack('wooden_pickaxe', 1), durability(current, max))

const torch = (): EquipmentItem => equipmentItem(itemStack('torch', 1))

describe('EquipmentService', () => {
  it.effect('exposes atomic equip, swap, and unequip operations to the host', () =>
    Effect.gen(function* () {
      const service = yield* makeEquipmentService()

      expect(yield* service.equip('head', torch())).toBeNull()
      expect(yield* service.equip('offhand', pickaxe())).toBeNull()
      yield* service.swap('head', 'offhand')
      expect((yield* service.unequip('offhand'))?.item).toBe('torch')

      const snapshot = yield* service.snapshot
      expect(snapshot.slots.head?.item).toBe('wooden_pickaxe')
      expect(snapshot.slots.offhand).toBeNull()
    }),
  )

  it.effect('damages and removes broken equipment in the same state update', () =>
    Effect.gen(function* () {
      const service = yield* makeEquipmentService()
      yield* service.equip('offhand', pickaxe())

      expect(yield* service.damage('offhand', 1)).toMatchObject({
        _tag: 'Damaged',
        item: { durability: { current: 2, max: 3 } },
      })
      expect(yield* service.damage('offhand', 2)).toMatchObject({ _tag: 'Broken', applied: 2 })
      expect((yield* service.snapshot).slots.offhand).toBeNull()
    }),
  )

  it.effect('snapshots, resets, and restores a world-local equipment state', () =>
    Effect.gen(function* () {
      const service = yield* makeEquipmentService()
      yield* service.equip('chest', torch())
      const saved = yield* service.snapshot

      yield* service.reset
      expect((yield* service.snapshot).slots.chest).toBeNull()
      yield* service.restore(JSON.parse(JSON.stringify(saved)))
      expect((yield* service.snapshot).slots.chest?.item).toBe('torch')
    }),
  )

  it.effect('rejects malformed restore input without changing current state', () =>
    Effect.gen(function* () {
      const service = yield* makeEquipmentService()
      yield* service.equip('feet', pickaxe())
      const before = yield* service.snapshot

      const error = yield* service
        .restore({ slots: { ...before.slots, feet: { item: 'wooden_pickaxe', count: 1 } } })
        .pipe(Effect.flip)

      expect(error).toMatchObject({ _tag: 'EquipmentValidationError' })
      expect(yield* service.snapshot).toStrictEqual(before)
    }),
  )

  it.effect('rejects malformed runtime items before updating the Ref', () =>
    Effect.gen(function* () {
      const service = yield* makeEquipmentService()
      const malformed = { item: 'torch', count: 0, durability: null } as unknown as EquipmentItem

      const error = yield* service.equip('head', malformed).pipe(Effect.flip)

      expect(error).toMatchObject({ _tag: 'EquipmentValidationError', path: 'item' })
      expect((yield* service.snapshot).slots.head).toBeNull()
    }),
  )

  it.effect('serializes concurrent damage so no durability update is lost', () =>
    Effect.gen(function* () {
      const service = yield* makeEquipmentService()
      yield* service.equip('offhand', pickaxe(100, 100))

      const outcomes = yield* Effect.all(
        Array.from({ length: 100 }, () => service.damage('offhand', 1)),
        { concurrency: 'unbounded' },
      )

      expect(outcomes.filter(({ _tag }) => _tag === 'Damaged')).toHaveLength(99)
      expect(outcomes.filter(({ _tag }) => _tag === 'Broken')).toHaveLength(1)
      expect((yield* service.snapshot).slots.offhand).toBeNull()
    }),
  )
})
