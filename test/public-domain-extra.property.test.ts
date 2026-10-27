import fc from 'fast-check'
import { Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import { DeltaTimeSecs, PositionAxis, position } from '@nerima-games/mc-kernel'
import * as Sim from '../src/index.js'
import { assertResultContract, finiteTree, hostileNumber, hostileValue, isRecord, unknownValue } from './public-property-helpers.js'

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
    assertResultContract(Sim.advanceFixedStep(candidate, value.delta as never), (success) => {
      if (!isRecord(success)) return false
      return Number.isFinite(success['interpolationFraction']) &&
        Number(success['interpolationFraction']) >= 0 && Number(success['interpolationFraction']) <= 1 &&
        Number.isSafeInteger(success['ticks']) && Number(success['ticks']) >= 0
    })
    assertResultContract(Sim.advanceFixedStep(initial, DeltaTimeSecs(0.05)))

    expect(Sim.isHotbarIndex(0)).toBe(true)
    expect(typeof Sim.isHotbarIndex(value.hotbarIndex)).toBe('boolean')
    const slot = Sim.hotbarSlotIndex(value.hotbarIndex)
    expect(Number.isInteger(slot)).toBe(true)
    expect(slot).toBeGreaterThanOrEqual(Sim.HOTBAR_START)
    expect(slot).toBeLessThan(Sim.INVENTORY_SLOT_COUNT)
  }), checks)
})

it('crop lookup, harvest, and location helpers preserve finite structured state', () => {
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
    assertResultContract(Sim.matureYieldsFor(crop))
    const advanced = Sim.advanceCropByBoneMeal(crop)
    expect(finiteTree(advanced)).toBe(true)
    expect(advanced.growthSecs).toBeGreaterThanOrEqual(0)
    expect(advanced.growthSecs).toBeLessThanOrEqual(definition.maturitySecs)
    const validMaturity = Sim.matureYieldsFor({ ...crop, growthSecs: definition.maturitySecs } as never)
    assertResultContract(validMaturity)
    expect(Sim.cropLocationKey(crop)).toBe(JSON.stringify([
      'overworld', value.x, value.y, value.z,
    ]))
  }), checks)
})

it('equipment validators and slot transitions reject hostile fields or keep valid items branded', () => {
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
    expect(Sim.equipmentDefinitionFor(value.item as never) === undefined || isRecord(Sim.equipmentDefinitionFor(value.item as never))).toBe(true)
    expect(Sim.itemDurabilityDefinitionFor(value.item as never) === undefined || isRecord(Sim.itemDurabilityDefinitionFor(value.item as never))).toBe(true)
    expect(typeof Sim.isDurability(value.durability)).toBe('boolean')
    expect(typeof Sim.isEquipmentItem(value.durability)).toBe('boolean')
    expect(typeof Sim.isValidDurabilityForItem('iron_helmet', value.durability)).toBe('boolean')
    assertResultContract(Sim.durability(value.current, value.max))

    const helmetStack = unwrap(Sim.itemStack('iron_helmet', 1))
    const helmetDurability = Sim.durabilityForItem('iron_helmet')
    const helmetResult = Sim.equipmentItem(helmetStack, helmetDurability)
    assertResultContract(helmetResult)
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

    assertResultContract(Sim.equipmentItem(helmetStack, value.durability as never))
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
    assertResultContract(cast)
    if (Result.isFailure(cast)) return
    const bitten = Sim.registerFishingBite(cast.success, actor)
    assertResultContract(bitten)
    if (Result.isFailure(bitten)) return
    const reeled = Sim.reelFishingRod(bitten.success, actor)
    assertResultContract(reeled)
    if (Result.isSuccess(reeled)) {
      expect(reeled.success.outcome._tag).toBe('Caught')
      expect(reeled.success.state.rods).toHaveLength(0)
    }
    const duplicateCast = Sim.castFishingRod(cast.success, actor, bobber)
    expect(Result.isFailure(duplicateCast)).toBe(true)
    assertResultContract(Sim.fishingLootForSample(value.sample))
    assertResultContract(Schema.decodeUnknownResult(Sim.FishingStateSchema)(
      Result.isSuccess(cast) ? cast.success : { rods: [] },
    ))

    const enchantmentId = unwrap(Sim.AnvilEnchantmentId('sharpness'))
    const enchantments = Sim.enchantmentsComponentOf([{ id: enchantmentId, level: value.level }])
    assertResultContract(enchantments)
    if (Result.isSuccess(enchantments)) {
      assertResultContract(Sim.anvilEnchantmentsFromComponent(enchantments.success))
    }
    const validEnchantments = Sim.enchantmentsComponentOf([{ id: enchantmentId, level: 1 }])
    assertResultContract(validEnchantments)
    if (Result.isSuccess(validEnchantments)) {
      assertResultContract(Sim.anvilEnchantmentsFromComponent(validEnchantments.success))
    }
    assertResultContract(Sim.anvilEnchantmentsFromComponent({ 'minecraft:sharpness': value.level } as never))
    const experience = Sim.grindstoneExperienceFor(value.count)
    expect(Number.isFinite(experience)).toBe(true)
    expect(experience).toBeGreaterThanOrEqual(0)
    expect(experience).toBeLessThanOrEqual(Sim.GRINDSTONE_REPAIR_COST_MAX)
  }), checks)
})

