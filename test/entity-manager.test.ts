import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Fiber } from 'effect'
import {
  ENTITY_MANAGER_TAG_KEY,
  EntityManagerLayer,
  entityManagerTag,
  makeEntityManager,
  type EntityManager,
  type EntityManagerApi,
} from '../src/application/entity-manager'
import {
  changed,
  EntityKind,
  UNCHANGED,
  type Entity,
  type EntityId,
  type EntityRoster,
} from '../src/domain/entity'
import { position } from '@nerima-games/mc-kernel'

/**
 * Stands in for mx-gameplay's `CreeperFuse`. Transcribed rather than imported —
 * mx-gameplay depends on mc-sim, so the reverse edge is a cycle the dependency
 * policy rejects, and that impossibility is exactly what the behaviour type parameter
 * exists to survive. See `test/entity.test.ts`.
 */
type Fuse =
  | { readonly _tag: 'Dormant' }
  | { readonly _tag: 'Lit'; readonly burnedSecs: number }
  | { readonly _tag: 'Detonated' }

const DORMANT: Fuse = { _tag: 'Dormant' }

const creeper = (x: number, fuse: Fuse = DORMANT) => ({
  kind: EntityKind('creeper'),
  feetPosition: position(x, 64, 0),
  healthPoints: 20,
  behaviour: fuse,
})

/** A save file's parse, typed as what it claims to be. See `test/inventory.test.ts`. */
const savedRoster = (value: unknown): EntityRoster<Fuse> => value as EntityRoster<Fuse>

const idle = { transition: UNCHANGED, emit: undefined }

describe('EntityManager — the roster', () => {
  it.effect('spawn and despawn round-trip through the service', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManager<Fuse>()

      const first = yield* roster.spawn(creeper(1))
      const second = yield* roster.spawn(creeper(2))

      expect(first.id).toBe('e:0')
      expect(second.id).toBe('e:1')
      expect(yield* roster.count).toBe(2)
      expect(yield* roster.countOfKind(EntityKind('creeper'))).toBe(2)
      expect(yield* roster.find(first.id)).toBe(first)

      expect(yield* roster.despawn(first.id)).toBe(true)
      expect(yield* roster.despawn(first.id)).toBe(false)
      expect(yield* roster.count).toBe(1)
      expect(yield* roster.find(first.id)).toBeUndefined()
    }),
  )

  it.effect('reset empties the roster AND the counter — a new world, not a reload', () =>
    Effect.gen(function* () {
      // DN-09. The reference bolted this on afterwards and
      // ts-minecraft/packages/entity/application/player-service.ts:15-18 records
      // the symptom: the second world inherited the first world's entities.
      const roster = yield* makeEntityManager<Fuse>()
      yield* roster.spawn(creeper(1))
      yield* roster.reset

      expect(yield* roster.count).toBe(0)
      expect((yield* roster.spawn(creeper(1))).id).toBe('e:0')
    }),
  )

  it.effect('each build is an independent world, which is what re-entrancy needs', () =>
    Effect.gen(function* () {
      const one = yield* makeEntityManager<Fuse>()
      const two = yield* makeEntityManager<Fuse>()

      yield* one.spawn(creeper(1))

      expect(yield* one.count).toBe(1)
      expect(yield* two.count).toBe(0)
    }),
  )

  it.effect('REGRESSION: concurrent spawns all land — Ref.modify, not get-then-set', () =>
    Effect.gen(function* () {
      // DN-07. A get-then-set implementation loses writes AND duplicates ids
      // here: two fibers read the same `nextSerial` and both mint it.
      const roster = yield* makeEntityManager<Fuse>()

      const fibers = yield* Effect.forEach(
        Array.from({ length: 50 }, (_, index) => index),
        (index) => Effect.fork(roster.spawn(creeper(index))),
        { concurrency: 'unbounded' },
      )
      yield* Effect.forEach(fibers, Fiber.join)

      const entities = yield* roster.entities
      expect(entities).toHaveLength(50)
      expect(new Set(entities.map((entity) => entity.id)).size).toBe(50)
    }),
  )
})

