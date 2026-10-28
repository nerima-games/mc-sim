import fc from 'fast-check'
import { Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { assertResultContract, hostileNumber, hostileValue, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 40 }
const starterRecipes = Result.getOrThrow(Sim.STARTER_RECIPES)

it('camera pose and fixed-step APIs handle hostile inputs while hotbar indexes stay bounded', () => {
  const input = fc.record({
    x: hostileNumber,
    y: hostileNumber,
    z: hostileNumber,
    yaw: hostileNumber,
    pitch: hostileNumber,
    capturedAt: hostileNumber,
    accumulator: hostileNumber,
    tick: hostileNumber,
    tickDuration: hostileNumber,
    maxCatchUpTicks: hostileNumber,
    delta: hostileNumber,
    paused: hostileValue,
    hotbarIndex: hostileValue,
    hotbarDelta: hostileValue,
  })

  fc.assert(
    fc.property(input, (value) => {
      const pose = {
        feetPosition: { x: value.x, y: value.y, z: value.z },
        yawRadians: value.yaw,
        pitchRadians: value.pitch,
      }
      Sim.cameraPoseOf(pose as never, value.capturedAt as never)
      Sim.forwardVector({
        yawRadians: value.yaw as number,
        pitchRadians: value.pitch as number,
      })

      Sim.advanceFixedStep({
        ...Sim.initialFixedStepAccumulator(),
        accumulator: value.accumulator as never,
        tick: value.tick as never,
        tickDuration: value.tickDuration as never,
        maxCatchUpTicks: value.maxCatchUpTicks as never,
        paused: value.paused as never,
      }, value.delta as never)

      const clamped = Sim.clampHotbarIndex(value.hotbarIndex as number)
      const cycled = Sim.cycleHotbarIndex(value.hotbarIndex as number, value.hotbarDelta as number)
      for (const index of [clamped, cycled]) {
        expect(Number.isInteger(index)).toBe(true)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(Sim.HOTBAR_SIZE)
      }
    }),
    checks,
  )

})

it('camera pitch and look reject hostile non-finite inputs', () => {
  fc.assert(
    fc.property(fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY), (pitch) => {
      expect(Result.isFailure(Sim.clampPitch(pitch))).toBe(true)
      expect(Result.isFailure(Sim.applyLook(Sim.INITIAL_PLAYER_POSE, pitch, 0))).toBe(true)
      expect(Result.isFailure(Sim.applyLook(Sim.INITIAL_PLAYER_POSE, 0, pitch))).toBe(true)
    }),
    checks,
  )
})


it('camera look handles hostile pose envelopes without throwing', () => {
  fc.assert(
    fc.property(hostileValue, (pose) => {
      Sim.applyLook(pose as never, 0, 0)
    }),
    checks,
  )
})


it('camera pitch clamping handles hostile scalar inputs without throwing', () => {
  fc.assert(
    fc.property(hostileValue, (pitch) => {
      Sim.clampPitch(pitch as never)
    }),
    checks,
  )
})

it('block interaction and crop transitions remain total with hostile inputs', () => {
  const input = fc.record({
    blockId: hostileValue,
    supportId: hostileValue,
    item: hostileValue,
    growthSecs: hostileValue,
    deltaSecs: hostileValue,
  })

  fc.assert(
    fc.property(input, (value) => {
      Sim.breakBlock(value.blockId as number)
      Sim.placeBlock(value.blockId as number, value.supportId as number)
      Sim.placeableBlockFromItem(value.item as never)

      const advanced = Sim.advanceCrop({
        dimension: 'overworld',
        position: { x: 0, y: 0, z: 0 },
        crop: 'wheat_crop',
        growthSecs: value.growthSecs,
      } as never, value.deltaSecs as number)
      expect(advanced.growthSecs).toBeGreaterThanOrEqual(0)
      expect(advanced.growthSecs).toBeLessThanOrEqual(Sim.WHEAT_MATURITY_SECS)
    }),
    checks,
  )
})

