/**
 * The entity roster as a value — plan.md §3.8's `EntityManager`, minus the Ref.
 *
 * plan.md §2.3-1: the foundation tier owns NOUNS, the experience tier owns
 * VERBS. §7 splits the mob row down the middle — 「状態管理は sim、AI/スポーン/
 * ドロップのルールは gameplay」 — and docs/responsibility.md §3.1 states the half
 * that is here in one sentence: 「Mob という存在がいて座標と体力を持つ」は mc-sim.
 *
 * This module exists because mx-gameplay went looking for it and wrote down what
 * it found. Its `domain/mob/` holds four finished creeper rules — the fuse, the
 * blast, the spawn condition and the drop — and `stages/registration.ts:230-246`
 * calls NONE of them, deliberately:
 *
 *     THE CREEPER IS NOT RUN HERE, AND THE REASON IS THE POINT. [...] Running
 *     them would need something to iterate over: a roster of mobs with positions
 *     and health, and a way to ask how far each one is from the player. That is
 *     state, it has to survive a save/load round trip, and by the test in this
 *     file's header it therefore belongs to mc-sim.
 *
 *     A local `Ref<Map<MobId, CreeperFuse>>` here would run today and would be
 *     the same mistake as the `timeOfDaySecs` Ref this file used to hold: a
 *     second owner of a noun, diverging from the one that gets saved.
 *
 * So this file answers exactly that: a roster, an id, a position, a health
 * number, and a place to keep whatever the rules tier needs handed back.
 *
 * ---------------------------------------------------------------------------
 * THE ONE HARD PROBLEM: carrying a `CreeperFuse` without knowing what one is
 * ---------------------------------------------------------------------------
 *
 * mx-gameplay's `CreeperFuse` is explicitly designed as a value the HOST stores
 * and hands back (`mx-gameplay/domain/mob/creeper-fuse.ts`: "No `Ref`, no map
 * from entity to fuse, no way to enumerate creepers [...] the CREEPER is saved
 * state (mc-sim's), and `fuseSecs` is a field of it"). mc-sim must therefore
 * hold a value it cannot name. It cannot import mx-gameplay — that edge runs the
 * other way and `pnpm check:deps` rejects a cycle — and it must not be told what
 * a fuse means, because "if the mob is a creeper" in this repository is the
 * boundary failure DN-11 is about, arriving through the entity table instead of
 * through a block id.
 *
 * The two obvious spellings are both wrong in the same direction:
 *
 *   - `behaviour: Record<string, unknown>` (or `unknown`, or a JSON alias)
 *     ERASES THE TYPE. Every read in mx-gameplay becomes a cast, and a cast at a
 *     repository boundary is precisely what `ItemId = string` was: "a type that
 *     could not be wrong and therefore could not be right either"
 *     (`application/inventory-service.ts`).
 *
 *   - A closed union of behaviours declared HERE would make mc-sim the second
 *     owner of the mob roster's shape, and every new mob in mx-gameplay would be
 *     a change in mc-sim's published surface — the top project risk (plan.md §8)
 *     driven by a repository that is not allowed to have an opinion about mobs.
 *
 * The shape that is neither is a TYPE PARAMETER. `Entity<S>` carries an `S`,
 * every function here is parametric in it, and NOTHING in this module reads
 * inside one — the only operations performed on a behaviour are "store it",
 * "hand it back", and "pass it to the host's own repair function on the load
 * path". A host instantiates `S` once, at the point where it is the only party
 * that can see both repositories, and mx-gameplay reads a `CreeperFuse` back out
 * with no cast and no adapter. `test/entity.test.ts` pins the ignorance directly:
 * a sentinel object with no fields mc-sim could interpret survives a spawn, a
 * sweep, a snapshot and a restore BY REFERENCE IDENTITY.
 *
 * ---------------------------------------------------------------------------
 * Ids: branded strings, minted from a SAVED counter
 * ---------------------------------------------------------------------------
 *
 * `EntityId` is `string & Brand.Brand<'EntityId'>` built with `Brand.refined`,
 * the same shape and the same non-blank refinement as `mc-kernel`'s `WorldId`
 * and `StageId` (`mc-kernel/domain/identifiers.ts`). It is NOT mirrored from
 * kernel, and that is a decision: `@nerima-games/mc-kernel`'s header names a
 * mirror WIDER than its source as the dangerous direction — it typechecks
 * locally and breaks on the day the mirror is deleted — and kernel's
 * `identifiers.ts` has no entity id in it. The roster is mc-sim's, so the key
 * into it is mc-sim's until kernel has a reason of its own to publish one.
 *
 * The counter (`EntityRoster.nextSerial`) IS PART OF THE SAVED STATE, and that
 * is the whole reason an id survives a save. A roster that minted from a counter
 * starting at zero on every load would re-issue `e:1` to a fresh mob while the
 * loaded save already held one — two entities with one id, `findEntity` able to
 * see only the first, and the second impossible to despawn. That is the shape of
 * the reference's most expensive singleton bug ("Player already exists",
 * ts-minecraft/packages/entity/application/player-service.ts:15-18) with the
 * collision moved from a name to a number.
 *
 * Minted, not random. There is no `Math.random()` here for the same reason there
 * is no `Date.now()` (DN-12): plan.md §5.1-3 makes determinism the precondition
 * for using the reference's tests as an oracle, and a roster whose ids differ
 * between two runs of the same scenario cannot be diffed. A counter is
 * reproducible; a UUID is not.
 *
 * ---------------------------------------------------------------------------
 * PURE, TOTAL, AND CLOCKLESS
 * ---------------------------------------------------------------------------
 *
 * Like `domain/inventory.ts`, every transition here returns the resulting roster
 * plus whatever the caller has to know about it, and nothing reads a clock, a
 * random source or a Ref. `application/entity-manager.ts` is the thin wrapper.
 *
 * Total INCLUDING on a roster this module did not build, which is not a
 * theoretical concern: a roster arrives from a save file as JSON, and JSON is
 * checked by nothing. See `normaliseRoster`.
 */
