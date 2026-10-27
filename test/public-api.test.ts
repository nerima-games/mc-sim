import { expect, it } from '@effect/vitest'
import { DeltaTimeSecs, FixedDurationSecs, PositionAxis, SimulationTick, position } from '@nerima-games/mc-kernel'
import { Effect, Result } from 'effect'
import {
  EntityId,
  DomainEventBus,
  DomainEventBusLayer,
  EventSubscriberCapacitySchema,
  IntentPayloadSchema,
  IntentQueue,
  IntentQueueLayer,
  IntentSchema,
  PlayerServiceSnapshotSchema,
  ReplicatedOwnerIdSchema,
  WorldCommitCoordinator,
  WorldCommitCoordinatorLayer,
  advanceFixedStep,
  migrateSimulationSaveV3,
  planExplosion,
  initialFixedStepAccumulator,
  pauseFixedStep,
  resumeFixedStep,
} from '../src/index.js'
import * as PublicApi from '../src/index.js'
import type * as PublicApiTypes from '../src/index.js'
import {
  fixedStepMainParityExpected,
  fixedStepMainParityInput,
  fixedStepParityCases,
} from './fixtures/effect4-parity/fixed-step.js'
import { explosionMainParityCases } from './fixtures/effect4-parity/explosion.js'
import { HeadlessHarness, HeadlessHarnessSessionFactory, HeadlessHarnessTestLayer } from '../src/testing/index.js'

