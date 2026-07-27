/**
 * The player's vitals: health, hunger and experience as NUMBERS and TRANSITIONS.
 *
 * docs/responsibility.md §2 gives this row its scope and, in the same line, its
 * boundary:
 *
 *   > 体力 / 空腹 / XP | 数値状態と遷移（「何がダメージを与えるか」は持たない）
 *
 * ---------------------------------------------------------------------------
 * The boundary, which is the whole design
 * ---------------------------------------------------------------------------
 *
 * A creeper blast, a four-block fall, lava, starvation: every one of those is a
 * RULE about the world, and mx-gameplay owns rules (plan.md §2.3-1). This module
 * therefore takes an AMOUNT and a CAUSE IT DOES NOT INTERPRET, and answers with
 * a new state. There is no table of damage values here, no fall-distance
 * arithmetic, no list of what burns, and no branch on the cause — `DamageCause`
 * is a bare `string` precisely so that mc-sim can carry mx-gameplay's
 * `DeathCause` without mirroring its eleven members and thereby becoming a
 * second owner of the roster of things that can kill a player.
 *
 * The same cut runs through hunger, and it is the less obvious half:
 *
 *   - `exhaustion` and `saturation` are NUMBERS that persist across frames and
 *     across saves, and the cascade between them (four exhaustion spends one
 *     saturation, or one hunger point when the reserve is empty) is a TRANSITION
 *     over those numbers. Both are here.
 *   - The COST TABLE — sprinting costs 0.1 per block, a jump 0.05, an attack 0.1
 *     (ts-minecraft/packages/entity/application/hunger-service.config.ts:20-25)
 *     — answers 「何が消耗させるか」, which is 「何がダメージを与えるか」 with a
 *     different verb. It is NOT here. `addExhaustion` takes an amount the rules
 *     tier computed, exactly as `applyDamage` takes one.
 *
 * `advanceFoodTimer` therefore RETURNS A SIGNAL rather than healing or hurting
 * anybody. How much a starving player loses per tick, and how much a fed one
 * regains, are damage and healing amounts, and this module does not know any.
 * The reference draws the line in the same place — its `HungerService.tick`
 * returns a `HungerTickEffect`「for the caller to apply to HealthService」
 * (ts-minecraft/packages/entity/application/hunger-service.ts:60-62) — with the
 * difference that there the caller was in the same package, and here it is in
 * another repository that mc-sim cannot see.
 *
 * ---------------------------------------------------------------------------
 * What a non-finite input does, and why the two answers differ
 * ---------------------------------------------------------------------------
 *
 * There are two kinds of number crossing into this module and they get opposite
 * treatment, for reasons this repository has already paid for twice.
 *
 * A DELTA — a damage amount, an exhaustion charge, an XP award — that is `NaN`
 * is IGNORED. The state does not move. `Math.max(0, 20 - NaN)` is `NaN`, and
 * `NaN <= 0` is false, so a single `NaN` blow leaves a player who can never die
 * and whose heart row can never be drawn: mx-gameplay's arena preview measured
 * exactly this and recorded it as finding F5 (`domain/entity.ts:244-251` carries
 * the note on the mob side). An ignored blow is a blow that did nothing, which
 * is survivable and visible; a `NaN` blow is permanent immortality, which is
 * neither. `addExhaustionToHunger` in the reference makes the same choice for
 * the same reason (player-hunger-resolution.ts:36-42) — there the failure mode
 * was an infinite recursion rather than an immortal player.
 *
 * An INFINITY is NOT such a value: it has a direction, and the clamps below
 * carry it to the bound it points at. `domain/time-of-day.ts`'s
 * `clampDayLengthSecs` states the same rule in the same words. So infinite
 * damage kills and infinite healing fills, and only `NaN` is refused.
 *
 * A STATE — a whole `Vitals` arriving from a save file — is REPAIRED rather than
 * refused, by `normaliseVitals`, exactly as `normaliseTimeState` repairs a
 * `TimeState`. The world-load path has no error channel to report into, and
 * failing a load over a recoverable field turns a repairable save into an
 * unopenable one.
 *
 * ---------------------------------------------------------------------------
 * Why the player's vitals are not an entry in the entity roster
 * ---------------------------------------------------------------------------
 *
 * `domain/entity.ts` already holds a `healthPoints` per entity, and deliberately
 * holds NO maximum: 「kind ごとの定数はルール層のものであり、その表をミラーすれば
 * mc-sim が「クリーパーとは何か」を知ることになる」(docs/responsibility.md §3.1).
 * That argument is about a TABLE OF KINDS, and the player is not a row in one:
 * there is exactly one player, mx-ui's `VitalsSnapshot` requires a
 * `maxHealthPoints` to know how many hearts to draw, and hunger and experience
 * exist for nobody else. Putting them in the roster would give every creeper a
 * saturation field.
 */
