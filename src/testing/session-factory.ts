import {
  DIMENSIONS,
  SaveSliceIdSchema,
  SaveVersionSchema,
  SimulationTick,
  WorldIdSchema,
  isItemStack,
  type Dimension,
  type SaveSliceId,
  type SaveVersion,
  type SimulationTick as SimulationTickValue,
} from '@nerima-games/mc-kernel'
import type { SaveSliceRegistration } from '@nerima-games/mc-kernel/domain/save-slices'
import type {
  SaveBundleSnapshotError,
  SaveMigrationPathAmbiguous,
  SaveMigrationPathMissing,
  SaveSliceBundleEntryMissing,
  SaveSliceNotRegistered,
} from '@nerima-games/mc-save'
import type { NoiseSeed } from '@nerima-games/mc-worldgen'
import {
  Context,
  Effect,
  Layer,
  ManagedRuntime,
  Ref,
  Result,
  Schema,
  SchemaTransformation,
} from 'effect'
import * as Camera from '../domain/camera-pose.js'
import * as Inventory from '../domain/inventory.js'
import * as PlayerStorage from '../domain/player-storage.js'
import { LegacyItemStackSchema } from '../domain/save-data.js'
import { makeCoreTick, type CoreTickOptions } from '../application/core.js'
import {
  ACHIEVEMENT_OWNER_REGISTRATION,
  AchievementServiceLayer,
} from '../application/achievement-service.js'
import {
  DomainEventBus,
  DomainEventBusLayer,
  EventSubscriberCapacitySchema,
} from '../application/domain-event-bus.js'
import { HotbarService, HotbarServiceLayer } from '../application/hotbar-service.js'
import {
  IntentQueue,
  IntentQueueCapacitySchema,
  IntentQueueLayer,
  type QueuedIntent,
} from '../application/intent-queue.js'
import { InventoryService, InventoryServiceLayer } from '../application/inventory-service.js'
import {
  INITIAL_PLAYER_DIMENSION,
  PlayerService,
  PlayerServiceLayer,
  type PlayerServiceInputError,
} from '../application/player-service.js'
import {
  PLAYER_REPLICATED_OWNER_ID,
  PlayerServiceSnapshotSchema,
} from '../application/replicated-state.js'
import { StatisticsService, StatisticsServiceLayer } from '../application/statistics-service.js'
import { TimeService, TimeServiceLayer } from '../application/time-service.js'
import {
  WorldCommitCoordinator,
  WorldCommitCoordinatorLayer,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorError,
} from '../application/world-commit-coordinator.js'
import {
  migrateSimulationSaveV3,
  type SimulationSaveV3Registrations,
} from '../application/save-v3-migration.js'

export type HeadlessSaveSlice = {
  readonly id: SaveSliceId
  readonly version: SaveVersion
  readonly schema: Schema.Codec<unknown, unknown>
  readonly snapshot: Effect.Effect<unknown>
}

export type HeadlessHarnessSession = {
  readonly close: Effect.Effect<void>
  readonly intents: IntentQueue['Service']
  readonly runTick: (
    tick: SimulationTickValue,
    ready: ReadonlyArray<QueuedIntent>,
  ) => Effect.Effect<void>
  readonly saveSlices: ReadonlyArray<HeadlessSaveSlice>
}

export type HeadlessHarnessStages = CoreTickOptions['stages']

type PlayerSliceState = Readonly<{
  dimension: Dimension
  pose: Camera.PlayerPose
}>

type SaveRestoreServiceError =
  | Inventory.ItemStackFailure
  | PlayerStorage.PlayerStorageFailure
  | PlayerServiceInputError
  | WorldCommitCoordinatorError

export type HeadlessSessionRestoreError =
  | SaveRestoreServiceError
  | Schema.SchemaError
  | SaveBundleSnapshotError
  | SaveMigrationPathAmbiguous
  | SaveMigrationPathMissing
  | SaveSliceBundleEntryMissing
  | SaveSliceNotRegistered

export type HeadlessHarnessSessionFactoryApi = {
  readonly open: (
    worldSeed: NoiseSeed,
    stages: HeadlessHarnessStages,
  ) => Effect.Effect<HeadlessHarnessSession>
  readonly openRestored?: (
    worldSeed: NoiseSeed,
    legacySave: unknown,
    stages: HeadlessHarnessStages,
  ) => Effect.Effect<HeadlessHarnessSession, HeadlessSessionRestoreError>
}

const HeadlessHarnessSessionFactoryBase: Context.ServiceClass<
  HeadlessHarnessSessionFactory,
  'mc-sim/testing/HeadlessHarnessSessionFactory',
  HeadlessHarnessSessionFactoryApi
> = Context.Service<HeadlessHarnessSessionFactory, HeadlessHarnessSessionFactoryApi>()(
  'mc-sim/testing/HeadlessHarnessSessionFactory',
)

export class HeadlessHarnessSessionFactory extends HeadlessHarnessSessionFactoryBase {}

