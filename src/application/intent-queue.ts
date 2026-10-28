import {
  BLOCK_FACES,
  BlockAddressSchema,
  BlockIdSchema,
  DimensionRevisionSchema,
  EntityIdSchema,
  ItemIdSchema,
  SimulationTickSchema,
  VehicleId as KernelVehicleId,
  WorldRevisionSchema,
} from '@nerima-games/mc-kernel'
import type {
  BlockAddress,
  BlockId,
  DimensionRevision,
  EntityId,
  ItemId,
  SimulationTick,
  VehicleId,
  WorldRevision,
} from '@nerima-games/mc-kernel'
import { Brand, Context, Effect, Layer, Ref, Schema } from 'effect'
import type { YieldableError } from 'effect/Cause'
import { SchemaErrorSchema } from '../schema-errors.js'

export type IntentSequence = number & Brand.Brand<'IntentSequence'>
export type IntentQueueCapacity = number & Brand.Brand<'IntentQueueCapacity'>
export type IntentId = string & Brand.Brand<'IntentId'>

export const IntentSequenceSchema: Schema.Codec<IntentSequence, number> = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand('IntentSequence'),
)

export const IntentQueueCapacitySchema: Schema.Codec<IntentQueueCapacity, number> = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand('IntentQueueCapacity'),
)

export const IntentIdSchema: Schema.Codec<IntentId, string> = Schema.NonEmptyString.pipe(Schema.brand('IntentId'))

const BlockFaceSchema = Schema.Literals(BLOCK_FACES)
const Direction3ComponentSchema = Schema.Finite.check(
  Schema.isBetween({ minimum: -1, maximum: 1 }),
)
const Direction3Schema = Schema.Struct({
  x: Direction3ComponentSchema,
  y: Direction3ComponentSchema,
  z: Direction3ComponentSchema,
})
const TradeOfferIdSchema = Schema.NonEmptyString.pipe(Schema.brand('TradeOfferId'))
const VehicleIdSchema = Schema.String.pipe(Schema.fromBrand('VehicleId', KernelVehicleId))
const VehicleControlAxisSchema = Schema.Finite.check(
  Schema.isBetween({ minimum: -1, maximum: 1 }),
)

const BreakBlockIntentSchema = Schema.TaggedStruct('BreakBlock', {
  actor: EntityIdSchema,
  address: BlockAddressSchema,
})
const PlaceBlockIntentSchema = Schema.TaggedStruct('PlaceBlock', {
  actor: EntityIdSchema,
  address: BlockAddressSchema,
  block: BlockIdSchema,
})
const UseItemIntentSchema = Schema.TaggedStruct('UseItem', {
  actor: EntityIdSchema,
  item: ItemIdSchema,
})
const MineBlockInputIntentSchema = Schema.TaggedStruct('MineBlockInput', {
  actor: EntityIdSchema,
  address: BlockAddressSchema,
  action: Schema.Literals(['start', 'stop']),
})
const UseBlockIntentSchema = Schema.TaggedStruct('UseBlock', {
  actor: EntityIdSchema,
  address: BlockAddressSchema,
  face: BlockFaceSchema,
})
const LeaveSleepIntentSchema = Schema.TaggedStruct('LeaveSleep', {
  actor: EntityIdSchema,
})
const UseItemOnBlockIntentSchema = Schema.TaggedStruct('UseItemOnBlock', {
  actor: EntityIdSchema,
  item: ItemIdSchema,
  address: BlockAddressSchema,
  face: BlockFaceSchema,
})
const UseItemOnEntityIntentSchema = Schema.TaggedStruct('UseItemOnEntity', {
  actor: EntityIdSchema,
  item: ItemIdSchema,
  target: EntityIdSchema,
})
const MeleeAttackIntentSchema = Schema.TaggedStruct('MeleeAttack', {
  actor: EntityIdSchema,
})
const BowActionIntentSchema = Schema.TaggedStruct('BowAction', {
  actor: EntityIdSchema,
  action: Schema.Literals(['draw', 'release', 'cancel']),
  aimDirection: Schema.optionalKey(Direction3Schema),
})
const FishingActionIntentSchema = Schema.TaggedStruct('FishingAction', {
  actor: EntityIdSchema,
  action: Schema.Literals(['cast', 'reel', 'cancel']),
})
const TradeVillagerIntentSchema = Schema.TaggedStruct('TradeVillager', {
  actor: EntityIdSchema,
  villager: EntityIdSchema,
  offerId: TradeOfferIdSchema,
})
const VehicleActionIntentSchema = Schema.TaggedStruct('VehicleAction', {
  actor: EntityIdSchema,
  vehicle: VehicleIdSchema,
  action: Schema.Literals(['mount', 'dismount']),
})
const VehicleControlIntentSchema = Schema.TaggedStruct('VehicleControl', {
  actor: EntityIdSchema,
  vehicle: VehicleIdSchema,
  throttle: VehicleControlAxisSchema,
  steering: VehicleControlAxisSchema,
})
const ApplyEnchantmentOfferIntentSchema = Schema.TaggedStruct('ApplyEnchantmentOffer', {
  actor: EntityIdSchema,
  station: BlockAddressSchema,
  offerSlot: Schema.Literals([0, 1, 2]),
})
const SetShieldBlockingIntentSchema = Schema.TaggedStruct('SetShieldBlocking', {
  actor: EntityIdSchema,
  blocking: Schema.Boolean,
})
const ThrowEnderPearlIntentSchema = Schema.TaggedStruct('ThrowEnderPearl', {
  actor: EntityIdSchema,
  aimDirection: Direction3Schema,
})