import type { DeltaTimeSecs } from './kernel-vocabulary'

// ---------------------------------------------------------------------------
// Constants, each with the measurement it came from
// ---------------------------------------------------------------------------

/** ts-minecraft/packages/entity/application/health-service.config.ts:21. */
export const DEFAULT_MAX_HEALTH_POINTS = 20

/** ts-minecraft/packages/entity/application/hunger-service.config.ts:3. */
export const DEFAULT_MAX_HUNGER_POINTS = 20

/**
 * Saturation a freshly spawned player carries.
 * ts-minecraft/packages/entity/application/hunger-service.config.ts:7
 * (`START_SATURATION = 5`, against a full food bar).
 */
export const SPAWN_SATURATION = 5

/**
 * Exhaustion that spends one point of the reserve.
 * ts-minecraft/packages/entity/application/hunger-service.config.ts:11
 * (「Vanilla threshold is 4.0」).
 */
export const EXHAUSTION_PER_POINT = 4

/**
 * The largest accumulator the cascade will work through in one call.
 *
 * ts-minecraft/packages/entity/domain/player-hunger.ts:11 bounds the field to
 * [0, 40], and that is where the number comes from. Here it is a LOOP BOUND
 * rather than a storage bound: `cascade` clamps its input to this before
 * iterating, which caps the loop at ten passes whatever arrives — including an
 * infinity, on which the reference's recursive version does not terminate.
 *
 * It is NOT the bound a stored exhaustion satisfies. Every transition here
 * leaves the accumulator strictly below `EXHAUSTION_PER_POINT`, and
 * `isValidVitals` asserts that tighter fact; the looser one let a restored 40
 * sit above the threshold, which the preview caught.
 */
export const MAX_EXHAUSTION = 40

/**
 * SECONDS between food ticks. FOUR, and NOT the reference's 80.
 *
 * The reference stores `FOOD_TICK_INTERVAL = 80` and its comment states the
 * measurement: 「80 ticks = 4 s at 20 t/s」
 * (ts-minecraft/packages/entity/application/hunger-service.config.ts:13-15).
 * **mc-sim runs at sixty ticks per second**, not twenty
 * (`domain/time-of-day.ts`'s `TICKS_PER_SECOND`). Transcribing the 80 would
 * therefore make a food tick fire every 1.33 s and drain a player three times
 * too fast, while looking exactly like a faithful port.
 *
 * So the DURATION is what carries over, because the duration is what the
 * reference's comment actually measured. The timer below is in seconds and is
 * advanced by a caller-supplied delta, which keeps this module free of both the
 * tick rate and the clock.
 */
export const FOOD_TICK_SECS = 4

/**
 * Hunger at or above which a food tick signals regeneration.
 * ts-minecraft/packages/entity/application/hunger-service.config.ts:17.
 */
export const REGEN_HUNGER_THRESHOLD = 18

/**
 * Exhaustion charged by a regenerating food tick.
 * ts-minecraft/packages/entity/application/hunger-service.config.ts:28.
 *
 * THIS IS THE BORDERLINE CONSTANT of the ownership split above, and it is worth
 * naming as such. It is a cost, and costs were just argued to be mx-gameplay's.
 * It is here anyway because the ACTION it charges for is one this state machine
 * performs on itself: no rule calls "regenerate", the food timer decides it, and
 * a cost the caller cannot see the occasion for is not a cost the caller can
 * pay. The mx-gameplay-side costs are all charged for things a rule DID —
 * sprinting a block, swinging, taking a blow — and none of them is here.
 */
export const EXHAUSTION_PER_REGEN = 6

// ---------------------------------------------------------------------------
// The state
// ---------------------------------------------------------------------------

/**
 * What killed the player, as an opaque string.
 *
 * DELIBERATELY NOT A UNION. `mx-gameplay/domain/death-cause.ts` owns the roster
 * of eleven causes and the sentence each one prints, and that file's own header
 * records why the cause must survive every call boundary: an intermediate helper
 * written as `(amount: number) => …` dropped it, and every death in the
 * reference read「You died.」 Mirroring the union here would make mc-sim a second
 * owner of that roster — the exact failure `domain/kernel-vocabulary.ts`
 * describes for a narrowed `ItemType`, where the two copies disagree about
 * membership and the disagreement surfaces on the day the mirror is deleted.
 *
 * mc-sim stores the string it was handed and never reads it. A blank one is
 * stored blank: this module has no standing to judge what is a real cause, and
 * mx-gameplay's `deathMessage` already has the fallback.
 */
