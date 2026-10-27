import { Context, Effect, Layer, Ref, Schema } from 'effect'
import { AngleRadians, EntitySerial, isDimension, PositionAxis, position, VehicleVelocityComponent, type AngleRadians as AngleRadiansType, type Dimension, type Position } from '@nerima-games/mc-kernel'
import {
  emptyVehicleSnapshot,
  OccupantId,
  type OccupantId as OccupantIdType,
  type Vehicle,
  VehicleSnapshotSchema,
  VehicleValidationErrorSchema,
  VehicleSchema,
  VehicleId,
  type VehicleSnapshot,
  type VehicleType,
  type VehicleValidationError,
  type VehicleVelocity,
  validateVehicleSnapshot,
} from '../domain/vehicle.js'

export type VehicleOperationError = Readonly<{
  _tag: 'VehicleOperationError'
  reason: 'not-found' | 'duplicate-occupant' | 'occupied' | 'occupant-mismatch' | 'invalid-transform' | 'serial-exhausted'
}>

export const VehicleOperationErrorSchema: Schema.Codec<VehicleOperationError, unknown> =
  Schema.TaggedStruct('VehicleOperationError', {
    reason: Schema.Literals([
      'not-found',
      'duplicate-occupant',
      'occupied',
      'occupant-mismatch',
      'invalid-transform',
      'serial-exhausted',
    ]),
  })

export const VehicleServiceVehiclesSuccessSchema: Schema.Codec<ReadonlyArray<Vehicle>, unknown> =
  Schema.Array(VehicleSchema)
export const VehicleServiceSpawnSuccessSchema: Schema.Codec<Vehicle, unknown> = VehicleSchema
export const VehicleServiceDespawnSuccessSchema: Schema.Codec<boolean, boolean> = Schema.Boolean
export const VehicleServiceVoidSuccessSchema: Schema.Codec<void, undefined> = Schema.Undefined
export const VehicleServiceMountSuccessSchema: Schema.Codec<void, undefined> = VehicleServiceVoidSuccessSchema
export const VehicleServiceDismountSuccessSchema: Schema.Codec<void, undefined> = VehicleServiceVoidSuccessSchema
export const VehicleServiceUpdateVelocitySuccessSchema: Schema.Codec<void, undefined> = VehicleServiceVoidSuccessSchema
export const VehicleServiceUpdateTransformSuccessSchema: Schema.Codec<void, undefined> = VehicleServiceVoidSuccessSchema
export const VehicleServiceUpdateStateSuccessSchema: Schema.Codec<void, undefined> = VehicleServiceVoidSuccessSchema
export const VehicleServiceSnapshotSuccessSchema: Schema.Codec<VehicleSnapshot, unknown> = VehicleSnapshotSchema
export const VehicleServiceRestoreSuccessSchema: Schema.Codec<void, undefined> = Schema.Undefined
export const VehicleServiceOperationErrorSchema: Schema.Codec<VehicleOperationError, unknown> =
  VehicleOperationErrorSchema
export const VehicleServiceValidationErrorSchema: Schema.Codec<VehicleValidationError, unknown> =
  VehicleValidationErrorSchema
export const VehicleServiceNoFailureSchema: Schema.Codec<never, never> = Schema.Never

export type VehicleVelocityInput = VehicleVelocity

export type VehicleStateUpdate = Readonly<Pick<Vehicle, 'dimension' | 'position'> & {
  velocity: VehicleVelocityInput
  yawRadians: AngleRadiansType
  occupant?: OccupantIdType | undefined
}>

const operationError = (reason: VehicleOperationError['reason']): VehicleOperationError => ({
  _tag: 'VehicleOperationError', reason,
})
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const finiteVector = (value: unknown): value is { readonly x: number; readonly y: number; readonly z: number } =>
  isRecord(value)
  && typeof value['x'] === 'number' && Number.isFinite(value['x'])
  && typeof value['y'] === 'number' && Number.isFinite(value['y'])
  && typeof value['z'] === 'number' && Number.isFinite(value['z'])