import { Brand } from 'effect'
import type { Position } from "@nerima-games/mc-kernel"
import { position } from "@nerima-games/mc-kernel"

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Identifies one entity within one world, across a save/load round trip.
 *
 * A non-blank string, branded, exactly as `mc-kernel`'s `WorldId` and `StageId`
 * are. Three properties, each of which was the reason to pick this over the
 * alternatives:
 *
 *   - IT IS A STRING, so it round-trips through JSON without the "is 2^53 still
 *     an integer" question a numeric id raises at the persistence boundary, and
 *     it reads in a log as what it is.
 *   - IT IS BRANDED, so `despawn(playerName)` does not typecheck. An id is the
 *     one field a caller can plausibly have several unrelated strings for.
 *   - THE BRAND IS `refined`, NOT `nominal`, so a blank id fails where a human
 *     wrote it (DN-06: literals fail at the place that names them). Values from
 *     outside the type system go through `isEntityId` instead — see
 *     `normaliseRoster`, which must not throw.
 */
export type EntityId = string & Brand.Brand<'EntityId'>

export const EntityId = Brand.refined<EntityId>(
  (value) => typeof value === 'string' && value.trim().length > 0,
  (value) => Brand.error(`EntityId must be a non-blank string, received ${JSON.stringify(value)}`),
)

