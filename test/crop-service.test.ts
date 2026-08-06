import { describe, expect, it } from '@effect/vitest'
import type { BlockPosition } from '@nerima-games/mc-kernel'
import { Effect, Layer } from 'effect'
import { CropService, CropServiceLayer } from '../src/application/crop-service'
import { PlayerServiceLayer } from '../src/application/player-service'
import { TimeServiceLayer } from '../src/application/time-service'
import {
  CROP_REGISTRY,
  CROP_TYPES,
  POTATO_MATURITY_SECS,
  type CropLocation,
} from '../src/domain/crop'
import {
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  MonotonicTimeSecs,
} from '@nerima-games/mc-kernel'
import { makeSimStages } from '../src/stages/registration'

const location = (
  x: number,
  y: number,
  z: number,
  dimension: CropLocation['dimension'] = 'overworld',
): CropLocation => ({ dimension, position: { x, y, z } as BlockPosition })

const ServicesLayer = Layer.mergeAll(CropServiceLayer, PlayerServiceLayer(), TimeServiceLayer())
const FrozenClockLayer = FixedClockLayer({
  monotonicSecs: MonotonicTimeSecs(1_000),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
})

describe('crop service', () => {
  it.effect('keys crops by dimension and block position without overwriting occupied soil', () =>
    Effect.gen(function* () {
      const crops = yield* CropService
      const overworld = location(4, 64, -2)
      const nether = location(4, 64, -2, 'nether')

      expect(yield* crops.plant(overworld)).toBe(true)
      expect(yield* crops.plant(overworld)).toBe(false)
      expect(yield* crops.plant(nether)).toBe(true)
      expect((yield* crops.snapshot).crops).toHaveLength(2)
    }).pipe(Effect.provide(ServicesLayer)),
  )

  it.effect('enforces the registry soil contract for every crop', () =>
    Effect.gen(function* () {
      const crops = yield* CropService

      expect(yield* crops.plant(location(0, 64, 0), 'wheat_crop', 'farmland')).toBe(true)
      expect(yield* crops.plant(location(1, 64, 0), 'wheat_crop', 'soul_sand')).toBe(false)
      expect(yield* crops.plant(location(2, 64, 0), 'potato_crop', 'farmland')).toBe(true)
      expect(yield* crops.plant(location(3, 64, 0), 'potato_crop', 'soul_sand')).toBe(false)
      expect(yield* crops.plant(location(4, 64, 0, 'nether'), 'nether_wart_crop', 'soul_sand')).toBe(true)
      expect(yield* crops.plant(location(5, 64, 0, 'nether'), 'nether_wart_crop', 'farmland')).toBe(false)
    }).pipe(Effect.provide(CropServiceLayer)),
  )

  it.effect('plants, grows, and harvests every registered crop through simulation ticks', () =>
    Effect.gen(function* () {
      const crops = yield* CropService
      const stages = yield* makeSimStages
      const planted = CROP_TYPES.map((crop, index) => ({
        crop,
        location: location(index, 70, 0, CROP_REGISTRY[crop].dimensions[index % 3]),
      }))

      for (const entry of planted) {
        const definition = CROP_REGISTRY[entry.crop]
        expect(yield* crops.plant(entry.location, entry.crop, definition.soil)).toBe(true)
      }

      yield* stages[0]?.run(DeltaTimeSecs(POTATO_MATURITY_SECS - 1)) ?? Effect.void
      for (const entry of planted) expect(yield* crops.matureYieldsAt(entry.location)).toBeNull()

      yield* stages[0]?.run(DeltaTimeSecs(1)) ?? Effect.void
      for (const entry of planted) {
        expect(yield* crops.matureYieldsAt(entry.location)).toStrictEqual(
          CROP_REGISTRY[entry.crop].guaranteedMatureYield,
        )
      }
    }).pipe(Effect.provide(ServicesLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('matures potatoes deterministically through the normal simulation stage', () =>
    Effect.gen(function* () {
      const crops = yield* CropService
      const planted = location(0, 70, 0)
      const stages = yield* makeSimStages
      yield* crops.plant(planted)

      yield* stages[0]?.run(DeltaTimeSecs(POTATO_MATURITY_SECS - 1)) ?? Effect.void
      expect(yield* crops.matureYieldAt(planted)).toBeNull()
      yield* stages[0]?.run(DeltaTimeSecs(1)) ?? Effect.void
      expect(yield* crops.matureYieldAt(planted)).toStrictEqual({ item: 'potato', count: 2 })
    }).pipe(Effect.provide(ServicesLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('advances an immature crop by one bone meal application', () =>
    Effect.gen(function* () {
      const crops = yield* CropService
      const planted = location(3, 70, 3)
      yield* crops.plant(planted, 'wheat_crop')

      expect(yield* crops.advanceByBoneMeal(planted)).toBe(true)
      expect((yield* crops.cropAt(planted))?.growthSecs).toBe(30)
    }).pipe(Effect.provide(CropServiceLayer)),
  )

  it.effect('does not advance absent or mature crops with bone meal', () =>
    Effect.gen(function* () {
      const crops = yield* CropService
      const planted = location(5, 70, 5)
      yield* crops.plant(planted, 'potato_crop')
      yield* crops.advance(DeltaTimeSecs(POTATO_MATURITY_SECS))

      expect(yield* crops.advanceByBoneMeal(planted)).toBe(false)
      expect(yield* crops.advanceByBoneMeal(location(6, 70, 6))).toBe(false)
    }).pipe(Effect.provide(CropServiceLayer)),
  )

  it.effect('advances a large crop set without mutating an earlier snapshot', () =>
    Effect.gen(function* () {
      const crops = yield* CropService
      const cropCount = 512

      for (let index = 0; index < cropCount; index += 1) {
        expect(yield* crops.plant(location(index, 70, index))).toBe(true)
      }

      const beforeAdvance = yield* crops.snapshot
      yield* crops.advance(DeltaTimeSecs(1))
      const afterAdvance = yield* crops.snapshot

      expect(beforeAdvance.crops).toHaveLength(cropCount)
      expect(beforeAdvance.crops.every((crop) => crop.growthSecs === 0)).toBe(true)
      expect(afterAdvance.crops).toHaveLength(cropCount)
      expect(afterAdvance.crops.every((crop) => crop.growthSecs === 1)).toBe(true)
      expect(afterAdvance.crops).not.toBe(beforeAdvance.crops)
      expect(afterAdvance.crops[0]).not.toBe(beforeAdvance.crops[0])
    }).pipe(Effect.provide(CropServiceLayer)),
  )

  it.effect('removes harvested crops so the same location can be planted again', () =>
    Effect.gen(function* () {
      const crops = yield* CropService
      const planted = location(8, 63, 8)
      yield* crops.plant(planted)
      yield* crops.advance(DeltaTimeSecs(POTATO_MATURITY_SECS))

      expect((yield* crops.remove(planted))?.growthSecs).toBe(POTATO_MATURITY_SECS)
      expect(yield* crops.cropAt(planted)).toBeNull()
      expect(yield* crops.plant(planted)).toBe(true)
    }).pipe(Effect.provide(CropServiceLayer)),
  )

  it.effect('round-trips JSON snapshots and rejects malformed restoration atomically', () =>
    Effect.gen(function* () {
      const crops = yield* CropService
      yield* crops.plant(location(2, 64, 1), 'wheat_crop')
      yield* crops.plant(location(-1, 65, 9, 'end'), 'potato_crop')
      yield* crops.plant(location(4, 66, -3, 'nether'), 'nether_wart_crop')
      yield* crops.advance(DeltaTimeSecs(12))
      const snapshot = yield* crops.snapshot
      const jsonSnapshot: unknown = JSON.parse(JSON.stringify(snapshot))

      yield* crops.reset
      yield* crops.restore(jsonSnapshot)
      expect(yield* crops.snapshot).toStrictEqual(snapshot)

      const beforeInvalidRestore = yield* crops.snapshot
      const result = yield* Effect.either(crops.restore({
        crops: [{ ...beforeInvalidRestore.crops[0], growthSecs: -1 }],
      }))
      expect(result._tag).toBe('Left')
      expect(yield* crops.snapshot).toStrictEqual(beforeInvalidRestore)
    }).pipe(Effect.provide(CropServiceLayer)),
  )

  it.effect('strict restore rejects extra fields and duplicate locations', () =>
    Effect.gen(function* () {
      const crops = yield* CropService
      const crop = {
        dimension: 'overworld',
        position: { x: 1, y: 64, z: 1 },
        crop: 'potato_crop',
        growthSecs: 0,
      }

      expect((yield* Effect.either(crops.restore({ crops: [], extra: true })))._tag).toBe('Left')
      expect((yield* Effect.either(crops.restore({ crops: [crop, crop] })))._tag).toBe('Left')
      expect((yield* Effect.either(crops.restore({
        crops: [{ ...crop, position: { x: 1.5, y: 64, z: 1 } }],
      })))._tag).toBe('Left')
    }).pipe(Effect.provide(CropServiceLayer)),
  )
})