const vehiclePosition = (value: unknown): Position | undefined => {
  if (!finiteVector(value)) return undefined
  return position(PositionAxis(value.x), PositionAxis(value.y), PositionAxis(value.z))
}
const vehicleVelocityInput = (value: unknown): VehicleVelocityInput | undefined => {
  if (!finiteVector(value)) return undefined
  return {
    x: VehicleVelocityComponent(value.x),
    y: VehicleVelocityComponent(value.y),
    z: VehicleVelocityComponent(value.z),
  }
}
const vehicleStateUpdate = (value: unknown): VehicleStateUpdate | undefined => {
  if (!isRecord(value) || !isDimension(value['dimension'])) return undefined
  const nextPosition = vehiclePosition(value['position'])
  const nextVelocity = vehicleVelocityInput(value['velocity'])
  const yawRadians = value['yawRadians']
  if (nextPosition === undefined || nextVelocity === undefined || typeof yawRadians !== 'number' || !Number.isFinite(yawRadians)) {
    return undefined
  }
  const occupant = value['occupant']
  if (occupant !== undefined && (typeof occupant !== 'string' || occupant.trim().length === 0)) return undefined
  return {
    dimension: value['dimension'],
    position: nextPosition,
    velocity: nextVelocity,
    yawRadians: AngleRadians(yawRadians),
    ...(occupant === undefined ? {} : { occupant: OccupantId(occupant) }),
  }
}
const vehicleVelocity = (value: VehicleVelocityInput): VehicleVelocity => ({
  x: VehicleVelocityComponent(value.x),
  y: VehicleVelocityComponent(value.y),
  z: VehicleVelocityComponent(value.z),
})
const update = (
  snapshot: VehicleSnapshot, id: VehicleId, valid: boolean, transform: (vehicle: Vehicle) => Vehicle,
): readonly [Effect.Effect<void, VehicleOperationError>, VehicleSnapshot] => {
  if (!valid) return [Effect.fail(operationError('invalid-transform')), snapshot]
  const index = snapshot.vehicles.findIndex((vehicle) => vehicle.id === id)
  if (index < 0) return [Effect.fail(operationError('not-found')), snapshot]
  const vehicles = snapshot.vehicles.map((vehicle, vehicleIndex) =>
    vehicleIndex === index ? transform(vehicle) : vehicle,
  )
  return [Effect.void, { ...snapshot, vehicles }]
}

export type VehicleServiceApi = Readonly<{
  vehicles: Effect.Effect<ReadonlyArray<Vehicle>>
  spawn: (type: VehicleType, dimension: Dimension, position: Position, yawRadians?: AngleRadiansType) => Effect.Effect<Vehicle, VehicleOperationError>
  despawn: (id: VehicleId) => Effect.Effect<boolean>
  mount: (id: VehicleId, occupant: OccupantId) => Effect.Effect<void, VehicleOperationError>
  dismount: (id: VehicleId, occupant: OccupantId) => Effect.Effect<void, VehicleOperationError>
  updateVelocity: (id: VehicleId, velocity: VehicleVelocityInput) => Effect.Effect<void, VehicleOperationError>
  updateTransform: (id: VehicleId, dimension: Dimension, position: Position, yawRadians: AngleRadiansType) => Effect.Effect<void, VehicleOperationError>
  updateState: (id: VehicleId, state: VehicleStateUpdate) => Effect.Effect<void, VehicleOperationError>
  snapshot: Effect.Effect<VehicleSnapshot>
  restore: (snapshot: unknown) => Effect.Effect<void, VehicleValidationError>
}>

const VehicleServiceBase: Context.ServiceClass<VehicleService, '@nerima-games/mc-sim/VehicleService', VehicleServiceApi> =
  Context.Service<VehicleService, VehicleServiceApi>()('@nerima-games/mc-sim/VehicleService')

