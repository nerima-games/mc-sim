import { Context, Effect, Layer, Ref } from 'effect'
import {
  decodePlayerRegistrySnapshot,
  emptyPlayerRegistrySnapshot,
  type PlayerId,
  type PlayerRecord,
  type PlayerRegistrySnapshot,
  type PlayerRegistryValidationError,
} from '../domain/player-registry.js'

export type PlayerAlreadyExists = {
  readonly _tag: 'PlayerAlreadyExists'
  readonly id: PlayerId
}

export type PlayerRegistryServiceApi = {
  readonly create: (id: PlayerId) => Effect.Effect<PlayerRecord, PlayerAlreadyExists>
  readonly remove: (id: PlayerId) => Effect.Effect<boolean>
  readonly find: (id: PlayerId) => Effect.Effect<PlayerRecord | undefined>
  readonly list: Effect.Effect<ReadonlyArray<PlayerId>>
  readonly snapshot: Effect.Effect<PlayerRegistrySnapshot>
  readonly restore: (input: unknown) => Effect.Effect<void, PlayerRegistryValidationError>
  readonly reset: Effect.Effect<void>
}

const PlayerRegistryServiceBase: Context.TagClass<
  PlayerRegistryService,
  '@nerima-games/mc-sim/PlayerRegistryService',
  PlayerRegistryServiceApi
> = Context.Tag('@nerima-games/mc-sim/PlayerRegistryService')<
  PlayerRegistryService,
  PlayerRegistryServiceApi
>()

export class PlayerRegistryService extends PlayerRegistryServiceBase {}

const validationError = (path: string, reason: string): PlayerRegistryValidationError => ({
  _tag: 'PlayerRegistryValidationError',
  path,
  reason,
})

const duplicateError = (id: PlayerId): PlayerAlreadyExists => ({
  _tag: 'PlayerAlreadyExists',
  id,
})

export const makePlayerRegistryService = (
  initial: PlayerRegistrySnapshot = emptyPlayerRegistrySnapshot(),
): Effect.Effect<PlayerRegistryServiceApi> =>
  Effect.map(Ref.make(initial), (state) => ({
    create: (id) => Ref.modify(state, (current) => {
      const existing = current.players.some((player) => player.id === id)
      return existing
        ? [Effect.fail(duplicateError(id)), current]
        : [Effect.succeed({ id }), { players: [...current.players, { id }] }]
    }).pipe(Effect.flatten),
    remove: (id) => Ref.modify(state, (current) => {
      const players = current.players.filter((player) => player.id !== id)
      return [players.length !== current.players.length, { players }]
    }),
    find: (id) => Ref.get(state).pipe(Effect.map((current) =>
      current.players.find((player) => player.id === id),
    )),
    list: Ref.get(state).pipe(Effect.map((current) => current.players.map((player) => player.id))),
    snapshot: Ref.get(state),
    restore: (input) => {
      const decoded = decodePlayerRegistrySnapshot(input)
      if (decoded._tag === 'Left') {
        return Effect.fail(validationError('snapshot', 'must match the player registry schema'))
      }
      const ids = new Set<PlayerId>()
      for (const player of decoded.right.players) {
        if (ids.has(player.id)) {
          return Effect.fail(validationError('snapshot.players.id', 'must be unique'))
        }
        ids.add(player.id)
      }
      return Ref.modify(state, () => [undefined, decoded.right])
    },
    reset: Ref.set(state, emptyPlayerRegistrySnapshot()),
  }))

export const PlayerRegistryServiceLayer = (
  initial: PlayerRegistrySnapshot = emptyPlayerRegistrySnapshot(),
): Layer.Layer<PlayerRegistryService> => Layer.effect(
  PlayerRegistryService,
  makePlayerRegistryService(initial),
)