type IntegratedPublicTypeSurface = readonly [
  PublicApiTypes.RecipeGridDimension,
  PublicApiTypes.RecipeId,
  PublicApiTypes.RecipeIngredientCount,
  PublicApiTypes.RecipePatternRow,
  PublicApiTypes.RecipePatternSymbol,
  PublicApiTypes.RecipePriority,
  PublicApiTypes.RecipeStationTag,
  PublicApiTypes.AnyOfIngredient,
  PublicApiTypes.CraftGrid,
  PublicApiTypes.CraftGridInput,
  PublicApiTypes.CraftingIngredient,
  PublicApiTypes.CraftingIngredientInput,
  PublicApiTypes.ExactIngredient,
  PublicApiTypes.Ingredient,
  PublicApiTypes.IngredientInput,
  PublicApiTypes.ItemTagIngredient,
  PublicApiTypes.ItemTagMemberships,
  PublicApiTypes.PatternCell,
  PublicApiTypes.Recipe,
  PublicApiTypes.RecipeCategory,
  PublicApiTypes.RecipeConflict,
  PublicApiTypes.RecipeConflictReason,
  PublicApiTypes.RecipeFailure,
  PublicApiTypes.RecipeGridIndex,
  PublicApiTypes.RecipeIngredientAssignment,
  PublicApiTypes.RecipeItemTag,
  PublicApiTypes.RecipeMatch,
  PublicApiTypes.RecipeMatchContext,
  PublicApiTypes.RecipeMatchWithAssignments,
  PublicApiTypes.RecipeOptions,
  PublicApiTypes.RecipePattern,
  PublicApiTypes.RecipePatternKeyMap,
  PublicApiTypes.RecipeTable,
  PublicApiTypes.ShapedRecipe,
  PublicApiTypes.ShapelessRecipe,
  PublicApiTypes.BrewingAdvanceResult,
  PublicApiTypes.BrewingBottles,
  PublicApiTypes.BrewingRecipe,
  PublicApiTypes.BrewingState,
  PublicApiTypes.BrewingStateInput,
  PublicApiTypes.BrewingValidationFailure,
  PublicApiTypes.BrewingFailure,
  PublicApiTypes.BrewingOutcome,
  PublicApiTypes.BrewingBottleResult,
  PublicApiTypes.BrewingFuelResult,
  PublicApiTypes.BrewingSnapshotValidationResult,
  PublicApiTypes.BrewingFuelCharges,
  PublicApiTypes.BrewingRecipeTable,
  PublicApiTypes.VanillaBrewingRecipe,
  PublicApiTypes.StarterBrewingRecipe,
  PublicApiTypes.BrewingRecipeInput,
  PublicApiTypes.CookingStation,
  PublicApiTypes.FurnaceAdvanceResult,
  PublicApiTypes.FurnaceState,
  PublicApiTypes.FurnaceStateInput,
  PublicApiTypes.FuelRule,
  PublicApiTypes.KernelSmeltingRecipe,
  PublicApiTypes.StarterSmeltingRecipe,
  PublicApiTypes.SmeltingRecipeInput,
  PublicApiTypes.StarterFuelRule,
  PublicApiTypes.FuelRuleInput,
  PublicApiTypes.FurnaceStateValidationFailure,
  PublicApiTypes.SmeltingValidationFailure,
  PublicApiTypes.FurnaceFailure,
  PublicApiTypes.FurnaceOutcome,
  PublicApiTypes.FurnaceTransferSlot,
  PublicApiTypes.FurnaceTransferRejection,
  PublicApiTypes.FurnaceTransferResult,
  PublicApiTypes.FurnaceTransferOutcome,
  PublicApiTypes.FurnaceTransferSelection,
  PublicApiTypes.FurnaceCollectionResult,
  PublicApiTypes.FurnaceCollectionOutcome,
  PublicApiTypes.FurnaceSnapshotValidationResult,
  PublicApiTypes.KernelFuelRule,
  PublicApiTypes.WorldContainerId,
  PublicApiTypes.AnvilMaterialCost,
  PublicApiTypes.AnvilPrimitiveFailure,
  PublicApiTypes.GrindstoneInput,
  PublicApiTypes.GrindstoneOutput,
  PublicApiTypes.GrindstoneFailureReason,
  PublicApiTypes.GrindstoneComponentFailure,
  PublicApiTypes.GrindstonePlan,
  PublicApiTypes.CookingRecipe,
  PublicApiTypes.CookingRecipeTable,
  PublicApiTypes.CookingInput,
  PublicApiTypes.CookingMatch,
  PublicApiTypes.CookingApplyResult,
  PublicApiTypes.SmithingTransformRecipe,
  PublicApiTypes.SmithingTrimRecipe,
  PublicApiTypes.SmithingRecipe,
  PublicApiTypes.SmithingRecipeTable,
  PublicApiTypes.SmithingInput,
  PublicApiTypes.SmithingInputInput,
  PublicApiTypes.SmithingOperation,
  PublicApiTypes.StonecuttingRecipe,
  PublicApiTypes.StonecuttingRecipeTable,
  PublicApiTypes.StonecuttingMatch,
  PublicApiTypes.StonecuttingApplyResult,
  PublicApiTypes.TransmuteMaterialSlotCount,
  PublicApiTypes.TransmuteMaterialCount,
  PublicApiTypes.TransmuteRecipe,
  PublicApiTypes.TransmuteRecipeTable,
  PublicApiTypes.TransmuteInput,
  PublicApiTypes.TransmuteMatch,
  PublicApiTypes.TransmuteApplyResult,
  PublicApiTypes.ContainerStorageServiceFailure,
  PublicApiTypes.ContainerStorageCommitOptions,
  PublicApiTypes.ContainerStorageTransferRequest,
  PublicApiTypes.ContainerStorageExtractRequest,
  PublicApiTypes.ContainerStorageMoveRequest,
  PublicApiTypes.ContainerStorageServiceApi,
  PublicApiTypes.BrewingServiceError,
  PublicApiTypes.BrewingServiceApi,
  PublicApiTypes.FurnaceServiceState,
  PublicApiTypes.FurnaceServiceError,
  PublicApiTypes.FurnaceServiceApi,
  PublicApiTypes.FishingRodPhase,
  PublicApiTypes.FishingRodState,
  PublicApiTypes.FishingState,
  PublicApiTypes.FishingOperation,
  PublicApiTypes.FishingInvalidStateReason,
  PublicApiTypes.FishingFailure,
  PublicApiTypes.FishingReelPlan,
  PublicApiTypes.FishingReelOutcome,
  PublicApiTypes.FishingServiceError,
  PublicApiTypes.FishingServiceApi,
  PublicApiTypes.ProjectileRecord,
  PublicApiTypes.ProjectileServiceSnapshot,
  PublicApiTypes.ProjectileLaunchRequest,
  PublicApiTypes.ProjectileLaunchOutcome,
  PublicApiTypes.ProjectileBlockHit,
  PublicApiTypes.ProjectileStepRequest,
  PublicApiTypes.EnderPearlImpact,
  PublicApiTypes.ProjectileStepOutcome,
  PublicApiTypes.ProjectileServiceError,
  PublicApiTypes.ProjectileServiceApi,
  PublicApiTypes.PrimedTntRecord,
  PublicApiTypes.TntServiceSnapshot,
  PublicApiTypes.TntPrimeRequest,
  PublicApiTypes.TntPrimeOutcome,
  PublicApiTypes.TntAdvanceRequest,
  PublicApiTypes.TntAdvanceOutcome,
  PublicApiTypes.TntServiceError,
  PublicApiTypes.TntServiceApi,
]