export type DamageCause = string

/** One application of damage. `cause` is required; that is the point of the type. */
export type Damage = {
  readonly amount: number
  readonly cause: DamageCause
}

/**
 * The whole of a player's vitals, as one value. This is what a save file holds.
 *
 * The field NAMES are mx-ui's, not new ones. `mx-ui/domain/hud-view-model.ts`
 * declares `VitalsSnapshot` with `healthPoints` / `maxHealthPoints` /
 * `hungerPoints` / `maxHungerPoints` / `experienceLevel` / `experienceProgress`,
 * and `vitalsView` below produces exactly those six from this state. A state
 * whose shape does not meet the screen's is a state that solved nothing, and
 * renaming across the boundary would put a translation layer in whichever
 * repository blinked first.
 *
 * `totalExperience` is stored and the level is DERIVED, never the other way
 * round. Storing a level plus a progress fraction gives two numbers that can
 * disagree, and the level-up arithmetic then has to keep them in step at every
 * call site; storing the total means "what level is this" has exactly one
 * answer. The reference stores all four and rebuilds them together from the
 * total on every change (player-xp-calc.ts:35-44), which is the same decision
 * with the derived fields cached.
 */
export type Vitals = {
  readonly healthPoints: number
  readonly maxHealthPoints: number
  readonly hungerPoints: number
  readonly maxHungerPoints: number
  /** The hidden reserve, drained before hunger points. Never above `hungerPoints`. */
  readonly saturation: number
  /** The accumulator the cascade spends. Always below `EXHAUSTION_PER_POINT` after any transition here. */
  readonly exhaustion: number
  /** Seconds towards the next food tick. Always below `FOOD_TICK_SECS`, for the same reason. */
  readonly foodTimerSecs: number
  /** Raw experience points. The level and the bar are derived from this alone. */
  readonly totalExperience: number
  /**
   * Written ONLY on the transition to zero health, and `undefined` while alive.
   *
   * A player who falls into lava takes fall damage and then burn damage, and the
   * message must name what actually killed them. The reference writes it as
   * `justDied ? Option.some(cause) : s.lastDeathCause`
   * (health-service.ts:82); the same condition is in `applyDamage` below.
   */
  readonly lastDamageCause: DamageCause | undefined
}

/** What a freshly created world hands a player. */
export const SPAWN_VITALS: Vitals = {
  healthPoints: DEFAULT_MAX_HEALTH_POINTS,
  maxHealthPoints: DEFAULT_MAX_HEALTH_POINTS,
  hungerPoints: DEFAULT_MAX_HUNGER_POINTS,
  maxHungerPoints: DEFAULT_MAX_HUNGER_POINTS,
  saturation: SPAWN_SATURATION,
  exhaustion: 0,
  foodTimerSecs: 0,
  totalExperience: 0,
  lastDamageCause: undefined,
}

// ---------------------------------------------------------------------------
// Totality helpers
// ---------------------------------------------------------------------------

/**
 * Does this value carry a magnitude at all?
 *
 * Character-identical to `domain/time-of-day.ts`'s helper of the same name, and
 * for the same two reasons: `Math.min` and `Math.max` PROPAGATE `NaN`, so a
 * clamp built from them is not a clamp; and the `typeof` test is not redundant
 * with the `NaN` test, because a field read from a save can be `undefined` or
 * `null` while still satisfying the declared `number` type, and `Math.min(20,
 * null)` is 0 rather than a rejection.
 */
const hasMagnitude = (value: number): boolean => typeof value === 'number' && !Number.isNaN(value)

/** Clamp into [low, high], total over every runtime value. No magnitude means `low`. */
const clamp = (value: number, low: number, high: number): number =>
  hasMagnitude(value) ? Math.max(low, Math.min(high, value)) : low

/** A delta with no magnitude is a delta of nothing. See the module header. */
const delta = (value: number): number => (hasMagnitude(value) ? value : 0)

/**
 * Bring an accumulator into [0, period), keeping the remainder.
 *
 * Used by `normaliseVitals` for the two fields that are accumulators rather than
 * quantities: exhaustion and the food timer. Both have a POSTCONDITION as well
 * as a bound — every transition in this module leaves them strictly below their
 * period — and a repair that only clamped left a restored save in a state the
 * module itself can never produce. The remainder is what the corresponding
 * transition would have left behind, so this is a repair rather than a reset;
 * a non-finite value has no remainder to keep and becomes zero.
 */