export type Direction3 = Readonly<{ x: number; y: number; z: number }>
type TradeOfferId = string & Brand.Brand<'TradeOfferId'>
type BlockFace = typeof BLOCK_FACES[number]

export type IntentPayload =
  | Readonly<{ _tag: 'BreakBlock'; actor: EntityId; address: BlockAddress }>
  | Readonly<{ _tag: 'PlaceBlock'; actor: EntityId; address: BlockAddress; block: BlockId }>
  | Readonly<{ _tag: 'UseItem'; actor: EntityId; item: ItemId }>
  | Readonly<{ _tag: 'MineBlockInput'; actor: EntityId; address: BlockAddress; action: 'start' | 'stop' }>
  | Readonly<{ _tag: 'UseBlock'; actor: EntityId; address: BlockAddress; face: BlockFace }>
  | Readonly<{ _tag: 'LeaveSleep'; actor: EntityId }>
  | Readonly<{ _tag: 'UseItemOnBlock'; actor: EntityId; item: ItemId; address: BlockAddress; face: BlockFace }>
  | Readonly<{ _tag: 'UseItemOnEntity'; actor: EntityId; item: ItemId; target: EntityId }>
  | Readonly<{ _tag: 'MeleeAttack'; actor: EntityId }>
  | Readonly<{ _tag: 'BowAction'; actor: EntityId; action: 'draw' | 'release' | 'cancel'; aimDirection?: Direction3 }>
  | Readonly<{ _tag: 'FishingAction'; actor: EntityId; action: 'cast' | 'reel' | 'cancel' }>
  | Readonly<{ _tag: 'TradeVillager'; actor: EntityId; villager: EntityId; offerId: TradeOfferId }>
  | Readonly<{ _tag: 'VehicleAction'; actor: EntityId; vehicle: VehicleId; action: 'mount' | 'dismount' }>
  | Readonly<{ _tag: 'VehicleControl'; actor: EntityId; vehicle: VehicleId; throttle: number; steering: number }>
  | Readonly<{ _tag: 'ApplyEnchantmentOffer'; actor: EntityId; station: BlockAddress; offerSlot: 0 | 1 | 2 }>
  | Readonly<{ _tag: 'SetShieldBlocking'; actor: EntityId; blocking: boolean }>
  | Readonly<{ _tag: 'ThrowEnderPearl'; actor: EntityId; aimDirection: Direction3 }>

export const IntentPayloadSchema: Schema.Codec<IntentPayload, unknown> = Schema.Union([
  BreakBlockIntentSchema,
  PlaceBlockIntentSchema,
  UseItemIntentSchema,
  MineBlockInputIntentSchema,
  UseBlockIntentSchema,
  LeaveSleepIntentSchema,
  UseItemOnBlockIntentSchema,
  UseItemOnEntityIntentSchema,
  MeleeAttackIntentSchema,
  BowActionIntentSchema,
  FishingActionIntentSchema,
  TradeVillagerIntentSchema,
  VehicleActionIntentSchema,
  VehicleControlIntentSchema,
  ApplyEnchantmentOfferIntentSchema,
  SetShieldBlockingIntentSchema,
  ThrowEnderPearlIntentSchema,
])

const LocalIntentSchema = Schema.Struct({
  id: IntentIdSchema,
  targetTick: SimulationTickSchema,
  source: Schema.Literals(['local']),
  payload: IntentPayloadSchema,
})
const NetworkIntentSchema = Schema.Struct({
  id: IntentIdSchema,
  targetTick: SimulationTickSchema,
  source: Schema.Literals(['network']),
  payload: IntentPayloadSchema,
  expectedRevision: WorldRevisionSchema,
  expectedDimensionRevision: DimensionRevisionSchema,
})

