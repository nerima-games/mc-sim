import {
  isDimension,
  OccupantId,
  VehicleId,
  type Vehicle,
  type VehicleSnapshot,
  type VehicleValidationError,
  type VehicleValidationResult,
  type Position,
} from '@nerima-games/mc-kernel'

export { OccupantId, VehicleId } from '@nerima-games/mc-kernel'
export type {
  VehicleType,
  VehicleVelocity,
  Vehicle,
  VehicleSnapshot,
  VehicleValidationError,
  VehicleValidationResult,
} from '@nerima-games/mc-kernel'

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
type VehicleItemValidation =
  | { readonly _tag: 'Invalid'; readonly error: VehicleValidationError }
  | { readonly _tag: 'Valid'; readonly serial: number | undefined; readonly vehicle: Vehicle }

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
  if (!isDimension(item['dimension']))
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
  return {
    _tag: 'Valid',
    serial,
    vehicle: {
      id: VehicleId(id),
      type: item['type'],
      dimension: item['dimension'],
      position: item['position'],
      velocity: item['velocity'],
      yawRadians: item['yawRadians'],
      ...(occupant === undefined ? {} : { occupant: OccupantId(occupant) }),
    },
  }
}

export const validateVehicleSnapshot = (value: unknown): VehicleValidationResult => {
  if (!isRecord(value) || !Array.isArray(value['vehicles'])) return invalid('snapshot.vehicles', 'must be an array')
  const vehicles = value['vehicles']
  const nextSerial = value['nextSerial']
  if (typeof nextSerial !== 'number' || !Number.isSafeInteger(nextSerial) || nextSerial < 0)
    return invalid('snapshot.nextSerial', 'must be a non-negative safe integer')

  const ids = new Set<string>()
  const occupants = new Set<string>()
  const validatedVehicles: Array<Vehicle> = []
  let highestSerial = -1
  for (let index = 0; index < vehicles.length; index += 1) {
    const validated = validateVehicleItem(vehicles[index], `snapshot.vehicles[${index}]`, ids, occupants)
    if (validated._tag === 'Invalid') return { _tag: 'Invalid', error: validated.error }
    if (validated.serial !== undefined) highestSerial = Math.max(highestSerial, validated.serial)
    validatedVehicles.push(validated.vehicle)
  }
  if (nextSerial <= highestSerial)
    return invalid('snapshot.nextSerial', 'must be greater than every minted vehicle id')
  return { _tag: 'Valid', snapshot: { vehicles: validatedVehicles, nextSerial } }
}

export const emptyVehicleSnapshot = (): VehicleSnapshot => ({ vehicles: [], nextSerial: 0 })
