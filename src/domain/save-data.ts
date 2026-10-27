import {
  DIMENSIONS,
  isItemStack,
  itemStackEqualsIgnoringCount,
  itemStackFromUnknown,
  type Dimension,
  type ItemStack,
} from '@nerima-games/mc-kernel'
import { defineFormat, type SaveFormat } from '@nerima-games/mc-save'
import { Effect, Result, Schema, SchemaIssue, SchemaTransformation } from 'effect'
import { HOTBAR_SIZE } from './hotbar.js'

const finiteNumber = Schema.Finite
const integer = Schema.Int
const nonNegativeNumber = finiteNumber.check(Schema.isGreaterThanOrEqualTo(0))
const valueWithUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(valueWithUndefined)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, entry === null ? undefined : valueWithUndefined(entry)]),
  )
}
const valueWithNull = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(valueWithNull)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, entry === undefined ? null : valueWithNull(entry)]))
}
type WireItemStack = Readonly<{ item: string; count: number; components: unknown }>

const wireItemStack: Schema.Codec<WireItemStack, WireItemStack> = Schema.Struct({
  item: Schema.String,
  count: Schema.Number,
  components: Schema.Unknown,
})
export const LegacyItemStackSchema: Schema.Codec<ItemStack, unknown> = Schema.Unknown.pipe(
  Schema.decodeTo(
    Schema.declare((value: unknown): value is ItemStack => isItemStack(value)).annotate({
      message: 'expected a canonical ItemStack from mc-kernel',
    }),
    SchemaTransformation.transformEffect<ItemStack, unknown>({
      decode: (value) => {
        const decoded = Schema.decodeUnknownResult(wireItemStack)(value)
        if (Result.isFailure(decoded)) return Effect.fail(decoded.failure.issue)
        if (decoded.success.components === undefined) {
          return Effect.fail(new SchemaIssue.InvalidValue(
            { message: 'expected a canonical ItemStack from mc-kernel' },
            value,
          ))
        }
        const stack = decoded.success.components === null
          ? itemStackFromUnknown(decoded.success.item, decoded.success.count)
          : itemStackFromUnknown(decoded.success.item, decoded.success.count, {
            components: valueWithUndefined(decoded.success.components),
          })
        if (Result.isFailure(stack) || !isItemStack(stack.success)) {
          return Effect.fail(new SchemaIssue.InvalidValue(
            { message: 'expected a canonical ItemStack from mc-kernel' },
            value,
          ))
        }
        return Effect.succeed(stack.success)
      },
      encode: (value) => {
        const defaultStack = itemStackFromUnknown(value.item, 1)
        if (Result.isFailure(defaultStack) || !isItemStack(defaultStack.success)) {
          return Effect.fail(new SchemaIssue.InvalidValue(
            { message: 'expected a canonical ItemStack from mc-kernel' },
            value,
          ))
        }
        return Effect.succeed({
          item: value.item,
          count: value.count,
          components: itemStackEqualsIgnoringCount(value, defaultStack.success)
            ? null
            : valueWithNull(value.components),
        })
      },
    }),
  ),
)

const dimension = Schema.Literals(DIMENSIONS)
const position = Schema.Struct({
  x: finiteNumber,
  y: finiteNumber,
  z: finiteNumber,
})
const selectedHotbarSlot = integer.check(Schema.isBetween({ minimum: 0, maximum: HOTBAR_SIZE - 1 }))
const statistics = Schema.Struct({
  counters: Schema.Record(Schema.String, nonNegativeNumber),
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
  readonly statistics: Readonly<{
    readonly counters: Readonly<Record<string, number>>
    readonly unlocked: ReadonlyArray<string>
  }>
}

export type SimulationSave = SimulationSaveFor<ItemStack>
type SimulationSaveEncoded = SimulationSaveFor<unknown>

export const LegacySimulationSaveV3Schema: Schema.Codec<SimulationSave, SimulationSaveEncoded> = Schema.Struct({
  dimension,
  tick: integer.check(Schema.isGreaterThanOrEqualTo(0)),
  player: Schema.Struct({
    position,
    inventory: Schema.Array(Schema.Union([Schema.Null, LegacyItemStackSchema])),
    selectedHotbarSlot,
  }),
  statistics,
})

export const SIMULATION_SAVE_SCHEMA: Schema.Codec<SimulationSave, SimulationSaveEncoded> = LegacySimulationSaveV3Schema

export const SIMULATION_SAVE_FORMAT: SaveFormat<SimulationSave, SimulationSaveEncoded> = Result.getOrThrow(defineFormat({
  name: '@nerima-games/mc-sim/simulation',
  version: 3,
  schema: SIMULATION_SAVE_SCHEMA,
}))