const integratedPublicTypeSurface: IntegratedPublicTypeSurface | undefined = undefined
void integratedPublicTypeSurface

const integratedPublicRuntimeExports = [
  'MAX_RECIPE_SIDE',
  'RecipeGridDimension',
  'RecipeId',
  'RecipeIngredientCount',
  'RecipePatternRow',
  'RecipePatternSymbol',
  'RecipePriority',
  'RecipeStationTag',
  'tagged',
  'anyOf',
  'craftingIngredient',
  'isAnyOfIngredient',
  'isCraftingIngredient',
  'isCraftingIngredientInput',
  'buildRecipeIndexes',
  'matchesShaped',
  'matchesShapeless',
  'matchesRecipe',
  'matchIndexedRecipe',
  'matchRecipeWithAssignments',
  'AnvilMaterialCost',
  'BREWING_MAX_FUEL_CHARGES',
  'COOKING_STATIONS',
  'VANILLA_BREWING_RECIPES',
  'VANILLA_FUEL_RULES',
  'VANILLA_SMELTING_RECIPES',
  'brewOnce',
  'brewingState',
  'consumeIngredient',
  'furnaceState',
  'matchBrewingRecipe',
  'selectFurnaceTransfer',
  'validateBrewingSnapshot',
  'GRINDSTONE_CURSE_ENCHANTMENT_IDS',
  'GRINDSTONE_DURABILITY_BONUS_PERCENT',
  'GRINDSTONE_REPAIR_COST_MAX',
  'enchantmentsComponentOf',
  'anvilEnchantmentsFromComponent',
  'grindstoneExperienceFor',
  'planGrindstone',
  'matchesCookingRecipe',
  'matchCookingRecipes',
  'matchCookingRecipe',
  'applyCooking',
  'SMITHING_STATION_TAG',
  'smithingInput',
  'matchesSmithingRecipe',
  'matchSmithingRecipe',
  'applySmithing',
  'matchSmithingRecipes',
  'STONECUTTING_STATION_TAG',
  'matchesStonecuttingRecipe',
  'matchStonecuttingRecipes',
  'matchStonecuttingRecipe',
  'applyStonecutting',
  'TRANSMUTE_MAX_MATERIAL_SLOTS',
  'matchesTransmuteRecipe',
  'matchTransmuteRecipes',
  'matchTransmuteRecipe',
  'applyTransmute',
  'CONTAINER_STORAGE_REPLICATED_OWNER_ID',
  'ContainerStorageSnapshotSchema',
  'PlayerStorageSnapshotSchema',
  'containerStorageOwnerRegistration',
  'playerStorageOwnerRegistration',
  'ContainerStorageService',
  'ContainerStorageServiceLayer',
  'makeContainerStorageService',
  'BrewingServiceStateSchema',
  'BrewingService',
  'BrewingServiceLayer',
  'makeBrewingServiceRegistration',
  'makeBrewingService',
  'FurnaceServiceStateSchema',
  'FurnaceService',
  'FurnaceServiceLayer',
  'makeFurnaceServiceRegistration',
  'makeFurnaceService',
  'FishingRodPhaseSchema',
  'FishingRodStateSchema',
  'FishingStateSchema',
  'emptyFishingState',
  'castFishingRod',
  'registerFishingBite',
  'reelFishingRod',
  'fishingLootForSample',
  'FishingInvalidState',
  'FishingInvalidLootRoll',
  'FishingService',
  'FishingServiceLayer',
  'fishingOwnerRegistration',
  'makeFishingService',
  'ProjectileServiceSnapshotSchema',
  'PROJECTILE_REPLICATED_OWNER_ID',
  'INITIAL_PROJECTILE_SERVICE_SNAPSHOT',
  'ProjectileServiceFailure',
  'ProjectileService',
  'ProjectileServiceLayer',
  'makeProjectileService',
  'TntServiceSnapshotSchema',
  'TNT_REPLICATED_OWNER_ID',
  'INITIAL_TNT_SERVICE_SNAPSHOT',
  'TntServiceFailure',
  'TntService',
  'TntServiceLayer',
  'tntOwnerRegistration',
  'makeTntService',
  'WorldContainerIdSchema',
  'worldContainerId',
  'worldContainerIdAt',
]

