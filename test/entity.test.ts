import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  changed,
  countOfKind,
  DESPAWNED,
  despawnEntity,
  emptyRoster,
  ENTITY_ID_PREFIX,
  EntityId,
  EntityKind,
  findEntity,
  isEntityId,
  isEntityKind,
  mintEntityId,
  normaliseRoster,
  serialOfEntityId,
  spawnEntity,
  sweepRoster,
  UNCHANGED,
  type Entity,
  type EntityRoster,
  type EntityStep,
} from '../domain/entity'
import { position } from '../domain/kernel-vocabulary'

/**
 * A stand-in for mx-gameplay's `CreeperFuse`.
 *
 * TRANSCRIBED, NOT IMPORTED, and the impossibility of importing it is the whole
 * point of the type parameter these tests exercise: mx-gameplay depends on
 * mc-sim, so the reverse edge is a cycle `pnpm check:deps` rejects. The shape is
 * `mx-gameplay/domain/mob/creeper-fuse.ts`'s three-case union, reproduced here
 * only so that the tests below can ask what mc-sim does with a value it has
 * never heard of.
 *
 * NOTHING IN `domain/entity.ts` MAY EVER BE ABLE TO READ THIS. Several tests
 * assert exactly that, by reference identity.
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

/**
 * A roster as a SAVE FILE hands one back: values that satisfy the declared type
 * at the boundary and nothing else.
 *
 * THE CAST IS THE POINT, exactly as `corruptSlot` in `test/inventory.test.ts` is.
 * mc-save parses JSON and hands the parse straight back through `restore`; a
 * missing field is `undefined`, `JSON.stringify(NaN)` writes `null`, and a build
 * with a different schema writes whatever it liked. All of them are typed
 * `EntityRoster<Fuse>` at the one boundary that has to survive them.
 */
const savedRoster = (value: unknown): EntityRoster<Fuse> => value as EntityRoster<Fuse>

const idsOf = <S>(roster: EntityRoster<S>): ReadonlyArray<string> => roster.entities.map((entity) => entity.id)

const keep = <A>(emit: A | undefined = undefined): EntityStep<never, A> => ({ transition: UNCHANGED, emit })

describe('EntityId', () => {
  it.effect('is a non-blank branded string, exactly as kernel spells WorldId and StageId', () =>
    Effect.sync(() => {
      expect(EntityId('e:7')).toBe('e:7')
      expect(() => EntityId('')).toThrow()
      expect(() => EntityId('   ')).toThrow()
    }),
  )

  it.effect('the guard does NOT throw, because it is what the load path uses', () =>
    Effect.sync(() => {
      // `EntityId` throwing is right where a human wrote the literal (DN-06) and
      // fatal on the world-load path: a throw from a pure function is a
      // `Cause.Die` that `application/game-loop.ts` logs and swallows (SIM-3).
      expect(isEntityId('e:7')).toBe(true)
      expect(isEntityId('creeper-7')).toBe(true)
      expect(isEntityId('')).toBe(false)
      expect(isEntityId('  ')).toBe(false)
      expect(isEntityId(undefined)).toBe(false)
      expect(isEntityId(null)).toBe(false)
      expect(isEntityId(7)).toBe(false)
    }),
  )

  it.effect('kinds are branded the same way, and the guard is equally total', () =>
    Effect.sync(() => {
      expect(EntityKind('creeper')).toBe('creeper')
      expect(() => EntityKind('')).toThrow()
      expect(isEntityKind('creeper')).toBe(true)
      expect(isEntityKind(null)).toBe(false)
      expect(isEntityKind({})).toBe(false)
    }),
  )

  it.effect('the minted spelling is the prefix and the serial, literally', () =>
    Effect.sync(() => {
      expect(ENTITY_ID_PREFIX).toBe('e:')
      expect(mintEntityId(0)).toBe('e:0')
      expect(mintEntityId(41)).toBe('e:41')
    }),
  )

  it.effect('reads back the serial it minted, and nothing else', () =>
    Effect.sync(() => {
      expect(serialOfEntityId('e:0')).toBe(0)
      expect(serialOfEntityId('e:41')).toBe(41)

      // A foreign build's id is not this module's to interpret.
      expect(serialOfEntityId('creeper-7')).toBeUndefined()
      expect(serialOfEntityId('e:')).toBeUndefined()

      // `Number('')` is 0 and `Number(' 1')` is 1, so the digits are tested
      // before the conversion — the discipline `normaliseTimeState` states for
      // `null / 60`: decide on the value before arithmetic makes it look
      // deliberate.
      expect(serialOfEntityId('e: 1')).toBeUndefined()
      expect(serialOfEntityId('e:-1')).toBeUndefined()
      expect(serialOfEntityId('e:1.5')).toBeUndefined()
      expect(serialOfEntityId('e:1e3')).toBeUndefined()
      expect(serialOfEntityId('e:NaN')).toBeUndefined()
      expect(serialOfEntityId('e:99999999999999999999')).toBeUndefined()
    }),
  )
})

