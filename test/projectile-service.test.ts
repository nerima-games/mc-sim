import { describe, expect, it } from '@effect/vitest'
import {
  AngleRadians,
  BlockAddressSchema,
  DeltaTimeSecs,
  DimensionRevisionSchema,
  EntityIdSchema,
  PositionAxis,
  ProjectileIdSchema,
  SimulationTickSchema,
  WorldIdSchema,
  WorldRevisionSchema,
  position,
} from '@nerima-games/mc-kernel'
import * as Physics from '@nerima-games/mc-physics'
import { Effect, Layer, Ref, Schema, Stream } from 'effect'
import {
  type DomainEvent,
  type DomainEventBusApi,
  DomainEventBus,
} from '../src/application/domain-event-bus.js'
import {
  makeWorldCommitCoordinator,
  WorldCommitCoordinator,
  WorldRevisionConflict,
} from '../src/application/world-commit-coordinator.js'
import {
  INITIAL_PROJECTILE_SERVICE_SNAPSHOT,
  PROJECTILE_REPLICATED_OWNER_ID,
  ProjectileServiceSnapshotSchema,
  makeProjectileService,
  type ProjectileLaunchRequest,
} from '../src/application/projectile-service.js'

const revisionZero = Schema.decodeUnknownSync(WorldRevisionSchema)(0)
const revisionOne = Schema.decodeUnknownSync(WorldRevisionSchema)(1)
const revisionTwo = Schema.decodeUnknownSync(WorldRevisionSchema)(2)
const dimensionRevisionZero = Schema.decodeUnknownSync(DimensionRevisionSchema)(0)
const dimensionRevisionOne = Schema.decodeUnknownSync(DimensionRevisionSchema)(1)
const dimensionRevisionTwo = Schema.decodeUnknownSync(DimensionRevisionSchema)(2)
const tickZero = Schema.decodeUnknownSync(SimulationTickSchema)(0)
const shooter = Schema.decodeUnknownSync(EntityIdSchema)('shooter')
const target = Schema.decodeUnknownSync(EntityIdSchema)('target')
const projectileId = Schema.decodeUnknownSync(ProjectileIdSchema)('pearl')
const arrowId = Schema.decodeUnknownSync(ProjectileIdSchema)('arrow')
const worldBounds: Physics.AABB = {
  minX: PositionAxis(-100),
  minY: PositionAxis(-100),
  minZ: PositionAxis(-100),
  maxX: PositionAxis(100),
  maxY: PositionAxis(100),
  maxZ: PositionAxis(100),
}

const emptyWorld: Physics.ProjectileWorld = {
  blockBounds: () => [],
  bounds: worldBounds,
  entities: [],
  isInWater: () => false,
}

const targetWorld: Physics.ProjectileWorld = {
  ...emptyWorld,
  entities: [{
    id: target,
    bounds: {
      minX: PositionAxis(-1),
      minY: PositionAxis(-1),
      minZ: PositionAxis(-2),
      maxX: PositionAxis(1),
      maxY: PositionAxis(1),
      maxZ: PositionAxis(-1),
    },
  }],
}

const blockWorld: Physics.ProjectileWorld = {
  ...emptyWorld,
  blockBounds: () => [{
    minX: PositionAxis(-1),
    minY: PositionAxis(-1),
    minZ: PositionAxis(-2),
    maxX: PositionAxis(1),
    maxY: PositionAxis(1),
    maxZ: PositionAxis(-1),
  }],
}

const positionAtOrigin = position(PositionAxis(0), PositionAxis(0), PositionAxis(0))

const launchRequest = (
  overrides: Partial<ProjectileLaunchRequest> = {},
): ProjectileLaunchRequest => ({
  projectileId,
  dimension: 'overworld',
  shooter,
  tick: tickZero,
  expectedRevision: revisionZero,
  expectedDimensionRevision: dimensionRevisionZero,
  kind: 'ender-pearl',
  position: positionAtOrigin,
  yawRadians: AngleRadians(0),
  pitchRadians: AngleRadians(0),
  speed: Physics.BlocksPerSecond(30),
  profile: Physics.SNOWBALL_PROFILE,
  ...overrides,
})