const settle = (value: number, period: number): number =>
  Number.isFinite(value) && value > 0 ? value % period : 0

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const isDead = (vitals: Vitals): boolean => vitals.healthPoints <= 0

/**
 * Apply damage, recording the cause if and only if this blow is the fatal one.
 *
 * Damage to an already-dead player is ignored, so a corpse caught in a second
 * blast does not have its death message rewritten. A NON-POSITIVE amount is
 * ignored too, and that is not the same statement: negative damage would HEAL,
 * and a heal that arrives through the damage path is a heal that skips whatever
 * the healing path is for. `heal` is the other function.
 */
export const applyDamage = (vitals: Vitals, damage: Damage): Vitals => {
  const amount = delta(damage.amount)
  if (isDead(vitals) || amount <= 0) {
    return vitals
  }

  const healthPoints = Math.max(0, vitals.healthPoints - amount)

  return {
    ...vitals,
    healthPoints,
    // `wasAlive` is not needed: the guard above already refused a dead player,
    // so reaching here with zero health IS the transition.
    lastDamageCause: healthPoints <= 0 ? damage.cause : vitals.lastDamageCause,
  }
}

/**
 * Heal, up to the maximum. A dead player is not healed.
 *
 * Refusing to heal the dead is what makes death a state rather than a reading:
 * without it a regeneration tick landing after the killing blow would quietly
 * revive a player whose death screen mx-ui had already drawn, and the two
 * repositories would disagree about whether the session ended. Respawning goes
 * through `respawn`, which is a decision somebody made.
 */
export const heal = (vitals: Vitals, amount: number): Vitals => {
  const healed = delta(amount)
  if (isDead(vitals) || healed <= 0) {
    return vitals
  }

  return {
    ...vitals,
    healthPoints: Math.min(vitals.maxHealthPoints, vitals.healthPoints + healed),
  }
}

// ---------------------------------------------------------------------------
// Hunger
// ---------------------------------------------------------------------------

/**
 * Spend accumulated exhaustion: saturation first, then hunger points.
 *
 * ITERATIVE, NOT RECURSIVE, and that is the one deliberate departure from the
 * reference's `cascadeRaw` (player-hunger-resolution.ts:10-23). That function
 * recurses once per point spent and is guarded against non-finite input by its
 * caller only — `Infinity - 4` is `Infinity`, so an unguarded infinite
 * exhaustion recurses until the stack ends. Here the accumulator is clamped into
 * [0, MAX_EXHAUSTION] before the loop runs, so the loop is bounded by
 * `MAX_EXHAUSTION / EXHAUSTION_PER_POINT` iterations whatever arrives, and the
 * guard is a property of the arithmetic rather than of every caller.
 */
const cascade = (vitals: Vitals, rawExhaustion: number): Vitals => {
  let exhaustion = clamp(rawExhaustion, 0, MAX_EXHAUSTION)
  let saturation = vitals.saturation
  let hungerPoints = vitals.hungerPoints

  while (exhaustion >= EXHAUSTION_PER_POINT) {
    exhaustion -= EXHAUSTION_PER_POINT
    if (saturation > 0) {
      saturation = Math.max(0, saturation - 1)
    } else {
      hungerPoints = Math.max(0, hungerPoints - 1)
    }
  }

  return { ...vitals, hungerPoints, saturation, exhaustion }
}

/**
 * Charge exhaustion for something the RULES TIER did.
 *
 * The amount is the caller's. mx-gameplay knows that a sprinted block costs 0.1
 * and a jump 0.05; mc-sim knows only that exhaustion accumulates and what
 * happens when it reaches four. See the module header for why that line is
 * where it is.
 */
export const addExhaustion = (vitals: Vitals, amount: number): Vitals => {
  const charged = delta(amount)
  return charged <= 0 ? vitals : cascade(vitals, vitals.exhaustion + charged)
}

/**
 * Eat. `saturationModifier` is the food's own, supplied by the caller.
 *
 * The doubling in the saturation term is the reference's
 * (player-hunger-resolution.ts:52): `saturation + food * modifier * 2`, capped
 * at the new hunger level because the reserve sits BEHIND the bar and may never
 * exceed it (player-hunger.ts:14-25 states that invariant and gives it a
 * schema). WHICH foods restore how much is a table of items, and tables of items
 * are the rules tier's — nothing here names a food.
 */
