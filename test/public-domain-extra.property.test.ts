import fc from 'fast-check'
import { Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import { DeltaTimeSecs, PositionAxis, position } from '@nerima-games/mc-kernel'
import * as Sim from '../src/index.js'
import { assertResultContract, hostileNumber, hostileValue, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 30 }

const unwrap = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const makePosition = (x: number, y: number, z: number) =>
  position(PositionAxis(x), PositionAxis(y), PositionAxis(z))

it('fixed-step transitions and hotbar addressing stay bounded for hostile numbers', () => {
  const input = fc.record({
    accumulator: hostileNumber,
    tick: hostileNumber,
    duration: hostileNumber,
    catchUp: hostileNumber,
    delta: hostileNumber,
    paused: hostileValue,
    hotbarIndex: hostileNumber,
  })

  fc.assert(fc.property(input, (value) => {
    const initial = Sim.initialFixedStepAccumulator()
    const configured = Sim.createFixedStepAccumulator(
      value.tick as never,
      value.duration as never,
      value.catchUp,
    )
    const resumed = Sim.resumeFixedStep(Sim.pauseFixedStep(configured))
    expect(resumed.paused).toBe(false)
    expect(resumed.accumulator).toBe(0)

    const candidate = {
      ...initial,
      accumulator: value.accumulator as never,
      tick: value.tick as never,
      tickDuration: value.duration as never,
      maxCatchUpTicks: value.catchUp,
      paused: value.paused as never,
    }
    Sim.advanceFixedStep(candidate, value.delta as never)
    Sim.advanceFixedStep(initial, DeltaTimeSecs(0.05))

    expect(Sim.isHotbarIndex(0)).toBe(true)
    expect(typeof Sim.isHotbarIndex(value.hotbarIndex)).toBe('boolean')
    const slot = Sim.hotbarSlotIndex(value.hotbarIndex)
    expect(Number.isInteger(slot)).toBe(true)
    expect(slot).toBeGreaterThanOrEqual(Sim.HOTBAR_START)
    expect(slot).toBeLessThan(Sim.INVENTORY_SLOT_COUNT)
  }), checks)
})

it('crop lookup, harvest, and location helpers handle hostile growth values', () => {
  const input = fc.record({
    crop: fc.constantFrom(...Sim.CROP_TYPES),
    arbitraryCrop: unknownValue,
    growth: hostileNumber,
    x: fc.integer({ min: -100_000, max: 100_000 }),
    y: fc.integer({ min: -100_000, max: 100_000 }),
    z: fc.integer({ min: -100_000, max: 100_000 }),
  })

  fc.assert(fc.property(input, (value) => {
    expect(Sim.isCropType(value.crop)).toBe(true)
    expect(typeof Sim.isCropType(value.arbitraryCrop)).toBe('boolean')
    const definition = Sim.cropDefinitionFor(value.crop)
    expect(Sim.maturitySecsFor(value.crop)).toBe(definition.maturitySecs)
    expect(Sim.canPlantCrop(value.crop, definition.soil, 'overworld')).toBe(true)

    const crop = {
      dimension: 'overworld',
      position: { x: value.x, y: value.y, z: value.z },
      crop: value.crop,
      growthSecs: value.growth,
    } as unknown as Sim.CropState
    expect(typeof Sim.isMatureCrop(crop)).toBe('boolean')
    assertResultContract(
      'crop.matureYieldsFor(hostile crop)',
      () => Sim.matureYieldsFor(crop),
      Sim.MatureYieldsSchema,
      Sim.ItemStackFailureSchema,
    )
    const advanced = Sim.advanceCropByBoneMeal(crop)
    expect(advanced.growthSecs).toBeGreaterThanOrEqual(0)
    expect(advanced.growthSecs).toBeLessThanOrEqual(definition.maturitySecs)
    const validMaturity = Sim.matureYieldsFor({ ...crop, growthSecs: definition.maturitySecs } as never)
    assertResultContract(
      'crop.matureYieldsFor(mature crop)',
      () => validMaturity,
      Sim.MatureYieldsSchema,
      Sim.ItemStackFailureSchema,
    )
    expect(Sim.cropLocationKey(crop)).toBe(JSON.stringify([
      'overworld', value.x, value.y, value.z,
    ]))
  }), checks)
})

it('equipment predicates handle hostile fields and valid item transitions', () => {
  const input = fc.record({
    slot: hostileValue,
    item: hostileValue,
    current: hostileNumber,
    max: hostileNumber,
    durability: unknownValue,
  })

  fc.assert(fc.property(input, (value) => {
    expect(typeof Sim.isEquipmentSlot(value.slot)).toBe('boolean')
    expect(typeof Sim.isEquippableItemType(value.item as never)).toBe('boolean')
    expect(typeof Sim.isDamageableItemType(value.item as never)).toBe('boolean')
    Sim.equipmentDefinitionFor(value.item as never)
    Sim.itemDurabilityDefinitionFor(value.item as never)
    expect(typeof Sim.isDurability(value.durability)).toBe('boolean')
    expect(typeof Sim.isEquipmentItem(value.durability)).toBe('boolean')
    expect(typeof Sim.isValidDurabilityForItem('iron_helmet', value.durability)).toBe('boolean')
    Sim.durability(value.current, value.max)

    const helmetStack = unwrap(Sim.itemStack('iron_helmet', 1))
    const helmetDurability = Sim.durabilityForItem('iron_helmet')
    const helmetResult = Sim.equipmentItem(helmetStack, helmetDurability)
    const helmet = unwrap(helmetResult)
    expect(Sim.isEquipmentItem(helmet)).toBe(true)
    expect(Sim.isEquipmentItemForSlot('head', helmet)).toBe(true)
    const equipped = Sim.equip(Sim.emptyEquipment(), 'head', helmet)
    expect(Sim.equippedAt(equipped.equipment, 'head')).toEqual(helmet)
    const removed = Sim.unequip(equipped.equipment, 'head')
    expect(removed.result).toEqual(helmet)
    expect(Sim.equippedAt(removed.equipment, 'head')).toBeNull()
    const swapped = Sim.swapEquipment(equipped.equipment, 'head', 'feet')
    expect(swapped.slots.head).toEqual(helmet)
    expect(swapped.slots.feet).toBeNull()

    Sim.equipmentItem(helmetStack, value.durability as never)
  }), checks)
})

it('fishing state transitions and grindstone component conversions are total', () => {
  const input = fc.record({
    actorSerial: fc.nat({ max: 1_000_000 }),
    level: hostileNumber,
    count: hostileNumber,
    sample: hostileNumber,
  })

  fc.assert(fc.property(input, (value) => {
    const actor = Sim.EntityId(`property:${value.actorSerial}`)
    const bobber = `projectile:${value.actorSerial}` as never
    const cast = Sim.castFishingRod(Sim.emptyFishingState(), actor, bobber)
    if (Result.isFailure(cast)) return
    const bitten = Sim.registerFishingBite(cast.success, actor)
    if (Result.isFailure(bitten)) return
    const reeled = Sim.reelFishingRod(bitten.success, actor)
    if (Result.isSuccess(reeled)) {
      expect(reeled.success.outcome._tag).toBe('Caught')
      expect(reeled.success.state.rods).toHaveLength(0)
    }
    const duplicateCast = Sim.castFishingRod(cast.success, actor, bobber)
    expect(Result.isFailure(duplicateCast)).toBe(true)
    Sim.fishingLootForSample(value.sample)
    assertResultContract(
      'FishingStateSchema.decodeUnknownResult',
      () => Schema.decodeUnknownResult(Sim.FishingStateSchema)(
        Result.isSuccess(cast) ? cast.success : { rods: [] },
      ),
      Sim.FishingStateSchema,
      Sim.SchemaErrorSchema,
    )

    const enchantmentId = unwrap(Sim.AnvilEnchantmentId('sharpness'))
    const enchantments = Sim.enchantmentsComponentOf([{ id: enchantmentId, level: value.level }])
    if (Result.isSuccess(enchantments)) {
      Sim.anvilEnchantmentsFromComponent(enchantments.success)
    }
    const validEnchantments = Sim.enchantmentsComponentOf([{ id: enchantmentId, level: 1 }])
    if (Result.isSuccess(validEnchantments)) {
      Sim.anvilEnchantmentsFromComponent(validEnchantments.success)
    }
    Sim.anvilEnchantmentsFromComponent({ 'minecraft:sharpness': value.level } as never)
    const experience = Sim.grindstoneExperienceFor(value.count)
    expect(Number.isFinite(experience)).toBe(true)
    expect(experience).toBeGreaterThanOrEqual(0)
    expect(experience).toBeLessThanOrEqual(Sim.GRINDSTONE_REPAIR_COST_MAX)
  }), checks)
})

it('inventory and player-storage operations handle hostile indices and counts', () => {
  const input = fc.record({
    count: hostileNumber,
    index: hostileNumber,
    amount: hostileNumber,
    storedCount: fc.integer({ min: 1, max: 64 }),
    equipmentSlot: hostileValue,
  })

  fc.assert(fc.property(input, (value) => {
    assertResultContract(
      'inventory.itemStack(hostile count)',
      () => Sim.itemStack('stone', value.count),
      Sim.ItemStackSchema,
      Sim.ItemStackFailureSchema,
    )
    expect(Number.isFinite(Sim.maxStackCountForItem('stone'))).toBe(true)
    const stone = unwrap(Sim.itemStack('stone', 4))
    const inventory = { slots: [stone, ...Array.from({ length: Sim.INVENTORY_SLOT_COUNT - 1 }, () => undefined)] }
    expect(Sim.slotAt(inventory, value.index)).toBe(
      Number.isInteger(value.index) && value.index === 0 ? stone : inventory.slots[value.index],
    )
    expect(Number.isFinite(Sim.countOf(inventory, 'stone'))).toBe(true)
    expect(Sim.isEmpty(inventory)).toBe(false)
    Sim.addItemStack(Sim.emptyInventory(), stone)
    Sim.removeItemAt(inventory, value.index, 'stone', value.amount)
    Sim.removeItemAt(inventory, 0, 'stone', 1)
    Sim.removeItem(inventory, 'stone', value.amount)
    Sim.removeItem(inventory, 'stone', 1)

    const storage = Sim.storageFromInventory(Sim.emptyInventory())
    const withInventory = Sim.withInventory(storage, inventory)
    assertResultContract(
      'player-storage.withInventory',
      () => withInventory,
      Sim.PlayerStorageSnapshotSchema,
      Sim.PlayerStorageFailureSchema,
    )
    const storedStack = { ...unwrap(Sim.itemStack('stone', value.storedCount)), durability: null }
    Sim.addStoredStack(storage, storedStack)
    const rejectedStored = Sim.addStoredStack(storage, { ...storedStack, count: Number.NaN } as never)
    expect(rejectedStored.storage).toBe(storage)

    const helmet = unwrap(Sim.itemStack('iron_helmet', 1))
    const helmetInventory = { slots: [helmet, ...Array.from({ length: Sim.INVENTORY_SLOT_COUNT - 1 }, () => undefined)] }
    const helmetStorage = Sim.storageFromInventory(helmetInventory)
    Sim.equipFromInventory(helmetStorage, value.index, 'head')
    Sim.equipFromInventory(helmetStorage, 0, value.equipmentSlot as never)
    const actualEquip = Sim.equipFromInventory(helmetStorage, 0, 'head')
    if (actualEquip.result._tag === 'Equipped') {
      const returned = Sim.unequipToInventory(actualEquip.storage, 'head', value.index)
      if (Number.isInteger(value.index) && value.index === 0) {
        expect(returned.result._tag).toBe('Unequipped')
      }
    }

    const pickaxe = unwrap(Sim.itemStack('iron_pickaxe', 1))
    const pickaxeInventory = { slots: [pickaxe, ...Array.from({ length: Sim.INVENTORY_SLOT_COUNT - 1 }, () => undefined)] }
    const pickaxeStorage = Sim.storageFromInventory(pickaxeInventory)
    const damaged = Sim.damageAt(
      pickaxeStorage,
      { _tag: 'Inventory', slotIndex: 0 },
      value.amount,
    )
    if (!Number.isSafeInteger(value.amount as number) || (value.amount as number) <= 0) {
      expect(damaged.result._tag).toBe('InvalidAmount')
      expect(damaged.storage).toBe(pickaxeStorage)
    }
  }), checks)
})

it('crafting constructors, recipe matchers, indexes, and assignments handle hostile dimensions', () => {
  const input = fc.record({
    width: hostileNumber,
    height: hostileNumber,
    x: hostileNumber,
    y: hostileNumber,
    ingredientCount: hostileNumber,
    recipeSuffix: fc.nat({ max: 1_000_000 }),
  })

  fc.assert(fc.property(input, (value) => {
    Sim.exactly('oak_planks', value.ingredientCount)
    Sim.tagged('#minecraft:planks', value.ingredientCount)
    Sim.anyOf(['oak_planks', 'stone'], value.ingredientCount)
    Sim.craftGrid(value.width, value.height, [])

    const exact = unwrap(Sim.exactly('oak_planks', 1))
    const tagged = unwrap(Sim.tagged('#minecraft:planks', 1))
    const alternatives = unwrap(Sim.anyOf(['oak_planks', 'stone'], 1))
    expect(Sim.ingredientMatches(exact, 'oak_planks')).toBe(true)
    expect(typeof Sim.ingredientMatches(tagged, 'oak_planks')).toBe('boolean')
    expect(Sim.ingredientMatches(alternatives, 'oak_planks')).toBe(true)

    const output = unwrap(Sim.itemStack('stick', 1))
    const shaped = unwrap(Sim.shapedRecipe(
      `property:shaped-${value.recipeSuffix}`,
      ['P'],
      { P: 'oak_planks' },
      Result.succeed(output),
    ))
    const shapeless = unwrap(Sim.shapelessRecipe(
      `property:shapeless-${value.recipeSuffix}`,
      ['oak_planks'],
      Result.succeed(output),
    ))
    const grid = unwrap(Sim.craftGrid(1, 1, ['oak_planks']))
    expect(Sim.cellAt(grid, value.x, value.y)).toBe(
      Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y) && value.x === 0 && value.y === 0
        ? grid.cells[0]
        : undefined,
    )
    expect(Sim.ingredientCost(grid).get('oak_planks')).toBe(1)
    expect(Sim.matchesShaped(shaped, grid)).toBe(true)
    expect(Sim.matchesShapeless(shapeless, grid)).toBe(true)
    expect(Sim.matchesRecipe(shaped, grid)).toBe(true)

    const table = [shaped, shapeless]
    const indexes = Sim.buildRecipeIndexes(table)
    expect(Sim.matchIndexedRecipe(indexes, grid)?.id).toBeDefined()
    expect(Sim.matchRecipeWithAssignments(table, grid)._tag).toBe('Match')
    expect(Sim.matchRecipe(table, grid)._tag).toBe('Match')
    const duplicate = unwrap(Sim.RecipeId.result(`property:duplicate-${value.recipeSuffix}`))
    expect(Sim.conflictsIn([shaped, { ...shaped, id: duplicate }])).toHaveLength(1)

    const inventory = unwrap(Sim.addItem(Sim.emptyInventory(), 'oak_planks', 1)).inventory
    Sim.craftFromGrid(inventory, [shaped], grid)
  }), checks)
})

