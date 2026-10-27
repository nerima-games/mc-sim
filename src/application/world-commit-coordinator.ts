import {
  DIMENSIONS,
  DimensionRevisionSchema,
  WorldIdSchema,
  WorldRevisionSchema,
} from '@nerima-games/mc-kernel'
import type { Dimension, DimensionRevision, WorldId, WorldRevision } from '@nerima-games/mc-kernel'
import { Brand, Context, Effect, Layer, Ref, Schema } from 'effect'
import type { YieldableError } from 'effect/Cause'
import { SchemaErrorSchema } from '../schema-errors.js'
import {
  ReplicatedOwnerIdSchema,
  type ReplicatedOwnerChange,
  type ReplicatedOwnerId,
  type ReplicatedSnapshot,
  type ReplicatedWorldDelta,
} from './replicated-state.js'

type AnyCodec = Schema.Codec<any, any>

const isAnyCodec = (value: unknown): value is AnyCodec => Schema.isSchema(value)

type WorldRevisionConflictFields = Readonly<{ expected: WorldRevision; actual: WorldRevision }>
const WorldRevisionConflictBase: new (args: WorldRevisionConflictFields) =>
  YieldableError & { readonly _tag: 'WorldRevisionConflict' } & WorldRevisionConflictFields =
  Schema.TaggedError<WorldRevisionConflict>()('WorldRevisionConflict', {
    expected: WorldRevisionSchema,
    actual: WorldRevisionSchema,
  })
export class WorldRevisionConflict extends WorldRevisionConflictBase {}

type DimensionRevisionConflictFields = Readonly<{
  dimension: Dimension
  expected: DimensionRevision
  actual: DimensionRevision
}>
const DimensionRevisionConflictBase: new (args: DimensionRevisionConflictFields) =>
  YieldableError & { readonly _tag: 'DimensionRevisionConflict' } & DimensionRevisionConflictFields =
  Schema.TaggedError<DimensionRevisionConflict>()('DimensionRevisionConflict', {
    dimension: Schema.Literals(DIMENSIONS),
    expected: DimensionRevisionSchema,
    actual: DimensionRevisionSchema,
  })
export class DimensionRevisionConflict extends DimensionRevisionConflictBase {}

type ReplicatedOwnerFields = Readonly<{ ownerId: ReplicatedOwnerId }>
const ReplicatedOwnerUnknownBase: new (args: ReplicatedOwnerFields) =>
  YieldableError & { readonly _tag: 'ReplicatedOwnerUnknown' } & ReplicatedOwnerFields =
  Schema.TaggedError<ReplicatedOwnerUnknown>()('ReplicatedOwnerUnknown', {
    ownerId: ReplicatedOwnerIdSchema,
  })
export class ReplicatedOwnerUnknown extends ReplicatedOwnerUnknownBase {}

const ReplicatedOwnerDuplicateBase: new (args: ReplicatedOwnerFields) =>
  YieldableError & { readonly _tag: 'ReplicatedOwnerDuplicate' } & ReplicatedOwnerFields =
  Schema.TaggedError<ReplicatedOwnerDuplicate>()('ReplicatedOwnerDuplicate', {
    ownerId: ReplicatedOwnerIdSchema,
  })
export class ReplicatedOwnerDuplicate extends ReplicatedOwnerDuplicateBase {}

export type ReplicatedOwnerRegistration<Codec extends AnyCodec = AnyCodec> = Readonly<{
  ownerId: ReplicatedOwnerId
  schema: Codec
  initialState: Codec['Type']
}>

export type DimensionRevisionExpectation = Readonly<{
  dimension: Dimension
  expectedRevision: DimensionRevision
}>

export type ReplicatedOwnerCandidate = Readonly<{
  ownerId: ReplicatedOwnerId
  state: unknown
}>

