import { Brand, Either, Schema } from 'effect'

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const playerIdSchema: Schema.Schema<PlayerId, string> = Schema.transform(
  Schema.String.pipe(Schema.filter((value): value is string => value.trim().length > 0)),
  Schema.String,
  { decode: playerId, encode: (value) => value, strict: true },
)

type PlayerRecordInput = {
  readonly id: string
}

const isPlayerRecordInput = (value: unknown): value is PlayerRecordInput =>
  isRecord(value) && hasExactKeys(value, ['id']) && typeof value['id'] === 'string'

const playerRecordInput = Schema.Unknown.pipe(
  Schema.filter((value): value is PlayerRecordInput =>
    isPlayerRecordInput(value),
  ),
)

export const PLAYER_RECORD_SCHEMA: Schema.Schema<PlayerRecord, PlayerRecordInput> = Schema.transform(
  playerRecordInput,
  Schema.Struct({ id: playerIdSchema }),
  {
    decode: (value) => ({ id: value.id }),
    encode: (value) => ({ id: value.id }),
    strict: true,
  },
)

type SnapshotInput = {
  readonly players: ReadonlyArray<PlayerRecordInput>
}

const snapshotInput = Schema.Unknown.pipe(
  Schema.filter((value): value is SnapshotInput =>
    isRecord(value) && hasExactKeys(value, ['players']) && Array.isArray(value['players']) &&
    value['players'].every(isPlayerRecordInput),
  ),
)

export const PLAYER_REGISTRY_SNAPSHOT_SCHEMA: Schema.Schema<
  PlayerRegistrySnapshot,
  SnapshotInput
> = Schema.transform(
  snapshotInput,
  Schema.Struct({ players: Schema.Array(PLAYER_RECORD_SCHEMA) }),
  {
    decode: (value) => ({ players: value.players }),
    encode: (value) => ({ players: value.players }),
    strict: true,
  },
)

export const decodePlayerId = (input: unknown): Either.Either<PlayerId, Schema.ParseError> =>
  Schema.decodeUnknownEither(playerIdSchema)(input)

export const decodePlayerRegistrySnapshot = (
  input: unknown,
): Either.Either<PlayerRegistrySnapshot, Schema.ParseError> =>
  Schema.decodeUnknownEither(PLAYER_REGISTRY_SNAPSHOT_SCHEMA)(input)

export const emptyPlayerRegistrySnapshot = (): PlayerRegistrySnapshot => ({ players: [] })