it('inventory and player-storage operations keep hostile indices and counts typed', () => {
  const input = fc.record({
    count: hostileNumber,
    index: hostileNumber,
    amount: hostileNumber,
    storedCount: fc.integer({ min: 1, max: 64 }),
    equipmentSlot: hostileValue,
  })

  fc.assert(fc.property(input, (value) => {
    assertResultContract(Sim.itemStack('stone', value.count))
    expect(Number.isFinite(Sim.maxStackCountForItem('stone'))).toBe(true)
    const stone = unwrap(Sim.itemStack('stone', 4))
    const inventory = { slots: [stone, ...Array.from({ length: Sim.INVENTORY_SLOT_COUNT - 1 }, () => undefined)] }
    expect(Sim.slotAt(inventory, value.index)).toBe(
      Number.isInteger(value.index) && value.index === 0 ? stone : inventory.slots[value.index],
    )
    expect(Number.isFinite(Sim.countOf(inventory, 'stone'))).toBe(true)
    expect(Sim.isEmpty(inventory)).toBe(false)
    assertResultContract(Sim.addItemStack(Sim.emptyInventory(), stone))
    assertResultContract(Sim.removeItemAt(inventory, value.index, 'stone', value.amount))
    assertResultContract(Sim.removeItemAt(inventory, 0, 'stone', 1))
    assertResultContract(Sim.removeItem(inventory, 'stone', value.amount))
    assertResultContract(Sim.removeItem(inventory, 'stone', 1))

    const storage = Sim.storageFromInventory(Sim.emptyInventory())
    const withInventory = Sim.withInventory(storage, inventory)
    assertResultContract(withInventory)
    const storedStack = { ...unwrap(Sim.itemStack('stone', value.storedCount)), durability: null }
    const addedStored = Sim.addStoredStack(storage, storedStack)
    expect(isRecord(addedStored)).toBe(true)
    expect(typeof addedStored.result._tag).toBe('string')
    expect(finiteTree(addedStored)).toBe(true)
    const rejectedStored = Sim.addStoredStack(storage, { ...storedStack, count: value.count } as never)
    expect(typeof rejectedStored.result._tag).toBe('string')
    expect(finiteTree(rejectedStored)).toBe(true)

    const helmet = unwrap(Sim.itemStack('iron_helmet', 1))
    const helmetInventory = { slots: [helmet, ...Array.from({ length: Sim.INVENTORY_SLOT_COUNT - 1 }, () => undefined)] }
    const helmetStorage = Sim.storageFromInventory(helmetInventory)
    const equipped = Sim.equipFromInventory(helmetStorage, value.index, 'head')
    expect(typeof equipped.result._tag).toBe('string')
    expect(finiteTree(equipped)).toBe(true)
    const invalidSlotEquip = Sim.equipFromInventory(helmetStorage, 0, value.equipmentSlot as never)
    expect(typeof invalidSlotEquip.result._tag).toBe('string')
    expect(finiteTree(invalidSlotEquip)).toBe(true)
    const actualEquip = Sim.equipFromInventory(helmetStorage, 0, 'head')
    if (actualEquip.result._tag === 'Equipped') {
      const returned = Sim.unequipToInventory(actualEquip.storage, 'head', value.index)
      expect(typeof returned.result._tag).toBe('string')
      expect(finiteTree(returned)).toBe(true)
    }

    const pickaxe = unwrap(Sim.itemStack('iron_pickaxe', 1))
    const pickaxeInventory = { slots: [pickaxe, ...Array.from({ length: Sim.INVENTORY_SLOT_COUNT - 1 }, () => undefined)] }
    const pickaxeStorage = Sim.storageFromInventory(pickaxeInventory)
    const damaged = Sim.damageAt(
      pickaxeStorage,
      { _tag: 'Inventory', slotIndex: 0 },
      value.amount,
    )
    expect(typeof damaged.result._tag).toBe('string')
    if (damaged.result._tag !== 'InvalidAmount') expect(finiteTree(damaged)).toBe(true)
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
    assertResultContract(Sim.exactly('oak_planks', value.ingredientCount))
    assertResultContract(Sim.tagged('#minecraft:planks', value.ingredientCount))
    assertResultContract(Sim.anyOf(['oak_planks', 'stone'], value.ingredientCount))
    assertResultContract(Sim.craftGrid(value.width, value.height, []), (success) =>
      isRecord(success) && Number.isInteger(success['width']) && Number.isInteger(success['height']),
    )

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
    assertResultContract(Sim.craftFromGrid(inventory, [shaped], grid))
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
    assertResultContract(Sim.matchesCookingRecipe(cooking, inputStack, { station: 'furnace' }))
    assertResultContract(Sim.matchesCookingRecipe(cooking, inputStack, value.hostileContext))
    assertResultContract(Sim.matchCookingRecipes(inputStack, { station: 'furnace' }, [cooking]))
    assertResultContract(Sim.matchCookingRecipe(inputStack, { station: 'furnace' }, [cooking]))
    assertResultContract(Sim.applyCooking(cooking, inputStack, { station: 'furnace' }))

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
    assertResultContract(Sim.smithingInput(smithingInput))
    assertResultContract(Sim.matchesSmithingRecipe(smithing, smithingInput, {}))
    assertResultContract(Sim.matchSmithingRecipes(smithingInput, {}, [smithing]))
    assertResultContract(Sim.matchSmithingRecipe(smithingInput, {}, [smithing]))
    assertResultContract(Sim.applySmithing(smithingInput, {}, [smithing]))

    const stonecutting = {
      _tag: 'Stonecutting', id: `${id}-stone`,
      ingredient: unwrap(Sim.exactly('stone', 1)), output,
      priority: 0,
    }
    const stone = unwrap(Sim.itemStack('stone', value.ingredientCount))
    assertResultContract(Sim.matchesStonecuttingRecipe(stonecutting, stone, { station: 'stonecutter' }))
    assertResultContract(Sim.matchStonecuttingRecipes(stone, { station: 'stonecutter' }, [stonecutting]))
    assertResultContract(Sim.matchStonecuttingRecipe(stone, { station: 'stonecutter' }, [stonecutting]))
    assertResultContract(Sim.applyStonecutting(stonecutting, stone, { station: 'stonecutter' }))

    const transmute = {
      _tag: 'Transmute', id: `${id}-transmute`,
      source: unwrap(Sim.exactly('dirt', 1)),
      material: unwrap(Sim.exactly('iron_ingot', 1)),
      output, materialCount: { min: 1, max: 1 },
      addMaterialCountToResult: true, priority: 0,
    }
    const grid = unwrap(Sim.craftGrid(3, 3, ['dirt', 'iron_ingot']))
    assertResultContract(Sim.matchesTransmuteRecipe(transmute, grid, {}))
    assertResultContract(Sim.matchTransmuteRecipes(grid, {}, [transmute]))
    assertResultContract(Sim.matchTransmuteRecipe(grid, {}, [transmute]))
    assertResultContract(Sim.applyTransmute(transmute, grid, {}))
  }), checks)
})

