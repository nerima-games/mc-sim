import {
  listFrom,
  loadFrom,
  SaveKey,
  saveTo,
  type SaveListing,
  type SaveKey as SaveKeyType,
} from '@nerima-games/mc-save'
import { SIMULATION_SAVE_FORMAT, type SimulationSave } from '../domain/save-data'

export type SimulationSaveListing = SaveListing<SimulationSave>

export const simulationSaveKey = (value: string): SaveKeyType => SaveKey(value)

export const saveSimulation = (key: SaveKeyType, value: SimulationSave) =>
  saveTo(SIMULATION_SAVE_FORMAT, key, value)

export const loadSimulation = (key: SaveKeyType) => loadFrom(SIMULATION_SAVE_FORMAT, key)

export const listSimulationSaves = () => listFrom(SIMULATION_SAVE_FORMAT)
