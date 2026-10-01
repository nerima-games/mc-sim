import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makePlayerRegistryService } from '../src/application/player-registry-service'
import { decodePlayerId, decodePlayerRegistrySnapshot, PlayerId } from '../src/domain/player-registry'
import { PlayerRegistryServiceLayer } from '../src/application/player-registry-service.js'

const player = (value: string) => PlayerId(value)

describe('PlayerRegistryService', () => {
  it.effect('creates, finds, lists, removes, and resets players', () =>
    Effect.gen(function* () {
      const service = yield* makePlayerRegistryService()
      const alice = player('alice')
      const bob = player('bob')

      expect(yield* service.create(alice)).toEqual({ id: alice })
      expect(yield* service.create(bob)).toEqual({ id: bob })
      expect(yield* service.find(alice)).toEqual({ id: alice })
      expect(yield* service.list).toEqual([alice, bob])
      expect(decodePlayerId('carol')._tag).toBe('Right')
      expect(decodePlayerId(1)._tag).toBe('Left')
      expect(decodePlayerRegistrySnapshot({ players: [] })._tag).toBe('Right')
      expect(decodePlayerRegistrySnapshot({ players: 'invalid' })._tag).toBe('Left')
      expect(() => PlayerId('')).toThrow()
      expect(yield* service.remove(alice)).toBe(true)
      expect(yield* service.remove(alice)).toBe(false)
      yield* service.reset
      expect(yield* service.list).toEqual([])
    }),
  )

  it.effect('rejects duplicate creation atomically', () =>
    Effect.gen(function* () {
      const service = yield* makePlayerRegistryService()
      const id = player('alice')
      yield* service.create(id)

      const error = yield* service.create(id).pipe(Effect.flip)
      expect(error).toEqual({ _tag: 'PlayerAlreadyExists', id })
      expect(yield* service.list).toEqual([id])
    }),
  )

  it.effect('round-trips a snapshot and rejects malformed or duplicate input unchanged', () =>
    Effect.gen(function* () {
      const service = yield* makePlayerRegistryService()
      const alice = player('alice')
      yield* service.create(alice)
      const saved = yield* service.snapshot

      yield* service.reset
      yield* service.restore(JSON.parse(JSON.stringify(saved)))
      expect(yield* service.snapshot).toEqual(saved)

      const error = yield* service.restore({ players: [{ id: 'alice' }, { id: 'alice' }] }).pipe(Effect.flip)
      expect(error).toMatchObject({ _tag: 'PlayerRegistryValidationError' })
      expect(yield* service.snapshot).toEqual(saved)

      const unknownField = yield* service.restore({ players: [{ id: 'alice', extra: true }] }).pipe(Effect.flip)
      expect(unknownField).toMatchObject({ _tag: 'PlayerRegistryValidationError' })
      expect(yield* service.snapshot).toEqual(saved)
    }),
  )

  it.effect('serializes concurrent creates without losing players', () =>
    Effect.gen(function* () {
      const service = yield* makePlayerRegistryService()
      const ids = Array.from({ length: 100 }, (_, index) => player(`player-${index}`))

      const outcomes = yield* Effect.all(ids.map((id) => service.create(id)), { concurrency: 'unbounded' })

      expect(outcomes).toHaveLength(ids.length)
      expect(yield* service.list).toHaveLength(ids.length)
      expect(PlayerRegistryServiceLayer()).toBeDefined()
    }),
  )
})
