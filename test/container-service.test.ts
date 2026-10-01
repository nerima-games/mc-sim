import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { makeContainerService } from '../src/application/container-service.js'
import { ContainerId, ContainerStateSchema, emptyContainerState, isContainerId } from '../src/domain/container-state.js'

describe('ContainerService', () => {
  it.effect('creates, snapshots, and resets a container atomically', () =>
    Effect.gen(function* () {
      const service = yield* makeContainerService()
      const id = ContainerId('chest:0,64,0')

      expect((yield* service.create(id))._tag).toBe('Created')
      expect((yield* service.snapshot(id))?.slots).toHaveLength(27)
      expect(isContainerId(id)).toBe(true)
      expect(() => ContainerId('')).toThrow()
      expect(Schema.is(ContainerStateSchema)(yield* service.snapshot(id))).toBe(false)
      expect(emptyContainerState(id).id).toBe(id)

      yield* service.reset
      expect(yield* service.snapshot(id)).toBeNull()
    }))

  it.effect('rejects an invalid snapshot without changing state', () =>
    Effect.gen(function* () {
      const service = yield* makeContainerService()
      const id = ContainerId('chest:0,64,0')
      yield* service.create(id)
      const before = yield* service.storageSnapshot

      const error = yield* service.restore({}).pipe(Effect.flip)

      expect(error._tag).toBe('ContainerStorageValidationError')
      expect(yield* service.storageSnapshot).toStrictEqual(before)
    }))
})
