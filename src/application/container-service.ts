import { Context, Effect, Layer, Ref } from 'effect'
import * as Domain from '../domain/container-storage.js'
import * as State from '../domain/container-state.js'

export type ContainerServiceApi = {
  readonly create: (id: State.ContainerId, kind?: Domain.ContainerKind) => Effect.Effect<Domain.CreateContainerResult>
  readonly snapshot: (id: State.ContainerId) => Effect.Effect<Domain.Container | null>
  readonly storageSnapshot: Effect.Effect<Domain.ContainerStorageSnapshot>
  readonly restore: (snapshot: unknown) => Effect.Effect<void, Domain.ContainerStorageValidationError>
  readonly extract: (request: Domain.ContainerExtractRequest) => Effect.Effect<Domain.ContainerExtractResult>
  readonly move: (request: Domain.ContainerMoveRequest) => Effect.Effect<Domain.ContainerMoveResult>
  readonly drain: (id: State.ContainerId) => Effect.Effect<Domain.DrainContainerResult>
  readonly reset: Effect.Effect<void>
}

const ContainerServiceBase: Context.TagClass<ContainerService, '@nerima-games/mc-sim/ContainerService', ContainerServiceApi> =
  Context.Tag('@nerima-games/mc-sim/ContainerService')<ContainerService, ContainerServiceApi>()

export class ContainerService extends ContainerServiceBase {}

export const makeContainerService = (): Effect.Effect<ContainerServiceApi> =>
  Effect.map(Ref.make(Domain.emptyContainerStorage()), (state) => ({
    create: (id, kind) => Ref.modify(state, (current) => {
      const outcome = Domain.createContainer(current, id, kind)
      return [outcome.result, outcome.storage]
    }),
    snapshot: (id) => Ref.get(state).pipe(
      Effect.map((current) => Domain.findContainer(current, id) ?? null),
    ),
    storageSnapshot: Ref.get(state).pipe(Effect.map(Domain.snapshotContainerStorage)),
    restore: (snapshot) => {
      const validated = Domain.validateContainerStorageSnapshot(snapshot)
      return validated._tag === 'Invalid'
        ? Effect.fail(validated.error)
        : Ref.update(state, () => validated.storage)
    },
    extract: (request) => Ref.modify(state, (current) => {
      const outcome = Domain.extractContainerItem(current, request)
      return [outcome.result, outcome.storage]
    }),
    move: (request) => Ref.modify(state, (current) => {
      const outcome = Domain.moveContainerItem(current, request)
      return [outcome.result, outcome.storage]
    }),
    drain: (id) => Ref.modify(state, (current) => {
      const outcome = Domain.drainContainer(current, id)
      return [outcome.result, outcome.storage]
    }),
    reset: Ref.set(state, Domain.emptyContainerStorage()),
  }))

export const ContainerServiceLayer: Layer.Layer<ContainerService> = Layer.effect(
  ContainerService,
  makeContainerService(),
)