it('enchantment rules, level costs, and vanilla anvil plans handle hostile levels and experience', () => {
  const input = fc.record({
    candidate: unknownValue,
    level: hostileNumber,
    experience: hostileNumber,
    costBase: fc.integer({ min: 0, max: 20 }),
    costPerLevel: fc.integer({ min: 0, max: 20 }),
  })

  fc.assert(fc.property(input, (value) => {
    expect(typeof Sim.isSupportedVanillaEnchantmentId(value.candidate)).toBe('boolean')
    expect(Sim.enchantmentRuleFor(value.candidate) === undefined || isRecord(Sim.enchantmentRuleFor(value.candidate))).toBe(true)
    expect(typeof Sim.enchantmentAppliesTo(value.candidate, 'iron_sword')).toBe('boolean')
    expect(typeof Sim.enchantmentsConflict(value.candidate, 'sharpness')).toBe('boolean')
    assertResultContract(Sim.enchantmentTableCostAtLevel({
      base: value.costBase,
      perLevelAboveFirst: value.costPerLevel,
    }, value.level), (success) => typeof success === 'number' && Number.isFinite(success))
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
    const plan = Sim.planVanillaAnvil(state as never)
    expect(isRecord(plan)).toBe(true)
    expect(typeof plan.ok).toBe('boolean')
    expect(finiteTree(plan)).toBe(true)
    const applied = Sim.applyVanillaAnvil(state as never)
    expect(isRecord(applied)).toBe(true)
    expect(typeof applied.ok).toBe('boolean')
    if (applied.ok) expect(finiteTree(applied)).toBe(true)
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
    expect(typeof Sim.planVanillaAnvil(validState as never).ok).toBe('boolean')
    expect(typeof Sim.applyVanillaAnvil(validState as never).ok).toBe('boolean')
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
    assertResultContract(Sim.validateExplosionRequest(request as never))
    const validRequest = { ...request, radius: 1, seed: 7 }
    const plan = Sim.planExplosion(validRequest)
    assertResultContract(plan)
    if (Result.isSuccess(plan)) {
      let committed: unknown
      Sim.applyExplosionPlan(plan.success, (mutation) => { committed = mutation })
      expect(isRecord(committed)).toBe(true)
      expect(finiteTree(committed)).toBe(true)
    }

    const primed = Sim.primeTnt(value.fuse)
    assertResultContract(primed)
    if (Result.isSuccess(primed)) {
      const tntPlan = Sim.planPrimedTnt({
        ...validRequest,
        state: primed.success,
        deltaTimeSecs: value.delta,
      })
      assertResultContract(tntPlan)
      if (Result.isSuccess(tntPlan)) {
        let committed: unknown
        Sim.applyPrimedTntPlan(tntPlan.success, (mutation) => { committed = mutation })
        expect(isRecord(committed)).toBe(true)
        expect(finiteTree(committed)).toBe(true)
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
        let committed: unknown
        Sim.applyPrimedTntPlan(validTntPlan.success, (mutation) => { committed = mutation })
        expect(isRecord(committed)).toBe(true)
        expect(finiteTree(committed)).toBe(true)
      }
    }

    const launch = Sim.launchProjectile({
      position: center,
      yawRadians: value.yaw as never,
      pitchRadians: value.pitch as never,
      speed: value.speed as never,
    })
    expect(['flying', 'despawned']).toContain(launch.state)
    expect(finiteTree(launch)).toBe(true)
    const world = {
      blockBounds: () => [],
      bounds: {
        maxX: PositionAxis(10), maxY: PositionAxis(10), maxZ: PositionAxis(10),
        minX: PositionAxis(-10), minY: PositionAxis(-10), minZ: PositionAxis(-10),
      },
      entities: [],
      isInWater: () => false,
    }
    const step = Sim.stepProjectile(launch, value.delta as never, world, Sim.ARROW_PROFILE)
    expect(isRecord(step)).toBe(true)
    expect(['flying', 'stuck', 'despawned']).toContain(step.projectile.state)
    expect(finiteTree(step)).toBe(true)
    for (const profile of [Sim.ARROW_PROFILE, Sim.EGG_PROFILE, Sim.SNOWBALL_PROFILE, Sim.TRIDENT_PROFILE]) {
      expect(finiteTree(profile)).toBe(true)
    }
    const validLaunch = Sim.launchProjectile({
      position: center,
      yawRadians: 0 as never,
      pitchRadians: 0 as never,
      speed: 3 as never,
    })
    expect(validLaunch.state).toBe('flying')
    expect(finiteTree(Sim.stepProjectile(validLaunch, 0.05 as never, world, Sim.ARROW_PROFILE))).toBe(true)
  }), checks)
})

