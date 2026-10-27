import { Effect, Result, Schema } from 'effect'
import fc from 'fast-check'
import { expect } from 'vitest'

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const finiteTree = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(finiteTree)
  if (isRecord(value)) return Object.values(value).every(finiteTree)
  return true
}

export const invoke = (operation: (...args: never[]) => unknown, args: ReadonlyArray<unknown>): unknown =>
  Reflect.apply(operation, undefined, args)

export const invokeEffect = <A, E, R>(
  operation: (...args: never[]) => Effect.Effect<A, E, R>,
  args: ReadonlyArray<unknown>,
): Effect.Effect<A, E, R> => Reflect.apply(operation, undefined, args)

export const hostileNumber: fc.Arbitrary<number> = fc.oneof(
  fc.double(),
  fc.constantFrom(
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
    Number.MAX_SAFE_INTEGER,
    -Number.MAX_SAFE_INTEGER,
    -1,
    0,
    1,
  ),
)

export const hostileScalarInput = (options: {
  readonly numbers?: fc.Arbitrary<unknown>
  readonly maxStringLength?: number
  readonly includeNullish?: boolean
} = {}): fc.Arbitrary<unknown> => {
  const scalars: Array<fc.Arbitrary<unknown>> = [
    options.numbers ?? hostileNumber,
    options.maxStringLength === undefined ? fc.string() : fc.string({ maxLength: options.maxStringLength }),
    fc.boolean(),
  ]
  if (options.includeNullish === true) scalars.push(fc.constantFrom<unknown>(null, undefined))
  return fc.oneof(...scalars)
}

export const hostileNumberOrNullish: fc.Arbitrary<unknown> = fc.oneof(
  hostileNumber,
  fc.constantFrom<unknown>(null, undefined),
)

export const hostileValue: fc.Arbitrary<unknown> = hostileScalarInput({
  maxStringLength: 12,
  includeNullish: true,
})

export const structuredInput = (
  value: fc.Arbitrary<unknown>,
  options: {
    readonly maxArrayLength?: number
    readonly maxDictionaryKeyLength?: number
    readonly maxDictionaryKeys?: number
  } = {},
): fc.Arbitrary<unknown> => {
  const maxArrayLength = options.maxArrayLength ?? 4
  const maxDictionaryKeyLength = options.maxDictionaryKeyLength ?? 8
  const maxDictionaryKeys = options.maxDictionaryKeys ?? 4
  return fc.oneof(
    value,
    fc.array(value, { maxLength: maxArrayLength }),
    fc.dictionary(fc.string({ maxLength: maxDictionaryKeyLength }), value, { maxKeys: maxDictionaryKeys }),
  )
}

export const unknownValue: fc.Arbitrary<unknown> = structuredInput(hostileValue)

export const hostileItemStack: fc.Arbitrary<unknown> = fc.oneof(
  unknownValue,
  fc.record({ item: hostileValue, count: hostileNumber, components: hostileValue }),
)

const schemaPredicates = new WeakMap<Schema.Schema<unknown>, (value: unknown) => boolean>()

const schemaIs = (schema: Schema.Schema<unknown>, value: unknown): boolean => {
  let predicate = schemaPredicates.get(schema)
  if (predicate === undefined) {
    predicate = Schema.is(schema)
    schemaPredicates.set(schema, predicate)
  }
  return predicate(value)
}

export const assertResultContract = (
  propertyName: string,
  call: () => Result.Result<unknown, unknown>,
  successSchema: Schema.Schema<unknown>,
  failureSchema: Schema.Schema<unknown>,
): void => {
  const outcome = call()
  if (Result.isFailure(outcome)) {
    expect(schemaIs(failureSchema, outcome.failure), `${propertyName}: failure schema`).toBe(true)
    return
  }
  expect(schemaIs(successSchema, outcome.success), `${propertyName}: success schema`).toBe(true)
}

export const assertEffectOutcome: typeof assertResultContract = assertResultContract
