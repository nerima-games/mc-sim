import {
  WorldRevisionSchema,
  WorldWriteBatchSchema,
  type WorldRevision,
  type WorldWriteBatch,
} from '@nerima-games/mc-kernel'
import { Context, Effect, Layer, Schema } from 'effect'
import type { PlayerStorage } from '../domain/player-storage.js'
import { SchemaErrorSchema } from '../schema-errors.js'
import { PlayerStorageSnapshotSchema } from './container-service.js'
import { ReplicatedOwnerIdSchema, type ReplicatedOwnerId } from './replicated-state.js'
import {
  WorldCommitCoordinator,
  WorldCommitCoordinatorErrorSchema,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'

const SafeWorldRevisionSchema: Schema.Codec<WorldRevision, number> = WorldRevisionSchema.check(
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)

export type BucketUseOutcome =
  | Readonly<{ _tag: 'Committed'; revision: WorldRevision }>
  | Readonly<{ _tag: 'NoChanges' }>

export const BucketUseOutcomeSchema: Schema.Codec<BucketUseOutcome, unknown> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Committed'), revision: SafeWorldRevisionSchema }),
  Schema.Struct({ _tag: Schema.Literal('NoChanges') }),
])

export type BucketUseRequest = Readonly<{
  playerOwnerId: ReplicatedOwnerId
  playerStorage: PlayerStorage
  blockWrite: WorldWriteBatch
}>

const BucketUseRequestSchema = Schema.Struct({
  playerOwnerId: ReplicatedOwnerIdSchema,
  playerStorage: PlayerStorageSnapshotSchema,
  blockWrite: WorldWriteBatchSchema,
})

export const BucketServiceErrorSchema: Schema.Codec<BucketServiceError, unknown> = Schema.Union([
  SchemaErrorSchema,
  WorldCommitCoordinatorErrorSchema,
])

export type BucketServiceError = Schema.SchemaError | WorldCommitCoordinatorError

export type BucketServiceApi = Readonly<{
  /** Commit the caller's bucket inventory candidate with every supplied fluid-cell edit. */
  commitUse: (request: BucketUseRequest) => Effect.Effect<BucketUseOutcome, BucketServiceError>
}>

const BucketServiceBase: Context.ServiceClass<
  BucketService,
  '@nerima-games/mc-sim/BucketService',
  BucketServiceApi
> = Context.Service<BucketService, BucketServiceApi>()('@nerima-games/mc-sim/BucketService')

export class BucketService extends BucketServiceBase {}

export const makeBucketService = (): Effect.Effect<BucketServiceApi, never, WorldCommitCoordinator> =>
  Effect.gen(function* () {
    const coordinator = yield* WorldCommitCoordinator

    const commitUse: BucketServiceApi['commitUse'] = (request) =>
      Effect.flatMap(Schema.decodeUnknownEffect(BucketUseRequestSchema)(request), (decoded) => {
        if (decoded.blockWrite.edits.length === 0) {
          return Effect.succeed<BucketUseOutcome>({ _tag: 'NoChanges' })
        }
        return Effect.map(coordinator.commit({
          expectedRevision: decoded.blockWrite.expectedWorldRevision,
          expectedDimensions: [{
            dimension: decoded.blockWrite.dimension,
            expectedRevision: decoded.blockWrite.expectedDimensionRevision,
          }],
          changes: [{ ownerId: decoded.playerOwnerId, state: decoded.playerStorage }],
          blockWrite: decoded.blockWrite,
        }), (delta) => ({ _tag: 'Committed' as const, revision: delta.revision }))
      })

    return { commitUse }
  })

export const BucketServiceLayer: Layer.Layer<BucketService, never, WorldCommitCoordinator> =
  Layer.effect(BucketService, makeBucketService())
