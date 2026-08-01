import { Brand } from 'effect'
import type { Position } from './kernel-vocabulary'
import type { Dimension } from './worldgen-vocabulary'

export type VehicleId = string & Brand.Brand<'VehicleId'>
export const VehicleId = Brand.refined<VehicleId>(
  (value) => typeof value === 'string' && value.trim().length > 0,
  () => Brand.error('VehicleId must be a non-blank string'),
)

export type OccupantId = string & Brand.Brand<'VehicleOccupantId'>
export const OccupantId = Brand.refined<OccupantId>(
  (value) => typeof value === 'string' && value.trim().length > 0,
  () => Brand.error('OccupantId must be a non-blank string'),
)

export type VehicleType = 'boat' | 'minecart'
export type VehicleVelocity = Readonly<{ x: number; y: number; z: number }>
export type Vehicle = Readonly<{
  id: VehicleId
  type: VehicleType
  dimension: Dimension
  position: Position
  velocity: VehicleVelocity
  yawRadians: number
  occupant?: OccupantId
}>

export type VehicleSnapshot = Readonly<{
  vehicles: ReadonlyArray<Vehicle>
  nextSerial: number
}>

export type VehicleValidationError = Readonly<{
  _tag: 'VehicleValidationError'
  path: string
  reason: string
}>

export type VehicleValidationResult =
  | Readonly<{ _tag: 'Valid'; snapshot: VehicleSnapshot }>
  | Readonly<{ _tag: 'Invalid'; error: VehicleValidationError }>

const invalid = (path: string, reason: string): VehicleValidationResult => ({
  _tag: 'Invalid',
  error: { _tag: 'VehicleValidationError', path, reason },
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const vector = (value: unknown): value is Position =>
  isRecord(value) && finite(value['x']) && finite(value['y']) && finite(value['z'])
const dimension = (value: unknown): value is Dimension =>
  value === 'overworld' || value === 'nether' || value === 'end'

export const validateVehicleSnapshot = (value: unknown): VehicleValidationResult => {
  if (!isRecord(value) || !Array.isArray(value['vehicles'])) return invalid('snapshot.vehicles', 'must be an array')
  const vehicles = value['vehicles']
  const nextSerial = value['nextSerial']
  if (!Number.isSafeInteger(nextSerial) || (nextSerial as number) < 0)
    return invalid('snapshot.nextSerial', 'must be a non-negative safe integer')

  const ids = new Set<string>()
  const occupants = new Set<string>()
  let highestSerial = -1
  for (let index = 0; index < vehicles.length; index += 1) {
    const item = vehicles[index]
    const path = `snapshot.vehicles[${index}]`
    if (!isRecord(item)) return invalid(path, 'must be an object')
    const id = item['id']
    if (typeof id !== 'string' || id.trim().length === 0) return invalid(`${path}.id`, 'must be non-blank')
    if (ids.has(id)) return invalid(`${path}.id`, 'must be unique')
    ids.add(id)
    const serialMatch = /^v:(\d+)$/.exec(id)
    if (serialMatch !== null) highestSerial = Math.max(highestSerial, Number(serialMatch[1]))
    if (item['type'] !== 'boat' && item['type'] !== 'minecart') return invalid(`${path}.type`, 'must be boat or minecart')
    if (!dimension(item['dimension'])) return invalid(`${path}.dimension`, 'must be a supported dimension')
    if (!vector(item['position'])) return invalid(`${path}.position`, 'must contain finite coordinates')
    if (!vector(item['velocity'])) return invalid(`${path}.velocity`, 'must contain finite coordinates')
    if (!finite(item['yawRadians'])) return invalid(`${path}.yawRadians`, 'must be finite')
    const occupant = item['occupant']
    if (occupant !== undefined) {
      if (typeof occupant !== 'string' || occupant.trim().length === 0)
        return invalid(`${path}.occupant`, 'must be non-blank')
      if (occupants.has(occupant)) return invalid(`${path}.occupant`, 'must occupy at most one vehicle')
      occupants.add(occupant)
    }
  }
  if ((nextSerial as number) <= highestSerial)
    return invalid('snapshot.nextSerial', 'must be greater than every minted vehicle id')
  return { _tag: 'Valid', snapshot: value as VehicleSnapshot }
}

export const emptyVehicleSnapshot = (): VehicleSnapshot => ({ vehicles: [], nextSerial: 0 })
