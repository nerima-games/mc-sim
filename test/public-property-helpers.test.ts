import { Result, Schema } from 'effect'
import { expect, it } from 'vitest'
import { assertResultContract } from './public-property-helpers.js'

const TransferSuccessSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Transferred'),
    count: Schema.Int,
    item: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal('NoChange'),
    reason: Schema.String,
  }),
])

const TransferFailureSchema = Schema.Struct({
  _tag: Schema.Literal('TransferFailure'),
  reason: Schema.String,
})

it('accepts declared successes and failures only when their schemas match', () => {
  expect(() => assertResultContract(
    'transfer',
    () => Result.succeed({ _tag: 'Transferred', count: 2, item: 'stone' }),
    TransferSuccessSchema,
    TransferFailureSchema,
  )).not.toThrow()

  expect(() => assertResultContract(
    'transfer',
    () => Result.fail({ _tag: 'TransferFailure', reason: 'full' }),
    TransferSuccessSchema,
    TransferFailureSchema,
  )).not.toThrow()
})

it('rejects missing success fields, unknown error tags, and invalid branded values', () => {
  expect(() => assertResultContract(
    'transfer',
    () => Result.succeed({ _tag: 'Transferred' }),
    TransferSuccessSchema,
    TransferFailureSchema,
  )).toThrow()

  expect(() => assertResultContract(
    'transfer',
    () => Result.fail({ _tag: 'UnknownFailure' }),
    TransferSuccessSchema,
    TransferFailureSchema,
  )).toThrow()

  const BrandedCountSchema = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand('BrandedCount'))
  expect(() => assertResultContract(
    'branded count',
    () => Result.succeed(0),
    BrandedCountSchema,
    Schema.Never,
  )).toThrow()
})