export class VehicleService extends VehicleServiceBase {}

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
      spawn: (type, dimension, position, yawRadians = AngleRadians(0)) => modify((snapshot) => {
        const nextPosition = vehiclePosition(position)
        if ((type !== 'boat' && type !== 'minecart') || !isDimension(dimension) || nextPosition === undefined || !Number.isFinite(yawRadians))
          return [Effect.fail(operationError('invalid-transform')), snapshot]
        if (snapshot.nextSerial === Number.MAX_SAFE_INTEGER)
          return [Effect.fail(operationError('serial-exhausted')), snapshot]
        const vehicle: Vehicle = {
          id: VehicleId(`v:${snapshot.nextSerial}`),
          type,
          dimension,
          position: nextPosition,
          velocity: vehicleVelocity({
            x: VehicleVelocityComponent(0),
            y: VehicleVelocityComponent(0),
            z: VehicleVelocityComponent(0),
          }),
          yawRadians: AngleRadians(yawRadians),
        }
        return [Effect.succeed(vehicle), {
          vehicles: [...snapshot.vehicles, vehicle],
          nextSerial: EntitySerial(snapshot.nextSerial + 1),
        }]
      }),
      despawn: (id) => Ref.modify(state, (snapshot) => {
        const vehicles = snapshot.vehicles.filter((vehicle) => vehicle.id !== id)
        return [vehicles.length !== snapshot.vehicles.length, vehicles.length === snapshot.vehicles.length ? snapshot : { ...snapshot, vehicles }]
      }),
      mount: (id, occupant) => modify((snapshot) => {
        if (typeof occupant !== 'string' || occupant.trim().length === 0)
          return [Effect.fail(operationError('invalid-transform')), snapshot]
        const nextOccupant = OccupantId(occupant)
        const index = snapshot.vehicles.findIndex((vehicle) => vehicle.id === id)
        if (index < 0) return [Effect.fail(operationError('not-found')), snapshot]
        if (snapshot.vehicles.some((vehicle) => vehicle.occupant === nextOccupant)) return [Effect.fail(operationError('duplicate-occupant')), snapshot]
        if (snapshot.vehicles[index]?.occupant !== undefined) return [Effect.fail(operationError('occupied')), snapshot]
        const vehicles = snapshot.vehicles.map((vehicle, vehicleIndex) =>
          vehicleIndex === index ? { ...vehicle, occupant: nextOccupant } : vehicle,
        )
        return [Effect.void, { ...snapshot, vehicles }]
      }),
      dismount: (id, occupant) => modify((snapshot) => {
        if (typeof occupant !== 'string' || occupant.trim().length === 0)
          return [Effect.fail(operationError('invalid-transform')), snapshot]
        const expectedOccupant = OccupantId(occupant)
        const index = snapshot.vehicles.findIndex((vehicle) => vehicle.id === id)
        if (index < 0) return [Effect.fail(operationError('not-found')), snapshot]
        if (snapshot.vehicles[index]?.occupant !== expectedOccupant) return [Effect.fail(operationError('occupant-mismatch')), snapshot]
        const vehicles = snapshot.vehicles.map((vehicle, vehicleIndex) => {
          if (vehicleIndex !== index) return vehicle
          const { occupant: _occupant, ...withoutOccupant } = vehicle
          return withoutOccupant
        })
        return [Effect.void, { ...snapshot, vehicles }]
      }),
      updateVelocity: (id, velocity) => modify((snapshot) => {
        const nextVelocity = vehicleVelocityInput(velocity)
        if (nextVelocity === undefined) return [Effect.fail(operationError('invalid-transform')), snapshot]
        return update(snapshot, id, true, (vehicle) => ({ ...vehicle, velocity: nextVelocity }))
      }),
      updateTransform: (id, dimension, position, yawRadians) => modify((snapshot) => {
        const nextPosition = vehiclePosition(position)
        if (!isDimension(dimension) || nextPosition === undefined || !Number.isFinite(yawRadians))
          return [Effect.fail(operationError('invalid-transform')), snapshot]
        return update(snapshot, id, true, (vehicle) => ({
          ...vehicle,
          dimension,
          position: nextPosition,
          yawRadians: AngleRadians(yawRadians),
        }))
      }),
      updateState: (id, candidate) => modify((snapshot) => {
        const next = vehicleStateUpdate(candidate)
        if (next === undefined) return [Effect.fail(operationError('invalid-transform')), snapshot]
        const index = snapshot.vehicles.findIndex((vehicle) => vehicle.id === id)
        if (index < 0) return [Effect.fail(operationError('not-found')), snapshot]
        if (next.occupant !== undefined && snapshot.vehicles.some((vehicle, vehicleIndex) =>
          vehicleIndex !== index && vehicle.occupant === next.occupant)) {
          return [Effect.fail(operationError('duplicate-occupant')), snapshot]
        }
        return update(snapshot, id, true, (vehicle) => ({ ...vehicle, ...next }))
      }),
      snapshot: Ref.get(state),
      restore: (candidate) => {
        const result = validateVehicleSnapshot(candidate)
        return result._tag === 'Invalid'
          ? Effect.fail(result.error)
          : Effect.map(Ref.set(state, result.snapshot), () => undefined)
      },
    }
  })

export const VehicleServiceLayer = (initial?: unknown): Layer.Layer<VehicleService, VehicleValidationError> =>
  Layer.effect(VehicleService, makeVehicleService(initial))