/**
 * What KIND of entity this is — `'creeper'`, `'zombie'`, `'dropped_item'`.
 *
 * DELIBERATELY OPEN, and this is the interesting decision in the file. The
 * obvious alternative is a closed literal union like `ItemType`, which would
 * give a misspelled kind a compile error. It is refused for the reason
 * `@nerima-games/mc-kernel` refuses to grow `ITEM_TYPES` locally: the roster
 * of things that exist is a VOCABULARY, vocabularies are kernel's, and inventing
 * one here from the single mob mx-gameplay happens to have finished would be the
 * 「推測されたロスタ」 this project has now declined twice — with the added defect
 * that plan.md §3.11 gives mob identity to the rules tier, so mc-sim would be
 * guessing on behalf of a repository it cannot see.
 *
 * The cost is real and is paid on purpose: a typo in a kind is a mob no rule
 * ever matches, and mc-sim cannot catch it. The cost is bounded because mc-sim
 * NEVER BRANCHES ON A KIND — `countOfKind` compares two strings the caller
 * supplied and that is the whole of this repository's interest in the value
 * (DN-11: 「判定コードはアイテムIDを名指しで分岐しない」, and an entity kind is the
 * same kind of name). When kernel publishes an `EntityType`, this becomes a
 * repoint of one alias, and it will be a breaking change recorded as one.
 */
export type EntityKind = string & Brand.Brand<'EntityKind'>

export const EntityKind = Brand.refined<EntityKind>(
  (value) => typeof value === 'string' && value.trim().length > 0,
  (value) => Brand.error(`EntityKind must be a non-blank string, received ${JSON.stringify(value)}`),
)

/**
 * Narrowing guards for values arriving from OUTSIDE the type system.
 *
 * The same role `isItemType` plays in `@nerima-games/mc-kernel`, and mc-sim
 * has the same single boundary: a saved roster is strings in a file, parsed by
 * mc-save and handed straight back. `EntityId` and `EntityKind` above THROW on a
 * blank value, which is right where a human wrote the literal and fatal on the
 * world-load path — a throw from a pure function becomes a `Cause.Die` that
 * `application/game-loop.ts` logs and swallows (DN-08 / SIM-3).
 */
export const isEntityId = (value: unknown): value is EntityId =>
  typeof value === 'string' && value.trim().length > 0

export const isEntityKind = (value: unknown): value is EntityKind =>
  typeof value === 'string' && value.trim().length > 0

/**
 * The prefix every id this repository mints carries.
 *
 * An id from a save need NOT have it — a foreign or older build may have spelled
 * ids any way it liked, and `normaliseRoster` keeps such an id rather than
 * renaming a mob that is working perfectly well. The prefix exists so that
 * `serialOfEntityId` can recognise the ids this module is responsible for not
 * colliding with, and so that an id is never mistaken for a bare number.
 */
export const ENTITY_ID_PREFIX = 'e:'

/** Mint the id for a serial. The only place an `EntityId` is constructed. */
export const mintEntityId = (serial: number): EntityId => EntityId(`${ENTITY_ID_PREFIX}${serial}`)

/**
 * The serial inside a minted id, or `undefined` for an id this module did not
 * mint.
 *
 * Total over any string. `Number('')` is `0` and `Number(' 1')` is `1`, so the
 * digits are tested before the conversion rather than after it — the same
 * discipline `normaliseTimeState` states for `null / 60`: decide on the value
 * before arithmetic can coerce it into looking deliberate.
 */
export const serialOfEntityId = (id: string): number | undefined => {
  if (!id.startsWith(ENTITY_ID_PREFIX)) {
    return undefined
  }
  const digits = id.slice(ENTITY_ID_PREFIX.length)
  if (digits.length === 0 || !/^\d+$/.test(digits)) {
    return undefined
  }
  const serial = Number(digits)
  return Number.isSafeInteger(serial) ? serial : undefined
}

// ---------------------------------------------------------------------------
// The entity
// ---------------------------------------------------------------------------

/**
 * Everything about an entity that can CHANGE while it exists.
 *
 * Split out from `Entity` so that `EntityTransition` can carry a whole one. That
 * is not tidiness: a partial-update record (`{ position?, health?, behaviour? }`)
 * is the exact mechanism of the bug mx-gameplay's `domain/death-cause.ts` header
 * dissects — 「an OPTIONAL argument disappearing across a call boundary」 — and a
 * rule that meant to write a fuse and silently wrote nothing is a creeper that
 * hisses forever. Here a rule states all three or states `Unchanged`.
 */
