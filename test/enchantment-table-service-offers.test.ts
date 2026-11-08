import { describe, expect, it } from '@effect/vitest'
import fc from 'fast-check'
import { BlockAxis, BlockId, blockPosition, WorldIdSchema } from '@nerima-games/mc-kernel'
import { Effect, Layer, Result, Schema } from 'effect'
import {
  EnchantmentTableGenerateOffersResultSchema,
  EnchantmentTableServiceErrorSchema,
  EnchantmentTableService,
  EnchantmentTableServiceLayer,
} from '../src/application/enchantment-table-service.js'
import { WorldCommitCoordinatorLayer } from '../src/application/world-commit-coordinator.js'

const world = Schema.decodeUnknownSync(WorldIdSchema)('enchantment-table-offers-test')
const tablePosition = blockPosition(BlockAxis(0), BlockAxis(0), BlockAxis(0))
const ringOffsets = [
  [-2, -2], [-2, 0], [-2, 2],
  [0, -2], [0, 2],
  [2, -2], [2, 0], [2, 2],
] as const
const keyOf = ({ x, y, z }: Readonly<{ x: number; y: number; z: number }>): string => `${x},${y},${z}`

const blockIdAtFor = (
  center: Readonly<{ x: number; y: number; z: number }>,
  shelves: readonly boolean[],
  openGaps: readonly boolean[],
) => {
  const blocks = new Map<string, BlockId>()
  const air = BlockId(0)
  const solid = BlockId(1)
  const bookshelf = BlockId(125)
  ringOffsets.forEach(([dx, dz], index) => {
    for (const dy of [0, 1]) {
      blocks.set(keyOf({ x: center.x + dx / 2, y: center.y + dy, z: center.z + dz / 2 }),
        openGaps[index] ? air : solid)
      blocks.set(keyOf({ x: center.x + dx, y: center.y + dy, z: center.z + dz }),
        shelves[index * 2 + dy] ? bookshelf : air)
    }
  })

  return ({ x, y, z }: Readonly<{ x: number; y: number; z: number }>): BlockId =>
    blocks.get(keyOf({ x, y, z })) ?? air
}

const bookshelfLayout = fc.record({
  x: fc.integer({ min: -32, max: 32 }),
  y: fc.integer({ min: -32, max: 32 }),
  z: fc.integer({ min: -32, max: 32 }),
  shelves: fc.array(fc.boolean(), { minLength: 16, maxLength: 16 }),
  openGaps: fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
})

const serviceLayer = Layer.provideMerge(
  WorldCommitCoordinatorLayer({ world, dimensions: [], owners: [] }),
)(EnchantmentTableServiceLayer)

describe('EnchantmentTableService generated offers', () => {
  it.effect('uses counted bookshelves to generate different zero and fifteen shelf offers', () =>
    Effect.gen(function* () {
      const service = yield* EnchantmentTableService
      const random = { nextInt: () => 0, nextFloat: () => 0.5 }
      const withoutBookshelves = yield* service.generateOffers({
        item: 'book',
        tablePosition,
        blockIdAt: blockIdAtFor(tablePosition, Array.from({ length: 16 }, () => false), ringOffsets.map(() => true)),
        random,
      })
      const withFifteenBookshelves = yield* service.generateOffers({
        item: 'book',
        tablePosition,
        blockIdAt: blockIdAtFor(tablePosition, Array.from({ length: 16 }, (_, index) => index < 15), ringOffsets.map(() => true)),
        random,
      })

      expect(withoutBookshelves.bookshelfCount).toBe(0)
      expect(withFifteenBookshelves.bookshelfCount).toBe(15)
      expect(withoutBookshelves.offers).not.toStrictEqual(withFifteenBookshelves.offers)
    }).pipe(Effect.provide(serviceLayer)),
  )

  it.effect('returns schema-decodable offers for generated bookshelf layouts', () =>
    Effect.gen(function* () {
      const service = yield* EnchantmentTableService
      yield* Effect.promise(() => fc.assert(
        fc.asyncProperty(bookshelfLayout, async ({ x, y, z, shelves, openGaps }) => {
          const center = blockPosition(BlockAxis(x), BlockAxis(y), BlockAxis(z))
          const result = await Effect.runPromise(service.generateOffers({
            item: 'book',
            tablePosition: center,
            blockIdAt: blockIdAtFor(center, shelves, openGaps),
            random: { nextInt: () => 0, nextFloat: () => 0.5 },
          }))
          const expected = Math.min(15, shelves.reduce((count, hasShelf, index) =>
            count + Number(hasShelf) * Number(openGaps[Math.floor(index / 2)]), 0))

          expect(result.bookshelfCount).toBe(expected)
          expect(Result.isSuccess(
            Schema.decodeUnknownResult(EnchantmentTableGenerateOffersResultSchema)(result),
          )).toBe(true)
        }),
        { numRuns: 48, seed: 0x454e4348 },
      ))
    }).pipe(Effect.provide(serviceLayer)),
  )

  it.effect('returns a typed failure when a block ID is not registered', () =>
    Effect.gen(function* () {
      const service = yield* EnchantmentTableService
      const outcome = yield* Effect.result(service.generateOffers({
        item: 'book',
        tablePosition,
        blockIdAt: () => BlockId(126),
        random: { nextInt: () => 0, nextFloat: () => 0.5 },
      }))

      expect(outcome).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'EnchantmentTableBookshelfFailure', reason: 'invalid-block-id' },
      })
      if (Result.isFailure(outcome)) {
        expect(Result.isSuccess(Schema.decodeUnknownResult(EnchantmentTableServiceErrorSchema)(outcome.failure))).toBe(true)
      }
    }).pipe(Effect.provide(serviceLayer)),
  )
})
