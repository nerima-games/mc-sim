import {
  DIMENSIONS,
  itemStackFromUnknown,
  isItemStack,
  type Dimension,
  type ItemStack,
  type Statistics,
} from '@nerima-games/mc-kernel'
import { defineFormat, type SaveFormat } from '@nerima-games/mc-save'
import { Schema } from 'effect'
import { HOTBAR_SIZE } from './hotbar.js'

const finiteNumber = Schema.Number.pipe(Schema.finite())
const integer = Schema.Number.pipe(Schema.int())
const nonNegativeNumber = finiteNumber.pipe(Schema.nonNegative())
const valueWithUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(valueWithUndefined)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, entry === null ? undefined : valueWithUndefined(entry)]),
  )
}
const valueWithNull = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(valueWithNull)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, entry === undefined ? null : valueWithNull(entry)]))
}
const wireItemStack = Schema.Struct({
  item: Schema.String,
  count: Schema.Number,
  components: Schema.Unknown,
})
const itemStack = Schema.transform(Schema.Unknown, Schema.Unknown, {
  decode: (value) => {
    const canonical = Schema.decodeUnknownSync(wireItemStack)(valueWithUndefined(value))
    return itemStackFromUnknown(canonical.item, canonical.count, { components: canonical.components })
  },
  encode: (value) => valueWithNull(value),
  strict: true,
}).pipe(
  Schema.filter((value): value is ItemStack => isItemStack(value), {
    message: () => 'expected a canonical ItemStack from mc-kernel',
  }),
)

const dimension = Schema.Literal(...DIMENSIONS)
const position = Schema.Struct({
  x: finiteNumber,
  y: finiteNumber,
  z: finiteNumber,
})
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
 * Parameterized over the inventory slot because the kernel decoder narrows the
 * unknown wire value to a canonical ItemStack at the schema boundary.
 */
type SimulationSaveFor<Stack> = {
  readonly dimension: Dimension
  readonly tick: number
  readonly player: {
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
    readonly inventory: ReadonlyArray<Stack | null>
    readonly selectedHotbarSlot: number
  }
  readonly statistics: Statistics
}

export type SimulationSave = SimulationSaveFor<ItemStack>
type SimulationSaveEncoded = SimulationSaveFor<unknown>

export const SIMULATION_SAVE_SCHEMA: Schema.Schema<SimulationSave, SimulationSaveEncoded> = Schema.Struct({
  dimension,
  tick: integer.pipe(Schema.nonNegative()),
  player: Schema.Struct({
    position,
    inventory: Schema.Array(Schema.Union(Schema.Null, itemStack)),
    selectedHotbarSlot,
  }),
  statistics,
})

export const SIMULATION_SAVE_FORMAT: SaveFormat<SimulationSave, SimulationSaveEncoded> = defineFormat({
  name: '@nerima-games/mc-sim/simulation',
  version: 3,
  schema: SIMULATION_SAVE_SCHEMA,
})
