/**
 * @nerima-games/mc-sim — Minecraft simulation state and gameplay rules.
 *
 * The barrel exposes pure domain transitions, Effect services, save-format
 * integration, and frame-stage registration owned by this package. Shared
 * primitives and portable algorithms are imported directly from mc-kernel,
 * mc-physics, mc-save, and mc-worldgen.
 */

// --- Domain: pure values and transitions -----------------------------------
export * from './domain/camera-pose'
export * from './domain/block-targeting'
export * from './domain/block-interaction'
export * from './domain/brewing'
export * from './domain/brewing-data'
export * from './domain/enchantment'
export * from './domain/enchantment-data'
export * from './domain/enchantment-table'
export * from './domain/enchantment-table-data'
export * from './domain/save-data'
export * from './domain/container-storage'
export * from './domain/crafting'
export * from './domain/crop'
export * from './domain/entity'
export * from './domain/equipment'
export * from './domain/explosion'
export * from './domain/primed-tnt'
export * from './domain/projectile'
export * from './domain/player-storage'
export * from './domain/frame-timing'
export * from './domain/inventory'
export * from './domain/hotbar'
export * from './domain/recipe'
export * from './domain/recipe-data'
export * from './domain/settings'
export * from './domain/smelting'
export * from './domain/smelting-data'
export * from './domain/statistics'
export * from './domain/time-of-day'
export * from './domain/vitals'
export * from './domain/vehicle'
export * from './domain/weather'
export * from './domain/wither'

// --- Application: Effect services -------------------------------------------
export * from './application/autosave'
export * from './application/save-service'
export * from './application/crop-service'
export * from './application/entity-manager'
export * from './application/equipment-service'
export * from './application/game-loop'
export * from './application/inventory-service'
export * from './application/hotbar-service'
export * from './application/player-service'
export * from './application/settings-service'
export * from './application/statistics-service'
export * from './application/time-service'
export * from './application/vitals-service'
export * from './application/vehicle-service'
export * from './application/weather-service'

// --- Stages: this repository's contribution to the frame ---------------------
// `sim:physics` is named in an `after` edge by mx-gameplay, mx-redstone, mx-ui
// and mc-render — every cross-repository ordering edge in the roster — so the
// registration is part of the published surface by definition: `simModule` is
// what a host merges, and `SIM_STAGE_IDS` is what a consumer names.
export * from './stages/registration'
export * from './stages/stage-ids'

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
