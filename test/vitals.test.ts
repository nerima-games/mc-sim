import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { DeltaTimeSecs } from "@nerima-games/mc-kernel"
import {
  addExhaustion,
  addExperience,
  advanceFoodTimer,
  applyDamage,
  DEFAULT_MAX_HEALTH_POINTS,
  eat,
  experienceCostOfLevel,
  experienceLevel,
  experienceProgress,
  heal,
  isDead,
  isValidVitals,
  levelForTotalExperience,
  normaliseVitals,
  respawn,
  SPAWN_VITALS,
  totalExperienceAtLevel,
  vitalsView,
  type Vitals,
} from '../src/domain/vitals'

const withVitals = (patch: Partial<Vitals>): Vitals => ({ ...SPAWN_VITALS, ...patch })

const dt = (seconds: number): DeltaTimeSecs => DeltaTimeSecs(seconds)

/**
 * THE regression test for this module's reason to exist.
 *
 * Named after the failure. mx-gameplay's arena preview found a bare `NaN`
 * reaching `applyDamage` and recorded the consequence as finding F5: the entity
 * is PERMANENTLY IMMORTAL, because every later comparison against `NaN` is
 * false. `domain/entity.ts:244-251` carries the note on the mob side; this is
 * the player side, and the guard is `delta` in `domain/vitals.ts`.
 *
 * A green suite cannot notice this on its own — nothing throws, nothing is
 * typed wrong, and the player simply stops dying.
 */
describe('REGRESSION: a NaN blow must not make a player immortal', () => {
  it.effect('NaN damage leaves the health it found, and the player can still be killed', () =>
    Effect.sync(() => {
      const struck = applyDamage(SPAWN_VITALS, { amount: Number.NaN, cause: 'explosion' })

      expect(struck.healthPoints).toBe(20)
      expect(struck.lastDamageCause).toBeUndefined()
      expect(isDead(struck)).toBe(false)

      // The point of the test: the state is still killable afterwards.
      const killed = applyDamage(struck, { amount: 40, cause: 'lava' })
      expect(killed.healthPoints).toBe(0)
      expect(isDead(killed)).toBe(true)
    }),
  )

  it.effect('the failure it prevents: NaN health is neither alive nor dead', () =>
    Effect.sync(() => {
      // Written out so that the assertion below is about arithmetic anybody can
      // check rather than about a claim in a comment. This is what `applyDamage`
      // would produce without the guard.
      const poisoned = 20 - Number.NaN

      expect(Number.isNaN(poisoned)).toBe(true)
      expect(poisoned <= 0).toBe(false)
      expect(Math.max(0, poisoned) <= 0).toBe(false)
    }),
  )

  it.effect('an INFINITE blow still kills — an infinity has a direction, a NaN does not', () =>
    Effect.sync(() => {
      const killed = applyDamage(SPAWN_VITALS, { amount: Number.POSITIVE_INFINITY, cause: 'void' })

      expect(killed.healthPoints).toBe(0)
      expect(killed.lastDamageCause).toBe('void')
    }),
  )

  it.effect('a NaN exhaustion charge does not move the hunger bar', () =>
    Effect.sync(() => {
      expect(addExhaustion(SPAWN_VITALS, Number.NaN)).toBe(SPAWN_VITALS)
    }),
  )

  it.effect('a NaN experience award does not move the level', () =>
    Effect.sync(() => {
      const awarded = addExperience(withVitals({ totalExperience: 100 }), Number.NaN)

      expect(awarded.totalExperience).toBe(100)
      expect(experienceLevel(awarded)).toBe(experienceLevel(withVitals({ totalExperience: 100 })))
    }),
  )
})