const saveSliceId = Schema.decodeUnknownSync(SaveSliceIdSchema)
const saveVersion = Schema.decodeUnknownSync(SaveVersionSchema)
const queueCapacity = Schema.decodeUnknownSync(IntentQueueCapacitySchema)(256)
const subscriberCapacity = Schema.decodeUnknownSync(EventSubscriberCapacitySchema)(8)

const PLAYER_SAVE_SLICE_SCHEMA = Schema.Struct({
  dimension: Schema.Literals(DIMENSIONS),
  pose: Schema.Struct({
    feetPosition: Schema.Struct({
      x: Schema.Finite,
      y: Schema.Finite,
      z: Schema.Finite,
    }),
    yawRadians: Schema.Finite,
    pitchRadians: Schema.Finite,
  }),
})

const TIME_SAVE_SLICE_SCHEMA = Schema.Struct({
  ticks: Schema.Finite,
  dayLengthTicks: Schema.Finite,
})

export const encodeInventorySaveSlot = (
  value: Inventory.Slot,
): Effect.Effect<unknown, Schema.SchemaError['issue']> => {
  if (value === undefined) return Effect.succeed(null)
  return Effect.mapError(
    Schema.encodeUnknownEffect(LegacyItemStackSchema)(value),
    (error) => error.issue,
  )
}

const INVENTORY_SLOT_SCHEMA: Schema.Codec<Inventory.Slot, unknown> = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.declare(
      (value: unknown): value is Inventory.Slot => value === undefined || isItemStack(value),
    ),
    SchemaTransformation.transformEffect<Inventory.Slot, unknown>({
      decode: (value) => {
        if (value === undefined || value === null) return Effect.succeed(undefined)
        const decoded = Schema.decodeUnknownResult(LegacyItemStackSchema)(value)
        return Result.isFailure(decoded)
          ? Effect.fail(decoded.failure.issue)
          : Effect.succeed(decoded.success)
      },
      encode: (value) => encodeInventorySaveSlot(value),
    }),
  ),
)

const INVENTORY_SAVE_SLICE_SCHEMA = Schema.Struct({
  inventory: Schema.Struct({
    slots: Schema.Array(INVENTORY_SLOT_SCHEMA),
  }),
  selectedHotbarSlot: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8 })),
})

const STATISTICS_SAVE_SLICE_SCHEMA = Schema.Struct({
  counters: Schema.Record(Schema.String, Schema.Finite),
  unlocked: Schema.Array(Schema.String),
})

const PLAYER_INITIAL_STATE = Schema.decodeUnknownSync(PlayerServiceSnapshotSchema)({
  pose: {
    feetPosition: {
      dimension: INITIAL_PLAYER_DIMENSION,
      x: Camera.INITIAL_PLAYER_POSE.feetPosition.x,
      y: Camera.INITIAL_PLAYER_POSE.feetPosition.y,
      z: Camera.INITIAL_PLAYER_POSE.feetPosition.z,
    },
    yawRadians: Camera.INITIAL_PLAYER_POSE.yawRadians,
    pitchRadians: Camera.INITIAL_PLAYER_POSE.pitchRadians,
  },
})

const PLAYER_OWNER_REGISTRATION: ReplicatedOwnerRegistration<typeof PlayerServiceSnapshotSchema> = {
  ownerId: PLAYER_REPLICATED_OWNER_ID,
  schema: PlayerServiceSnapshotSchema,
  initialState: PLAYER_INITIAL_STATE,
}

const worldIdForSeed = (worldSeed: NoiseSeed): Schema.Schema.Type<typeof WorldIdSchema> =>
  Schema.decodeUnknownSync(WorldIdSchema)(`headless-world-${String(worldSeed)}`)

const worldSessionLayer = (worldId: Schema.Schema.Type<typeof WorldIdSchema>) => {
  const shared = Layer.mergeAll(
    WorldCommitCoordinatorLayer({
      world: worldId,
      owners: [PLAYER_OWNER_REGISTRATION, ACHIEVEMENT_OWNER_REGISTRATION],
    }),
    DomainEventBusLayer(subscriberCapacity),
    IntentQueueLayer({ capacity: queueCapacity }),
    InventoryServiceLayer(),
    TimeServiceLayer(),
    StatisticsServiceLayer(),
  )

  const dependent = Layer.mergeAll(
    PlayerServiceLayer(),
    HotbarServiceLayer,
    AchievementServiceLayer,
  ).pipe(Layer.provide(shared))

  return Layer.merge(shared, dependent)
}

const toHeadlessSaveSlice = (
  registration: SaveSliceRegistration<Schema.Codec<any, any>, unknown, never>,
): HeadlessSaveSlice => ({
  id: registration.id,
  version: registration.version,
  schema: registration.schema,
  snapshot: registration.snapshot,
})