export type WorldCommitRequest = Readonly<{
  expectedRevision: WorldRevision
  expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>
  changes: readonly [ReplicatedOwnerCandidate, ...ReadonlyArray<ReplicatedOwnerCandidate>]
}>

const WorldCommitRequestSchema = Schema.Struct({
  expectedRevision: WorldRevisionSchema,
  expectedDimensions: Schema.Array(Schema.Struct({
    dimension: Schema.Literals(DIMENSIONS),
    expectedRevision: DimensionRevisionSchema,
  })),
  changes: Schema.NonEmptyArray(Schema.Struct({
    ownerId: ReplicatedOwnerIdSchema,
    state: Schema.Unknown,
  })),
})

const WorldCommitCoordinatorOptionsSchema = Schema.Struct({
  world: WorldIdSchema,
  owners: Schema.Array(Schema.Struct({
    ownerId: ReplicatedOwnerIdSchema,
    schema: Schema.Unknown,
    initialState: Schema.Unknown,
  })),
  dimensions: Schema.optional(Schema.Array(Schema.Literals(DIMENSIONS))),
})

export type WorldCommitCoordinatorError =
  | Readonly<{ _tag: 'WorldCommitCoordinatorInvalidOptions'; value: unknown }>
  | Schema.SchemaError
  | WorldRevisionConflict
  | DimensionRevisionConflict
  | ReplicatedOwnerUnknown
  | ReplicatedOwnerDuplicate

export const WorldCommitCoordinatorErrorSchema: Schema.Codec<WorldCommitCoordinatorError, unknown> = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('WorldCommitCoordinatorInvalidOptions'),
    value: Schema.Unknown,
  }),
  SchemaErrorSchema,
  Schema.instanceOf(WorldRevisionConflict),
  Schema.instanceOf(DimensionRevisionConflict),
  Schema.instanceOf(ReplicatedOwnerUnknown),
  Schema.instanceOf(ReplicatedOwnerDuplicate),
])

type PreparedOwnerChange = ReplicatedOwnerChange

type CoordinatorState = Readonly<{
  readonly world: WorldId
  readonly revision: WorldRevision
  readonly dimensionRevisions: ReadonlyMap<Dimension, DimensionRevision>
  readonly owners: ReadonlyMap<ReplicatedOwnerId, unknown>
}>

type OwnerRegistry = ReadonlyMap<ReplicatedOwnerId, AnyCodec>

type CommitDecision =
  | Readonly<{ _tag: 'Committed'; delta: ReplicatedWorldDelta<PreparedOwnerChange> }>
  | Readonly<{ _tag: 'Rejected'; error: WorldRevisionConflict | DimensionRevisionConflict }>

export type WorldCommitCoordinatorApi = Readonly<{
  readonly snapshot: <Codec extends AnyCodec>(
    ownerId: ReplicatedOwnerId,
    schema: Codec,
  ) => Effect.Effect<
    ReplicatedSnapshot<Codec>,
    Schema.SchemaError | ReplicatedOwnerUnknown,
    Schema.Codec.DecodingServices<Codec>
  >
  readonly revision: Effect.Effect<WorldRevision>
  readonly dimensionRevision: (dimension: Dimension) => Effect.Effect<DimensionRevision>
  readonly commit: (
    request: WorldCommitRequest,
  ) => Effect.Effect<ReplicatedWorldDelta<PreparedOwnerChange>, WorldCommitCoordinatorError>
}>

const WorldCommitCoordinatorBase: Context.ServiceClass<
  WorldCommitCoordinator,
  '@nerima-games/mc-sim/WorldCommitCoordinator',
  WorldCommitCoordinatorApi
> = Context.Service<WorldCommitCoordinator, WorldCommitCoordinatorApi>()(
  '@nerima-games/mc-sim/WorldCommitCoordinator',
)

export class WorldCommitCoordinator extends WorldCommitCoordinatorBase {}

