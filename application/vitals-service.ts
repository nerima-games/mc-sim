/**
 * VitalsService — the Ref wrapper around `domain/vitals.ts`.
 *
 * Every mutator is `Ref.modify` or `Ref.update`, never a `Ref.get` followed by a
 * `Ref.set`. DN-07 and plan.md §3.8 give the general reason; this service has
 * the sharpest instance of it in the repository. "Did this blow kill the player"
 * is a comparison of the state BEFORE a write with the state AFTER it, and
 * computing it outside the write is a two-step read-decide-write that a
 * concurrently running stage can interleave with. Two blows landing in one frame
 * would then both report the kill, or neither would, and a death screen that
 * appears twice and a death screen that never appears are the same bug. So
 * `damage` returns a `DamageOutcome` computed INSIDE the modify — the reference
 * does the same and for the same reason
 * (ts-minecraft/packages/entity/application/health-service.ts:68-85, whose
 * `justDied` is fused into one `Ref.modify`).
 *
 * ---------------------------------------------------------------------------
 * What this service does NOT do
 * ---------------------------------------------------------------------------
 *
 * It does not decide anything. There is no `fall`, no `burn`, no `starve` and no
 * `attack` here: `damage` takes an amount and a cause, and `domain/vitals.ts`'s
 * header states why that is the whole API. `advanceFoodTimer` returns a signal
 * for a caller to act on rather than acting.
 *
 * It also holds no death Deferred. The reference signals death through a
 * one-shot `Deferred` swapped on reset (health-service.ts:63-64, :121-129), and
 * that is a legitimate design for a repository where the death screen is a
 * sibling module. Here the screen is in mx-ui and the rule that reacts is in
 * mx-gameplay, neither of which mc-sim can see, so the signal would be a
 * subscription API on the hub with no local subscriber — plan.md §8's second
 * risk taken on speculation. `DamageOutcome.died` is the same information handed
 * to the caller that caused it, in the same frame.
 */
import { Context, Effect, Layer, Ref } from 'effect'
import type { DeltaTimeSecs } from "@nerima-games/mc-kernel"
import * as Vitals from '../domain/vitals'

/**
 * The result of one blow.
 *
 * `died` is TRUE only on the transition, so a second blow on a corpse reports
 * `false` while still returning the (unchanged) vitals. A caller that wants "is
 * the player dead" asks `Vitals.isDead(outcome.vitals)`; a caller that wants
 * "did I kill them" — the death message, the death counter, the respawn timer —
 * wants this flag, and the two questions have different answers exactly once per
 * death, which is the moment both are asked.
 */
export type DamageOutcome = {
  readonly vitals: Vitals.Vitals
  readonly died: boolean
}

export type VitalsServiceApi = {
  /** Whole state, for persistence. */
  readonly snapshot: Effect.Effect<Vitals.Vitals>
  /** The six numbers mx-ui's `VitalsSnapshot` needs. See `domain/vitals.ts`. */
  readonly view: Effect.Effect<Vitals.VitalsView>
  /**
   * Take damage. The amount and the cause are the CALLER's; mc-sim reads
   * neither the cause nor a table of amounts.
   */
  readonly damage: (damage: Vitals.Damage) => Effect.Effect<DamageOutcome>
  /** Heal, up to the maximum. A dead player is not healed — see the domain module. */
  readonly heal: (amount: number) => Effect.Effect<Vitals.Vitals>
  /** Charge exhaustion for something a rule did. The cost table is mx-gameplay's. */
  readonly addExhaustion: (amount: number) => Effect.Effect<void>
  /** Eat. Which foods restore what is a table of items, and not held here. */
  readonly eat: (foodPoints: number, saturationModifier: number) => Effect.Effect<void>
  /**
   * Advance the food timer by a frame's worth of seconds and report what the
   * tick asks for. The delta is SUPPLIED — no clock is read anywhere here.
   */
  readonly advanceFoodTimer: (dt: DeltaTimeSecs) => Effect.Effect<Vitals.FoodTickSignal>
  /** Award or spend experience. Negative amounts spend; the total floors at zero. */
  readonly addExperience: (amount: number) => Effect.Effect<Vitals.Vitals>
  /**
   * Come back to life. EXPERIENCE SURVIVES — how much a death costs is a rule,
   * and `domain/vitals.ts` argues the case.
   */
  readonly respawn: Effect.Effect<void>
  /**
   * THE WORLD-LOAD PATH. The incoming state is repaired by `normaliseVitals`
   * before it is installed.
   *
   * No error channel, deliberately, for the reason `TimeService.restore` has
   * none: failing a world load over a recoverable field turns a repairable save
   * into an unopenable one. A caller that needs to know whether a save was
   * repaired asks `Vitals.isValidVitals` BEFORE restoring.
   */
  readonly restore: (vitals: Vitals.Vitals) => Effect.Effect<void>
  /** Back to the fresh-world vitals. Required for re-entrant world loads (DN-09). */
  readonly reset: Effect.Effect<void>
}

export class VitalsService extends Context.Tag('@nerima-games/mc-sim/VitalsService')<
  VitalsService,
  VitalsServiceApi
>() {}

/**
 * Build a VitalsService over a fresh Ref.
 *
 * `initial` goes through `Vitals.normaliseVitals` for exactly the reason
 * `restore` does — a layer constructed with a loaded world is the OTHER way a
 * state this repository did not compute gets in, and `makeTimeService`'s header
 * records what happened when only one of the two entry points was guarded.
 */
export const makeVitalsService = (
  initial: Vitals.Vitals = Vitals.SPAWN_VITALS,
): Effect.Effect<VitalsServiceApi> =>
  Effect.map(Ref.make(Vitals.normaliseVitals(initial)), (state) => ({
    snapshot: Ref.get(state),
    view: Ref.get(state).pipe(Effect.map(Vitals.vitalsView)),
    damage: (blow) =>
      Ref.modify(state, (current) => {
        const next = Vitals.applyDamage(current, blow)
        // Both readings come from inside this one atomic step. Computing
        // `wasAlive` from a separate `Ref.get` is the interleaving described in
        // the module header.
        const outcome: DamageOutcome = {
          vitals: next,
          died: !Vitals.isDead(current) && Vitals.isDead(next),
        }
        return [outcome, next]
      }),
    heal: (amount) =>
      Ref.modify(state, (current) => {
        const next = Vitals.heal(current, amount)
        return [next, next]
      }),
    addExhaustion: (amount) => Ref.update(state, (current) => Vitals.addExhaustion(current, amount)),
    eat: (foodPoints, saturationModifier) =>
      Ref.update(state, (current) => Vitals.eat(current, foodPoints, saturationModifier)),
    advanceFoodTimer: (dt) => Ref.modify(state, (current) => Vitals.advanceFoodTimer(current, dt)),
    addExperience: (amount) =>
      Ref.modify(state, (current) => {
        const next = Vitals.addExperience(current, amount)
        return [next, next]
      }),
    respawn: Ref.update(state, Vitals.respawn),
    restore: (next) => Ref.set(state, Vitals.normaliseVitals(next)),
    reset: Ref.set(state, Vitals.SPAWN_VITALS),
  }))

export const VitalsServiceLayer = (
  initial: Vitals.Vitals = Vitals.SPAWN_VITALS,
): Layer.Layer<VitalsService> => Layer.effect(VitalsService, makeVitalsService(initial))
