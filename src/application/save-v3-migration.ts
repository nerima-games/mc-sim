import type { SaveSliceId } from '@nerima-games/mc-kernel/domain/module-contracts'
import type { SaveSliceRegistration } from '@nerima-games/mc-kernel/domain/save-slices'
import {
  restoreSaveBundle,
  type EncodedSaveBundle,
  type SaveBundleSnapshotError,
  type SaveMigrationPathAmbiguous,
  type SaveMigrationPathMissing,
  type SaveSliceBundleEntryMissing,
  type SaveSliceNotRegistered,
} from '@nerima-games/mc-save'
import { Effect, Exit, Schema } from 'effect'
import { LegacySimulationSaveV3Schema } from '../domain/save-data.js'

type V3Registration<RestoreError, Requirements> = SaveSliceRegistration<Schema.Codec<any, any>, RestoreError, Requirements>

export type SimulationSaveV3Registrations<RestoreError, Requirements> = Readonly<{
  player: V3Registration<RestoreError, Requirements>
  time: V3Registration<RestoreError, Requirements>
  inventory: V3Registration<RestoreError, Requirements>
  statistics: V3Registration<RestoreError, Requirements>
}>

type V3RestoreError =
  | Schema.SchemaError
  | SaveBundleSnapshotError
  | SaveMigrationPathAmbiguous
  | SaveMigrationPathMissing
  | SaveSliceBundleEntryMissing
  | SaveSliceNotRegistered

type EncodedSlice = EncodedSaveBundle[SaveSliceId]

const encodeSlice = <RestoreError, Requirements>(
  registration: V3Registration<RestoreError, Requirements>,
  value: unknown,
): Effect.Effect<readonly [SaveSliceId, EncodedSlice], Schema.SchemaError> =>
  Effect.flatMap(Schema.decodeUnknownEffect(registration.schema)(value), (state) =>
    Effect.map(Schema.encodeUnknownEffect(registration.schema)(state), (data) => [
      registration.id,
      { version: registration.version, data },
    ] as const),
  )

/**
 * The registrations and discard callback must belong to an unpublished world session.
 * The host can expose that session only after this effect succeeds.
 */
export const migrateSimulationSaveV3 = <RestoreError, Requirements>(
  payload: unknown,
  registrations: SimulationSaveV3Registrations<RestoreError, Requirements>,
  discardSession: () => Effect.Effect<void, never, Requirements>,
): Effect.Effect<void, V3RestoreError | RestoreError, Requirements> => {
  const restore = Effect.gen(function* () {
    const save = yield* Schema.decodeUnknownEffect(LegacySimulationSaveV3Schema)(payload)
    const player = {
      dimension: save.dimension,
      pose: {
        feetPosition: save.player.position,
        yawRadians: 0,
        pitchRadians: 0,
      },
    }
    const time = { ticks: save.tick, dayLengthTicks: 24000 }
    const inventory = {
      inventory: {
        slots: save.player.inventory.map((stack) => stack === null ? undefined : stack),
      },
      selectedHotbarSlot: save.player.selectedHotbarSlot,
    }
    const statistics = {
      counters: save.statistics.counters,
      unlocked: save.statistics.unlocked,
    }

    const encodedPlayer = yield* encodeSlice(registrations.player, player)
    const encodedTime = yield* encodeSlice(registrations.time, time)
    const encodedInventory = yield* encodeSlice(registrations.inventory, inventory)
    const encodedStatistics = yield* encodeSlice(registrations.statistics, statistics)

    const bundle: Record<SaveSliceId, EncodedSlice> = Object.create(null)
    bundle[encodedPlayer[0]] = encodedPlayer[1]
    bundle[encodedTime[0]] = encodedTime[1]
    bundle[encodedInventory[0]] = encodedInventory[1]
    bundle[encodedStatistics[0]] = encodedStatistics[1]

    return yield* restoreSaveBundle(bundle, [
      registrations.player,
      registrations.time,
      registrations.inventory,
      registrations.statistics,
    ])
  })

  return Effect.onExit(restore, (exit) => Exit.isFailure(exit) ? discardSession() : Effect.void)
}
