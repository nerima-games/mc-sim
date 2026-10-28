import { Context, Effect, Layer, Result, Schema } from 'effect'
import {
  ITEM_TYPES,
  type BlockAddress,
  type Dimension,
  type WorldRevision,
  type WorldWriteBatch,
} from '@nerima-games/mc-kernel'
import * as Container from '../domain/container-storage.js'
import * as PlayerStorage from '../domain/player-storage.js'
import * as Inv from '../domain/inventory.js'
import * as Eq from '../domain/equipment.js'
import { SchemaErrorSchema } from '../schema-errors.js'
import { ContainerStoredStackSchema } from './inventory-service.js'
import {
  WorldCommitPlanConflictSchema,
  mergeWorldCommitPlans,
  type WorldCommitPlanConflict,
} from './world-commit-plan.js'
import {
  makeReplicatedOwnerId,
  type ReplicatedOwnerId,
} from './replicated-state.js'
import type { WorldCommitPlanFragment, WorldCommitPlanSnapshot } from './world-commit-plan.js'
import {
  type DimensionRevisionExpectation,
  WorldCommitCoordinator,
  WorldRevisionConflict,
  WorldCommitCoordinatorErrorSchema,
  type ReplicatedOwnerCandidate,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'

export const CONTAINER_STORAGE_REPLICATED_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('container-storage')

const ContainerKindSchema = Schema.Literals([
  'chest',
  'shulker_box',
  'dispenser',
  'dropper',
  'hopper',
])

const ContainerIdSchema = Schema.String.check(
  Schema.makeFilter((id) => id.length > 0 && id.trim() === id),
)

const ContainerSlotSchema = Schema.NullOr(ContainerStoredStackSchema)

const ContainerSchema: Schema.Codec<Container.Container, unknown> = Schema.Struct({
  id: ContainerIdSchema,
  kind: ContainerKindSchema,
  slots: Schema.Array(ContainerSlotSchema),
}).check(Schema.makeFilter(({ kind, slots }) => slots.length === Container.containerCapacity(kind)))

export const ContainerStorageSnapshotSchema: Schema.Codec<Container.ContainerStorageSnapshot, unknown> = Schema.Struct({
  version: Schema.Literal(Container.CONTAINER_STORAGE_SNAPSHOT_VERSION),
  containers: Schema.Array(ContainerSchema),
}).check(Schema.makeFilter(({ containers }) => {
  const ids = new Set(containers.map((container) => container.id))
  return ids.size === containers.length
}))

const InventorySlotSchema: Schema.Codec<Inv.Slot, unknown> = Schema.Union([
  Inv.ItemStackSchema,
  Schema.Undefined,
])

const PlayerInventorySchema: Schema.Codec<Inv.Inventory, unknown> = Schema.Struct({
  slots: Schema.Array(InventorySlotSchema),
}).check(Schema.makeFilter(({ slots }) => slots.length === Inv.INVENTORY_SLOT_COUNT))

const InventoryDurabilitySchema: Schema.Codec<PlayerStorage.PlayerStorage['inventoryDurability'], unknown> =
  Schema.Array(Schema.NullOr(Eq.DurabilitySchema))
    .check(Schema.makeFilter((values) => values.length === Inv.INVENTORY_SLOT_COUNT))

export const PlayerStorageSnapshotSchema: Schema.Codec<PlayerStorage.PlayerStorage, unknown> = Schema.Struct({
  inventory: PlayerInventorySchema,
  equipment: Eq.EquipmentSchema,
  inventoryDurability: InventoryDurabilitySchema,
}).check(Schema.makeFilter(({ inventory, inventoryDurability }) =>
  inventory.slots.every((slot, index) => {
    const durability = inventoryDurability[index]
    if (slot === undefined) return durability === null
    return Eq.isDamageableItemType(slot.item)
      ? Eq.isValidDurabilityForItem(slot.item, durability)
      : durability === null
  })))

const PositiveSafeIntegerSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
)

export const CreateContainerResultSchema: Schema.Codec<Container.CreateContainerResult, unknown> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Created'), container: ContainerSchema }),
  Schema.Struct({ _tag: Schema.Literal('AlreadyExists'), container: ContainerSchema }),
  Schema.Struct({ _tag: Schema.Literal('InvalidContainerId') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidContainerKind') }),
])