it('cooking, smithing, stonecutting, and transmute match valid structured recipes', () => {
  const input = fc.record({
    ingredientCount: fc.integer({ min: 1, max: 4 }),
    recipeSuffix: fc.nat({ max: 100_000 }),
    hostileContext: unknownValue,
  })

  fc.assert(fc.property(input, (value) => {
    const id = `property:station-${value.recipeSuffix}`
    const output = unwrap(Sim.itemStack('iron_ingot', 1))
    const ingredient = unwrap(Sim.exactly('iron_ore', 1))
    const inputStack = unwrap(Sim.itemStack('iron_ore', value.ingredientCount))
    const cooking = {
      _tag: 'Cooking', id: `${id}-cook`, station: 'furnace', ingredient,
      output, cookTimeTicks: 20, experience: 0.7, priority: 0,
    }
    Sim.matchesCookingRecipe(cooking, inputStack, { station: 'furnace' })
    Sim.matchesCookingRecipe(cooking, inputStack, value.hostileContext)
    Sim.matchCookingRecipes(inputStack, { station: 'furnace' }, [cooking])
    Sim.matchCookingRecipe(inputStack, { station: 'furnace' }, [cooking])
    Sim.applyCooking(cooking, inputStack, { station: 'furnace' })

    const smithing = {
      _tag: 'SmithingTransform', id: `${id}-smith`,
      template: unwrap(Sim.exactly('netherite_upgrade_smithing_template', 1)),
      base: unwrap(Sim.exactly('diamond_sword', 1)),
      addition: unwrap(Sim.exactly('netherite_ingot', 1)),
      output: unwrap(Sim.itemStack('netherite_sword', 1)),
      priority: 0, tags: ['smithing_table'],
    }
    const smithingInput = {
      template: unwrap(Sim.itemStack('netherite_upgrade_smithing_template', 1)),
      base: unwrap(Sim.itemStack('diamond_sword', 1)),
      addition: unwrap(Sim.itemStack('netherite_ingot', 1)),
    }
    Sim.smithingInput(smithingInput)
    Sim.matchesSmithingRecipe(smithing, smithingInput, {})
    Sim.matchSmithingRecipes(smithingInput, {}, [smithing])
    Sim.matchSmithingRecipe(smithingInput, {}, [smithing])
    Sim.applySmithing(smithingInput, {}, [smithing])

    const stonecutting = {
      _tag: 'Stonecutting', id: `${id}-stone`,
      ingredient: unwrap(Sim.exactly('stone', 1)), output,
      priority: 0,
    }
    const stone = unwrap(Sim.itemStack('stone', value.ingredientCount))
    Sim.matchesStonecuttingRecipe(stonecutting, stone, { station: 'stonecutter' })
    Sim.matchStonecuttingRecipes(stone, { station: 'stonecutter' }, [stonecutting])
    Sim.matchStonecuttingRecipe(stone, { station: 'stonecutter' }, [stonecutting])
    Sim.applyStonecutting(stonecutting, stone, { station: 'stonecutter' })

    const transmute = {
      _tag: 'Transmute', id: `${id}-transmute`,
      source: unwrap(Sim.exactly('dirt', 1)),
      material: unwrap(Sim.exactly('iron_ingot', 1)),
      output, materialCount: { min: 1, max: 1 },
      addMaterialCountToResult: true, priority: 0,
    }
    const grid = unwrap(Sim.craftGrid(3, 3, ['dirt', 'iron_ingot']))
    Sim.matchesTransmuteRecipe(transmute, grid, {})
    Sim.matchTransmuteRecipes(grid, {}, [transmute])
    Sim.matchTransmuteRecipe(grid, {}, [transmute])
    Sim.applyTransmute(transmute, grid, {})
  }), checks)
})

