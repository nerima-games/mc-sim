import {
  BlockIdSchema,
  DIMENSIONS,
  WorldIdSchema,
  WorldPositionSchema,
  WorldRevisionSchema,
} from '@nerima-games/mc-kernel'
import { Brand, Schema } from 'effect'
import type { BlockId, BlockPosition, Dimension, WorldId, WorldRevision } from '@nerima-games/mc-kernel'

export type ReplicatedOwnerId = string & Brand.Brand<'ReplicatedOwnerId'>
type AnyCodec = Schema.Codec<any, any>

const SafeRevisionSchema: Schema.Codec<WorldRevision, number> = WorldRevisionSchema.check(
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
const SafeBlockAxisSchema: Schema.Codec<BlockPosition['x'], number> = Schema.Int
  .check(Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }))
  .pipe(Schema.brand('BlockAxis'))
export const WorldBlockPositionSchema: Schema.Codec<BlockPosition, Readonly<{ x: number; y: number; z: number }>> = Schema.Struct({
  x: SafeBlockAxisSchema,
  y: SafeBlockAxisSchema,
  z: SafeBlockAxisSchema,
})

export const ReplicatedOwnerIdSchema: Schema.Codec<ReplicatedOwnerId, string> = Schema.NonEmptyString.pipe(Schema.brand('ReplicatedOwnerId'))

export const makeReplicatedOwnerId: Brand.Constructor<ReplicatedOwnerId> = Brand.nominal<ReplicatedOwnerId>()
export const PLAYER_REPLICATED_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('player')

type ReplicatedSnapshotFields<State extends AnyCodec> = {
  readonly world: typeof WorldIdSchema
  readonly revision: typeof SafeRevisionSchema
  readonly state: State
}

export type ReplicatedSnapshot<State extends AnyCodec> = Schema.Struct.Type<ReplicatedSnapshotFields<State>>

export const replicatedSnapshotSchema = <State extends AnyCodec>(
  state: State,
): Schema.Struct<ReplicatedSnapshotFields<State>> =>
  Schema.Struct({
    world: WorldIdSchema,
    revision: SafeRevisionSchema,
    state,
  })

type ReplicatedOwnerChangeFields<Owner extends string, State extends AnyCodec> = {
  readonly owner: Schema.Codec<Brand.Branded<Owner, 'ReplicatedOwnerId'>, Owner>
  readonly state: State
}

export type ReplicatedOwnerChangeFor<Owner extends string, State extends AnyCodec> =
  Schema.Struct.Type<ReplicatedOwnerChangeFields<Owner, State>>

export const replicatedOwnerChangeSchema = <const Owner extends string, State extends AnyCodec>(
  owner: Owner,
  state: State,
): Schema.Struct<ReplicatedOwnerChangeFields<Owner, State>> =>
  Schema.Struct({
    owner: Schema.Literals([owner]).pipe(Schema.brand('ReplicatedOwnerId')),
    state,
  })

export type ReplicatedOwnerChange = Readonly<{ owner: ReplicatedOwnerId; state: unknown }>

export const ReplicatedOwnerChangeSchema: Schema.Codec<ReplicatedOwnerChange, Readonly<{ owner: string; state: unknown }>> = Schema.Struct({
  owner: ReplicatedOwnerIdSchema,
  state: Schema.Unknown,
})

type ReplicatedWorldDeltaFields<Change extends AnyCodec> = {
  readonly world: typeof WorldIdSchema
  readonly revision: typeof SafeRevisionSchema
  readonly changes: Schema.$Array<Change>
  readonly blockChanges: Schema.$Array<typeof ReplicatedBlockChangeSchema>
}

export type ReplicatedBlockChange = Readonly<{
  dimension: Dimension
  position: BlockPosition
  before: BlockId
  after: BlockId
}>

export const ReplicatedBlockChangeSchema: Schema.Codec<ReplicatedBlockChange, Readonly<{
  dimension: Dimension
  position: Schema.Codec.Encoded<typeof WorldBlockPositionSchema>
  before: Schema.Codec.Encoded<typeof BlockIdSchema>
  after: Schema.Codec.Encoded<typeof BlockIdSchema>
}>> = Schema.Struct({
  dimension: Schema.Literals(DIMENSIONS),
  position: WorldBlockPositionSchema,
  before: BlockIdSchema,
  after: BlockIdSchema,
})