export const ContainerTransferResultSchema: Schema.Codec<Container.ContainerTransferResult, unknown> = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Transferred'),
    item: Schema.Literals(ITEM_TYPES),
    count: PositiveSafeIntegerSchema,
    direction: Schema.Literals(['PlayerToContainer', 'ContainerToPlayer']),
  }),
  Schema.Struct({ _tag: Schema.Literal('ContainerNotFound') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidPlayerSlot') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidContainerSlot') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidCount') }),
  Schema.Struct({ _tag: Schema.Literal('EmptySource') }),
  Schema.Struct({ _tag: Schema.Literal('InsufficientSource'), available: PositiveSafeIntegerSchema }),
  Schema.Struct({ _tag: Schema.Literal('DestinationMismatch') }),
  Schema.Struct({ _tag: Schema.Literal('DestinationFull') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidDirection') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidSourceStack') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidDestinationStack') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidSourceDurability') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidRequest') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidPlayerStorage') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidContainerStorage') }),
  Schema.Struct({ _tag: Schema.Literal('ItemStackFailure'), error: Inv.ItemStackFailureSchema }),
])

export const ContainerExtractResultSchema: Schema.Codec<Container.ContainerExtractResult, unknown> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Extracted'), stack: ContainerStoredStackSchema }),
  Schema.Struct({ _tag: Schema.Literal('ContainerNotFound') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidContainerSlot') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidCount') }),
  Schema.Struct({ _tag: Schema.Literal('EmptySource') }),
  Schema.Struct({ _tag: Schema.Literal('InsufficientSource'), available: PositiveSafeIntegerSchema }),
  Schema.Struct({ _tag: Schema.Literal('InvalidSourceStack') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidSourceDurability') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidRequest') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidContainerStorage') }),
  Schema.Struct({ _tag: Schema.Literal('ItemStackFailure'), error: Inv.ItemStackFailureSchema }),
])

export const ContainerMoveResultSchema: Schema.Codec<Container.ContainerMoveResult, unknown> = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Moved'),
    item: Schema.Literals(ITEM_TYPES),
    count: PositiveSafeIntegerSchema,
  }),
  Schema.Struct({ _tag: Schema.Literal('SourceContainerNotFound') }),
  Schema.Struct({ _tag: Schema.Literal('DestinationContainerNotFound') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidSourceSlot') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidDestinationSlot') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidCount') }),
  Schema.Struct({ _tag: Schema.Literal('EmptySource') }),
  Schema.Struct({ _tag: Schema.Literal('InsufficientSource'), available: PositiveSafeIntegerSchema }),
  Schema.Struct({ _tag: Schema.Literal('DestinationMismatch') }),
  Schema.Struct({ _tag: Schema.Literal('DestinationFull') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidSourceStack') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidDestinationStack') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidSourceDurability') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidRequest') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidContainerStorage') }),
  Schema.Struct({ _tag: Schema.Literal('ItemStackFailure'), error: Inv.ItemStackFailureSchema }),
])

export const ContainerStorageServiceErrorSchema: Schema.Codec<ContainerStorageServiceFailure, unknown> = Schema.Union([
  SchemaErrorSchema,
  WorldCommitPlanConflictSchema,
  WorldCommitCoordinatorErrorSchema,
])

const decodeContainerKind = (kind: unknown) => kind === undefined
  ? Effect.succeed<Container.ContainerKind | undefined>(undefined)
  : Schema.decodeUnknownEffect(ContainerKindSchema)(kind)

export const containerStorageOwnerRegistration = (
  initialState: Container.ContainerStorageSnapshot = Container.snapshotContainerStorage(
    Container.emptyContainerStorage(),
  ),
): ReplicatedOwnerRegistration<typeof ContainerStorageSnapshotSchema> => ({
  ownerId: CONTAINER_STORAGE_REPLICATED_OWNER_ID,
  schema: ContainerStorageSnapshotSchema,
  initialState,
})

export const playerStorageOwnerRegistration = (
  ownerId: ReplicatedOwnerId,
  initialState: PlayerStorage.PlayerStorage = PlayerStorage.emptyPlayerStorage(),
): ReplicatedOwnerRegistration<typeof PlayerStorageSnapshotSchema> => ({
  ownerId,
  schema: PlayerStorageSnapshotSchema,
  initialState,
})

export type ContainerStorageServiceFailure = Schema.SchemaError | WorldCommitPlanConflict | WorldCommitCoordinatorError

