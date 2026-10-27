import {
  BlockAddressSchema,
  DimensionRevisionSchema,
  ITEM_TYPES,
  WorldRevisionSchema,
  WorldWriteBatchSchema,
  type BlockAddress,
  type Dimension,
  type DimensionRevision,
  type WorldId,
  type WorldRevision,
  type WorldWriteBatch,
} from '@nerima-games/mc-kernel'
import { Brand, Context, Effect, Layer, Schema } from 'effect'
import * as Container from '../domain/container-storage.js'
import { SchemaErrorSchema } from '../schema-errors.js'
import {
  ContainerMoveResultSchema,
  ContainerStorageService,
  ContainerTransferResultSchema,
  type ContainerStorageServiceFailure,
} from './container-service.js'
import {
  makeReplicatedOwnerId,
  ReplicatedOwnerIdSchema,
  type ReplicatedOwnerId,
} from './replicated-state.js'
import {
  DimensionRevisionConflict,
  WorldCommitCoordinator,
  WorldCommitCoordinatorErrorSchema,
  WorldRevisionConflict,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'

export type HopperCooldownTicks = number & Brand.Brand<'HopperCooldownTicks'>

export const HopperCooldownTicksSchema: Schema.Codec<HopperCooldownTicks, number> =
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))
    .pipe(Schema.brand('HopperCooldownTicks'))

const NonNegativeSafeIntegerSchema: Schema.Codec<number, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
)
const PositiveSafeIntegerSchema: Schema.Codec<number, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
)

export const HOPPER_TRANSFER_COOLDOWN_TICKS: HopperCooldownTicks =
  Schema.decodeUnknownSync(HopperCooldownTicksSchema)(8)
export const HOPPER_REPLICATED_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('hopper-runtime')

export type HopperRuntimeState = Readonly<{
  address: BlockAddress
  cooldownTicks: HopperCooldownTicks
}>

const HopperRuntimeStateSchema: Schema.Codec<HopperRuntimeState, unknown> = Schema.Struct({
  address: BlockAddressSchema,
  cooldownTicks: HopperCooldownTicksSchema,
})

export type HopperServiceSnapshot = Readonly<{ hoppers: ReadonlyArray<HopperRuntimeState> }>

export const HopperServiceSnapshotSchema: Schema.Codec<HopperServiceSnapshot, unknown> = Schema.Struct({
  hoppers: Schema.Array(HopperRuntimeStateSchema),
})

export const INITIAL_HOPPER_SERVICE_SNAPSHOT: HopperServiceSnapshot = { hoppers: [] }

export const hopperOwnerRegistration = (
  initialState: HopperServiceSnapshot = INITIAL_HOPPER_SERVICE_SNAPSHOT,
): ReplicatedOwnerRegistration<typeof HopperServiceSnapshotSchema> => ({
  ownerId: HOPPER_REPLICATED_OWNER_ID,
  schema: HopperServiceSnapshotSchema,
  initialState,
})

export type HopperEndpoint =
  | Readonly<{ _tag: 'Container'; address: BlockAddress; slot: number }>
  | Readonly<{ _tag: 'Player'; ownerId: ReplicatedOwnerId; slot: number }>

const HopperEndpointSchema: Schema.Codec<HopperEndpoint, unknown> = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Container'),
    address: BlockAddressSchema,
    slot: NonNegativeSafeIntegerSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal('Player'),
    ownerId: ReplicatedOwnerIdSchema,
    slot: NonNegativeSafeIntegerSchema,
  }),
])

export type HopperTransferRequest = Readonly<{
  hopperAddress: BlockAddress
  source: HopperEndpoint
  destination: HopperEndpoint
  blockWrite: WorldWriteBatch
}>

const HopperTransferRequestSchema: Schema.Codec<HopperTransferRequest, unknown> = Schema.Struct({
  hopperAddress: BlockAddressSchema,
  source: HopperEndpointSchema,
  destination: HopperEndpointSchema,
  blockWrite: WorldWriteBatchSchema,
})

