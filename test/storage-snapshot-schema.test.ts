import { expect, it } from '@effect/vitest'
import { Result, Schema } from 'effect'
import {
  ContainerStorageSnapshotSchema,
  PlayerStorageSnapshotSchema,
} from '../src/application/container-service.js'
import {
  CHEST_CONTAINER_CAPACITY,
  CONTAINER_STORAGE_SNAPSHOT_VERSION,
  emptyContainer,
  emptyContainerStorage,
  snapshotContainerStorage,
  validateContainerStorageSnapshot,
} from '../src/domain/container-storage.js'
import { itemStack as itemStackResult } from '../src/domain/inventory.js'
import {
  emptyPlayerStorage,
  storageFromInventory,
  validatePlayerStorageSnapshot,
} from '../src/domain/player-storage.js'

const decodeContainerSnapshot = Schema.decodeUnknownResult(ContainerStorageSnapshotSchema)
const decodePlayerSnapshot = Schema.decodeUnknownResult(PlayerStorageSnapshotSchema)

it('requires a complete container snapshot with unique ids and capacity-matched slots', () => {
  const empty = emptyContainerStorage()
  const validEmpty = snapshotContainerStorage(empty)
  expect(Result.isSuccess(decodeContainerSnapshot(validEmpty))).toBe(true)

  const chest = emptyContainer('chest-a', 'chest')
  const valid = { version: CONTAINER_STORAGE_SNAPSHOT_VERSION, containers: [chest] }
  expect(Result.isSuccess(decodeContainerSnapshot(valid))).toBe(true)

  const stone = itemStackResult('stone', 1)
  if (Result.isFailure(stone)) throw stone.failure
  const filledChest = {
    ...chest,
    slots: [{ ...stone.success, durability: null }, ...chest.slots.slice(1)],
  }
  expect(Result.isSuccess(decodeContainerSnapshot({ ...valid, containers: [filledChest] }))).toBe(true)

  const { kind: _kind, ...missingKind } = chest
  const { id: _id, ...missingId } = chest
  const { slots: _slots, ...missingSlots } = chest
  expect(Result.isFailure(decodeContainerSnapshot({ ...valid, containers: [missingKind] }))).toBe(true)
  expect(Result.isFailure(decodeContainerSnapshot({ ...valid, containers: [missingId] }))).toBe(true)
  expect(Result.isFailure(decodeContainerSnapshot({ ...valid, containers: [missingSlots] }))).toBe(true)
  expect(Result.isFailure(decodeContainerSnapshot({ ...valid, containers: [{ ...chest, id: null }] }))).toBe(true)
  expect(Result.isFailure(decodeContainerSnapshot({ ...valid, containers: [{ ...chest, kind: null }] }))).toBe(true)
  expect(Result.isFailure(decodeContainerSnapshot({ ...valid, containers: [{ ...chest, slots: null }] }))).toBe(true)
  expect(Result.isFailure(decodeContainerSnapshot({
    ...valid,
    containers: [{ ...chest, slots: Array.from({ length: CHEST_CONTAINER_CAPACITY - 1 }, () => null) }],
  }))).toBe(true)
  expect(Result.isFailure(decodeContainerSnapshot({
    ...valid,
    containers: [chest, chest],
  }))).toBe(true)

  for (const missing of [
    { version: CONTAINER_STORAGE_SNAPSHOT_VERSION },
    { containers: [chest] },
  ]) {
    expect(Result.isFailure(decodeContainerSnapshot(missing))).toBe(true)
  }
  expect(Result.isFailure(decodeContainerSnapshot({ version: null, containers: [chest] }))).toBe(true)
  expect(Result.isFailure(decodeContainerSnapshot({ version: CONTAINER_STORAGE_SNAPSHOT_VERSION, containers: null }))).toBe(true)
  expect(Result.isFailure(decodeContainerSnapshot(null))).toBe(true)
  expect(Result.isFailure(decodeContainerSnapshot({
    version: CONTAINER_STORAGE_SNAPSHOT_VERSION,
    containers: [{ ...chest, slots: Array.from({ length: 9 }, () => null), kind: 'hopper' }],
  }))).toBe(true)

  expect(validateContainerStorageSnapshot({
    version: CONTAINER_STORAGE_SNAPSHOT_VERSION,
    containers: [missingKind],
  })._tag).toBe('Invalid')
})

