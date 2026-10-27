import { Effect } from 'effect'
import fc from 'fast-check'

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

export const hostileValue: fc.Arbitrary<unknown> = fc.oneof(
  hostileNumber,
  fc.string({ maxLength: 12 }),
  fc.boolean(),
  fc.constantFrom<unknown>(null, undefined),
)

export const unknownValue: fc.Arbitrary<unknown> = fc.oneof(
  hostileValue,
  fc.array(hostileValue, { maxLength: 4 }),
  fc.dictionary(fc.string({ maxLength: 8 }), hostileValue, { maxKeys: 4 }),
)
