import { Brand, Schema } from 'effect'

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

const playerIdSchema: Schema.Schema<PlayerId> = Schema.String.pipe(
  Schema.filter((value): value is PlayerId => isPlayerId(value)),
)

export const PLAYER_RECORD_SCHEMA: Schema.Schema<PlayerRecord> = Schema.Struct({ id: playerIdSchema }).pipe(
  Schema.filter((value) => Object.keys(value).length === 1),
)

export const PLAYER_REGISTRY_SNAPSHOT_SCHEMA: Schema.Schema<PlayerRegistrySnapshot> = Schema.Struct({
  players: Schema.Array(PLAYER_RECORD_SCHEMA),
}).pipe(Schema.filter((value) => Object.keys(value).length === 1))

export const decodePlayerId = (input: unknown) =>
  Schema.decodeUnknownEither(playerIdSchema)(input)

export const decodePlayerRegistrySnapshot = (input: unknown) =>
  Schema.decodeUnknownEither(PLAYER_REGISTRY_SNAPSHOT_SCHEMA)(input)

export const emptyPlayerRegistrySnapshot = (): PlayerRegistrySnapshot => ({ players: [] })
