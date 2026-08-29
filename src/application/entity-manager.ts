/**
 * EntityManager — the Ref wrapper around `domain/entity.ts`.
 *
 * plan.md §3.8 names `EntityManager` first in this repository's responsibility
 * sentence and docs/public-api.md §5 has listed it as 「まだ設計していない公開API」
 * since the first commit, with 「着手前に本書へ追記すること」 attached. This is that
 * work; §6 of that document is the section it added.
 *
 * The name is plan.md's and both of this repository's docs' (`EntityManager`,
 * not `EntityService`), which is why the Tag key is
 * `'@nerima-games/mc-sim/EntityManager'`. docs/public-api.md §0's rule is about
 * the PREFIX — 「Tag の文字列は `@nerima-games/mc-sim/XxxService` に統一する（参照実装
 * は `@minecraft/application/Xxx`）」 — and four repositories will read the name out
 * of docs/responsibility.md, where it has said `EntityManager` all along.
 *
 * Every mutator is `Ref.modify` or `Ref.update`, never `Ref.get` followed by
 * `Ref.set` (DN-07). The payload here is worse than a lost stack: `sweep` is a
 * read-decide-write over the whole roster and something else always forks —
 * mx-gameplay's interactions stage spawns dropped items, mx-multiplayer applies
 * a remote frame, the autosave daemon takes a snapshot — so a split
 * read/write loses a mob or resurrects one.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TAG IS BUILT BY A FUNCTION AND NOT BY A `Context.Tag` CLASS
 * ---------------------------------------------------------------------------
 *
 * Every other service here is `class X extends Context.Tag('...')<X, XApi>() {}`
 * and this one is not, because its service type carries the behaviour parameter
 * `S` that `domain/entity.ts` exists to stay ignorant of. A class cannot be
 * generic in its own Tag, and the three ways to force one all lose the property
 * the parameter is there for: `EntityManagerApi<unknown>` erases it,
 * `EntityManagerApi<never>` makes the roster unusable, and a per-behaviour Tag
 * key would give a world two rosters.
 *
 * `Context.GenericTag<EntityManager, EntityManagerApi<S>>(KEY)` separates the
 * two halves that a class fuses: the CONTEXT IDENTITY (`EntityManager`, which
 * has no parameter and is what appears in every `R`) and the SERVICE VALUE TYPE
 * (which has one). Effect resolves tags by their textual key, so every call
 * names the same service — that is the same mechanism
 * `@nerima-games/mc-kernel` documents for `ClockPort` across repositories,
 * used deliberately here rather than tripped over.
 *
 * IT IS WORTH BEING PRECISE ABOUT WHAT THAT DOES AND DOES NOT RISK. The
 * `ClockPort` shape is owned directly by `@nerima-games/mc-kernel`; unlike this
 * generic service, it is not re-declared locally. A shape disagreement there
 * would let a narrow Layer satisfy a wide Tag and make a missing field read
 * `undefined`. Here
 * every instantiation has an identical shape — same methods, same arities — and
 * the only thing that varies is the static type of a field mc-sim never reads.
 * A consumer that instantiates the wrong `S` therefore gets a value it
 * mis-describes, which is exactly what a cast through `unknown` would have given
 * it, except that the choice is now written down in one place: the host's
 * `EntityManagerLayer<S>()` call. `test/entity-manager.test.ts` pins the key as
 * a literal and pins that two instantiations resolve to one service.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT IN `simModule` YET
 * ---------------------------------------------------------------------------
 *
 * `stages/registration.ts` puts `InventoryService` in `simModule.layers` even
 * though no stage touches it, and gives the reason: mc-compose's
 * `docs/e2e-triage.md` §4.3 measured what goes wrong without a single place that
 * builds a service two repositories share. Every word of that applies here — the
 * roster has more sharers than the inventory does.
 *
 * It is still not there, because `simModule` is a `const` and `S` is the HOST's
 * choice. Shipping a default would mean shipping `EntityManagerApi<unknown>`
 * with no `BehaviourRepair`, and a host that then merged its own typed layer
 * beside it would have built the two-instances defect §4.3 measured, while
 * believing it had followed the module contract. A default that is wrong for
 * every real host is worse than no default.
 *
 * So the host provides it explicitly, in the SAME `Effect.provide` as
 * `simModule.layers` — see `EntityManagerLayer` for the exact call. Whether
 * `simModule` grows a type parameter is the wiring step's decision, and it is a
 * breaking change to a published surface, so it should be taken when there is a
 * host to measure it against rather than now.
 */
