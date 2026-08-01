/**
 * Settings: the VALUES, held. Nothing here applies anything.
 *
 * docs/responsibility.md §2:
 *
 *   > 設定状態 | グラフィックス / 音量 / 操作の**値の保持**（画面は mx-ui、適用は各所）
 *
 * 値の保持 is the entire scope, and the two parentheses are the entire boundary.
 * A render distance of eight is a number here and a chunk-load radius in
 * mc-render; a master volume of 0.55 is a number here and a gain node in
 * mc-audio; a rebound key is a string here and a listener in mc-render, which is
 * where runtime input lives (docs/responsibility.md §3). This module has no
 * effects, no ports and no consumers of its own values — it is the place the
 * numbers survive a world load, and that is all.
 *
 * The rule for anything anybody wants to add: if the field would be READ here to
 * decide something, it does not belong here. `GRAPHICS_PRESETS` and
 * `resolvePreset` (ts-minecraft/packages/game/application/settings-service.config.ts:26-70)
 * turn `'high'` into fourteen renderer knobs including a `THREE` pixel-type
 * constant. That mapping is 適用, it is mc-render's, and mirroring it here would
 * put a renderer's tuning table in a package that is forbidden a THREE import.
 *
 * ---------------------------------------------------------------------------
 * What was deliberately NOT taken from the reference's Settings
 * ---------------------------------------------------------------------------
 *
 * The reference's `SettingsSchema` (packages/game/application/settings.schema.ts:48-78)
 * has eighteen fields. Nine are here. The refusals are the useful part:
 *
 *   - `dayLengthSeconds` (schema:54). **This is the important one.** mc-sim
 *     already owns the day length: it is the DENOMINATOR of `TimeState`, and
 *     `domain/time-of-day.ts` exists largely to explain what changing it does to
 *     the time of day. Holding it here too would be a second owner of one number
 *     inside a single repository — the same shape as the mistake
 *     `mx-gameplay/docs/architecture.md:142-148` records, where a duplicated day
 *     length disagreed with mc-sim's and surfaced as the sky jumping on world
 *     load. A settings screen that wants to change the day length calls
 *     `TimeService.setDayLength`, and gets that module's ordering warning with
 *     it. Note that the reference does exactly what is refused here, and that its
 *     own mid-session `setDayLength` call is the live bug named in
 *     `domain/time-of-day.ts`'s header.
 *   - `difficulty` (schema:55). Peaceful means hostile mobs do not spawn and
 *     hunger does not damage. That is a rule, in every direction, and rules are
 *     mx-gameplay's (plan.md §2.3-1). A four-member union held here would be a
 *     roster of gameplay modes in the state hub.
 *   - `reducedMotion`, `uiScale`, `colorVisionMode`, `audioCaptionsEnabled`
 *     (schema:56-65). Accessibility preferences whose every consumer is a
 *     screen; mx-ui already has `domain/accessibility.ts` and `domain/caption.ts`
 *     of its own. None of the three categories this row names is 表示.
 *   - `adaptivePerformanceMode` (schema:70). It is a graphics value and would
 *     have been defensible, but what it switches on is a mc-render algorithm
 *     that STEPS `graphicsQuality` DOWN at runtime. Holding the flag here while
 *     the algorithm rewrites the field beside it makes mc-render a second writer
 *     of a value mc-sim owns; it belongs wherever that algorithm does, and can
 *     come back the day mc-render asks for it.
 *   - `ResolvedGraphics` (schema:14-46), fourteen renderer knobs. 適用.
 */

// ---------------------------------------------------------------------------
// Graphics
// ---------------------------------------------------------------------------

/**
 * ts-minecraft/packages/game/application/settings.schema.ts:4.
 *
 * A closed union, unlike every other vocabulary this repository declines to
 * hold, and the difference is who owns the roster. `ItemType` and the mob kinds
 * belong to mc-kernel and mx-gameplay respectively, so a copy here would be a
 * second owner. The quality LEVELS have no other owner: they are the settings
 * screen's own alphabet, mc-render maps them to its presets rather than defining
 * them, and a `string` here would let a save carry `'ulra'` into a preset lookup
 * that silently answers `undefined`.
 */
