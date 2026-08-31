/**
 * SaveCoordinator — schedules and debounces session saves, and hands the host
 * a generation-consistent snapshot of world state plus the chunks that need
 * to travel with it.
 *
 * Ported from mc-compose's `apps/web/session-save-coordinator.ts`. That file
 * held no save-FORMAT content — no envelope, no
 * `SaveKey`, no `Schema` — only a debounce/drain queue and a
 * generation-consistent snapshot retry, and its one non-local import,
 * `chunkSnapshotOf`, is `@nerima-games/mc-worldgen`, a dependency mc-sim
 * already has (Tier2: worldgen → sim). Autosave POLICY belongs to the
 * consumer (mc-compose decides WHEN to call `requestSave`); this module
 * owns only the mechanics of not corrupting or duplicating a save under
 * concurrent requests.
 *
 * Behaviour is preserved exactly: at most one publish in flight, later
 * `requestSave` calls join the NEXT batch rather than the running one, and a
 * snapshot that observed `retainChunk`/generation activity mid-capture is
 * retried rather than published inconsistent. The surface moved from
 * `Promise` to `Effect` — every other service in this application layer is
 * Effect-based and none of them uses `Promise` (see `application/autosave.ts`
 * for the sibling scheduling module this pairs with).
 */
import { chunkSnapshotOf, type Chunk, type Dimension } from '@nerima-games/mc-worldgen'
import { Data, Deferred, Effect, Ref } from 'effect'
import type { YieldableError } from 'effect/Cause'

/** One chunk plus the dimension it belongs to — the unit `retainChunk` and the save manifest exchange. */
export type DimensionChunk = {
  readonly dimension: Dimension
  readonly chunk: Chunk
}

export type SaveCoordinatorPublication<State> = {
  readonly state: State
  readonly chunks: ReadonlyArray<DimensionChunk>
}

/**
 * `captureConsistentSnapshot` gave up after `attempts` tries without observing
 * a stable state generation and retained-chunk version across the read. A
 * host that hits this under normal play has a `snapshotState` or
 * `snapshotResidents` implementation that is too slow relative to how often
 * the world mutates — the fix is there, not a higher `MAX_SNAPSHOT_ATTEMPTS`.
 */
// Named separately rather than extended inline: `isolatedDeclarations`
// rejects a class whose extends clause is itself an expression (TS9021), and
// the named const then needs its own explicit type (TS9010). Matches
// `InventoryServiceBase` in `application/inventory-service.ts`.
const SaveSnapshotConsistencyErrorBase: new (args: {
  readonly attempts: number
}) => YieldableError & { readonly _tag: 'SaveSnapshotConsistencyError' } & Readonly<{ readonly attempts: number }> =
  Data.TaggedError('SaveSnapshotConsistencyError')<{
    readonly attempts: number
  }>

export class SaveSnapshotConsistencyError extends SaveSnapshotConsistencyErrorBase {}

export type SaveCoordinatorOptions<State, E> = {
  readonly initialKnownChunks: Iterable<DimensionChunk>
  /** Chunks the host currently has resident (loaded), read fresh on every snapshot attempt. */
  readonly snapshotResidents: Effect.Effect<ReadonlyArray<DimensionChunk>>
  /** A monotonic counter the host bumps on every world mutation; used only to detect a torn read. */
  readonly currentGeneration: Effect.Effect<number>
  readonly snapshotState: Effect.Effect<State>
  readonly publish: (publication: SaveCoordinatorPublication<State>) => Effect.Effect<void, E>
  readonly onPublished?: (generation: number) => Effect.Effect<void>
  readonly onFailure?: (error: E | SaveSnapshotConsistencyError) => Effect.Effect<void>
}

export type SaveCoordinatorApi<E> = {
  /** Mark a chunk as needing to ride along with the next save even if the host has since unloaded it. */
  readonly retainChunk: (chunk: DimensionChunk) => Effect.Effect<void>
  /** Request a save. Resolves once a publish this request was part of has completed. */
  readonly requestSave: Effect.Effect<void, E | SaveSnapshotConsistencyError>
  readonly knownChunkCount: Effect.Effect<number>
  readonly retainedChunkCount: Effect.Effect<number>
}

