import fc from 'fast-check'
import { Result } from 'effect'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import {
  assertResultContract as assertResult,
  finiteTree,
  hostileValue,
  isRecord,
  unknownValue as unknownEnvelope,
} from './public-property-helpers.js'

const checks = { numRuns: 30 }

it('time-state outer envelopes normalize safely, keep getters finite, and make advance fail typed', () => {
  const state = fc.oneof(
    fc.constant(Sim.INITIAL_TIME_STATE),
    fc.constantFrom<unknown>(null, undefined, 0, 'invalid', []),
    fc.record({ ticks: hostileValue, dayLengthTicks: hostileValue }),
    fc.record({ ticks: hostileValue }),
  )

  fc.assert(fc.property(fc.record({ state, seconds: hostileValue, fraction: hostileValue, delta: hostileValue }), (value) => {
    const normalized = Sim.normaliseTimeState(value.state as never)
    expect(Sim.isValidTimeState(normalized)).toBe(true)
    expect(Sim.isValidTimeState(value.state as never)).toBeTypeOf('boolean')

    const fraction = Sim.timeOfDay(value.state as never)
    expect(Number.isFinite(fraction)).toBe(true)
    expect(fraction).toBeGreaterThanOrEqual(0)
    expect(fraction).toBeLessThan(1)
    const seconds = Sim.dayLengthSecs(value.state as never)
    expect(Number.isFinite(seconds)).toBe(true)
    expect(seconds).toBeGreaterThanOrEqual(Sim.MIN_DAY_LENGTH_SECS)
    expect(seconds).toBeLessThanOrEqual(Sim.MAX_DAY_LENGTH_SECS)
    const phase = Sim.moonPhase(value.state as never)
    expect(Number.isInteger(phase) && phase >= 0 && phase < Sim.MOON_PHASE_COUNT).toBe(true)
    expect(typeof Sim.isNight(value.state as never)).toBe('boolean')

    const changedDay = Sim.setDayLength(value.state as never, value.seconds as never)
    const changedTime = Sim.setTimeOfDay(value.state as never, value.fraction as never)
    const changedTogether = Sim.setDayLengthThenTimeOfDay(
      value.state as never,
      value.seconds as never,
      value.fraction as never,
    )
    for (const candidate of [changedDay, changedTime, changedTogether]) {
      expect(Sim.isValidTimeState(candidate)).toBe(true)
      expect(finiteTree(candidate)).toBe(true)
    }

    assertResult(Sim.advance(value.state as never, value.delta as never), (success) =>
      isRecord(success) && Sim.isValidTimeState(success as never),
    )
  }), checks)
})

it('crop snapshot envelopes reject malformed records and keep accepted crop state finite', () => {
  fc.assert(fc.property(unknownEnvelope, (value) => {
    const validation = Sim.validateCropSnapshot(value)
    expect(isRecord(validation)).toBe(true)
    expect(['Valid', 'Invalid']).toContain(validation._tag)
    expect(finiteTree(validation)).toBe(true)
    if (validation._tag === 'Valid') {
      for (const crop of validation.snapshot.crops) {
        expect(Number.isFinite(crop.growthSecs)).toBe(true)
        expect(Number.isSafeInteger(crop.position.x)).toBe(true)
        expect(Number.isSafeInteger(crop.position.y)).toBe(true)
        expect(Number.isSafeInteger(crop.position.z)).toBe(true)
        expect(typeof Sim.isMatureCrop(crop)).toBe('boolean')
        assertResult(Sim.matureYieldsFor(crop), (success) => success === null || Array.isArray(success))
        const advanced = Sim.advanceCropByBoneMeal(crop)
        expect(finiteTree(advanced)).toBe(true)
        expect(advanced.growthSecs).toBeGreaterThanOrEqual(0)
        expect(advanced.growthSecs).toBeLessThanOrEqual(Sim.maturitySecsFor(crop.crop))
        expect(Sim.cropLocationKey(advanced)).toBe(Sim.cropLocationKey(crop))
      }
    } else {
      expect(validation.error._tag).toBe('CropValidationError')
    }
  }), checks)
})

