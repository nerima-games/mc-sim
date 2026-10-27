import { Context, Effect, Layer, Schema } from 'effect'
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
  makeReplicatedOwnerId,
  type ReplicatedOwnerId,
} from './replicated-state.js'
import {
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

export type ContainerStorageServiceFailure = Schema.SchemaError | WorldCommitCoordinatorError

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

export const makeContainerStorageService = (): Effect.Effect<
  ContainerStorageServiceApi,
  never,
  WorldCommitCoordinator
> =>
  Effect.gen(function* () {
    const coordinator = yield* WorldCommitCoordinator

    const currentSnapshot = () =>
      coordinator.snapshot(CONTAINER_STORAGE_REPLICATED_OWNER_ID, ContainerStorageSnapshotSchema)

    const commitStorage = (
      currentRevision: WorldRevision,
      state: Container.ContainerStorageSnapshot,
      addresses: ReadonlyArray<BlockAddress>,
      options: ContainerStorageCommitOptions,
      additionalChanges: ReadonlyArray<ReplicatedOwnerCandidate> = [],
    ): Effect.Effect<void, ContainerStorageServiceFailure> =>
      Effect.gen(function* () {
        const blockWriteDimension = options.blockWrite?.dimension
        const commitDimensions = [...dimensionsOf(addresses)]
        if (blockWriteDimension !== undefined && !commitDimensions.includes(blockWriteDimension)) {
          commitDimensions.push(blockWriteDimension)
        }
        const expectedDimensions = yield* Effect.forEach(
          commitDimensions,
          (dimension) => {
            if (dimension === blockWriteDimension && options.blockWrite !== undefined) {
              return Effect.succeed({ dimension, expectedRevision: options.blockWrite.expectedDimensionRevision })
            }
            return Effect.map(coordinator.dimensionRevision(dimension), (expectedRevision) => ({
              dimension,
              expectedRevision,
            }))
          },
        )
        const changes: [ReplicatedOwnerCandidate, ...ReadonlyArray<ReplicatedOwnerCandidate>] = [
          { ownerId: CONTAINER_STORAGE_REPLICATED_OWNER_ID, state },
          ...(options.additionalChanges ?? []),
          ...additionalChanges,
        ]
        yield* coordinator.commit({
          expectedRevision: options.expectedRevision ?? options.blockWrite?.expectedWorldRevision ?? currentRevision,
          expectedDimensions,
          changes,
          ...(options.blockWrite === undefined ? {} : { blockWrite: options.blockWrite }),
        })
      })

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
      createContainerAt: (address, kind, options = {}) =>
        Effect.flatMap(decodeContainerKind(kind), (validKind) =>
          Effect.flatMap(currentSnapshot(), (current): Effect.Effect<
            Container.CreateContainerResult,
            ContainerStorageServiceFailure
          > => {
            const outcome = Container.createContainer(
              storageOf(current.state),
              Container.worldContainerIdAt(address),
              validKind,
            )
            if (outcome.result._tag !== 'Created') return Effect.succeed(outcome.result)
            const state = Container.snapshotContainerStorage(outcome.storage)
            return Effect.as(
              commitStorage(current.revision, state, [address], options),
              outcome.result,
            )
          }),
        ),
      transferContainerItem: (request, options = {}) =>
        Effect.flatMap(currentSnapshot(), (containerSnapshot): Effect.Effect<
          Container.ContainerTransferResult,
          ContainerStorageServiceFailure
        > => {
          const id = Container.worldContainerIdAt(request.address)
          return Effect.flatMap(
            coordinator.snapshot(request.playerOwnerId, PlayerStorageSnapshotSchema),
            (playerSnapshot): Effect.Effect<
              Container.ContainerTransferResult,
              ContainerStorageServiceFailure
            > => {
              if (playerSnapshot.revision !== containerSnapshot.revision) {
                return Effect.fail(new WorldRevisionConflict({
                  expected: containerSnapshot.revision,
                  actual: playerSnapshot.revision,
                }))
              }
              const outcome = Container.transferContainerItem(
                playerSnapshot.state,
                storageOf(containerSnapshot.state),
                {
                  direction: request.direction,
                  containerId: id,
                  playerSlot: request.playerSlot,
                  containerSlot: request.containerSlot,
                  count: request.count,
                },
              )
              if (outcome.result._tag !== 'Transferred') return Effect.succeed(outcome.result)
              const state = Container.snapshotContainerStorage(outcome.containerStorage)
              return Effect.as(
                commitStorage(
                  options.expectedRevision ?? containerSnapshot.revision,
                  state,
                  [request.address],
                  options,
                  [{ ownerId: request.playerOwnerId, state: outcome.playerStorage }],
                ),
                outcome.result,
              )
            },
          )
        }),
      extractContainerItem: (request, options = {}) =>
        Effect.flatMap(currentSnapshot(), (current): Effect.Effect<
          Container.ContainerExtractResult,
          ContainerStorageServiceFailure
        > => {
          const id = Container.worldContainerIdAt(request.address)
          const outcome = Container.extractContainerItem(storageOf(current.state), {
            containerId: id,
            containerSlot: request.containerSlot,
            count: request.count,
          })
          if (outcome.result._tag !== 'Extracted') return Effect.succeed(outcome.result)
          const state = Container.snapshotContainerStorage(outcome.storage)
          return Effect.as(
            commitStorage(current.revision, state, [request.address], options),
            outcome.result,
          )
        }),
      moveContainerItem: (request, options = {}) =>
        Effect.flatMap(currentSnapshot(), (current): Effect.Effect<
          Container.ContainerMoveResult,
          ContainerStorageServiceFailure
        > => {
          const sourceId = Container.worldContainerIdAt(request.sourceAddress)
          const destinationId = Container.worldContainerIdAt(request.destinationAddress)
          const outcome = Container.moveContainerItem(storageOf(current.state), {
            sourceContainerId: sourceId,
            sourceSlot: request.sourceSlot,
            destinationContainerId: destinationId,
            destinationSlot: request.destinationSlot,
            count: request.count,
          })
          if (outcome.result._tag !== 'Moved') return Effect.succeed(outcome.result)
          const state = Container.snapshotContainerStorage(outcome.storage)
          return Effect.as(
            commitStorage(
              current.revision,
              state,
              [request.sourceAddress, request.destinationAddress],
              options,
            ),
            outcome.result,
          )
        }),
    }
  })

export const ContainerStorageServiceLayer: Layer.Layer<
  ContainerStorageService,
  never,
  WorldCommitCoordinator
> = Layer.effect(ContainerStorageService, makeContainerStorageService())
