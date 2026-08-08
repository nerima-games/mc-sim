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
  occupant?: OccupantId | undefined
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

const invalidError = (path: string, reason: string): VehicleValidationError => ({
  _tag: 'VehicleValidationError', path, reason,
})
const invalid = (path: string, reason: string): VehicleValidationResult => ({
  _tag: 'Invalid',
  error: invalidError(path, reason),
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const vector = (value: unknown): value is Position =>
  isRecord(value) && finite(value['x']) && finite(value['y']) && finite(value['z'])
const dimension = (value: unknown): value is Dimension =>
  value === 'overworld' || value === 'nether' || value === 'end'

type VehicleItemValidation =
  | { readonly _tag: 'Invalid'; readonly error: VehicleValidationError }
  | { readonly _tag: 'Valid'; readonly serial: number | undefined }

/** `ids` and `occupants` accumulate across every item in the snapshot, so both are mutated in place. */
const validateVehicleItem = (
  item: unknown, path: string, ids: Set<string>, occupants: Set<string>,
): VehicleItemValidation => {
  if (!isRecord(item)) return { _tag: 'Invalid', error: invalidError(path, 'must be an object') }
  const id = item['id']
  if (typeof id !== 'string' || id.trim().length === 0)
    return { _tag: 'Invalid', error: invalidError(`${path}.id`, 'must be non-blank') }
  if (ids.has(id)) return { _tag: 'Invalid', error: invalidError(`${path}.id`, 'must be unique') }
  ids.add(id)
  const serialMatch = /^v:(\d+)$/.exec(id)
  const serial = serialMatch === null ? undefined : Number(serialMatch[1])
  if (item['type'] !== 'boat' && item['type'] !== 'minecart')
    return { _tag: 'Invalid', error: invalidError(`${path}.type`, 'must be boat or minecart') }
  if (!dimension(item['dimension']))
    return { _tag: 'Invalid', error: invalidError(`${path}.dimension`, 'must be a supported dimension') }
  if (!vector(item['position']))
    return { _tag: 'Invalid', error: invalidError(`${path}.position`, 'must contain finite coordinates') }
  if (!vector(item['velocity']))
    return { _tag: 'Invalid', error: invalidError(`${path}.velocity`, 'must contain finite coordinates') }
  if (!finite(item['yawRadians']))
    return { _tag: 'Invalid', error: invalidError(`${path}.yawRadians`, 'must be finite') }
  const occupant = item['occupant']
  if (occupant !== undefined) {
    if (typeof occupant !== 'string' || occupant.trim().length === 0)
      return { _tag: 'Invalid', error: invalidError(`${path}.occupant`, 'must be non-blank') }
    if (occupants.has(occupant))
      return { _tag: 'Invalid', error: invalidError(`${path}.occupant`, 'must occupy at most one vehicle') }
    occupants.add(occupant)
  }
  return { _tag: 'Valid', serial }
}

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
    const validated = validateVehicleItem(vehicles[index], `snapshot.vehicles[${index}]`, ids, occupants)
    if (validated._tag === 'Invalid') return { _tag: 'Invalid', error: validated.error }
    if (validated.serial !== undefined) highestSerial = Math.max(highestSerial, validated.serial)
  }
  if ((nextSerial as number) <= highestSerial)
    return invalid('snapshot.nextSerial', 'must be greater than every minted vehicle id')
  return { _tag: 'Valid', snapshot: value as VehicleSnapshot }
}

export const emptyVehicleSnapshot = (): VehicleSnapshot => ({ vehicles: [], nextSerial: 0 })