it('enchantment rules and anvil plans handle hostile levels and experience', () => {
  const input = fc.record({
    candidate: unknownValue,
    level: hostileNumber,
    experience: hostileNumber,
    costBase: fc.integer({ min: 0, max: 20 }),
    costPerLevel: fc.integer({ min: 0, max: 20 }),
  })

  fc.assert(fc.property(input, (value) => {
    expect(typeof Sim.isSupportedVanillaEnchantmentId(value.candidate)).toBe('boolean')
    Sim.enchantmentRuleFor(value.candidate)
    expect(typeof Sim.enchantmentAppliesTo(value.candidate, 'iron_sword')).toBe('boolean')
    expect(typeof Sim.enchantmentsConflict(value.candidate, 'sharpness')).toBe('boolean')
    Sim.enchantmentTableCostAtLevel({
      base: value.costBase,
      perLevelAboveFirst: value.costPerLevel,
    }, value.level)
    expect(Sim.enchantmentTableOutputItemOf('book')).toBe('enchanted_book')
    expect(Sim.enchantmentTableOutputItemOf('iron_sword')).toBe('iron_sword')

    const sharpness = unwrap(Sim.AnvilEnchantmentId('sharpness'))
    const plain = {
      item: 'iron_sword', durability: null, enchantments: [], repairCost: 0, customName: null,
    }
    const state = {
      left: plain,
      right: {
        payload: {
          item: 'enchanted_book', durability: null,
          enchantments: [{ id: sharpness, level: value.level }],
          repairCost: 0, customName: null,
        },
        count: 1,
      },
      rename: null,
      experienceLevels: value.experience,
    }
    Sim.planVanillaAnvil(state as never)
    Sim.applyVanillaAnvil(state as never)
    const validState = {
      left: plain,
      right: {
        payload: {
          item: 'enchanted_book', durability: null,
          enchantments: [{ id: sharpness, level: 1 }],
          repairCost: 0, customName: null,
        },
        count: 1,
      },
      rename: null,
      experienceLevels: 10,
    }
    expect(Sim.planVanillaAnvil(validState as never).ok).toBe(true)
    expect(Sim.applyVanillaAnvil(validState as never).ok).toBe(true)
  }), checks)
})