describe('damage and the cause it carries', () => {
  it.effect('the cause is recorded only on the killing blow', () =>
    Effect.sync(() => {
      const hurt = applyDamage(SPAWN_VITALS, { amount: 5, cause: 'fall' })
      expect(hurt.healthPoints).toBe(15)
      expect(hurt.lastDamageCause).toBeUndefined()

      const killed = applyDamage(hurt, { amount: 15, cause: 'lava' })
      expect(killed.healthPoints).toBe(0)
      expect(killed.lastDamageCause).toBe('lava')
    }),
  )

  it.effect('a corpse struck again keeps the cause that killed it', () =>
    Effect.sync(() => {
      const killed = applyDamage(SPAWN_VITALS, { amount: 20, cause: 'fall' })
      const struckAgain = applyDamage(killed, { amount: 100, cause: 'explosion' })

      expect(struckAgain.lastDamageCause).toBe('fall')
      expect(struckAgain).toBe(killed)
    }),
  )

  it.effect('mc-sim does not interpret the cause: any string is carried verbatim', () =>
    Effect.sync(() => {
      // The point of `DamageCause = string`. mx-gameplay owns the roster of
      // eleven; mc-sim must carry whatever it is handed, including a member
      // added there tomorrow, without a change here.
      const killed = applyDamage(SPAWN_VITALS, { amount: 20, cause: 'sculk-shrieker' })

      expect(killed.lastDamageCause).toBe('sculk-shrieker')
    }),
  )

  it.effect('negative damage does not heal — the healing path is the healing path', () =>
    Effect.sync(() => {
      const hurt = applyDamage(SPAWN_VITALS, { amount: 5, cause: 'fall' })

      expect(applyDamage(hurt, { amount: -100, cause: 'fall' })).toBe(hurt)
    }),
  )

  it.effect('healing stops at the maximum and never revives the dead', () =>
    Effect.sync(() => {
      const hurt = applyDamage(SPAWN_VITALS, { amount: 12, cause: 'fall' })
      expect(heal(hurt, 100).healthPoints).toBe(20)

      const killed = applyDamage(SPAWN_VITALS, { amount: 20, cause: 'fall' })
      expect(heal(killed, 10)).toBe(killed)
      expect(isDead(heal(killed, 10))).toBe(true)
    }),
  )
})

describe('hunger: saturation, exhaustion and the cascade', () => {
  it.effect('four exhaustion spends one saturation, not one hunger point', () =>
    Effect.sync(() => {
      // EXHAUSTION_PER_POINT is 4 (hunger-service.config.ts:11). Asserted as a
      // literal per docs/testing.md §4.6.
      const worn = addExhaustion(SPAWN_VITALS, 4)

      expect(worn.saturation).toBe(4)
      expect(worn.hungerPoints).toBe(20)
      expect(worn.exhaustion).toBe(0)
    }),
  )

  it.effect('the hunger bar only moves once the reserve is gone', () =>
    Effect.sync(() => {
      // Spawn saturation is 5 (hunger-service.config.ts:7), so 5 * 4 = 20
      // exhaustion empties the reserve exactly, and the next 4 takes a shank.
      const drained = addExhaustion(SPAWN_VITALS, 20)
      expect(drained.saturation).toBe(0)
      expect(drained.hungerPoints).toBe(20)

      const hungry = addExhaustion(drained, 4)
      expect(hungry.hungerPoints).toBe(19)
    }),
  )

  it.effect('the remainder stays in the accumulator rather than being rounded away', () =>
    Effect.sync(() => {
      const worn = addExhaustion(SPAWN_VITALS, 4.5)

      expect(worn.saturation).toBe(4)
      expect(worn.exhaustion).toBeCloseTo(0.5, 12)
    }),
  )

  it.effect('an INFINITE charge terminates and drains at most the stored bound', () =>
    Effect.sync(() => {
      // The reference's `cascadeRaw` recurses on `exhaustion - 4`, and
      // `Infinity - 4` is `Infinity`. Clamping into [0, MAX_EXHAUSTION] before
      // the loop is what bounds it here.
      const worn = addExhaustion(SPAWN_VITALS, Number.POSITIVE_INFINITY)

      expect(worn.exhaustion).toBe(0)
      expect(worn.saturation).toBe(0)
      expect(worn.hungerPoints).toBe(15)
    }),
  )

  it.effect('eating caps the reserve at the bar it sits behind', () =>
    Effect.sync(() => {
      // player-hunger.ts:14-25: saturation may never exceed foodLevel.
      const starving = withVitals({ hungerPoints: 0, saturation: 0 })
      const fed = eat(starving, 6, 1.2)

      expect(fed.hungerPoints).toBe(6)
      expect(fed.saturation).toBe(6)
    }),
  )

  it.effect('the saturation term is food * modifier * 2, as in the reference', () =>
    Effect.sync(() => {
      // player-hunger-resolution.ts:52. Bread is 5 food, modifier 0.6, so the
      // reserve gains 6 — which the cap above would hide if the bar were low.
      const peckish = withVitals({ hungerPoints: 10, saturation: 0 })
      const fed = eat(peckish, 5, 0.6)

      expect(fed.hungerPoints).toBe(15)
      expect(fed.saturation).toBe(6)
    }),
  )
})

