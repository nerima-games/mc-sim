import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeVehicleService } from '../src/application/vehicle-service'
import { position } from '../src/domain/kernel-vocabulary'
import { OccupantId, VehicleId } from '../src/domain/vehicle'

describe('VehicleService lifecycle', () => {
  it('spawns, updates, mounts, dismounts, and despawns vehicles', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const service = yield* makeVehicleService()
      const vehicle = yield* service.spawn('boat', 'overworld', position(1, 64, 2), 90)
      expect(vehicle.id).toBe('v:0')
      yield* service.updateVelocity(vehicle.id, { x: 1, y: 0, z: -1 })
      yield* service.updateTransform(vehicle.id, 'nether', position(3, 70, 4), 180)
      yield* service.mount(vehicle.id, OccupantId('player:1'))
      expect((yield* service.vehicles)[0]).toMatchObject({ dimension: 'nether', yaw: 180, occupant: 'player:1' })
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
          { id: 'v:0', type: 'boat', dimension: 'overworld', position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, occupant: 'same' },
          { id: 'v:1', type: 'minecart', dimension: 'overworld', position: { x: 1, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0, occupant: 'same' },
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
      vehicles: [{ id: 'v:4', type: 'boat', dimension: 'overworld', position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, yaw: 0 }],
      nextSerial: 4,
    }
    const error = await Effect.runPromise(Effect.flip(makeVehicleService(candidate)))
    expect(error.path).toBe('snapshot.nextSerial')
  })
})