import { Context, Effect, Layer, Ref } from 'effect'
import type {
  BehaviourRepair,
  Entity,
  EntityId,
  EntityKind,
  EntityRoster,
  EntityStep,
  RosterRepair,
  SpawnRequest,
} from '../domain/entity'
import { countOfKind, despawnEntity, emptyRoster, findEntity, normaliseRoster, spawnEntity, sweepRoster } from '../domain/entity'

export type EntityManagerApi<S> = {
  /**
   * Bring an entity into existence and resolve to it, id and all.
   *
   * "May a hostile spawn here" is NOT asked. That is
   * `canHostileSpawnAt(candidate)` in mx-gameplay, whose header already names
   * the population cap and the cadence as things that 「arrive with mc-sim」 —
   * they arrive as `countOfKind` beside this call, not as a rule inside it.
   */
  readonly spawn: (request: SpawnRequest<S>) => Effect.Effect<Entity<S>>
  /** Remove one. Resolves to `false` when nothing had that id — not an error. */
  readonly despawn: (id: EntityId) => Effect.Effect<boolean>
  /**
   * Every entity, for iterating. THE HOT PATH.
   *
   * Resolves to the roster's OWN array — no copy, no `Array.from`, no
   * projection — so reading it costs nothing per entity, and two reads with no
   * write between them resolve to the same array with the same objects in it.
   * That is a contract, not an accident: `gameplay:entities` runs this every
   * frame over every mob, and a defensive copy here would be an O(entities)
   * allocation per reader per frame. `test/entity-manager.test.ts` asserts the
   * reference identity rather than timing anything.
   *
   * The array is `ReadonlyArray` and every entity in it is deeply readonly, so
   * handing out the real one cannot be written through.
   */
  readonly entities: Effect.Effect<ReadonlyArray<Entity<S>>>
  readonly find: (id: EntityId) => Effect.Effect<Entity<S> | undefined>
  readonly count: Effect.Effect<number>
  /** The census a spawn cap needs. See `spawn`. */
  readonly countOfKind: (kind: EntityKind) => Effect.Effect<number>
  /**
   * Advance every entity by one step, atomically, and collect what the rules
   * produced.
   *
   * THIS IS THE METHOD `gameplay:entities` IS WAITING FOR. One `Ref.modify`
   * covers read, decide and write for the whole roster, so a frame cannot
   * interleave with a spawn from another stage and lose either.
   *
   * It is also the only way to change an entity that already exists — there is
   * deliberately no `moveTo`, no `damage` and no `setBehaviour`. A second write
   * path would be a second place for the position/health/behaviour invariants to
   * be enforced, and the blast case wants the sweep anyway: an explosion damages
   * every entity in a radius, which is one pass, not N atomic updates. A single
   * entity is `sweep((e) => (e.id === target ? ... : { transition: UNCHANGED, emit: undefined }))`,
   * and an untouched entity costs nothing (`domain/entity.ts`, `sweepRoster`).
   */
  readonly sweep: <A>(step: (entity: Entity<S>) => EntityStep<S, A>) => Effect.Effect<ReadonlyArray<A>>
  /** The whole roster, for persistence and for mx-multiplayer's snapshots. */
  readonly snapshot: Effect.Effect<EntityRoster<S>>
  /**
   * Install a saved roster. THE WORLD-LOAD PATH.
   *
   * The snapshot goes through `normaliseRoster` before it is installed, for the
   * reason `InventoryService.restore` and `TimeService.restore` both give: a
   * save crosses a version boundary and arrives as JSON that nothing checked.
   * Resolves to what the repair had to change rather than to `void`, which is
   * the same decision `restore` makes about `leftover` — a host that is told
   * nothing cannot tell a clean load from one that renamed half the world.
   *
   * NO ERROR CHANNEL, on purpose. Failing a world load over a repairable field
   * turns a repairable save into an unopenable one. A host that wants to decide
   * for itself calls `normaliseRoster` first: it is public, pure and idempotent.
   */
  readonly restore: (roster: EntityRoster<S>) => Effect.Effect<RosterRepair>
  /**
   * Empty the roster, counter and all. A NEW world, not a reloaded one — a
   * reload is `restore`.
   *
   * Present from day one because this service is reused across world loads
   * (DN-09). The reference bolted the equivalent on afterwards and
   * ts-minecraft/packages/entity/application/player-service.ts:15-18 records the
   * symptom: the second world inherited the first world's entities and
   * `create()` failed with "Player already exists".
   */
  readonly reset: Effect.Effect<void>
}