const registrationsFor = (
  player: PlayerService['Service'],
  time: TimeService['Service'],
  inventory: InventoryService['Service'],
  hotbar: HotbarService['Service'],
  statistics: StatisticsService['Service'],
  coordinator: WorldCommitCoordinator['Service'],
): SimulationSaveV3Registrations<SaveRestoreServiceError, never> => ({
  player: {
    id: saveSliceId('player'),
    version: saveVersion(1),
    schema: PLAYER_SAVE_SLICE_SCHEMA,
    snapshot: Effect.orDie(
      Effect.provideService(
        Effect.gen(function* () {
          const committed = yield* player.snapshot
          const pose = committed.state.pose
          return {
            dimension: pose.feetPosition.dimension,
            pose: {
              feetPosition: {
                x: pose.feetPosition.x,
                y: pose.feetPosition.y,
                z: pose.feetPosition.z,
              },
              yawRadians: pose.yawRadians,
              pitchRadians: pose.pitchRadians,
            },
          }
        }),
        WorldCommitCoordinator,
        coordinator,
      ),
    ),
    restore: (state: PlayerSliceState) =>
      Effect.provideService(
        Effect.gen(function* () {
          const committed = yield* player.snapshot
          yield* player.restore(state.pose, state.dimension)
          const currentDimension = committed.state.pose.feetPosition.dimension
          const expectedDimensionRevision = yield* coordinator.dimensionRevision(currentDimension)
          yield* player.submitReplicatedCandidate(committed.revision, expectedDimensionRevision)
        }),
        WorldCommitCoordinator,
        coordinator,
      ),
    migrations: [],
  },
  time: {
    id: saveSliceId('time'),
    version: saveVersion(1),
    schema: TIME_SAVE_SLICE_SCHEMA,
    snapshot: time.snapshot,
    restore: time.restore,
    migrations: [],
  },
  inventory: {
    id: saveSliceId('inventory'),
    version: saveVersion(1),
    schema: INVENTORY_SAVE_SLICE_SCHEMA,
    snapshot: Effect.gen(function* () {
      return {
        inventory: yield* inventory.snapshot,
        selectedHotbarSlot: yield* hotbar.getSelectedSlot,
      }
    }),
    restore: (state) =>
      Effect.gen(function* () {
        yield* inventory.restore(state.inventory)
        yield* hotbar.setSelectedSlot(state.selectedHotbarSlot)
      }),
    migrations: [],
  },
  statistics: {
    id: saveSliceId('statistics'),
    version: saveVersion(1),
    schema: STATISTICS_SAVE_SLICE_SCHEMA,
    snapshot: statistics.snapshot,
    restore: statistics.restore,
    migrations: [],
  },
})

export const disposeOnBuildFailure = (
  dispose: Effect.Effect<void>,
): (() => Effect.Effect<void>) => () => dispose

const createSession = (
  worldSeed: NoiseSeed,
  stages: HeadlessHarnessStages,
): Effect.Effect<Readonly<{
  session: HeadlessHarnessSession
  registrations: SimulationSaveV3Registrations<SaveRestoreServiceError, never>
}>> => {
  const worldId = worldIdForSeed(worldSeed)
  const runtime = ManagedRuntime.make(worldSessionLayer(worldId))

  const build = Effect.gen(function* () {
    const context = yield* Effect.orDie(runtime.contextEffect)
    const player = Context.get(context, PlayerService)
    const time = Context.get(context, TimeService)
    const inventory = Context.get(context, InventoryService)
    const hotbar = Context.get(context, HotbarService)
    const statistics = Context.get(context, StatisticsService)
    const coordinator = Context.get(context, WorldCommitCoordinator)
    const eventBus = Context.get(context, DomainEventBus)
    const intents = Context.get(context, IntentQueue)
    const registrations = registrationsFor(
      player,
      time,
      inventory,
      hotbar,
      statistics,
      coordinator,
    )
    const core = yield* Effect.orDie(makeCoreTick({
      coordinator,
      publish: eventBus.publish,
      stages,
      initialTick: SimulationTick(0),
    }))
    const closed = yield* Ref.make(false)
    const close = Effect.flatMap(
      Ref.modify(closed, (current): readonly [boolean, boolean] =>
        current ? [false, true] : [true, true],
      ),
      (shouldClose) => shouldClose ? runtime.disposeEffect : Effect.void,
    )
    const session: HeadlessHarnessSession = {
      close,
      intents,
      runTick: (tick, ready) => Effect.orDie(core.runTick(tick, ready)),
      saveSlices: [
        registrations.player,
        registrations.time,
        registrations.inventory,
        registrations.statistics,
      ].map(toHeadlessSaveSlice),
    }
    return { session, registrations }
  })

  return Effect.onError(build, disposeOnBuildFailure(runtime.disposeEffect))
}

const factory: HeadlessHarnessSessionFactory['Service'] = {
  open: (worldSeed, stages) => Effect.map(createSession(worldSeed, stages), ({ session }) => session),
  openRestored: (worldSeed, legacySave, stages) =>
    Effect.gen(function* () {
      const created = yield* createSession(worldSeed, stages)
      yield* migrateSimulationSaveV3(
        legacySave,
        created.registrations,
        () => created.session.close,
      )
      return created.session
    }),
}

export const HeadlessHarnessSessionFactoryLayer: Layer.Layer<HeadlessHarnessSessionFactory> =
  Layer.succeed(HeadlessHarnessSessionFactory)(factory)
