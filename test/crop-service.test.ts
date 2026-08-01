import { describe, expect, it } from '@effect/vitest'
import type { BlockPosition } from '@nerima-games/mc-kernel'
import { Effect, Layer } from 'effect'
import { CropService, CropServiceLayer } from '../src/application/crop-service'
import { PlayerServiceLayer } from '../src/application/player-service'
import { TimeServiceLayer } from '../src/application/time-service'
import { POTATO_MATURITY_SECS, type CropLocation } from '../src/domain/crop'
import {
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  MonotonicTimeSecs,
} from '../src/domain/kernel-vocabulary'
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
      yield* crops.plant(location(2, 64, 1))
      yield* crops.plant(location(-1, 65, 9, 'end'))
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