export const GRAPHICS_QUALITIES = ['low', 'medium', 'high', 'ultra'] as const

export type GraphicsQuality = (typeof GRAPHICS_QUALITIES)[number]

export const isGraphicsQuality = (value: unknown): value is GraphicsQuality =>
  typeof value === 'string' && (GRAPHICS_QUALITIES as ReadonlyArray<string>).includes(value)

/** Chunk radius bounds. ts-minecraft/packages/game/application/settings.schema.ts:49. */
export const MIN_RENDER_DISTANCE = 2
export const MAX_RENDER_DISTANCE = 16

/**
 * Field-of-view bounds, degrees.
 * ts-minecraft/packages/game/application/settings.schema.ts:51-53, whose comment
 * gives the vanilla anchors: 「30 'zoom' … 110 'Quake Pro'; 70 normal」.
 */
export const MIN_FOV_DEGREES = 30
export const MAX_FOV_DEGREES = 110

/** Mouse sensitivity bounds. ts-minecraft/packages/game/application/settings.schema.ts:50. */
export const MIN_MOUSE_SENSITIVITY = 0.1
export const MAX_MOUSE_SENSITIVITY = 3

/** Volume bounds. ts-minecraft/packages/game/application/settings.schema.ts:75-77. */
export const MIN_VOLUME = 0
export const MAX_VOLUME = 1

export type Settings = {
  // --- graphics ---
  readonly renderDistance: number
  readonly fovDegrees: number
  readonly graphicsQuality: GraphicsQuality
  // --- volume ---
  readonly audioEnabled: boolean
  readonly masterVolume: number
  readonly musicVolume: number
  readonly sfxVolume: number
  // --- controls ---
  readonly mouseSensitivity: number
  /**
   * Rebinds only: action name to key code. An action absent here keeps whatever
   * default the input owner has, which is why this is a partial map and not a
   * complete one — a complete map would make mc-sim the owner of the roster of
   * actions, and the actions live in mc-render (plan.md §2.3-2).
   * ts-minecraft/packages/game/application/settings.schema.ts:66-68.
   */
  readonly keyBindings: Readonly<Record<string, string>>
}

/**
 * Fresh-user values, each transcribed from
 * ts-minecraft/packages/game/application/settings-service.ts:12-37.
 *
 * These are TRANSCRIPTIONS, not measurements, and the distinction is the one
 * `mx-gameplay/docs/responsibility.md` §5-4 insists on: several of them carry a
 * justification in the reference that cannot be re-derived from anything in this
 * repository. `renderDistance: 5` cites 「the perf floor measured in the parity
 * doc」 — a document mc-sim does not have and a measurement mc-sim cannot
 * repeat. `graphicsQuality: 'medium'` cites 「'low' renders at HALF resolution
 * … a permanently blurry first impression」, which is a claim about a renderer
 * that does not exist yet here. They are carried because the alternative is
 * inventing worse ones, and they are labelled so that whoever gets a real
 * measurement knows these were never it.
 *
 * `audioEnabled: false` is the one to read twice. The reference's schema comment
 * (settings.schema.ts:71-73) is emphatic —「do NOT change this to true」— and
 * its stated reason is that audio 「causes noise during development and
 * testing」. That is a reason about a development loop, not about players, so it
 * is carried verbatim AND flagged: a shipping default of "silent" would be a
 * dev-ergonomics decision that reached users because nobody re-read the comment.
 */
export const DEFAULT_SETTINGS: Settings = {
  renderDistance: 5,
  fovDegrees: 75,
  graphicsQuality: 'medium',
  audioEnabled: false,
  masterVolume: 0.8,
  musicVolume: 0.55,
  sfxVolume: 1,
  mouseSensitivity: 0.5,
  keyBindings: {},
}

