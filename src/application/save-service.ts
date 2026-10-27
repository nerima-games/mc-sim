import {
  listFrom,
  loadFrom,
  SaveDecodeError,
  SaveKey,
  saveTo,
  type SaveListing,
  type SaveKey as SaveKeyType,
  StorageError,
  type StoragePort,
} from '@nerima-games/mc-save'
import { Schema, type Effect, type Option } from 'effect'
import { SIMULATION_SAVE_FORMAT, SIMULATION_SAVE_SCHEMA, type SimulationSave } from '../domain/save-data.js'

export type SimulationSaveListing = SaveListing<SimulationSave>

export const SaveSimulationSuccessSchema: Schema.Codec<void, undefined> = Schema.Undefined

export const LoadSimulationSuccessSchema: Schema.Codec<Option.Option<SimulationSave>, unknown> =
  Schema.Option(SIMULATION_SAVE_SCHEMA)

export const SimulationSaveErrorSchema: Schema.Codec<StorageError | SaveDecodeError, unknown> = Schema.Union([
  Schema.instanceOf(StorageError),
  Schema.instanceOf(SaveDecodeError),
])

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

export const listSimulationSaves = (): Effect.Effect<
  SimulationSaveListing,
  StorageError | SaveDecodeError,
  StoragePort
> => listFrom(SIMULATION_SAVE_FORMAT)
