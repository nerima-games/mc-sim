import { Context, Effect, Layer, Ref } from 'effect'
import type { Position } from '@nerima-games/mc-kernel'
import type { Dimension } from '@nerima-games/mc-worldgen'
import {
  emptyVehicleSnapshot,
  type OccupantId,
  type Vehicle,
  type VehicleId,
  type VehicleSnapshot,
  type VehicleType,
  type VehicleValidationError,
  type VehicleVelocity,
  validateVehicleSnapshot,
} from '../domain/vehicle'

export type VehicleOperationError = Readonly<{
  _tag: 'VehicleOperationError'
  reason: 'not-found' | 'duplicate-occupant' | 'occupied' | 'occupant-mismatch' | 'invalid-transform'
}>

export type VehicleStateUpdate = Readonly<Pick<Vehicle, 'dimension' | 'position' | 'velocity' | 'yawRadians'> & {
  occupant?: OccupantId | undefined
}>

const operationError = (reason: VehicleOperationError['reason']): VehicleOperationError => ({
  _tag: 'VehicleOperationError', reason,
})
const validVector = (value: Position | VehicleVelocity): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
const validDimension = (value: Dimension): boolean => value === 'overworld' || value === 'nether' || value === 'end'
const update = (
  snapshot: VehicleSnapshot, id: VehicleId, valid: boolean, transform: (vehicle: Vehicle) => Vehicle,
): readonly [Effect.Effect<void, VehicleOperationError>, VehicleSnapshot] => {
  if (!valid) return [Effect.fail(operationError('invalid-transform')), snapshot]
  const index = snapshot.vehicles.findIndex((vehicle) => vehicle.id === id)
  if (index < 0) return [Effect.fail(operationError('not-found')), snapshot]
  const vehicles = snapshot.vehicles.slice()
  vehicles[index] = transform(vehicles[index]!)
  return [Effect.void, { ...snapshot, vehicles }]
}

export type VehicleServiceApi = Readonly<{
  vehicles: Effect.Effect<ReadonlyArray<Vehicle>>
  spawn: (type: VehicleType, dimension: Dimension, position: Position, yawRadians?: number) => Effect.Effect<Vehicle, VehicleOperationError>
  despawn: (id: VehicleId) => Effect.Effect<boolean>
  mount: (id: VehicleId, occupant: OccupantId) => Effect.Effect<void, VehicleOperationError>
  dismount: (id: VehicleId, occupant: OccupantId) => Effect.Effect<void, VehicleOperationError>
  updateVelocity: (id: VehicleId, velocity: VehicleVelocity) => Effect.Effect<void, VehicleOperationError>
  updateTransform: (id: VehicleId, dimension: Dimension, position: Position, yawRadians: number) => Effect.Effect<void, VehicleOperationError>
  updateState: (id: VehicleId, state: VehicleStateUpdate) => Effect.Effect<void, VehicleOperationError>
  snapshot: Effect.Effect<VehicleSnapshot>
  restore: (snapshot: unknown) => Effect.Effect<void, VehicleValidationError>
}>

export class VehicleService extends Context.Tag('@nerima-games/mc-sim/VehicleService')<VehicleService, VehicleServiceApi>() {}

export const makeVehicleService = (
  initial: unknown = emptyVehicleSnapshot(),
): Effect.Effect<VehicleServiceApi, VehicleValidationError> =>
  Effect.gen(function* () {
    const validated = validateVehicleSnapshot(initial)
    if (validated._tag === 'Invalid') return yield* Effect.fail(validated.error)
    const state = yield* Ref.make(validated.snapshot)
    const modify = <A>(f: (snapshot: VehicleSnapshot) => readonly [Effect.Effect<A, VehicleOperationError>, VehicleSnapshot]) =>
      Ref.modify(state, f).pipe(Effect.flatten)
    return {
      vehicles: Ref.get(state).pipe(Effect.map((snapshot) => snapshot.vehicles)),
      spawn: (type, dimension, position, yawRadians = 0) => modify((snapshot) => {
        if ((type !== 'boat' && type !== 'minecart') || !validDimension(dimension) || !validVector(position) || !Number.isFinite(yawRadians))
          return [Effect.fail(operationError('invalid-transform')), snapshot]
        const vehicle: Vehicle = {
          id: `v:${snapshot.nextSerial}` as VehicleId, type, dimension, position,
          velocity: { x: 0, y: 0, z: 0 }, yawRadians,
        }
        return [Effect.succeed(vehicle), { vehicles: [...snapshot.vehicles, vehicle], nextSerial: snapshot.nextSerial + 1 }]
      }),
      despawn: (id) => Ref.modify(state, (snapshot) => {
        const vehicles = snapshot.vehicles.filter((vehicle) => vehicle.id !== id)
        return [vehicles.length !== snapshot.vehicles.length, vehicles.length === snapshot.vehicles.length ? snapshot : { ...snapshot, vehicles }]
      }),
      mount: (id, occupant) => modify((snapshot) => {
        const index = snapshot.vehicles.findIndex((vehicle) => vehicle.id === id)
        if (index < 0) return [Effect.fail(operationError('not-found')), snapshot]
        if (snapshot.vehicles.some((vehicle) => vehicle.occupant === occupant)) return [Effect.fail(operationError('duplicate-occupant')), snapshot]
        if (snapshot.vehicles[index]?.occupant !== undefined) return [Effect.fail(operationError('occupied')), snapshot]
        const vehicles = snapshot.vehicles.slice()
        vehicles[index] = { ...vehicles[index]!, occupant }
        return [Effect.void, { ...snapshot, vehicles }]
      }),
      dismount: (id, occupant) => modify((snapshot) => {
        const index = snapshot.vehicles.findIndex((vehicle) => vehicle.id === id)
        if (index < 0) return [Effect.fail(operationError('not-found')), snapshot]
        if (snapshot.vehicles[index]?.occupant !== occupant) return [Effect.fail(operationError('occupant-mismatch')), snapshot]
        const vehicles = snapshot.vehicles.slice()
        const { occupant: _occupant, ...vehicle } = vehicles[index]!
        vehicles[index] = vehicle
        return [Effect.void, { ...snapshot, vehicles }]
      }),
      updateVelocity: (id, velocity) => modify((snapshot) => update(snapshot, id, validVector(velocity), (vehicle) => ({ ...vehicle, velocity }))),
      updateTransform: (id, dimension, position, yawRadians) => modify((snapshot) =>
        update(snapshot, id, validDimension(dimension) && validVector(position) && Number.isFinite(yawRadians), (vehicle) => ({ ...vehicle, dimension, position, yawRadians }))),
      updateState: (id, next) => modify((snapshot) => update(
        snapshot,
        id,
        validDimension(next.dimension)
          && validVector(next.position)
          && validVector(next.velocity)
          && Number.isFinite(next.yawRadians),
        (vehicle) => ({ ...vehicle, ...next }),
      )),
      snapshot: Ref.get(state),
      restore: (candidate) => {
        const result = validateVehicleSnapshot(candidate)
        return result._tag === 'Invalid' ? Effect.fail(result.error) : Ref.set(state, result.snapshot)
      },
    }
  })

export const VehicleServiceLayer = (initial?: VehicleSnapshot): Layer.Layer<VehicleService, VehicleValidationError> =>
  Layer.effect(VehicleService, makeVehicleService(initial))
