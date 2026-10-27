import {
  BlockAddressSchema,
  DIMENSIONS,
  DimensionIdSchema,
  DeltaTimeSecs,
  DomainEventSchema,
  EntityIdSchema,
  ProjectileIdSchema,
  SimulationTickSchema,
  Velocity3Schema,
  WorldPositionSchema,
  type AngleRadians,
  type BlockAddress,
  type Dimension,
  type DimensionRevision,
  type EntityId,
  type ProjectileId,
  type SimulationTick,
  type WorldPosition,
  type WorldRevision,
} from '@nerima-games/mc-kernel'
import * as Physics from '@nerima-games/mc-physics'
import { Context, Effect, Layer, Result, Schema } from 'effect'
import type { YieldableError } from 'effect/Cause'
import {
  WorldCommitCoordinator,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'
import {
  makeReplicatedOwnerId,
  type ReplicatedOwnerId,
  type ReplicatedSnapshot,
} from './replicated-state.js'
import { DomainEventBus } from './domain-event-bus.js'

const PositionAxisSchema = Schema.Finite.pipe(Schema.brand('PositionAxis'))
const FixedDurationSecsSchema = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand('FixedDurationSecs'),
)
const BlocksPerSecondSchema = Schema.Finite.pipe(Schema.brand('BlocksPerSecond'))

const PhysicsPositionSchema = Schema.Struct({
  x: PositionAxisSchema,
  y: PositionAxisSchema,
  z: PositionAxisSchema,
})

const PhysicsVelocitySchema = Schema.Struct({
  x: BlocksPerSecondSchema,
  y: BlocksPerSecondSchema,
  z: BlocksPerSecondSchema,
})

const ProjectileHitSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literals(['block']),
    point: PhysicsPositionSchema,
    normal: PhysicsPositionSchema,
    flightTimeSeconds: FixedDurationSecsSchema,
  }),
  Schema.Struct({
    kind: Schema.Literals(['entity']),
    entityId: EntityIdSchema,
    point: PhysicsPositionSchema,
    normal: PhysicsPositionSchema,
    flightTimeSeconds: FixedDurationSecsSchema,
  }),
])

const ProjectileSchema: Schema.Codec<Physics.Projectile, unknown> = Schema.Union([
  Schema.Struct({
    position: PhysicsPositionSchema,
    velocity: PhysicsVelocitySchema,
    ageSeconds: FixedDurationSecsSchema,
    shooterId: Schema.optionalKey(EntityIdSchema),
    state: Schema.Literals(['flying']),
  }),
  Schema.Struct({
    position: PhysicsPositionSchema,
    velocity: PhysicsVelocitySchema,
    ageSeconds: FixedDurationSecsSchema,
    shooterId: Schema.optionalKey(EntityIdSchema),
    state: Schema.Literals(['stuck']),
    hit: ProjectileHitSchema,
    recoverable: Schema.Boolean,
  }),
  Schema.Struct({
    position: PhysicsPositionSchema,
    velocity: PhysicsVelocitySchema,
    ageSeconds: FixedDurationSecsSchema,
    shooterId: Schema.optionalKey(EntityIdSchema),
    state: Schema.Literals(['despawned']),
    reason: Schema.Literals(['invalid', 'lifetime', 'world', 'entity-hit']),
  }),
])

const ProjectileProfileSchema: Schema.Codec<Physics.ProjectileProfile, unknown> = Schema.Struct({
  gravity: Schema.Finite.pipe(Schema.brand('BlocksPerSecondSquared')),
  airDrag: Schema.Finite,
  waterDrag: Schema.Finite,
  maxLifetimeSeconds: FixedDurationSecsSchema,
  shooterGraceSeconds: FixedDurationSecsSchema,
})

