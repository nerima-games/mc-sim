import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema, SchemaIssue, SchemaTransformation, Exit } from 'effect'
import {
  DIMENSIONS,
  SaveSliceIdSchema,
  SaveVersionSchema,
  itemStackFromUnknown,
} from '@nerima-games/mc-kernel'
import type { SaveSliceRegistration } from '@nerima-games/mc-kernel/domain/save-slices'
import { migrateSimulationSaveV3, type SimulationSaveV3Registrations } from '../src/application/save-v3-migration.js'
import { LegacyItemStackSchema } from '../src/domain/save-data.js'

const sliceId = (value: string) => Schema.decodeUnknownSync(SaveSliceIdSchema)(value)
const version = (value: number) => Schema.decodeUnknownSync(SaveVersionSchema)(value)

const save = {
  dimension: 'nether',
  tick: 87654,
  player: {
    position: { x: 8.25, y: -12, z: 30 },
    inventory: [
      { item: 'iron_ingot', count: 2, components: null },
      null,
    ],
    selectedHotbarSlot: 7,
  },
  statistics: {
    counters: { mined: 9, jumped: 3 },
    unlocked: ['minecraft:story/root'],
  },
}

const PlayerSchema = Schema.Struct({
  dimension: Schema.Literals(DIMENSIONS),
  pose: Schema.Struct({
    feetPosition: Schema.Struct({ x: Schema.Number, y: Schema.Number, z: Schema.Number }),
    yawRadians: Schema.Number,
    pitchRadians: Schema.Number,
  }),
})
const TimeSchema = Schema.Struct({
  ticks: Schema.Number,
  dayLengthTicks: Schema.Number,
})
const InventorySchema = Schema.Struct({
  inventory: Schema.Struct({
    slots: Schema.Array(Schema.Union([Schema.Undefined, LegacyItemStackSchema])),
  }),
  selectedHotbarSlot: Schema.Number,
})
const StatisticsSchema = Schema.Struct({
  counters: Schema.Record(Schema.String, Schema.Number),
  unlocked: Schema.Array(Schema.String),
})

type RestoreError = string

const registration = <Codec extends Schema.Codec<any, any>>(
  name: string,
  schema: Codec,
  restore: (state: Codec['Type']) => Effect.Effect<void, RestoreError>,
): SaveSliceRegistration<Codec, RestoreError, never> => ({
  id: sliceId(name),
  version: version(1),
  schema,
  snapshot: Effect.succeed(undefined),
  restore,
  migrations: [],
})

const registrations = (
  restored: Array<readonly [string, unknown]>,
  options: Readonly<{
    playerSchema?: Schema.Codec<any, any>
    failOn?: string
    interruptOn?: string
  }> = {},
): SimulationSaveV3Registrations<RestoreError, never> => {
  const runRestore = (name: string, state: unknown): Effect.Effect<void, RestoreError> => {
    restored.push([name, state])
    if (options.interruptOn === name) return Effect.interrupt
    return options.failOn === name ? Effect.fail('restore failed') : Effect.void
  }

  return {
    player: registration('player', options.playerSchema ?? PlayerSchema, (state) => runRestore('player', state)),
    time: registration('time', TimeSchema, (state) => runRestore('time', state)),
    inventory: registration('inventory', InventorySchema, (state) => runRestore('inventory', state)),
    statistics: registration('statistics', StatisticsSchema, (state) => runRestore('statistics', state)),
  }
}

const freshSessionDiscarder = (session: { discarded: number }): (() => Effect.Effect<void>) =>
  () => Effect.sync(() => { session.discarded += 1 })

