import { Context, Effect, Layer, Schema } from 'effect'
import type { BlockAddress, Dimension, WorldRevision } from '@nerima-games/mc-kernel'
import * as Container from '../domain/container-storage.js'
import * as PlayerStorage from '../domain/player-storage.js'
import {
  makeReplicatedOwnerId,
  type ReplicatedOwnerId,
} from './replicated-state.js'
import {
  WorldCommitCoordinator,
  WorldRevisionConflict,
  type ReplicatedOwnerCandidate,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'

export const CONTAINER_STORAGE_REPLICATED_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('container-storage')

export const ContainerStorageSnapshotSchema: Schema.Codec<
  Container.ContainerStorageSnapshot,
  Container.ContainerStorageSnapshot
> = Schema.declare<Container.ContainerStorageSnapshot>(
  (value: unknown): value is Container.ContainerStorageSnapshot =>
  Container.validateContainerStorageSnapshot(value)._tag === 'Valid',
)

export const PlayerStorageSnapshotSchema: Schema.Codec<
  PlayerStorage.PlayerStorage,
  PlayerStorage.PlayerStorage
> = Schema.declare<PlayerStorage.PlayerStorage>(
  (value: unknown): value is PlayerStorage.PlayerStorage =>
  PlayerStorage.validatePlayerStorageSnapshot(value)._tag === 'Valid',
)

const ContainerKindSchema = Schema.Literals([
  'chest',
  'shulker_box',
  'dispenser',
  'dropper',
  'hopper',
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
        const expectedDimensions = yield* Effect.forEach(
          dimensionsOf(addresses),
          (dimension) => Effect.map(coordinator.dimensionRevision(dimension), (expectedRevision) => ({
            dimension,
            expectedRevision,
          })),
        )
        const changes: [ReplicatedOwnerCandidate, ...ReadonlyArray<ReplicatedOwnerCandidate>] = [
          { ownerId: CONTAINER_STORAGE_REPLICATED_OWNER_ID, state },
          ...additionalChanges,
        ]
        yield* coordinator.commit({
          expectedRevision: options.expectedRevision ?? currentRevision,
          expectedDimensions,
          changes,
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
