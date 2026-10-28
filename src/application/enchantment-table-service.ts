import {
  enchantmentsComponent,
  storedEnchantmentsComponent,
} from '@nerima-games/mc-kernel/domain/item-enchantments'
import { Brand, Context, Effect, Layer, Result, Schema } from 'effect'
import type { AnvilEnchantment } from '../domain/anvil.js'
import * as EnchantmentTable from '../domain/enchantment-table.js'
import {
  enchantmentAppliesTo,
  enchantmentsConflict,
  isSupportedVanillaEnchantmentId,
} from '../domain/enchantment.js'
import {
  enchantmentTableRuleFor,
  itemEnchantabilityOf,
} from '../domain/enchantment-table-data.js'
import * as Inventory from '../domain/inventory.js'
import * as PlayerStorage from '../domain/player-storage.js'
import * as Vitals from '../domain/vitals.js'
import { SchemaErrorSchema } from '../schema-errors.js'
import { PlayerStorageSnapshotSchema } from './container-service.js'
import {
  ReplicatedOwnerIdSchema,
  type ReplicatedOwnerId,
} from './replicated-state.js'
import {
  WorldCommitCoordinator,
  WorldCommitCoordinatorErrorSchema,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'
import {
  WorldCommitPlanConflictSchema,
  mergeWorldCommitPlans,
  worldCommitPlanSnapshotSchema,
} from './world-commit-plan.js'
import type {
  WorldCommitPlanConflict,
  WorldCommitPlanFragment,
  WorldCommitPlanSnapshot,
} from './world-commit-plan.js'
import type { WorldCommitRequest } from './world-commit-coordinator.js'
import type { ReplicatedWorldDelta } from './replicated-state.js'

const PositiveIntegerSchema = Schema.Int.check(Schema.isGreaterThan(0))
export type EnchantmentTableInventorySlot = number & Brand.Brand<'EnchantmentTableInventorySlot'>
export const EnchantmentTableInventorySlotSchema: Schema.Codec<EnchantmentTableInventorySlot, number> = Schema.Int
  .check(Schema.isBetween({ minimum: 0, maximum: Inventory.INVENTORY_SLOT_COUNT - 1 }))
  .pipe(Schema.brand('EnchantmentTableInventorySlot'))
const EnchantmentTableSlotSchema = Schema.Literals([0, 1, 2])

const isAnvilEnchantment = (value: unknown): value is AnvilEnchantment =>
  typeof value === 'object' && value !== null && !Array.isArray(value) &&
  'id' in value && isSupportedVanillaEnchantmentId(value.id) &&
  'level' in value && typeof value.level === 'number' && Number.isSafeInteger(value.level) && value.level > 0

const EnchantmentSchema: Schema.Codec<AnvilEnchantment, unknown> = Schema.declare(isAnvilEnchantment)

export const EnchantmentTableOfferSchema: Schema.Codec<EnchantmentTable.EnchantmentTableOffer, unknown> = Schema.Struct({
  levelCost: PositiveIntegerSchema,
  lapisCost: Schema.Literals([1, 2, 3]),
  enchantments: Schema.Array(EnchantmentSchema),
})

export type EnchantmentTableApplyState = Readonly<{
  playerStorage: PlayerStorage.PlayerStorage
  vitals: Vitals.Vitals
}>

export const EnchantmentTableApplyStateSchema: Schema.Codec<EnchantmentTableApplyState, unknown> = Schema.Struct({
  playerStorage: PlayerStorageSnapshotSchema,
  vitals: Vitals.VitalsSchema,
})

export type EnchantmentTableApplyRequest = Readonly<{
  playerStorageOwnerId: ReplicatedOwnerId
  vitalsOwnerId: ReplicatedOwnerId
  itemSlot: EnchantmentTableInventorySlot
  lapisSlot: EnchantmentTableInventorySlot
  tableSlot: EnchantmentTable.EnchantmentTableSlot
  offer: EnchantmentTable.EnchantmentTableOffer
}>

export const EnchantmentTableApplyRequestSchema: Schema.Codec<EnchantmentTableApplyRequest, unknown> = Schema.Struct({
  playerStorageOwnerId: ReplicatedOwnerIdSchema,
  vitalsOwnerId: ReplicatedOwnerIdSchema,
  itemSlot: EnchantmentTableInventorySlotSchema,
  lapisSlot: EnchantmentTableInventorySlotSchema,
  tableSlot: EnchantmentTableSlotSchema,
  offer: EnchantmentTableOfferSchema,
})

export type EnchantmentTableApplyResult = Readonly<{
  item: Inventory.ItemStack
  offer: EnchantmentTable.EnchantmentTableOffer
}>

export const EnchantmentTableApplyResultSchema: Schema.Codec<EnchantmentTableApplyResult, unknown> = Schema.Struct({
  item: Inventory.ItemStackSchema,
  offer: EnchantmentTableOfferSchema,
})

export type EnchantmentTableApplyFailure = Readonly<{
  _tag: 'EnchantmentTableApplyFailure'
  reason:
    | 'invalid-offer'
    | 'empty-item-slot'
    | 'invalid-item'
    | 'not-enchantable'
    | 'already-enchanted'
    | 'insufficient-level'
    | 'insufficient-lapis'
    | 'invalid-storage'
    | 'item-stack-failure'
  slotIndex: EnchantmentTableInventorySlot
}>

export const EnchantmentTableApplyFailureSchema: Schema.Codec<EnchantmentTableApplyFailure, unknown> =
  Schema.TaggedStruct('EnchantmentTableApplyFailure', {
    reason: Schema.Literals([
      'invalid-offer',
      'empty-item-slot',
      'invalid-item',
      'not-enchantable',
      'already-enchanted',
      'insufficient-level',
      'insufficient-lapis',
      'invalid-storage',
      'item-stack-failure',
    ]),
    slotIndex: EnchantmentTableInventorySlotSchema,
  })

export type EnchantmentTableServiceError =
  | Schema.SchemaError
  | WorldCommitPlanConflict
  | WorldCommitCoordinatorError
  | EnchantmentTableApplyFailure

export const EnchantmentTableServiceErrorSchema: Schema.Codec<EnchantmentTableServiceError, unknown> = Schema.Union([
  SchemaErrorSchema,
  WorldCommitPlanConflictSchema,
  WorldCommitCoordinatorErrorSchema,
  EnchantmentTableApplyFailureSchema,
])

const failure = (
  reason: EnchantmentTableApplyFailure['reason'],
  slotIndex: EnchantmentTableInventorySlot,
): EnchantmentTableApplyFailure => ({ _tag: 'EnchantmentTableApplyFailure', reason, slotIndex })

const invalidOffer = (offer: EnchantmentTable.EnchantmentTableOffer): boolean => {
  if (offer.enchantments.length === 0 || offer.lapisCost < 1 || offer.lapisCost > 3) return true
  const seen = new Set<string>()
  for (const enchantment of offer.enchantments) {
    if (!isSupportedVanillaEnchantmentId(enchantment.id)) return true
    const tableRule = enchantmentTableRuleFor(enchantment.id)
    if (enchantment.level < 1 || enchantment.level > tableRule.maxLevel || seen.has(enchantment.id)) return true
    if ([...seen].some((previous) => enchantmentsConflict(previous, enchantment.id))) return true
    seen.add(enchantment.id)
  }
  return false
}

const updateInventory = (
  storage: PlayerStorage.PlayerStorage,
  slotIndex: EnchantmentTableInventorySlot,
  expectedItem: Inventory.ItemStack['item'],
  count: number,
): Result.Result<PlayerStorage.PlayerStorage, EnchantmentTableServiceError> => {
  const removed = Inventory.removeItemAt(storage.inventory, slotIndex, expectedItem, count)
  if (Result.isFailure(removed)) return Result.fail(failure('item-stack-failure', slotIndex))
  if (removed.success.result._tag !== 'Removed') {
    return Result.fail(failure(
      expectedItem === 'lapis_lazuli'
        ? 'insufficient-lapis'
        : 'invalid-storage',
      slotIndex,
    ))
  }
  const updated = PlayerStorage.withInventory(storage, removed.success.inventory)
  return Result.isFailure(updated)
    ? Result.fail(failure('invalid-storage', slotIndex))
    : Result.succeed(updated.success)
}

const validateApplyRequest = (
  request: EnchantmentTableApplyRequest,
): Result.Result<void, EnchantmentTableServiceError> => {
  if (request.playerStorageOwnerId === request.vitalsOwnerId) {
    return Result.fail({ _tag: 'WorldCommitPlanOwnerConflict', ownerId: request.playerStorageOwnerId })
  }
  if (request.itemSlot === request.lapisSlot) {
    return Result.fail(failure('invalid-storage', request.itemSlot))
  }
  if (request.offer.lapisCost !== request.tableSlot + 1 || invalidOffer(request.offer)) {
    return Result.fail(failure('invalid-offer', request.itemSlot))
  }
  return Result.succeed(undefined)
}

const validateEnchantableSource = (
  snapshot: WorldCommitPlanSnapshot<EnchantmentTableApplyState>,
  request: EnchantmentTableApplyRequest,
) => {
  const source = snapshot.state.playerStorage.inventory.slots[request.itemSlot]
  if (source === undefined) return Result.fail(failure('empty-item-slot', request.itemSlot))
  if (source.item !== 'book' && itemEnchantabilityOf(source.item) === 0) {
    return Result.fail(failure('not-enchantable', request.itemSlot))
  }
  if (source.components.enchantments !== undefined || source.components.storedEnchantments !== undefined) {
    return Result.fail(failure('already-enchanted', request.itemSlot))
  }
  if (source.item !== 'book' && request.offer.enchantments.some(({ id }) => !enchantmentAppliesTo(id, source.item))) {
    return Result.fail(failure('invalid-offer', request.itemSlot))
  }
  return Result.succeed(source)
}

const planApplyResult = (
  snapshot: WorldCommitPlanSnapshot<EnchantmentTableApplyState>,
  request: EnchantmentTableApplyRequest,
): Result.Result<WorldCommitPlanFragment<EnchantmentTableApplyResult>, EnchantmentTableServiceError> => {
  const validRequest = validateApplyRequest(request)
  if (Result.isFailure(validRequest)) return Result.fail(validRequest.failure)

  const sourceResult = validateEnchantableSource(snapshot, request)
  if (Result.isFailure(sourceResult)) return Result.fail(sourceResult.failure)

  const storage = snapshot.state.playerStorage
  const source = sourceResult.success
  const currentLevel = Number(Vitals.experienceLevel(snapshot.state.vitals))
  if (currentLevel < Math.max(request.offer.levelCost, request.offer.lapisCost)) {
    return Result.fail(failure('insufficient-level', request.itemSlot))
  }

  const removedItem = updateInventory(storage, request.itemSlot, source.item, 1)
  if (Result.isFailure(removedItem)) return Result.fail(removedItem.failure)
  const removedLapis = updateInventory(removedItem.success, request.lapisSlot, 'lapis_lazuli', request.offer.lapisCost)
  if (Result.isFailure(removedLapis)) return Result.fail(removedLapis.failure)

  const enchantmentValues = Object.fromEntries(request.offer.enchantments.map(({ id, level }) => [
    id.includes(':') ? id : `minecraft:${id}`,
    level,
  ]))
  const enchantments = source.item === 'book'
    ? storedEnchantmentsComponent(enchantmentValues)
    : enchantmentsComponent(enchantmentValues)
  if (Result.isFailure(enchantments)) return Result.fail(failure('invalid-offer', request.itemSlot))

  const outputItem = EnchantmentTable.enchantmentTableOutputItemOf(source.item)
  const outputStack = Inventory.itemStack(outputItem, 1, {
    components: {
      ...source.components,
      enchantments: source.item === 'book' ? undefined : enchantments.success,
      storedEnchantments: source.item === 'book' ? enchantments.success : undefined,
    },
  })
  if (Result.isFailure(outputStack)) return Result.fail(failure('item-stack-failure', request.itemSlot))

  const output = PlayerStorage.addStoredStack(removedLapis.success, {
    item: outputItem,
    count: outputStack.success.count,
    components: outputStack.success.components,
    durability: storage.inventoryDurability[request.itemSlot] ?? null,
  })
  if (output.result._tag === 'ItemStackFailure') return Result.fail(failure('item-stack-failure', request.itemSlot))
  if (output.result._tag !== 'Added' || output.result.leftover !== null) {
    return Result.fail(failure('invalid-storage', request.itemSlot))
  }
  const progress = Number(Vitals.experienceProgress(snapshot.state.vitals))
  const nextLevel = Vitals.ExperienceLevel(Math.max(0, currentLevel - request.offer.lapisCost))
  const nextTotalExperience = Vitals.TotalExperience(
    Number(Vitals.totalExperienceAtLevel(nextLevel)) +
    progress * Number(Vitals.experienceCostOfLevel(nextLevel)),
  )
  const nextVitals: Vitals.Vitals = {
    ...snapshot.state.vitals,
    totalExperience: nextTotalExperience,
  }

  return Result.succeed({
    world: snapshot.world,
    expectedRevision: snapshot.expectedRevision,
    expectedDimensions: snapshot.expectedDimensions,
    changes: [
      { ownerId: request.playerStorageOwnerId, state: output.storage },
      { ownerId: request.vitalsOwnerId, state: nextVitals },
    ],
    result: {
      item: outputStack.success,
      offer: request.offer,
    },
    postCommitEvents: [],
  })
}

export type EnchantmentTableServiceApi = Readonly<{
  planApply: (
    snapshot: WorldCommitPlanSnapshot<EnchantmentTableApplyState>,
    request: EnchantmentTableApplyRequest,
  ) => Effect.Effect<WorldCommitPlanFragment<EnchantmentTableApplyResult>, EnchantmentTableServiceError>
  apply: (
    request: EnchantmentTableApplyRequest,
  ) => Effect.Effect<Readonly<{
    result: EnchantmentTableApplyResult
    delta: ReplicatedWorldDelta<unknown>
  }>, EnchantmentTableServiceError>
}>

const EnchantmentTableServiceBase: Context.ServiceClass<
  EnchantmentTableService,
  '@nerima-games/mc-sim/EnchantmentTableService',
  EnchantmentTableServiceApi
> = Context.Service<EnchantmentTableService, EnchantmentTableServiceApi>()(
  '@nerima-games/mc-sim/EnchantmentTableService',
)

export class EnchantmentTableService extends EnchantmentTableServiceBase {}

export const makeEnchantmentTableService = (): Effect.Effect<
  EnchantmentTableServiceApi,
  never,
  WorldCommitCoordinator
> =>
  Effect.gen(function* () {
    const coordinator = yield* WorldCommitCoordinator
    const planApply: EnchantmentTableServiceApi['planApply'] = (snapshot, request) => Effect.gen(function* () {
      const decodedSnapshot = yield* Schema.decodeUnknownEffect(
        worldCommitPlanSnapshotSchema(EnchantmentTableApplyStateSchema),
      )(snapshot)
      const decodedRequest = yield* Schema.decodeUnknownEffect(EnchantmentTableApplyRequestSchema)(request)
      return yield* Effect.fromResult(planApplyResult(decodedSnapshot, decodedRequest))
    })
    const apply: EnchantmentTableServiceApi['apply'] = (request) => Effect.gen(function* () {
      const decodedRequest = yield* Schema.decodeUnknownEffect(EnchantmentTableApplyRequestSchema)(request)
      const [playerSnapshot, vitalsSnapshot] = yield* Effect.all([
        coordinator.snapshot(decodedRequest.playerStorageOwnerId, PlayerStorageSnapshotSchema),
        coordinator.snapshot(decodedRequest.vitalsOwnerId, Vitals.VitalsSchema),
      ])
      if (playerSnapshot.world !== vitalsSnapshot.world) {
        return yield* Effect.fail({
          _tag: 'WorldCommitPlanWorldConflict',
          expected: playerSnapshot.world,
          actual: vitalsSnapshot.world,
        } as const)
      }
      if (playerSnapshot.revision !== vitalsSnapshot.revision) {
        return yield* Effect.fail({
          _tag: 'WorldCommitPlanRevisionConflict',
          expected: playerSnapshot.revision,
          actual: vitalsSnapshot.revision,
        } as const)
      }
      const snapshot: WorldCommitPlanSnapshot<EnchantmentTableApplyState> = {
        world: playerSnapshot.world,
        expectedRevision: playerSnapshot.revision,
        expectedDimensions: [],
        state: {
          playerStorage: playerSnapshot.state,
          vitals: vitalsSnapshot.state,
        },
      }
      const fragment = yield* planApply(snapshot, decodedRequest)
      const commitRequest: WorldCommitRequest = yield* Effect.fromResult(mergeWorldCommitPlans([fragment]))
      const delta = yield* coordinator.commit(commitRequest)
      return { result: fragment.result, delta }
    })
    return { planApply, apply }
  })

export const EnchantmentTableServiceLayer: Layer.Layer<
  EnchantmentTableService,
  never,
  WorldCommitCoordinator
> =
  Layer.effect(EnchantmentTableService, makeEnchantmentTableService())