describe('v3 save migration', () => {
  it.effect('rejects legacy item stacks without canonical components and invalid encoded stacks', () =>
    Effect.gen(function* () {
      const missingComponents = yield* Effect.result(
        Schema.decodeUnknownEffect(LegacyItemStackSchema)({ item: 'iron_ingot', count: 1, components: undefined }),
      )
      const components = Result.getOrThrow(itemStackFromUnknown('iron_ingot', 1)).components
      let itemReads = 0
      const invalidEncodedStack = yield* Effect.result(
        Schema.encodeUnknownEffect(LegacyItemStackSchema)({
          get item() {
            itemReads += 1
            return itemReads === 1 ? 'iron_ingot' : 'unknown_item'
          },
          count: 1,
          components,
        }),
      )

      expect(Result.isFailure(missingComponents)).toBe(true)
      expect(Result.isFailure(invalidEncodedStack)).toBe(true)
      expect(itemReads).toBeGreaterThan(1)
    }),
  )

  it.effect('maps a valid payload to the four initial slices', () =>
    Effect.gen(function* () {
      const restored: Array<readonly [string, unknown]> = []
      const session = { discarded: 0 }
      yield* migrateSimulationSaveV3(save, registrations(restored), freshSessionDiscarder(session))

      expect(restored).toHaveLength(4)
      expect(restored.map(([id]) => id)).toEqual(['player', 'time', 'inventory', 'statistics'])
      expect(restored[0]?.[1]).toStrictEqual({
        dimension: 'nether',
        pose: {
          feetPosition: { x: 8.25, y: -12, z: 30 },
          yawRadians: 0,
          pitchRadians: 0,
        },
      })
      expect(restored[1]?.[1]).toStrictEqual({ ticks: 87654, dayLengthTicks: 24000 })
      expect(restored[2]?.[1]).toStrictEqual({
        inventory: {
          slots: [
            Result.getOrThrow(itemStackFromUnknown('iron_ingot', 2)),
            undefined,
          ],
        },
        selectedHotbarSlot: 7,
      })
      expect(restored[3]?.[1]).toStrictEqual({
        counters: { mined: 9, jumped: 3 },
        unlocked: ['minecraft:story/root'],
      })
      expect(session.discarded).toBe(0)
    }),
  )

  it.effect('rejects an invalid v3 payload before restoring any slice', () =>
    Effect.gen(function* () {
      const restored: Array<readonly [string, unknown]> = []
      const session = { discarded: 0 }
      const result = yield* Effect.result(
        migrateSimulationSaveV3(
          { ...save, player: { ...save.player, selectedHotbarSlot: 9 } },
          registrations(restored),
          freshSessionDiscarder(session),
        ),
      )

      expect(result._tag).toBe('Failure')
      expect(restored).toEqual([])
      expect(session.discarded).toBe(1)
    }),
  )

  it.effect('rejects a slice decode failure before any restore', () =>
    Effect.gen(function* () {
      const restored: Array<readonly [string, unknown]> = []
      const session = { discarded: 0 }
      const noNetherPlayerSchema = Schema.Struct({
        dimension: Schema.Literals(['overworld']),
        pose: PlayerSchema.fields.pose,
      })
      const result = yield* Effect.result(
        migrateSimulationSaveV3(
          save,
          registrations(restored, { playerSchema: noNetherPlayerSchema }),
          freshSessionDiscarder(session),
        ),
      )

      expect(result._tag).toBe('Failure')
      expect(restored).toEqual([])
      expect(session.discarded).toBe(1)
    }),
  )

  it.effect('rejects a slice encode failure before any restore', () =>
    Effect.gen(function* () {
      const restored: Array<readonly [string, unknown]> = []
      const session = { discarded: 0 }
      const encodeFailureSchema = Schema.Unknown.pipe(
        Schema.decodeTo(
          Schema.Unknown,
          SchemaTransformation.transformEffect<unknown, unknown>({
            decode: (value) => Effect.succeed(value),
            encode: (value) => Effect.fail(new SchemaIssue.InvalidValue(
              { message: 'encoding rejected' },
              value,
            )),
          }),
        ),
      )
      const result = yield* Effect.result(
        migrateSimulationSaveV3(
          save,
          registrations(restored, { playerSchema: encodeFailureSchema }),
          freshSessionDiscarder(session),
        ),
      )

      expect(result._tag).toBe('Failure')
      expect(restored).toEqual([])
      expect(session.discarded).toBe(1)
    }),
  )

  it.effect('discards the unpublished session when a later restore fails', () =>
    Effect.gen(function* () {
      const restored: Array<readonly [string, unknown]> = []
      const session = { discarded: 0 }
      let visible = false
      const result = yield* Effect.result(
        migrateSimulationSaveV3(
          save,
          registrations(restored, { failOn: 'inventory' }),
          freshSessionDiscarder(session),
        ),
      )
      if (result._tag === 'Success') visible = true

      expect(result._tag).toBe('Failure')
      expect(restored.map(([id]) => id)).toEqual(['player', 'time', 'inventory'])
      expect(session.discarded).toBe(1)
      expect(visible).toBe(false)
    }),
  )

  it.effect('discards the unpublished session when a restore is interrupted', () =>
    Effect.gen(function* () {
      const restored: Array<readonly [string, unknown]> = []
      const session = { discarded: 0 }
      const exit = yield* Effect.exit(
        migrateSimulationSaveV3(
          save,
          registrations(restored, { interruptOn: 'time' }),
          freshSessionDiscarder(session),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      expect(restored.map(([id]) => id)).toEqual(['player', 'time'])
      expect(session.discarded).toBe(1)
    }),
  )
})
