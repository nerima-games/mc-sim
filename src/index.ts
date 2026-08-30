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
export * from './domain/frame-timing.js'
export * from './domain/inventory.js'
export * from './domain/hotbar.js'
export * from './domain/recipe.js'
export * from './domain/recipe-data.js'
export * from './domain/settings.js'
export * from './domain/smelting.js'
export * from './domain/smelting-data.js'
export * from './domain/statistics.js'
export * from './domain/time-of-day.js'
export * from './domain/vitals.js'
export * from './domain/vehicle.js'
export * from './domain/weather.js'
export * from './domain/wither.js'

// --- Application: Effect services -------------------------------------------
export * from './application/autosave.js'
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

// --- Stages: this repository's contribution to the frame ---------------------
// `sim:physics` is named in an `after` edge by mx-gameplay, mx-redstone, mx-ui
// and mc-render — every cross-repository ordering edge in the roster — so the
// registration is part of the published surface by definition: `simModule` is
// what a host merges, and `SIM_STAGE_IDS` is what a consumer names.
export * from './stages/registration.js'
export * from './stages/stage-ids.js'

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
// the type owned and published by mc-worldgen, so consumers import it from
// that package instead of receiving a second spelling from this barrel.