export const eat = (vitals: Vitals, foodPoints: number, saturationModifier: number): Vitals => {
  const food = delta(foodPoints)
  if (food <= 0) {
    return vitals
  }

  const hungerPoints = clamp(Math.floor(vitals.hungerPoints + food), 0, vitals.maxHungerPoints)

  return {
    ...vitals,
    hungerPoints,
    saturation: clamp(vitals.saturation + food * delta(saturationModifier) * 2, 0, hungerPoints),
  }
}

/**
 * What a food tick asks the rules tier to do. The tick itself does neither.
 *
 * `'regen'` and `'starve'` are requests for a heal and a blow whose SIZES this
 * module does not know, which is the same boundary `applyDamage` sits on. A
 * caller that wants to starve a player calls `applyDamage` with its own amount
 * and its own cause — mx-gameplay's `'starvation'`, which mc-sim never spells.
 */
export type FoodTickSignal = 'none' | 'regen' | 'starve'

/**
 * Advance the food timer by a frame's worth of seconds.
 *
 * The delta is SUPPLIED, never read: `domain/time-of-day.ts` makes the same
 * choice, and it is what lets a scenario test fast-forward an in-game hour into
 * a few microseconds. `pnpm check:deps` would reject the alternative anyway.
 *
 * `canRegen` is computed here rather than taken, because both of its inputs are
 * already in this state. The reference passes it in and its comment says why the
 * gate exists at all: 「Without the `canRegen` gate, an idle full-health
 * player's food drains for nothing — the heal is a clamped no-op, but the
 * exhaustion was still charged」 (player-hunger-resolution.ts:69-71).
 *
 * At most ONE tick fires per call even when a large delta arrives, and the timer
 * is left with the REMAINDER rather than with the surplus. A frame delta cannot
 * exceed `MAX_FRAME_DELTA_SECS` (0.05 s), so the only way to arrive here with
 * four seconds in hand is a caller that batched — and a batching caller wants
 * the world to run slow rather than to receive a burst of starvation damage it
 * cannot pace. That is the same trade `domain/frame-timing.ts` makes at its
 * upper clamp: whole periods are discarded, deliberately, and the alternative
 * (keeping the surplus) leaves a timer above its own period, which is a state
 * `isValidVitals` would have to stop asserting against and which a save could
 * then carry as "a food tick every frame, for the next quarter of a billion
 * frames".
 */
