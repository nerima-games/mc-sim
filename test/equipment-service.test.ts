import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeEquipmentService } from '../src/application/equipment-service'
import { durability, equipmentItem, type EquipmentItem } from '../src/domain/equipment'
import { itemStack } from '../src/domain/inventory'

const helmet = (current = 165): EquipmentItem =>
  equipmentItem(itemStack('iron_helmet', 1), durability(current, 165))

const flint = (current = 64): EquipmentItem =>
  equipmentItem(itemStack('flint_and_steel', 1), durability(current, 64))

describe('EquipmentService', () => {
  it.effect('exposes atomic equip and unequip operations to the host', () =>
    Effect.gen(function* () {
      const service = yield* makeEquipmentService()

      expect(yield* service.equip('head', helmet())).toBeNull()
      expect(yield* service.equip('offhand', flint())).toBeNull()
      yield* service.swap('head', 'offhand')
      expect((yield* service.unequip('offhand'))?.item).toBe('flint_and_steel')

      const snapshot = yield* service.snapshot
      expect(snapshot.slots.head?.item).toBe('iron_helmet')
      expect(snapshot.slots.offhand).toBeNull()
    }),
  )

  it.effect('damages and removes broken equipment in the same state update', () =>
    Effect.gen(function* () {
      const service = yield* makeEquipmentService()
      yield* service.equip('offhand', flint(3))

      expect(yield* service.damage('offhand', 1)).toMatchObject({
        _tag: 'Damaged', item: { durability: { current: 2, max: 64 } },
      })
      expect(yield* service.damage('offhand', 2)).toMatchObject({ _tag: 'Broken', applied: 2 })
      expect((yield* service.snapshot).slots.offhand).toBeNull()
    }),
  )

  it.effect('snapshots, resets, and restores a world-local equipment state', () =>
    Effect.gen(function* () {
      const service = yield* makeEquipmentService()
      yield* service.equip('head', helmet())
      const saved = yield* service.snapshot

      yield* service.reset
      expect((yield* service.snapshot).slots.head).toBeNull()
      yield* service.restore(JSON.parse(JSON.stringify(saved)))
      expect((yield* service.snapshot).slots.head?.item).toBe('iron_helmet')
    }),
  )

  it.effect('rejects malformed restore input without changing current state', () =>
    Effect.gen(function* () {
      const service = yield* makeEquipmentService()
      yield* service.equip('head', helmet())
      const before = yield* service.snapshot

      const error = yield* service
        .restore({ slots: { ...before.slots, head: { item: 'iron_helmet', count: 1 } } })
        .pipe(Effect.flip)

      expect(error).toMatchObject({ _tag: 'EquipmentValidationError' })
      expect(yield* service.snapshot).toStrictEqual(before)
    }),
  )

  it.effect('rejects arbitrary runtime items before updating the Ref', () =>
    Effect.gen(function* () {
      const service = yield* makeEquipmentService()
      const arbitrary = { ...itemStack('torch', 1), durability: null } as EquipmentItem
      const error = yield* service.equip('head', arbitrary).pipe(Effect.flip)

      expect(error).toMatchObject({ _tag: 'EquipmentValidationError', path: 'item' })
      expect((yield* service.snapshot).slots.head).toBeNull()
    }),
  )

  it.effect('serializes concurrent damage so no durability update is lost', () =>
    Effect.gen(function* () {
      const service = yield* makeEquipmentService()
      yield* service.equip('head', helmet(100))

      const outcomes = yield* Effect.all(
        Array.from({ length: 100 }, () => service.damage('head', 1)),
        { concurrency: 'unbounded' },
      )

      expect(outcomes.filter(({ _tag }) => _tag === 'Damaged')).toHaveLength(99)
      expect(outcomes.filter(({ _tag }) => _tag === 'Broken')).toHaveLength(1)
      expect((yield* service.snapshot).slots.head).toBeNull()
    }),
  )
})