/**
 * THE regression test for the tick-rate transcription trap.
 *
 * The reference stores 80 and means four seconds, because it runs at 20 ticks
 * per second. mc-sim runs at 60. Carrying the 80 across would triple the hunger
 * rate while looking like a faithful port, and no test that asserted `80 === 80`
 * would notice.
 */
describe('REGRESSION: the food tick is FOUR SECONDS, not eighty of mc-sim ticks', () => {
  it.effect('a tick fires after 4 s of supplied delta and not before', () =>
    Effect.sync(() => {
      // Nothing at 3.9 s.
      const [early, waiting] = advanceFoodTimer(withVitals({ healthPoints: 10 }), dt(3.9))
      expect(early).toBe('none')
      expect(waiting.foodTimerSecs).toBeCloseTo(3.9, 12)

      const [fired] = advanceFoodTimer(waiting, dt(0.1))
      expect(fired).toBe('regen')
    }),
  )

  it.effect('eighty mc-sim ticks is 1.333 s and must NOT fire a tick', () =>
    Effect.sync(() => {
      // 80 / TICKS_PER_SECOND, with TICKS_PER_SECOND being 60 here rather than
      // the reference's 20. If someone "restores" the reference's constant this
      // goes red.
      const [signal] = advanceFoodTimer(withVitals({ healthPoints: 10 }), dt(80 / 60))

      expect(signal).toBe('none')
    }),
  )
})

describe('the food tick reports, and applies nothing', () => {
  it.effect('a full-health player never regenerates, however well fed', () =>
    Effect.sync(() => {
      const [signal, after] = advanceFoodTimer(SPAWN_VITALS, dt(4))

      expect(signal).toBe('none')
      // And the exhaustion of a regen it did not perform was not charged.
      expect(after.saturation).toBe(5)
      expect(after.exhaustion).toBe(0)
    }),
  )

  it.effect('a regenerating tick charges exhaustion but heals nobody', () =>
    Effect.sync(() => {
      const hurt = withVitals({ healthPoints: 10 })
      const [signal, after] = advanceFoodTimer(hurt, dt(4))

      expect(signal).toBe('regen')
      // EXHAUSTION_PER_REGEN is 6, so one saturation is spent and 2 is left over.
      expect(after.saturation).toBe(4)
      expect(after.exhaustion).toBeCloseTo(2, 12)
      // The heal itself is the CALLER's. This module knows no healing amount.
      expect(after.healthPoints).toBe(10)
    }),
  )

  it.effect('an empty bar signals starvation and does no damage', () =>
    Effect.sync(() => {
      const starving = withVitals({ healthPoints: 10, hungerPoints: 0, saturation: 0 })
      const [signal, after] = advanceFoodTimer(starving, dt(4))

      expect(signal).toBe('starve')
      expect(after.healthPoints).toBe(10)
    }),
  )

  it.effect('a hunger of 17 regenerates nothing: the threshold is 18', () =>
    Effect.sync(() => {
      // hunger-service.config.ts:17. A literal, per docs/testing.md §4.6.
      const [below] = advanceFoodTimer(withVitals({ healthPoints: 10, hungerPoints: 17 }), dt(4))
      const [at] = advanceFoodTimer(withVitals({ healthPoints: 10, hungerPoints: 18 }), dt(4))

      expect(below).toBe('none')
      expect(at).toBe('regen')
    }),
  )

  it.effect('at most one tick fires per call, and the REMAINDER is what is kept', () =>
    Effect.sync(() => {
      // 10 s is two whole periods and a remainder. One tick fires and the
      // second period is discarded rather than being carried, so the timer is
      // left below its own period — the invariant `isValidVitals` asserts, and
      // the same "run slow rather than wrong" trade the frame-delta clamp makes.
      const [signal, after] = advanceFoodTimer(withVitals({ healthPoints: 10 }), dt(10))

      expect(signal).toBe('regen')
      expect(after.foodTimerSecs).toBeCloseTo(2, 12)
      expect(isValidVitals(after)).toBe(true)
    }),
  )

  it.effect('a delta with no magnitude leaves the timer alone', () =>
    Effect.sync(() => {
      // `DeltaTimeSecs` refuses NaN at construction, so this is the shape that
      // arrives across a version boundary rather than one this repository can
      // build. The guard exists for that boundary, exactly as
      // `normaliseTimeState`'s does.
      const [signal, after] = advanceFoodTimer(SPAWN_VITALS, Number.NaN as DeltaTimeSecs)

      expect(signal).toBe('none')
      expect(after.foodTimerSecs).toBe(0)
    }),
  )
})