export const advanceFoodTimer = (
  vitals: Vitals,
  dt: DeltaTimeSecs,
): readonly [FoodTickSignal, Vitals] => {
  const elapsed = Math.max(0, delta(dt))
  const timer = vitals.foodTimerSecs + elapsed

  if (timer < FOOD_TICK_SECS) {
    return ['none', { ...vitals, foodTimerSecs: timer }] as const
  }

  const ticked = { ...vitals, foodTimerSecs: timer % FOOD_TICK_SECS }
  const canRegen = ticked.healthPoints > 0 && ticked.healthPoints < ticked.maxHealthPoints

  if (canRegen && ticked.hungerPoints >= REGEN_HUNGER_THRESHOLD) {
    return ['regen', addExhaustion(ticked, EXHAUSTION_PER_REGEN)] as const
  }

  return ticked.hungerPoints <= 0 ? (['starve', ticked] as const) : (['none', ticked] as const)
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

/**
 * Experience points that buy one level, at that level. VANILLA JAVA EDITION.
 *
 * Transcribed from ts-minecraft/packages/entity/domain/player-xp-calc.ts:5-13,
 * comment included:
 *
 *     // XP cost to advance one level (vanilla Java):
 *     //   Level 0-15:  cost = 2*level + 7
 *     //   Level 16-30: cost = 5*level - 38
 *     //   Level 31+:   cost = 9*level - 158
 *
 * NOTHING HERE IS INVENTED. The three pieces and their six coefficients are that
 * file's; `totalExperienceAtLevel` below is a closed form of the running sum of
 * THIS function and is pinned against a literal accumulation of it, so a
 * transcription error in either is a red test rather than a levelling curve that
 * looks plausible.
 */
export const experienceCostOfLevel = (level: number): number => {
  const at = Math.max(0, Math.floor(delta(level)))
  if (at <= 15) {
    return 2 * at + 7
  }
  return at <= 30 ? 5 * at - 38 : 9 * at - 158
}

/**
 * Total experience accumulated by the time a level begins.
 *
 * A CLOSED FORM, and the reason is a hang rather than a preference. The
 * reference computes this by summing `xpToNextLevel` from zero
 * (player-xp-calc.ts:27-33) and finds the level by counting up
 * (player-xp-calc.ts:15-25, `while (true)`). BOTH LOOPS FAIL TO TERMINATE ON A
 * NON-FINITE TOTAL: `accumulated + cost > NaN` is false forever, and
 * `> Infinity` is false forever. A save file carrying `totalXP: Infinity` — or
 * a divide-by-zero anywhere upstream of an XP award — therefore freezes the
 * frame loop, silently, with no error and no output. That is a worse outcome
 * than any wrong number, and it is inherited for free by an honest port.
 *
 * Each piece below is the arithmetic series of the corresponding piece of
 * `experienceCostOfLevel`:
 *
 *   L <= 16   sum of (2l + 7) for l in [0, L)    =  L^2 + 6L
 *   L <= 31   352 + sum of (5l - 38) for l in [16, L)  =  352 + (L-16)(5L-1)/2
 *   L >  31   1507 + sum of (9l - 158) for l in [31, L) = 1507 + (L-31)(9L-46)/2
 *
 * The two constants are the previous piece evaluated at its own upper end
 * (352 at 16, 1507 at 31), so the function is continuous there; the test asserts
 * the whole of it against a literal accumulation of `experienceCostOfLevel`
 * rather than against these formulae, which is what makes them checkable rather
 * than merely stated.
 */
export const totalExperienceAtLevel = (level: number): number => {
  const at = Math.max(0, Math.floor(delta(level)))
  if (at <= 16) {
    return at * at + 6 * at
  }
  return at <= 31 ? 352 + ((at - 16) * (5 * at - 1)) / 2 : 1507 + ((at - 31) * (9 * at - 46)) / 2
}

/**
 * The level a total buys. TERMINATES ON EVERY INPUT, including the non-finite.
 *
 * Doubling then bisecting over `totalExperienceAtLevel`, which is monotonic in
 * the level. The doubling terminates because the cumulative curve grows without
 * bound and reaches `Infinity` at worst, and `Infinity <= total` is false for
 * every finite total; the bisection then costs the same number of steps again.
 * The reference's linear count-up gives identical answers and is what the test
 * checks this against — over the range where the reference terminates at all.
 */
export const levelForTotalExperience = (totalExperience: number): number => {
  const total = Number.isFinite(totalExperience) ? Math.max(0, totalExperience) : 0

  let high = 1
  while (totalExperienceAtLevel(high) <= total) {
    high *= 2
  }

  let low = 0
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2)
    if (totalExperienceAtLevel(mid) <= total) {
      low = mid
    } else {
      high = mid
    }
  }

  return low
}

/** The level the HUD prints. */
export const experienceLevel = (vitals: Vitals): number =>
  levelForTotalExperience(vitals.totalExperience)

/**
 * Progress towards the next level, in [0, 1). What the XP bar fills to.
 *
 * The divisor cannot be zero — the cheapest level costs seven — but the guard
 * stays, because the alternative is that a future edit to
 * `experienceCostOfLevel` turns the bar into `NaN` and mx-ui's clamp then draws
 * it EMPTY (its `clamp` sends `NaN` to `low`, deliberately). A bar frozen at
 * zero while the level counter climbs is a defect nobody reports as an
 * arithmetic error.
 */
export const experienceProgress = (vitals: Vitals): number => {
  const level = experienceLevel(vitals)
  const cost = experienceCostOfLevel(level)
  if (cost <= 0) {
    return 0
  }

  const total = Number.isFinite(vitals.totalExperience) ? Math.max(0, vitals.totalExperience) : 0
  return clamp((total - totalExperienceAtLevel(level)) / cost, 0, 1)
}

/**
 * Award (or, with a negative amount, spend) experience.
 *
 * The total floors at zero: an enchantment costing more than the player has is a
 * rule's mistake to prevent, and negative experience would make
 * `levelForTotalExperience` answer 0 for two different states. The reference
 * floors in the same place (player-xp-calc.ts:46-47).
 */
export const addExperience = (vitals: Vitals, amount: number): Vitals => {
  const awarded = delta(amount)
  return awarded === 0
    ? vitals
    : { ...vitals, totalExperience: Math.max(0, vitals.totalExperience + awarded) }
}

// ---------------------------------------------------------------------------
// Lifecycle and persistence
// ---------------------------------------------------------------------------