type HopperDomainTransfer =
  | Readonly<{ _tag: 'ContainerMove'; outcome: Container.ContainerMoveResult }>
  | Readonly<{ _tag: 'PlayerTransfer'; outcome: Container.ContainerTransferResult }>

const HopperDomainTransferSchema: Schema.Codec<HopperDomainTransfer, unknown> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('ContainerMove'), outcome: ContainerMoveResultSchema }),
  Schema.Struct({ _tag: Schema.Literal('PlayerTransfer'), outcome: ContainerTransferResultSchema }),
])

export type HopperTransferOutcome =
  | Readonly<{
      _tag: 'Committed'
      transfer:
        | Extract<Container.ContainerMoveResult, { readonly _tag: 'Moved' }>
        | Extract<Container.ContainerTransferResult, { readonly _tag: 'Transferred' }>
      hopper: HopperRuntimeState
    }>
  | Readonly<{ _tag: 'CoolingDown'; ticks: HopperCooldownTicks }>
  | Readonly<{
      _tag: 'InvalidRequest'
      reason: 'player-to-player' | 'dimension-mismatch' | 'missing-hopper-block-edit'
    }>
  | Readonly<{ _tag: 'TransferRejected'; transfer: HopperDomainTransfer }>

export const HopperTransferOutcomeSchema: Schema.Codec<HopperTransferOutcome, unknown> = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Committed'),
    transfer: Schema.Union([
      Schema.Struct({
        _tag: Schema.Literal('Moved'),
        item: Schema.Literals(ITEM_TYPES),
    count: PositiveSafeIntegerSchema,
      }),
      Schema.Struct({
        _tag: Schema.Literal('Transferred'),
        item: Schema.Literals(ITEM_TYPES),
    count: PositiveSafeIntegerSchema,
        direction: Schema.Literals(['PlayerToContainer', 'ContainerToPlayer']),
      }),
    ]),
    hopper: HopperRuntimeStateSchema,
  }),
  Schema.Struct({ _tag: Schema.Literal('CoolingDown'), ticks: HopperCooldownTicksSchema }),
  Schema.Struct({ _tag: Schema.Literal('InvalidRequest'), reason: Schema.Literals([
    'player-to-player',
    'dimension-mismatch',
    'missing-hopper-block-edit',
  ]) }),
  Schema.Struct({
    _tag: Schema.Literal('TransferRejected'),
    transfer: HopperDomainTransferSchema,
  }),
])

export type HopperCooldownOutcome =
  | Readonly<{ _tag: 'Advanced'; hopper: HopperRuntimeState }>
  | Readonly<{ _tag: 'NoChange' }>
  | Readonly<{ _tag: 'UnknownHopper' }>

export const HopperCooldownOutcomeSchema: Schema.Codec<HopperCooldownOutcome, unknown> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Advanced'), hopper: HopperRuntimeStateSchema }),
  Schema.Struct({ _tag: Schema.Literal('NoChange') }),
  Schema.Struct({ _tag: Schema.Literal('UnknownHopper') }),
])

export type HopperCooldownRequest = Readonly<{
  address: BlockAddress
  ticks: number
  expectedRevision: WorldRevision
  expectedDimensionRevision: DimensionRevision
}>

const HopperCooldownRequestSchema: Schema.Codec<HopperCooldownRequest, unknown> = Schema.Struct({
  address: BlockAddressSchema,
  ticks: PositiveSafeIntegerSchema,
  expectedRevision: WorldRevisionSchema,
  expectedDimensionRevision: DimensionRevisionSchema,
})

export type HopperServiceError =
  | Schema.SchemaError
  | ContainerStorageServiceFailure
  | WorldCommitCoordinatorError

export const HopperServiceErrorSchema: Schema.Codec<HopperServiceError, unknown> = Schema.Union([
  SchemaErrorSchema,
  WorldCommitCoordinatorErrorSchema,
])