describe('EntityManager — iteration is the hot path', () => {
  it.effect('entities resolves to the roster’s OWN array, not a copy', () =>
    Effect.gen(function* () {
      // THE SHAPE THAT GUARANTEES IT, asserted by reference identity rather than
      // by timing. `gameplay:entities` reads this every frame; a defensive copy
      // would be an O(entities) allocation per reader per frame, which is the
      // whole subject of plan.md §5.2.
      const roster = yield* makeEntityManager<Fuse>()
      yield* roster.spawn(creeper(1))
      yield* roster.spawn(creeper(2))

      const first = yield* roster.entities
      const second = yield* roster.entities

      expect(second).toBe(first)
      expect((yield* roster.snapshot).entities).toBe(first)
    }),
  )

  it.effect('an idle sweep leaves the array — and every entity in it — identical', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManager<Fuse>()
      yield* roster.spawn(creeper(1))
      yield* roster.spawn(creeper(2))

      const before = yield* roster.entities
      const emitted = yield* roster.sweep(() => idle)
      const after = yield* roster.entities

      expect(emitted).toHaveLength(0)
      expect(after).toBe(before)
    }),
  )

  it.effect('a sweep that changes one entity leaves the others as the SAME objects', () =>
    Effect.gen(function* () {
      const roster = yield* makeEntityManager<Fuse>()
      const target = yield* roster.spawn(creeper(1))
      yield* roster.spawn(creeper(2))

      const before = yield* roster.entities
      yield* roster.sweep<never>((entity) =>
        entity.id === target.id
          ? { transition: changed({ ...entity, behaviour: { _tag: 'Lit', burnedSecs: 0.05 } }), emit: undefined }
          : idle,
      )
      const after = yield* roster.entities

      expect(after).not.toBe(before)
      expect(after[1]).toBe(before[1])
      expect(after[0]).not.toBe(before[0])
    }),
  )

  it.effect('sweep is the single write path, and it is atomic', () =>
    Effect.gen(function* () {
      // There is deliberately no `moveTo`, no `damage` and no `setBehaviour`: a
      // second write path is a second place for the invariants to be enforced,
      // and the blast case wants one pass over the roster anyway.
      const roster = yield* makeEntityManager<Fuse>()
      yield* roster.spawn(creeper(1))
      yield* roster.spawn(creeper(2))

      const hit = yield* roster.sweep<number>((entity) => ({
        transition: changed({ ...entity, healthPoints: entity.healthPoints - 7 }),
        emit: entity.healthPoints - 7,
      }))

      expect(hit).toStrictEqual([13, 13])
      expect((yield* roster.entities).map((entity) => entity.healthPoints)).toStrictEqual([13, 13])
    }),
  )
})