it('explosion, primed-TNT, and projectile transitions validate hostile scalars before producing state', () => {
  const input = fc.record({
    radius: hostileNumber,
    seed: hostileNumber,
    fuse: hostileNumber,
    delta: hostileNumber,
    yaw: hostileNumber,
    pitch: hostileNumber,
    speed: hostileNumber,
  })

  fc.assert(fc.property(input, (value) => {
    const center = makePosition(0.5, 0.5, 0.5)
    const request = {
      center,
      radius: value.radius,
      seed: value.seed,
      blocks: () => ({ resistance: 0, destructible: false }),
      entities: [],
    }
    assertResultContract(
      'explosion.validateExplosionRequest(hostile request)',
      () => Sim.validateExplosionRequest(request as never),
      Schema.Void,
      Sim.ExplosionValidationFailureSchema,
    )
    const validRequest = { ...request, radius: 1, seed: 7 }
    const plan = Sim.planExplosion(validRequest)
    assertResultContract(
      'explosion.planExplosion(valid request)',
      () => plan,
      Sim.ExplosionPlanSchema,
      Sim.ExplosionValidationFailureSchema,
    )
    if (Result.isSuccess(plan)) {
      let published = false
      Sim.applyExplosionPlan(plan.success, () => { published = true })
      expect(published).toBe(true)
    }

    const primed = Sim.primeTnt(value.fuse)
    if (Result.isSuccess(primed)) {
      const tntPlan = Sim.planPrimedTnt({
        ...validRequest,
        state: primed.success,
        deltaTimeSecs: value.delta,
      })
      if (Result.isSuccess(tntPlan)) {
        let published = false
        Sim.applyPrimedTntPlan(tntPlan.success, () => { published = true })
        expect(published).toBe(true)
      }
    }
    const validPrime = Sim.primeTnt(4)
    if (Result.isSuccess(validPrime)) {
      const validTntPlan = Sim.planPrimedTnt({
        ...validRequest,
        state: validPrime.success,
        deltaTimeSecs: 4,
      })
      if (Result.isSuccess(validTntPlan)) {
        let published = false
        Sim.applyPrimedTntPlan(validTntPlan.success, () => { published = true })
        expect(published).toBe(true)
      }
    }

    const launch = Sim.launchProjectile({
      position: center,
      yawRadians: value.yaw as never,
      pitchRadians: value.pitch as never,
      speed: value.speed as never,
    })
    const world = {
      blockBounds: () => [],
      bounds: {
        maxX: PositionAxis(10), maxY: PositionAxis(10), maxZ: PositionAxis(10),
        minX: PositionAxis(-10), minY: PositionAxis(-10), minZ: PositionAxis(-10),
      },
      entities: [],
      isInWater: () => false,
    }
    Sim.stepProjectile(launch, value.delta as never, world, Sim.ARROW_PROFILE)
    const validLaunch = Sim.launchProjectile({
      position: center,
      yawRadians: 0 as never,
      pitchRadians: 0 as never,
      speed: 3 as never,
    })
    expect(validLaunch.state).toBe('flying')
    expect(Sim.stepProjectile(validLaunch, 0.05 as never, world, Sim.ARROW_PROFILE).projectile.state).toBe('flying')
    for (const profile of [Sim.ARROW_PROFILE, Sim.EGG_PROFILE, Sim.SNOWBALL_PROFILE, Sim.TRIDENT_PROFILE]) {
      Sim.stepProjectile(validLaunch, 0.05 as never, world, profile)
    }
  }), checks)
})

