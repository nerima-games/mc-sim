/**
 * SaveCoordinator — the debounce/drain queue and the generation-consistent
 * snapshot retry ported from mc-compose's `session-save-coordinator.ts`.
 *
 * Alongside ordinary unit coverage, this suite adds two angles the plain
 * happy-path tests below cannot reach on their own:
 *
 *   1. A DETERMINISM angle. `captureConsistentSnapshot` is retried whenever a
 *      `retainChunk` lands between the two reads it has to agree on. Rather
 *      than racing real fibers against real timing (flaky by construction),
 *      the "torn read" and "re-retain during publish" tests below trigger the
 *      mutation from INSIDE the effect the coordinator itself calls
 *      (`snapshotResidents`/`publish`), which is single-fiber and therefore
 *      exactly reproducible — it proves the retry logic converges to a
 *      consistent snapshot rather than merely usually doing so.
 *   2. A CONCURRENCY angle: many real concurrent `requestSave` fibers,
 *      following this repository's own idiom (`Effect.fork` +
 *      `Effect.forEach(fibers, Fiber.join)`, see `test/inventory.test.ts`),
 *      asserting the batching converges (never more publishes than requests)
 *      and the merged chunk count stays correct under contention.
 */
import { chunkCoord } from '@nerima-games/mc-kernel'
import type { Chunk, Dimension } from '@nerima-games/mc-worldgen'
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Either, Fiber, Ref } from 'effect'
import {
  makeSaveCoordinator,
  SaveSnapshotConsistencyError,
  type DimensionChunk,
  type SaveCoordinatorApi,
  type SaveCoordinatorPublication,
} from '../src/application/save-coordinator'

const fakeChunk = (cx: number, cz: number): Chunk => ({
  coord: chunkCoord(cx, cz),
  blocks: new Uint8Array(1),
  biomes: [],
})

const dimensionChunk = (
  cx: number,
  cz: number,
  dimension: Dimension = 'overworld',
): DimensionChunk => ({ dimension, chunk: fakeChunk(cx, cz) })

const chunkKeys = (chunks: ReadonlyArray<DimensionChunk>): ReadonlyArray<string> =>
  [...chunks.map(({ dimension, chunk }) => `${dimension}:${String(chunk.coord.cx)},${String(chunk.coord.cz)}`)].sort()