it('requires complete player storage and rejects null inventory slots that ingress normalizes', () => {
  const empty = emptyPlayerStorage()
  expect(Result.isSuccess(decodePlayerSnapshot(empty))).toBe(true)

  const stone = itemStackResult('stone', 1)
  if (Result.isFailure(stone)) throw stone.failure
  const withStone = storageFromInventory({ slots: [stone.success, ...empty.inventory.slots.slice(1)] })
  expect(Result.isSuccess(decodePlayerSnapshot(withStone))).toBe(true)

  const boots = itemStackResult('iron_boots', 1)
  if (Result.isFailure(boots)) throw boots.failure
  const withBoots = storageFromInventory({ slots: [boots.success, ...empty.inventory.slots.slice(1)] })
  expect(Result.isSuccess(decodePlayerSnapshot(withBoots))).toBe(true)

  for (const key of ['inventory', 'equipment', 'inventoryDurability'] as const) {
    const missing: Record<string, unknown> = { ...empty }
    delete missing[key]
    expect(Result.isFailure(decodePlayerSnapshot(missing)), `missing ${key}`).toBe(true)
    expect(Result.isFailure(decodePlayerSnapshot({ ...empty, [key]: null })), `null ${key}`).toBe(true)
  }
  expect(Result.isFailure(decodePlayerSnapshot({
    ...empty,
    inventory: {},
  }))).toBe(true)
  expect(Result.isFailure(decodePlayerSnapshot({
    ...empty,
    equipment: {},
  }))).toBe(true)
  expect(Result.isFailure(decodePlayerSnapshot({
    ...empty,
    inventory: { slots: [null, ...empty.inventory.slots.slice(1)] },
  }))).toBe(true)
  expect(validatePlayerStorageSnapshot({
    ...empty,
    inventory: { slots: [null, ...empty.inventory.slots.slice(1)] },
  })._tag).toBe('Valid')
  expect(Result.isFailure(decodePlayerSnapshot({
    ...empty,
    inventory: { slots: empty.inventory.slots.slice(1) },
  }))).toBe(true)
  expect(Result.isFailure(decodePlayerSnapshot({
    ...empty,
    inventoryDurability: empty.inventoryDurability.slice(1),
  }))).toBe(true)
  for (const key of ['item', 'count', 'components'] as const) {
    const invalidStack = { ...stone.success, [key]: null }
    expect(Result.isFailure(decodePlayerSnapshot({
      ...withStone,
      inventory: { slots: [invalidStack, ...withStone.inventory.slots.slice(1)] },
    })), `null inventory stack ${key}`).toBe(true)
  }

  expect(Result.isFailure(decodePlayerSnapshot({
    ...withStone,
    inventoryDurability: [{ current: 1, max: 1 }, ...withStone.inventoryDurability.slice(1)],
  }))).toBe(true)
  expect(Result.isFailure(decodePlayerSnapshot({
    ...withBoots,
    inventoryDurability: [null, ...withBoots.inventoryDurability.slice(1)],
  }))).toBe(true)
  const bootsDurability = withBoots.inventoryDurability[0]
  if (bootsDurability === null || bootsDurability === undefined) throw new Error('boots durability fixture missing')
  expect(Result.isFailure(decodePlayerSnapshot({
    ...withBoots,
    inventoryDurability: [
      { current: bootsDurability.current, max: bootsDurability.max - 1 },
      ...withBoots.inventoryDurability.slice(1),
    ],
  }))).toBe(true)

  const { offhand: _offhand, ...missingEquipmentSlot } = empty.equipment.slots
  expect(Result.isFailure(decodePlayerSnapshot({
    ...empty,
    equipment: { slots: missingEquipmentSlot },
  }))).toBe(true)
})