// ---------------------------------------------------------------------------
// Totality
// ---------------------------------------------------------------------------

/**
 * `domain/time-of-day.ts` and `domain/vitals.ts` carry the same helper with the
 * same two-part argument: `Math.min`/`Math.max` propagate `NaN`, and the
 * `typeof` test catches the `undefined`/`null` that a field crossing a version
 * boundary wears while still satisfying `number`.
 */
const hasMagnitude = (value: number): boolean => typeof value === 'number' && !Number.isNaN(value)

/**
 * Clamp into [low, high], falling back to `fallback` when the value says nothing.
 *
 * The fallback is a PARAMETER here, where `domain/vitals.ts`'s equivalent sends
 * a magnitude-less value to `low`. Settings are the case where `low` is the
 * wrong answer: a cleared render-distance field snapping to 2 gives a player a
 * fog wall, and a cleared volume snapping to 0 gives them silence they did not
 * ask for and cannot explain. The fresh-user value is the only non-arbitrary
 * choice for a field that has stopped saying anything, which is the argument
 * `clampDayLengthSecs` makes for `DEFAULT_DAY_LENGTH_SECS`.
 *
 * An INFINITY still lands on the bound it points at: it has a direction.
 */
const clampWithDefault = (value: number, low: number, high: number, fallback: number): number =>
  hasMagnitude(value) ? Math.max(low, Math.min(high, value)) : fallback

/**
 * Repair settings read from persistence into values every consumer can act on.
 *
 * Every entry point goes through this — `makeSettingsService`'s initial value,
 * `restore`, and `applySettings` — so a screen writing a field and a save file
 * carrying one cannot disagree about what is legal. The precedent and the reason
 * are `normaliseTimeState`'s: the world-load path has no error channel, and
 * failing a load over a render distance turns a repairable save into an
 * unopenable one.
 *
 * `renderDistance` is FLOORED as well as clamped, because it is a chunk radius
 * and 5.5 chunks is not a thing a loader can be asked for. The other numbers are
 * continuous and are left as they arrive.
 */
export const normaliseSettings = (settings: Settings): Settings => ({
  renderDistance: Math.floor(
    clampWithDefault(
      settings.renderDistance,
      MIN_RENDER_DISTANCE,
      MAX_RENDER_DISTANCE,
      DEFAULT_SETTINGS.renderDistance,
    ),
  ),
  fovDegrees: clampWithDefault(
    settings.fovDegrees,
    MIN_FOV_DEGREES,
    MAX_FOV_DEGREES,
    DEFAULT_SETTINGS.fovDegrees,
  ),
  graphicsQuality: isGraphicsQuality(settings.graphicsQuality)
    ? settings.graphicsQuality
    : DEFAULT_SETTINGS.graphicsQuality,
  // Strictly `=== true`, not truthiness. A save carrying the string `'false'`
  // is a real shape at this boundary, and `Boolean('false')` is `true` — the
  // one coercion that turns a stored NO into a YES.
  audioEnabled: settings.audioEnabled === true,
  masterVolume: clampWithDefault(
    settings.masterVolume,
    MIN_VOLUME,
    MAX_VOLUME,
    DEFAULT_SETTINGS.masterVolume,
  ),
  musicVolume: clampWithDefault(
    settings.musicVolume,
    MIN_VOLUME,
    MAX_VOLUME,
    DEFAULT_SETTINGS.musicVolume,
  ),
  sfxVolume: clampWithDefault(settings.sfxVolume, MIN_VOLUME, MAX_VOLUME, DEFAULT_SETTINGS.sfxVolume),
  mouseSensitivity: clampWithDefault(
    settings.mouseSensitivity,
    MIN_MOUSE_SENSITIVITY,
    MAX_MOUSE_SENSITIVITY,
    DEFAULT_SETTINGS.mouseSensitivity,
  ),
  keyBindings: normaliseKeyBindings(settings.keyBindings),
})