it('legacy save schemas and anvil codecs round-trip valid state and reject hostile payloads', () => {
  const input = fc.record({
    value: unknownValue,
    encoded: fc.string({ maxLength: 96 }),
    tick: hostileNumber,
    x: hostileNumber,
  })

  fc.assert(fc.property(input, (value) => {
    assertResultContract(Schema.decodeUnknownResult(Sim.LegacyItemStackSchema)(value.value))
    assertResultContract(Schema.decodeUnknownResult(Sim.LegacySimulationSaveV3Schema)(value.value))
    expect(typeof Sim.SIMULATION_SAVE_FORMAT.name).toBe('string')
    expect(Number.isFinite(Sim.SIMULATION_SAVE_FORMAT.version)).toBe(true)
    expect(Sim.SIMULATION_SAVE_FORMAT.schema).toBe(Sim.SIMULATION_SAVE_SCHEMA)

    const stackWire = { item: 'stone', count: 2, components: null }
    assertResultContract(Schema.decodeUnknownResult(Sim.LegacyItemStackSchema)(stackWire))
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
    assertResultContract(Schema.decodeUnknownResult(Sim.LegacySimulationSaveV3Schema)(save))

    const anvilState = {
      left: {
        item: 'iron_sword', durability: null, enchantments: [], repairCost: 0, customName: null,
      },
      right: null,
      rename: null,
      experienceLevels: 0,
    }
    const snapshot = Sim.snapshotAnvilState(anvilState as never)
    expect(typeof snapshot.ok).toBe('boolean')
    expect(finiteTree(snapshot)).toBe(true)
    const encoded = Sim.encodeAnvilSnapshot(anvilState as never)
    expect(typeof encoded.ok).toBe('boolean')
    expect(finiteTree(encoded)).toBe(true)
    if (encoded.ok) {
      expect(Sim.decodeAnvilSnapshot(encoded.snapshot)).toMatchObject({ ok: true })
      expect(Sim.decodeAnvilSnapshotString(encoded.encoded)).toMatchObject({ ok: true })
      expect(Sim.isAnvilSnapshotString(encoded.encoded)).toBe(true)
      assertResultContract(Sim.AnvilSnapshotString(encoded.encoded))
    }
    const decoded = Sim.decodeAnvilSnapshot(value.value)
    expect(typeof decoded.ok).toBe('boolean')
    expect(finiteTree(decoded)).toBe(true)
    const textDecode = Sim.decodeAnvilSnapshotString(value.encoded)
    expect(typeof textDecode.ok).toBe('boolean')
    expect(finiteTree(textDecode)).toBe(true)
    expect(typeof Sim.isAnvilSnapshotString(value.encoded)).toBe('boolean')
    assertResultContract(Sim.AnvilSnapshotString(value.encoded))
  }), checks)
})