export type ContainerStoragePlanSnapshot = WorldCommitPlanSnapshot<Container.ContainerStorageSnapshot>
export type PlayerStoragePlanSnapshot = WorldCommitPlanSnapshot<PlayerStorage.PlayerStorage>

export type ContainerStorageCommitOptions = Readonly<{
  expectedRevision?: WorldRevision
  blockWrite?: WorldWriteBatch
  additionalChanges?: ReadonlyArray<ReplicatedOwnerCandidate>
}>

export type ContainerStorageTransferRequest = Readonly<{
  playerOwnerId: ReplicatedOwnerId
  address: BlockAddress
  direction: Container.ContainerTransferRequest['direction']
  playerSlot: number
  containerSlot: number
  count: number
}>

export type ContainerStorageExtractRequest = Readonly<{
  address: BlockAddress
  containerSlot: number
  count: number
}>

export type ContainerStorageMoveRequest = Readonly<{
  sourceAddress: BlockAddress
  sourceSlot: number
  destinationAddress: BlockAddress
  destinationSlot: number
  count: number
}>

export type ContainerStorageServiceApi = Readonly<{
  snapshot: Effect.Effect<Container.ContainerStorageSnapshot, ContainerStorageServiceFailure>
  containerSnapshot: (
    id: Container.WorldContainerId,
  ) => Effect.Effect<Container.Container | null, ContainerStorageServiceFailure>
  containerSnapshotAt: (
    address: BlockAddress,
  ) => Effect.Effect<Container.Container | null, ContainerStorageServiceFailure>
  planCreateContainerAt: (
    snapshot: ContainerStoragePlanSnapshot,
    address: BlockAddress,
    kind?: Container.ContainerKind,
  ) => Effect.Effect<WorldCommitPlanFragment<Container.CreateContainerResult>, ContainerStorageServiceFailure>
  planTransferContainerItem: (
    snapshot: ContainerStoragePlanSnapshot,
    playerSnapshot: PlayerStoragePlanSnapshot,
    request: ContainerStorageTransferRequest,
  ) => Effect.Effect<WorldCommitPlanFragment<Container.ContainerTransferResult>, ContainerStorageServiceFailure>
  planExtractContainerItem: (
    snapshot: ContainerStoragePlanSnapshot,
    request: ContainerStorageExtractRequest,
  ) => Effect.Effect<WorldCommitPlanFragment<Container.ContainerExtractResult>, ContainerStorageServiceFailure>
  planMoveContainerItem: (
    snapshot: ContainerStoragePlanSnapshot,
    request: ContainerStorageMoveRequest,
  ) => Effect.Effect<WorldCommitPlanFragment<Container.ContainerMoveResult>, ContainerStorageServiceFailure>
  createContainerAt: (
    address: BlockAddress,
    kind?: Container.ContainerKind,
    options?: ContainerStorageCommitOptions,
  ) => Effect.Effect<Container.CreateContainerResult, ContainerStorageServiceFailure>
  transferContainerItem: (
    request: ContainerStorageTransferRequest,
    options?: ContainerStorageCommitOptions,
  ) => Effect.Effect<Container.ContainerTransferResult, ContainerStorageServiceFailure>
  extractContainerItem: (
    request: ContainerStorageExtractRequest,
    options?: ContainerStorageCommitOptions,
  ) => Effect.Effect<Container.ContainerExtractResult, ContainerStorageServiceFailure>
  moveContainerItem: (
    request: ContainerStorageMoveRequest,
    options?: ContainerStorageCommitOptions,
  ) => Effect.Effect<Container.ContainerMoveResult, ContainerStorageServiceFailure>
}>

const ContainerStorageServiceBase: Context.ServiceClass<
  ContainerStorageService,
  '@nerima-games/mc-sim/ContainerStorageService',
  ContainerStorageServiceApi
> = Context.Service<ContainerStorageService, ContainerStorageServiceApi>()(
  '@nerima-games/mc-sim/ContainerStorageService',
)

export class ContainerStorageService extends ContainerStorageServiceBase {}

const storageOf = (
  snapshot: Container.ContainerStorageSnapshot,
): Container.ContainerStorage => ({ containers: snapshot.containers })

const dimensionsOf = (addresses: ReadonlyArray<BlockAddress>): ReadonlyArray<Dimension> =>
  [...new Set(addresses.map((address) => address.dimension))]

