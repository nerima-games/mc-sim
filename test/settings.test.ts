import { describe, expect, it } from '@effect/vitest'
import { Cause, Effect, Exit, Result, Schema } from 'effect'
import {
  makeSettingsService,
  SettingsService,
  SettingsServiceLayer,
} from '../src/application/settings-service'
import {
  applySettings,
  COLOR_VISION_CORRECTIONS,
  decodeSettings,
  DEFAULT_SETTINGS,
  GRAPHICS_PRESETS,
  isGraphicsQuality,
  isValidSettings,
  keyBindingFor,
  MAX_FOV_DEGREES,
  MAX_MOUSE_SENSITIVITY,
  MAX_RENDER_DISTANCE,
  MAX_UI_SCALE,
  MAX_VOLUME,
  MIN_FOV_DEGREES,
  MIN_MOUSE_SENSITIVITY,
  MIN_RENDER_DISTANCE,
  MIN_UI_SCALE,
  MIN_VOLUME,
  normaliseSettings,
  REDUCED_MOTION_SETTINGS,
  rebindKey as domainRebindKey,
  SettingsSchema,
  unbindKey as domainUnbindKey,
} from '../src/domain/settings'
import {
  FieldOfViewDegrees,
  InputAction,
  KeyCode,
  MouseSensitivity,
  RenderDistanceChunks,
  VolumeLevel,
} from '@nerima-games/mc-kernel'
import type { Settings } from '../src/domain/settings'
import { SchemaErrorSchema } from '../src/schema-errors'

const withSettings = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch })
const rawSettings = (patch: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => ({
  ...DEFAULT_SETTINGS,
  ...patch,
})
const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isSuccess(result)) return result.success
  throw new Error('Expected valid settings')
}
const normalize = (settings: unknown): Settings => unwrap(normaliseSettings(settings))
const apply = (current: Settings, patch: Partial<Settings>): Settings => unwrap(applySettings(current, patch))
const rebindKey = (settings: Settings, action: string, code: string): Settings =>
  unwrap(domainRebindKey(settings, InputAction(action), KeyCode(code)))
const unbindKey = (settings: Settings, action: string): Settings =>
  unwrap(domainUnbindKey(settings, InputAction(action)))

describe('W4-R3 persistent settings ownership', () => {
  it.effect('stores the full presentation and world settings schema', () =>
    Effect.sync(() => {
      expect(DEFAULT_SETTINGS.difficulty).toBe('normal')
      expect(DEFAULT_SETTINGS.fovDegrees).toBe(75)
      expect(DEFAULT_SETTINGS.uiScale).toBe(1)
      expect(DEFAULT_SETTINGS.reducedMotion).toBe('system')
      expect(DEFAULT_SETTINGS.colorVisionCorrection).toBe('off')
      expect(DEFAULT_SETTINGS.graphicsPreset).toBe('medium')
      expect(isValidSettings(DEFAULT_SETTINGS)).toBe(true)
    }),
  )

  it.effect('rejects invalid persisted values for each newly owned field', () =>
    Effect.sync(() => {
      const invalid = decodeSettings({
        ...DEFAULT_SETTINGS,
        difficulty: 'nightmare',
        uiScale: 3,
        reducedMotion: 'sometimes',
        colorVisionCorrection: 'monochrome',
        graphicsPreset: 'ulra',
      })

      expect(Result.isFailure(invalid)).toBe(true)
      if (Result.isFailure(invalid)) expect(Schema.is(SchemaErrorSchema)(invalid.failure)).toBe(true)
    }),
  )
})

describe('settings decoding input boundary', () => {
  it.effect('rejects non-record settings and accepts omitted fields as defaults', () =>
    Effect.sync(() => {
      expect(Result.isFailure(normaliseSettings(null))).toBe(true)
      expect(Result.isFailure(normaliseSettings([]))).toBe(true)
      expect(normalize({ difficulty: 'hard' })).toMatchObject({
        difficulty: 'hard',
        fovDegrees: DEFAULT_SETTINGS.fovDegrees,
        renderDistance: DEFAULT_SETTINGS.renderDistance,
        uiScale: DEFAULT_SETTINGS.uiScale,
      })
      expect(Result.isFailure(decodeSettings({ uiScale: undefined }))).toBe(true)
      expect(isValidSettings(null)).toBe(false)
      expect(isValidSettings([])).toBe(false)
    }),
  )
})