describe('SaveCoordinator', () => {
  it.effect('requestSave publishes the merge of known, retained, and resident chunks', () =>
    Effect.gen(function* () {
      const publications = yield* Ref.make<ReadonlyArray<SaveCoordinatorPublication<{ readonly tick: number }>>>([])
      const coordinator = yield* makeSaveCoordinator<{ readonly tick: number }, never>({
        initialKnownChunks: [dimensionChunk(0, 0)],
        snapshotResidents: Effect.succeed([dimensionChunk(1, 0)]),
        currentGeneration: Effect.succeed(7),
        snapshotState: Effect.succeed({ tick: 42 }),
        publish: (publication) => Ref.update(publications, (all) => [...all, publication]),
      })

      yield* coordinator.retainChunk(dimensionChunk(2, 0))
      yield* coordinator.requestSave

      const [publication] = yield* Ref.get(publications)
      expect(publication?.state).toStrictEqual({ tick: 42 })
      expect(chunkKeys(publication?.chunks ?? [])).toStrictEqual(['overworld:0,0', 'overworld:1,0', 'overworld:2,0'])
      expect(yield* coordinator.knownChunkCount).toBe(3)
      expect(yield* coordinator.retainedChunkCount).toBe(0)
    }),
  )

  it.effect('onPublished receives the state generation the published snapshot was captured at', () =>
    Effect.gen(function* () {
      const generations = yield* Ref.make<ReadonlyArray<number>>([])
      const coordinator = yield* makeSaveCoordinator<{ readonly tick: number }, never>({
        initialKnownChunks: [],
        snapshotResidents: Effect.succeed([]),
        currentGeneration: Effect.succeed(99),
        snapshotState: Effect.succeed({ tick: 1 }),
        publish: () => Effect.void,
        onPublished: (generation) => Ref.update(generations, (all) => [...all, generation]),
      })

      yield* coordinator.requestSave

      expect(yield* Ref.get(generations)).toStrictEqual([99])
    }),
  )

  it.effect(
    'DETERMINISM: a retainChunk landing between the two reads is detected and the snapshot is retried, ' +
      'not published torn',
    () =>
      Effect.gen(function* () {
        // Forward reference to the coordinator via `Deferred` rather than a
        // non-null-asserted mutable variable — `snapshotResidents` needs to
        // call `retainChunk` on the coordinator `makeSaveCoordinator` has not
        // returned yet, and this repository's lint forbids `!`.
        const coordinatorDeferred = yield* Deferred.make<SaveCoordinatorApi<never>>()
        const retainViaCoordinator = (chunk: DimensionChunk): Effect.Effect<void> =>
          Effect.flatMap(Deferred.await(coordinatorDeferred), (api) => api.retainChunk(chunk))

        let residentsCalls = 0
        const extraChunk = dimensionChunk(9, 9)
        const snapshotResidents = Effect.suspend((): Effect.Effect<ReadonlyArray<DimensionChunk>> => {
          residentsCalls += 1
          // Simulate the world mutating strictly between the state-generation
          // read and the residents read — the exact window
          // `captureConsistentSnapshot` exists to close. Only on the FIRST
          // attempt, so the second attempt observes a stable version and
          // succeeds.
          return residentsCalls === 1
            ? Effect.zipRight(retainViaCoordinator(extraChunk), Effect.succeed<ReadonlyArray<DimensionChunk>>([]))
            : Effect.succeed<ReadonlyArray<DimensionChunk>>([])
        })
        const publications = yield* Ref.make<ReadonlyArray<SaveCoordinatorPublication<{ readonly tick: number }>>>([])

        const coordinator = yield* makeSaveCoordinator<{ readonly tick: number }, never>({
          initialKnownChunks: [],
          snapshotResidents,
          currentGeneration: Effect.succeed(1),
          snapshotState: Effect.succeed({ tick: 1 }),
          publish: (publication) => Ref.update(publications, (all) => [...all, publication]),
        })
        yield* Deferred.succeed(coordinatorDeferred, coordinator)

        yield* coordinator.requestSave

        // Exactly one retry: the torn attempt plus the stable attempt, never
        // spinning further and never publishing on the torn attempt.
        expect(residentsCalls).toBe(2)
        const [publication] = yield* Ref.get(publications)
        expect(publication).not.toBeUndefined()
        expect(chunkKeys(publication?.chunks ?? [])).toStrictEqual(['overworld:9,9'])
        expect(yield* coordinator.retainedChunkCount).toBe(0)
      }),
  )

  it.effect('gives up with SaveSnapshotConsistencyError after MAX_SNAPSHOT_ATTEMPTS torn reads', () =>
    Effect.gen(function* () {
      const coordinatorDeferred = yield* Deferred.make<SaveCoordinatorApi<never>>()
      const retainViaCoordinator = (chunk: DimensionChunk): Effect.Effect<void> =>
        Effect.flatMap(Deferred.await(coordinatorDeferred), (api) => api.retainChunk(chunk))

      let attempts = 0
      const failures = yield* Ref.make<ReadonlyArray<unknown>>([])
      // Every attempt retains a fresh chunk, so every attempt is torn and the
      // loop can never converge — this is what the retry CEILING is for.
      const snapshotResidents = Effect.suspend((): Effect.Effect<ReadonlyArray<DimensionChunk>> => {
        attempts += 1
        return Effect.zipRight(
          retainViaCoordinator(dimensionChunk(attempts, 0)),
          Effect.succeed<ReadonlyArray<DimensionChunk>>([]),
        )
      })

      const coordinator = yield* makeSaveCoordinator<{ readonly tick: number }, never>({
        initialKnownChunks: [],
        snapshotResidents,
        currentGeneration: Effect.succeed(1),
        snapshotState: Effect.succeed({ tick: 1 }),
        publish: () => Effect.void,
        onFailure: (error) => Ref.update(failures, (all) => [...all, error]),
      })
      yield* Deferred.succeed(coordinatorDeferred, coordinator)

      const result = yield* Effect.either(coordinator.requestSave)

      expect(attempts).toBe(8)
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result) && result.left instanceof SaveSnapshotConsistencyError) {
        expect(result.left._tag).toBe('SaveSnapshotConsistencyError')
        expect(result.left.attempts).toBe(8)
      } else {
        expect.fail('expected a SaveSnapshotConsistencyError')
      }
      expect(yield* Ref.get(failures)).toHaveLength(1)
    }),
  )

  it.effect('a publish failure propagates to the caller and does not mutate coordinator state', () =>
    Effect.gen(function* () {
      const failures = yield* Ref.make<ReadonlyArray<string>>([])
      const coordinator = yield* makeSaveCoordinator<{ readonly tick: number }, string>({
        initialKnownChunks: [dimensionChunk(0, 0)],
        snapshotResidents: Effect.succeed([]),
        currentGeneration: Effect.succeed(1),
        snapshotState: Effect.succeed({ tick: 1 }),
        publish: () => Effect.fail('storage quota exceeded'),
        onFailure: (error) => Ref.update(failures, (all) => [...all, String(error)]),
      })
      yield* coordinator.retainChunk(dimensionChunk(1, 1))

      const result = yield* Effect.either(coordinator.requestSave)

      expect(result).toStrictEqual(Either.left('storage quota exceeded'))
      expect(yield* Ref.get(failures)).toStrictEqual(['storage quota exceeded'])
      expect(yield* coordinator.knownChunkCount).toBe(1)
      expect(yield* coordinator.retainedChunkCount).toBe(1)
    }),
  )

  it.effect('a publish failure with no onFailure configured still fails the caller', () =>
    Effect.gen(function* () {
      const coordinator = yield* makeSaveCoordinator<{ readonly tick: number }, string>({
        initialKnownChunks: [],
        snapshotResidents: Effect.succeed([]),
        currentGeneration: Effect.succeed(1),
        snapshotState: Effect.succeed({ tick: 1 }),
        publish: () => Effect.fail('no listener configured'),
      })

      const result = yield* Effect.either(coordinator.requestSave)

      expect(result).toStrictEqual(Either.left('no listener configured'))
    }),
  )

  it.effect(
    'DETERMINISM: a requestSave that arrives while a save is already draining does not start a second ' +
      'loop, and is picked up by the running one',
    () =>
      Effect.gen(function* () {
        const publishStarted = yield* Deferred.make<void>()
        const releasePublish = yield* Deferred.make<void>()
        let publishCalls = 0
        const coordinator = yield* makeSaveCoordinator<{ readonly tick: number }, never>({
          initialKnownChunks: [],
          snapshotResidents: Effect.succeed([]),
          currentGeneration: Effect.succeed(1),
          snapshotState: Effect.succeed({ tick: 1 }),
          publish: () =>
            Effect.gen(function* () {
              publishCalls += 1
              if (publishCalls === 1) {
                yield* Deferred.succeed(publishStarted, undefined)
                yield* Deferred.await(releasePublish)
              }
            }),
        })

        const first = yield* Effect.fork(coordinator.requestSave)
        // Deterministically wait until the first publish is genuinely in
        // flight (`drain.running` is already `true`) before firing the
        // second — this is what makes the second call's `Ref.modify` land on
        // the `state.running` branch rather than racing for it.
        yield* Deferred.await(publishStarted)
        const second = yield* Effect.fork(coordinator.requestSave)
        yield* Deferred.succeed(releasePublish, undefined)

        yield* Fiber.join(first)
        yield* Fiber.join(second)

        // Two requests, but the second joined the first's loop rather than
        // starting its own: exactly two publishes (one per drainLoop
        // iteration — the first request's, then the second's, which queued
        // while the first was in flight and was picked up next), never more.
        expect(publishCalls).toBe(2)
      }),
  )

  it.effect(
    'DETERMINISM: a chunk re-retained while publish is in flight survives cleanup and is caught by the next save',
    () =>
      Effect.gen(function* () {
        const chunk = dimensionChunk(5, 5)
        let publishCalls = 0
        // `publish` refers to `coordinator` before its own `const` line —
        // fine here, since the closure only runs later (when `requestSave`
        // triggers a publish), by which point the binding is settled.
        const coordinator: SaveCoordinatorApi<never> = yield* makeSaveCoordinator<{ readonly tick: number }, never>({
          initialKnownChunks: [],
          snapshotResidents: Effect.succeed([]),
          currentGeneration: Effect.succeed(1),
          snapshotState: Effect.succeed({ tick: 1 }),
          publish: () => {
            publishCalls += 1
            // The chunk is dirtied again WHILE this publish is writing —
            // after the consistent read, before cleanup. Cleanup must not
            // delete this newer retain.
            return publishCalls === 1 ? coordinator.retainChunk(chunk) : Effect.void
          },
        })

        yield* coordinator.retainChunk(chunk)
        yield* coordinator.requestSave

        expect(yield* coordinator.retainedChunkCount).toBe(1)

        yield* coordinator.requestSave

        expect(yield* coordinator.retainedChunkCount).toBe(0)
        expect(publishCalls).toBe(2)
      }),
  )

  it.effect(
    'CONCURRENCY: many concurrent requestSave calls all resolve, batch into no more publishes than requests, ' +
      'and never corrupt the merged chunk count',
    () =>
      Effect.gen(function* () {
        const publishCount = yield* Ref.make(0)
        const coordinator = yield* makeSaveCoordinator<{ readonly tick: number }, never>({
          initialKnownChunks: [dimensionChunk(0, 0)],
          snapshotResidents: Effect.succeed([dimensionChunk(1, 0)]),
          currentGeneration: Effect.succeed(1),
          snapshotState: Effect.succeed({ tick: 1 }),
          publish: () => Ref.update(publishCount, (count) => count + 1),
        })

        const fibers = yield* Effect.forEach(
          Array.from({ length: 20 }, (_, index) => index),
          () => Effect.fork(coordinator.requestSave),
          { concurrency: 'unbounded' },
        )
        const results = yield* Effect.forEach(fibers, Fiber.join)

        expect(results).toHaveLength(20)
        const publishes = yield* Ref.get(publishCount)
        expect(publishes).toBeGreaterThan(0)
        expect(publishes).toBeLessThanOrEqual(20)
        expect(yield* coordinator.knownChunkCount).toBe(2)
      }),
  )

  it.effect('retainChunk is idempotent per coordinate: re-retaining the same chunk keeps one entry', () =>
    Effect.gen(function* () {
      const coordinator = yield* makeSaveCoordinator<{ readonly tick: number }, never>({
        initialKnownChunks: [],
        snapshotResidents: Effect.succeed([]),
        currentGeneration: Effect.succeed(1),
        snapshotState: Effect.succeed({ tick: 1 }),
        publish: () => Effect.void,
      })

      yield* coordinator.retainChunk(dimensionChunk(3, 3))
      yield* coordinator.retainChunk(dimensionChunk(3, 3))
      yield* coordinator.retainChunk(dimensionChunk(4, 4))

      expect(yield* coordinator.retainedChunkCount).toBe(2)
    }),
  )

  it.effect('a coordinator built with no known chunks and no residents publishes an empty chunk list', () =>
    Effect.gen(function* () {
      const publications = yield* Ref.make<ReadonlyArray<SaveCoordinatorPublication<{ readonly tick: number }>>>([])
      const coordinator = yield* makeSaveCoordinator<{ readonly tick: number }, never>({
        initialKnownChunks: [],
        snapshotResidents: Effect.succeed([]),
        currentGeneration: Effect.succeed(1),
        snapshotState: Effect.succeed({ tick: 5 }),
        publish: (publication) => Ref.update(publications, (all) => [...all, publication]),
      })

      expect(yield* coordinator.knownChunkCount).toBe(0)
      yield* coordinator.requestSave

      const [publication] = yield* Ref.get(publications)
      expect(publication?.chunks).toStrictEqual([])
      expect(publication?.state).toStrictEqual({ tick: 5 })
    }),
  )
})