/**
 * Come back to life.
 *
 * Health and hunger return to their spawn values and the death cause is
 * cleared. EXPERIENCE IS LEFT ALONE, and that is the interesting half: vanilla
 * drops most of it on death, but "how much a death costs" is a rule, and a rule
 * that mc-sim applied here would be one mx-gameplay could neither see nor
 * change. A rules tier that wants the vanilla penalty calls `addExperience` with
 * its own negative amount, in the same frame, and can be tested for having done
 * so.
 *
 * The maxima survive too. They are the only fields here a rule may have moved
 * (an attribute modifier, a game mode), and resetting them would silently undo
 * that on every death.
 */
export const respawn = (vitals: Vitals): Vitals => ({
  ...vitals,
  healthPoints: vitals.maxHealthPoints,
  hungerPoints: vitals.maxHungerPoints,
  saturation: Math.min(SPAWN_SATURATION, vitals.maxHungerPoints),
  exhaustion: 0,
  foodTimerSecs: 0,
  lastDamageCause: undefined,
})

/**
 * Can every reader above answer questions about this state?
 *
 * Exported for the same reason `isValidTimeState` is: a persistence layer
 * (mc-save) needs to tell a save it must repair from one it may load verbatim,
 * without having to know the bounds. `VitalsService.restore` has no error
 * channel, so this is where a caller that wants to know asks.
 */
export const isValidVitals = (vitals: Vitals): boolean =>
  Number.isFinite(vitals.maxHealthPoints) &&
  vitals.maxHealthPoints > 0 &&
  Number.isFinite(vitals.healthPoints) &&
  vitals.healthPoints >= 0 &&
  vitals.healthPoints <= vitals.maxHealthPoints &&
  Number.isFinite(vitals.maxHungerPoints) &&
  vitals.maxHungerPoints >= 0 &&
  Number.isFinite(vitals.hungerPoints) &&
  vitals.hungerPoints >= 0 &&
  vitals.hungerPoints <= vitals.maxHungerPoints &&
  Number.isFinite(vitals.saturation) &&
  vitals.saturation >= 0 &&
  vitals.saturation <= vitals.hungerPoints &&
  Number.isFinite(vitals.exhaustion) &&
  vitals.exhaustion >= 0 &&
  // STRICTLY BELOW the threshold, which is the postcondition of `cascade` and
  // therefore the tightest true statement about any state this module produced.
  // The looser `<= MAX_EXHAUSTION` was what the preview caught: a restored 40
  // satisfied it, sat there indefinitely, and made the next 0.01 of sprinting
  // spend ten hunger points at once.
  vitals.exhaustion < EXHAUSTION_PER_POINT &&
  Number.isFinite(vitals.foodTimerSecs) &&
  vitals.foodTimerSecs >= 0 &&
  vitals.foodTimerSecs < FOOD_TICK_SECS &&
  Number.isFinite(vitals.totalExperience) &&
  vitals.totalExperience >= 0

/**
 * Repair a state read from persistence into one every reader can answer for.
 *
 * ONE function and every entry point goes through it — `makeVitalsService`'s
 * initial value as well as `restore`. `docs/testing.md` §3.0.1 records what the
 * other arrangement cost here: the time module had a guarded boundary with an
 * unguarded sibling entry point, and 「修復関数が SIM-1 を再生産していた」.
 *
 * Note the ORDER. Each field is repaired against the ALREADY-REPAIRED value of
 * the field it is bounded by — health against the new maximum, saturation
 * against the new hunger — so a save whose maximum is the broken field cannot
 * drag a legal current value out of range with it. Repairing them
 * independently and checking the pair afterwards is the arrangement that
 * produces a state satisfying every per-field bound and violating the
 * cross-field one, which is exactly the case
 * `PlayerHealthInvariant` (player-health.ts:13-20) exists to catch in the
 * reference and which a schema cannot repair, only reject.
 */
