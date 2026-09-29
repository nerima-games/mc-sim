import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { itemStack } from '@nerima-games/mc-kernel'
import { InMemoryStorageLayer, saveEnvelope, sealSaveEnvelope, StoragePort } from '@nerima-games/mc-save'
import {
  listSimulationSaves,
  loadSimulation,
  saveSimulation,
  simulationSaveKey,
} from '../src/application/save-service'
import type { SimulationSave } from '../src/domain/save-data'

const save: SimulationSave = {
  dimension: 'overworld',
  tick: 240,
  player: {
    position: { x: 3.5, y: 64, z: -7.25 },
    inventory: [
      itemStack('iron_ingot', 12),
      null,
    ],
    selectedHotbarSlot: 2,
  },
  statistics: {
    counters: { 'blocks.mined': 12.5 },
    unlocked: ['getting_wood'],
  },
}

const storage = InMemoryStorageLayer

describe('simulation save service', () => {
  it.effect('round-trips kernel items and worldgen dimensions through mc-save', () =>
    Effect.gen(function* () {
      const key = simulationSaveKey('world:primary')
      yield* saveSimulation(key, save)

      expect(yield* loadSimulation(key)).toStrictEqual(Option.some(save))
      expect(yield* listSimulationSaves()).toStrictEqual({
        valid: [{ key, value: save }],
        corrupt: [],
      })
    }).pipe(Effect.provide(storage)),
  )

  it.effect('round-trips canonical components without changing their bytes', () =>
    Effect.gen(function* () {
      const key = simulationSaveKey('world:canonical')
      const canonical = itemStack('iron_ingot', 12)
      const value: SimulationSave = {
        ...save,
        player: { ...save.player, inventory: [canonical, null] },
      }
      const storagePort = yield* StoragePort

      yield* saveSimulation(key, value)
      const stored = yield* storagePort.get(key)
      const loaded = yield* loadSimulation(key)

      expect(Option.isSome(stored)).toBe(true)
      expect(loaded).toStrictEqual(Option.some(value))
      const firstPayload = JSON.stringify(Option.getOrThrow(stored).payload)
      const loadedValue = Option.getOrThrow(loaded)
      expect(loadedValue).toStrictEqual(value)

      const secondKey = simulationSaveKey('world:canonical-copy')
      yield* saveSimulation(secondKey, loadedValue)
      const copied = yield* storagePort.get(secondKey)
      expect(JSON.stringify(Option.getOrThrow(copied).payload)).toBe(firstPayload)
    }).pipe(Effect.provide(storage)),
  )

  it.effect('treats an absent key as a new world', () =>
    Effect.gen(function* () {
      expect(yield* loadSimulation(simulationSaveKey('world:missing'))).toStrictEqual(Option.none())
    }).pipe(Effect.provide(storage)),
  )

  it.effect('rejects an item outside the mc-kernel vocabulary at the save boundary', () =>
    Effect.gen(function* () {
      const invalid = {
        ...save,
        player: {
          ...save.player,
          inventory: [{ item: 'foreign_item', count: 1 }],
        },
      } as unknown as SimulationSave
      const result = yield* Effect.either(saveSimulation(simulationSaveKey('world:invalid'), invalid))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(String(result.left.cause)).toContain('expected a canonical ItemStack from mc-kernel')
      }
    }).pipe(Effect.provide(storage)),
  )

  it.effect('rejects a selected hotbar slot outside the nine-slot range', () =>
    Effect.gen(function* () {
      const invalid = {
        ...save,
        player: { ...save.player, selectedHotbarSlot: 9 },
      } as unknown as SimulationSave
      const result = yield* Effect.either(saveSimulation(simulationSaveKey('world:invalid-hotbar'), invalid))

      expect(result._tag).toBe('Left')
    }).pipe(Effect.provide(storage)),
  )

  // mc-save 0.3.0 removed the migration chain (README.md "旧版セーブを現行版へ自動変換する
  // migration chain は提供しません"): a save at any version other than the format's
  // current version is a decode error, not something loadFrom silently upgrades.
  // The old migration test asserted the opposite
  // and is gone with the feature it pinned; this asserts the new contract on a
  // properly SEALED (not just malformed) v2 envelope, so the rejection is shown
  // to be about the version mismatch specifically, not a missing/invalid integrity.
  it.effect('rejects a v2 save without implicitly adding canonical components', () =>
    Effect.gen(function* () {
      const key = simulationSaveKey('world:v2')
      const storagePort = yield* StoragePort
      const v2Envelope = sealSaveEnvelope(
        saveEnvelope('@nerima-games/mc-sim/simulation', 2, {
          dimension: 'overworld',
          tick: 20,
          player: {
            position: { x: 0, y: 64, z: 0 },
            inventory: [{ item: 'iron_ingot', count: 1 }],
            selectedHotbarSlot: 0,
          },
          statistics: { counters: {}, unlocked: [] },
        }),
      )
      yield* storagePort.put(key, v2Envelope)

      const result = yield* Effect.either(loadSimulation(key))

      expect(result._tag).toBe('Left')
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('SaveDecodeError')
      }
    }).pipe(Effect.provide(storage)),
  )
})
