import fc from 'fast-check'
import { Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { assertResultContract, finiteTree, hostileNumber, hostileValue, isRecord, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 40 }
const starterRecipes = Result.getOrThrow(Sim.STARTER_RECIPES)

const assertValidationContract = (value: unknown): void => {
  expect(isRecord(value)).toBe(true)
  if (!isRecord(value)) return
  expect(['Valid', 'Invalid']).toContain(value['_tag'])
  if (value['_tag'] === 'Valid') expect(finiteTree(value)).toBe(true)
  if (value['_tag'] === 'Invalid') expect(finiteTree(value)).toBe(true)
}

it('camera pose, fixed-step, and hotbar APIs keep hostile scalar inputs typed or bounded', () => {
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
      assertResultContract(Sim.cameraPoseOf(pose as never, value.capturedAt as never))
      assertResultContract(Sim.forwardVector({
        yawRadians: value.yaw as number,
        pitchRadians: value.pitch as number,
      }))

      const fixedStep = Sim.advanceFixedStep({
        ...Sim.initialFixedStepAccumulator(),
        accumulator: value.accumulator as never,
        tick: value.tick as never,
        tickDuration: value.tickDuration as never,
        maxCatchUpTicks: value.maxCatchUpTicks as never,
        paused: value.paused as never,
      }, value.delta as never)
      assertResultContract(fixedStep, (success) => {
        if (!isRecord(success)) return false
        const fraction = success['interpolationFraction']
        const ticks = success['ticks']
        return typeof fraction === 'number' && fraction >= 0 && fraction <= 1 &&
          typeof ticks === 'number' && Number.isSafeInteger(ticks) && ticks >= 0
      })

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


it('camera look accepts only a valid finite pose or returns a typed failure', () => {
  fc.assert(
    fc.property(hostileValue, (pose) => {
      assertResultContract(Sim.applyLook(pose as never, 0, 0))
    }),
    checks,
  )
})


it('camera pitch clamping returns only bounded finite successes or typed failures', () => {
  fc.assert(
    fc.property(hostileValue, (pitch) => {
      assertResultContract(Sim.clampPitch(pitch as never), (success) =>
        typeof success === 'number' &&
        Number.isFinite(success) &&
        success >= Sim.PITCH_MIN_RADIANS &&
        success <= Sim.PITCH_MAX_RADIANS,
      )
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
      assertResultContract(Sim.breakBlock(value.blockId as number))
      assertResultContract(Sim.placeBlock(value.blockId as number, value.supportId as number))
      assertResultContract(Sim.placeableBlockFromItem(value.item as never), (success) =>
        success === undefined || isRecord(success),
      )

      const advanced = Sim.advanceCrop({
        dimension: 'overworld',
        position: { x: 0, y: 0, z: 0 },
        crop: 'wheat_crop',
        growthSecs: value.growthSecs,
      } as never, value.deltaSecs as number)
      expect(finiteTree(advanced)).toBe(true)
      expect(advanced.growthSecs).toBeGreaterThanOrEqual(0)
      expect(advanced.growthSecs).toBeLessThanOrEqual(Sim.WHEAT_MATURITY_SECS)
    }),
    checks,
  )
})

it('equipment, fishing loot, and grindstone reject hostile domain fields without throwing', () => {
  const input = fc.record({
    amount: hostileValue,
    sample: hostileNumber,
    count: hostileValue,
  })

  fc.assert(
    fc.property(input, (value) => {
      const damaged = Sim.damageEquipment(Sim.emptyEquipment(), 'head', value.amount as number)
      expect(isRecord(damaged)).toBe(true)
      expect(isRecord(damaged.result) && ['InvalidAmount', 'Empty'].includes(String(damaged.result['_tag']))).toBe(true)
      expect(finiteTree(damaged.equipment)).toBe(true)
      assertValidationContract(Sim.validateEquipmentSnapshot(damaged.equipment))

      assertResultContract(Sim.fishingLootForSample(value.sample as number), (success) => typeof success === 'string')

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
      expect(isRecord(plan)).toBe(true)
      expect(typeof plan.ok).toBe('boolean')
      expect(finiteTree(plan)).toBe(true)
      if (!plan.ok) expect(typeof plan.reason).toBe('string')
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

it('addItem keeps hostile counts in its typed result contract', () => {
  fc.assert(
    fc.property(hostileNumber, (count) => {
      const added = Sim.addItem(Sim.emptyInventory(), 'stone', count as number)
      assertResultContract(added, (success) => {
        if (!isRecord(success) || !isRecord(success['inventory'])) return false
        const slots = success['inventory']['slots']
        return Array.isArray(slots) && slots.length === Sim.INVENTORY_SLOT_COUNT &&
          typeof success['leftover'] === 'number' && Number.isFinite(success['leftover'])
      })
    }),
    checks,
  )
})

it('normaliseInventory keeps hostile slot envelopes in its typed result contract', () => {
  fc.assert(
    fc.property(fc.array(hostileInventorySlot, { maxLength: Sim.INVENTORY_SLOT_COUNT + 2 }), (slots) => {
      const normalized = Sim.normaliseInventory({ slots } as never)
      assertResultContract(normalized, (success) => {
        if (!isRecord(success) || !isRecord(success['inventory'])) return false
        const normalizedSlots = success['inventory']['slots']
        return Array.isArray(normalizedSlots) && normalizedSlots.length === Sim.INVENTORY_SLOT_COUNT &&
          typeof success['leftover'] === 'number' && Number.isFinite(success['leftover'])
      })
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
  fc.assert(
    fc.property(fc.constant(Number.MAX_VALUE), (count) => {
      const normalized = Sim.normaliseInventory({
        slots: [
          { item: 'stone', count },
          { item: 'dirt', count },
        ],
      } as never)
      expect(Result.isFailure(normalized)).toBe(true)
      if (Result.isFailure(normalized)) {
        expect(normalized.failure).toMatchObject({
          _tag: 'ItemValidationFailure',
          field: 'leftover',
          kind: 'RangeError',
        })
      }
    }),
    checks,
  )
})

it('player-storage numeric fields do not produce invalid success values', () => {
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
      expect(isRecord(outcome)).toBe(true)
      expect(isRecord(outcome.result) && typeof outcome.result['_tag'] === 'string').toBe(true)
      expect(['InvalidConsumableCount', 'InvalidDamageAmount', 'InvalidLocation', 'DamageTargetMismatch']).toContain(outcome.result['_tag'])
      expect(outcome.storage).toBe(storage)
      assertValidationContract(Sim.validatePlayerStorageSnapshot(outcome.storage))
    }),
    checks,
  )
})

it('recipe station matchers and apply functions fail typed on arbitrary external shapes', () => {
  const input = fc.record({
    subject: unknownValue,
    context: unknownValue,
    recipes: unknownValue,
  })

  fc.assert(
    fc.property(input, (value) => {
      const results = [
        Sim.matchCookingRecipes(value.subject, value.context, value.recipes),
        Sim.matchCookingRecipe(value.subject, value.context, value.recipes),
        Sim.applyCooking(value.subject, value.subject, value.context),
        Sim.matchSmithingRecipes(value.subject, value.context, value.recipes),
        Sim.matchSmithingRecipe(value.subject, value.context, value.recipes),
        Sim.applySmithing(value.subject, value.context, value.recipes),
        Sim.matchStonecuttingRecipes(value.subject, value.context, value.recipes),
        Sim.matchStonecuttingRecipe(value.subject, value.context, value.recipes),
        Sim.applyStonecutting(value.subject, value.subject, value.context),
        Sim.matchTransmuteRecipes(value.subject, value.context, value.recipes),
        Sim.matchTransmuteRecipe(value.subject, value.context, value.recipes),
        Sim.applyTransmute(value.subject, value.subject, value.context),
      ]
      for (const result of results) assertResultContract(result)
    }),
    checks,
  )
})

it('craft-grid and enchantment-table builders validate hostile dimensions, costs, and randomness', () => {
  const input = fc.record({
    width: hostileNumber,
    height: hostileNumber,
    bookshelfCount: hostileValue,
    slot: hostileValue,
    randomValue: hostileValue,
  })

  fc.assert(
    fc.property(input, (value) => {
      const grid = Sim.craftGrid(value.width as number, value.height as number, [])
      assertResultContract(grid, (success) => {
        if (!isRecord(success)) return false
        return Number.isInteger(success['width']) && Number.isInteger(success['height']) &&
          Number(success['width']) >= 0 && Number(success['width']) <= 3 &&
          Number(success['height']) >= 0 && Number(success['height']) <= 3
      })

      const emptyGrid = Sim.craftGrid(0, 0, [])
      assertResultContract(emptyGrid)
      if (isRecord(emptyGrid) && emptyGrid['_tag'] === 'Success') {
        assertResultContract(Sim.craftFromGrid(Sim.emptyInventory(), starterRecipes, emptyGrid['success'] as never), (success) =>
          isRecord(success) && isRecord(success['result']) && success['result']['_tag'] === 'NoMatch',
        )
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
      assertResultContract(Sim.calculateEnchantmentTableLevelCost(enchantmentInput as never), (success) =>
        typeof success === 'number' && Number.isFinite(success) && success >= 0,
      )
      assertResultContract(Sim.generateEnchantmentTableOffers({
        item: 'minecraft:book',
        bookshelfCount: value.bookshelfCount,
        random,
      } as never), (success) => Array.isArray(success) && success.length === 3)
    }),
    checks,
  )
})

it('entity operations preserve finite repaired state and roster invariants', () => {
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
      expect(isRecord(spawned)).toBe(true)
      if (!isRecord(spawned)) return
      expect(['Success', 'Failure']).toContain(spawned['_tag'])
      if (spawned['_tag'] === 'Failure') {
        expect(spawned['failure'] ?? spawned['error']).toBeDefined()
        return
      }
      const spawnedValue = spawned['success']
      expect(isRecord(spawnedValue) && isRecord(spawnedValue['entity']) && isRecord(spawnedValue['roster'])).toBe(true)
      if (!isRecord(spawnedValue) || !isRecord(spawnedValue['entity']) || !isRecord(spawnedValue['roster'])) return
      const spawnedEntity = spawnedValue['entity']
      expect(Sim.isEntityId(spawnedEntity['id'])).toBe(true)
      expect(Sim.isEntityKind(spawnedEntity['kind'])).toBe(true)
      expect(isRecord(spawnedEntity['feetPosition']) && finiteTree(spawnedEntity['feetPosition'])).toBe(true)
      expect(typeof spawnedEntity['healthPoints'] === 'number' && Number.isFinite(spawnedEntity['healthPoints'])).toBe(true)

      const success = spawnedValue
      const entity = spawnedEntity
      const roster = success['roster']
      const id = entity['id'] as never
      expect(Sim.findEntity(roster as never, id)).toEqual(entity)
      expect(Sim.countOfKind(roster as never, kind)).toBe(1)

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
      if (sweptEntity !== undefined) {
        expect(finiteTree(sweptEntity.feetPosition)).toBe(true)
        expect(Number.isFinite(sweptEntity.healthPoints)).toBe(true)
      }

      const despawned = Sim.despawnEntity(swept.roster, id)
      expect(despawned.despawned).toBe(true)
      expect(despawned.roster.entities).toHaveLength(0)
    }),
    checks,
  )
})

it('explosion, primed-TNT, and projectile APIs return failures or bounded plans', () => {
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
      assertResultContract(Sim.planExplosion(request as never), (success) => {
        if (!isRecord(success)) return false
        return typeof success['radius'] === 'number' && success['radius'] >= 0 && success['radius'] <= 64 &&
          Array.isArray(success['destroyedBlocks']) && Array.isArray(success['entityEffects'])
      })
      assertResultContract(Sim.primeTnt(value.fuse as number), (success) =>
        isRecord(success) && success['kind'] === 'primed' &&
          typeof success['remainingFuseSecs'] === 'number' && success['remainingFuseSecs'] >= 0,
      )
      assertResultContract(Sim.planPrimedTnt({
        ...request,
        state: { kind: 'primed', remainingFuseSecs: value.fuse },
        deltaTimeSecs: value.delta,
      } as never))
      assertResultContract(Sim.raycastArrowBlock(
        value.from as never,
        value.to as never,
        () => false,
      ))
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

it('public domain schemas and codecs reject hostile values or return valid decoded data', () => {
  const input = unknownValue

  fc.assert(
    fc.property(input, (value) => {
      assertResultContract(Schema.decodeUnknownResult(Sim.FishingStateSchema)(value), (success) =>
        isRecord(success) && Array.isArray(success['rods']),
      )
      assertResultContract(Schema.decodeUnknownResult(Sim.SIMULATION_SAVE_SCHEMA)(value))

      assertValidationContract(Sim.validateCropSnapshot(value))
      assertValidationContract(Sim.validateEquipmentSnapshot(value))
      assertValidationContract(Sim.validatePlayerStorageSnapshot(value))

    }),
    checks,
  )

  fc.assert(
    fc.property(fc.string({ maxLength: 96 }), (text) => {
      const decodedAnvil = Sim.decodeAnvilSnapshotString(text)
      expect(isRecord(decodedAnvil)).toBe(true)
      if (!isRecord(decodedAnvil)) return
      expect(typeof decodedAnvil['ok']).toBe('boolean')
      expect(finiteTree(decodedAnvil)).toBe(true)
    }),
    checks,
  )
})
