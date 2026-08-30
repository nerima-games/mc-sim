import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'mc-sim-package-'))
const COMMAND_TIMEOUT_MS = 120_000

const run = (command, args, { cwd = root } = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
  })
  if (result.error !== undefined || result.status !== 0) {
    const reason = result.error?.message ?? (result.stderr?.trim() || `exit status ${String(result.status)}`)
    throw new Error(`${command} ${args.join(' ')} failed: ${reason}`)
  }
  return result.stdout
}

// Every value the barrel is contracted to export. A name dropping out of this
// list without a matching README/docs update is a public-API break; a name
// appearing that is not in this list means the dist build changed the export
// surface without a review of that change. Regenerate by running
// `npx tsx` against a temporary script that imports `src/index.ts` and prints
// `Object.keys(...)` — see the mc-physics `scripts/verify-package.mjs` this
// file's shape is copied from.
const expectedExports = [
  'ANVIL_MAX_CUSTOM_NAME_LENGTH',
  'ANVIL_REPAIR_BONUS_RATIO',
  'ANVIL_SNAPSHOT_VERSION',
  'ANVIL_TOO_EXPENSIVE_LEVEL',
  'ARROW_PROFILE',
  'AUTO_SAVE_INTERVAL',
  'AnvilCustomName',
  'AnvilEnchantmentId',
  'AnvilSnapshotString',
  'BONE_MEAL_GROWTH_SECS',
  'BREWING_BOTTLE_SLOTS',
  'BREWING_FUEL_CHARGES',
  'BREWING_FUEL_ITEM',
  'BREWING_TIME_SECS',
  'CHEST_CONTAINER_CAPACITY',
  'CONTAINER_STORAGE_SNAPSHOT_VERSION',
  'CROP_REGISTRY',
  'CROP_TYPES',
  'CropService',
  'CropServiceLayer',
  'DEFAULT_DAY_LENGTH_SECS',
  'DEFAULT_EXPLOSION_LIMITS',
  'DEFAULT_MAX_HEALTH_POINTS',
  'DEFAULT_MAX_HUNGER_POINTS',
  'DEFAULT_SETTINGS',
  'DEFAULT_TNT_FUSE_SECS',
  'DESPAWNED',
  'DISPENSER_CONTAINER_CAPACITY',
  'EGG_PROFILE',
  'EMPTY_STATISTICS',
  'ENCHANTMENT_TABLE_BOOK',
  'ENCHANTMENT_TABLE_ITEM_ENCHANTABILITY',
  'ENCHANTMENT_TABLE_MAX_BOOKSHELVES',
  'ENCHANTMENT_TABLE_SLOT_COUNT',
  'ENTITY_ID_PREFIX',
  'ENTITY_MANAGER_TAG_KEY',
  'EQUIPMENT_CATALOG',
  'EQUIPMENT_SLOTS',
  'EXHAUSTION_PER_POINT',
  'EXHAUSTION_PER_REGEN',
  'EXPERIENCE_MODULE_STAGE_PREFIXES',
  'EYE_LEVEL_OFFSET',
  'EntityId',
  'EntityKind',
  'EntityManagerLayer',
  'EquipmentService',
  'EquipmentServiceLayer',
  'FIRST_FRAME_DELTA_SECS',
  'FLINT_AND_STEEL_MAX_DURABILITY',
  'FOOD_TICK_SECS',
  'FRAME_QUEUE_CAPACITY',
  'GRAPHICS_QUALITIES',
  'GameLoop',
  'GameLoopLayer',
  'HOPPER_CONTAINER_CAPACITY',
  'HOTBAR_SIZE',
  'HOTBAR_START',
  'HotbarService',
  'HotbarServiceLayer',
  'INITIAL_PLAYER_DIMENSION',
  'INITIAL_PLAYER_POSE',
  'INITIAL_TIME_STATE',
  'INITIAL_WEATHER_STATE',
  'INVENTORY_SLOT_COUNT',
  'ITEM_DURABILITY_CATALOG',
  'InventoryService',
  'InventoryServiceLayer',
  'MAX_DAY_LENGTH_SECS',
  'MAX_EXHAUSTION',
  'MAX_FOV_DEGREES',
  'MAX_FRAME_DELTA_SECS',
  'MAX_MOUSE_SENSITIVITY',
  'MAX_RENDER_DISTANCE',
  'MAX_TIME_FRACTION',
  'MAX_TNT_FUSE_ADVANCE_SECS',
  'MAX_VOLUME',
  'MIN_DAY_LENGTH_SECS',
  'MIN_FOV_DEGREES',
  'MIN_FRAME_DELTA_SECS',
  'MIN_MOUSE_SENSITIVITY',
  'MIN_RENDER_DISTANCE',
  'MIN_VOLUME',
  'MOON_PHASE_COUNT',
  'NETHER_WART_MATURITY_SECS',
  'OWN_STAGE_PREFIX',
  'OccupantId',
  'PITCH_EPSILON',
  'PITCH_MAX_RADIANS',
  'PITCH_MIN_RADIANS',
  'POTATO_MATURITY_SECS',
  'PlayerService',
  'PlayerServiceLayer',
  'REGEN_HUNGER_THRESHOLD',
  'SIMULATION_SAVE_FORMAT',
  'SIMULATION_SAVE_SCHEMA',
  'SIM_STAGE_IDS',
  'SNOWBALL_PROFILE',
  'SPAWN_SATURATION',
  'SPAWN_VITALS',
  'STARTER_BREWING_RECIPES',
  'STARTER_FUEL_RULES',
  'STARTER_RECIPES',
  'STARTER_SMELTING_RECIPES',
  'SUPPORTED_VANILLA_ANVIL_RULE_SET',
  'SUPPORTED_VANILLA_BOOK_ANVIL_RULE_SET',
  'SUPPORTED_VANILLA_BOOK_ENCHANTMENT_RULES',
  'SUPPORTED_VANILLA_ENCHANTMENT_IDS',
  'SUPPORTED_VANILLA_ENCHANTMENT_RULES',
  'SUPPORTED_VANILLA_ITEM_ANVIL_RULE_SET',
  'SUPPORTED_VANILLA_ITEM_ENCHANTMENT_RULES',
  'SettingsService',
  'SettingsServiceLayer',
  'StatisticsService',
  'StatisticsServiceLayer',
  'TICKS_PER_SECOND',
  'TRIDENT_PROFILE',
  'TimeService',
  'TimeServiceLayer',
  'UNCHANGED',
  'UPSTREAM_STAGE_IDS',
  'VANILLA_ENCHANTMENT_COSTS',
  'VANILLA_ENCHANTMENT_TABLE_RULES',
  'VehicleId',
  'VehicleService',
  'VehicleServiceLayer',
  'VitalsService',
  'VitalsServiceLayer',
  'WEATHERS',
  'WHEAT_MATURITY_SECS',
  'WITHER_ARMOUR_THRESHOLD',
  'WITHER_FOLLOW_ACCELERATION',
  'WITHER_MAX_HEALTH',
  'WITHER_MAX_SPEED',
  'WITHER_REGEN_PER_SEC',
  'WITHER_SPAWN_CHARGE_SECS',
  'WeatherService',
  'WeatherServiceLayer',
  'activeBrewingRecipe',
  'addBrewingFuel',
  'addExhaustion',
  'addExperience',
  'addItem',
  'addStoredStack',
  'advance',
  'advanceBrewing',
  'advanceCrop',
  'advanceCropByBoneMeal',
  'advanceFoodTimer',
  'advanceFurnace',
  'applyAnvil',
  'applyDamage',
  'applyExplosionPlan',
  'applyLook',
  'applyPrimedTntPlan',
  'applySettings',
  'applyVanillaAnvil',
  'autoSaveSchedule',
  'bindKey',
  'breakBlock',
  'brewingRecipeFor',
  'calculateEnchantmentTableLevelCost',
  'cameraPoseOf',
  'canPlantCrop',
  'cellAt',
  'changed',
  'clampFrameDelta',
  'clampHotbarIndex',
  'clampPitch',
  'collectFurnaceOutput',
  'conflictsIn',
  'consumeAndDamageAt',
  'containerCapacity',
  'containerIdAt',
  'countOf',
  'countOfKind',
  'counterOf',
  'craftFromGrid',
  'craftGrid',
  'createContainer',
  'createWither',
  'cropDefinitionFor',
  'cropLocationKey',
  'cycleHotbarIndex',
  'damageAt',
  'damageEquipment',
  'damageWither',
  'dayLengthSecs',
  'decodeAnvilSnapshot',
  'decodeAnvilSnapshotString',
  'despawnEntity',
  'drainContainer',
  'durability',
  'durabilityForItem',
  'eat',
  'emptyBrewingState',
  'emptyContainer',
  'emptyContainerStorage',
  'emptyEquipment',
  'emptyFurnaceState',
  'emptyInventory',
  'emptyPlayerStorage',
  'emptyRoster',
  'emptyVehicleSnapshot',
  'enchantmentAppliesTo',
  'enchantmentRuleFor',
  'enchantmentTableCostAtLevel',
  'enchantmentTableOutputItemOf',
  'enchantmentTableRuleFor',
  'enchantmentsConflict',
  'encodeAnvilSnapshot',
  'entityManagerTag',
  'equip',
  'equipFromInventory',
  'equipmentDefinitionFor',
  'equipmentItem',
  'equippedAt',
  'exactly',
  'experienceCostOfLevel',
  'experienceLevel',
  'experienceProgress',
  'extractContainerItem',
  'findContainer',
  'findEntity',
  'forwardVector',
  'frameDeltaBetween',
  'frameDeltaLossBetween',
  'frameDeltaLossSecs',
  'generateEnchantmentTableOffers',
  'heal',
  'hotbarSlotIndex',
  'ingredientCost',
  'ingredientMatches',
  'isAnvilCustomName',
  'isAnvilEnchantmentId',
  'isAnvilSnapshotString',
  'isCropType',
  'isDamageableItemType',
  'isDead',
  'isDurability',
  'isEmpty',
  'isEnchantmentTableRuleId',
  'isEntityId',
  'isEntityKind',
  'isEquipmentItem',
  'isEquipmentItemForSlot',
  'isEquipmentSlot',
  'isEquippableItemType',
  'isGraphicsQuality',
  'isHotbarIndex',
  'isMatureCrop',
  'isNight',
  'isSupportedVanillaEnchantmentId',
  'isUnlocked',
  'isValidDurabilityForItem',
  'isValidSettings',
  'isValidStatistics',
  'isValidTimeState',
  'isValidVitals',
  'isValidWeatherState',
  'isWeather',
  'itemDurabilityDefinitionFor',
  'itemEnchantabilityOf',
  'itemStack',
  'keyBindingFor',
  'launchProjectile',
  'levelForTotalExperience',
  'listSimulationSaves',
  'loadSimulation',
  'makeControllableSimStagesWithPhysics',
  'makeCropService',
  'makeEntityManager',
  'makeEquipmentService',
  'makeGameLoop',
  'makeHotbarService',
  'makeInventoryService',
  'makePlayerService',
  'makeSettingsService',
  'makeSimFrameState',
  'makeSimInputPort',
  'makeSimStages',
  'makeSimStagesForPreview',
  'makeSimStagesWithPhysics',
  'makeStatisticsService',
  'makeTimeService',
  'makeVehicleService',
  'makeVitalsService',
  'makeWeatherService',
  'matchRecipe',
  'matchSmeltingRecipe',
  'matchWitherSummon',
  'matureYieldsFor',
  'maturitySecsFor',
  'maxStackCountForItem',
  'mintEntityId',
  'moonPhase',
  'moveContainerItem',
  'nextAnvilRepairCost',
  'normaliseInventory',
  'normaliseRoster',
  'normaliseSettings',
  'normaliseStatistics',
  'normaliseTimeState',
  'normaliseVitals',
  'normaliseWeatherState',
  'performAutoSaveTick',
  'placeBlock',
  'placeableBlockFromItem',
  'planAnvil',
  'planExplosion',
  'planPrimedTnt',
  'planVanillaAnvil',
  'primeTnt',
  'raycastArrowBlock',
  'record',
  'removeItem',
  'removeItemAt',
  'resetLandingImpact',
  'respawn',
  'restoreWither',
  'saveSimulation',
  'serialOfEntityId',
  'serializeWither',
  'setBrewingBottle',
  'setBrewingIngredient',
  'setDayLength',
  'setDayLengthThenTimeOfDay',
  'setTimeOfDay',
  'shapedRecipe',
  'shapelessRecipe',
  'simModule',
  'simStages',
  'simulationSaveKey',
  'slotAt',
  'snapshotAgeSecs',
  'snapshotAnvilState',
  'snapshotContainerStorage',
  'spawnEntity',
  'startAutoSaveDaemon',
  'stepProjectile',
  'stepWither',
  'storageFromInventory',
  'swapEquipment',
  'sweepRoster',
  'targetBlockFromCamera',
  'targetBlockFromPlayerPose',
  'timeOfDay',
  'totalExperienceAtLevel',
  'transferContainerItem',
  'transferToFurnace',
  'unbindKey',
  'unequip',
  'unequipToInventory',
  'unlock',
  'validateContainerStorageSnapshot',
  'validateCropSnapshot',
  'validateEquipmentSnapshot',
  'validateFurnaceSnapshot',
  'validatePlayerStorageSnapshot',
  'validateVehicleSnapshot',
  'vitalsView',
  'withFeetPosition',
  'withInventory',
  'witherSkullProjectile',
]

