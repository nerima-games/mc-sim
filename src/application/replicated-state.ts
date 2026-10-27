import {
  WorldIdSchema,
  WorldPositionSchema,
  WorldRevisionSchema,
} from '@nerima-games/mc-kernel'
import { Brand, Schema } from 'effect'
import type { WorldId, WorldRevision } from '@nerima-games/mc-kernel'

export type ReplicatedOwnerId = string & Brand.Brand<'ReplicatedOwnerId'>
type AnyCodec = Schema.Codec<any, any>

export const ReplicatedOwnerIdSchema: Schema.Codec<ReplicatedOwnerId, string> = Schema.NonEmptyString.pipe(Schema.brand('ReplicatedOwnerId'))

export const makeReplicatedOwnerId: Brand.Constructor<ReplicatedOwnerId> = Brand.nominal<ReplicatedOwnerId>()
export const PLAYER_REPLICATED_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('player')

type ReplicatedSnapshotFields<State extends AnyCodec> = {
  readonly world: typeof WorldIdSchema
  readonly revision: typeof WorldRevisionSchema
  readonly state: State
}

export type ReplicatedSnapshot<State extends AnyCodec> = Schema.Struct.Type<ReplicatedSnapshotFields<State>>

export const replicatedSnapshotSchema = <State extends AnyCodec>(
  state: State,
): Schema.Struct<ReplicatedSnapshotFields<State>> =>
  Schema.Struct({
    world: WorldIdSchema,
    revision: WorldRevisionSchema,
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
  readonly revision: typeof WorldRevisionSchema
  readonly changes: Schema.$Array<Change>
}

export type ReplicatedWorldDelta<Change> = Readonly<{
  world: WorldId
  revision: WorldRevision
  changes: ReadonlyArray<Change>
}>

export const replicatedWorldDeltaSchema = <Change extends AnyCodec>(
  change: Change,
): Schema.Struct<ReplicatedWorldDeltaFields<Change>> =>
  Schema.Struct({
    world: WorldIdSchema,
    revision: WorldRevisionSchema,
    changes: Schema.Array(change),
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