describe('EntityManager — save and load', () => {
  it.effect('ids are stable across a snapshot/restore cycle', () =>
    Effect.gen(function* () {
      const world = yield* makeEntityManager<Fuse>()
      const first = yield* world.spawn(creeper(1))
      const second = yield* world.spawn(creeper(2))
      yield* world.despawn(first.id)
      const saved = yield* world.snapshot

      // A different process, a later session: a fresh service handed the save.
      const reloaded = yield* makeEntityManager<Fuse>(saved)

      expect((yield* reloaded.entities).map((entity) => entity.id)).toStrictEqual([second.id])
      expect(yield* reloaded.find(second.id)).toStrictEqual(second)

      // AND THE COUNTER CAME BACK TOO. Without it the next spawn would re-issue
      // `e:0`, and a save that had despawned `e:0` would be indistinguishable
      // from one that had not — two entities with one id is how a mob becomes
      // impossible to despawn.
      expect((yield* reloaded.spawn(creeper(3))).id).toBe('e:2')
    }),
  )

  it.effect('per-kind state survives the round trip, and mc-sim never looked inside it', () =>
    Effect.gen(function* () {
      // The value is compared BY REFERENCE, which is the strongest available
      // statement that nothing rebuilt, validated or normalised it. mc-sim
      // cannot name a `Fuse`, cannot import the repository that owns one, and
      // this is the whole reason `Entity` carries a type parameter instead of a
      // `Record<string, unknown>`.
      const lit: Fuse = { _tag: 'Lit', burnedSecs: 1.2 }
      const world = yield* makeEntityManager<Fuse>()
      const spawned = yield* world.spawn(creeper(1, lit))
      const saved = yield* world.snapshot

      const reloaded = yield* makeEntityManager<Fuse>(saved)
      const back = yield* reloaded.find(spawned.id)

      expect(back?.behaviour).toBe(lit)
      // And the static type came back with it — no cast anywhere in this test.
      expect(back?.behaviour._tag).toBe('Lit')
    }),
  )

  it.effect('restore repairs a TRUNCATED save rather than throwing, and says what it changed', () =>
    Effect.gen(function* () {
      const world = yield* makeEntityManager<Fuse>()
      yield* world.spawn(creeper(1))

      const repair = yield* world.restore(savedRoster({ entities: undefined, nextSerial: undefined }))

      expect(repair).toStrictEqual({ discarded: 0, reidentified: 0 })
      expect(yield* world.count).toBe(0)
    }),
  )

  it.effect('restore repairs a FOREIGN save rather than throwing, and says what it changed', () =>
    Effect.gen(function* () {
      const world = yield* makeEntityManager<Fuse>()

      const repair = yield* world.restore(
        savedRoster({
          entities: [
            // A build that spelled its ids differently. Kept: renaming it would
            // break the references a load exists to preserve.
            { id: 'creeper-7', kind: 'creeper', feetPosition: { x: 1, y: 64, z: 0 }, healthPoints: 20, behaviour: DORMANT },
            // A build with a kind this one has never heard of. KEPT TOO — mc-sim
            // has no roster of kinds and deliberately never branches on one.
            { id: 'e:0', kind: 'enderman', feetPosition: { x: 2, y: 64, z: 0 }, healthPoints: 40, behaviour: DORMANT },
            // Two things this build cannot hold: no kind at all, and a duplicate.
            { id: 'e:1', kind: null, feetPosition: { x: 3, y: 64, z: 0 }, healthPoints: 1, behaviour: DORMANT },
            { id: 'e:0', kind: 'creeper', feetPosition: { x: 4, y: 64, z: 0 }, healthPoints: 20, behaviour: DORMANT },
          ],
          nextSerial: 0,
        }),
      )

      expect(repair).toStrictEqual({ discarded: 1, reidentified: 1 })

      const entities = yield* world.entities
      // The duplicate was re-minted as `e:2`, not `e:1`: the counter is
      // established over every serial the FILE named, including the one held by
      // the entity that was then discarded. Reusing a serial a save spoke for is
      // the collision this repair exists to remove, arriving one step later.
      expect(entities.map((entity) => entity.id)).toStrictEqual(['creeper-7', 'e:0', 'e:2'])
      expect(entities.map((entity) => entity.kind)).toStrictEqual(['creeper', 'enderman', 'creeper'])
      expect(new Set(entities.map((entity) => entity.id)).size).toBe(3)

      // And the counter is clear of everything the save brought back.
      expect((yield* world.spawn(creeper(9))).id).toBe('e:3')
    }),
  )

  it.effect('the CONSTRUCTOR repairs too, because a Layer is the other way a save gets in', () =>
    Effect.gen(function* () {
      // `makeInventoryService` closed this for slot counts and `makeTimeService`
      // had to close it afterwards for day lengths (docs/testing.md §3.0.1):
      // `XxxLayer(loadedState)` is the natural way a host supplies a loaded world
      // and guarding only `restore` leaves that entrance open.
      const world = yield* makeEntityManager<Fuse>(
        savedRoster({
          entities: [
            { ...creeper(1), id: 'e:0' },
            { ...creeper(2), id: 'e:0' },
          ],
          nextSerial: 0,
        }),
      )

      const entities = yield* world.entities
      expect(new Set(entities.map((entity) => entity.id)).size).toBe(2)
      expect((yield* world.spawn(creeper(3))).id).toBe('e:2')
    }),
  )

  it.effect('a host repair runs on both entrances, with the kind in hand', () =>
    Effect.gen(function* () {
      const repairs: Array<string> = []
      const world = yield* makeEntityManager<Fuse>(undefined, (kind, behaviour) => {
        repairs.push(kind)
        return behaviour
      })

      yield* world.restore(savedRoster({ entities: [{ ...creeper(1), id: 'e:0' }], nextSerial: 1 }))

      expect(repairs).toStrictEqual(['creeper'])
    }),
  )
})