describe('spawnEntity / despawnEntity', () => {
  it.effect('mints ids in order and advances the counter', () =>
    Effect.sync(() => {
      const one = spawnEntity(emptyRoster<Fuse>(), creeper(0))
      const two = spawnEntity(one.roster, creeper(1))

      expect(one.entity.id).toBe('e:0')
      expect(two.entity.id).toBe('e:1')
      expect(two.roster.nextSerial).toBe(2)
      expect(idsOf(two.roster)).toStrictEqual(['e:0', 'e:1'])
    }),
  )

  it.effect('is deterministic — the same spawn sequence produces the same ids', () =>
    Effect.sync(() => {
      // plan.md §5.1-3 makes determinism the precondition for using the
      // reference's tests as an oracle. There is no clock and no RNG in
      // `domain/entity.ts`, so a scenario replays byte for byte.
      const run = () =>
        idsOf(spawnEntity(spawnEntity(spawnEntity(emptyRoster<Fuse>(), creeper(0)).roster, creeper(1)).roster, creeper(2)).roster)

      expect(run()).toStrictEqual(['e:0', 'e:1', 'e:2'])
      expect(run()).toStrictEqual(run())
    }),
  )

  it.effect('spawn and despawn round-trip, and despawn says whether it did anything', () =>
    Effect.sync(() => {
      const spawned = spawnEntity(emptyRoster<Fuse>(), creeper(0))
      const gone = despawnEntity(spawned.roster, spawned.entity.id)

      expect(gone.despawned).toBe(true)
      expect(gone.roster.entities).toHaveLength(0)
      expect(findEntity(gone.roster, spawned.entity.id)).toBeUndefined()

      const again = despawnEntity(gone.roster, spawned.entity.id)
      expect(again.despawned).toBe(false)
      // Nothing changed, so nothing was rebuilt.
      expect(again.roster).toBe(gone.roster)
    }),
  )

  it.effect('a despawned serial is NOT reclaimed, so a stale reference cannot name a new mob', () =>
    Effect.sync(() => {
      const spawned = spawnEntity(emptyRoster<Fuse>(), creeper(0))
      const gone = despawnEntity(spawned.roster, spawned.entity.id)
      const next = spawnEntity(gone.roster, creeper(1))

      expect(next.entity.id).toBe('e:1')
    }),
  )

  it.effect('repairs a health or a position that has no magnitude, at the spawn boundary too', () =>
    Effect.sync(() => {
      // mx-gameplay's preview finding F5 is a bare `NaN` reaching `applyDamage`,
      // after which the entity is permanently immortal: every later comparison
      // against `NaN` is false. Guarding only the save path would leave this
      // entrance open — the shape of the `makeTimeService` near-miss recorded in
      // docs/testing.md §3.0.1.
      const spawned = spawnEntity(emptyRoster<Fuse>(), {
        kind: EntityKind('creeper'),
        feetPosition: position(Number.NaN, 64, Number.POSITIVE_INFINITY),
        healthPoints: Number.NaN,
        behaviour: DORMANT,
      })

      expect(spawned.entity.feetPosition).toStrictEqual({ x: 0, y: 64, z: 0 })
      expect(spawned.entity.healthPoints).toBe(0)
    }),
  )

  it.effect('counts a kind without ever branching on one', () =>
    Effect.sync(() => {
      const roster = spawnEntity(
        spawnEntity(spawnEntity(emptyRoster<Fuse>(), creeper(0)).roster, creeper(1)).roster,
        { ...creeper(2), kind: EntityKind('zombie') },
      ).roster

      expect(countOfKind(roster, EntityKind('creeper'))).toBe(2)
      expect(countOfKind(roster, EntityKind('zombie'))).toBe(1)
      // A kind nobody spawned is zero, not an error: mc-sim has no roster of
      // kinds to check one against, deliberately (DN-11).
      expect(countOfKind(roster, EntityKind('enderman'))).toBe(0)
    }),
  )
})