it('equipment, fishing loot, and grindstone handle hostile domain fields without throwing', () => {
  const input = fc.record({
    amount: hostileValue,
    sample: hostileNumber,
    count: hostileValue,
  })

  fc.assert(
    fc.property(input, (value) => {
      const equipment = Sim.emptyEquipment()
      const damaged = Sim.damageEquipment(equipment, 'head', value.amount as number)
      expect(damaged.result._tag).toBe(
        Number.isSafeInteger(value.amount) && (value.amount as number) > 0 ? 'Empty' : 'InvalidAmount',
      )
      expect(damaged.equipment).toBe(equipment)
      Sim.validateEquipmentSnapshot(damaged.equipment)
      Sim.fishingLootForSample(value.sample as number)

      const plan = Sim.planGrindstone({
        payload: {
          item: 'minecraft:diamond_sword',
          durability: null,
          enchantments: [],
          repairCost: 0,
          customName: null,
        },
        count: value.count as number,
      } as never, null)
      if (value.count !== 1) expect(plan.ok).toBe(false)
    }),
    checks,
  )
})

const hostileInventorySlot = fc.oneof(
  fc.constant(undefined),
  fc.record({ item: hostileValue, count: hostileNumber }),
  fc.record({
    item: fc.constant('stone'),
    count: hostileNumber,
    components: hostileValue,
  }),
)

it('addItem handles hostile counts without throwing', () => {
  fc.assert(
    fc.property(hostileNumber, (count) => {
      Sim.addItem(Sim.emptyInventory(), 'stone', count as number)
    }),
    checks,
  )
})

it('normaliseInventory handles hostile slot envelopes without throwing', () => {
  fc.assert(
    fc.property(fc.array(hostileInventorySlot, { maxLength: Sim.INVENTORY_SLOT_COUNT + 2 }), (slots) => {
      Sim.normaliseInventory({ slots } as never)
    }),
    checks,
  )
})

it('normaliseInventory rejects overflow while discarding invalid stacks', () => {
  fc.assert(
    fc.property(fc.constant(Number.MAX_VALUE), (count) => {
      const normalized = Sim.normaliseInventory({
        slots: [
          { item: 'invalid-first-item', count },
          { item: 'invalid-second-item', count },
        ],
      } as never)
      expect(Result.isFailure(normalized)).toBe(true)
      if (Result.isFailure(normalized)) {
        expect(Schema.is(Sim.ItemStackFailureSchema)(normalized.failure)).toBe(true)
        expect(normalized.failure).toMatchObject({
          _tag: 'ItemValidationFailure',
          field: 'discarded',
          kind: 'RangeError',
        })
      }
    }),
    checks,
  )
})

it('normaliseInventory rejects overflow in remaining-item totals', () => {
  const normalized = Sim.normaliseInventory({
    slots: [
      { item: 'stone', count: Number.MAX_VALUE },
      { item: 'dirt', count: Number.MAX_VALUE },
    ],
  } as never)
  expect(Result.isFailure(normalized)).toBe(true)
  if (Result.isFailure(normalized)) {
    expect(Schema.is(Sim.ItemStackFailureSchema)(normalized.failure)).toBe(true)
    expect(normalized.failure).toMatchObject({
      _tag: 'ItemValidationFailure',
      field: 'leftover',
      kind: 'RangeError',
    })
  }
})

it('player-storage numeric fields reject invalid counts and leave storage unchanged', () => {
  const input = fc.record({
    consumeCount: hostileNumber,
    damageAmount: hostileNumber,
  })

  fc.assert(
    fc.property(input, (value) => {
      const storage = Sim.emptyPlayerStorage()
      const outcome = Sim.consumeAndDamageAt(storage, {
        consume: { item: 'stone', count: value.consumeCount },
        damage: {
          location: { _tag: 'Inventory', slotIndex: 0 },
          expectedItem: 'wooden_axe',
          amount: value.damageAmount,
        },
      } as never)
      const expectedTag = !Number.isSafeInteger(value.consumeCount) || (value.consumeCount as number) <= 0
        ? 'InvalidConsumableCount'
        : !Number.isSafeInteger(value.damageAmount) || (value.damageAmount as number) <= 0
          ? 'InvalidDamageAmount'
          : 'DamageTargetMismatch'
      expect(outcome.result._tag).toBe(expectedTag)
      expect(outcome.storage).toBe(storage)
      Sim.validatePlayerStorageSnapshot(outcome.storage)
    }),
    checks,
  )
})