it('legacy schemas gate hostile payloads and anvil codecs round-trip valid state', () => {
  const input = fc.record({
    value: unknownValue,
    encoded: fc.string({ maxLength: 96 }),
    tick: hostileNumber,
    x: hostileNumber,
  })

  fc.assert(fc.property(input, (value) => {
    assertResultContract(
      'LegacyItemStackSchema.decodeUnknownResult(hostile value)',
      () => Schema.decodeUnknownResult(Sim.LegacyItemStackSchema)(value.value),
      Sim.LegacyItemStackSchema,
      Sim.SchemaErrorSchema,
    )
    assertResultContract(
      'LegacySimulationSaveV3Schema.decodeUnknownResult(hostile value)',
      () => Schema.decodeUnknownResult(Sim.LegacySimulationSaveV3Schema)(value.value),
      Sim.LegacySimulationSaveV3Schema,
      Sim.SchemaErrorSchema,
    )
    expect(typeof Sim.SIMULATION_SAVE_FORMAT.name).toBe('string')
    expect(Number.isFinite(Sim.SIMULATION_SAVE_FORMAT.version)).toBe(true)
    expect(Sim.SIMULATION_SAVE_FORMAT.schema).toBe(Sim.SIMULATION_SAVE_SCHEMA)

    const stackWire = { item: 'stone', count: 2, components: null }
    assertResultContract(
      'LegacyItemStackSchema.decodeUnknownResult(valid stack)',
      () => Schema.decodeUnknownResult(Sim.LegacyItemStackSchema)(stackWire),
      Sim.LegacyItemStackSchema,
      Sim.SchemaErrorSchema,
    )
    const save = {
      dimension: 'overworld',
      tick: Math.max(0, Math.floor(Math.abs(Number.isFinite(value.tick) ? value.tick : 0) % 1_000_000)),
      player: {
        position: {
          x: Number.isFinite(value.x) ? value.x : 0,
          y: 64,
          z: 0,
        },
        inventory: [stackWire, null],
        selectedHotbarSlot: 0,
      },
      statistics: { counters: {}, unlocked: [] },
    }
    assertResultContract(
      'LegacySimulationSaveV3Schema.decodeUnknownResult(valid save)',
      () => Schema.decodeUnknownResult(Sim.LegacySimulationSaveV3Schema)(save),
      Sim.LegacySimulationSaveV3Schema,
      Sim.SchemaErrorSchema,
    )

    const anvilState = {
      left: {
        item: 'iron_sword', durability: null, enchantments: [], repairCost: 0, customName: null,
      },
      right: null,
      rename: null,
      experienceLevels: 0,
    }
    const snapshot = Sim.snapshotAnvilState(anvilState as never)
    expect(snapshot.ok).toBe(true)
    const encoded = Sim.encodeAnvilSnapshot(anvilState as never)
    expect(encoded.ok).toBe(true)
    if (encoded.ok) {
      expect(Sim.decodeAnvilSnapshot(encoded.snapshot)).toMatchObject({ ok: true })
      expect(Sim.decodeAnvilSnapshotString(encoded.encoded)).toMatchObject({ ok: true })
      expect(Sim.isAnvilSnapshotString(encoded.encoded)).toBe(true)
    }
    Sim.decodeAnvilSnapshot(value.value)
    Sim.decodeAnvilSnapshotString(value.encoded)
    expect(typeof Sim.isAnvilSnapshotString(value.encoded)).toBe('boolean')
  }), checks)
})