export type HopperServiceApi = Readonly<{
  snapshot: Effect.Effect<
    Readonly<{ world: WorldId; revision: WorldRevision; state: HopperServiceSnapshot }>,
    Schema.SchemaError | WorldCommitCoordinatorError
  >
  transfer: (request: HopperTransferRequest) => Effect.Effect<HopperTransferOutcome, HopperServiceError>
  advanceCooldown: (request: HopperCooldownRequest) => Effect.Effect<HopperCooldownOutcome, HopperServiceError>
}>

const HopperServiceBase: Context.ServiceClass<
  HopperService,
  '@nerima-games/mc-sim/HopperService',
  HopperServiceApi
> = Context.Service<HopperService, HopperServiceApi>()('@nerima-games/mc-sim/HopperService')

export class HopperService extends HopperServiceBase {}

const samePosition = (left: BlockAddress, right: BlockAddress): boolean =>
  left.dimension === right.dimension &&
  left.position.x === right.position.x &&
  left.position.y === right.position.y &&
  left.position.z === right.position.z

const upsertHopper = (
  snapshot: HopperServiceSnapshot,
  hopper: HopperRuntimeState,
): HopperServiceSnapshot => {
  const existing = snapshot.hoppers.findIndex(({ address }) => samePosition(address, hopper.address))
  if (existing < 0) return { hoppers: [...snapshot.hoppers, hopper] }
  return { hoppers: snapshot.hoppers.map((current, index) => index === existing ? hopper : current) }
}

const recordAt = (snapshot: HopperServiceSnapshot, address: BlockAddress): HopperRuntimeState | undefined =>
  snapshot.hoppers.find(({ address: current }) => samePosition(current, address))

const endpointDimension = (endpoint: HopperEndpoint): Dimension | undefined =>
  endpoint._tag === 'Container' ? endpoint.address.dimension : undefined

export const makeHopperService = (): Effect.Effect<
  HopperServiceApi,
  never,
  WorldCommitCoordinator | ContainerStorageService
