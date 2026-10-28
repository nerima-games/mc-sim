import { Context, Effect, Layer, Result, Schema } from 'effect'
import { EntityIdSchema, ITEM_TYPES, SimulationTickSchema, StackCount, itemIdOf } from '@nerima-games/mc-kernel'
import type { EntityId, FixedDurationSecs, ItemStack, ItemType, RecipeFailure, SimulationTick, WorldId, WorldRevision } from '@nerima-games/mc-kernel'
import { Brand } from 'effect'
import type { WorldCommitPlanFragment, WorldCommitPlanSnapshot } from './world-commit-plan.js'
import { worldCommitPlanFragmentSchema, worldCommitPlanSnapshotSchema } from './world-commit-plan.js'
import type { DomainEvent } from './domain-event-bus.js'
import {
  addBrewingFuel,
  advanceBrewing,
  brewingState,
  emptyBrewingState,
  setBrewingBottle,
  setBrewingIngredient,
  validateBrewingSnapshot,
  BrewingStateSchema,
  type BrewingFailure,
  type BrewingOutcome,
  type BrewingState,
  type BrewingValidationFailure,
} from '../domain/brewing.js'
import * as Inventory from '../domain/inventory.js'
import * as PlayerStorage from '../domain/player-storage.js'
import * as Equipment from '../domain/equipment.js'
import { SchemaErrorSchema } from '../schema-errors.js'
import { ReplicatedOwnerIdSchema, type ReplicatedOwnerId } from './replicated-state.js'
import { PlayerStorageSnapshotSchema } from './container-service.js'
import {
  WorldCommitCoordinatorErrorSchema,
  WorldCommitCoordinator,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorApi,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'

export const BrewingServiceStateSchema: Schema.Codec<BrewingState, unknown> =
  BrewingStateSchema

export const BrewingServicePlanSnapshotSchema: Schema.Codec<WorldCommitPlanSnapshot<BrewingState>, unknown> =
  worldCommitPlanSnapshotSchema(BrewingServiceStateSchema)
export const PotionDrinkInventorySnapshotSchema: Schema.Codec<
  WorldCommitPlanSnapshot<PlayerStorage.PlayerStorage>,
  unknown
> = worldCommitPlanSnapshotSchema(PlayerStorageSnapshotSchema)

export type BrewingBottleIndex = number & Brand.Brand<'BrewingBottleIndex'>
export const BrewingBottleIndexSchema: Schema.Codec<BrewingBottleIndex, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 2 }),
).pipe(Schema.brand('BrewingBottleIndex'))

export type BrewingElapsedSecs = number & Brand.Brand<'BrewingElapsedSecs'>
export const BrewingElapsedSecsSchema: Schema.Codec<BrewingElapsedSecs, number> = Schema.Finite.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
).pipe(Schema.brand('BrewingElapsedSecs'))

export type PotionEffectAmplifier = number & Brand.Brand<'PotionEffectAmplifier'>
export const PotionEffectAmplifierSchema: Schema.Codec<PotionEffectAmplifier, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
).pipe(Schema.brand('PotionEffectAmplifier'))

export type PotionEffectApplication = Readonly<{
  type: 'speed' | 'poison' | 'regeneration'
  durationSecs: FixedDurationSecs
  amplifier: PotionEffectAmplifier
}>

export const PotionEffectApplicationSchema: Schema.Codec<PotionEffectApplication, unknown> = Schema.Struct({
  type: Schema.Literals(['speed', 'poison', 'regeneration']),
  durationSecs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))
    .pipe(Schema.brand('FixedDurationSecs')),
  amplifier: PotionEffectAmplifierSchema,
})

export type PotionDrinkOutcome =
  | Readonly<{ _tag: 'Consumed'; item: ItemType; effect: PotionEffectApplication }>
  | Readonly<{ _tag: 'ConsumedWithoutEffect'; item: ItemType }>

export const PotionDrinkOutcomeSchema: Schema.Codec<PotionDrinkOutcome, unknown> = Schema.Union([
  Schema.TaggedStruct('Consumed', {
    item: Schema.Literals(ITEM_TYPES),
    effect: PotionEffectApplicationSchema,
  }),
  Schema.TaggedStruct('ConsumedWithoutEffect', {
    item: Schema.Literals(ITEM_TYPES),
  }),
])