/**
 * Existing defaults come from mc-kernel; the W4-R3 fields are owned here.
 * Two values changed under mc-kernel 0.7.0's reconciliation
 * against mc-compose's `PlayerSettingsV1` (the independent copy that shipped
 * to real players): `audioEnabled` false→true (the browser autoplay gate
 * already blocks a cold-open blast, so `false` bought no safety, only a
 * silent-by-default game for anyone who never opens the settings menu) and
 * `mouseSensitivity` 0.5→1 (the multiplier's identity value, matching
 * vanilla Minecraft's own midpoint-is-unscaled sensitivity slider). Pinned
 * here at their NEW values so a future accidental revert is caught, not
 * because this repository re-derived either number.
 */
describe('existing defaults stay reconciled with mc-kernel', () => {
  it.effect('existing fresh-user values remain unchanged', () =>
    Effect.sync(() => {
      expect(DEFAULT_SETTINGS.renderDistance).toBe(5)
      expect(DEFAULT_SETTINGS.fovDegrees).toBe(75)
      expect(DEFAULT_SETTINGS.graphicsQuality).toBe('medium')
      expect(DEFAULT_SETTINGS.graphicsPreset).toBe('medium')
      expect(DEFAULT_SETTINGS.audioEnabled).toBe(true)
      expect(DEFAULT_SETTINGS.mouseSensitivity).toBe(1)
      expect(DEFAULT_SETTINGS.masterVolume).toBe(0.8)
      expect(DEFAULT_SETTINGS.musicVolume).toBe(0.55)
      expect(DEFAULT_SETTINGS.sfxVolume).toBe(1)
      expect(DEFAULT_SETTINGS.captionsEnabled).toBe(true)
      expect(DEFAULT_SETTINGS.keyBindings).toEqual({})
      expect(GRAPHICS_PRESETS).toEqual(['low', 'medium', 'high', 'ultra'])
      expect(REDUCED_MOTION_SETTINGS).toEqual(['system', 'full', 'reduced'])
      expect(COLOR_VISION_CORRECTIONS).toEqual(['off', 'protanopia', 'deuteranopia', 'tritanopia'])
    }),
  )

  it.effect('the defaults are themselves valid, which is not automatic', () =>
    Effect.sync(() => {
      expect(normalize(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
      expect(isValidSettings(DEFAULT_SETTINGS)).toBe(true)
    }),
  )
})

describe('strict settings schema', () => {
  it.effect('decodes complete values and rejects missing or unknown fields', () =>
    Effect.sync(() => {
      expect(Result.isSuccess(Schema.decodeUnknownResult(SettingsSchema)(DEFAULT_SETTINGS))).toBe(true)
      expect(Result.isFailure(Schema.decodeUnknownResult(SettingsSchema)({ ...DEFAULT_SETTINGS, _tag: 'Settings' }))).toBe(true)
      expect(Result.isFailure(decodeSettings({ ...DEFAULT_SETTINGS, extra: true }))).toBe(true)
      expect(Result.isFailure(decodeSettings({ ...DEFAULT_SETTINGS, [Symbol('extra')]: true }))).toBe(true)
      expect(Result.isFailure(decodeSettings(new Date()))).toBe(true)
    }),
  )
})

describe('locally owned settings API', () => {
  it.effect('applies a valid patch and preserves the remaining values', () =>
    Effect.sync(() => {
      const updated = apply(DEFAULT_SETTINGS, { audioEnabled: false })

      expect(updated.audioEnabled).toBe(false)
      expect(updated.renderDistance).toBe(DEFAULT_SETTINGS.renderDistance)
      expect(updated.fovDegrees).toBe(DEFAULT_SETTINGS.fovDegrees)
    }),
  )

  it.effect('keeps the preset and legacy graphics quality patches in sync', () =>
    Effect.sync(() => {
      const presetPatch = apply(DEFAULT_SETTINGS, { graphicsPreset: 'high' })
      const legacyPatch = apply(DEFAULT_SETTINGS, { graphicsQuality: 'low' })

      expect(presetPatch.graphicsPreset).toBe('high')
      expect(presetPatch.graphicsQuality).toBe('high')
      expect(legacyPatch.graphicsPreset).toBe('low')
      expect(legacyPatch.graphicsQuality).toBe('low')
    }),
  )

  it.effect('keeps the graphics aliases aligned and rejects invalid presets', () =>
    Effect.sync(() => {
      const legacy = normalize({ graphicsQuality: 'high' })

      expect(legacy.graphicsPreset).toBe('high')
      expect(legacy.graphicsQuality).toBe('high')
      expect(Result.isFailure(decodeSettings({ graphicsPreset: 'ulra', graphicsQuality: 'high' }))).toBe(true)
      expect(GRAPHICS_PRESETS).toContain('ultra')
      expect(GRAPHICS_PRESETS).not.toContain('ulra')
    }),
  )

  it.effect('recognises only the declared graphics qualities', () =>
    Effect.sync(() => {
      expect(isGraphicsQuality('ultra')).toBe(true)
      expect(isGraphicsQuality('ulra')).toBe(false)
    }),
  )

  it.effect('validates every field before narrowing an unknown value to Settings', () =>
    Effect.sync(() => {
      expect(isValidSettings(DEFAULT_SETTINGS)).toBe(true)
      expect(isValidSettings({ ...DEFAULT_SETTINGS, renderDistance: 2.5 })).toBe(false)
      expect(isValidSettings({ ...DEFAULT_SETTINGS, graphicsQuality: 'ulra' })).toBe(false)
    }),
  )
})

describe('settings ranges reject values beyond their bounds', () => {
  it.effect('accepts each numeric bound and rejects the value immediately outside it', () =>
    Effect.sync(() => {
      const accepted = [
        { renderDistance: MIN_RENDER_DISTANCE },
        { renderDistance: MAX_RENDER_DISTANCE },
        { fovDegrees: MIN_FOV_DEGREES },
        { fovDegrees: MAX_FOV_DEGREES },
        { uiScale: MIN_UI_SCALE },
        { uiScale: MAX_UI_SCALE },
        { mouseSensitivity: MIN_MOUSE_SENSITIVITY },
        { mouseSensitivity: MAX_MOUSE_SENSITIVITY },
        { masterVolume: MIN_VOLUME },
        { masterVolume: MAX_VOLUME },
        { musicVolume: MIN_VOLUME },
        { musicVolume: MAX_VOLUME },
        { sfxVolume: MIN_VOLUME },
        { sfxVolume: MAX_VOLUME },
      ]
      const rejected = [
        { renderDistance: MIN_RENDER_DISTANCE - 1 },
        { renderDistance: MAX_RENDER_DISTANCE + 1 },
        { fovDegrees: MIN_FOV_DEGREES - 0.01 },
        { fovDegrees: MAX_FOV_DEGREES + 0.01 },
        { uiScale: MIN_UI_SCALE - 0.01 },
        { uiScale: MAX_UI_SCALE + 0.01 },
        { mouseSensitivity: MIN_MOUSE_SENSITIVITY - 0.01 },
        { mouseSensitivity: MAX_MOUSE_SENSITIVITY + 0.01 },
        { masterVolume: MIN_VOLUME - 0.01 },
        { masterVolume: MAX_VOLUME + 0.01 },
        { musicVolume: MIN_VOLUME - 0.01 },
        { musicVolume: MAX_VOLUME + 0.01 },
        { sfxVolume: MIN_VOLUME - 0.01 },
        { sfxVolume: MAX_VOLUME + 0.01 },
      ]

      for (const candidate of accepted) expect(Result.isSuccess(decodeSettings(candidate))).toBe(true)
      for (const candidate of rejected) expect(Result.isFailure(decodeSettings(candidate))).toBe(true)
    }),
  )

  it.effect('rejects fractional render distance, non-finite values, and wrong primitive types', () =>
    Effect.sync(() => {
      expect(Result.isFailure(decodeSettings({ renderDistance: 7.9 }))).toBe(true)
      expect(Result.isFailure(decodeSettings({ uiScale: Number.NaN }))).toBe(true)
      expect(Result.isFailure(decodeSettings({ fovDegrees: Number.POSITIVE_INFINITY }))).toBe(true)
      expect(Result.isFailure(decodeSettings({ masterVolume: 'loud' }))).toBe(true)
      expect(Result.isFailure(decodeSettings({ audioEnabled: 'false' }))).toBe(true)
    }),
  )
})

describe('key bindings are overrides, not a roster', () => {
  it.effect('binding, reading and unbinding one action', () =>
    Effect.sync(() => {
      const bound = rebindKey(DEFAULT_SETTINGS, 'jump', 'Space')

      expect(keyBindingFor(bound, 'jump')).toBe('Space')
      expect(keyBindingFor(bound, 'sneak')).toBeUndefined()
      expect(keyBindingFor(unbindKey(bound, 'jump'), 'jump')).toBeUndefined()
    }),
  )

  it.effect('rejects an invalid runtime action value', () =>
    Effect.sync(() => {
      expect(InputAction.result('')._tag).toBe('Failure')
      expect(
        domainRebindKey(DEFAULT_SETTINGS, '' as InputAction, KeyCode('Space')),
      ).toMatchObject({ _tag: 'Failure' })
    }),
  )

  it.effect('unbinding something unbound changes nothing, by identity', () =>
    Effect.sync(() => {
      expect(unbindKey(DEFAULT_SETTINGS, 'jump')).toBe(DEFAULT_SETTINGS)
    }),
  )

  it.effect('unbinding one action keeps every OTHER rebind', () =>
    Effect.sync(() => {
      const bound = rebindKey(rebindKey(DEFAULT_SETTINGS, 'jump', 'Space'), 'sneak', 'ShiftLeft')

      expect(unbindKey(bound, 'jump').keyBindings).toEqual({ sneak: 'ShiftLeft' })
    }),
  )

  it.effect('blank action and code values fail their brands', () =>
    Effect.sync(() => {
      expect(InputAction.result('')._tag).toBe('Failure')
      expect(KeyCode.result('')._tag).toBe('Failure')
    }),
  )

  /**
   * The behaviour change `rebindKey` brought in over the old `bindKey`: two
   * actions can no longer collide on one physical code. The action being
   * rebound takes the code; whichever OTHER action held that code receives
   * the rebound action's OWN previous code — or, when the rebound action had
   * none to give, is left unbound rather than defaulted, because kernel has
   * no per-action default table to fall back to (see
   * `application/settings-service.ts`'s header on why that is not a gap for
   * THIS repository specifically: `keyBindings` was already a sparse
   * override map before this move, never a dense one).
   *
   * `sneak` here is rebound while it has never been bound before (no previous
   * code of its own to hand off), which is the case that leaves the donor
   * (`jump`) unbound.
   */
  it.effect('REGRESSION: rebinding onto a code another action holds, with no previous code of its own, unbinds the donor', () =>
    Effect.sync(() => {
      const jumpBound = rebindKey(DEFAULT_SETTINGS, 'jump', 'Space')

      const swapped = rebindKey(jumpBound, 'sneak', 'Space')

      expect(keyBindingFor(swapped, 'sneak')).toBe('Space')
      expect(keyBindingFor(swapped, 'jump')).toBeUndefined()
      expect(swapped.keyBindings).toEqual({ sneak: 'Space' })
    }),
  )

  it.effect('REGRESSION: a conflict swap where the rebound action HAD a previous code hands it to the donor', () =>
    Effect.sync(() => {
      const bothBound = rebindKey(rebindKey(DEFAULT_SETTINGS, 'jump', 'Space'), 'sneak', 'ShiftLeft')

      // `sneak` already had 'ShiftLeft'; rebinding it onto 'Space' (currently
      // `jump`'s) gives `jump` 'ShiftLeft' back rather than leaving it unbound.
      const swapped = rebindKey(bothBound, 'sneak', 'Space')

      expect(swapped.keyBindings).toEqual({ sneak: 'Space', jump: 'ShiftLeft' })
    }),
  )

  it.effect('a patch REPLACES the map, so a rebind can be removed', () =>
    Effect.sync(() => {
      // Merging would make removal impossible: the map is already the override
      // set, and an absent entry is what "keep the default" means.
      const bound = rebindKey(rebindKey(DEFAULT_SETTINGS, 'jump', 'Space'), 'sneak', 'ShiftLeft')
      const replaced = normalize({ ...bound, keyBindings: { jump: 'KeyJ' } })

      expect(replaced.keyBindings).toEqual({ jump: 'KeyJ' })
    }),
  )

  it.effect('rejects malformed key-binding entries rather than dropping them', () =>
    Effect.sync(() => {
      const invalid = normaliseSettings(
        rawSettings({ keyBindings: { jump: null, sneak: 'ShiftLeft', '': 'KeyQ' } }),
      )

      expect(Result.isFailure(invalid)).toBe(true)
    }),
  )

  it.effect('rejects a keyBindings value that is not a map', () =>
    Effect.sync(() => {
      const invalid = normaliseSettings(
        rawSettings({ keyBindings: null }),
      )

      expect(Result.isFailure(invalid)).toBe(true)
    }),
  )
})

describe('SettingsService', () => {
  it.effect('computes a candidate without installing it for a coordinator commit', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()
      const candidate = yield* settings.candidate({ difficulty: 'hard', uiScale: 1.25 })

      expect(candidate.difficulty).toBe('hard')
      expect(candidate.uiScale).toBe(1.25)
      expect(yield* settings.snapshot).toEqual(DEFAULT_SETTINGS)
      yield* settings.restore(candidate)
      expect(yield* settings.snapshot).toEqual(candidate)
    }),
  )

  it.effect('invalid candidates and updates fail with SchemaError and preserve the snapshot', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()
      const before = yield* settings.snapshot
      const candidate = yield* Effect.result(settings.candidate({ uiScale: MAX_UI_SCALE + 0.01 }))
      const update = yield* Effect.result(settings.update({ uiScale: MAX_UI_SCALE + 0.01 }))

      expect(Result.isFailure(candidate)).toBe(true)
      expect(Result.isFailure(update)).toBe(true)
      if (Result.isFailure(candidate)) expect(Schema.is(SchemaErrorSchema)(candidate.failure)).toBe(true)
      if (Result.isFailure(update)) expect(Schema.is(SchemaErrorSchema)(update.failure)).toBe(true)
      expect(yield* settings.snapshot).toEqual(before)
    }),
  )

  it.effect('update patches valid fields and leaves the rest', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()

      // A well-formed `false` must stay false; boolean settings are not truthy flags.
      const next = yield* settings.update({ renderDistance: RenderDistanceChunks(12), audioEnabled: false })

      expect(next.renderDistance).toBe(12)
      expect(next.audioEnabled).toBe(false)
      expect(next.fovDegrees).toBe(75)
      expect(next.mouseSensitivity).toBe(1)
    }),
  )

  it.effect('a max-bound branded patch is accepted and remains valid', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()

      expect((yield* settings.update({ renderDistance: RenderDistanceChunks(16) })).renderDistance).toBe(16)
      const saved = yield* settings.snapshot
      expect(normalize(saved)).toEqual(saved)
    }),
  )

  it.effect('a layer built from stored preferences keeps the branded values', () =>
    Effect.gen(function* () {
      const restored = yield* Effect.flatMap(SettingsService, (service) => service.snapshot).pipe(
        Effect.provide(
          SettingsServiceLayer(
            withSettings({ fovDegrees: FieldOfViewDegrees(75), renderDistance: RenderDistanceChunks(16) }),
          ),
        ),
      )

      expect(normalize(restored)).toEqual(restored)
      expect(restored.fovDegrees).toBe(75)
      expect(restored.renderDistance).toBe(16)
    }),
  )

  it.effect('a layer rejects malformed runtime preferences instead of replacing them', () =>
    Effect.gen(function* () {
      const malformed = withSettings({
        fovDegrees: FieldOfViewDegrees(75),
        renderDistance: RenderDistanceChunks(16),
      })
      expect(Reflect.set(malformed, 'fovDegrees', Number.NaN)).toBe(true)
      expect(Reflect.set(malformed, 'renderDistance', 400)).toBe(true)

      const restored = yield* Effect.result(
        Effect.flatMap(SettingsService, (service) => service.snapshot).pipe(
          Effect.provide(SettingsServiceLayer(malformed)),
        ),
      )

      expect(Result.isFailure(restored)).toBe(true)
      if (Result.isFailure(restored)) expect(Schema.is(SchemaErrorSchema)(restored.failure)).toBe(true)
    }),
  )

  it.effect('restore rejects malformed stored settings and leaves the current state intact', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()
      const before = yield* settings.snapshot
      const fromDisk = rawSettings({
        renderDistance: 0,
        fovDegrees: 179,
        mouseSensitivity: 99,
        audioEnabled: 'true',
        keyBindings: { jump: 123 },
      })

      const restored = yield* Effect.result(settings.restore(fromDisk))
      expect(Result.isFailure(restored)).toBe(true)
      if (Result.isFailure(restored)) expect(Schema.is(SchemaErrorSchema)(restored.failure)).toBe(true)
      expect(yield* settings.snapshot).toEqual(before)
    }),
  )

  it.effect('strictly rejects malformed keyBindings entries', () =>
    Effect.sync(() => {
      expect(Result.isFailure(decodeSettings(rawSettings({ keyBindings: { '': 'KeyA' } })))).toBe(true)
      expect(Result.isFailure(decodeSettings(rawSettings({ keyBindings: { jump: '' } })))).toBe(true)
      expect(Result.isFailure(decodeSettings(rawSettings({ keyBindings: { jump: 123 } })))).toBe(true)
    }),
  )

  it.effect('rebindKey and unbindKey go through the Ref', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()

      yield* settings.rebindKey('jump', 'Space')
      expect(keyBindingFor(yield* settings.snapshot, 'jump')).toBe('Space')

      yield* settings.unbindKey('jump')
      expect(keyBindingFor(yield* settings.snapshot, 'jump')).toBeUndefined()
    }),
  )

  it.effect('invalid branded rebind input fails and leaves settings unchanged', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()
      const invalidAction = yield* Effect.exit(settings.rebindKey('', 'Space'))
      const invalidCode = yield* Effect.exit(settings.rebindKey('jump', ''))

      expect(Exit.isFailure(invalidAction) && Cause.hasFails(invalidAction.cause)).toBe(true)
      expect(Exit.isFailure(invalidCode) && Cause.hasFails(invalidCode.cause)).toBe(true)
      expect(yield* settings.snapshot).toEqual(DEFAULT_SETTINGS)
    }),
  )

  it.effect('runtime non-string rebind inputs fail through the typed channel and leave settings unchanged', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()
      const invalidAction = yield* Effect.result(
        Reflect.apply(settings.rebindKey, undefined, [null, 'Space']) as Effect.Effect<void, unknown, never>,
      )
      const invalidCode = yield* Effect.result(
        Reflect.apply(settings.rebindKey, undefined, ['jump', Number.POSITIVE_INFINITY]) as Effect.Effect<void, unknown, never>,
      )
      const invalidUnbind = yield* Effect.result(
        Reflect.apply(settings.unbindKey, undefined, [false]) as Effect.Effect<void, unknown, never>,
      )

      expect(Result.isFailure(invalidAction)).toBe(true)
      expect(Result.isFailure(invalidCode)).toBe(true)
      expect(Result.isFailure(invalidUnbind)).toBe(true)
      expect(yield* settings.snapshot).toEqual(DEFAULT_SETTINGS)
    }),
  )

  it.effect('rebindKey swaps a conflicting action through the Ref too, not just in the pure rule', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()

      yield* settings.rebindKey('jump', 'Space')
      // `sneak` has no previous code of its own, so this leaves `jump` unbound
      // rather than defaulted — same case as the pure-rule REGRESSION test.
      yield* settings.rebindKey('sneak', 'Space')

      const snapshot = yield* settings.snapshot
      expect(keyBindingFor(snapshot, 'sneak')).toBe('Space')
      expect(keyBindingFor(snapshot, 'jump')).toBeUndefined()
    }),
  )

  /**
   * THE regression test for `reset` meaning something else here.
   *
   * Named after the failure a host makes. Every other service in this repository
   * means "throw this world away" by `reset`; this one means "the settings
   * screen's RESTORE DEFAULTS button". A host that wires it into the world
   * teardown path silently factory-resets a player's preferences on every world
   * load — no crash, no error, and no plausible bug report beyond 「my settings
   * keep resetting」.
   */
  it.effect('REGRESSION: reset is RESTORE DEFAULTS, and must not be on the world-teardown path', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()

      yield* settings.update({
        mouseSensitivity: MouseSensitivity(2.4),
        masterVolume: VolumeLevel(0.2),
      })
      yield* settings.rebindKey('jump', 'Space')
      yield* settings.reset

      // What reset does.
      expect(yield* settings.snapshot).toEqual(DEFAULT_SETTINGS)

      // What a world load must do INSTEAD: nothing. A second world reaches the
      // service with the preferences the first one left, which is what the
      // preview's second-world scenario has to keep true.
      yield* settings.update({ mouseSensitivity: MouseSensitivity(2.4) })
      const survivor = yield* settings.snapshot
      expect(survivor.mouseSensitivity).toBe(2.4)
    }),
  )
})