type LocalIntent = Readonly<{
  id: IntentId
  targetTick: SimulationTick
  source: 'local'
  payload: IntentPayload
}>
type NetworkIntent = Readonly<{
  id: IntentId
  targetTick: SimulationTick
  source: 'network'
  payload: IntentPayload
  expectedRevision: WorldRevision
  expectedDimensionRevision: DimensionRevision
}>

export type Intent = LocalIntent | NetworkIntent

export const IntentSchema: Schema.Codec<Intent, unknown> = Schema.Union([LocalIntentSchema, NetworkIntentSchema])

export type QueuedIntent = Readonly<{ sequence: IntentSequence; intent: Intent }>

export const QueuedIntentSchema: Schema.Codec<QueuedIntent, unknown> = Schema.Struct({
  sequence: IntentSequenceSchema,
  intent: IntentSchema,
})

const IntentQueueFullBase: new (args: { readonly capacity: IntentQueueCapacity }) =>
  YieldableError & { readonly _tag: 'IntentQueueFull'; readonly capacity: IntentQueueCapacity } =
  Schema.TaggedError<IntentQueueFull>()('IntentQueueFull', {
    capacity: IntentQueueCapacitySchema,
  })

export class IntentQueueFull extends IntentQueueFullBase {}

export const IntentQueueEnqueueFailureSchema: Schema.Codec<
  IntentQueueFull | Schema.SchemaError,
  unknown
> = Schema.Union([
  Schema.instanceOf(IntentQueueFull),
  SchemaErrorSchema,
])

export type IntentQueueApi = {
  readonly enqueue: (intent: Intent) => Effect.Effect<IntentSequence, IntentQueueFull | Schema.SchemaError>
  readonly takeReady: (tick: SimulationTick) => Effect.Effect<ReadonlyArray<QueuedIntent>, Schema.SchemaError>
}

const IntentQueueBase: Context.ServiceClass<
  IntentQueue,
  'mc-sim/application/IntentQueue',
  IntentQueueApi
> = Context.Service<IntentQueue, IntentQueueApi>()('mc-sim/application/IntentQueue')

export class IntentQueue extends IntentQueueBase {}

type IntentQueueState = {
  readonly nextSequence: number
  readonly pending: ReadonlyArray<QueuedIntent>
}

type IntentAdmission =
  | { readonly _tag: 'Full' }
  | { readonly _tag: 'Accepted'; readonly sequence: IntentSequence }

const makeIntentSequence = Brand.nominal<IntentSequence>()

const compareQueuedIntents = (left: QueuedIntent, right: QueuedIntent): number => {
  const tickOrder = left.intent.targetTick - right.intent.targetTick
  return tickOrder !== 0 ? tickOrder : left.sequence - right.sequence
}

export const IntentQueueLayer = (config: {
  readonly capacity: IntentQueueCapacity
}): Layer.Layer<IntentQueue, Schema.SchemaError> =>
  Layer.effect(
    IntentQueue,
    Effect.gen(function* () {
      const capacity = yield* Schema.decodeUnknownEffect(IntentQueueCapacitySchema)(config.capacity)
      const state = yield* Ref.make<IntentQueueState>({ nextSequence: 0, pending: [] })

      return {
        enqueue: (intent) => Schema.decodeUnknownEffect(IntentSchema)(intent).pipe(
          Effect.flatMap((validIntent) =>
            Effect.flatMap(
              Ref.modify(state, (current): readonly [IntentAdmission, IntentQueueState] => {
                if (current.pending.length >= capacity) {
                  return [{ _tag: 'Full' }, current]
                }

                const sequence = makeIntentSequence(current.nextSequence)
                const queued = { sequence, intent: validIntent }
                return [
                  { _tag: 'Accepted', sequence },
                  {
                    nextSequence: current.nextSequence + 1,
                    pending: [...current.pending, queued],
                  },
                ]
              }),
              (admission) =>
                admission._tag === 'Full'
                  ? Effect.fail(new IntentQueueFull({ capacity }))
                  : Effect.succeed(admission.sequence),
            ),
          ),
        ),
        takeReady: (tick) => Schema.decodeUnknownEffect(SimulationTickSchema)(tick).pipe(
          Effect.flatMap((validTick) =>
            Ref.modify(state, (current) => {
              const ready: Array<QueuedIntent> = []
              const pending: Array<QueuedIntent> = []

              for (const queued of current.pending) {
                if (queued.intent.targetTick <= validTick) ready.push(queued)
                else pending.push(queued)
              }

              return [ready.sort(compareQueuedIntents), { ...current, pending }]
            }),
          ),
        ),
      }
    }),
  )
