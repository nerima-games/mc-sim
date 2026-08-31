/**
 * SettingsService — the Ref wrapper around `@nerima-games/mc-kernel`'s
 * settings rules.
 *
 * It holds values. It applies nothing, reads nothing back and notifies nobody:
 * docs/responsibility.md §2 scopes this row to 値の保持, with 画面は mx-ui and
 * 適用は各所 in the same line.
 *
 * The rules themselves moved to mc-kernel 0.7.0 (merged with mc-compose's
 * PlayerSettingsV1, the other independent copy of this same domain — see
 * mc-kernel's CHANGELOG). This module used to own `domain/settings.ts`
 * outright; it is now a thin wrapper the same shape as every other service
 * here, just over an imported ruleset instead of a local one. Two behaviour
 * changes ride in with the pin bump and are NOT re-implemented locally:
 * `audioEnabled` now defaults to `true` and `mouseSensitivity` to `1`
 * (kernel reconciled both against mc-compose's real shipped defaults; see
 * `test/settings.test.ts` for why the old pinned values were updated rather
 * than preserved). `bindKey` is gone — `rebindKey` below replaces it with
 * conflict-swap semantics.
 *
 * mc-sim's `keyBindings` was ALREADY a sparse override map before this move
 * (an action absent from it keeps whatever default the input owner has —
 * see the removed `domain/settings.ts`'s own header) — the exact shape
 * kernel's `rebindKey` assumes. The "donor action left unbound instead of
 * swapped to a default" edge case kernel's own docs flag for a DENSE caller
 * therefore does not apply here: there was never a default-code table for a
 * swap to fall back to, sparse or not.
 *
 * ---------------------------------------------------------------------------
 * `reset` MEANS SOMETHING DIFFERENT HERE, and the difference is a trap
 * ---------------------------------------------------------------------------
 *
 * DN-09 requires every app-scoped singleton to expose a re-entrant `reset`, and
 * the other five services in this repository all mean the same thing by it:
 * throw this world away. Settings are NOT a world. A player who loads a second
 * save keeps their mouse sensitivity, their volume and their rebinds, and a host
 * that wires this `reset` into the same teardown path as `TimeService.reset` will
 * silently factory-reset a player's preferences every time they open a different
 * world — a defect with no error, no crash and no plausible bug report beyond
 * 「my settings keep resetting」.
 *
 * So `reset` here means "forget this player's preferences", the settings screen's
 * own RESTORE DEFAULTS button, and nothing else. It exists because DN-09 asks for
 * it and because that button is real; the world-teardown path must not call it.
 * `application/game-loop.ts`'s `stop` and the second-world scenario in the
 * preview are the paths that must be checked against this, and
 * `test/settings-service.test.ts` names the failure rather than the feature.
 *
 * There is no `subscribe`. A settings change has to reach mc-render, mc-audio
 * and mx-ui, and a change channel here would be the natural way to do it — which
 * is exactly why it is not here: plan.md §8 names this package's public API the
 * top project risk, a subscription is the most expensive kind of entry to add,
 * and the frame already visits every consumer once. A consumer reads `snapshot`
 * on the frame it cares about.
 */
import { Context, Effect, Layer, Ref } from 'effect'
import {
  applySettings,
  DEFAULT_SETTINGS,
  normaliseSettings,
  rebindKey,
  unbindKey,
  type Settings,
} from '@nerima-games/mc-kernel'

export type SettingsServiceApi = {
  /** Every held value. Read on the frame a consumer wants to act on them. */
  readonly snapshot: Effect.Effect<Settings>
  /**
   * Change some values and leave the rest. The result is normalised, so a
   * screen cannot install a render distance nothing can load.
   */
  readonly update: (patch: Partial<Settings>) => Effect.Effect<Settings>
  /**
   * Rebind one action. The roster of actions is mc-render's; this map is
   * overrides only. Conflict-swap: an action already bound to `code` gives up
   * that code (to `action`'s previous code, or to nothing when it had none)
   * rather than the two colliding on one physical key. See the module header
   * — this replaces the old plain-overwrite `bindKey`.
   */
  readonly rebindKey: (action: string, code: string) => Effect.Effect<void>
  /** Drop one rebind, returning the action to the input owner's default. */
  readonly unbindKey: (action: string) => Effect.Effect<void>
  /**
   * Load stored preferences. Repaired by `normaliseSettings` on the way in, with
   * no error channel — a player whose stored FOV is out of range should get a
   * playable FOV, not a game that refuses to start.
   */
  readonly restore: (settings: Settings) => Effect.Effect<void>
  /**
   * RESTORE DEFAULTS — the settings screen's button. NOT the world-teardown
   * path. See the module header.
   */
  readonly reset: Effect.Effect<void>
}

const SettingsServiceBase: Context.TagClass<
  SettingsService,
  '@nerima-games/mc-sim/SettingsService',
  SettingsServiceApi
> = Context.Tag('@nerima-games/mc-sim/SettingsService')<SettingsService, SettingsServiceApi>()

export class SettingsService extends SettingsServiceBase {}

/**
 * Build a SettingsService over a fresh Ref.
 *
 * `initial` is normalised for the reason every other `make*` in this repository
 * normalises its own: a layer constructed from stored preferences is the second
 * entry point for a value mc-sim did not compute, and guarding only `restore`
 * leaves it open.
 */
export const makeSettingsService = (
  initial: Settings = DEFAULT_SETTINGS,
): Effect.Effect<SettingsServiceApi> =>
  Effect.map(Ref.make(normaliseSettings(initial)), (state) => ({
    snapshot: Ref.get(state),
    update: (patch) =>
      Ref.modify(state, (current) => {
        const next = applySettings(current, patch)
        return [next, next]
      }),
    rebindKey: (action, code) => Ref.update(state, (current) => rebindKey(current, action, code)),
    unbindKey: (action) => Ref.update(state, (current) => unbindKey(current, action)),
    restore: (next) => Ref.set(state, normaliseSettings(next)),
    reset: Ref.set(state, DEFAULT_SETTINGS),
  }))

export const SettingsServiceLayer = (
  initial: Settings = DEFAULT_SETTINGS,
): Layer.Layer<SettingsService> => Layer.effect(SettingsService, makeSettingsService(initial))
