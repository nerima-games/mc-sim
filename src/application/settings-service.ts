/**
 * SettingsService — the Ref wrapper around `domain/settings.ts`.
 *
 * It holds values. It applies nothing, reads nothing back and notifies nobody:
 * docs/responsibility.md §2 scopes this row to 値の保持, with 画面は mx-ui and
 * 適用は各所 in the same line.
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
import * as Settings from '../domain/settings.js'

export type SettingsServiceApi = {
  /** Every held value. Read on the frame a consumer wants to act on them. */
  readonly snapshot: Effect.Effect<Settings.Settings>
  /**
   * Change some values and leave the rest. The result is normalised, so a
   * screen cannot install a render distance nothing can load.
   */
  readonly update: (patch: Partial<Settings.Settings>) => Effect.Effect<Settings.Settings>
  /** Rebind one action. The roster of actions is mc-render's; this map is overrides only. */
  readonly bindKey: (action: string, code: string) => Effect.Effect<void>
  /** Drop one rebind, returning the action to the input owner's default. */
  readonly unbindKey: (action: string) => Effect.Effect<void>
  /**
   * Load stored preferences. Repaired by `normaliseSettings` on the way in, with
   * no error channel — a player whose stored FOV is out of range should get a
   * playable FOV, not a game that refuses to start.
   */
  readonly restore: (settings: Settings.Settings) => Effect.Effect<void>
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
  initial: Settings.Settings = Settings.DEFAULT_SETTINGS,
): Effect.Effect<SettingsServiceApi> =>
  Effect.map(Ref.make(Settings.normaliseSettings(initial)), (state) => ({
    snapshot: Ref.get(state),
    update: (patch) =>
      Ref.modify(state, (current) => {
        const next = Settings.applySettings(current, patch)
        return [next, next]
      }),
    bindKey: (action, code) => Ref.update(state, (current) => Settings.bindKey(current, action, code)),
    unbindKey: (action) => Ref.update(state, (current) => Settings.unbindKey(current, action)),
    restore: (next) => Ref.set(state, Settings.normaliseSettings(next)),
    reset: Ref.set(state, Settings.DEFAULT_SETTINGS),
  }))

export const SettingsServiceLayer = (
  initial: Settings.Settings = Settings.DEFAULT_SETTINGS,
): Layer.Layer<SettingsService> => Layer.effect(SettingsService, makeSettingsService(initial))