describe('sweepRoster', () => {
  const threeCreepers = spawnEntity(
    spawnEntity(spawnEntity(emptyRoster<Fuse>(), creeper(0)).roster, creeper(1)).roster,
    creeper(2),
  ).roster

  it.effect('an idle sweep returns the ARGUMENT roster — no array, no object, nothing', () =>
    Effect.sync(() => {
      // THE SHAPE THAT GUARANTEES THE HOT PATH, asserted by reference identity
      // rather than by timing. `gameplay:entities` runs this every frame over
      // every mob and most mobs are dormant most frames; a sweep that rebuilt
      // the array anyway would be DN-GP-1's 「the reference read ~7M blocks
      // whether or not anything had moved」 with entities instead of blocks.
      const outcome = sweepRoster(threeCreepers, () => keep())

      expect(outcome.roster).toBe(threeCreepers)
      expect(outcome.roster.entities).toBe(threeCreepers.entities)
      expect(outcome.emitted).toHaveLength(0)
    }),
  )

  it.effect('two idle sweeps share one emissions array, so an idle frame allocates none', () =>
    Effect.sync(() => {
      expect(sweepRoster(threeCreepers, () => keep()).emitted).toBe(
        sweepRoster(threeCreepers, () => keep()).emitted,
      )
    }),
  )

  it.effect('an UNCHANGED entity is the SAME object after a sweep that changed a different one', () =>
    Effect.sync(() => {
      // Structural sharing is what lets a renderer or a network diff compare by
      // reference instead of by field.
      const outcome = sweepRoster<Fuse, never>(threeCreepers, (entity) =>
        entity.id === 'e:1'
          ? { transition: changed({ ...entity, behaviour: { _tag: 'Lit', burnedSecs: 0.05 } }), emit: undefined }
          : keep(),
      )

      expect(outcome.roster).not.toBe(threeCreepers)
      expect(outcome.roster.entities[0]).toBe(threeCreepers.entities[0])
      expect(outcome.roster.entities[2]).toBe(threeCreepers.entities[2])
      expect(outcome.roster.entities[1]).not.toBe(threeCreepers.entities[1])
      expect(outcome.roster.entities[1]?.behaviour).toStrictEqual({ _tag: 'Lit', burnedSecs: 0.05 })
    }),
  )

  it.effect('a rule cannot change an id or a kind, because a transition does not carry one', () =>
    Effect.sync(() => {
      const outcome = sweepRoster<Fuse, never>(threeCreepers, (entity) => ({
        transition: changed({ feetPosition: position(9, 9, 9), healthPoints: 1, behaviour: entity.behaviour }),
        emit: undefined,
      }))

      expect(idsOf(outcome.roster)).toStrictEqual(['e:0', 'e:1', 'e:2'])
      expect(outcome.roster.entities.map((entity) => entity.kind)).toStrictEqual(['creeper', 'creeper', 'creeper'])
      expect(outcome.roster.nextSerial).toBe(3)
    }),
  )

  it.effect('DESPAWNED removes exactly its own entity and leaves the rest identical', () =>
    Effect.sync(() => {
      const outcome = sweepRoster<Fuse, never>(threeCreepers, (entity) =>
        entity.id === 'e:0' ? { transition: DESPAWNED, emit: undefined } : keep(),
      )

      expect(idsOf(outcome.roster)).toStrictEqual(['e:1', 'e:2'])
      expect(outcome.roster.entities[0]).toBe(threeCreepers.entities[1])
    }),
  )

  it.effect('collects what the rules emitted, in roster order, and only what they emitted', () =>
    Effect.sync(() => {
      const outcome = sweepRoster<Fuse, string>(threeCreepers, (entity) =>
        entity.id === 'e:1' ? keep('boom') : keep(),
      )

      expect(outcome.emitted).toStrictEqual(['boom'])
      // Emitting is not changing: the roster is untouched.
      expect(outcome.roster).toBe(threeCreepers)
    }),
  )

  it.effect('REGRESSION: a rule cannot write a health with no magnitude into the roster', () =>
    Effect.sync(() => {
      // The rules tier is not distrusted; this is simply the boundary the value
      // enters through, and `normaliseTimeState`'s history is that guarding only
      // the save path leaves the sibling entrance open (docs/testing.md §3.0.1).
      const outcome = sweepRoster<Fuse, never>(threeCreepers, (entity) => ({
        transition: changed({ ...entity, healthPoints: Number.NaN }),
        emit: undefined,
      }))

      expect(outcome.roster.entities.map((entity) => entity.healthPoints)).toStrictEqual([0, 0, 0])
    }),
  )

  it.effect('the behaviour is carried through BY REFERENCE — mc-sim never reads inside it', () =>
    Effect.sync(() => {
      const fuse: Fuse = { _tag: 'Lit', burnedSecs: 1.2 }
      const spawned = spawnEntity(emptyRoster<Fuse>(), creeper(0, fuse))
      const outcome = sweepRoster<Fuse, never>(spawned.roster, () => keep())

      expect(spawned.entity.behaviour).toBe(fuse)
      expect(outcome.roster.entities[0]?.behaviour).toBe(fuse)
    }),
  )
})