const ProjectileDimensionSchema: Schema.Codec<Dimension, unknown> = Schema.Literals(DIMENSIONS)
const ProjectileKindSchema: Schema.Codec<'projectile' | 'ender-pearl', unknown> = Schema.Literals(['projectile', 'ender-pearl'])
type ProjectileRecordFields = Readonly<{
  id: typeof ProjectileIdSchema
  dimension: typeof ProjectileDimensionSchema
  shooter: typeof EntityIdSchema
  kind: typeof ProjectileKindSchema
  profile: typeof ProjectileProfileSchema
  projectile: typeof ProjectileSchema
}>
const ProjectileRecordSchema: Schema.Struct<ProjectileRecordFields> = Schema.Struct({
  id: ProjectileIdSchema,
  dimension: ProjectileDimensionSchema,
  shooter: EntityIdSchema,
  kind: ProjectileKindSchema,
  profile: ProjectileProfileSchema,
  projectile: ProjectileSchema,
})

export type ProjectileRecord = Schema.Schema.Type<typeof ProjectileRecordSchema>

export type ProjectileServiceSnapshot = Readonly<{
  projectiles: ReadonlyArray<ProjectileRecord>
}>

export const ProjectileServiceSnapshotSchema: Schema.Codec<
  ProjectileServiceSnapshot,
  Readonly<{ projectiles: ReadonlyArray<Schema.Codec.Encoded<typeof ProjectileRecordSchema>> }>
> = Schema.Struct({
  projectiles: Schema.Array(ProjectileRecordSchema),
})

export const PROJECTILE_REPLICATED_OWNER_ID: ReplicatedOwnerId = makeReplicatedOwnerId('projectile')

export const INITIAL_PROJECTILE_SERVICE_SNAPSHOT: ProjectileServiceSnapshot = {
  projectiles: [],
}

type ProjectileServiceFailureReason =
  | 'projectile-id-already-exists'
  | 'unknown-projectile'
  | 'invalid-launch'
  | 'invalid-step-duration'
  | 'invalid-physics-result'
  | 'block-address-unavailable'
  | 'block-address-dimension-mismatch'

type ProjectileServiceFailureFields = Readonly<{
  reason: ProjectileServiceFailureReason
}>

const ProjectileServiceFailureBase: new (
  args: ProjectileServiceFailureFields,
) => YieldableError & { readonly _tag: 'ProjectileServiceFailure' } & ProjectileServiceFailureFields =
  Schema.TaggedError<ProjectileServiceFailure>()('ProjectileServiceFailure', {
    reason: Schema.Literals([
      'projectile-id-already-exists',
      'unknown-projectile',
      'invalid-launch',
      'invalid-step-duration',
      'invalid-physics-result',
      'block-address-unavailable',
      'block-address-dimension-mismatch',
    ]),
  })

export class ProjectileServiceFailure extends ProjectileServiceFailureBase {}

export type ProjectileLaunchRequest = Readonly<{
  projectileId: ProjectileId
  dimension: Dimension
  shooter: EntityId
  tick: SimulationTick
  expectedRevision: WorldRevision
  expectedDimensionRevision: DimensionRevision
  kind: 'projectile' | 'ender-pearl'
  position: Physics.Position
  yawRadians: AngleRadians
  pitchRadians: AngleRadians
  speed: Physics.BlocksPerSecond
  profile: Physics.ProjectileProfile
}>

export type ProjectileLaunchOutcome = Readonly<{
  projectile: Physics.Projectile
  revision: WorldRevision
}>

export type ProjectileBlockHit = Extract<Physics.ProjectileHit, { kind: 'block' }>

export type ProjectileStepRequest = Readonly<{
  projectileId: ProjectileId
  tick: SimulationTick
  expectedRevision: WorldRevision
  expectedDimensionRevision: DimensionRevision
  deltaTime: Physics.DeltaTimeSecs
  world: Physics.ProjectileWorld
  blockAddressOfHit: (hit: ProjectileBlockHit) => BlockAddress | undefined
}>

export type EnderPearlImpact = Readonly<{
  actor: EntityId
  destination: WorldPosition
  hit: Physics.ProjectileHit
}>

export type ProjectileStepOutcome = Readonly<{
  projectile: Physics.Projectile
  hit?: Physics.ProjectileHit
  enderPearlImpact?: EnderPearlImpact
  revision: WorldRevision
}>

