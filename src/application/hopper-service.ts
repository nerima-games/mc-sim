import {
  BlockAddressSchema,
  BlockIdSchema,
  DIMENSIONS,
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
  CONTAINER_STORAGE_REPLICATED_OWNER_ID,
  ContainerMoveResultSchema,
  ContainerStorageSnapshotSchema,
  ContainerStorageService,
  ContainerTransferResultSchema,
  PlayerStorageSnapshotSchema,
  type ContainerStoragePlanSnapshot,
  type ContainerStorageServiceFailure,
  type PlayerStoragePlanSnapshot,
} from './container-service.js'
import {
  makeReplicatedOwnerId,
  ReplicatedOwnerIdSchema,
  WorldBlockPositionSchema,
  type ReplicatedOwnerId,
} from './replicated-state.js'
import {
  DimensionRevisionConflict,
  WorldCommitCoordinator,
  WorldCommitCoordinatorErrorSchema,
  WorldRevisionConflict,
  type DimensionRevisionExpectation,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'
import {
  WorldCommitPlanConflictSchema,
  mergeWorldCommitPlans,
  worldCommitPlanSnapshotSchema,
  type WorldCommitPlanConflict,
  type WorldCommitPlanFragment,
  type WorldCommitPlanSnapshot,
} from './world-commit-plan.js'

export type HopperCooldownTicks = number & Brand.Brand<'HopperCooldownTicks'>
type HopperRemainingCooldownTicks = number & Brand.Brand<'HopperRemainingCooldownTicks'>
export type HopperElapsedTicks = number & Brand.Brand<'HopperElapsedTicks'>

export const HopperCooldownTicksSchema: Schema.Codec<HopperCooldownTicks, number> =
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))
    .pipe(Schema.brand('HopperCooldownTicks'))
export const HopperElapsedTicksSchema: Schema.Codec<HopperElapsedTicks, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
).pipe(Schema.brand('HopperElapsedTicks'))

const NonNegativeSafeIntegerSchema: Schema.Codec<number, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
)
const HopperRemainingCooldownTicksSchema: Schema.Codec<HopperRemainingCooldownTicks, number> =
  NonNegativeSafeIntegerSchema.pipe(Schema.brand('HopperRemainingCooldownTicks'))
const PositiveSafeIntegerSchema: Schema.Codec<number, number> = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
)

export const HOPPER_TRANSFER_COOLDOWN_TICKS: HopperRemainingCooldownTicks =
  Schema.decodeUnknownSync(HopperRemainingCooldownTicksSchema)(8)
export const HOPPER_REPLICATED_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('hopper-runtime')

export type HopperRuntimeState = Readonly<{
  address: BlockAddress
  cooldownTicks: HopperRemainingCooldownTicks
}>

const HopperRuntimeStateSchema: Schema.Codec<HopperRuntimeState, unknown> = Schema.Struct({
  address: BlockAddressSchema,
  cooldownTicks: HopperRemainingCooldownTicksSchema,
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

export type HopperTransferTickIntent = Readonly<{
  hopperAddress: BlockAddress
  source: HopperEndpoint
  destination: HopperEndpoint
  blockEdits: Readonly<{ dimension: Dimension; edits: WorldWriteBatch['edits'] }>
}>

export type HopperTransferTickPlayerSnapshot =
  | Readonly<{ _tag: 'None' }>
  | Readonly<{ _tag: 'Some'; ownerId: ReplicatedOwnerId; snapshot: PlayerStoragePlanSnapshot }>

export type HopperTransferTickPlanState = Readonly<{
  hoppers: HopperServiceSnapshot
  containers: ContainerStoragePlanSnapshot
  player: HopperTransferTickPlayerSnapshot
  intent: HopperTransferTickIntent
}>

const HopperTransferTickIntentSchema: Schema.Codec<HopperTransferTickIntent, unknown> = Schema.Struct({
  hopperAddress: BlockAddressSchema,
  source: HopperEndpointSchema,
  destination: HopperEndpointSchema,
  blockEdits: Schema.Struct({
    dimension: Schema.Literals(DIMENSIONS),
    edits: Schema.Array(Schema.Struct({ position: WorldBlockPositionSchema, block: BlockIdSchema })),
  }),
})

const HopperTransferTickPlayerSnapshotSchema: Schema.Codec<HopperTransferTickPlayerSnapshot, unknown> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('None') }),
  Schema.Struct({
    _tag: Schema.Literal('Some'),
    ownerId: ReplicatedOwnerIdSchema,
    snapshot: worldCommitPlanSnapshotSchema(PlayerStorageSnapshotSchema),
  }),
])

