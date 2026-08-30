import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  makeSettingsService,
  SettingsService,
  SettingsServiceLayer,
} from '../src/application/settings-service'
import {
  applySettings,
  bindKey,
  DEFAULT_SETTINGS,
  isGraphicsQuality,
  isValidSettings,
  keyBindingFor,
  normaliseSettings,
  unbindKey,
  type Settings,
} from '../src/domain/settings'

const withSettings = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch })

/**
 * THE regression test for the second-owner refusal.
 *
 * The reference's `SettingsSchema` holds `dayLengthSeconds`
 * (settings.schema.ts:54) while its `TimeService` holds the same quantity as the
 * denominator of a tick counter. `mx-gameplay/docs/architecture.md:142-148`
 * records what a duplicated day length cost when the two disagreed: the sky
 * jumped on world load, and only mc-sim's answer was saved.
 *
 * Named after the failure. If a `dayLength` field ever appears here, this goes
 * red before anybody has to notice the sky.
 */
describe('REGRESSION: settings must not become a second owner of the day length', () => {
  it.effect('no field here names a day, a difficulty or a preset', () =>
    Effect.sync(() => {
      expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([
        'audioEnabled',
        'fovDegrees',
        'graphicsQuality',
        'keyBindings',
        'masterVolume',
        'mouseSensitivity',
        'musicVolume',
        'renderDistance',
        'sfxVolume',
      ])
    }),
  )

  it.effect('a patch naming a refused field cannot install one', () =>
    Effect.sync(() => {
      // `applySettings` rebuilds through `normaliseSettings`, which writes the
      // nine fields it knows and nothing else. A save from a build that had more
      // therefore cannot smuggle one back in.
      const patched = applySettings(DEFAULT_SETTINGS, {
        dayLengthSeconds: 1200,
        difficulty: 'hard',
      } as Partial<Settings>)

      expect(Object.keys(patched).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort())
    }),
  )
})