/**
 * Keep only the entries that are a string bound to a string.
 *
 * Non-string entries are DROPPED rather than coerced, matching
 * `normaliseStatistics`: a key code has no meaningful nearest legal value, and
 * coercing one would bind an action to a key that no keyboard produces — an
 * input that silently does nothing and looks, to the player, exactly like a
 * broken game.
 */
const normaliseKeyBindings = (
  bindings: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> => {
  const source: unknown = bindings
  if (typeof source !== 'object' || source === null) {
    return {}
  }

  const kept: Record<string, string> = {}
  for (const [action, code] of Object.entries(source as Record<string, unknown>)) {
    if (typeof code === 'string' && code.length > 0 && action.length > 0) {
      kept[action] = code
    }
  }
  return kept
}

/**
 * Change some settings and leave the rest.
 *
 * A whole-value patch rather than a setter per field, because a settings screen
 * changes several at once and nine setters would be nine public-API entries for
 * six consumers to track. `keyBindings`, when present in a patch, REPLACES the
 * map rather than merging into it — the map is already the override set, so a
 * merge would make removing a rebind impossible. `bindKey` and `unbindKey` are
 * how a screen edits one entry.
 */
export const applySettings = (current: Settings, patch: Partial<Settings>): Settings =>
  normaliseSettings({ ...current, ...patch })

/** The key bound to an action, or `undefined` when the action keeps its default. */
export const keyBindingFor = (settings: Settings, action: string): string | undefined =>
  settings.keyBindings[action]

/** Rebind one action. A blank action or code is refused rather than stored. */
export const bindKey = (settings: Settings, action: string, code: string): Settings =>
  action.length === 0 || code.length === 0
    ? settings
    : { ...settings, keyBindings: { ...settings.keyBindings, [action]: code } }

/** Drop one rebind, returning the action to whatever default the input owner has. */
export const unbindKey = (settings: Settings, action: string): Settings => {
  if (settings.keyBindings[action] === undefined) {
    return settings
  }

  const kept: Record<string, string> = {}
  for (const [bound, code] of Object.entries(settings.keyBindings)) {
    if (bound !== action) {
      kept[bound] = code
    }
  }
  return { ...settings, keyBindings: kept }
}

/**
 * Would every consumer be able to act on these values as they stand?
 *
 * Exported for the reason `isValidTimeState`, `isValidVitals` and
 * `isValidStatistics` are: mc-save distinguishes a save it must repair from one
 * it may load verbatim, and `restore` has no error channel to say which it got.
 */
export const isValidSettings = (settings: Settings): boolean =>
  Number.isInteger(settings.renderDistance) &&
  settings.renderDistance >= MIN_RENDER_DISTANCE &&
  settings.renderDistance <= MAX_RENDER_DISTANCE &&
  Number.isFinite(settings.fovDegrees) &&
  settings.fovDegrees >= MIN_FOV_DEGREES &&
  settings.fovDegrees <= MAX_FOV_DEGREES &&
  isGraphicsQuality(settings.graphicsQuality) &&
  typeof settings.audioEnabled === 'boolean' &&
  [settings.masterVolume, settings.musicVolume, settings.sfxVolume].every(
    (volume) => Number.isFinite(volume) && volume >= MIN_VOLUME && volume <= MAX_VOLUME,
  ) &&
  Number.isFinite(settings.mouseSensitivity) &&
  settings.mouseSensitivity >= MIN_MOUSE_SENSITIVITY &&
  settings.mouseSensitivity <= MAX_MOUSE_SENSITIVITY &&
  typeof settings.keyBindings === 'object' &&
  settings.keyBindings !== null &&
  Object.entries(settings.keyBindings).every(
    ([action, code]) => action.length > 0 && typeof code === 'string' && code.length > 0,
  )
