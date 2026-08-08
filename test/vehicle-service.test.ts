import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeVehicleService, VehicleService, VehicleServiceLayer } from '../src/application/vehicle-service'
import { position } from '../src/domain/kernel-vocabulary'
import { OccupantId, validateVehicleSnapshot, VehicleId } from '../src/domain/vehicle'

const baseVehicleItem = {
  id: 'v:0',
  type: 'boat' as const,
  dimension: 'overworld' as const,
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  yawRadians: 0,
}

describe('VehicleService lifecycle', () => {
  it('spawns, updates, mounts, dismounts, and despawns vehicles', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const service = yield* makeVehicleService()
      const vehicle = yield* service.spawn('boat', 'overworld', position(1, 64, 2), Math.PI / 2)
      expect(vehicle.id).toBe('v:0')
      yield* service.updateVelocity(vehicle.id, { x: 1, y: 0, z: -1 })
      yield* service.updateTransform(vehicle.id, 'nether', position(3, 70, 4), Math.PI)
      yield* service.updateState(vehicle.id, {
        dimension: 'end',
        position: position(5, 71, 6),
        velocity: { x: 0, y: 0, z: 0.5 },
        yawRadians: 0.25,
      })
      yield* service.mount(vehicle.id, OccupantId('player:1'))
      expect((yield* service.vehicles)[0]).toMatchObject({ dimension: 'end', position: position(5, 71, 6), yawRadians: 0.25, occupant: 'player:1' })
      yield* service.dismount(vehicle.id, OccupantId('player:1'))
      expect((yield* service.vehicles)[0]?.occupant).toBeUndefined()
      expect(yield* service.despawn(vehicle.id)).toBe(true)
      expect(yield* service.despawn(vehicle.id)).toBe(false)
    }))
  })

  it('atomically rejects occupied and duplicate mounts', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const service = yield* makeVehicleService()
      const boat = yield* service.spawn('boat', 'overworld', position(0, 0, 0))
      const cart = yield* service.spawn('minecart', 'overworld', position(1, 0, 0))
      yield* service.mount(boat.id, OccupantId('one'))
      const duplicate = yield* Effect.flip(service.mount(cart.id, OccupantId('one')))
      expect(duplicate.reason).toBe('duplicate-occupant')
      yield* service.mount(cart.id, OccupantId('two'))
      const occupied = yield* Effect.flip(service.mount(cart.id, OccupantId('three')))
      expect(occupied.reason).toBe('occupied')
      const missing = yield* Effect.flip(service.mount(VehicleId('missing'), OccupantId('four')))
      expect(missing.reason).toBe('not-found')
      expect((yield* service.snapshot).vehicles.map((item) => item.occupant)).toStrictEqual(['one', 'two'])
    }))
  })

  it('releases an occupant when its vehicle despawns', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const service = yield* makeVehicleService()
      const first = yield* service.spawn('boat', 'overworld', position(0, 0, 0))
      const second = yield* service.spawn('minecart', 'overworld', position(1, 0, 0))
      yield* service.mount(first.id, OccupantId('player'))
      yield* service.despawn(first.id)
      yield* service.mount(second.id, OccupantId('player'))
      expect((yield* service.snapshot).vehicles[0]?.occupant).toBe('player')
    }))
  })

  it('round-trips a strict snapshot and preserves the id counter', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const first = yield* makeVehicleService()
      const vehicle = yield* first.spawn('minecart', 'end', position(8, 9, 10), 45)
      yield* first.updateVelocity(vehicle.id, { x: 0.5, y: -1, z: 2 })
      yield* first.mount(vehicle.id, OccupantId('rider'))
      const snapshot = yield* first.snapshot
      const second = yield* makeVehicleService()
      yield* second.restore(JSON.parse(JSON.stringify(snapshot)))
      expect(yield* second.snapshot).toStrictEqual(snapshot)
      expect((yield* second.spawn('boat', 'overworld', position(0, 0, 0))).id).toBe('v:1')
    }))
  })

  it('rejects an invalid restore without changing current state', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const service = yield* makeVehicleService()
      yield* service.spawn('boat', 'overworld', position(0, 0, 0))
      const before = yield* service.snapshot
      const error = yield* Effect.flip(service.restore({
        vehicles: [
          { id: 'v:0', type: 'boat', dimension: 'overworld', position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yawRadians: 0, occupant: 'same' },
          { id: 'v:1', type: 'minecart', dimension: 'overworld', position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yawRadians: 0, occupant: 'same' },
        ],
        nextSerial: 2,
      }))
      expect(error.path).toBe('snapshot.vehicles[1].occupant')
      expect(yield* service.snapshot).toBe(before)
    }))
  })

  it('atomically rejects invalid runtime transforms', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const service = yield* makeVehicleService()
      const vehicle = yield* service.spawn('boat', 'overworld', position(0, 0, 0))
      const before = yield* service.snapshot
      const error = yield* Effect.flip(service.updateTransform(
        vehicle.id,
        'invalid' as 'overworld',
        position(1, 2, 3),
        90,
      ))
      expect(error.reason).toBe('invalid-transform')
      expect(yield* service.snapshot).toBe(before)
    }))
  })

  it('strictly rejects invalid initial snapshots and counters that can collide', async () => {
    const candidate = {
      vehicles: [{ id: 'v:4', type: 'boat', dimension: 'overworld', position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yawRadians: 0 }],
      nextSerial: 4,
    }
    const error = await Effect.runPromise(Effect.flip(makeVehicleService(candidate)))
    expect(error.path).toBe('snapshot.nextSerial')
  })

  it('atomically rejects invalid spawn parameters', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const service = yield* makeVehicleService()
      const before = yield* service.snapshot
      const error = yield* Effect.flip(service.spawn('boat', 'invalid' as 'overworld', position(0, 0, 0)))
      expect(error.reason).toBe('invalid-transform')
      expect(yield* service.snapshot).toBe(before)
    }))
  })

  it('rejects updateVelocity, updateTransform, and updateState for a vehicle that does not exist', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const service = yield* makeVehicleService()
      const missing = VehicleId('missing')
      const velocityError = yield* Effect.flip(service.updateVelocity(missing, { x: 0, y: 0, z: 0 }))
      expect(velocityError.reason).toBe('not-found')
      const transformError = yield* Effect.flip(service.updateTransform(missing, 'overworld', position(0, 0, 0), 0))
      expect(transformError.reason).toBe('not-found')
      const stateError = yield* Effect.flip(service.updateState(missing, {
        dimension: 'overworld', position: position(0, 0, 0), velocity: { x: 0, y: 0, z: 0 }, yawRadians: 0,
      }))
      expect(stateError.reason).toBe('not-found')
    }))
  })

  it('rejects dismount for a missing vehicle or a mismatched occupant', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const service = yield* makeVehicleService()
      const vehicle = yield* service.spawn('boat', 'overworld', position(0, 0, 0))
      yield* service.mount(vehicle.id, OccupantId('rider'))
      const missing = yield* Effect.flip(service.dismount(VehicleId('missing'), OccupantId('rider')))
      expect(missing.reason).toBe('not-found')
      const mismatch = yield* Effect.flip(service.dismount(vehicle.id, OccupantId('someone-else')))
      expect(mismatch.reason).toBe('occupant-mismatch')
      expect((yield* service.snapshot).vehicles[0]?.occupant).toBe('rider')
    }))
  })

  it('constructs a working service through VehicleServiceLayer, the Layer entry point', async () => {
    const vehicle = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* VehicleService
        return yield* service.spawn('minecart', 'overworld', position(0, 0, 0))
      }).pipe(Effect.provide(VehicleServiceLayer())),
    )
    expect(vehicle.id).toBe('v:0')
  })
})