export type PotionDrinkSlotIndex = number & Brand.Brand<'PotionDrinkSlotIndex'>
export const PotionDrinkSlotIndexSchema: Schema.Codec<PotionDrinkSlotIndex, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Inventory.INVENTORY_SLOT_COUNT - 1 }),
).pipe(Schema.brand('PotionDrinkSlotIndex'))

export type PotionDrinkIntent = Readonly<{
  inventoryOwnerId: ReplicatedOwnerId
  actor: EntityId
  slotIndex: PotionDrinkSlotIndex
  tick: SimulationTick
}>

export const PotionDrinkIntentSchema: Schema.Codec<PotionDrinkIntent, unknown> = Schema.Struct({
  inventoryOwnerId: ReplicatedOwnerIdSchema,
  actor: EntityIdSchema,
  slotIndex: PotionDrinkSlotIndexSchema,
  tick: SimulationTickSchema,
})

type PotionDrinkFailure =
  | Readonly<{ _tag: 'PotionDrinkEmptySlot'; slotIndex: PotionDrinkSlotIndex }>
  | Readonly<{ _tag: 'PotionDrinkNotDrinkable'; slotIndex: PotionDrinkSlotIndex; item: ItemType }>

export const PotionDrinkFailureSchema: Schema.Codec<PotionDrinkFailure, unknown> = Schema.Union([
  Schema.TaggedStruct('PotionDrinkEmptySlot', {
    slotIndex: PotionDrinkSlotIndexSchema,
  }),
  Schema.TaggedStruct('PotionDrinkNotDrinkable', {
    slotIndex: PotionDrinkSlotIndexSchema,
    item: Schema.Literals(ITEM_TYPES),
  }),
])

export const PotionDrinkPlanSchema: Schema.Codec<WorldCommitPlanFragment<PotionDrinkOutcome>, unknown> =
  worldCommitPlanFragmentSchema(PotionDrinkOutcomeSchema)

export type BrewingServiceError =
  | Brand.BrandError
  | BrewingFailure
  | Inventory.ItemStackFailure
  | PlayerStorage.PlayerStorageFailure
  | PotionDrinkFailure
  | Schema.SchemaError
  | WorldCommitCoordinatorError

const InvalidInventoryDurabilitySchema: Schema.Codec<PlayerStorage.InvalidInventoryDurability, unknown> =
  Schema.Struct({
    _tag: Schema.Literal('InvalidInventoryDurability'),
    slotIndex: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Inventory.INVENTORY_SLOT_COUNT - 1 })),
    item: Schema.Literals(ITEM_TYPES),
  })
const PlayerStorageMutationFailureSchema: Schema.Codec<PlayerStorage.PlayerStorageFailure, unknown> = Schema.Union([
  Equipment.EquipmentItemFailureSchema,
  InvalidInventoryDurabilitySchema,
])
const RecipeFailureCodec: Schema.Codec<RecipeFailure, unknown> = Schema.Union([
  Schema.TaggedStruct('RecipeTypeFailure', { name: Schema.Literal('TypeError'), message: Schema.String }),
  Schema.TaggedStruct('RecipeRangeFailure', { name: Schema.Literal('RangeError'), message: Schema.String }),
  Schema.TaggedStruct('RecipeExternalFailure', {
    name: Schema.String,
    message: Schema.String,
    componentKey: Schema.optionalKey(Schema.String),
  }),
  Schema.TaggedStruct('RecipeItemFailure', { failure: Inventory.KernelItemStackFailureSchema }),
])
const BrewingValidationFailureCodec: Schema.Codec<BrewingValidationFailure, unknown> = Schema.TaggedStruct(
  'BrewingValidationFailure',
  { path: Schema.String, reason: Schema.String },
)
const BrewingFailureCodec: Schema.Codec<BrewingFailure, unknown> = Schema.Union([
  Inventory.BrandErrorSchema,
  Inventory.ItemStackFailureSchema,
  RecipeFailureCodec,
  BrewingValidationFailureCodec,
])

export const BrewingServiceErrorSchema: Schema.Codec<BrewingServiceError, unknown> = Schema.Union([
  BrewingFailureCodec,
  Inventory.BrandErrorSchema,
  Inventory.ItemStackFailureSchema,
  PlayerStorageMutationFailureSchema,
  PotionDrinkFailureSchema,
  SchemaErrorSchema,
  WorldCommitCoordinatorErrorSchema,
])

