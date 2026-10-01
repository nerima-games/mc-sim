/**
 * @nerima-games/mc-sim — Minecraft simulation state and gameplay rules.
 *
 * The barrel exposes pure domain transitions, Effect services, save-format
 * integration, and frame-stage registration owned by this package. Shared
 * primitives and portable algorithms are imported directly from mc-kernel,
 * mc-physics, mc-save, and mc-worldgen.
 */

// --- Domain: pure values and transitions -----------------------------------
export * from './domain/camera-pose.js'
export * from './domain/block-targeting.js'
export * from './domain/block-interaction.js'
export * from './domain/brewing.js'
export * from './domain/brewing-data.js'
export * from './domain/enchantment.js'
export * from './domain/enchantment-data.js'
export * from './domain/enchantment-table.js'
export * from './domain/enchantment-table-data.js'
export * from './domain/save-data.js'
export * from './domain/container-storage.js'
export * from './domain/crafting.js'
export * from './domain/crop.js'
export * from './domain/entity.js'
export * from './domain/equipment.js'
export * from './domain/explosion.js'
export * from './domain/primed-tnt.js'
export * from './domain/projectile.js'
export * from './domain/player-storage.js'
export {
  advanceFixedStep,
  createFixedStepAccumulator,
  initialFixedStepAccumulator,
  MAX_CATCH_UP_TICKS,
  pauseFixedStep,
  resumeFixedStep,
  DEFAULT_TICK_DURATION,
} from './domain/fixed-step.js'
export type { FixedStepAccumulator, FixedStepAdvance } from './domain/fixed-step.js'
export * from './domain/inventory.js'
export * from './domain/hotbar.js'
export * from './domain/placement-consumption.js'
export * from './domain/recipe.js'
export * from './domain/recipe-data.js'
export * from './domain/smelting.js'
export * from './domain/smelting-data.js'
export * from './domain/statistics.js'
export * from './domain/time-of-day.js'
export * from './domain/vitals.js'
export * from './domain/vehicle.js'
export * from './domain/weather.js'
export * from './domain/wither.js'
export * from './domain/player-registry.js'
export * from './domain/container-state.js'
export * from './domain/furnace-state.js'
export * from './domain/end-state.js'
export * from './domain/portal-state.js'
export * from './domain/projectile-state.js'
export * from './domain/fluid-state.js'
export * from './domain/fishing-state.js'
export * from './domain/villager-state.js'

// --- Application: Effect services -------------------------------------------
export * from './application/autosave.js'
export * from './application/save-coordinator.js'
export * from './application/save-service.js'
export * from './application/crop-service.js'
export * from './application/entity-manager.js'
export * from './application/equipment-service.js'
export * from './application/game-loop.js'
export * from './application/inventory-service.js'
export * from './application/hotbar-service.js'
export * from './application/player-service.js'
export * from './application/settings-service.js'
export * from './application/statistics-service.js'
export * from './application/time-service.js'
export * from './application/vitals-service.js'
export * from './application/vehicle-service.js'
export * from './application/weather-service.js'
export * from './application/player-registry-service.js'
export * from './application/container-service.js'
export * from './application/furnace-service.js'
export * from './application/end-state-service.js'
export * from './application/portal-service.js'
export * from './application/projectile-charge-service.js'
export * from './application/fluid-service.js'
export * from './application/fishing-service.js'
export * from './application/villager-service.js'

// --- Stages: this repository's contribution to the frame ---------------------
// `sim:physics` is named in an `after` edge by mx-gameplay, mx-redstone, mx-ui
// and mc-render — every cross-repository ordering edge in the roster — so the
// registration is part of the published surface by definition: `simModule` is
// what a host merges, and `SIM_STAGE_IDS` is what a consumer names.
export * from './stages/registration.js'
export * from './stages/stage-ids.js'

export {
  FIRST_FRAME_DELTA_SECS,
  MAX_FRAME_DELTA_SECS,
  MIN_FRAME_DELTA_SECS,
  clampFrameDelta,
  frameDeltaBetween,
  frameDeltaLossBetween,
  frameDeltaLossSecs,
} from '@nerima-games/mc-kernel'

export {
  ANVIL_MAX_CUSTOM_NAME_LENGTH,
  ANVIL_REPAIR_BONUS_RATIO,
  ANVIL_SNAPSHOT_VERSION,
  ANVIL_TOO_EXPENSIVE_LEVEL,
  AnvilCustomName,
  AnvilEnchantmentId,
  AnvilSnapshotString,
  applyAnvil,
  decodeAnvilSnapshot,
  decodeAnvilSnapshotString,
  encodeAnvilSnapshot,
  isAnvilCustomName,
  isAnvilEnchantmentId,
  isAnvilSnapshotString,
  nextAnvilRepairCost,
  planAnvil,
  snapshotAnvilState,
} from '@nerima-games/mc-kernel'

export type {
  AnvilApplyResult,
  AnvilDurability,
  AnvilEnchantment,
  AnvilEnchantmentRule,
  AnvilInputStack,
  AnvilItemPayload,
  AnvilPlan,
  AnvilRepairMaterialRule,
  AnvilRejectionReason,
  AnvilRuleSet,
  AnvilSnapshot,
  AnvilSnapshotEncodingResult,
  AnvilSnapshotResult,
  AnvilState,
  AnvilValidationIssue,
  CanonicalAnvilItemPayload,
  CanonicalAnvilState,
} from '@nerima-games/mc-kernel'

// `Dimension` is intentionally not re-exported here. `PlayerServiceApi` uses
// the type owned and published by mc-kernel, so consumers import it from
// that package instead of receiving a second spelling from this barrel.

// Settings moved to mc-kernel 0.7.0 (merged with mc-compose's PlayerSettingsV1
// half of the same domain, see mc-kernel's CHANGELOG). `domain/settings.ts` no
// longer exists here — `application/settings-service.ts` is the Ref wrapper
// over kernel's rules, and this re-export keeps `Settings`/`DEFAULT_SETTINGS`/
// etc. reachable from this barrel exactly as they were before the move, same
// as the Anvil re-export above.
export {
  applySettings,
  DEFAULT_SETTINGS,
  GRAPHICS_QUALITIES,
  isGraphicsQuality,
  isValidSettings,
  keyBindingFor,
  MAX_FOV_DEGREES,
  MAX_MOUSE_SENSITIVITY,
  MAX_RENDER_DISTANCE,
  MAX_VOLUME,
  MIN_FOV_DEGREES,
  MIN_MOUSE_SENSITIVITY,
  MIN_RENDER_DISTANCE,
  MIN_VOLUME,
  normaliseSettings,
  rebindKey,
  unbindKey,
} from '@nerima-games/mc-kernel'

export type { GraphicsQuality, Settings } from '@nerima-games/mc-kernel'