export const normaliseVitals = (vitals: Vitals): Vitals => {
  // A MAXIMUM must be FINITE, and this is the one place the「an infinity has a
  // direction」rule does not apply. The bound it points at is
  // `Number.MAX_SAFE_INTEGER`, and the preview showed what that produces:
  // `hunger 99/9007199254740991`, a state `isValidVitals` accepted and no
  // screen can draw. mx-ui builds one icon per two points with `Array.from`
  // (`iconRow`), so an enormous maximum is not a longer row, it is no row at
  // all. An infinite maximum states no magnitude a row can be built from, so it
  // falls back to the fresh-player value, exactly as a magnitude-less day
  // length falls back to `DEFAULT_DAY_LENGTH_SECS`.
  //
  // A large but FINITE maximum is left alone, and deliberately: what a
  // legitimate maximum is, is a rule (an attribute modifier, a game mode), and
  // this repository is not the owner of it — the same argument
  // `domain/entity.ts` makes for holding no per-kind maximum at all. Whether
  // mx-ui survives being handed one is mx-ui's clamp to make; its
  // `safeMaxPoints` already guards the non-finite case for this exact reason
  // and does not yet guard the merely enormous one.
  const maxHealthPoints = Number.isFinite(vitals.maxHealthPoints)
    ? Math.max(1, vitals.maxHealthPoints)
    : DEFAULT_MAX_HEALTH_POINTS
  const maxHungerPoints = Number.isFinite(vitals.maxHungerPoints)
    ? Math.max(0, vitals.maxHungerPoints)
    : DEFAULT_MAX_HUNGER_POINTS
  const hungerPoints = clamp(vitals.hungerPoints, 0, maxHungerPoints)

  return {
    healthPoints: clamp(vitals.healthPoints, 0, maxHealthPoints),
    maxHealthPoints,
    hungerPoints,
    maxHungerPoints,
    saturation: clamp(vitals.saturation, 0, hungerPoints),
    // SETTLED, not merely bounded, and the modulo is exactly the remainder
    // `cascade` would have left — it simply does not charge the hunger points
    // on the way. The preview caught the looser `<= MAX_EXHAUSTION` version: a
    // restored 40 sat above the threshold indefinitely and made the next 0.01
    // of sprinting spend ten hunger points in one call. Running the real
    // cascade here would be worse in the other direction: it would charge a
    // player ten shanks for opening their save.
    exhaustion: settle(vitals.exhaustion, EXHAUSTION_PER_POINT),
    foodTimerSecs: settle(vitals.foodTimerSecs, FOOD_TICK_SECS),
    // A non-finite total becomes zero rather than the largest safe integer.
    // Clamping to the bound「it points at」made a corrupt save read as level
    // 44,739,260 — a number the HUD prints, nobody can explain, and no rule
    // awarded. `normaliseTimeState` sends a non-finite tick counter to 0 on the
    // same reasoning: a counter that says nothing is not a very large counter.
    totalExperience: Number.isFinite(vitals.totalExperience)
      ? Math.max(0, vitals.totalExperience)
      : 0,
    lastDamageCause: typeof vitals.lastDamageCause === 'string' ? vitals.lastDamageCause : undefined,
  }
}

// ---------------------------------------------------------------------------
// The projection mx-ui reads
// ---------------------------------------------------------------------------

/**
 * The six numbers `mx-ui`'s `VitalsSnapshot` needs from this module.
 *
 * mx-ui's type has EIGHT fields; the other two are `hotbar` and
 * `selectedHotbarIndex`, which are the inventory's and not vitals'. A host
 * composes the whole thing:
 *
 *     const snapshot: VitalsSnapshot = {
 *       ...vitalsView(yield* vitals.snapshot),
 *       hotbar: hotbarOf(yield* inventory.snapshot),
 *       selectedHotbarIndex: …,
 *     }
 *
 * WHAT IS MISSING IS NAMED RATHER THAN INVENTED. Nothing in mc-sim owns the
 * selected hotbar slot today: `domain/inventory.ts` has thirty-six slots and one
 * comment saying the hotbar is among them, and no cursor. It is state, so it is
 * this repository's when it arrives, and it arrives with whoever first needs to
 * scroll — mc-render owns the wheel (docs/responsibility.md §3), mx-ui only
 * mirrors the index it is given, and mx-ui's `hotbarSlotIndex` already clamps
 * whatever it receives. Adding a cursor here now would be a public-API entry
 * with no caller, which is the cost plan.md §8 names as this repository's second
 * risk.
 *
 * This function does NOT clamp. mx-ui does, on purpose and with its own
 * argument (「a HUD that throws is worse than a HUD that is briefly wrong」), and
 * a second clamp on this side would mean the two repositories each held half of
 * one decision. `normaliseVitals` is where a value stops being out of range in
 * mc-sim, and it runs on the way IN, at the boundary that admitted it.
 */
export type VitalsView = {
  readonly healthPoints: number
  readonly maxHealthPoints: number
  readonly hungerPoints: number
  readonly maxHungerPoints: number
  readonly experienceLevel: number
  /** 0-1 towards the next level. */
  readonly experienceProgress: number
}

export const vitalsView = (vitals: Vitals): VitalsView => ({
  healthPoints: vitals.healthPoints,
  maxHealthPoints: vitals.maxHealthPoints,
  hungerPoints: vitals.hungerPoints,
  maxHungerPoints: vitals.maxHungerPoints,
  experienceLevel: experienceLevel(vitals),
  experienceProgress: experienceProgress(vitals),
})