export type ProjectileServiceError =
  | Schema.SchemaError
  | ProjectileServiceFailure
  | WorldCommitCoordinatorError

export type ProjectileServiceApi = Readonly<{
  readonly snapshot: Effect.Effect<
    ReplicatedSnapshot<typeof ProjectileServiceSnapshotSchema>,
    Schema.SchemaError | WorldCommitCoordinatorError
  >
  readonly launch: (
    request: ProjectileLaunchRequest,
  ) => Effect.Effect<ProjectileLaunchOutcome, ProjectileServiceError>
  readonly step: (
    request: ProjectileStepRequest,
  ) => Effect.Effect<ProjectileStepOutcome, ProjectileServiceError>
}>

const worldPositionOf = (dimension: Dimension, position: Physics.Position) =>
  Effect.flatMap(Schema.decodeUnknownEffect(DimensionIdSchema)(dimension), (dimensionId) =>
    Schema.decodeUnknownEffect(WorldPositionSchema)({
      dimension: dimensionId,
      x: position.x,
      y: position.y,
      z: position.z,
    }),
  )

export const makeProjectileService = (): Effect.Effect<
  ProjectileServiceApi,
  never,
  WorldCommitCoordinator | DomainEventBus
> =>
  Effect.gen(function* () {
    const coordinator = yield* WorldCommitCoordinator
    const eventBus = yield* DomainEventBus

    const snapshot = coordinator.snapshot(
      PROJECTILE_REPLICATED_OWNER_ID,
      ProjectileServiceSnapshotSchema,
    )

    const launch: ProjectileServiceApi['launch'] = (request) =>
      Effect.gen(function* () {
        const current = yield* coordinator.snapshot(
          PROJECTILE_REPLICATED_OWNER_ID,
          ProjectileServiceSnapshotSchema,
        )
        if (current.state.projectiles.some(({ id }) => id === request.projectileId)) {
          return yield* Effect.fail(
            new ProjectileServiceFailure({ reason: 'projectile-id-already-exists' }),
          )
        }

        const profile = yield* Schema.decodeUnknownEffect(ProjectileProfileSchema)(request.profile)
        const launched = Physics.launchProjectile({
          position: request.position,
          yawRadians: request.yawRadians,
          pitchRadians: request.pitchRadians,
          speed: request.speed,
          shooterId: request.shooter,
        })
        if (launched.state === 'despawned' && launched.reason === 'invalid') {
          return yield* Effect.fail(new ProjectileServiceFailure({ reason: 'invalid-launch' }))
        }

        const projectile = yield* Schema.decodeUnknownEffect(ProjectileSchema)(launched)
        const record = {
          id: yield* Schema.decodeUnknownEffect(ProjectileIdSchema)(request.projectileId),
          dimension: request.dimension,
          shooter: yield* Schema.decodeUnknownEffect(EntityIdSchema)(request.shooter),
          kind: request.kind,
          profile,
          projectile,
        }
        const nextState = {
          projectiles: [...current.state.projectiles, record],
        }
        const origin = yield* worldPositionOf(request.dimension, projectile.position)
        const initialVelocity = yield* Schema.decodeUnknownEffect(Velocity3Schema)(projectile.velocity)
        const event = yield* Schema.decodeUnknownEffect(DomainEventSchema)({
          _tag: 'ProjectileLaunched',
          tick: yield* Schema.decodeUnknownEffect(SimulationTickSchema)(request.tick),
          projectile: record.id,
          shooter: record.shooter,
          origin,
          initialVelocity,
        })

        const delta = yield* coordinator.commit({
          expectedRevision: request.expectedRevision,
          expectedDimensions: [{
            dimension: request.dimension,
            expectedRevision: request.expectedDimensionRevision,
          }],
          changes: [{ ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: nextState }],
        })
        yield* eventBus.publish(event)

        return { projectile, revision: delta.revision }
      })

    const step: ProjectileServiceApi['step'] = (request) =>
      Effect.gen(function* () {
        const current = yield* coordinator.snapshot(
          PROJECTILE_REPLICATED_OWNER_ID,
          ProjectileServiceSnapshotSchema,
        )
        const record = current.state.projectiles.find(({ id }) => id === request.projectileId)
        if (record === undefined) {
          return yield* Effect.fail(new ProjectileServiceFailure({ reason: 'unknown-projectile' }))
        }

        const deltaTime = DeltaTimeSecs.result(request.deltaTime)
        if (Result.isFailure(deltaTime)) {
          return yield* Effect.fail(new ProjectileServiceFailure({ reason: 'invalid-step-duration' }))
        }
        const stepped = Physics.stepProjectile(
          record.projectile,
          deltaTime.success,
          request.world,
          record.profile,
        )
        if (stepped.projectile.state === 'despawned' && stepped.projectile.reason === 'invalid') {
          return yield* Effect.fail(new ProjectileServiceFailure({ reason: 'invalid-physics-result' }))
        }
        const projectile = yield* Schema.decodeUnknownEffect(ProjectileSchema)(stepped.projectile)
        const nextState = {
          projectiles: current.state.projectiles.map((entry) =>
            entry.id === record.id ? { ...entry, projectile } : entry,
          ),
        }

        let event: Schema.Schema.Type<typeof DomainEventSchema> | undefined
        let enderPearlImpact: EnderPearlImpact | undefined
        if (stepped.hit !== undefined) {
          const position = yield* worldPositionOf(record.dimension, stepped.hit.point)
          let hit:
            | Readonly<{ _tag: 'Entity'; entity: EntityId }>
            | Readonly<{ _tag: 'Block'; address: BlockAddress }>
            | undefined
          if (stepped.hit.kind === 'entity') {
            hit = { _tag: 'Entity', entity: stepped.hit.entityId }
          } else {
            const resolved = request.blockAddressOfHit(stepped.hit)
            if (resolved === undefined) {
              return yield* Effect.fail(
                new ProjectileServiceFailure({ reason: 'block-address-unavailable' }),
              )
            }
            const address = yield* Schema.decodeUnknownEffect(BlockAddressSchema)(resolved)
            if (address.dimension !== record.dimension) {
              return yield* Effect.fail(
                new ProjectileServiceFailure({ reason: 'block-address-dimension-mismatch' }),
              )
            }
            hit = { _tag: 'Block', address }
          }

          event = yield* Schema.decodeUnknownEffect(DomainEventSchema)({
            _tag: 'ProjectileImpacted',
            tick: yield* Schema.decodeUnknownEffect(SimulationTickSchema)(request.tick),
            projectile: record.id,
            position,
            hit,
          })
          if (record.kind === 'ender-pearl') {
            enderPearlImpact = {
              actor: record.shooter,
              destination: position,
              hit: stepped.hit,
            }
          }
        }

        const delta = yield* coordinator.commit({
          expectedRevision: request.expectedRevision,
          expectedDimensions: [{
            dimension: record.dimension,
            expectedRevision: request.expectedDimensionRevision,
          }],
          changes: [{ ownerId: PROJECTILE_REPLICATED_OWNER_ID, state: nextState }],
        })
        if (event !== undefined) yield* eventBus.publish(event)

        return {
          projectile,
          ...(stepped.hit === undefined ? {} : { hit: stepped.hit }),
          ...(enderPearlImpact === undefined ? {} : { enderPearlImpact }),
          revision: delta.revision,
        }
      })

    return { snapshot, launch, step }
  })

const ProjectileServiceBase: Context.ServiceClass<
  ProjectileService,
  '@nerima-games/mc-sim/ProjectileService',
  ProjectileServiceApi
> = Context.Service<ProjectileService, ProjectileServiceApi>()(
  '@nerima-games/mc-sim/ProjectileService',
)

export class ProjectileService extends ProjectileServiceBase {}

export const ProjectileServiceLayer: Layer.Layer<
  ProjectileService,
  never,
  WorldCommitCoordinator | DomainEventBus
> = Layer.effect(ProjectileService, makeProjectileService())