> => Effect.gen(function* () {
  const coordinator = yield* WorldCommitCoordinator
  const storage = yield* ContainerStorageService

  const snapshot = () => coordinator.snapshot(HOPPER_REPLICATED_OWNER_ID, HopperServiceSnapshotSchema)

  const transfer: HopperServiceApi['transfer'] = (request) =>
    Effect.flatMap(Schema.decodeUnknownEffect(HopperTransferRequestSchema)(request), (decoded) =>
      Effect.gen(function* () {
        const { hopperAddress, source, destination, blockWrite } = decoded
        if (source._tag === 'Player' && destination._tag === 'Player') {
          return { _tag: 'InvalidRequest', reason: 'player-to-player' } as const
        }
        const dimensions = [
          hopperAddress.dimension,
          endpointDimension(source),
          endpointDimension(destination),
          blockWrite.dimension,
        ].filter((dimension): dimension is Dimension => dimension !== undefined)
        if (dimensions.some((dimension) => dimension !== hopperAddress.dimension)) {
          return { _tag: 'InvalidRequest', reason: 'dimension-mismatch' } as const
        }
        if (!blockWrite.edits.some(({ position: edited }) =>
          edited.x === hopperAddress.position.x &&
          edited.y === hopperAddress.position.y &&
          edited.z === hopperAddress.position.z)) {
          return { _tag: 'InvalidRequest', reason: 'missing-hopper-block-edit' } as const
        }

        const current = yield* snapshot()
        const existing = recordAt(current.state, hopperAddress)
        if (existing !== undefined && existing.cooldownTicks > 0) {
          return { _tag: 'CoolingDown', ticks: existing.cooldownTicks } as const
        }

        const nextHopper: HopperRuntimeState = {
          address: hopperAddress,
          cooldownTicks: HOPPER_TRANSFER_COOLDOWN_TICKS,
        }
        const additionalChanges = [{
          ownerId: HOPPER_REPLICATED_OWNER_ID,
          state: upsertHopper(current.state, nextHopper),
        }]
        const options = {
          expectedRevision: blockWrite.expectedWorldRevision,
          blockWrite,
          additionalChanges,
        }
        let outcome: HopperDomainTransfer
        if (source._tag === 'Container' && destination._tag === 'Container') {
          outcome = {
            _tag: 'ContainerMove',
            outcome: yield* storage.moveContainerItem({
              sourceAddress: source.address,
              sourceSlot: source.slot,
              destinationAddress: destination.address,
              destinationSlot: destination.slot,
              count: 1,
            }, options),
          }
        } else if (source._tag === 'Player' && destination._tag === 'Container') {
          outcome = {
            _tag: 'PlayerTransfer',
            outcome: yield* storage.transferContainerItem({
              playerOwnerId: source.ownerId,
              address: destination.address,
              direction: 'PlayerToContainer',
              playerSlot: source.slot,
              containerSlot: destination.slot,
              count: 1,
            }, options),
          }
        } else if (source._tag === 'Container' && destination._tag === 'Player') {
          outcome = {
            _tag: 'PlayerTransfer',
            outcome: yield* storage.transferContainerItem({
              playerOwnerId: destination.ownerId,
              address: source.address,
              direction: 'ContainerToPlayer',
              playerSlot: destination.slot,
              containerSlot: source.slot,
              count: 1,
            }, options),
          }
        } else {
          return { _tag: 'InvalidRequest', reason: 'player-to-player' } as const
        }
        if (outcome._tag === 'ContainerMove') {
          if (outcome.outcome._tag !== 'Moved') return { _tag: 'TransferRejected', transfer: outcome } as const
          return { _tag: 'Committed', transfer: outcome.outcome, hopper: nextHopper } as const
        }
        if (outcome.outcome._tag !== 'Transferred') return { _tag: 'TransferRejected', transfer: outcome } as const
        return { _tag: 'Committed', transfer: outcome.outcome, hopper: nextHopper } as const
      }),
    )

  const advanceCooldown: HopperServiceApi['advanceCooldown'] = (request) =>
    Effect.flatMap(Schema.decodeUnknownEffect(HopperCooldownRequestSchema)(request), (decoded) =>
      Effect.gen(function* () {
        const current = yield* snapshot()
        const existing = recordAt(current.state, decoded.address)
        if (existing === undefined) return { _tag: 'UnknownHopper' } as const
        if (existing.cooldownTicks === 0) return { _tag: 'NoChange' } as const
        const actualDimensionRevision = yield* coordinator.dimensionRevision(decoded.address.dimension)
        if (current.revision !== decoded.expectedRevision) {
          return yield* Effect.fail(new WorldRevisionConflict({
            expected: decoded.expectedRevision,
            actual: current.revision,
          }))
        }
        if (actualDimensionRevision !== decoded.expectedDimensionRevision) {
          return yield* Effect.fail(new DimensionRevisionConflict({
            dimension: decoded.address.dimension,
            expected: decoded.expectedDimensionRevision,
            actual: actualDimensionRevision,
          }))
        }
        const hopper = yield* Schema.decodeUnknownEffect(HopperRuntimeStateSchema)({
          ...existing,
          cooldownTicks: Math.max(0, existing.cooldownTicks - decoded.ticks),
        })
        yield* coordinator.commit({
          expectedRevision: decoded.expectedRevision,
          expectedDimensions: [{
            dimension: decoded.address.dimension,
            expectedRevision: decoded.expectedDimensionRevision,
          }],
          changes: [{ ownerId: HOPPER_REPLICATED_OWNER_ID, state: upsertHopper(current.state, hopper) }],
        })
        return { _tag: 'Advanced', hopper } as const
      }),
    )

  return { snapshot: snapshot(), transfer, advanceCooldown }
})

export const HopperServiceLayer: Layer.Layer<
  HopperService,
  never,
  WorldCommitCoordinator | ContainerStorageService
> = Layer.effect(HopperService, makeHopperService())