describe('EntityManager — the Tag', () => {
  it.effect('the key is the contract with four repositories, pinned as a literal', () =>
    Effect.sync(() => {
      // docs/public-api.md §6.1: the Tag identifier string is the key each
      // consumer resolves a Layer by, and a silent change typechecks everywhere
      // and breaks at composition. Asserted as a literal, not as
      // `toBe(ENTITY_MANAGER_TAG_KEY)`, per docs/testing.md §4.6.
      expect(ENTITY_MANAGER_TAG_KEY).toBe('@nerima-games/mc-sim/EntityManager')
      expect(entityManagerTag<Fuse>().key).toBe('@nerima-games/mc-sim/EntityManager')
    }),
  )

  it.effect('two instantiations name ONE service, which is why a world has one roster', () =>
    Effect.gen(function* () {
      // Effect resolves tags by their textual key, so the behaviour parameter is
      // a static view and never a second registration. A host builds one Layer;
      // mx-gameplay and mx-ui see the same roster through it.
      const world = yield* Effect.gen(function* () {
        const writer = yield* entityManagerTag<Fuse>()
        yield* writer.spawn(creeper(1))
        const reader = yield* entityManagerTag<Fuse>()
        return yield* reader.count
      }).pipe(Effect.provide(EntityManagerLayer<Fuse>()))

      expect(world).toBe(1)
    }),
  )

  it.effect('a Layer built at one behaviour type satisfies a Tag asked for at another', () =>
    Effect.gen(function* () {
      // The property that makes the parameter a static view rather than a second
      // service. The kernel-owned ClockPort is a different boundary: a narrow
      // shape could satisfy a wide Tag and make a missing field read `undefined`.
      // Here every
      // instantiation has identical methods and identical arities, and the only
      // thing that varies is the static type of a field mc-sim never reads.
      const opaque = { anything: 'mc-sim cannot read this' }
      const count = yield* Effect.gen(function* () {
        const asUnknown = yield* entityManagerTag<unknown>()
        yield* asUnknown.spawn({ ...creeper(1), behaviour: opaque })
        const asFuse = yield* entityManagerTag<Fuse>()
        return yield* asFuse.count
      }).pipe(Effect.provide(EntityManagerLayer<unknown>()))

      expect(count).toBe(1)
    }),
  )

  it.effect('the Layer is one build per world, so a host merges it exactly once', () =>
    Effect.gen(function* () {
      // `Layer.effect`, like every other service here. Two separate provides are
      // two rosters — the hazard mc-compose's docs/e2e-triage.md §4.3 measured
      // for `InventoryService`, where mx-gameplay wrote to one instance and
      // mx-ui read another.
      const layer = EntityManagerLayer<Fuse>()

      const first = yield* Effect.gen(function* () {
        const roster = yield* entityManagerTag<Fuse>()
        yield* roster.spawn(creeper(1))
        return yield* roster.count
      }).pipe(Effect.provide(layer))

      const second = yield* Effect.gen(function* () {
        const roster = yield* entityManagerTag<Fuse>()
        return yield* roster.count
      }).pipe(Effect.provide(layer))

      expect(first).toBe(1)
      expect(second).toBe(0)
    }),
  )

  it.effect('an initial roster reaches the service through the Layer', () =>
    Effect.gen(function* () {
      const saved: EntityRoster<Fuse> = {
        entities: [{ id: 'e:4' as EntityId, ...creeper(1) }],
        nextSerial: 5,
      }

      const ids = yield* Effect.gen(function* () {
        const roster = yield* entityManagerTag<Fuse>()
        yield* roster.spawn(creeper(2))
        return (yield* roster.entities).map((entity: Entity<Fuse>) => entity.id)
      }).pipe(Effect.provide(EntityManagerLayer<Fuse>(saved)))

      expect(ids).toStrictEqual(['e:4', 'e:5'])
    }),
  )

  it.effect('the service type is what the Tag says it is, at the caller’s behaviour type', () =>
    Effect.sync(() => {
      // A compile-time assertion with a runtime witness: if `entityManagerTag`
      // ever stopped carrying `S`, this line would still run and the annotation
      // would stop typechecking, which is what `pnpm typecheck` is for.
      const tag: Context.Tag<EntityManager, EntityManagerApi<Fuse>> = entityManagerTag<Fuse>()
      expect(Context.isTag(tag)).toBe(true)
    }),
  )
})