export type EntityState<S> = {
  /**
   * Where it is, FEET ORIGIN.
   *
   * The name carries the convention, exactly as `PlayerPose.feetPosition` does,
   * and for the reason DN-10 gives: every 「物が浮く」 bug in the reference was a
   * feet-origin/AABB-centre mismatch, and the defence available today is a field
   * name a caller can read the mistake in.
   */
  readonly feetPosition: Position
  /**
   * How much health it has left.
   *
   * The NUMBER is mc-sim's; 「剣が何ダメージか」「落下で何ダメージか」 is mx-gameplay's
   * (docs/responsibility.md §3.1). There is no maximum here: a mob's full health
   * is a property of its kind, kinds are the rules tier's, and mirroring a table
   * of them would put mc-sim back in the business of knowing what a creeper is.
   *
   * Repaired to a magnitude at every entry point — see `repairState`. An
   * mx-gameplay preview measured what an unrepaired one costs: finding F5 is a
   * bare `NaN` reaching `applyDamage`, after which the entity is PERMANENTLY
   * IMMORTAL, because every later comparison against `NaN` is false.
   */
  readonly healthPoints: number
  /**
   * Whatever the rules tier stores per entity, handed back untouched.
   *
   * For a creeper this is mx-gameplay's `CreeperFuse`. mc-sim does not know
   * that, must not learn it, and never reads inside this field. See the module
   * header for why it is a type parameter rather than an erased bag.
   */
  readonly behaviour: S
}

/** An entity: an identity, a kind, and the state that changes. */
export type Entity<S> = EntityState<S> & {
  readonly id: EntityId
  readonly kind: EntityKind
}

/**
 * The whole roster, as one value. This is what a save file holds.
 *
 * `entities` is an ARRAY, not a `Map`, and the choice is about the hot path:
 * `gameplay:entities` runs over every mob every frame, an array is what a
 * `for...of` walks without materialising anything, and
 * `application/entity-manager.ts` hands this exact reference out rather than a
 * copy or a `Array.from(map.values())`. See `sweepRoster`.
 *
 * `nextSerial` is saved because an id must not be re-issued across a load; see
 * the module header.
 */
export type EntityRoster<S> = {
  readonly entities: ReadonlyArray<Entity<S>>
  readonly nextSerial: number
}

/**
 * Shared empty array, so that an empty roster, a reset roster and a sweep that
 * removed everything are all the SAME array — which is what makes "iterating
 * allocated nothing" assertable by reference identity rather than by timing.
 */
const NO_ENTITIES: ReadonlyArray<never> = []

export const emptyRoster = <S>(): EntityRoster<S> => ({ entities: NO_ENTITIES, nextSerial: 0 })

/**
 * A coordinate with no magnitude becomes 0.
 *
 * The precedent is `clampFraction` in `domain/time-of-day.ts`: 「A value with no
 * magnitude becomes 0 — midnight — [...] It is a real instant, which is the
 * property that matters」. The same argument applies to a place. The alternative
 * — dropping an entity whose position is `NaN` — was considered and refused:
 * `NaN` fails every distance test, so such a mob is invisible to the ignition
 * range, invisible to the despawn radius, and therefore immortal and unreachable
 * forever. A mob standing at the origin is wrong in a way somebody can SEE.
 */
const magnitude = (value: number): number => (Number.isFinite(value) ? value : 0)

const repairPosition = (value: Position): Position =>
  typeof value === 'object' && value !== null
    ? position(magnitude(value.x), magnitude(value.y), magnitude(value.z))
    : position(0, 0, 0)

