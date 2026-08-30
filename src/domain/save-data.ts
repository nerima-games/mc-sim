import { type ItemType, isItemType } from '@nerima-games/mc-kernel'
import { type Dimension } from '@nerima-games/mc-worldgen'
import { defineFormat, type SaveFormat } from '@nerima-games/mc-save'
import { Schema } from 'effect'
import { HOTBAR_SIZE } from './hotbar.js'

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

/**
 * Hand-written to give `SIMULATION_SAVE_SCHEMA` an explicit type: with
 * `isolatedDeclarations`, an exported `Schema.Struct(...)` call built from
 * nested private `Schema.Struct`/`Schema.Union` helpers cannot be inferred
 * without one. Matches `@nerima-games/mc-save`'s `SaveEnvelopeSchema`
 * convention (a hand-written type paired with `Schema.Schema<T>`).
 *
 * Parameterized over the inventory slot's `item` field because decoded and
 * encoded differ there: `itemType`'s `Schema.filter` type guard narrows the
 * DECODED type to `ItemType`, but the wire/JSON form is a bare `string` before
 * that guard runs.
 */
type SimulationSaveFor<Item> = {
  readonly dimension: Dimension
  readonly tick: number
  readonly player: {
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
    readonly inventory: ReadonlyArray<{ readonly item: Item; readonly count: number } | null>
    readonly selectedHotbarSlot: number
  }
  readonly statistics: {
    readonly counters: Record<string, number>
    readonly unlocked: ReadonlyArray<string>
  }
}

export type SimulationSave = SimulationSaveFor<ItemType>
type SimulationSaveEncoded = SimulationSaveFor<string>

export const SIMULATION_SAVE_SCHEMA: Schema.Schema<SimulationSave, SimulationSaveEncoded> = Schema.Struct({
  dimension,
  tick: integer.pipe(Schema.nonNegative()),
  player: Schema.Struct({
    position,
    inventory: Schema.Array(inventorySlot),
    selectedHotbarSlot,
  }),
  statistics,
})

export const SIMULATION_SAVE_FORMAT: SaveFormat<SimulationSave, SimulationSaveEncoded> = defineFormat({
  name: '@nerima-games/mc-sim/simulation',
  version: 2,
  schema: SIMULATION_SAVE_SCHEMA,
})
