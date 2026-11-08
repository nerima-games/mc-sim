/**
 * SettingsService — the Ref wrapper around `@nerima-games/mc-kernel`'s
 * settings rules.
 *
 * It holds values. It applies nothing, reads nothing back and notifies nobody:
 * docs/responsibility.md §2 scopes this row to 値の保持, with 画面は mx-ui and
 * 適用は各所 in the same line.
 *
 * The common settings fields and bounds moved to mc-kernel 0.7.0 (merged with
 * mc-compose's PlayerSettingsV1, the other independent copy of this same
 * domain). mc-sim keeps the presentation fields and owns the strict schema
 * that fills only omitted settings fields. Two default changes ride in with
 * the kernel pin bump and are NOT re-implemented locally:
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
import { Brand, Context, Effect, Layer, Ref, Result, Schema, SchemaIssue } from 'effect'
import { applySettings, decodeSettings, rebindKey, unbindKey } from '../domain/settings.js'
import { DEFAULT_SETTINGS, type Settings } from '../domain/settings.js'
import { InputAction, KeyCode } from '@nerima-games/mc-kernel'

export type SettingsServiceApi = {
  /** Every held value. Read on the frame a consumer wants to act on them. */
  readonly snapshot: Effect.Effect<Settings>
  /** Validate a candidate without installing it, for coordinator commits. */
  readonly candidate: (patch: Partial<Settings>) => Effect.Effect<Settings, Schema.SchemaError>
  /**
   * Change some values and leave the rest. Supplied values must be inside the
   * settings schema; failure leaves the held snapshot unchanged.
   */
  readonly update: (patch: Partial<Settings>) => Effect.Effect<Settings, Schema.SchemaError>
  /**
   * Rebind one action. The roster of actions is mc-render's; this map is
   * overrides only. Conflict-swap: an action already bound to `code` gives up
   * that code (to `action`'s previous code, or to nothing when it had none)
   * rather than the two colliding on one physical key. See the module header
   * — this replaces the old plain-overwrite `bindKey`.
   */
  readonly rebindKey: (action: string, code: string) => Effect.Effect<void, Brand.BrandError | Schema.SchemaError>
  /** Drop one rebind, returning the action to the input owner's default. */
  readonly unbindKey: (action: string) => Effect.Effect<void, Brand.BrandError | Schema.SchemaError>
  /**
   * Load stored preferences. Omitted fields receive defaults; malformed values
   * and unknown fields fail before the current settings are changed.
   */
  readonly restore: (settings: unknown) => Effect.Effect<void, Schema.SchemaError>
  /**
   * RESTORE DEFAULTS — the settings screen's button. NOT the world-teardown
   * path. See the module header.
   */
  readonly reset: Effect.Effect<void>
}

const SettingsServiceBase: Context.ServiceClass<
  SettingsService,
  '@nerima-games/mc-sim/SettingsService',
  SettingsServiceApi
> = Context.Service<SettingsService, SettingsServiceApi>()('@nerima-games/mc-sim/SettingsService')

export class SettingsService extends SettingsServiceBase {}

const invalidKeyString = (value: unknown): Brand.BrandError =>
  new Brand.BrandError(new SchemaIssue.InvalidType(Schema.String.ast, value))

/**
 * Build a SettingsService over a fresh Ref.
 *
 * `initial` uses the same strict decoder as `restore`: a layer constructed from
 * stored preferences is another entry point for a value mc-sim did not compute.
 */
export const makeSettingsService = (
  initial: Settings = DEFAULT_SETTINGS,
): Effect.Effect<SettingsServiceApi, Schema.SchemaError> =>
  Effect.flatMap(Effect.fromResult(decodeSettings(initial)), (initialSettings) =>
    Effect.map(Ref.make(initialSettings), (state) => ({
      snapshot: Ref.get(state),
      candidate: (patch) =>
        Ref.get(state).pipe(
          Effect.flatMap((current) => Effect.fromResult(applySettings(current, patch))),
        ),
      update: (patch) =>
        Ref.modify(state, (current): readonly [Result.Result<Settings, Schema.SchemaError>, Settings] => {
          const next = applySettings(current, patch)
          return Result.match(next, {
            onFailure: (failure) => [Result.fail(failure), current],
            onSuccess: (settings) => [Result.succeed(settings), settings],
          })
        }).pipe(Effect.flatMap(Effect.fromResult)),
      rebindKey: (action, code) =>
        Effect.gen(function* () {
          if (typeof action !== 'string') return yield* Effect.fail(invalidKeyString(action))
          const inputAction = yield* Effect.fromResult(InputAction.result(action))
          if (typeof code !== 'string') return yield* Effect.fail(invalidKeyString(code))
          const keyCode = yield* Effect.fromResult(KeyCode.result(code))
          const result = yield* Ref.modify(state, (current): readonly [Result.Result<Settings, Brand.BrandError | Schema.SchemaError>, Settings] => {
            const next = rebindKey(current, inputAction, keyCode)
            return Result.match(next, {
              onFailure: (failure) => [Result.fail(failure), current],
              onSuccess: (settings) => [Result.succeed(settings), settings],
            })
          })
          yield* Effect.fromResult(result)
        }),
      unbindKey: (action) =>
        Effect.gen(function* () {
          if (typeof action !== 'string') return yield* Effect.fail(invalidKeyString(action))
          const inputAction = yield* Effect.fromResult(InputAction.result(action))
          const result = yield* Ref.modify(state, (current): readonly [Result.Result<Settings, Brand.BrandError | Schema.SchemaError>, Settings] => {
            const next = unbindKey(current, inputAction)
            return Result.match(next, {
              onFailure: (failure) => [Result.fail(failure), current],
              onSuccess: (settings) => [Result.succeed(settings), settings],
            })
          })
          yield* Effect.fromResult(result)
        }),
      restore: (next) =>
        Effect.flatMap(Effect.fromResult(decodeSettings(next)), (settings) => Ref.set(state, settings)),
      reset: Ref.set(state, DEFAULT_SETTINGS),
    })),
  )

export const SettingsServiceLayer = (
  initial: Settings = DEFAULT_SETTINGS,
): Layer.Layer<SettingsService, Schema.SchemaError> => Layer.effect(SettingsService, makeSettingsService(initial))