export type ReplicatedWorldDelta<Change> = Readonly<{
  world: WorldId
  revision: WorldRevision
  changes: ReadonlyArray<Change>
  blockChanges: ReadonlyArray<ReplicatedBlockChange>
}>

export const replicatedWorldDeltaSchema = <Change extends AnyCodec>(
  change: Change,
): Schema.Struct<ReplicatedWorldDeltaFields<Change>> =>
  Schema.Struct({
    world: WorldIdSchema,
    revision: SafeRevisionSchema,
    changes: Schema.Array(change),
    blockChanges: Schema.Array(ReplicatedBlockChangeSchema),
  })

type WorldBlockReading =
  | Readonly<{ _tag: 'Block'; block: BlockId }>
  | Readonly<{ _tag: 'ChunkNotLoaded' }>
  | Readonly<{ _tag: 'OutOfWorld' }>

const WorldBlockReadingSchema: Schema.Codec<WorldBlockReading, unknown> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Block'), block: BlockIdSchema }),
  Schema.Struct({ _tag: Schema.Literal('ChunkNotLoaded') }),
  Schema.Struct({ _tag: Schema.Literal('OutOfWorld') }),
])

export type WorldBlockRead = Readonly<{
  dimension: Dimension
  position: BlockPosition
  reading: WorldBlockReading
}>

export const WorldBlockReadSchema: Schema.Codec<WorldBlockRead, Readonly<{
  dimension: Dimension
  position: Schema.Codec.Encoded<typeof WorldBlockPositionSchema>
  reading: Schema.Codec.Encoded<typeof WorldBlockReadingSchema>
}>> = Schema.Struct({
  dimension: Schema.Literals(DIMENSIONS),
  position: WorldBlockPositionSchema,
  reading: WorldBlockReadingSchema,
})

type WorldReadSnapshotFields<State extends AnyCodec> = {
  readonly world: typeof WorldIdSchema
  readonly revision: typeof SafeRevisionSchema
  readonly state: State
  readonly blocks: Schema.$Array<typeof WorldBlockReadSchema>
}

export type WorldReadSnapshot<State extends AnyCodec> = Schema.Struct.Type<WorldReadSnapshotFields<State>>

export const WorldReadSnapshotSchema = <State extends AnyCodec>(
  state: State,
): Schema.Struct<WorldReadSnapshotFields<State>> => Schema.Struct({
  world: WorldIdSchema,
  revision: SafeRevisionSchema,
  state,
  blocks: Schema.Array(WorldBlockReadSchema),
})

export type YawRadians = number & Brand.Brand<'YawRadians'>
export type PitchRadians = number & Brand.Brand<'PitchRadians'>

export const YawRadiansSchema: Schema.Codec<YawRadians, number> = Schema.Finite.pipe(Schema.brand('YawRadians'))
export const PitchRadiansSchema: Schema.Codec<PitchRadians, number> = Schema.Finite.pipe(Schema.brand('PitchRadians'))

type ReplicatedPlayerPose = Readonly<{
  feetPosition: Schema.Schema.Type<typeof WorldPositionSchema>
  yawRadians: YawRadians
  pitchRadians: PitchRadians
}>

type ReplicatedPlayerPoseEncoded = Readonly<{
  feetPosition: Schema.Codec.Encoded<typeof WorldPositionSchema>
  yawRadians: number
  pitchRadians: number
}>

export const ReplicatedPlayerPoseSchema: Schema.Codec<ReplicatedPlayerPose, ReplicatedPlayerPoseEncoded> = Schema.Struct({
  feetPosition: WorldPositionSchema,
  yawRadians: YawRadiansSchema,
  pitchRadians: PitchRadiansSchema,
})

type PlayerServiceSnapshot = Readonly<{ pose: ReplicatedPlayerPose }>
type PlayerServiceSnapshotEncoded = Readonly<{ pose: ReplicatedPlayerPoseEncoded }>

export const PlayerServiceSnapshotSchema: Schema.Codec<PlayerServiceSnapshot, PlayerServiceSnapshotEncoded> = Schema.Struct({
  pose: ReplicatedPlayerPoseSchema,
})