/**
 * The context identity of the roster service.
 *
 * Never constructed and has no members that mean anything — its whole job is to
 * be the nominal type that appears in an `R`, so that `EntityManager` is one
 * requirement whatever `S` a consumer instantiates. See the module header.
 */
export type EntityManager = {
  readonly _tag: '@nerima-games/mc-sim/EntityManager'
}

/**
 * The Tag's textual key. Effect resolves services by this string, so it is the
 * actual contract with the four repositories that will ask for the roster —
 * changing it typechecks everywhere and fails at composition time; the public
 * source entry point and generated declarations make that contract reviewable.
 */
export const ENTITY_MANAGER_TAG_KEY = '@nerima-games/mc-sim/EntityManager'

/**
 * The Tag, at the behaviour type the caller works in.
 *
 * ```ts
 * const roster = yield* entityManagerTag<CreeperFuse>()
 * ```
 *
 * Every call produces a Tag with the same key and therefore names the same
 * service; only the static view of the behaviour field differs.
 */
export const entityManagerTag = <S>(): Context.Tag<EntityManager, EntityManagerApi<S>> =>
  Context.GenericTag<EntityManager, EntityManagerApi<S>>(ENTITY_MANAGER_TAG_KEY)

/**
 * Build an EntityManager over a fresh Ref.
 *
 * Exported separately from the Layer so that a caller wanting several
 * independent worlds in one process (mc-playground-kit running two previews side
 * by side) can have several rather than fighting an app-scoped singleton
 * (DN-09).
 *
 * `initial` goes through `normaliseRoster` for exactly the reason `restore`
 * does, and the reason is a defect this repository has already shipped twice:
 * `makeInventoryService` closed it for slot counts and `makeTimeService` had to
 * close it afterwards for day lengths (docs/testing.md §3.0.1), because
 * `XxxLayer(loadedState)` is the natural way a host supplies a loaded world at
 * layer-construction time and guarding only `restore` leaves that entrance open.
 * The repair report is dropped here because a world that does not exist yet has
 * nobody to report to; a caller that wants it loads through `restore`.
 */
export const makeEntityManager = <S>(
  initial: EntityRoster<S> = emptyRoster<S>(),
  repairBehaviour?: BehaviourRepair<S>,
): Effect.Effect<EntityManagerApi<S>> =>
  Effect.map(Ref.make(normaliseRoster(initial, repairBehaviour).roster), (state) => ({
    spawn: (request) =>
      Ref.modify(state, (current) => {
        const outcome = spawnEntity(current, request)
        return [outcome.entity, outcome.roster]
      }),
    despawn: (id) =>
      Ref.modify(state, (current) => {
        const outcome = despawnEntity(current, id)
        return [outcome.despawned, outcome.roster]
      }),
    entities: Ref.get(state).pipe(Effect.map((current) => current.entities)),
    find: (id) => Ref.get(state).pipe(Effect.map((current) => findEntity(current, id))),
    count: Ref.get(state).pipe(Effect.map((current) => current.entities.length)),
    countOfKind: (kind) => Ref.get(state).pipe(Effect.map((current) => countOfKind(current, kind))),
    sweep: (step) =>
      Ref.modify(state, (current) => {
        const outcome = sweepRoster(current, step)
        return [outcome.emitted, outcome.roster]
      }),
    snapshot: Ref.get(state),
    restore: (roster) =>
      Ref.modify(state, () => {
        const outcome = normaliseRoster(roster, repairBehaviour)
        return [{ discarded: outcome.discarded, reidentified: outcome.reidentified }, outcome.roster]
      }),
    reset: Ref.set(state, emptyRoster<S>()),
  }))

/**
 * The roster as a Layer, at the host's behaviour type.
 *
 * ```ts
 * const world = Layer.merge(simModule.layers, EntityManagerLayer<CreeperFuse>())
 * ```
 *
 * ONE BUILD PER WORLD. This is `Layer.effect`, so every separate `Effect.provide`
 * of it is a different roster — the hazard mc-compose's `docs/e2e-triage.md` §4.3
 * measured for `InventoryService`, where mx-gameplay wrote to one instance and
 * mx-ui read another. Merge it once, beside `simModule.layers`, and take
 * `simModule.frameStages` from inside that same provide. See the module header
 * for why it is not inside `simModule` itself.
 */
export const EntityManagerLayer = <S>(
  initial: EntityRoster<S> = emptyRoster<S>(),
  repairBehaviour?: BehaviourRepair<S>,
): Layer.Layer<EntityManager> =>
  Layer.effect(entityManagerTag<S>(), makeEntityManager(initial, repairBehaviour))