describe('the defaults are the reference’s, transcription by transcription', () => {
  it.effect('every fresh-user value is the one settings-service.ts:12-37 states', () =>
    Effect.sync(() => {
      // Literals, per docs/testing.md §4.6 — a test reading the same constant
      // as the code stays green when the constant is "tidied".
      expect(DEFAULT_SETTINGS.renderDistance).toBe(5)
      expect(DEFAULT_SETTINGS.fovDegrees).toBe(75)
      expect(DEFAULT_SETTINGS.graphicsQuality).toBe('medium')
      expect(DEFAULT_SETTINGS.mouseSensitivity).toBe(0.5)
      expect(DEFAULT_SETTINGS.masterVolume).toBe(0.8)
      expect(DEFAULT_SETTINGS.musicVolume).toBe(0.55)
      expect(DEFAULT_SETTINGS.sfxVolume).toBe(1)
      expect(DEFAULT_SETTINGS.keyBindings).toEqual({})
    }),
  )

  it.effect('audio is OFF by default, and the reason is a development one', () =>
    Effect.sync(() => {
      // settings.schema.ts:71-73 is emphatic about this, and its stated reason
      // is that audio 「causes noise during development and testing」 — a claim
      // about a dev loop, not about players. Pinned so the default is a decision
      // somebody re-takes rather than one that ships by inertia.
      expect(DEFAULT_SETTINGS.audioEnabled).toBe(false)
    }),
  )

  it.effect('the defaults are themselves valid, which is not automatic', () =>
    Effect.sync(() => {
      expect(isValidSettings(DEFAULT_SETTINGS)).toBe(true)
      expect(normaliseSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
    }),
  )
})

describe('values are clamped into the reference’s ranges', () => {
  it.effect('render distance is an integer in [2, 16]', () =>
    Effect.sync(() => {
      // settings.schema.ts:49.
      expect(normaliseSettings(withSettings({ renderDistance: 0 })).renderDistance).toBe(2)
      expect(normaliseSettings(withSettings({ renderDistance: 64 })).renderDistance).toBe(16)
      expect(normaliseSettings(withSettings({ renderDistance: 7.9 })).renderDistance).toBe(7)
    }),
  )

  it.effect('field of view is in [30, 110]', () =>
    Effect.sync(() => {
      // settings.schema.ts:51-53: 30 'zoom', 110 'Quake Pro'.
      expect(normaliseSettings(withSettings({ fovDegrees: 1 })).fovDegrees).toBe(30)
      expect(normaliseSettings(withSettings({ fovDegrees: 179 })).fovDegrees).toBe(110)
    }),
  )

  it.effect('mouse sensitivity is in [0.1, 3]', () =>
    Effect.sync(() => {
      // settings.schema.ts:50. Zero is refused because a sensitivity of zero is
      // a camera that cannot turn, which reads as a frozen game.
      expect(normaliseSettings(withSettings({ mouseSensitivity: 0 })).mouseSensitivity).toBe(0.1)
      expect(normaliseSettings(withSettings({ mouseSensitivity: 99 })).mouseSensitivity).toBe(3)
    }),
  )

  it.effect('volumes are in [0, 1]', () =>
    Effect.sync(() => {
      // settings.schema.ts:75-77.
      const loud = normaliseSettings(
        withSettings({ masterVolume: 11, musicVolume: -1, sfxVolume: 0.5 }),
      )

      expect(loud.masterVolume).toBe(1)
      expect(loud.musicVolume).toBe(0)
      expect(loud.sfxVolume).toBe(0.5)
    }),
  )

  it.effect('an unknown graphics quality falls back rather than reaching a preset lookup', () =>
    Effect.sync(() => {
      // A `string` here would let a save carry 'ulra' into mc-render's preset
      // table, which would answer `undefined` and take the renderer with it.
      expect(normaliseSettings(withSettings({ graphicsQuality: 'ulra' as never })).graphicsQuality).toBe(
        'medium',
      )
      expect(isGraphicsQuality('ultra')).toBe(true)
      expect(isGraphicsQuality('ulra')).toBe(false)
    }),
  )

  it.effect('an INFINITY lands on the bound it points at; a NaN lands on the default', () =>
    Effect.sync(() => {
      // The same rule `domain/time-of-day.ts` states: an infinity has a
      // direction, a value with no magnitude does not. A cleared field snapping
      // to the MINIMUM would give a player a fog wall or silence they cannot
      // explain, so the fresh-user value is the fallback here.
      expect(normaliseSettings(withSettings({ fovDegrees: Number.POSITIVE_INFINITY })).fovDegrees).toBe(110)
      expect(normaliseSettings(withSettings({ fovDegrees: Number.NaN })).fovDegrees).toBe(75)
      expect(normaliseSettings(withSettings({ masterVolume: Number.NaN })).masterVolume).toBe(0.8)
    }),
  )

  it.effect('REGRESSION: the string "false" must not become a true', () =>
    Effect.sync(() => {
      // `Boolean('false')` is `true`. A stored NO turning into a YES is the one
      // coercion that switches a setting on behalf of a player who switched it
      // off, and a save file written by an older schema is exactly where a
      // stringified boolean comes from.
      const repaired = normaliseSettings(
        withSettings({ audioEnabled: 'false' as unknown as boolean }),
      )

      expect(repaired.audioEnabled).toBe(false)
    }),
  )
})

describe('key bindings are overrides, not a roster', () => {
  it.effect('binding, reading and unbinding one action', () =>
    Effect.sync(() => {
      const bound = bindKey(DEFAULT_SETTINGS, 'jump', 'Space')

      expect(keyBindingFor(bound, 'jump')).toBe('Space')
      expect(keyBindingFor(bound, 'sneak')).toBeUndefined()
      expect(keyBindingFor(unbindKey(bound, 'jump'), 'jump')).toBeUndefined()
    }),
  )

  it.effect('unbinding something unbound changes nothing, by identity', () =>
    Effect.sync(() => {
      expect(unbindKey(DEFAULT_SETTINGS, 'jump')).toBe(DEFAULT_SETTINGS)
    }),
  )

  it.effect('unbinding one action keeps every OTHER rebind', () =>
    Effect.sync(() => {
      const bound = bindKey(bindKey(DEFAULT_SETTINGS, 'jump', 'Space'), 'sneak', 'ShiftLeft')

      expect(unbindKey(bound, 'jump').keyBindings).toEqual({ sneak: 'ShiftLeft' })
    }),
  )

  it.effect('a blank action or code is refused rather than stored, by identity', () =>
    Effect.sync(() => {
      expect(bindKey(DEFAULT_SETTINGS, '', 'Space')).toBe(DEFAULT_SETTINGS)
      expect(bindKey(DEFAULT_SETTINGS, 'jump', '')).toBe(DEFAULT_SETTINGS)
    }),
  )

  it.effect('a patch REPLACES the map, so a rebind can be removed', () =>
    Effect.sync(() => {
      // Merging would make removal impossible: the map is already the override
      // set, and an absent entry is what "keep the default" means.
      const bound = bindKey(bindKey(DEFAULT_SETTINGS, 'jump', 'Space'), 'sneak', 'ShiftLeft')
      const replaced = applySettings(bound, { keyBindings: { jump: 'KeyJ' } })

      expect(replaced.keyBindings).toEqual({ jump: 'KeyJ' })
    }),
  )

  it.effect('a non-string code is DROPPED, not coerced into a key no keyboard makes', () =>
    Effect.sync(() => {
      const repaired = normaliseSettings(
        withSettings({
          keyBindings: { jump: null as unknown as string, sneak: 'ShiftLeft', '': 'KeyQ' },
        }),
      )

      expect(repaired.keyBindings).toEqual({ sneak: 'ShiftLeft' })
    }),
  )

  it.effect('a keyBindings that is not an object at all becomes an empty map', () =>
    Effect.sync(() => {
      const repaired = normaliseSettings(
        withSettings({ keyBindings: null as unknown as Record<string, string> }),
      )

      expect(repaired.keyBindings).toEqual({})
      expect(isValidSettings(repaired)).toBe(true)
    }),
  )
})

describe('SettingsService', () => {
  it.effect('update patches some fields and leaves the rest', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()

      const next = yield* settings.update({ renderDistance: 12, audioEnabled: true })

      expect(next.renderDistance).toBe(12)
      expect(next.audioEnabled).toBe(true)
      expect(next.fovDegrees).toBe(75)
      expect(next.mouseSensitivity).toBe(0.5)
    }),
  )

  it.effect('an out-of-range patch is normalised rather than stored', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()

      expect((yield* settings.update({ renderDistance: 999 })).renderDistance).toBe(16)
      expect(isValidSettings(yield* settings.snapshot)).toBe(true)
    }),
  )

  it.effect('a layer built from stored preferences is repaired on the way in', () =>
    Effect.gen(function* () {
      const restored = yield* Effect.flatMap(SettingsService, (service) => service.snapshot).pipe(
        Effect.provide(
          SettingsServiceLayer(withSettings({ fovDegrees: Number.NaN, renderDistance: 400 })),
        ),
      )

      expect(isValidSettings(restored)).toBe(true)
      expect(restored.fovDegrees).toBe(75)
      expect(restored.renderDistance).toBe(16)
    }),
  )

  it.effect('restore repairs a stored save rather than refusing it', () =>
    Effect.gen(function* () {
      // The second entry point. `makeSettingsService`'s header records what
      // happened elsewhere in this repository when only one entry point was
      // guarded: a layer built from stored values and `restore` disagreeing
      // about what "legal" means.
      const settings = yield* makeSettingsService()

      const fromDisk: Settings = {
        ...DEFAULT_SETTINGS,
        renderDistance: 400,
        fovDegrees: Number.NaN,
        audioEnabled: 'false' as unknown as boolean,
      }

      yield* settings.restore(fromDisk)
      const restored = yield* settings.snapshot

      expect(isValidSettings(restored)).toBe(true)
      expect(restored.renderDistance).toBe(16)
      expect(restored.fovDegrees).toBe(75)
      expect(restored.audioEnabled).toBe(false)
      expect(isValidSettings(fromDisk)).toBe(false)
    }),
  )

  it.effect('isValidSettings rejects a malformed keyBindings entry', () =>
    Effect.sync(() => {
      expect(isValidSettings(withSettings({ keyBindings: { '': 'KeyA' } }))).toBe(false)
      expect(isValidSettings(withSettings({ keyBindings: { jump: '' } }))).toBe(false)
      expect(
        isValidSettings(withSettings({ keyBindings: { jump: 123 as unknown as string } })),
      ).toBe(false)
    }),
  )

  it.effect('bindKey and unbindKey go through the Ref', () =>
    Effect.gen(function* () {
      const settings = yield* makeSettingsService()

      yield* settings.bindKey('jump', 'Space')
      expect(keyBindingFor(yield* settings.snapshot, 'jump')).toBe('Space')

      yield* settings.unbindKey('jump')
      expect(keyBindingFor(yield* settings.snapshot, 'jump')).toBeUndefined()
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

      yield* settings.update({ mouseSensitivity: 2.4, masterVolume: 0.2 })
      yield* settings.bindKey('jump', 'Space')
      yield* settings.reset

      // What reset does.
      expect(yield* settings.snapshot).toEqual(DEFAULT_SETTINGS)

      // What a world load must do INSTEAD: nothing. A second world reaches the
      // service with the preferences the first one left, which is what the
      // preview's second-world scenario has to keep true.
      yield* settings.update({ mouseSensitivity: 2.4 })
      const survivor = yield* settings.snapshot
      expect(survivor.mouseSensitivity).toBe(2.4)
    }),
  )
})