const MAX_SNAPSHOT_ATTEMPTS = 8

const coordId = ({ dimension, chunk }: DimensionChunk): string =>
  `${dimension}:${String(chunk.coord.cx)},${String(chunk.coord.cz)}`

const dimensionChunkSnapshotOf = ({ dimension, chunk }: DimensionChunk): DimensionChunk => ({
  dimension,
  chunk: chunkSnapshotOf(chunk),
})

type RetainedEntry = { readonly chunk: DimensionChunk; readonly version: number }

type CoordinatorState = {
  readonly knownChunks: ReadonlyMap<string, DimensionChunk>
  readonly retainedChunks: ReadonlyMap<string, RetainedEntry>
  readonly retainedVersion: number
}

type DrainState<E> = {
  readonly running: boolean
  readonly waiters: ReadonlyArray<Deferred.Deferred<void, E | SaveSnapshotConsistencyError>>
}

/**
 * Build a coordinator over fresh, private state.
 *
 * One instance per world session (same lifetime as `InventoryService` et al.
 * — see `docs/design-notes.md` DN-09 on why services are constructed per
 * world rather than shared globals).
 */
export const makeSaveCoordinator = <State, E>(
  options: SaveCoordinatorOptions<State, E>,
): Effect.Effect<SaveCoordinatorApi<E>> =>
  Effect.gen(function* () {
    const coordinator = yield* Ref.make<CoordinatorState>({
      knownChunks: new Map(
        [...options.initialKnownChunks].map((chunk) => [coordId(chunk), dimensionChunkSnapshotOf(chunk)]),
      ),
      retainedChunks: new Map(),
      retainedVersion: 0,
    })
    const drain = yield* Ref.make<DrainState<E>>({ running: false, waiters: [] })

    const retainChunk = (chunk: DimensionChunk): Effect.Effect<void> =>
      Ref.update(coordinator, (current) => {
        const nextVersion = current.retainedVersion + 1
        const retainedChunks = new Map(current.retainedChunks)
        retainedChunks.set(coordId(chunk), { chunk: dimensionChunkSnapshotOf(chunk), version: nextVersion })
        return { ...current, retainedChunks, retainedVersion: nextVersion }
      })

    /**
     * Read state + residents such that neither `retainChunk` nor a world
     * generation bump landed between the two reads. Retried up to
     * `MAX_SNAPSHOT_ATTEMPTS` times rather than locked, because the coordinator
     * has no way to pause the frame loop or a concurrent `retainChunk` caller —
     * see the module header on why a host hitting the failure case has a
     * latency problem in its `snapshotState`/`snapshotResidents`, not a
     * concurrency bug here.
     */
    const captureConsistentSnapshot: Effect.Effect<
      {
        readonly retainedCapture: ReadonlyArray<readonly [string, RetainedEntry]>
        readonly state: State
        readonly stateGeneration: number
        readonly residents: ReadonlyArray<DimensionChunk>
      },
      SaveSnapshotConsistencyError
    > = Effect.gen(function* () {
      for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
        const stateGeneration = yield* options.currentGeneration
        const before = yield* Ref.get(coordinator)
        const state = yield* options.snapshotState
        const residents = yield* options.snapshotResidents
        const generationAfter = yield* options.currentGeneration
        const after = yield* Ref.get(coordinator)
        if (generationAfter === stateGeneration && after.retainedVersion === before.retainedVersion) {
          return { retainedCapture: [...before.retainedChunks], state, stateGeneration, residents }
        }
      }
      return yield* Effect.fail(new SaveSnapshotConsistencyError({ attempts: MAX_SNAPSHOT_ATTEMPTS }))
    })

    const publishOnce: Effect.Effect<void, E | SaveSnapshotConsistencyError> = Effect.gen(function* () {
      const { retainedCapture, state, stateGeneration, residents } = yield* captureConsistentSnapshot

      const merged = new Map<string, DimensionChunk>()
      const before = yield* Ref.get(coordinator)
      for (const [key, chunk] of before.knownChunks) merged.set(key, dimensionChunkSnapshotOf(chunk))
      for (const [key, retained] of retainedCapture) merged.set(key, dimensionChunkSnapshotOf(retained.chunk))
      for (const chunk of residents) merged.set(coordId(chunk), dimensionChunkSnapshotOf(chunk))

      yield* options.publish({ state, chunks: [...merged.values()] })

      yield* Ref.update(coordinator, (current) => {
        const retainedChunks = new Map(current.retainedChunks)
        for (const [key, captured] of retainedCapture) {
          if (retainedChunks.get(key)?.version === captured.version) retainedChunks.delete(key)
        }
        return {
          ...current,
          knownChunks: new Map(
            [...merged.entries()].map(([key, chunk]) => [key, dimensionChunkSnapshotOf(chunk)]),
          ),
          retainedChunks,
        }
      })
      if (options.onPublished !== undefined) yield* options.onPublished(stateGeneration)
    })

    /**
     * One iteration takes whatever is currently queued, publishes it once, and
     * settles that batch. A `requestSave` that arrives while `publishOnce` is
     * running is NOT part of the batch being published — it queues into
     * `drain.waiters` and is picked up by the next iteration, which is what
     * makes overlapping requests converge to one write per iteration rather
     * than each waiting on its own independent publish.
     *
     * Grabbing the next batch and, when there is none, flipping `running`
     * back to `false` are the SAME `Ref.modify` call rather than two — a
     * `requestSave` that arrives cannot land in the gap between "no more work"
     * and "stop running" because there is no gap: either it lands before this
     * modify (and is part of the batch just grabbed, so the loop is not
     * stopping) or after it (and `running` is already `false`, so its own
     * modify in `requestSave` below sees that and restarts the loop itself).
     * Splitting these into two calls, as mc-compose's original Promise-based
     * version effectively did with `saveRunning`/`savePending` as separate
     * fields, opens exactly that gap.
     */
    const drainLoop: Effect.Effect<void> = Effect.gen(function* () {
      const batch = yield* Ref.modify(drain, (state) =>
        state.waiters.length === 0
          ? ([state.waiters, { ...state, running: false }] as const)
          : ([state.waiters, { ...state, waiters: [] }] as const))
      if (batch.length === 0) return
      const outcome = yield* Effect.either(publishOnce)
      if (outcome._tag === 'Right') {
        yield* Effect.forEach(batch, (waiter) => Deferred.succeed(waiter, undefined), { discard: true })
      } else {
        if (options.onFailure !== undefined) yield* options.onFailure(outcome.left)
        yield* Effect.forEach(batch, (waiter) => Deferred.fail(waiter, outcome.left), { discard: true })
      }
      yield* drainLoop
    })

    const requestSave: Effect.Effect<void, E | SaveSnapshotConsistencyError> = Effect.gen(function* () {
      const waiter = yield* Deferred.make<void, E | SaveSnapshotConsistencyError>()
      // Enqueue and decide whether to (re)start the loop in one atomic step —
      // the reentrancy guard `drainLoop`'s own recursion otherwise needs.
      const shouldStart = yield* Ref.modify(drain, (state) => {
        const waiters = [...state.waiters, waiter]
        return state.running
          ? ([false, { ...state, waiters }] as const)
          : ([true, { ...state, waiters, running: true }] as const)
      })
      if (shouldStart) yield* Effect.forkDaemon(drainLoop)
      return yield* Deferred.await(waiter)
    })

    return {
      retainChunk,
      requestSave,
      knownChunkCount: Ref.get(coordinator).pipe(Effect.map((state) => state.knownChunks.size)),
      retainedChunkCount: Ref.get(coordinator).pipe(Effect.map((state) => state.retainedChunks.size)),
    }
  })