describe('normaliseRoster', () => {
  it.effect('a truncated save loads as an empty world instead of throwing', () =>
    Effect.sync(() => {
      // Repairs rather than rejects, the decision `normaliseInventory` and
      // `normaliseTimeState` already made here: failing a world load over a
      // recoverable field turns a repairable save into an unopenable one.
      expect(() => normaliseRoster(savedRoster(undefined))).not.toThrow()
      expect(normaliseRoster(savedRoster(undefined)).roster).toStrictEqual({ entities: [], nextSerial: 0 })
      expect(normaliseRoster(savedRoster(null)).roster.entities).toHaveLength(0)
      expect(normaliseRoster(savedRoster({})).roster.entities).toHaveLength(0)
      expect(normaliseRoster(savedRoster({ entities: null, nextSerial: 3 })).roster.entities).toHaveLength(0)
      expect(normaliseRoster(savedRoster({ entities: 'creeper' })).roster.entities).toHaveLength(0)
    }),
  )

  it.effect('a hole in the array is skipped and counted, not dereferenced', () =>
    Effect.sync(() => {
      const outcome = normaliseRoster(
        savedRoster({ entities: [null, undefined, { ...creeper(0), id: 'e:0' }], nextSerial: 1 }),
      )

      expect(outcome.roster.entities).toHaveLength(1)
      expect(outcome.discarded).toBe(2)
    }),
  )

  it.effect('an entity with no kind is DISCARDED and counted — it is the only unrepairable field', () =>
    Effect.sync(() => {
      // The counterpart of `NormaliseOutcome.discarded` in `domain/inventory.ts`:
      // there is no default kind that would not be mc-sim inventing a mob, and
      // no rule in any repository will ever match one.
      const outcome = normaliseRoster(
        savedRoster({
          entities: [
            { ...creeper(0), id: 'e:0', kind: '' },
            { ...creeper(1), id: 'e:1', kind: undefined },
            { ...creeper(2), id: 'e:2' },
          ],
          nextSerial: 3,
        }),
      )

      expect(outcome.discarded).toBe(2)
      expect(outcome.reidentified).toBe(0)
      expect(idsOf(outcome.roster)).toStrictEqual(['e:2'])
    }),
  )

  it.effect('a position or a health with no magnitude is repaired to a value, never dropped', () =>
    Effect.sync(() => {
      // An entity at `NaN` fails every distance test, so it is invisible to the
      // ignition range AND to the despawn radius — immortal and unreachable. A
      // mob at the origin is wrong in a way somebody can see. The precedent is
      // `clampFraction`'s 「a value with no magnitude becomes 0 [...] It is a real
      // instant」 in `domain/time-of-day.ts`.
      const outcome = normaliseRoster(
        savedRoster({
          entities: [
            {
              id: 'e:0',
              kind: 'creeper',
              feetPosition: { x: null, y: 'up', z: Number.NaN },
              healthPoints: null,
              behaviour: DORMANT,
            },
            { id: 'e:1', kind: 'creeper', feetPosition: undefined, healthPoints: -5, behaviour: DORMANT },
          ],
          nextSerial: 2,
        }),
      )

      expect(outcome.discarded).toBe(0)
      expect(outcome.roster.entities[0]?.feetPosition).toStrictEqual({ x: 0, y: 0, z: 0 })
      expect(outcome.roster.entities[0]?.healthPoints).toBe(0)
      expect(outcome.roster.entities[1]?.feetPosition).toStrictEqual({ x: 0, y: 0, z: 0 })
      expect(outcome.roster.entities[1]?.healthPoints).toBe(0)
    }),
  )

  it.effect('a FOREIGN build’s id is left alone, because renaming it breaks what a load preserves', () =>
    Effect.sync(() => {
      const outcome = normaliseRoster(
        savedRoster({ entities: [{ ...creeper(0), id: 'creeper-7' }], nextSerial: 0 }),
      )

      expect(idsOf(outcome.roster)).toStrictEqual(['creeper-7'])
      expect(outcome.reidentified).toBe(0)
    }),
  )

  it.effect('a blank or duplicate id is re-minted and counted', () =>
    Effect.sync(() => {
      const outcome = normaliseRoster(
        savedRoster({
          entities: [
            { ...creeper(0), id: 'e:0' },
            { ...creeper(1), id: 'e:0' },
            { ...creeper(2), id: '' },
          ],
          nextSerial: 1,
        }),
      )

      expect(outcome.reidentified).toBe(2)
      expect(new Set(idsOf(outcome.roster)).size).toBe(3)
      expect(outcome.roster.entities).toHaveLength(3)
    }),
  )

  it.effect(
    'REGRESSION: the repair does not re-mint the very collision it exists to remove',
    () =>
      Effect.sync(() => {
        // The near-miss docs/testing.md §3.0.1 records — 「修復関数が SIM-1 を再生産
        // していた」 — has an exact analogue here: minting needs a serial, the
        // obvious source is the saved `nextSerial`, and the saved `nextSerial`
        // is a field of the file being repaired. Trusting it means a save that
        // says 0 gets its duplicate `e:0` re-minted as `e:0`, reporting
        // `reidentified: 1` while emitting the collision.
        const outcome = normaliseRoster(
          savedRoster({
            entities: [
              { ...creeper(0), id: 'e:0' },
              { ...creeper(1), id: 'e:0' },
              { ...creeper(2), id: 'e:1' },
            ],
            // A lie, and the kind of lie a truncated save tells.
            nextSerial: 0,
          }),
        )

        expect(idsOf(outcome.roster)).toStrictEqual(['e:0', 'e:2', 'e:1'])
        expect(new Set(idsOf(outcome.roster)).size).toBe(3)
        expect(outcome.reidentified).toBe(1)
      }),
  )

  it.effect('the counter ends up above every minted serial, whatever the field said', () =>
    Effect.sync(() => {
      expect(
        normaliseRoster(savedRoster({ entities: [{ ...creeper(0), id: 'e:41' }], nextSerial: 0 })).roster.nextSerial,
      ).toBe(42)

      // A saved counter AHEAD of the ids is honoured: serials 0..40 may belong to
      // mobs this save despawned, and reissuing one would name a mob a renderer
      // or a peer still remembers.
      expect(
        normaliseRoster(savedRoster({ entities: [{ ...creeper(0), id: 'e:1' }], nextSerial: 99 })).roster.nextSerial,
      ).toBe(99)

      // A counter that is not a counter.
      expect(
        normaliseRoster(savedRoster({ entities: [], nextSerial: Number.NaN })).roster.nextSerial,
      ).toBe(0)
      expect(
        normaliseRoster(savedRoster({ entities: [], nextSerial: -7 })).roster.nextSerial,
      ).toBe(0)
      expect(
        normaliseRoster(savedRoster({ entities: [], nextSerial: 1.5 })).roster.nextSerial,
      ).toBe(0)
    }),
  )

  it.effect('a repaired roster is a FIXED POINT — repairing it again reports nothing', () =>
    Effect.sync(() => {
      const once = normaliseRoster(
        savedRoster({
          entities: [
            { ...creeper(0), id: 'e:0' },
            { ...creeper(1), id: 'e:0' },
            { id: 'e:5', kind: '', feetPosition: undefined, healthPoints: Number.NaN, behaviour: DORMANT },
            { ...creeper(2), id: '' },
          ],
          nextSerial: 0,
        }),
      )
      const twice = normaliseRoster(once.roster)

      expect(once.discarded).toBe(1)
      expect(once.reidentified).toBe(2)
      expect(twice.discarded).toBe(0)
      expect(twice.reidentified).toBe(0)
      expect(twice.roster).toStrictEqual(once.roster)
    }),
  )

  it.effect('spawning onto a repaired roster cannot collide with anything the save brought back', () =>
    Effect.sync(() => {
      const loaded = normaliseRoster(
        savedRoster({ entities: [{ ...creeper(0), id: 'e:0' }, { ...creeper(1), id: 'e:9' }], nextSerial: 0 }),
      ).roster
      const spawned = spawnEntity(loaded, creeper(2))

      expect(spawned.entity.id).toBe('e:10')
      expect(new Set(idsOf(spawned.roster)).size).toBe(3)
    }),
  )

  it.effect('the behaviour is passed through untouched when the host supplies no repair', () =>
    Effect.sync(() => {
      // mc-sim cannot check a claim about a type it is built not to know. A host
      // with nothing to repair supplies nothing, and the value it saved is the
      // value it gets back — the SAME object.
      const fuse: Fuse = { _tag: 'Lit', burnedSecs: 1.2 }
      const outcome = normaliseRoster(
        savedRoster({ entities: [{ ...creeper(0, fuse), id: 'e:0' }], nextSerial: 1 }),
      )

      expect(outcome.roster.entities[0]?.behaviour).toBe(fuse)
    }),
  )

  it.effect('a host repair sees the kind, which is how per-kind state gets repaired at all', () =>
    Effect.sync(() => {
      // mc-sim delegates rather than guesses: the party that instantiated the
      // parameter is the only one that can say what a `Fuse` from another build
      // should become.
      const seen: Array<string> = []
      const outcome = normaliseRoster<Fuse>(
        savedRoster({
          entities: [
            { ...creeper(0), id: 'e:0', behaviour: { _tag: 'Nonsense' } },
            { ...creeper(1), id: 'e:1', kind: 'zombie', behaviour: DORMANT },
          ],
          nextSerial: 2,
        }),
        (kind, behaviour) => {
          seen.push(kind)
          return kind === 'creeper' && behaviour._tag !== 'Dormant' && behaviour._tag !== 'Lit' && behaviour._tag !== 'Detonated'
            ? DORMANT
            : behaviour
        },
      )

      expect(seen).toStrictEqual(['creeper', 'zombie'])
      expect(outcome.roster.entities[0]?.behaviour).toBe(DORMANT)
    }),
  )
})

