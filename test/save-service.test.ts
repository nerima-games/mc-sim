import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { InMemoryStorageLayer, saveEnvelope, StoragePort } from '@nerima-games/mc-save'
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
      { item: 'iron_ingot', count: 12 },
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
        expect(String(result.left.cause)).toContain('expected an item registered by mc-kernel')
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

  it.effect('migrates v1 saves to the v2 state shape', () =>
    Effect.gen(function* () {
      const key = simulationSaveKey('world:v1')
      const storagePort = yield* StoragePort
      yield* storagePort.put(
        key,
        saveEnvelope('@nerima-games/mc-sim/simulation', 1, {
          dimension: 'overworld',
          tick: 20,
          player: {
            position: { x: 0, y: 64, z: 0 },
            inventory: [null],
          },
        }),
      )

      expect(yield* loadSimulation(key)).toStrictEqual(
        Option.some({
          dimension: 'overworld',
          tick: 20,
          player: {
            position: { x: 0, y: 64, z: 0 },
            inventory: [null],
            selectedHotbarSlot: 0,
          },
          statistics: { counters: {}, unlocked: [] },
        }),
      )
    }).pipe(Effect.provide(storage)),
  )
})