export type BrewingServiceApi = Readonly<{
  snapshot: Effect.Effect<BrewingState, Schema.SchemaError | WorldCommitCoordinatorError, WorldCommitCoordinator>
  setBottle: (index: number, bottle: ItemStack | undefined) => Effect.Effect<BrewingState, BrewingServiceError, WorldCommitCoordinator>
  setIngredient: (ingredient: ItemStack | undefined) => Effect.Effect<BrewingState, BrewingServiceError, WorldCommitCoordinator>
  setFuel: (fuel: ItemStack | undefined) => Effect.Effect<BrewingState, BrewingServiceError, WorldCommitCoordinator>
  addFuel: Effect.Effect<BrewingState, BrewingServiceError, WorldCommitCoordinator>
  advance: (elapsedSecs: number) => Effect.Effect<BrewingOutcome, BrewingServiceError, WorldCommitCoordinator>
  restore: (snapshot: unknown) => Effect.Effect<void, BrewingServiceError, WorldCommitCoordinator>
  reset: Effect.Effect<void, BrewingServiceError, WorldCommitCoordinator>
  planSetBottle: (snapshot: WorldCommitPlanSnapshot<BrewingState>, index: BrewingBottleIndex, bottle: ItemStack | undefined) => Effect.Effect<WorldCommitPlanFragment<BrewingState>, BrewingServiceError>
  planSetIngredient: (snapshot: WorldCommitPlanSnapshot<BrewingState>, ingredient: ItemStack | undefined) => Effect.Effect<WorldCommitPlanFragment<BrewingState>, BrewingServiceError>
  planSetFuel: (snapshot: WorldCommitPlanSnapshot<BrewingState>, fuel: ItemStack | undefined) => Effect.Effect<WorldCommitPlanFragment<BrewingState>, BrewingServiceError>
  planAddFuel: (snapshot: WorldCommitPlanSnapshot<BrewingState>) => Effect.Effect<WorldCommitPlanFragment<BrewingState>, BrewingServiceError>
  planAdvance: (snapshot: WorldCommitPlanSnapshot<BrewingState>, elapsedSecs: BrewingElapsedSecs) => Effect.Effect<WorldCommitPlanFragment<BrewingOutcome>, BrewingServiceError>
  planRestore: (snapshot: WorldCommitPlanSnapshot<BrewingState>, state: unknown) => Effect.Effect<WorldCommitPlanFragment<void>, BrewingServiceError>
  planReset: (snapshot: WorldCommitPlanSnapshot<BrewingState>) => Effect.Effect<WorldCommitPlanFragment<void>, BrewingServiceError>
  planDrinkPotion: (snapshot: WorldCommitPlanSnapshot<PlayerStorage.PlayerStorage>, intent: PotionDrinkIntent) => Effect.Effect<WorldCommitPlanFragment<PotionDrinkOutcome>, BrewingServiceError>
}>

const BrewingServiceBase: Context.ServiceClass<
  BrewingService,
  '@nerima-games/mc-sim/BrewingService',
  BrewingServiceApi
> = Context.Service<BrewingService, BrewingServiceApi>()('@nerima-games/mc-sim/BrewingService')

export class BrewingService extends BrewingServiceBase {}

const fromResult = <A, E>(result: Result.Result<A, E>): Effect.Effect<A, E> =>
  Result.isSuccess(result) ? Effect.succeed(result.success) : Effect.fail(result.failure)

export const makeBrewingServiceRegistration = (
  ownerId: ReplicatedOwnerId,
  initial?: unknown,
): Result.Result<ReplicatedOwnerRegistration<typeof BrewingServiceStateSchema>, BrewingFailure> => {
  const state = initial === undefined ? emptyBrewingState() : brewingState(initial)
  return Result.map(state, (initialState) => ({ ownerId, schema: BrewingServiceStateSchema, initialState }))
}

type BrewingUpdate<A> = Readonly<{ value: A; state: BrewingState }>

const makeBrewingPlan = <A>(
  ownerId: ReplicatedOwnerId,
  snapshot: WorldCommitPlanSnapshot<BrewingState>,
  update: (current: BrewingState) => Result.Result<BrewingUpdate<A>, BrewingFailure>,
): Effect.Effect<WorldCommitPlanFragment<A>, BrewingFailure> => fromResult(
  Result.map(update(snapshot.state), ({ value, state }) => ({
    world: snapshot.world,
    expectedRevision: snapshot.expectedRevision,
    expectedDimensions: snapshot.expectedDimensions,
    changes: [{ ownerId, state }],
    result: value,
    postCommitEvents: [],
  })),
)

