import {
  listFrom,
  loadFrom,
  SaveKey,
  saveTo,
  type SaveDecodeError,
  type SaveListing,
  type SaveKey as SaveKeyType,
  type StorageError,
  type StoragePort,
} from '@nerima-games/mc-save'
import type { Effect, Option } from 'effect'
import { SIMULATION_SAVE_FORMAT, type SimulationSave } from '../domain/save-data.js'

export type SimulationSaveListing = SaveListing<SimulationSave>

export const simulationSaveKey = (value: string): SaveKeyType => SaveKey(value)

export const saveSimulation = (
  key: SaveKeyType,
  value: SimulationSave,
): Effect.Effect<void, StorageError | SaveDecodeError, StoragePort> =>
  saveTo(SIMULATION_SAVE_FORMAT, key, value)

export const loadSimulation = (
  key: SaveKeyType,
): Effect.Effect<Option.Option<SimulationSave>, StorageError | SaveDecodeError, StoragePort> =>
  loadFrom(SIMULATION_SAVE_FORMAT, key)

export const listSimulationSaves = (): Effect.Effect<SimulationSaveListing, StorageError, StoragePort> =>
  listFrom(SIMULATION_SAVE_FORMAT)