it('unequip treats hostile slot envelopes as a no-op while preserving valid equipment', () => {
  const slot = fc.oneof(
    hostileValue,
    fc.constantFrom<unknown>('__proto__', 'constructor', 'not-a-slot'),
  )
  const stack = Sim.itemStack('iron_helmet', 1)

  fc.assert(fc.property(slot, (candidate) => {
    expect(Result.isSuccess(stack)).toBe(true)
    if (Result.isFailure(stack)) return
    const item = Sim.equipmentItem(stack.success, Sim.durabilityForItem('iron_helmet'))
    expect(Result.isSuccess(item)).toBe(true)
    if (Result.isFailure(item)) return
    const equipment = Sim.equip(Sim.emptyEquipment(), 'head', item.success).equipment
    const outcome = Sim.unequip(equipment, candidate as never)

    expect(outcome.equipment === equipment || Sim.validateEquipmentSnapshot(outcome.equipment)._tag === 'Valid').toBe(true)
    if (Sim.isEquipmentSlot(candidate)) {
      expect(outcome.result === null || Sim.isEquipmentItem(outcome.result)).toBe(true)
      expect(outcome.equipment.slots[candidate]).toBeNull()
    } else {
      expect(outcome.equipment).toBe(equipment)
      expect(outcome.result).toBeNull()
    }
  }), checks)
})