const HopperTransferTickPlanStateSchema: Schema.Codec<HopperTransferTickPlanState, unknown> = Schema.Struct({
  hoppers: HopperServiceSnapshotSchema,
  containers: worldCommitPlanSnapshotSchema(ContainerStorageSnapshotSchema),
  player: HopperTransferTickPlayerSnapshotSchema,
  intent: HopperTransferTickIntentSchema,
})

export const HopperTransferTickSnapshotSchema: Schema.Codec<
  WorldCommitPlanSnapshot<HopperTransferTickPlanState>,
  unknown
> = worldCommitPlanSnapshotSchema(HopperTransferTickPlanStateSchema)

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
  | Readonly<{ _tag: 'Disabled' }>
  | Readonly<{
      _tag: 'InvalidRequest'
      reason: 'player-to-player' | 'dimension-mismatch' | 'missing-hopper-block-edit' | 'missing-player-snapshot'
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
  Schema.Struct({ _tag: Schema.Literal('Disabled') }),
  Schema.Struct({ _tag: Schema.Literal('InvalidRequest'), reason: Schema.Literals([
    'player-to-player',
    'dimension-mismatch',
    'missing-hopper-block-edit',
    'missing-player-snapshot',
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

export type HopperCooldownPlanRequest = Readonly<{ address: BlockAddress; ticks: HopperCooldownTicks }>
export const HopperCooldownPlanRequestSchema: Schema.Codec<HopperCooldownPlanRequest, unknown> = Schema.Struct({
  address: BlockAddressSchema,
  ticks: HopperCooldownTicksSchema,
})

const HopperCooldownRequestSchema: Schema.Codec<HopperCooldownRequest, unknown> = Schema.Struct({
  address: BlockAddressSchema,
  ticks: PositiveSafeIntegerSchema,
  expectedRevision: WorldRevisionSchema,
  expectedDimensionRevision: DimensionRevisionSchema,
})

export type HopperServiceError =
  | Schema.SchemaError
  | ContainerStorageServiceFailure
  | WorldCommitPlanConflict
  | WorldCommitCoordinatorError

export const HopperServiceErrorSchema: Schema.Codec<HopperServiceError, unknown> = Schema.Union([
  SchemaErrorSchema,
  WorldCommitPlanConflictSchema,
  WorldCommitCoordinatorErrorSchema,
])

export type HopperServiceApi = Readonly<{
  snapshot: Effect.Effect<
    Readonly<{ world: WorldId; revision: WorldRevision; state: HopperServiceSnapshot }>,
    Schema.SchemaError | WorldCommitCoordinatorError
  >
  planTransferTick: (
    snapshot: WorldCommitPlanSnapshot<HopperTransferTickPlanState>,
    elapsedTicks: HopperElapsedTicks,
    powered: boolean,
  ) => Effect.Effect<WorldCommitPlanFragment<HopperTransferOutcome>, HopperServiceError>
  planAdvanceCooldown: (
    snapshot: WorldCommitPlanSnapshot<HopperServiceSnapshot>,
    request: HopperCooldownPlanRequest,
  ) => Effect.Effect<WorldCommitPlanFragment<HopperCooldownOutcome>, HopperServiceError>
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

  const expectedDimensionsFor = (
    expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>,
    dimensions: ReadonlyArray<Dimension>,
  ): Effect.Effect<ReadonlyArray<DimensionRevisionExpectation>, WorldCommitPlanConflict> =>
    Effect.forEach([...new Set(dimensions)], (dimension) => {
      const expectation = expectedDimensions.find((candidate) => candidate.dimension === dimension)
      return expectation === undefined
        ? Effect.fail({ _tag: 'WorldCommitPlanDimensionRevisionMissing', dimension } as const)
        : Effect.succeed(expectation)
    })

  const assertMatchingPlanBase = <Left, Right>(
    base: WorldCommitPlanSnapshot<Left>,
    other: WorldCommitPlanSnapshot<Right>,
  ): Effect.Effect<void, WorldCommitPlanConflict> => {
    if (base.world !== other.world) {
      return Effect.fail({
        _tag: 'WorldCommitPlanWorldConflict',
        expected: base.world,
        actual: other.world,
      })
    }
    if (base.expectedRevision !== other.expectedRevision) {
      return Effect.fail({
        _tag: 'WorldCommitPlanRevisionConflict',
        expected: base.expectedRevision,
        actual: other.expectedRevision,
      })
    }
    return Effect.void
  }

  const assertMatchingDimensions = (
    base: WorldCommitPlanSnapshot<unknown>,
    other: WorldCommitPlanSnapshot<unknown>,
    dimensions: ReadonlyArray<Dimension>,
  ): Effect.Effect<void, WorldCommitPlanConflict> => Effect.gen(function* () {
    for (const dimension of new Set(dimensions)) {
      const baseExpected = base.expectedDimensions.find((candidate) => candidate.dimension === dimension)
      const otherExpected = other.expectedDimensions.find((candidate) => candidate.dimension === dimension)
      if (baseExpected === undefined || otherExpected === undefined) {
        return yield* Effect.fail({ _tag: 'WorldCommitPlanDimensionRevisionMissing', dimension } as const)
      }
      if (baseExpected.expectedRevision !== otherExpected.expectedRevision) {
        return yield* Effect.fail({
          _tag: 'WorldCommitPlanDimensionRevisionConflict',
          dimension,
          expected: baseExpected.expectedRevision,
          actual: otherExpected.expectedRevision,
        } as const)
      }
    }
    return undefined
  })

  const emptyFragment = <ResultValue>(
    plan: WorldCommitPlanSnapshot<unknown>,
    result: ResultValue,
  ): WorldCommitPlanFragment<ResultValue> => ({
    world: plan.world,
    expectedRevision: plan.expectedRevision,
    expectedDimensions: [],
    changes: [],
    result,
    postCommitEvents: [],
  })

  const invalidTransfer = (
    intent: HopperTransferTickIntent,
  ): HopperTransferOutcome | undefined => {
    const { hopperAddress, source, destination, blockEdits } = intent
    const dimensions = [
      hopperAddress.dimension,
      endpointDimension(source),
      endpointDimension(destination),
      blockEdits.dimension,
    ].filter((dimension): dimension is Dimension => dimension !== undefined)
    if (dimensions.some((dimension) => dimension !== hopperAddress.dimension)) {
      return { _tag: 'InvalidRequest', reason: 'dimension-mismatch' }
    }
    if (!blockEdits.edits.some(({ position }) =>
      position.x === hopperAddress.position.x &&
      position.y === hopperAddress.position.y &&
      position.z === hopperAddress.position.z)) {
      return { _tag: 'InvalidRequest', reason: 'missing-hopper-block-edit' }
    }
    return undefined
  }

  const planAdvanceCooldown: HopperServiceApi['planAdvanceCooldown'] = (planSnapshot, request) =>
    Effect.flatMap(Schema.decodeUnknownEffect(HopperCooldownPlanRequestSchema)(request), (decoded) => Effect.gen(function* () {
      const existing = recordAt(planSnapshot.state, decoded.address)
      if (existing === undefined) return emptyFragment(planSnapshot, { _tag: 'UnknownHopper' })
      if (existing.cooldownTicks === 0) return emptyFragment(planSnapshot, { _tag: 'NoChange' })
      const expectedDimensions = yield* expectedDimensionsFor(planSnapshot.expectedDimensions, [decoded.address.dimension])
      const hopper = yield* Schema.decodeUnknownEffect(HopperRuntimeStateSchema)({
        ...existing,
        cooldownTicks: Math.max(0, existing.cooldownTicks - decoded.ticks),
      })
      return {
        world: planSnapshot.world,
        expectedRevision: planSnapshot.expectedRevision,
        expectedDimensions,
        changes: [{ ownerId: HOPPER_REPLICATED_OWNER_ID, state: upsertHopper(planSnapshot.state, hopper) }],
        result: { _tag: 'Advanced', hopper },
        postCommitEvents: [],
      } satisfies WorldCommitPlanFragment<HopperCooldownOutcome>
    }))

type HopperTransferPlan =
  | Readonly<{ _tag: 'ContainerMove'; fragment: WorldCommitPlanFragment<Container.ContainerMoveResult> }>
  | Readonly<{ _tag: 'PlayerTransfer'; fragment: WorldCommitPlanFragment<Container.ContainerTransferResult> }>

type HopperPlayerEndpoint = Extract<HopperEndpoint, { readonly _tag: 'Player' }>
type HopperContainerEndpoint = Extract<HopperEndpoint, { readonly _tag: 'Container' }>
type HopperPlanTransferIntent =
  | Readonly<{ _tag: 'PlayerToPlayer' }>
  | (Pick<HopperTransferTickIntent, 'hopperAddress' | 'blockEdits'> & Readonly<{
      _tag: 'PlayerToContainer'
      source: HopperPlayerEndpoint
      destination: HopperContainerEndpoint
    }>)
  | (Pick<HopperTransferTickIntent, 'hopperAddress' | 'blockEdits'> & Readonly<{
      _tag: 'ContainerToContainer'
      source: HopperContainerEndpoint
      destination: HopperContainerEndpoint
    }>)
  | (Pick<HopperTransferTickIntent, 'hopperAddress' | 'blockEdits'> & Readonly<{
      _tag: 'ContainerToPlayer'
      source: HopperContainerEndpoint
      destination: HopperPlayerEndpoint
    }>)

const planTransferIntentFor = (intent: HopperTransferTickIntent): HopperPlanTransferIntent => {
  const base = { hopperAddress: intent.hopperAddress, blockEdits: intent.blockEdits }
  if (intent.source._tag === 'Player') {
    if (intent.destination._tag === 'Player') return { _tag: 'PlayerToPlayer' }
    return { ...base, _tag: 'PlayerToContainer', source: intent.source, destination: intent.destination }
  }
  if (intent.destination._tag === 'Player') {
    return { ...base, _tag: 'ContainerToPlayer', source: intent.source, destination: intent.destination }
  }
  return { ...base, _tag: 'ContainerToContainer', source: intent.source, destination: intent.destination }
}

const transferDimensionsFor = (intent: HopperTransferTickIntent): Array<Dimension> => [
  intent.hopperAddress.dimension,
  ...(intent.source._tag === 'Container' ? [intent.source.address.dimension] : []),
  ...(intent.destination._tag === 'Container' ? [intent.destination.address.dimension] : []),
]

const assertTransferPlanSnapshots = (
  planSnapshot: WorldCommitPlanSnapshot<HopperTransferTickPlanState>,
) => Effect.gen(function* () {
  const { state } = planSnapshot
  const { intent } = state
  const dimensions = transferDimensionsFor(intent)
  yield* assertMatchingPlanBase(planSnapshot, state.containers)
  yield* assertMatchingDimensions(planSnapshot, state.containers, dimensions)

  const requiredPlayer = intent.source._tag === 'Player'
    ? intent.source
    : intent.destination._tag === 'Player' ? intent.destination : undefined
  if (requiredPlayer === undefined) return true
  if (state.player._tag === 'None') return true
  if (state.player.ownerId !== requiredPlayer.ownerId) return false
  yield* assertMatchingPlanBase(planSnapshot, state.player.snapshot)
  yield* assertMatchingDimensions(planSnapshot, state.player.snapshot, dimensions)
  return true
})

const cooledDownFragment = (
  planSnapshot: WorldCommitPlanSnapshot<HopperTransferTickPlanState>,
  ticks: HopperElapsedTicks,
) => Effect.gen(function* () {
  const { state } = planSnapshot
  const { hopperAddress } = state.intent
  const existing = recordAt(state.hoppers, hopperAddress)
  const remainingCooldown = Math.max(0, (existing?.cooldownTicks ?? 0) - ticks)
  if (remainingCooldown === 0) return undefined

  const expectedDimensions = ticks === 0
    ? []
    : yield* expectedDimensionsFor(planSnapshot.expectedDimensions, [hopperAddress.dimension])
  const nextHopper = yield* Schema.decodeUnknownEffect(HopperRuntimeStateSchema)({
    address: hopperAddress,
    cooldownTicks: remainingCooldown,
  })
  return {
    world: planSnapshot.world,
    expectedRevision: planSnapshot.expectedRevision,
    expectedDimensions,
    changes: remainingCooldown === existing?.cooldownTicks
      ? []
      : [{ ownerId: HOPPER_REPLICATED_OWNER_ID, state: upsertHopper(state.hoppers, nextHopper) }],
    result: { _tag: 'CoolingDown', ticks: yield* Schema.decodeUnknownEffect(HopperCooldownTicksSchema)(remainingCooldown) },
    postCommitEvents: [],
  } satisfies WorldCommitPlanFragment<HopperTransferOutcome>
})

const planTransferForIntent = (
  state: HopperTransferTickPlanState,
  intent: Exclude<HopperPlanTransferIntent, { readonly _tag: 'PlayerToPlayer' }>,
) => Effect.gen(function* () {
  if (intent._tag === 'PlayerToContainer') {
    if (state.player._tag === 'None') return undefined
    return {
      _tag: 'PlayerTransfer',
      fragment: yield* storage.planTransferContainerItem(state.containers, state.player.snapshot, {
        playerOwnerId: intent.source.ownerId,
        address: intent.destination.address,
        direction: 'PlayerToContainer',
        playerSlot: intent.source.slot,
        containerSlot: intent.destination.slot,
        count: 1,
      }),
    } satisfies HopperTransferPlan
  }

  if (intent._tag === 'ContainerToContainer') {
    return {
      _tag: 'ContainerMove',
      fragment: yield* storage.planMoveContainerItem(state.containers, {
        sourceAddress: intent.source.address,
        sourceSlot: intent.source.slot,
        destinationAddress: intent.destination.address,
        destinationSlot: intent.destination.slot,
        count: 1,
      }),
    } satisfies HopperTransferPlan
  }

  if (state.player._tag === 'None') return undefined
  return {
    _tag: 'PlayerTransfer',
    fragment: yield* storage.planTransferContainerItem(state.containers, state.player.snapshot, {
      playerOwnerId: intent.destination.ownerId,
      address: intent.source.address,
      direction: 'ContainerToPlayer',
      playerSlot: intent.destination.slot,
      containerSlot: intent.source.slot,
      count: 1,
    }),
  } satisfies HopperTransferPlan
})

const rejectedTransferFragment = (
  planSnapshot: WorldCommitPlanSnapshot<HopperTransferTickPlanState>,
  transfer: HopperDomainTransfer,
) => Effect.gen(function* () {
  const { state } = planSnapshot
  const { hopperAddress } = state.intent
  const existing = recordAt(state.hoppers, hopperAddress)
  const cooldownCandidate = existing !== undefined && existing.cooldownTicks > 0
    ? yield* Schema.decodeUnknownEffect(HopperRuntimeStateSchema)({ ...existing, cooldownTicks: 0 })
    : undefined
  const expectedDimensions = cooldownCandidate === undefined
    ? []
    : yield* expectedDimensionsFor(planSnapshot.expectedDimensions, [hopperAddress.dimension])
  return {
    world: planSnapshot.world,
    expectedRevision: planSnapshot.expectedRevision,
    expectedDimensions,
    changes: cooldownCandidate === undefined
      ? []
      : [{ ownerId: HOPPER_REPLICATED_OWNER_ID, state: upsertHopper(state.hoppers, cooldownCandidate) }],
    result: { _tag: 'TransferRejected', transfer },
    postCommitEvents: [],
  } satisfies WorldCommitPlanFragment<HopperTransferOutcome>
})

const committedTransferFragment = <ResultValue>(
  planSnapshot: WorldCommitPlanSnapshot<HopperTransferTickPlanState>,
  transferFragment: WorldCommitPlanFragment<ResultValue>,
  transfer: Extract<Container.ContainerMoveResult, { readonly _tag: 'Moved' }>
    | Extract<Container.ContainerTransferResult, { readonly _tag: 'Transferred' }>,
) => Effect.gen(function* () {
  const { state } = planSnapshot
  const { hopperAddress } = state.intent
  const hopper = yield* Schema.decodeUnknownEffect(HopperRuntimeStateSchema)({
    address: hopperAddress,
    cooldownTicks: HOPPER_TRANSFER_COOLDOWN_TICKS,
  })
  const expectedDimensions = yield* expectedDimensionsFor(
    planSnapshot.expectedDimensions,
    transferDimensionsFor(state.intent),
  )
  return {
    world: planSnapshot.world,
    expectedRevision: planSnapshot.expectedRevision,
    expectedDimensions,
    changes: [
      ...transferFragment.changes,
      { ownerId: HOPPER_REPLICATED_OWNER_ID, state: upsertHopper(state.hoppers, hopper) },
    ],
    blockEdits: state.intent.blockEdits,
    result: { _tag: 'Committed', transfer, hopper },
    postCommitEvents: transferFragment.postCommitEvents,
  } satisfies WorldCommitPlanFragment<HopperTransferOutcome>
})

const finishTransferPlan = (
  planSnapshot: WorldCommitPlanSnapshot<HopperTransferTickPlanState>,
  transferPlan: HopperTransferPlan,
) => Effect.gen(function* () {
  if (transferPlan._tag === 'ContainerMove') {
    const { fragment } = transferPlan
    if (fragment.result._tag === 'Moved') {
      return yield* committedTransferFragment(planSnapshot, fragment, fragment.result)
    }
    return yield* rejectedTransferFragment(planSnapshot, {
      _tag: 'ContainerMove',
      outcome: fragment.result,
    })
  }
  const { fragment } = transferPlan
  if (fragment.result._tag === 'Transferred') {
    return yield* committedTransferFragment(planSnapshot, fragment, fragment.result)
  }
  return yield* rejectedTransferFragment(planSnapshot, {
    _tag: 'PlayerTransfer',
    outcome: fragment.result,
  })
})

  const planTransferTick: HopperServiceApi['planTransferTick'] = (planSnapshot, elapsedTicks, powered) =>
    Effect.flatMap(Schema.decodeUnknownEffect(HopperTransferTickSnapshotSchema)(planSnapshot), (decodedSnapshot) =>
      Effect.flatMap(Schema.decodeUnknownEffect(HopperElapsedTicksSchema)(elapsedTicks), (ticks) =>
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Boolean)(powered), (isPowered) => Effect.gen(function* () {
          const { state } = decodedSnapshot
          const transferIntent = planTransferIntentFor(state.intent)
          if (transferIntent._tag === 'PlayerToPlayer') {
            return emptyFragment(decodedSnapshot, { _tag: 'InvalidRequest', reason: 'player-to-player' })
          }
          const invalid = invalidTransfer(state.intent)
          if (invalid !== undefined) return emptyFragment(decodedSnapshot, invalid)

          const snapshotsMatch = yield* assertTransferPlanSnapshots(decodedSnapshot)
          if (!snapshotsMatch) {
            return emptyFragment(decodedSnapshot, { _tag: 'InvalidRequest', reason: 'missing-player-snapshot' })
          }
          if (isPowered) return emptyFragment(decodedSnapshot, { _tag: 'Disabled' })

          const cooldownFragment = yield* cooledDownFragment(decodedSnapshot, ticks)
          if (cooldownFragment !== undefined) return cooldownFragment

          const transferPlan = yield* planTransferForIntent(state, transferIntent)
          if (transferPlan === undefined) {
            return emptyFragment(decodedSnapshot, { _tag: 'InvalidRequest', reason: 'missing-player-snapshot' })
          }
          return yield* finishTransferPlan(decodedSnapshot, transferPlan)
        })),
      ),
    )

  const commitFragment = <ResultValue>(
    fragment: WorldCommitPlanFragment<ResultValue>,
    blockWrite?: WorldWriteBatch,
    expectedRevision = fragment.expectedRevision,
  ): Effect.Effect<void, HopperServiceError> => {
    if (fragment.changes.length === 0 && blockWrite === undefined) return Effect.void
    const merged = mergeWorldCommitPlans([fragment])
    return Effect.flatMap(Effect.fromResult(merged), (request) => coordinator.commit({
      ...request,
      expectedRevision,
      ...(blockWrite === undefined ? {} : { blockWrite }),
    }).pipe(Effect.asVoid))
  }

  const transfer: HopperServiceApi['transfer'] = (request) =>
    Effect.flatMap(Schema.decodeUnknownEffect(HopperTransferRequestSchema)(request), (decoded) => Effect.gen(function* () {
      const intent: HopperTransferTickIntent = {
        hopperAddress: decoded.hopperAddress,
        source: decoded.source,
        destination: decoded.destination,
        blockEdits: { dimension: decoded.blockWrite.dimension, edits: decoded.blockWrite.edits },
      }
      const transferIntent = planTransferIntentFor(intent)
      if (transferIntent._tag === 'PlayerToPlayer') return { _tag: 'InvalidRequest', reason: 'player-to-player' }
      const invalid = invalidTransfer(intent)
      if (invalid !== undefined) return invalid

      const hoppers = yield* snapshot()
      const containers = yield* coordinator.snapshot(CONTAINER_STORAGE_REPLICATED_OWNER_ID, ContainerStorageSnapshotSchema)
      const playerEndpoint = decoded.source._tag === 'Player'
        ? decoded.source
        : decoded.destination._tag === 'Player' ? decoded.destination : undefined
      const player = playerEndpoint === undefined
        ? null
        : yield* coordinator.snapshot(playerEndpoint.ownerId, PlayerStorageSnapshotSchema).pipe(Effect.map((value) => ({
          ownerId: playerEndpoint.ownerId,
          snapshot: value,
        })))
      const expectedDimensions = [{
        dimension: decoded.blockWrite.dimension,
        expectedRevision: decoded.blockWrite.expectedDimensionRevision,
      }]
      const planSnapshot: WorldCommitPlanSnapshot<HopperTransferTickPlanState> = {
        world: hoppers.world,
        expectedRevision: hoppers.revision,
        expectedDimensions,
        state: {
          hoppers: hoppers.state,
          containers: {
            world: containers.world,
            expectedRevision: containers.revision,
            expectedDimensions,
            state: containers.state,
          },
          player: player === null ? { _tag: 'None' } : {
            _tag: 'Some',
            ownerId: player.ownerId,
            snapshot: {
              world: player.snapshot.world,
              expectedRevision: player.snapshot.revision,
              expectedDimensions,
              state: player.snapshot.state,
            },
          },
          intent,
        },
      }
      const fragment = yield* planTransferTick(planSnapshot, yield* Schema.decodeUnknownEffect(HopperElapsedTicksSchema)(0), false)
      if (fragment.changes.length > 0 || fragment.blockEdits !== undefined) {
        yield* commitFragment(fragment, decoded.blockWrite, decoded.blockWrite.expectedWorldRevision)
      }
      return fragment.result
    }))

  const advanceCooldown: HopperServiceApi['advanceCooldown'] = (request) =>
    Effect.flatMap(Schema.decodeUnknownEffect(HopperCooldownRequestSchema)(request), (decoded) => Effect.gen(function* () {
      const current = yield* snapshot()
      const existing = recordAt(current.state, decoded.address)
      const planRequest = {
        address: decoded.address,
        ticks: yield* Schema.decodeUnknownEffect(HopperCooldownTicksSchema)(decoded.ticks),
      }
      if (existing === undefined || existing.cooldownTicks === 0) {
        const fragment = yield* planAdvanceCooldown({
          world: current.world,
          expectedRevision: current.revision,
          expectedDimensions: [],
          state: current.state,
        }, planRequest)
        yield* commitFragment(fragment)
        return fragment.result
      }
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
      const planSnapshot: WorldCommitPlanSnapshot<HopperServiceSnapshot> = {
        world: current.world,
        expectedRevision: current.revision,
        expectedDimensions: [{ dimension: decoded.address.dimension, expectedRevision: actualDimensionRevision }],
        state: current.state,
      }
      const fragment = yield* planAdvanceCooldown(planSnapshot, planRequest)
      yield* commitFragment(fragment)
      return fragment.result
    }))

  return { snapshot: snapshot(), planTransferTick, planAdvanceCooldown, transfer, advanceCooldown }
})

export const HopperServiceLayer: Layer.Layer<
  HopperService,
  never,
  WorldCommitCoordinator | ContainerStorageService
> = Layer.effect(HopperService, makeHopperService())