it('recipe station matchers and apply functions handle arbitrary external shapes without throwing', () => {
  const input = fc.record({
    subject: unknownValue,
    context: unknownValue,
    recipes: unknownValue,
  })

  fc.assert(
    fc.property(input, (value) => {
      Sim.matchCookingRecipes(value.subject, value.context, value.recipes)
      Sim.matchCookingRecipe(value.subject, value.context, value.recipes)
      Sim.applyCooking(value.subject, value.subject, value.context)
      Sim.matchSmithingRecipes(value.subject, value.context, value.recipes)
      Sim.matchSmithingRecipe(value.subject, value.context, value.recipes)
      Sim.applySmithing(value.subject, value.context, value.recipes)
      Sim.matchStonecuttingRecipes(value.subject, value.context, value.recipes)
      Sim.matchStonecuttingRecipe(value.subject, value.context, value.recipes)
      Sim.applyStonecutting(value.subject, value.subject, value.context)
      Sim.matchTransmuteRecipes(value.subject, value.context, value.recipes)
      Sim.matchTransmuteRecipe(value.subject, value.context, value.recipes)
      Sim.applyTransmute(value.subject, value.subject, value.context)
    }),
    checks,
  )
})

it('craft-grid and enchantment-table builders handle hostile dimensions, costs, and randomness', () => {
  const input = fc.record({
    width: hostileNumber,
    height: hostileNumber,
    bookshelfCount: hostileValue,
    slot: hostileValue,
    randomValue: hostileValue,
  })

  fc.assert(
    fc.property(input, (value) => {
      Sim.craftGrid(value.width as number, value.height as number, [])

      const emptyGrid = Sim.craftGrid(0, 0, [])
      expect(Result.isSuccess(emptyGrid)).toBe(true)
      if (Result.isSuccess(emptyGrid)) {
        const emptyCraft = Sim.craftFromGrid(Sim.emptyInventory(), starterRecipes, emptyGrid.success)
        if (Result.isSuccess(emptyCraft)) expect(emptyCraft.success.result._tag).toBe('NoMatch')
      }

      const random = {
        nextInt: (_bound: number) => value.randomValue as number,
        nextFloat: () => value.randomValue as number,
      }
      const enchantmentInput = {
        item: 'minecraft:book',
        bookshelfCount: value.bookshelfCount,
        random,
        slot: value.slot,
      }
      Sim.calculateEnchantmentTableLevelCost(enchantmentInput as never)
      Sim.generateEnchantmentTableOffers({
        item: 'minecraft:book',
        bookshelfCount: value.bookshelfCount,
        random,
      } as never)
    }),
    checks,
  )
})

it('entity operations preserve roster and despawn invariants for hostile state', () => {
  const input = fc.record({
    x: hostileNumber,
    y: hostileNumber,
    z: hostileNumber,
    health: hostileValue,
    behaviour: hostileValue,
  })

  fc.assert(
    fc.property(input, (value) => {
      const kind = Sim.EntityKind('creeper')
      const spawned = Sim.spawnEntity(Sim.emptyRoster(), {
        kind,
        feetPosition: { x: value.x, y: value.y, z: value.z },
        healthPoints: value.health,
        behaviour: value.behaviour,
      } as never)
      expect(Result.isSuccess(spawned)).toBe(true)
      if (Result.isFailure(spawned)) return
      const { entity, roster } = spawned.success

      const id = entity.id
      expect(Sim.findEntity(roster, id)).toEqual(entity)
      expect(Sim.countOfKind(roster, kind)).toBe(1)

      const swept = Sim.sweepRoster(roster as never, (current) => ({
        transition: Sim.changed({
          feetPosition: { x: value.x, y: value.y, z: value.z },
          healthPoints: value.health,
          behaviour: current.behaviour,
        } as never),
        emit: undefined,
      }))
      expect(swept.roster.entities).toHaveLength(1)
      const sweptEntity = swept.roster.entities[0]
      expect(sweptEntity).toBeDefined()

      const despawned = Sim.despawnEntity(swept.roster, id)
      expect(despawned.despawned).toBe(true)
      expect(despawned.roster.entities).toHaveLength(0)
    }),
    checks,
  )
})

