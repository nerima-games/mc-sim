/**
 * @nerima-games/mc-sim — the game-state hub.
 *
 * PRE-AUDIT FIRST CUT (叩き台). See README.md 現状.
 *
 * plan.md §8 names this repository's public API the top project risk: every one
 * of mc-render, mc-playground-kit, mx-gameplay, mx-redstone, mx-ui and
 * mx-multiplayer consumes it, so a change here propagates to six repositories
 * at once. The barrel is therefore deliberately narrow and deliberately
 * explicit — `export *` from a module is a promise to keep everything in that
 * module stable, and this file makes that promise only where it is meant.
 *
 * The two things this repository exists to own, above all else:
 *
 *   - `CameraPoseSnapshot` — mc-sim is the AUTHORITY, mc-render is a MIRROR.
 *     `PlayerService.cameraPose` is the only publisher; nothing here accepts a
 *     pose from outside. See domain/camera-pose.ts.
 *
 *   - The frame loop's lifecycle — daemon-forked, explicitly stopped, and
 *     re-entrant from the first commit. See application/game-loop.ts.
 */

// --- Domain: pure values and transitions -----------------------------------
export * from './domain/camera-pose'
export * from './domain/block-targeting'
export * from './domain/crafting'
export * from './domain/entity'
export * from './domain/equipment'
export * from './domain/player-storage'
export * from './domain/frame-timing'
export * from './domain/inventory'
export * from './domain/recipe'
export * from './domain/settings'
export * from './domain/smelting'
export * from './domain/statistics'
export * from './domain/time-of-day'
export * from './domain/vitals'
export * from './domain/weather'

// --- Application: Effect services -------------------------------------------
export * from './application/autosave'
export * from './application/entity-manager'
export * from './application/equipment-service'
export * from './application/game-loop'
export * from './application/inventory-service'
export * from './application/player-service'
export * from './application/settings-service'
export * from './application/statistics-service'
export * from './application/time-service'
export * from './application/vitals-service'
export * from './application/weather-service'

// --- Stages: this repository's contribution to the frame ---------------------
// `sim:physics` is named in an `after` edge by mx-gameplay, mx-redstone, mx-ui
// and mc-render — every cross-repository ordering edge in the roster — so the
// registration is part of the published surface by definition: `simModule` is
// what a host merges, and `SIM_STAGE_IDS` is what a consumer names.
export * from './stages/registration'
export * from './stages/stage-ids'

// --- Provisional -------------------------------------------------------------
// `domain/kernel-vocabulary.ts` is a temporary local mirror of
// @nerima-games/mc-kernel and is NOT re-exported: consumers must take that
// vocabulary from kernel, not from mc-sim, or the mirror would become a second
// source of truth and the deletion described in that file would break them.
// Types that unavoidably appear in this repository's signatures
// (CameraPoseSnapshot, DeltaTimeSecs, ...) are structurally identical to
// kernel's, so a consumer importing them from kernel typechecks against these.
//
// `domain/worldgen-vocabulary.ts` is the same arrangement for
// @nerima-games/mc-worldgen, and is withheld from the barrel for the same
// reason: `Dimension` appears in `PlayerServiceApi.dimension`, `setDimension`
// and `restore`, and a consumer takes that word from mc-worldgen — which owns
// and publishes it — not from here. Two barrels exporting one closed union is
// the 「二つの綴り」 failure plan.md §3.4 describes, and re-exporting it would be
// this repository volunteering to be the second spelling.