/**
 * THE regression test for the levelling curve.
 *
 * The closed form in `totalExperienceAtLevel` is a derivation, and a derivation
 * nobody checks is an invented constant with extra steps. This asserts it
 * against a literal accumulation of `experienceCostOfLevel`, which is the
 * transcription of the reference's own three-piece rule.
 */
describe('REGRESSION: the XP curve is the reference curve, and its closed form is the sum of it', () => {
  it.effect('the three pieces are the reference’s, at every boundary', () =>
    Effect.sync(() => {
      // player-xp-calc.ts:9-13. Literals, per docs/testing.md §4.6.
      expect(experienceCostOfLevel(0)).toBe(7)
      expect(experienceCostOfLevel(15)).toBe(37)
      expect(experienceCostOfLevel(16)).toBe(42)
      expect(experienceCostOfLevel(30)).toBe(112)
      expect(experienceCostOfLevel(31)).toBe(121)
      expect(experienceCostOfLevel(40)).toBe(202)
    }),
  )

  it.effect('the closed form equals the running sum for every level up to 400', () =>
    Effect.sync(() => {
      let accumulated = 0
      for (let level = 0; level <= 400; level++) {
        expect(totalExperienceAtLevel(level)).toBe(accumulated)
        accumulated += experienceCostOfLevel(level)
      }
    }),
  )

  it.effect('the level a total buys agrees with counting up, over the whole range', () =>
    Effect.sync(() => {
      // The reference finds the level by accumulating costs until it overshoots
      // (player-xp-calc.ts:15-25). Bisection must give the same answers.
      let accumulated = 0
      for (let level = 0; level < 120; level++) {
        const cost = experienceCostOfLevel(level)
        expect(levelForTotalExperience(accumulated)).toBe(level)
        expect(levelForTotalExperience(accumulated + cost - 1)).toBe(level)
        accumulated += cost
      }
    }),
  )
})

/**
 * THE regression test for the hang.
 *
 * `levelFromXP` in the reference is `while (true)` with an `accumulated + cost >
 * totalXP` break. Every comparison against `NaN` is false and every comparison
 * against `Infinity` is false, so both inputs loop forever — no error, no
 * output, a frozen frame loop. A save file is all it takes.
 *
 * If the guard in `levelForTotalExperience` is removed, this test does not fail
 * with a wrong number: it hangs, and vitest's 10 s timeout turns it red.
 */
describe('REGRESSION: a non-finite experience total must not hang the level lookup', () => {
  it.effect('Infinity and NaN both answer, and answer 0', () =>
    Effect.sync(() => {
      expect(levelForTotalExperience(Number.POSITIVE_INFINITY)).toBe(0)
      expect(levelForTotalExperience(Number.NaN)).toBe(0)
      expect(levelForTotalExperience(Number.NEGATIVE_INFINITY)).toBe(0)
    }),
  )

  it.effect('an enormous but finite total answers without counting to it', () =>
    Effect.sync(() => {
      // The reference's linear scan would need ~1.5e7 iterations for this one.
      const level = levelForTotalExperience(1e15)

      expect(Number.isFinite(level)).toBe(true)
      expect(level).toBeGreaterThan(0)
      expect(totalExperienceAtLevel(level)).toBeLessThanOrEqual(1e15)
      expect(totalExperienceAtLevel(level + 1)).toBeGreaterThan(1e15)
    }),
  )
})