it('publishes the C1-C4 service and schema entry points', () => {
  expect(typeof migrateSimulationSaveV3).toBe('function')
  expect(IntentSchema).toBeDefined()
  expect(IntentPayloadSchema).toBeDefined()
  expect(IntentQueue).toBeDefined()
  expect(IntentQueueLayer).toBeDefined()
  expect(DomainEventBus).toBeDefined()
  expect(DomainEventBusLayer).toBeDefined()
  expect(EventSubscriberCapacitySchema).toBeDefined()
  expect(ReplicatedOwnerIdSchema).toBeDefined()
  expect(PlayerServiceSnapshotSchema).toBeDefined()
  expect(WorldCommitCoordinator).toBeDefined()
  expect(WorldCommitCoordinatorLayer).toBeDefined()
  expect(HeadlessHarness).toBeDefined()
  expect(HeadlessHarnessTestLayer).toBeDefined()
  expect(HeadlessHarnessSessionFactory).toBeDefined()
})

it('publishes recipe, item-state, station, and command-port APIs from the root barrel', () => {
  for (const name of integratedPublicRuntimeExports) {
    expect(PublicApi).toHaveProperty(name)
  }
})

const normalizeFixedStepResult = (result: ReturnType<typeof advanceFixedStep>) =>
  Result.isFailure(result)
    ? { _tag: 'Failure', error: result.failure }
    : { _tag: 'Success', value: result.success }

it.effect('preserves fixed-step outputs for Effect 4 parity inputs', () =>
  Effect.sync(() => {
    for (const row of fixedStepParityCases) {
      const state =
        row.tickDuration === undefined
          ? initialFixedStepAccumulator()
          : initialFixedStepAccumulator(SimulationTick(0), FixedDurationSecs(row.tickDuration))
      const result = advanceFixedStep(state, DeltaTimeSecs(row.delta))
      if (Result.isFailure(result)) throw new Error('fixed-step parity input failed')

      expect(result.success.ticks).toBe(row.ticks)
      expect(result.success.state.tick).toBe(row.tick)
      expect(result.success.state.accumulator).toBeCloseTo(row.remainder)
      expect(result.success.interpolationFraction).toBeCloseTo(row.fraction)
      expect(result.success.overloaded).toBe(row.overloaded)
    }
  }),
)

it.effect('matches fixed-step outputs recorded from the pre-migration main revision', () =>
  Effect.sync(() => {
    let state = initialFixedStepAccumulator(SimulationTick(fixedStepMainParityInput.initialTick))
    const sequence = fixedStepMainParityInput.deltas.map((delta) => {
      const result = advanceFixedStep(state, DeltaTimeSecs(delta))
      if (Result.isFailure(result)) return normalizeFixedStepResult(result)

      state = result.success.state
      return normalizeFixedStepResult(result)
    })
    const paused = pauseFixedStep(state)
    const pausedAdvance = normalizeFixedStepResult(
      advanceFixedStep(paused, DeltaTimeSecs(fixedStepMainParityInput.pausedDelta)),
    )
    const resumeAdvance = normalizeFixedStepResult(
      advanceFixedStep(resumeFixedStep(paused), DeltaTimeSecs(fixedStepMainParityInput.resumedDelta)),
    )
    const overflow = normalizeFixedStepResult(
      advanceFixedStep(
        initialFixedStepAccumulator(SimulationTick(fixedStepMainParityInput.overflowTick)),
        DeltaTimeSecs(fixedStepMainParityInput.overflowDelta),
      ),
    )

    expect({ sequence, pausedAdvance, resumeAdvance, overflow }).toEqual(fixedStepMainParityExpected)
  }),
)

it.effect('matches explosion outputs recorded from the pre-migration main revision', () =>
  Effect.sync(() => {
    for (const row of explosionMainParityCases) {
      const result = planExplosion({
        center: position(
          PositionAxis(row.input.center.x),
          PositionAxis(row.input.center.y),
          PositionAxis(row.input.center.z),
        ),
        radius: row.input.radius,
        seed: row.input.seed,
        blocks: ({ x, y, z }) => {
          if (row.input.blockWorld === 'all-destructible') {
            return { resistance: 0, destructible: true }
          }
          if (
            row.input.blockWorld === 'single-target' &&
            row.input.targetBlock !== undefined &&
            row.input.targetBlock.x === x &&
            row.input.targetBlock.y === y &&
            row.input.targetBlock.z === z
          ) {
            return { resistance: 0, destructible: true }
          }
          return { resistance: 0, destructible: false }
        },
        entities: row.input.entities.map((entity) => ({
          id: EntityId(entity.id),
          feetPosition: position(
            PositionAxis(entity.feetPosition.x),
            PositionAxis(entity.feetPosition.y),
            PositionAxis(entity.feetPosition.z),
          ),
        })),
        ...(row.input.limits === undefined ? {} : { limits: row.input.limits }),
      })

      expect(result).toEqual(row.expected)
    }
  }),
)