it('explosion, primed-TNT, and projectile APIs handle hostile inputs without throwing', () => {
  const radius = fc.oneof(
    fc.double({ min: -2, max: 6 }),
    fc.constantFrom<unknown>(null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 65, Number.MAX_VALUE),
  )
  const rayCoordinate = fc.oneof(
    fc.double({ min: -8, max: 8 }),
    fc.constantFrom<unknown>(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
  )
  const input = fc.record({
    x: hostileNumber,
    y: hostileNumber,
    z: hostileNumber,
    radius,
    seed: hostileNumber,
    fuse: hostileNumber,
    delta: hostileNumber,
    from: fc.record({ x: rayCoordinate, y: rayCoordinate, z: rayCoordinate }),
    to: fc.record({ x: rayCoordinate, y: rayCoordinate, z: rayCoordinate }),
  })

  fc.assert(
    fc.property(input, (value) => {
      const request = {
        center: { x: value.x, y: value.y, z: value.z },
        radius: value.radius,
        seed: value.seed,
        blocks: () => ({ resistance: 0, destructible: false }),
        entities: [],
      }
      assertResultContract(
        'explosion.planExplosion(hostile request)',
        () => Sim.planExplosion(request as never),
        Sim.ExplosionPlanSchema,
        Sim.ExplosionValidationFailureSchema,
      )
      Sim.primeTnt(value.fuse as number)
      Sim.planPrimedTnt({
        ...request,
        state: { kind: 'primed', remainingFuseSecs: value.fuse },
        deltaTimeSecs: value.delta,
      } as never)
      Sim.raycastArrowBlock(
        value.from as never,
        value.to as never,
        () => false,
      )
    }),
    checks,
  )

  fc.assert(
    fc.property(fc.oneof(
      fc.integer({ min: 65, max: 128 }),
      fc.constant(Number.MAX_VALUE),
    ), (distance) => {
      let blockerChecks = 0
      const overLimit = Sim.raycastArrowBlock(
        { x: 0, y: 0, z: 0 } as never,
        { x: distance, y: 0, z: 0 } as never,
        () => {
          blockerChecks += 1
          throw new Error('over-limit raycast reached voxel traversal')
        },
      )
      expect(Result.isFailure(overLimit)).toBe(true)
      if (Result.isFailure(overLimit)) expect(overLimit.failure).toBeInstanceOf(RangeError)
      expect(blockerChecks).toBe(0)
    }),
    checks,
  )
})

it('public domain schemas reject hostile values and anvil codecs handle hostile text', () => {
  const input = unknownValue

  fc.assert(
    fc.property(input, (value) => {
      assertResultContract(
        'FishingStateSchema.decodeUnknownResult',
        () => Schema.decodeUnknownResult(Sim.FishingStateSchema)(value),
        Sim.FishingStateSchema,
        Sim.SchemaErrorSchema,
      )
      assertResultContract(
        'SIMULATION_SAVE_SCHEMA.decodeUnknownResult',
        () => Schema.decodeUnknownResult(Sim.SIMULATION_SAVE_SCHEMA)(value),
        Sim.SIMULATION_SAVE_SCHEMA,
        Sim.SchemaErrorSchema,
      )

      Sim.validateCropSnapshot(value)
      Sim.validateEquipmentSnapshot(value)
      Sim.validatePlayerStorageSnapshot(value)

    }),
    checks,
  )

  fc.assert(
    fc.property(fc.string({ maxLength: 96 }), (text) => {
      Sim.decodeAnvilSnapshotString(text)
    }),
    checks,
  )
})