try {
  const packageSpecifier = [packageJson.name.split('/')[0], packageJson.name.split('/')[1]].join('/')
  const sim = await import(packageSpecifier)

  assert.deepEqual(Object.keys(sim).sort(), expectedExports)
  assert.equal(sim.HOTBAR_SIZE, 9)
  assert.equal(sim.EYE_LEVEL_OFFSET, 1.62)
  assert.equal(typeof sim.makeGameLoop, 'function')
  assert.equal(typeof sim.craftFromGrid, 'function')

  run('pnpm', ['pack', '--pack-destination', temporaryDirectory])
  const archiveName = readdirSync(temporaryDirectory).find((name) => name.endsWith('.tgz'))
  if (archiveName === undefined) {
    throw new Error('pnpm pack produced no archive')
  }

  const archive = join(temporaryDirectory, archiveName)
  const entries = new Set(run('tar', ['-tzf', archive]).split('\n').filter(Boolean))
  for (const entry of ['package/dist/index.js', 'package/dist/index.d.ts', 'package/LICENSE', 'package/README.md']) {
    if (!entries.has(entry)) {
      throw new Error(`package archive is missing ${entry}`)
    }
  }
  if ([...entries].some((entry) => entry.startsWith('package/src/'))) {
    throw new Error('package archive contains source files')
  }

  // Install the packed tarball in a clean consumer directory, exercising the
  // same dependency resolution a real downstream `npm install
  // @nerima-games/mc-sim` would go through: npm reads the tarball's own
  // package.json and fetches @nerima-games/mc-kernel, mc-physics, mc-save and
  // mc-worldgen from GitHub Packages, which — unlike a plain `import()` from
  // this repo's already-populated node_modules above — needs its own
  // registry auth. mc-audio's CI hit exactly this as `E401 … authentication
  // token not provided` in this step (org decision, 2026-08-30 14:15 JST).
  // NODE_AUTH_TOKEN must be set in the environment this script runs in
  // (ci.yaml / release.yaml set it; locally: `NODE_AUTH_TOKEN=$(gh auth
  // token)`). The `.npmrc` holds the literal `${NODE_AUTH_TOKEN}` placeholder
  // — npm expands env vars in `.npmrc` itself — never the token value.
  const nodeAuthToken = process.env['NODE_AUTH_TOKEN']
  if (nodeAuthToken === undefined || nodeAuthToken.length === 0) {
    throw new Error(
      'NODE_AUTH_TOKEN is not set; the consumer install needs it to resolve @nerima-games/* from GitHub Packages',
    )
  }
  const consumerDirectory = join(temporaryDirectory, 'consumer')
  mkdirSync(consumerDirectory)
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    JSON.stringify({ name: 'mc-sim-package-consumer', private: true, type: 'module' }, null, 2) + '\n',
  )
  writeFileSync(
    join(consumerDirectory, '.npmrc'),
    '@nerima-games:registry=https://npm.pkg.github.com\n' +
      '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}\n',
  )
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], {
    cwd: consumerDirectory,
  })

  const probe = `
    const sim = await import(${JSON.stringify(packageJson.name)})
    if (Object.keys(sim).length === 0) {
      throw new Error('The installed package has no runtime exports')
    }
    if (typeof sim.makeGameLoop !== 'function' || typeof sim.craftFromGrid !== 'function') {
      throw new Error('The installed package is missing expected exports')
    }
    console.log('verified installed ${packageJson.name}: ' + Object.keys(sim).length + ' exports')
  `
  run('node', ['--input-type=module', '--eval', probe], { cwd: consumerDirectory })

  process.stdout.write(`verified ${packageJson.name}: ${expectedExports.length} exports, archive ${archiveName}\n`)
} finally {
  rmSync(temporaryDirectory, { force: true, recursive: true })
}
