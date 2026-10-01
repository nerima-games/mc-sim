import { Brand, Either, ParseResult, Schema } from 'effect'

export type PlayerId = string & Brand.Brand<'PlayerId'>

const playerId: Brand.Brand.Constructor<PlayerId> = Brand.refined<PlayerId>(
  (value) => typeof value === 'string' && value.trim().length > 0,
  (value) => Brand.error(`PlayerId must be a non-blank string, received ${JSON.stringify(value)}`),
)

export const PlayerId: Brand.Brand.Constructor<PlayerId> = playerId

export type PlayerRecord = {
  readonly id: PlayerId
}

export type PlayerRegistrySnapshot = {
  readonly players: ReadonlyArray<PlayerRecord>
}

export type PlayerRegistryValidationError = {
  readonly _tag: 'PlayerRegistryValidationError'
  readonly path: string
  readonly reason: string
}

const isPlayerId = (value: unknown): value is PlayerId =>
  typeof value === 'string' && value.trim().length > 0

const playerIdSchema: Schema.Schema<PlayerId, string> = Schema.String.pipe(
  Schema.filter((value): value is PlayerId => isPlayerId(value)),
)

type PlayerRecordEncoded = { readonly id: string }
export const PLAYER_RECORD_SCHEMA: Schema.Schema<PlayerRecord, PlayerRecordEncoded> = Schema.Struct({ id: playerIdSchema }).pipe(
  Schema.filter((value) => Object.keys(value).length === 1),
)

type PlayerRegistrySnapshotEncoded = { readonly players: ReadonlyArray<PlayerRecordEncoded> }
export const PLAYER_REGISTRY_SNAPSHOT_SCHEMA: Schema.Schema<
  PlayerRegistrySnapshot,
  PlayerRegistrySnapshotEncoded
> = Schema.Struct({
  players: Schema.Array(PLAYER_RECORD_SCHEMA),
}).pipe(Schema.filter((value) => Object.keys(value).length === 1))

export const decodePlayerId: (input: unknown) => Either.Either<PlayerId, ParseResult.ParseError> = (input) =>
  Schema.decodeUnknownEither(playerIdSchema)(input)

export const decodePlayerRegistrySnapshot: (
  input: unknown,
) => Either.Either<PlayerRegistrySnapshot, ParseResult.ParseError> = (input) =>
  Schema.decodeUnknownEither(PLAYER_REGISTRY_SNAPSHOT_SCHEMA)(input)

export const emptyPlayerRegistrySnapshot = (): PlayerRegistrySnapshot => ({ players: [] })