export type WorldCommitCoordinatorOptions = Readonly<{
  world: WorldId
  owners: ReadonlyArray<ReplicatedOwnerRegistration>
  dimensions?: ReadonlyArray<Dimension>
}>

const makeWorldRevision = Brand.nominal<WorldRevision>()
const makeDimensionRevision = Brand.nominal<DimensionRevision>()
const defaultDimensions: ReadonlyArray<Dimension> = DIMENSIONS

const repeatedOwnerId = (changes: ReadonlyArray<ReplicatedOwnerCandidate>): ReplicatedOwnerId | undefined => {
  const seen = new Set<ReplicatedOwnerId>()
  for (const change of changes) {
    if (seen.has(change.ownerId)) return change.ownerId
    seen.add(change.ownerId)
  }
  return undefined
}

const prepareInitialOwner = (registration: ReplicatedOwnerRegistration) =>
  Effect.flatMap(Schema.decodeUnknownEffect(registration.schema)(registration.initialState), (decoded) =>
    Effect.map(Schema.encodeUnknownEffect(registration.schema)(decoded), () => [registration.ownerId, decoded] as const),
  )

const prepareCandidate = (
  candidate: ReplicatedOwnerCandidate,
  registry: OwnerRegistry,
): Effect.Effect<PreparedOwnerChange, Schema.SchemaError | ReplicatedOwnerUnknown> => {
  const schema = registry.get(candidate.ownerId)
  if (schema === undefined) return Effect.fail(new ReplicatedOwnerUnknown({ ownerId: candidate.ownerId }))
  return Effect.flatMap(Schema.decodeUnknownEffect(schema)(candidate.state), (state) =>
    Effect.map(Schema.encodeUnknownEffect(schema)(state), () => ({ owner: candidate.ownerId, state })),
  )
}

