import { type ItemType, isItemType } from '@nerima-games/mc-kernel'
import { type Dimension } from '@nerima-games/mc-worldgen'
import { defineFormat } from '@nerima-games/mc-save'
import { Effect, Schema } from 'effect'
import { HOTBAR_SIZE } from './hotbar'

const finiteNumber = Schema.Number.pipe(Schema.finite())
const integer = Schema.Number.pipe(Schema.int())
const nonNegativeNumber = finiteNumber.pipe(Schema.nonNegative())
const itemType = Schema.String.pipe(
  Schema.filter((value): value is ItemType => isItemType(value), {
    message: () => 'expected an item registered by mc-kernel',
  }),
)

const dimensions = ['overworld', 'nether', 'end'] as const satisfies ReadonlyArray<Dimension>
const dimension = Schema.Literal(...dimensions)
const position = Schema.Struct({
  x: finiteNumber,
  y: finiteNumber,
  z: finiteNumber,
})
const inventorySlot = Schema.Union(
  Schema.Null,
  Schema.Struct({
    item: itemType,
    count: integer.pipe(Schema.between(1, 64)),
  }),
)
const selectedHotbarSlot = integer.pipe(Schema.between(0, HOTBAR_SIZE - 1))
const statistics = Schema.Struct({
  counters: Schema.Record({ key: Schema.String, value: nonNegativeNumber }),
  unlocked: Schema.Array(Schema.String),
})

const asRecord = (value: unknown): Record<string, unknown> => Object(value) as Record<string, unknown>

const migrateV1ToV2 = (payload: unknown): Effect.Effect<unknown, string> => {
  const source = asRecord(payload)
  const player = asRecord(source['player'])
  return Effect.succeed({
    ...source,
    player: { ...player, selectedHotbarSlot: 0 },
    statistics: { counters: {}, unlocked: [] },
  })
}

export const SIMULATION_SAVE_SCHEMA = Schema.Struct({
  dimension,
  tick: integer.pipe(Schema.nonNegative()),
  player: Schema.Struct({
    position,
    inventory: Schema.Array(inventorySlot),
    selectedHotbarSlot,
  }),
  statistics,
})

export type SimulationSave = Schema.Schema.Type<typeof SIMULATION_SAVE_SCHEMA>

export const SIMULATION_SAVE_FORMAT = defineFormat({
  name: '@nerima-games/mc-sim/simulation',
  version: 2,
  schema: SIMULATION_SAVE_SCHEMA,
  migrations: [
    {
      from: 1,
      describe: 'persist hotbar selection and statistics ledger',
      migrate: migrateV1ToV2,
    },
  ],
})