describe('the shape mx-gameplay is waiting for', () => {
  /**
   * The creeper fuse rule, reproduced from
   * `mx-gameplay/domain/mob/creeper-fuse.ts` closely enough to drive a sweep.
   *
   * This is NOT a second implementation of the rule and must never become one —
   * it is a stand-in for a function this repository cannot import, present so
   * that the roster is exercised in the shape `gameplay:entities` will use it.
   * The constants are that file's (3 blocks, 1.5 seconds, overshoot detonates).
   */
  const stepFuse = (fuse: Fuse, distance: number | undefined, dt: number): { fuse: Fuse; explosion: 'creeper' | undefined } => {
    const inRange = distance !== undefined && distance <= 3
    if (fuse._tag === 'Detonated') {
      return { fuse, explosion: undefined }
    }
    if (!inRange) {
      return { fuse: fuse._tag === 'Lit' ? DORMANT : fuse, explosion: undefined }
    }
    const burnedSecs = (fuse._tag === 'Lit' ? fuse.burnedSecs : 0) + dt
    return burnedSecs < 1.5
      ? { fuse: { _tag: 'Lit', burnedSecs }, explosion: undefined }
      : { fuse: { _tag: 'Detonated' }, explosion: 'creeper' }
  }

  it.effect('a frame of gameplay:entities is one sweep, and the explosion comes out of it', () =>
    Effect.sync(() => {
      const player = position(0, 64, 0)
      const distanceTo = (entity: Entity<Fuse>) =>
        Math.hypot(entity.feetPosition.x - player.x, entity.feetPosition.y - player.y, entity.feetPosition.z - player.z)

      // One creeper next to the player, one twenty blocks away.
      let roster = spawnEntity(spawnEntity(emptyRoster<Fuse>(), creeper(1)).roster, creeper(20)).roster

      const frame = (dt: number) => {
        const outcome = sweepRoster<Fuse, 'creeper'>(roster, (entity) => {
          const step = stepFuse(entity.behaviour, distanceTo(entity), dt)
          return step.fuse === entity.behaviour
            ? { transition: UNCHANGED, emit: step.explosion }
            : { transition: changed({ ...entity, behaviour: step.fuse }), emit: step.explosion }
        })
        roster = outcome.roster
        return outcome.emitted
      }

      // Two frames of 0.75 s: the near creeper burns 0.75 then reaches 1.5.
      expect(frame(0.75)).toHaveLength(0)
      expect(roster.entities[0]?.behaviour).toStrictEqual({ _tag: 'Lit', burnedSecs: 0.75 })
      // The far one never left `Dormant`, so it is still the same object.
      expect(roster.entities[1]?.behaviour).toBe(DORMANT)

      expect(frame(0.75)).toStrictEqual(['creeper'])
      expect(roster.entities[0]?.behaviour).toStrictEqual({ _tag: 'Detonated' })

      // Terminal: no input produces a second explosion. `Detonated` is
      // `Unchanged` from the roster's point of view, so a detonated creeper
      // costs nothing per frame until the host despawns it.
      expect(frame(0.75)).toHaveLength(0)
      expect(roster.entities).toHaveLength(2)
    }),
  )
})