export const makeWorldCommitCoordinator = (
  options: WorldCommitCoordinatorOptions,
): Effect.Effect<WorldCommitCoordinatorApi, WorldCommitCoordinatorError> =>
  Effect.gen(function* () {
    const decodedOptions = yield* Schema.decodeUnknownEffect(WorldCommitCoordinatorOptionsSchema)(options)
    const registrations: Array<ReplicatedOwnerRegistration> = []
    for (const registration of decodedOptions.owners) {
      if (!isAnyCodec(registration.schema)) {
        return yield* Effect.fail({ _tag: 'WorldCommitCoordinatorInvalidOptions' as const, value: options })
      }
      registrations.push({
        ownerId: registration.ownerId,
        schema: registration.schema,
        initialState: registration.initialState,
      })
    }

    const world = decodedOptions.world
    const initialRevision = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
    const initialDimensionRevision = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(0)
    const ownerIds = new Set<ReplicatedOwnerId>()
    for (const registration of registrations) {
      if (ownerIds.has(registration.ownerId)) {
        return yield* Effect.fail(new ReplicatedOwnerDuplicate({ ownerId: registration.ownerId }))
      }
      ownerIds.add(registration.ownerId)
    }

    const preparedOwners = yield* Effect.forEach(registrations, prepareInitialOwner)
    const registry = new Map<ReplicatedOwnerId, AnyCodec>()
    for (const registration of registrations) registry.set(registration.ownerId, registration.schema)

    const dimensions = decodedOptions.dimensions ?? defaultDimensions
    const dimensionRevisions = new Map<Dimension, DimensionRevision>()
    for (const dimension of dimensions) dimensionRevisions.set(dimension, initialDimensionRevision)

    const owners = new Map<ReplicatedOwnerId, unknown>(preparedOwners)
    const committed = yield* Ref.make<CoordinatorState>({
      world,
      revision: initialRevision,
      dimensionRevisions,
      owners,
    })

    const snapshot: WorldCommitCoordinatorApi['snapshot'] = (ownerId, schema) =>
      Effect.gen(function* () {
        const decodedOwnerId = yield* Schema.decodeUnknownEffect(ReplicatedOwnerIdSchema)(ownerId)
        const current = yield* Ref.get(committed)
        const state = current.owners.get(decodedOwnerId)
        if (state === undefined) {
          return yield* Effect.fail(new ReplicatedOwnerUnknown({ ownerId: decodedOwnerId }))
        }
        const decoded = yield* Schema.decodeUnknownEffect(schema)(state)
        return {
          world: current.world,
          revision: current.revision,
          state: decoded,
        }
      })

    const commit: WorldCommitCoordinatorApi['commit'] = (request) =>
      Effect.flatMap(
        Schema.decodeUnknownEffect(WorldCommitRequestSchema)(request),
        ({ expectedRevision, expectedDimensions, changes }): Effect.Effect<
          ReplicatedWorldDelta<PreparedOwnerChange>,
          WorldCommitCoordinatorError
        > => {
          const duplicate = repeatedOwnerId(changes)
          if (duplicate !== undefined) return Effect.fail(new ReplicatedOwnerDuplicate({ ownerId: duplicate }))

          return Effect.flatMap(
            Effect.forEach(changes, (candidate) => prepareCandidate(candidate, registry)),
            (preparedChanges) =>
              Effect.uninterruptible(
                Effect.flatMap(
                  Ref.modify(committed, (current): readonly [CommitDecision, CoordinatorState] => {
                    if (current.revision !== expectedRevision) {
                      return [
                        {
                          _tag: 'Rejected',
                          error: new WorldRevisionConflict({
                            expected: expectedRevision,
                            actual: current.revision,
                          }),
                        },
                        current,
                      ]
                    }

                    for (const expectation of expectedDimensions) {
                      const actual = current.dimensionRevisions.get(expectation.dimension) ?? makeDimensionRevision(0)
                      if (actual !== expectation.expectedRevision) {
                        return [
                          {
                            _tag: 'Rejected',
                            error: new DimensionRevisionConflict({
                              dimension: expectation.dimension,
                              expected: expectation.expectedRevision,
                              actual,
                            }),
                          },
                          current,
                        ]
                      }
                    }

                    const revision = makeWorldRevision(current.revision + 1)
                    const nextDimensionRevisions = new Map(current.dimensionRevisions)
                    const dimensionsToIncrement = new Set(expectedDimensions.map(({ dimension }) => dimension))
                    for (const dimension of dimensionsToIncrement) {
                      const actual = nextDimensionRevisions.get(dimension) ?? makeDimensionRevision(0)
                      nextDimensionRevisions.set(dimension, makeDimensionRevision(actual + 1))
                    }
                    const nextOwners = new Map(current.owners)
                    for (const change of preparedChanges) nextOwners.set(change.owner, change.state)
                    const delta: ReplicatedWorldDelta<PreparedOwnerChange> = {
                      world: current.world,
                      revision,
                      changes: preparedChanges,
                    }
                    return [
                      { _tag: 'Committed', delta },
                      {
                        world: current.world,
                        revision,
                        dimensionRevisions: nextDimensionRevisions,
                        owners: nextOwners,
                      },
                    ]
                  }),
                  (decision) => decision._tag === 'Committed'
                    ? Effect.succeed(decision.delta)
                    : Effect.fail(decision.error),
                ),
              ),
          )
        },
      )

    return {
      snapshot,
      revision: Effect.map(Ref.get(committed), (current) => current.revision),
      dimensionRevision: (dimension) =>
        Effect.map(Ref.get(committed), (current) => current.dimensionRevisions.get(dimension) ?? initialDimensionRevision),
      commit,
    }
  })

export const WorldCommitCoordinatorLayer = (
  options: WorldCommitCoordinatorOptions,
): Layer.Layer<WorldCommitCoordinator, WorldCommitCoordinatorError> =>
  Layer.effect(WorldCommitCoordinator, makeWorldCommitCoordinator(options))