describe('validateVehicleSnapshot rejects each malformed field', () => {
  it('rejects a snapshot whose vehicles field is missing or not an array', () => {
    expect(validateVehicleSnapshot({ nextSerial: 0 })).toStrictEqual({
      _tag: 'Invalid',
      error: { _tag: 'VehicleValidationError', path: 'snapshot.vehicles', reason: 'must be an array' },
    })
  })

  it('rejects a nextSerial that is not a non-negative safe integer', () => {
    expect(validateVehicleSnapshot({ vehicles: [], nextSerial: -1 })).toStrictEqual({
      _tag: 'Invalid',
      error: { _tag: 'VehicleValidationError', path: 'snapshot.nextSerial', reason: 'must be a non-negative safe integer' },
    })
  })

  it('rejects a vehicle item that is not an object', () => {
    expect(validateVehicleSnapshot({ vehicles: [42], nextSerial: 1 })).toStrictEqual({
      _tag: 'Invalid',
      error: { _tag: 'VehicleValidationError', path: 'snapshot.vehicles[0]', reason: 'must be an object' },
    })
  })

  it('rejects a vehicle id that is blank', () => {
    expect(validateVehicleSnapshot({ vehicles: [{ ...baseVehicleItem, id: '  ' }], nextSerial: 1 })).toStrictEqual({
      _tag: 'Invalid',
      error: { _tag: 'VehicleValidationError', path: 'snapshot.vehicles[0].id', reason: 'must be non-blank' },
    })
  })

  it('rejects a duplicate vehicle id', () => {
    expect(validateVehicleSnapshot({ vehicles: [baseVehicleItem, baseVehicleItem], nextSerial: 1 })).toStrictEqual({
      _tag: 'Invalid',
      error: { _tag: 'VehicleValidationError', path: 'snapshot.vehicles[1].id', reason: 'must be unique' },
    })
  })

  it('rejects a vehicle type that is neither boat nor minecart', () => {
    expect(validateVehicleSnapshot({ vehicles: [{ ...baseVehicleItem, type: 'car' }], nextSerial: 1 })).toStrictEqual({
      _tag: 'Invalid',
      error: { _tag: 'VehicleValidationError', path: 'snapshot.vehicles[0].type', reason: 'must be boat or minecart' },
    })
  })

  it('rejects an unsupported dimension', () => {
    expect(validateVehicleSnapshot({ vehicles: [{ ...baseVehicleItem, dimension: 'space' }], nextSerial: 1 })).toStrictEqual({
      _tag: 'Invalid',
      error: { _tag: 'VehicleValidationError', path: 'snapshot.vehicles[0].dimension', reason: 'must be a supported dimension' },
    })
  })

  it('rejects a non-finite position', () => {
    expect(validateVehicleSnapshot({
      vehicles: [{ ...baseVehicleItem, position: { x: Number.NaN, y: 0, z: 0 } }],
      nextSerial: 1,
    })).toStrictEqual({
      _tag: 'Invalid',
      error: { _tag: 'VehicleValidationError', path: 'snapshot.vehicles[0].position', reason: 'must contain finite coordinates' },
    })
  })

  it('rejects a non-finite velocity', () => {
    expect(validateVehicleSnapshot({
      vehicles: [{ ...baseVehicleItem, velocity: { x: 0, y: Number.POSITIVE_INFINITY, z: 0 } }],
      nextSerial: 1,
    })).toStrictEqual({
      _tag: 'Invalid',
      error: { _tag: 'VehicleValidationError', path: 'snapshot.vehicles[0].velocity', reason: 'must contain finite coordinates' },
    })
  })

  it('rejects a non-finite yawRadians', () => {
    expect(validateVehicleSnapshot({ vehicles: [{ ...baseVehicleItem, yawRadians: Number.NaN }], nextSerial: 1 })).toStrictEqual({
      _tag: 'Invalid',
      error: { _tag: 'VehicleValidationError', path: 'snapshot.vehicles[0].yawRadians', reason: 'must be finite' },
    })
  })

  it('rejects a blank occupant', () => {
    expect(validateVehicleSnapshot({ vehicles: [{ ...baseVehicleItem, occupant: '  ' }], nextSerial: 1 })).toStrictEqual({
      _tag: 'Invalid',
      error: { _tag: 'VehicleValidationError', path: 'snapshot.vehicles[0].occupant', reason: 'must be non-blank' },
    })
  })

  it('rejects an occupant riding more than one vehicle', () => {
    expect(validateVehicleSnapshot({
      vehicles: [
        { ...baseVehicleItem, occupant: 'p' },
        { ...baseVehicleItem, id: 'v:1', position: { x: 1, y: 0, z: 0 }, occupant: 'p' },
      ],
      nextSerial: 2,
    })).toStrictEqual({
      _tag: 'Invalid',
      error: { _tag: 'VehicleValidationError', path: 'snapshot.vehicles[1].occupant', reason: 'must occupy at most one vehicle' },
    })
  })
})