describe('experience as the HUD reads it', () => {
  it.effect('7 XP is exactly level 1 with an empty bar', () =>
    Effect.sync(() => {
      const levelled = withVitals({ totalExperience: 7 })

      expect(experienceLevel(levelled)).toBe(1)
      expect(experienceProgress(levelled)).toBe(0)
    }),
  )

  it.effect('the bar fills within a level and resets at the boundary', () =>
    Effect.sync(() => {
      // Level 1 costs 9 (2*1+7), so 7 + 4 is a bar a bit under half.
      const midway = withVitals({ totalExperience: 11 })
      expect(experienceLevel(midway)).toBe(1)
      expect(experienceProgress(midway)).toBeCloseTo(4 / 9, 12)

      const next = withVitals({ totalExperience: 16 })
      expect(experienceLevel(next)).toBe(2)
      expect(experienceProgress(next)).toBe(0)
    }),
  )

  it.effect('spending experience floors at zero rather than going negative', () =>
    Effect.sync(() => {
      const spent = addExperience(withVitals({ totalExperience: 30 }), -100)

      expect(spent.totalExperience).toBe(0)
      expect(experienceLevel(spent)).toBe(0)
    }),
  )
})

describe('respawn keeps what a rule owns', () => {
  it.effect('health and hunger return, experience does NOT', () =>
    Effect.sync(() => {
      const killed = applyDamage(
        withVitals({ totalExperience: 400, hungerPoints: 3, saturation: 0, exhaustion: 3 }),
        { amount: 20, cause: 'starvation' },
      )
      const alive = respawn(killed)

      expect(alive.healthPoints).toBe(20)
      expect(alive.hungerPoints).toBe(20)
      expect(alive.saturation).toBe(5)
      expect(alive.exhaustion).toBe(0)
      expect(alive.lastDamageCause).toBeUndefined()
      // The XP penalty is a rule, and a rule mc-sim applied here would be one
      // mx-gameplay could neither see nor change.
      expect(alive.totalExperience).toBe(400)
    }),
  )

  it.effect('a maximum a rule moved survives the respawn', () =>
    Effect.sync(() => {
      const buffed = withVitals({ maxHealthPoints: 30, healthPoints: 0 })

      expect(respawn(buffed).healthPoints).toBe(30)
      expect(respawn(buffed).maxHealthPoints).toBe(30)
    }),
  )
})

/**
 * THE regression test for the repair order.
 *
 * Repairing each field against the value it is bounded by only works if the
 * bound has already been repaired. A save whose MAXIMUM is the broken field is
 * the case that separates the two arrangements, and it produces a state that
 * satisfies every per-field bound while violating the cross-field one — the
 * exact shape `PlayerHealthInvariant` (player-health.ts:13-20) exists to catch
 * in the reference, and which a schema can only reject, never repair.
 */
describe('REGRESSION: a broken maximum must not drag a legal current value out of range', () => {
  it.effect('health is clamped against the REPAIRED maximum, not the one on disk', () =>
    Effect.sync(() => {
      const fromDisk = withVitals({
        healthPoints: 20,
        maxHealthPoints: Number.NaN,
      })
      const repaired = normaliseVitals(fromDisk)

      expect(repaired.maxHealthPoints).toBe(20)
      expect(repaired.healthPoints).toBe(20)
      expect(isValidVitals(repaired)).toBe(true)
    }),
  )

  it.effect('saturation is clamped against the REPAIRED hunger, not the one on disk', () =>
    Effect.sync(() => {
      const repaired = normaliseVitals(withVitals({ hungerPoints: 4, saturation: 19 }))

      expect(repaired.hungerPoints).toBe(4)
      expect(repaired.saturation).toBe(4)
      expect(isValidVitals(repaired)).toBe(true)
    }),
  )

  it.effect('a shrunken maximum pulls the current value down with it', () =>
    Effect.sync(() => {
      const repaired = normaliseVitals(withVitals({ healthPoints: 20, maxHealthPoints: 6 }))

      expect(repaired.maxHealthPoints).toBe(6)
      expect(repaired.healthPoints).toBe(6)
    }),
  )
})