/** Health with no magnitude becomes 0, and negative health is death, not debt. */
const repairHealth = (value: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0

/**
 * The repair EVERY entity state goes through, wherever it enters the roster —
 * spawn, sweep, or a restored save.
 *
 * One function and three call sites on purpose. `docs/testing.md` §3.0.1 records
 * what the other arrangement cost in this repository: the time module guarded
 * `ticks` one way and `dayLengthTicks` another, and 「修復関数が SIM-1 を再生産して
 * いた」 — the repair reproduced the defect it repaired. A second consequence was
 * `makeTimeService(initial)` not normalising at all, so the one boundary that
 * was guarded had a sibling entry point that was not. Both are closed here by
 * there being nowhere else to write a state from.
 */
const repairState = <S>(state: EntityState<S>): EntityState<S> => ({
  feetPosition: repairPosition(state.feetPosition),
  healthPoints: repairHealth(state.healthPoints),
  behaviour: state.behaviour,
})

// ---------------------------------------------------------------------------
// Spawning and despawning
// ---------------------------------------------------------------------------

/**
 * What a caller supplies to bring an entity into existence.
 *
 * NOTE WHAT IS ABSENT: an id. Minting is the roster's, because only the roster
 * knows which serials are already spoken for — including the ones a save
 * brought back. A caller-supplied id is the collision in the module header with
 * the decision moved somewhere that cannot make it correctly.
 */
export type SpawnRequest<S> = {
  readonly kind: EntityKind
  readonly feetPosition: Position
  readonly healthPoints: number
  readonly behaviour: S
}

export type SpawnOutcome<S> = {
  readonly roster: EntityRoster<S>
  readonly entity: Entity<S>
}

/**
 * Add an entity and give it an id.
 *
 * WHAT THIS DOES NOT DECIDE: whether a mob may spawn here. That is
 * `canHostileSpawnAt` in `mx-gameplay/domain/mob/hostile-spawn.ts`, which
 * already exists, already answers about one candidate cell, and already says in
 * its own header that the search over the roster — the population cap, the
 * cadence, the despawn radius — 「arrive with mc-sim」. They arrive as CALLS to
 * `countOfKind` and `sweepRoster` from that repository, not as rules in this
 * one.
 */
export const spawnEntity = <S>(roster: EntityRoster<S>, request: SpawnRequest<S>): SpawnOutcome<S> => {
  const entity: Entity<S> = {
    id: mintEntityId(roster.nextSerial),
    kind: request.kind,
    ...repairState(request),
  }

  return {
    roster: { entities: [...roster.entities, entity], nextSerial: roster.nextSerial + 1 },
    entity,
  }
}

export type DespawnOutcome<S> = {
  readonly roster: EntityRoster<S>
  /** `false` when nothing had that id — an ordinary answer, not an error. */
  readonly despawned: boolean
}

/**
 * Remove one entity.
 *
 * The serial is NOT reclaimed: `nextSerial` only ever goes up, so an id is never
 * reused inside one world's lifetime. A recycled id is worse than a wasted one,
 * because a stale reference held by a renderer or a network peer silently starts
 * naming a different mob.
 */
export const despawnEntity = <S>(roster: EntityRoster<S>, id: EntityId): DespawnOutcome<S> => {
  const entities = roster.entities.filter((entity) => entity.id !== id)

  return entities.length === roster.entities.length
    ? { roster, despawned: false }
    : { roster: { entities, nextSerial: roster.nextSerial }, despawned: true }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Find one entity. Linear, and that is a measured choice rather than an
 * oversight.
 *
 * A `Map` beside the array would make this O(1) and would make EVERY WRITE
 * allocate a second structure, on a roster the reference caps at sixteen
 * hostiles (`mx-gameplay/domain/mob/hostile-spawn.ts`: `MAX_HOSTILE_COUNT = 16`)
 * — paying an allocation on the frame path to speed up the path that is not on
 * it. The trigger for revisiting is a roster large enough that `find` shows up
 * in a measurement; the note is here so that whoever measures it knows the
 * index was considered and why it was not built.
 */
export const findEntity = <S>(roster: EntityRoster<S>, id: EntityId): Entity<S> | undefined =>
  roster.entities.find((entity) => entity.id === id)

/**
 * How many of a kind exist.
 *
 * The population census `canHostileSpawnAt` says it cannot take: its header
 * names HOW MANY (`MAX_HOSTILE_COUNT = 16` against a live census) among the
 * decisions that 「read or write the roster」 and therefore wait for this service.
 * mc-sim counts; the cap is still mx-gameplay's number.
 */
export const countOfKind = <S>(roster: EntityRoster<S>, kind: EntityKind): number =>
  roster.entities.reduce((total, entity) => (entity.kind === kind ? total + 1 : total), 0)

// ---------------------------------------------------------------------------
// The frame sweep
// ---------------------------------------------------------------------------

/**
 * What one step of a rule decides about one entity.
 *
 * A tagged union rather than a partial record, for the reason `EntityState`
 * gives. `Unchanged` exists as its own case rather than as "a `Changed` that
 * happens to be equal" because it is the one that costs nothing: see
 * `sweepRoster`.
 */
export type EntityTransition<S> =
  /** Nothing happened to it this frame. The entity object is REUSED. */
  | { readonly _tag: 'Unchanged' }
  /** New position, health and behaviour. Id and kind are not the rule's to change. */
  | { readonly _tag: 'Changed'; readonly state: EntityState<S> }
  /** Gone. A detonated creeper, a mob that died, one that walked out of range. */
  | { readonly _tag: 'Despawned' }

/**
 * The two transitions that carry no payload, as shared constants.
 *
 * `EntityTransition<never>` is assignable to `EntityTransition<S>` for every
 * `S`, so one frozen object serves every roster — an idle frame over a hundred
 * dormant mobs allocates ZERO transition objects.
 */
export const UNCHANGED: EntityTransition<never> = { _tag: 'Unchanged' }
export const DESPAWNED: EntityTransition<never> = { _tag: 'Despawned' }

export const changed = <S>(state: EntityState<S>): EntityTransition<S> => ({ _tag: 'Changed', state })

/**
 * One entity's outcome for one sweep: what becomes of it, and what the rule
 * produced.
 *
 * `emit` is how an explosion gets out. mx-gameplay's `stepCreeperFuse` returns
 * `{ fuse, explosion }` where the explosion is present on EXACTLY ONE step per
 * creeper, and a sweep with no channel for it would force the caller to either
 * mutate a closed-over array from inside a `Ref.modify` (a side effect in the
 * function an atomic update runs) or to walk the roster a second time. `emit` is
 * `A | undefined` rather than an array because "nothing happened" is the common
 * case and it must not cost an allocation.
 */
export type EntityStep<S, A> = {
  readonly transition: EntityTransition<S>
  readonly emit: A | undefined
}

export type SweepOutcome<S, A> = {
  readonly roster: EntityRoster<S>
  readonly emitted: ReadonlyArray<A>
}

const NO_EMISSIONS: ReadonlyArray<never> = []

/**
 * Run one step over every entity, and collect what the rules produced.
 *
 * THIS IS THE HOT PATH, and the allocation behaviour is part of the contract
 * rather than an implementation detail:
 *
 *   - An entity whose transition is `Unchanged` is REUSED — the same object is
 *     in the resulting array, so a renderer or a network diff can compare by
 *     reference.
 *   - A sweep in which nothing changed and nothing was emitted returns the
 *     ARGUMENT roster, the same object, having allocated no array at all. The
 *     result array is created lazily, on the first entity that actually changes,
 *     from the prefix that did not. So the idle frame — every mob dormant, no
 *     player near — costs one closure call per mob and nothing else.
 *   - `emitted` is a shared empty array when nothing was emitted.
 *
 * plan.md §5.2 spends its whole section on per-frame allocation, and mx-gameplay
 * applies the same discipline one layer up in DN-GP-1: 「An idle tick stops HERE,
 * without touching the store. [...] the reference implementation read ~7M blocks
 * at this point whether or not anything had moved」. A roster that copied itself
 * once per frame per reader would undo that before the first mob existed.
 *
 * `state` from a `Changed` goes through `repairState`, so a rule cannot write a
 * `NaN` health into the roster even by accident. The rule is not distrusted —
 * this is the boundary that lets the value in, and `normaliseTimeState`'s
 * history is that guarding only the save path leaves the sibling entry point
 * open (docs/testing.md §3.0.1).
 */
export const sweepRoster = <S, A>(
  roster: EntityRoster<S>,
  step: (entity: Entity<S>) => EntityStep<S, A>,
): SweepOutcome<S, A> => {
  let kept: Array<Entity<S>> | undefined
  let emitted: Array<A> | undefined

  roster.entities.forEach((entity, index) => {
    const outcome = step(entity)

    if (outcome.emit !== undefined) {
      emitted = emitted ?? []
      emitted.push(outcome.emit)
    }

    if (outcome.transition._tag === 'Unchanged') {
      kept?.push(entity)
      return
    }

    // First divergence: materialise the prefix that did not change, once.
    kept = kept ?? roster.entities.slice(0, index)

    if (outcome.transition._tag === 'Changed') {
      kept.push({ id: entity.id, kind: entity.kind, ...repairState(outcome.transition.state) })
    }
  })

  return {
    roster: kept === undefined ? roster : { entities: kept, nextSerial: roster.nextSerial },
    emitted: emitted ?? NO_EMISSIONS,
  }
}

// ---------------------------------------------------------------------------
// The load path
// ---------------------------------------------------------------------------

/**
 * How a host repairs a behaviour it — and only it — understands.
 *
 * A saved `behaviour` is JSON that CLAIMS to be an `S`. mc-sim cannot check that
 * claim without knowing what an `S` is, which is the one thing this module is
 * built not to know, so the check is delegated to the party that instantiated
 * the parameter. Optional: a host that has nothing to repair (or is running a
 * behaviour type that is already total, as `CreeperFuse` is over its three tags)
 * supplies nothing and the value passes through.
 *
 * It must be TOTAL. mc-sim cannot invent a replacement `S` if this throws, and a
 * throw on the world-load path is `Cause.Die` in the frame loop, logged and
 * swallowed (DN-08).
 */
export type BehaviourRepair<S> = (kind: EntityKind, behaviour: S) => S

/** What a repair had to change. Zero on a save this build wrote itself. */
export type RosterRepair = {
  /**
   * Entities dropped because they had no kind.
   *
   * The counterpart of `NormaliseOutcome.discarded` in `domain/inventory.ts`,
   * and separate from `reidentified` for the same reason that one is separate
   * from `leftover`: a host does different things with the two numbers. A
   * discard is an entity this build cannot run — nothing names it, no rule will
   * ever match it, and there is nothing to spawn in its place. Kind is the ONLY
   * field that can cause one; position and health are repaired to values (see
   * `magnitude`), and an id can always be minted.
   */
  readonly discarded: number
  /**
   * Entities that were given a new id because theirs was blank or was a
   * duplicate of one already in the roster.
   *
   * Non-zero means the save disagreed with itself. It is reported rather than
   * swallowed because the entity a host was tracking by id is still there and is
   * now called something else — a renderer or a network peer holding the old id
   * needs to know that its reference went stale, and "the mob vanished" is the
   * symptom if it does not.
   */
  readonly reidentified: number
}

export type NormaliseRosterOutcome<S> = RosterRepair & {
  readonly roster: EntityRoster<S>
}

/**
 * Repair a roster read from persistence into one this module's invariants hold
 * for. The world-load counterpart of `emptyRoster`.
 *
 * REPAIRS RATHER THAN REJECTS, which is the decision `normaliseInventory` and
 * `normaliseTimeState` already made here and the reason both are cited in this
 * one's tests. A save crosses a version boundary; that is the ordinary case, not
 * an error, and failing a world load over a field that can be fixed turns a
 * repairable save into an unopenable one. There is no error channel to report
 * into either — `EntityManager.restore` is on the load path — so what it changed
 * comes back as a `RosterRepair` instead.
 *
 * TOTAL OVER ANY RUNTIME VALUE, not merely over any `EntityRoster<S>`. Every
 * field below satisfies its declared type at this boundary and may still be
 * absent, `null`, a string or an array — that is what "crossed a version
 * boundary" means — so every test is made on the value before any arithmetic or
 * property access can coerce it into looking deliberate.
 *
 * Five repairs:
 *
 *   1. THE CONTAINER. A missing or non-array `entities` reads as empty; a hole
 *      or a `null` in it is skipped.
 *   2. KIND. An entity whose kind is not a non-blank string is DROPPED and
 *      counted in `discarded`. It is the only unrepairable field: there is no
 *      default kind that would not be mc-sim inventing a mob.
 *   3. POSITION AND HEALTH. Repaired to values by `repairState`. Nothing is
 *      dropped for either — see `magnitude` for why an entity at the origin
 *      beats an entity at `NaN`.
 *   4. IDS. A blank id, or one already taken by an earlier entity in the same
 *      save, is REPLACED with a freshly minted one and counted in
 *      `reidentified`. An id this module did not mint but which is unique is
 *      LEFT ALONE: a foreign build's `'creeper-7'` works perfectly well as a key
 *      and renaming it would break the very references a load is trying to
 *      preserve.
 *   5. THE COUNTER. `nextSerial` ends up strictly greater than every minted
 *      serial present, whatever the saved field said.
 *
 * ---------------------------------------------------------------------------
 * Repair 5 is the one that took a second reading
 * ---------------------------------------------------------------------------
 *
 * The near-miss docs/testing.md §3.0.1 records — 「修復関数が SIM-1 を再生産して
 * いた」, a repair function reproducing the defect it repairs — has an exact
 * analogue here, and it is not hypothetical. Minting replacement ids for repair
 * 4 needs a serial; the obvious source is the saved `nextSerial`; and the saved
 * `nextSerial` is a field of the file being repaired, so trusting it means a
 * truncated save that says `nextSerial: 0` gets its duplicate `e:1` re-minted
 * as... `e:1`. The repair would emit exactly the collision it exists to remove,
 * and would report `reidentified: 1` while doing it.
 *
 * So the counter is established FIRST, over the ids actually present, and only
 * then does anything mint. `test/entity.test.ts` pins both halves: repairing a
 * roster whose counter is a lie produces no collision, and repairing an
 * already-repaired roster reports zeroes — an idempotence check that fails
 * loudly if a repair is ever added that is not a fixed point.
 */
export const normaliseRoster = <S>(
  roster: EntityRoster<S>,
  repairBehaviour?: BehaviourRepair<S>,
): NormaliseRosterOutcome<S> => {
  const incoming: ReadonlyArray<Entity<S>> =
    typeof roster === 'object' && roster !== null && Array.isArray(roster.entities) ? roster.entities : NO_ENTITIES

  // PASS 1 — establish the counter over what is actually present, before
  // anything mints. See the header.
  const savedSerial = typeof roster?.nextSerial === 'number' && Number.isSafeInteger(roster.nextSerial)
    ? Math.max(0, roster.nextSerial)
    : 0
  const highestSerial = incoming.reduce((highest, entity) => {
    const serial = isEntityId(entity?.id) ? serialOfEntityId(entity.id) : undefined
    return serial !== undefined && serial >= highest ? serial + 1 : highest
  }, 0)

  let nextSerial = Math.max(savedSerial, highestSerial)
  let discarded = 0
  let reidentified = 0
  const taken = new Set<string>()
  const entities: Array<Entity<S>> = []

  incoming.forEach((entity) => {
    if (typeof entity !== 'object' || entity === null || !isEntityKind(entity.kind)) {
      discarded += 1
      return
    }

    const keepsItsId = isEntityId(entity.id) && !taken.has(entity.id)
    const id = keepsItsId ? entity.id : mintEntityId(nextSerial)
    if (!keepsItsId) {
      nextSerial += 1
      reidentified += 1
    }
    taken.add(id)

    const repaired = repairState(entity)
    entities.push({
      id,
      kind: entity.kind,
      feetPosition: repaired.feetPosition,
      healthPoints: repaired.healthPoints,
      behaviour: repairBehaviour === undefined ? repaired.behaviour : repairBehaviour(entity.kind, repaired.behaviour),
    })
  })

  return {
    roster: { entities: entities.length === 0 ? NO_ENTITIES : entities, nextSerial },
    discarded,
    reidentified,
  }
}