const fixture = () =>
  Effect.gen(function* () {
    const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('projectile-world')
    const coordinator = yield* makeWorldCommitCoordinator({
      world,
      owners: [{
        ownerId: PROJECTILE_REPLICATED_OWNER_ID,
        schema: ProjectileServiceSnapshotSchema,
        initialState: INITIAL_PROJECTILE_SERVICE_SNAPSHOT,
      }],
    })
    const published = yield* Ref.make<
      ReadonlyArray<Readonly<{ event: DomainEvent; revision: number }>>
    >([])
    const eventBus: DomainEventBusApi = {
      publish: (event) =>
        Effect.flatMap(coordinator.revision, (revision) =>
          Ref.update(published, (current) => [...current, { event, revision }]),
        ),
      events: Stream.empty,
    }
    const service = yield* Effect.provide(
      makeProjectileService(),
      Layer.mergeAll(
        Layer.succeed(WorldCommitCoordinator, coordinator),
        Layer.succeed(DomainEventBus, eventBus),
      ),
    )
    return { coordinator, published, service }
  })

describe('ProjectileService', () => {
  it.effect('commits launch before publish and returns a typed Ender Pearl impact outcome', () =>
    Effect.gen(function* () {
      const { coordinator, published, service } = yield* fixture()
      const launched = yield* service.launch(launchRequest())

      expect(launched.projectile.state).toBe('flying')
      expect(launched.revision).toBe(revisionOne)
      expect(yield* Ref.get(published)).toHaveLength(1)
      expect((yield* Ref.get(published))[0]?.revision).toBe(revisionOne)
      expect((yield* Ref.get(published))[0]?.event._tag).toBe('ProjectileLaunched')
      expect((yield* service.snapshot).state.projectiles).toHaveLength(1)

      const noHit = yield* service.step({
        projectileId,
        tick: tickZero,
        expectedRevision: revisionOne,
        expectedDimensionRevision: dimensionRevisionOne,
        deltaTime: DeltaTimeSecs(0.01),
        world: emptyWorld,
        blockAddressOfHit: () => undefined,
      })
      expect(noHit.hit).toBeUndefined()
      expect(yield* Ref.get(published)).toHaveLength(1)

      const impact = yield* service.step({
        projectileId,
        tick: tickZero,
        expectedRevision: revisionTwo,
        expectedDimensionRevision: dimensionRevisionTwo,
        deltaTime: DeltaTimeSecs(0.1),
        world: targetWorld,
        blockAddressOfHit: () => undefined,
      })
      expect(impact.hit?.kind).toBe('entity')
      expect(impact.enderPearlImpact).toBeDefined()
      expect((yield* Ref.get(published)).map(({ event }) => event._tag)).toStrictEqual([
        'ProjectileLaunched',
        'ProjectileImpacted',
      ])
      expect((yield* Ref.get(published))[1]?.revision).toBe(
        Schema.decodeUnknownSync(WorldRevisionSchema)(3),
      )
      if (impact.hit !== undefined && impact.enderPearlImpact !== undefined) {
        expect(impact.enderPearlImpact.actor).toBe(shooter)
        expect(impact.enderPearlImpact.destination).toStrictEqual({
          dimension: 'overworld',
          ...impact.hit.point,
        })
        expect(impact.enderPearlImpact.hit).toStrictEqual(impact.hit)
        if (impact.hit.kind === 'entity') expect(impact.hit.entityId).toBe(target)
      }
      expect((yield* coordinator.revision)).toBe(Schema.decodeUnknownSync(WorldRevisionSchema)(3))
    }),
  )

  it.effect('leaves owner state and published events unchanged when launch or impact commit is rejected', () =>
    Effect.gen(function* () {
      const { published, service } = yield* fixture()
      const launchFailure = yield* Effect.result(service.launch(
        launchRequest({ expectedRevision: revisionOne }),
      ))

      expect(launchFailure._tag).toBe('Failure')
      if (launchFailure._tag === 'Failure') {
        expect(launchFailure.failure).toBeInstanceOf(WorldRevisionConflict)
      }
      expect((yield* service.snapshot).state).toStrictEqual(INITIAL_PROJECTILE_SERVICE_SNAPSHOT)
      expect(yield* Ref.get(published)).toHaveLength(0)

      yield* service.launch(launchRequest({
        projectileId: arrowId,
        kind: 'projectile',
      }))
      const beforeStep = yield* service.snapshot
      const publishedBeforeStep = yield* Ref.get(published)
      const impactFailure = yield* Effect.result(service.step({
        projectileId: arrowId,
        tick: tickZero,
        expectedRevision: revisionZero,
        expectedDimensionRevision: dimensionRevisionZero,
        deltaTime: DeltaTimeSecs(0.1),
        world: targetWorld,
        blockAddressOfHit: () => undefined,
      }))

      expect(impactFailure._tag).toBe('Failure')
      if (impactFailure._tag === 'Failure') {
        expect(impactFailure.failure).toBeInstanceOf(WorldRevisionConflict)
      }
      expect((yield* service.snapshot).state).toStrictEqual(beforeStep.state)
      expect(yield* Ref.get(published)).toStrictEqual(publishedBeforeStep)
    }),
  )

  it.effect('publishes the resolver-supplied block address for a block impact', () =>
    Effect.gen(function* () {
      const { published, service } = yield* fixture()
      const address = Schema.decodeUnknownSync(BlockAddressSchema)({
        dimension: 'overworld',
        position: { x: 0, y: 0, z: -2 },
      })
      yield* service.launch(launchRequest({
        projectileId: arrowId,
        kind: 'projectile',
      }))
      const impact = yield* service.step({
        projectileId: arrowId,
        tick: tickZero,
        expectedRevision: revisionOne,
        expectedDimensionRevision: dimensionRevisionOne,
        deltaTime: DeltaTimeSecs(0.1),
        world: blockWorld,
        blockAddressOfHit: () => address,
      })

      expect(impact.hit?.kind).toBe('block')
      expect((yield* Ref.get(published)).map(({ event }) => event._tag)).toStrictEqual([
        'ProjectileLaunched',
        'ProjectileImpacted',
      ])
      const event = (yield* Ref.get(published))[1]?.event
      expect(event?._tag).toBe('ProjectileImpacted')
      if (event?._tag === 'ProjectileImpacted') {
        expect(event.hit).toStrictEqual({ _tag: 'Block', address })
      }
    }),
  )
  it.effect('rejects a duplicate projectile id without another commit or event', () =>
    Effect.gen(function* () {
      const { published, service } = yield* fixture()
      yield* service.launch(launchRequest())
      const stateBefore = yield* service.snapshot
      const eventsBefore = yield* Ref.get(published)

      const duplicate = yield* Effect.result(service.launch(launchRequest({
        expectedRevision: revisionOne,
      })))

      expect(duplicate._tag).toBe('Failure')
      if (duplicate._tag === 'Failure') {
        expect(duplicate.failure).toMatchObject({ reason: 'projectile-id-already-exists' })
      }
      expect((yield* service.snapshot).state).toStrictEqual(stateBefore.state)
      expect(yield* Ref.get(published)).toStrictEqual(eventsBefore)
    }),
  )

  it.effect('rejects a negative public launch speed without committing or publishing', () =>
    Effect.gen(function* () {
      const { published, service } = yield* fixture()
      const invalidLaunch = yield* Effect.result(service.launch(launchRequest({
        speed: Physics.BlocksPerSecond(-1),
      })))

      expect(invalidLaunch._tag).toBe('Failure')
      if (invalidLaunch._tag === 'Failure') {
        expect(invalidLaunch.failure).toMatchObject({ reason: 'invalid-launch' })
      }
      expect((yield* service.snapshot).state).toStrictEqual(INITIAL_PROJECTILE_SERVICE_SNAPSHOT)
      expect(yield* Ref.get(published)).toHaveLength(0)
    }),
  )

  it.effect('rejects a step for an unknown projectile without committing or publishing', () =>
    Effect.gen(function* () {
      const { coordinator, published, service } = yield* fixture()
      const unknownStep = yield* Effect.result(service.step({
        projectileId: arrowId,
        tick: tickZero,
        expectedRevision: revisionZero,
        expectedDimensionRevision: dimensionRevisionZero,
        deltaTime: DeltaTimeSecs(0.1),
        world: emptyWorld,
        blockAddressOfHit: () => undefined,
      }))

      expect(unknownStep._tag).toBe('Failure')
      if (unknownStep._tag === 'Failure') {
        expect(unknownStep.failure).toMatchObject({ reason: 'unknown-projectile' })
      }
      expect((yield* service.snapshot).state).toStrictEqual(INITIAL_PROJECTILE_SERVICE_SNAPSHOT)
      expect(yield* Ref.get(published)).toHaveLength(0)
      expect(yield* coordinator.revision).toBe(revisionZero)
    }),
  )

  it.effect('rejects an invalid step duration without committing or publishing', () =>
    Effect.gen(function* () {
      const { coordinator, published, service } = yield* fixture()
      yield* service.launch(launchRequest())
      const before = yield* service.snapshot
      const publishedBefore = yield* Ref.get(published)
      const invalidRequest = {
        projectileId,
        tick: tickZero,
        expectedRevision: revisionOne,
        expectedDimensionRevision: dimensionRevisionOne,
        deltaTime: DeltaTimeSecs(0.1),
        world: emptyWorld,
        blockAddressOfHit: () => undefined,
      }
      Reflect.set(invalidRequest, 'deltaTime', Number.NaN)
      const invalidStep = yield* Effect.result(service.step(invalidRequest))

      expect(invalidStep._tag).toBe('Failure')
      if (invalidStep._tag === 'Failure') {
        expect(invalidStep.failure).toMatchObject({ reason: 'invalid-step-duration' })
      }
      expect((yield* service.snapshot).state).toStrictEqual(before.state)
      expect(yield* Ref.get(published)).toStrictEqual(publishedBefore)
      expect(yield* coordinator.revision).toBe(revisionOne)
    }),
  )

  it.effect('rejects invalid physics output without committing or publishing', () =>
    Effect.gen(function* () {
      const { coordinator, published, service } = yield* fixture()
      const invalidProfile = {
        ...Physics.SNOWBALL_PROFILE,
        gravity: Physics.BlocksPerSecondSquared(Number.MAX_VALUE),
      }
      yield* service.launch(launchRequest({ kind: 'projectile', profile: invalidProfile }))
      const before = yield* service.snapshot
      const publishedBefore = yield* Ref.get(published)
      const invalidPhysics = yield* Effect.result(service.step({
        projectileId,
        tick: tickZero,
        expectedRevision: revisionOne,
        expectedDimensionRevision: dimensionRevisionOne,
        deltaTime: DeltaTimeSecs(2),
        world: emptyWorld,
        blockAddressOfHit: () => undefined,
      }))

      expect(invalidPhysics._tag).toBe('Failure')
      if (invalidPhysics._tag === 'Failure') {
        expect(invalidPhysics.failure).toMatchObject({ reason: 'invalid-physics-result' })
      }
      expect((yield* service.snapshot).state).toStrictEqual(before.state)
      expect(yield* Ref.get(published)).toStrictEqual(publishedBefore)
      expect(yield* coordinator.revision).toBe(revisionOne)
    }),
  )

  it.effect('steps only the selected projectile when the owner contains multiple projectiles', () =>
    Effect.gen(function* () {
      const { service } = yield* fixture()
      yield* service.launch(launchRequest())
      yield* service.launch(launchRequest({
        projectileId: arrowId,
        kind: 'projectile',
        expectedRevision: revisionOne,
        expectedDimensionRevision: dimensionRevisionOne,
      }))
      const before = yield* service.snapshot
      const pearlBefore = before.state.projectiles.find(({ id }) => id === projectileId)
      expect(pearlBefore).toBeDefined()

      const stepped = yield* service.step({
        projectileId: arrowId,
        tick: tickZero,
        expectedRevision: revisionTwo,
        expectedDimensionRevision: dimensionRevisionTwo,
        deltaTime: DeltaTimeSecs(0.1),
        world: emptyWorld,
        blockAddressOfHit: () => undefined,
      })
      const after = yield* service.snapshot

      expect(after.state.projectiles).toHaveLength(2)
      expect(after.state.projectiles.find(({ id }) => id === arrowId)?.projectile).toStrictEqual(
        stepped.projectile,
      )
      expect(after.state.projectiles.find(({ id }) => id === projectileId)).toStrictEqual(pearlBefore)
      expect(stepped.hit).toBeUndefined()
    }),
  )

  it.effect('leaves state and events unchanged when a block impact has no address', () =>
    Effect.gen(function* () {
      const { coordinator, published, service } = yield* fixture()
      yield* service.launch(launchRequest({ projectileId: arrowId, kind: 'projectile' }))
      const before = yield* service.snapshot
      const eventsBefore = yield* Ref.get(published)
      const impact = yield* Effect.result(service.step({
        projectileId: arrowId,
        tick: tickZero,
        expectedRevision: revisionOne,
        expectedDimensionRevision: dimensionRevisionOne,
        deltaTime: DeltaTimeSecs(0.1),
        world: blockWorld,
        blockAddressOfHit: () => undefined,
      }))

      expect(impact._tag).toBe('Failure')
      if (impact._tag === 'Failure') {
        expect(impact.failure).toMatchObject({ reason: 'block-address-unavailable' })
      }
      expect((yield* service.snapshot).state).toStrictEqual(before.state)
      expect(yield* Ref.get(published)).toStrictEqual(eventsBefore)
      expect(yield* coordinator.revision).toBe(revisionOne)
    }),
  )

  it.effect('leaves state and events unchanged when a block address belongs to another dimension', () =>
    Effect.gen(function* () {
      const { coordinator, published, service } = yield* fixture()
      yield* service.launch(launchRequest({ projectileId: arrowId, kind: 'projectile' }))
      const before = yield* service.snapshot
      const eventsBefore = yield* Ref.get(published)
      const wrongDimensionAddress = Schema.decodeUnknownSync(BlockAddressSchema)({
        dimension: 'nether',
        position: { x: 0, y: 0, z: -2 },
      })
      const impact = yield* Effect.result(service.step({
        projectileId: arrowId,
        tick: tickZero,
        expectedRevision: revisionOne,
        expectedDimensionRevision: dimensionRevisionOne,
        deltaTime: DeltaTimeSecs(0.1),
        world: blockWorld,
        blockAddressOfHit: () => wrongDimensionAddress,
      }))

      expect(impact._tag).toBe('Failure')
      if (impact._tag === 'Failure') {
        expect(impact.failure).toMatchObject({ reason: 'block-address-dimension-mismatch' })
      }
      expect((yield* service.snapshot).state).toStrictEqual(before.state)
      expect(yield* Ref.get(published)).toStrictEqual(eventsBefore)
      expect(yield* coordinator.revision).toBe(revisionOne)
    }),
  )
})