/**
 * THE two regression tests the PREVIEW found, and neither test above did.
 *
 * `pnpm preview --once --ascii --scenario vitals` restores a corrupt save at
 * f500 and draws the result. The repair was total, `isValidVitals` accepted
 * what came out, and every assertion in this file passed — while the screen
 * read `hunger 99.0/9007199254740991` and `exhaustion 40.000/4`. Both are
 * states no transition in this module can produce, and both were reachable
 * from a save file.
 */
describe('REGRESSION: a repaired maximum must be a number a screen can build a row from', () => {
  it.effect('an infinite maximum falls back to the default, not to MAX_SAFE_INTEGER', () =>
    Effect.sync(() => {
      // The bound an infinity "points at" is 9007199254740991, and mx-ui builds
      // one icon per two points with `Array.from` — so that bound is not a
      // longer row, it is no row. An infinite maximum states no magnitude a row
      // can be built from, which puts it with the values that have none.
      const repaired = normaliseVitals(
        withVitals({
          maxHungerPoints: Number.POSITIVE_INFINITY,
          hungerPoints: 99,
          maxHealthPoints: Number.POSITIVE_INFINITY,
        }),
      )

      expect(repaired.maxHungerPoints).toBe(20)
      expect(repaired.hungerPoints).toBe(20)
      expect(repaired.maxHealthPoints).toBe(20)
    }),
  )

  it.effect('an infinite experience total becomes zero, not level 44,739,260', () =>
    Effect.sync(() => {
      // Clamping to the bound it points at made a corrupt save read as a level
      // nobody awarded and nobody can explain. `normaliseTimeState` sends a
      // non-finite tick counter to 0 on the same reasoning.
      const repaired = normaliseVitals(withVitals({ totalExperience: Number.POSITIVE_INFINITY }))

      expect(repaired.totalExperience).toBe(0)
      expect(experienceLevel(repaired)).toBe(0)
    }),
  )

  it.effect('a large but FINITE maximum is left alone: what is legitimate is a rule', () =>
    Effect.sync(() => {
      // `domain/entity.ts` holds no per-kind maximum for exactly this reason.
      // An attribute modifier setting 30 is not corruption, and a repair that
      // knew better would be mc-sim deciding what a player is.
      expect(normaliseVitals(withVitals({ maxHealthPoints: 30 })).maxHealthPoints).toBe(30)
    }),
  )
})

describe('REGRESSION: a restored accumulator must not sit above its own threshold', () => {
  it.effect('a stored exhaustion of 40 settles to the remainder the cascade would leave', () =>
    Effect.sync(() => {
      // Left at 40 it made the NEXT 0.01 of sprinting spend ten hunger points
      // in one call — a save file turning a step into a famine. 40 is ten whole
      // periods, so the remainder is 0.
      const repaired = normaliseVitals(withVitals({ exhaustion: 40 }))

      expect(repaired.exhaustion).toBe(0)
      expect(repaired.hungerPoints).toBe(20)
      expect(isValidVitals(repaired)).toBe(true)

      // And the settled state behaves like one this module produced.
      expect(addExhaustion(repaired, 0.01).hungerPoints).toBe(20)
    }),
  )

  it.effect('the remainder is kept rather than zeroed', () =>
    Effect.sync(() => {
      // A repair, not a reset: 9 is two periods and a remainder of 1, and 1 is
      // what `cascade(9)` would have left behind.
      expect(normaliseVitals(withVitals({ exhaustion: 9 })).exhaustion).toBe(1)
      expect(normaliseVitals(withVitals({ foodTimerSecs: 11 })).foodTimerSecs).toBe(3)
    }),
  )

  it.effect('the repair does NOT charge hunger for the periods it discards', () =>
    Effect.sync(() => {
      // Running the real cascade here would charge a player ten shanks for
      // opening their save, which is the failure in the other direction.
      expect(normaliseVitals(withVitals({ exhaustion: 40 })).hungerPoints).toBe(20)
      expect(normaliseVitals(withVitals({ exhaustion: 40 })).saturation).toBe(5)
    }),
  )
})