const commitPlan = <A>(
  coordinator: WorldCommitCoordinatorApi,
  plan: WorldCommitPlanFragment<A>,
): Effect.Effect<A, WorldCommitCoordinatorError> => Effect.map(
  coordinator.commit({
    expectedRevision: plan.expectedRevision,
    expectedDimensions: plan.expectedDimensions,
    changes: plan.changes,
  }),
  () => plan.result,
)

const asPlanSnapshot = <A>(snapshot: Readonly<{ world: WorldId; revision: WorldRevision; state: A }>): WorldCommitPlanSnapshot<A> => ({
  world: snapshot.world,
  expectedRevision: snapshot.revision,
  expectedDimensions: [],
  state: snapshot.state,
})

const updateBrewingState = <A>(
  ownerId: ReplicatedOwnerId,
  makePlan: (snapshot: WorldCommitPlanSnapshot<BrewingState>) => Effect.Effect<WorldCommitPlanFragment<A>, BrewingServiceError>,
): Effect.Effect<A, BrewingServiceError, WorldCommitCoordinator> => Effect.flatMap(
  WorldCommitCoordinator,
  (coordinator) => Effect.flatMap(
    coordinator.snapshot(ownerId, BrewingServiceStateSchema),
    (replica) => Effect.flatMap(
      makePlan(asPlanSnapshot(replica)),
      (plan) => commitPlan(coordinator, plan),
    ),
  ),
)

const potionEffectFor = (item: ItemType): PotionEffectApplication | undefined => {
  const amplifier = Brand.nominal<PotionEffectAmplifier>()(0)
  switch (item) {
    case 'potion_of_swiftness':
      return { type: 'speed', durationSecs: Brand.nominal<FixedDurationSecs>()(180), amplifier }
    case 'potion_of_poison':
      return { type: 'poison', durationSecs: Brand.nominal<FixedDurationSecs>()(45), amplifier }
    case 'potion_of_regeneration':
      return { type: 'regeneration', durationSecs: Brand.nominal<FixedDurationSecs>()(45), amplifier }
    default: return undefined
  }
}

const potionWithoutEffect = (item: ItemType): boolean =>
  item === 'water_bottle' || item === 'awkward_potion'

const drinkPotionPlan = (
  snapshot: WorldCommitPlanSnapshot<PlayerStorage.PlayerStorage>,
  intent: PotionDrinkIntent,
): Result.Result<WorldCommitPlanFragment<PotionDrinkOutcome>, BrewingServiceError> => {
  const potion = snapshot.state.inventory.slots[intent.slotIndex]
  if (potion === undefined) {
    return Result.fail({ _tag: 'PotionDrinkEmptySlot', slotIndex: intent.slotIndex })
  }

  const effect = potionEffectFor(potion.item)
  if (effect === undefined && !potionWithoutEffect(potion.item)) {
    return Result.fail({ _tag: 'PotionDrinkNotDrinkable', slotIndex: intent.slotIndex, item: potion.item })
  }

  return Result.flatMap(
    Inventory.removeItemAt(snapshot.state.inventory, intent.slotIndex, potion.item, 1),
    (removed) => Result.flatMap(
      Inventory.addItem(removed.inventory, 'glass_bottle', 1),
      ({ inventory }) => Result.flatMap(
        PlayerStorage.withInventory(snapshot.state, inventory),
        (state) => Result.map(StackCount.result(1), (count) => {
          const result: PotionDrinkOutcome = effect === undefined
            ? { _tag: 'ConsumedWithoutEffect', item: potion.item }
            : { _tag: 'Consumed', item: potion.item, effect }
          const event: DomainEvent = {
            _tag: 'ItemConsumed',
            tick: intent.tick,
            actor: intent.actor,
            item: itemIdOf(potion.item),
            count,
            use: 'potion',
          }
          return {
            world: snapshot.world,
            expectedRevision: snapshot.expectedRevision,
            expectedDimensions: snapshot.expectedDimensions,
            changes: [{ ownerId: intent.inventoryOwnerId, state }],
            result,
            postCommitEvents: [event],
          }
        }),
      ),
    ),
  )
}