const expectedDimensionsFor = (
  dimensions: ReadonlyArray<Dimension>,
  expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>,
): Effect.Effect<ReadonlyArray<DimensionRevisionExpectation>, WorldCommitPlanConflict> =>
  Effect.forEach(dimensions, (dimension) => {
    const expectation = expectedDimensions.find((candidate) => candidate.dimension === dimension)
    return expectation === undefined
      ? Effect.fail({ _tag: 'WorldCommitPlanDimensionRevisionMissing', dimension } as const)
      : Effect.succeed(expectation)
  })

export const makeContainerStorageService = (): Effect.Effect<
  ContainerStorageServiceApi,
  never,
  WorldCommitCoordinator
> =>
  Effect.gen(function* () {
    const coordinator = yield* WorldCommitCoordinator

    const currentSnapshot = () =>
      coordinator.snapshot(CONTAINER_STORAGE_REPLICATED_OWNER_ID, ContainerStorageSnapshotSchema)

    const readExpectedDimensions = (
      addresses: ReadonlyArray<BlockAddress>,
      blockWrite: WorldWriteBatch | undefined,
    ): Effect.Effect<ReadonlyArray<DimensionRevisionExpectation>> => {
      const dimensions = [...dimensionsOf(addresses)]
      if (blockWrite !== undefined && !dimensions.includes(blockWrite.dimension)) dimensions.push(blockWrite.dimension)
      return Effect.forEach(dimensions, (dimension) => {
        if (blockWrite?.dimension === dimension) {
          return Effect.succeed({ dimension, expectedRevision: blockWrite.expectedDimensionRevision })
        }
        return Effect.map(coordinator.dimensionRevision(dimension), (expectedRevision) => ({ dimension, expectedRevision }))
      })
    }

    const planSnapshot = (
      snapshot: Readonly<{ world: ContainerStoragePlanSnapshot['world']; revision: WorldRevision; state: Container.ContainerStorageSnapshot }>,
      addresses: ReadonlyArray<BlockAddress>,
      blockWrite: WorldWriteBatch | undefined,
    ): Effect.Effect<ContainerStoragePlanSnapshot> =>
      Effect.map(readExpectedDimensions(addresses, blockWrite), (expectedDimensions) => ({
        world: snapshot.world,
        expectedRevision: snapshot.revision,
        expectedDimensions,
        state: snapshot.state,
      }))

    const planPlayerSnapshot = (
      snapshot: Readonly<{ world: PlayerStoragePlanSnapshot['world']; revision: WorldRevision; state: PlayerStorage.PlayerStorage }>,
      expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>,
    ): PlayerStoragePlanSnapshot => ({
      world: snapshot.world,
      expectedRevision: snapshot.revision,
      expectedDimensions,
      state: snapshot.state,
    })

    const planCreateContainerAt: ContainerStorageServiceApi['planCreateContainerAt'] = (snapshot, address, kind) =>
      Effect.flatMap(decodeContainerKind(kind), (validKind) =>
        Effect.gen(function* () {
          const outcome = Container.createContainer(
            storageOf(snapshot.state),
            Container.worldContainerIdAt(address),
            validKind,
          )
          if (outcome.result._tag !== 'Created') {
            return {
              world: snapshot.world,
              expectedRevision: snapshot.expectedRevision,
              expectedDimensions: [],
              changes: [],
              result: outcome.result,
              postCommitEvents: [],
            } satisfies WorldCommitPlanFragment<Container.CreateContainerResult>
          }
          const expectedDimensions = yield* expectedDimensionsFor([address.dimension], snapshot.expectedDimensions)
          return {
            world: snapshot.world,
            expectedRevision: snapshot.expectedRevision,
            expectedDimensions,
            changes: [{
              ownerId: CONTAINER_STORAGE_REPLICATED_OWNER_ID,
              state: Container.snapshotContainerStorage(outcome.storage),
            }],
            result: outcome.result,
            postCommitEvents: [],
          } satisfies WorldCommitPlanFragment<Container.CreateContainerResult>
        }),
      )

    const planTransferContainerItem: ContainerStorageServiceApi['planTransferContainerItem'] = (
      snapshot,
      playerSnapshot,
      request,
    ) => Effect.gen(function* () {
      if (snapshot.world !== playerSnapshot.world) {
        return yield* Effect.fail({
          _tag: 'WorldCommitPlanWorldConflict',
          expected: snapshot.world,
          actual: playerSnapshot.world,
        } as const)
      }
      if (snapshot.expectedRevision !== playerSnapshot.expectedRevision) {
        return yield* Effect.fail(new WorldRevisionConflict({
          expected: snapshot.expectedRevision,
          actual: playerSnapshot.expectedRevision,
        }))
      }
      const outcome = Container.transferContainerItem(
        playerSnapshot.state,
        storageOf(snapshot.state),
        {
          direction: request.direction,
          containerId: Container.worldContainerIdAt(request.address),
          playerSlot: request.playerSlot,
          containerSlot: request.containerSlot,
          count: request.count,
        },
      )
      if (outcome.result._tag !== 'Transferred') {
        return {
          world: snapshot.world,
          expectedRevision: snapshot.expectedRevision,
          expectedDimensions: [],
          changes: [],
          result: outcome.result,
          postCommitEvents: [],
        } satisfies WorldCommitPlanFragment<Container.ContainerTransferResult>
      }
      const expectedDimensions = yield* expectedDimensionsFor([request.address.dimension], snapshot.expectedDimensions)
      return {
        world: snapshot.world,
        expectedRevision: snapshot.expectedRevision,
        expectedDimensions,
        changes: [
          {
            ownerId: CONTAINER_STORAGE_REPLICATED_OWNER_ID,
            state: Container.snapshotContainerStorage(outcome.containerStorage),
          },
          { ownerId: request.playerOwnerId, state: outcome.playerStorage },
        ],
        result: outcome.result,
        postCommitEvents: [],
      } satisfies WorldCommitPlanFragment<Container.ContainerTransferResult>
    })

    const planExtractContainerItem: ContainerStorageServiceApi['planExtractContainerItem'] = (snapshot, request) =>
      Effect.gen(function* () {
        const outcome = Container.extractContainerItem(storageOf(snapshot.state), {
          containerId: Container.worldContainerIdAt(request.address),
          containerSlot: request.containerSlot,
          count: request.count,
        })
        if (outcome.result._tag !== 'Extracted') {
          return {
            world: snapshot.world,
            expectedRevision: snapshot.expectedRevision,
            expectedDimensions: [],
            changes: [],
            result: outcome.result,
            postCommitEvents: [],
          } satisfies WorldCommitPlanFragment<Container.ContainerExtractResult>
        }
        const expectedDimensions = yield* expectedDimensionsFor([request.address.dimension], snapshot.expectedDimensions)
        return {
          world: snapshot.world,
          expectedRevision: snapshot.expectedRevision,
          expectedDimensions,
          changes: [{
            ownerId: CONTAINER_STORAGE_REPLICATED_OWNER_ID,
            state: Container.snapshotContainerStorage(outcome.storage),
          }],
          result: outcome.result,
          postCommitEvents: [],
        } satisfies WorldCommitPlanFragment<Container.ContainerExtractResult>
      })

    const planMoveContainerItem: ContainerStorageServiceApi['planMoveContainerItem'] = (snapshot, request) =>
      Effect.gen(function* () {
        const outcome = Container.moveContainerItem(storageOf(snapshot.state), {
          sourceContainerId: Container.worldContainerIdAt(request.sourceAddress),
          sourceSlot: request.sourceSlot,
          destinationContainerId: Container.worldContainerIdAt(request.destinationAddress),
          destinationSlot: request.destinationSlot,
          count: request.count,
        })
        if (outcome.result._tag !== 'Moved') {
          return {
            world: snapshot.world,
            expectedRevision: snapshot.expectedRevision,
            expectedDimensions: [],
            changes: [],
            result: outcome.result,
            postCommitEvents: [],
          } satisfies WorldCommitPlanFragment<Container.ContainerMoveResult>
        }
        const expectedDimensions = yield* expectedDimensionsFor(
          dimensionsOf([request.sourceAddress, request.destinationAddress]),
          snapshot.expectedDimensions,
        )
        return {
          world: snapshot.world,
          expectedRevision: snapshot.expectedRevision,
          expectedDimensions,
          changes: [{
            ownerId: CONTAINER_STORAGE_REPLICATED_OWNER_ID,
            state: Container.snapshotContainerStorage(outcome.storage),
          }],
          result: outcome.result,
          postCommitEvents: [],
        } satisfies WorldCommitPlanFragment<Container.ContainerMoveResult>
      })

    const commitFragment = <Result>(
      fragment: WorldCommitPlanFragment<Result>,
      options: ContainerStorageCommitOptions,
      expectedRevision: WorldRevision,
      blockWriteExpectedRevision: boolean,
      expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>,
    ): Effect.Effect<void, ContainerStorageServiceFailure> => {
      if (fragment.changes.length === 0) return Effect.void
      const merged = mergeWorldCommitPlans([fragment, {
        world: fragment.world,
        expectedRevision: fragment.expectedRevision,
        expectedDimensions,
        changes: options.additionalChanges ?? [],
        ...(options.blockWrite === undefined ? {} : {
          blockEdits: {
            dimension: options.blockWrite.dimension,
            edits: options.blockWrite.edits,
          },
        }),
        result: undefined,
        postCommitEvents: [],
      }])
      if (Result.isFailure(merged)) return Effect.fail(merged.failure)
      return coordinator.commit({
        ...merged.success,
        expectedRevision: options.expectedRevision
          ?? (blockWriteExpectedRevision ? options.blockWrite?.expectedWorldRevision : undefined)
          ?? expectedRevision,
        ...(options.blockWrite === undefined ? {} : { blockWrite: options.blockWrite }),
      }).pipe(Effect.asVoid)
    }

    return {
      snapshot: Effect.map(currentSnapshot(), (snapshot) =>
        Container.snapshotContainerStorage(storageOf(snapshot.state)),
      ),
      containerSnapshot: (id) =>
        Effect.map(currentSnapshot(), (snapshot) => Container.findContainer(storageOf(snapshot.state), id) ?? null),
      containerSnapshotAt: (address) =>
        Effect.map(currentSnapshot(), (snapshot) =>
          Container.findContainer(storageOf(snapshot.state), Container.worldContainerIdAt(address)) ?? null,
        ),
      planCreateContainerAt,
      planTransferContainerItem,
      planExtractContainerItem,
      planMoveContainerItem,
      createContainerAt: (address, kind, options = {}) =>
        Effect.flatMap(currentSnapshot(), (current) =>
          Effect.flatMap(planSnapshot(current, [address], options.blockWrite), (snapshot) =>
            Effect.flatMap(planCreateContainerAt(snapshot, address, kind), (fragment) =>
              Effect.as(
                commitFragment(fragment, options, current.revision, true, snapshot.expectedDimensions),
                fragment.result,
              ),
            ),
          ),
        ),
      transferContainerItem: (request, options = {}) =>
        Effect.flatMap(currentSnapshot(), (containerSnapshot): Effect.Effect<
          Container.ContainerTransferResult,
          ContainerStorageServiceFailure
        > => {
          return Effect.flatMap(
            coordinator.snapshot(request.playerOwnerId, PlayerStorageSnapshotSchema),
            (playerSnapshot): Effect.Effect<
              Container.ContainerTransferResult,
              ContainerStorageServiceFailure
            > => {
              return Effect.flatMap(planSnapshot(containerSnapshot, [request.address], options.blockWrite), (snapshot) =>
                Effect.flatMap(
                    planTransferContainerItem(
                      snapshot,
                      planPlayerSnapshot(playerSnapshot, snapshot.expectedDimensions),
                      request,
                    ),
                    (fragment) => Effect.as(
                      commitFragment(fragment, options, containerSnapshot.revision, false, snapshot.expectedDimensions),
                      fragment.result,
                    ),
                ),
              )
            },
          )
        }),
      extractContainerItem: (request, options = {}) =>
        Effect.flatMap(currentSnapshot(), (current) =>
          Effect.flatMap(planSnapshot(current, [request.address], options.blockWrite), (snapshot) =>
            Effect.flatMap(planExtractContainerItem(snapshot, request), (fragment) =>
              Effect.as(commitFragment(fragment, options, current.revision, true, snapshot.expectedDimensions), fragment.result),
            ),
          ),
        ),
      moveContainerItem: (request, options = {}) =>
        Effect.flatMap(currentSnapshot(), (current) =>
          Effect.flatMap(
            planSnapshot(current, [request.sourceAddress, request.destinationAddress], options.blockWrite),
            (snapshot) => Effect.flatMap(planMoveContainerItem(snapshot, request), (fragment) =>
              Effect.as(commitFragment(fragment, options, current.revision, true, snapshot.expectedDimensions), fragment.result),
            ),
          ),
        ),
    }
  })

export const ContainerStorageServiceLayer: Layer.Layer<
  ContainerStorageService,
  never,
  WorldCommitCoordinator
> = Layer.effect(ContainerStorageService, makeContainerStorageService())