describe('normaliseVitals is total over what a save can contain', () => {
  it.effect('every malformed shape produces a state isValidVitals accepts', () =>
    Effect.sync(() => {
      const malformed: ReadonlyArray<Vitals> = [
        withVitals({ healthPoints: Number.NaN }),
        withVitals({ healthPoints: Number.POSITIVE_INFINITY }),
        withVitals({ healthPoints: -12 }),
        withVitals({ maxHealthPoints: 0 }),
        withVitals({ maxHealthPoints: Number.NEGATIVE_INFINITY }),
        withVitals({ exhaustion: 1e9 }),
        withVitals({ foodTimerSecs: Number.NaN }),
        withVitals({ totalExperience: Number.POSITIVE_INFINITY }),
        // The shapes a version boundary really delivers: fields that satisfy
        // `number` at the type level and are not numbers at runtime.
        { ...SPAWN_VITALS, healthPoints: undefined as unknown as number },
        { ...SPAWN_VITALS, maxHungerPoints: null as unknown as number },
        { ...SPAWN_VITALS, saturation: '5' as unknown as number },
        { ...SPAWN_VITALS, lastDamageCause: 7 as unknown as string },
      ]

      for (const state of malformed) {
        expect(isValidVitals(normaliseVitals(state))).toBe(true)
      }
    }),
  )

  it.effect('a null maximum falls back to the default rather than clamping to the minimum', () =>
    Effect.sync(() => {
      // `Math.min(20, null)` is 0. Deciding on the value BEFORE any arithmetic
      // can coerce it is what keeps `null` and a genuine 0 distinguishable —
      // `normaliseTimeState` makes the same note about `null / 60`.
      const repaired = normaliseVitals({
        ...SPAWN_VITALS,
        maxHealthPoints: null as unknown as number,
      })

      expect(repaired.maxHealthPoints).toBe(DEFAULT_MAX_HEALTH_POINTS)
    }),
  )

  it.effect('a finite experience total survives the load path untouched', () =>
    Effect.sync(() => {
      // Only the broken fields move. A total somebody earned is not one of them.
      const repaired = normaliseVitals(withVitals({ totalExperience: 1_000_000 }))

      expect(repaired.totalExperience).toBe(1_000_000)
      expect(experienceLevel(repaired)).toBeGreaterThan(0)
    }),
  )
})

describe('vitalsView produces what mx-ui’s VitalsSnapshot needs', () => {
  it.effect('the six field names are mx-ui’s, spelled the same way', () =>
    Effect.sync(() => {
      // mx-ui/domain/hud-view-model.ts declares VitalsSnapshot with these names.
      // If a rename happens on either side, this list is where it is noticed.
      expect(Object.keys(vitalsView(SPAWN_VITALS)).sort()).toEqual([
        'experienceLevel',
        'experienceProgress',
        'healthPoints',
        'hungerPoints',
        'maxHealthPoints',
        'maxHungerPoints',
      ])
    }),
  )

  it.effect('a spawned player projects to a full row of both bars and no experience', () =>
    Effect.sync(() => {
      expect(vitalsView(SPAWN_VITALS)).toEqual({
        healthPoints: 20,
        maxHealthPoints: 20,
        hungerPoints: 20,
        maxHungerPoints: 20,
        experienceLevel: 0,
        experienceProgress: 0,
      })
    }),
  )

  it.effect('nineteen health is what mx-ui turns into nine hearts and a half', () =>
    Effect.sync(() => {
      // mx-ui's `iconRow` half-heart rule is what reads this. The value carried
      // across is the odd point, and this asserts mc-sim can produce one.
      const view = vitalsView(applyDamage(SPAWN_VITALS, { amount: 1, cause: 'fall' }))

      expect(view.healthPoints).toBe(19)
      expect(view.maxHealthPoints).toBe(20)
    }),
  )

  it.effect('the view does NOT clamp: mx-ui owns that decision, and owns it alone', () =>
    Effect.sync(() => {
      // A state that bypassed the load path projects verbatim. mx-ui's clamp
      // sends it to a drawable row; a second clamp here would mean two
      // repositories each held half of one decision.
      const bypassed: Vitals = { ...SPAWN_VITALS, healthPoints: 99 }

      expect(vitalsView(bypassed).healthPoints).toBe(99)
    }),
  )
})