it('container transitions return typed results for malformed request and storage envelopes', () => {
  const requests = fc.oneof(
    hostileValue,
    fc.record({
      direction: hostileValue,
      containerId: hostileValue,
      playerSlot: hostileValue,
      containerSlot: hostileValue,
      sourceContainerId: hostileValue,
      sourceSlot: hostileValue,
      destinationContainerId: hostileValue,
      destinationSlot: hostileValue,
      count: hostileValue,
    }),
  )
  const invalidContainerStorage = fc.constantFrom<unknown>(
    null,
    undefined,
    0,
    {},
    { containers: null },
    { containers: [null] },
    { containers: [{ id: 'broken', slots: null }] },
    { containers: [{ id: null, kind: 'chest', slots: Array(27).fill(null) }] },
    { containers: [{ id: 'broken', kind: 'invalid', slots: Array(27).fill(null) }] },
    { containers: [{ id: 'broken', kind: 'chest', slots: [] }] },
    { containers: [{ id: 'broken', slots: [] }] },
    { containers: [{ id: 'broken', kind: 'chest', slots: Array(27).fill(null), extra: true }] },
    { containers: [
      { id: 'duplicate', kind: 'chest', slots: Array(27).fill(null) },
      { id: 'duplicate', kind: 'chest', slots: Array(27).fill(null) },
    ] },
  )
  const invalidPlayerStorage = fc.constantFrom<unknown>(
    null,
    undefined,
    {},
    { inventory: null },
    { inventory: { slots: [] }, equipment: { slots: {} }, inventoryDurability: [] },
  )
  const player = Sim.emptyPlayerStorage()
  const storage = Sim.createContainer(Sim.emptyContainerStorage(), 'property-chest').storage
  const request = {
    direction: 'ContainerToPlayer' as const,
    containerId: 'property-chest',
    playerSlot: 0,
    containerSlot: 0,
    count: 1,
  }

  fc.assert(fc.property(requests, (candidate) => {
    const transfer = Sim.transferContainerItem(player, storage, candidate as never)
    const extract = Sim.extractContainerItem(storage, candidate as never)
    const move = Sim.moveContainerItem(storage, candidate as never)
    expect([
      'ContainerNotFound', 'InvalidPlayerSlot', 'InvalidContainerSlot', 'InvalidCount',
      'EmptySource', 'InsufficientSource', 'DestinationMismatch', 'DestinationFull',
      'InvalidDirection', 'InvalidSourceStack', 'InvalidDestinationStack',
      'InvalidSourceDurability', 'InvalidRequest', 'InvalidPlayerStorage',
      'InvalidContainerStorage', 'ItemStackFailure',
    ]).toContain(transfer.result._tag)
    expect([
      'ContainerNotFound', 'InvalidContainerSlot', 'InvalidCount', 'EmptySource',
      'InsufficientSource', 'InvalidSourceStack', 'InvalidSourceDurability',
      'InvalidRequest', 'InvalidContainerStorage', 'ItemStackFailure',
    ]).toContain(extract.result._tag)
    expect([
      'SourceContainerNotFound', 'DestinationContainerNotFound', 'InvalidSourceSlot',
      'InvalidDestinationSlot', 'InvalidCount', 'EmptySource', 'InsufficientSource',
      'DestinationMismatch', 'DestinationFull', 'InvalidSourceStack',
      'InvalidDestinationStack', 'InvalidSourceDurability', 'InvalidRequest',
      'InvalidContainerStorage', 'ItemStackFailure',
    ]).toContain(move.result._tag)
  }), checks)

  fc.assert(fc.property(fc.constant(null), (candidate) => {
    expect(Sim.transferContainerItem(player, storage, candidate as never).result._tag).toBe('InvalidRequest')
    expect(Sim.extractContainerItem(storage, candidate as never).result._tag).toBe('InvalidRequest')
    expect(Sim.moveContainerItem(storage, candidate as never).result._tag).toBe('InvalidRequest')
  }), checks)

  fc.assert(fc.property(invalidContainerStorage, (candidate) => {
    const transfer = Sim.transferContainerItem(player, candidate as never, request)
    const extract = Sim.extractContainerItem(candidate as never, request)
    const move = Sim.moveContainerItem(candidate as never, {
      sourceContainerId: 'property-chest', sourceSlot: 0,
      destinationContainerId: 'property-chest', destinationSlot: 1, count: 1,
    })
    expect(transfer.result._tag).toBe('InvalidContainerStorage')
    expect(extract.result._tag).toBe('InvalidContainerStorage')
    expect(move.result._tag).toBe('InvalidContainerStorage')
  }), checks)

  fc.assert(fc.property(invalidPlayerStorage, (candidate) => {
    const transfer = Sim.transferContainerItem(candidate as never, storage, request)
    expect(transfer.result._tag).toBe('InvalidPlayerStorage')
    expect(transfer.containerStorage).toBe(storage)
  }), checks)

  const invalidKind = fc.constantFrom<unknown>(null, 'invalid', -1, Number.MAX_VALUE)
  fc.assert(fc.property(invalidKind, (kind) => {
    const created = Sim.createContainer(Sim.emptyContainerStorage(), 'bad-kind', kind as never)
    expect(created.result._tag).toBe('InvalidContainerKind')
    expect(created.storage.containers).toHaveLength(0)
  }), checks)

  const invalidId = fc.constantFrom<unknown>(null, undefined, '', ' ', 0)
  fc.assert(fc.property(invalidId, (id) => {
    const created = Sim.createContainer(Sim.emptyContainerStorage(), id as never)
    expect(created.result._tag).toBe('InvalidContainerId')
    expect(created.storage.containers).toHaveLength(0)
  }), checks)

  fc.assert(fc.property(unknownEnvelope, (candidate) => {
    const result = Sim.validateContainerStorageSnapshot(candidate)
    expect(isRecord(result)).toBe(true)
    expect(['Valid', 'Invalid', 'ItemStackFailure']).toContain(result._tag)
    expect(finiteTree(result)).toBe(true)
  }), checks)
})

it('public domain state functions reject malformed outer envelopes without throwing', () => {
  const malformedEnvelope = fc.constantFrom<unknown>(null, undefined, false, 0, 'invalid', [], {})

  fc.assert(
    fc.property(malformedEnvelope, (input) => {
      expect(Result.isFailure(Sim.cameraPoseOf(input as never, 0 as never))).toBe(true)
      expect(Result.isFailure(Sim.targetBlockFromCamera(input as never, 1, () => true))).toBe(true)
      expect(Result.isFailure(Sim.targetBlockFromPlayerPose(input as never, 1, () => true))).toBe(true)
      expect(Result.isFailure(Sim.normaliseInventory(input as never))).toBe(true)
    }),
    { numRuns: 100 },
  )
})

it('public inventory normalizer rejects malformed slot envelopes without throwing', () => {
  const malformedInventory = fc.constantFrom<unknown>(
    null,
    undefined,
    false,
    0,
    'invalid',
    [],
    {},
    { slots: null },
    { slots: {} },
    { slots: [null] },
    { slots: [1] },
  )

  fc.assert(
    fc.property(malformedInventory, (input) => {
      expect(Result.isFailure(Sim.normaliseInventory(input as never))).toBe(true)
    }),
    { numRuns: 100 },
  )
})