export const makeBrewingService = (
  ownerId: ReplicatedOwnerId,
): Effect.Effect<BrewingServiceApi> => Effect.succeed({
  snapshot: Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
    Effect.map(coordinator.snapshot(ownerId, BrewingServiceStateSchema), ({ state }) => state),
  ),
  planSetBottle: (snapshot, index, bottle) => makeBrewingPlan(ownerId, snapshot, (current) =>
    Result.map(setBrewingBottle(current, index, bottle), (state) => ({ value: state, state })),
  ),
  planSetIngredient: (snapshot, ingredient) => makeBrewingPlan(ownerId, snapshot, (current) =>
    Result.map(setBrewingIngredient(current, ingredient), (state) => ({ value: state, state })),
  ),
  planSetFuel: (snapshot, fuel) => makeBrewingPlan(ownerId, snapshot, (current) =>
    Result.map(brewingState({ ...current, fuel }), (state) => ({ value: state, state })),
  ),
  planAddFuel: (snapshot) => makeBrewingPlan(ownerId, snapshot, (current) =>
    Result.map(addBrewingFuel(current), (state) => ({ value: state, state })),
  ),
  planAdvance: (snapshot, elapsedSecs) => makeBrewingPlan(ownerId, snapshot, (current) =>
    Result.map(advanceBrewing(current, elapsedSecs), (outcome) => ({ value: outcome, state: outcome.state })),
  ),
  planRestore: (snapshot, incoming) => {
    const validated = validateBrewingSnapshot(incoming)
    if (validated._tag !== 'Valid') return Effect.fail(validated.error)
    return makeBrewingPlan(ownerId, snapshot, () => Result.succeed({ value: undefined, state: validated.state }))
  },
  planReset: (snapshot) => fromResult(emptyBrewingState()).pipe(
    Effect.flatMap((state) => makeBrewingPlan(ownerId, snapshot, () => Result.succeed({ value: undefined, state }))),
  ),
  planDrinkPotion: (snapshot, rawIntent) => Effect.flatMap(
    Schema.decodeUnknownEffect(PotionDrinkIntentSchema)(rawIntent),
    (intent) => fromResult(drinkPotionPlan(snapshot, intent)),
  ),
  setBottle: (index, bottle) => updateBrewingState(ownerId, (snapshot) => makeBrewingPlan(
    ownerId,
    snapshot,
    (current) => Result.map(setBrewingBottle(current, index, bottle), (state) => ({ value: state, state })),
  )),
  setIngredient: (ingredient) => updateBrewingState(ownerId, (snapshot) => makeBrewingPlan(
    ownerId,
    snapshot,
    (current) => Result.map(setBrewingIngredient(current, ingredient), (state) => ({ value: state, state })),
  )),
  setFuel: (fuel) => updateBrewingState(ownerId, (snapshot) => makeBrewingPlan(
    ownerId,
    snapshot,
    (current) => Result.map(brewingState({ ...current, fuel }), (state) => ({ value: state, state })),
  )),
  addFuel: updateBrewingState(ownerId, (snapshot) => makeBrewingPlan(
    ownerId,
    snapshot,
    (current) => Result.map(addBrewingFuel(current), (state) => ({ value: state, state })),
  )),
  advance: (elapsedSecs) => updateBrewingState(ownerId, (snapshot) => makeBrewingPlan(
    ownerId,
    snapshot,
    (current) => Result.map(advanceBrewing(current, elapsedSecs), (outcome) => ({ value: outcome, state: outcome.state })),
  )),
  restore: (incoming) => {
    const validated = validateBrewingSnapshot(incoming)
    if (validated._tag !== 'Valid') return Effect.fail(validated.error)
    return updateBrewingState(ownerId, (snapshot) => makeBrewingPlan(
      ownerId,
      snapshot,
      () => Result.succeed({ value: undefined, state: validated.state }),
    ))
  },
  reset: fromResult(emptyBrewingState()).pipe(
    Effect.flatMap((state) => updateBrewingState(ownerId, (snapshot) => makeBrewingPlan(
      ownerId,
      snapshot,
      () => Result.succeed({ value: undefined, state }),
    ))),
  ),
})

export const BrewingServiceLayer = (ownerId: ReplicatedOwnerId): Layer.Layer<BrewingService> =>
  Layer.effect(BrewingService, makeBrewingService(ownerId))
