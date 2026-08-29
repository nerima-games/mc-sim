import { Context, Effect, Layer, Ref } from 'effect'
import type { BlockType } from '@nerima-games/mc-kernel'
import type { ItemStack } from '../domain/inventory'
import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import * as Crop from '../domain/crop'

export type CropServiceApi = {
  readonly plant: (
    location: Crop.CropLocation,
    crop?: Crop.CropType,
    soil?: BlockType,
  ) => Effect.Effect<boolean>
  readonly cropAt: (location: Crop.CropLocation) => Effect.Effect<Crop.CropState | null>
  readonly matureYieldsAt: (
    location: Crop.CropLocation,
  ) => Effect.Effect<ReadonlyArray<ItemStack> | null>
  readonly remove: (location: Crop.CropLocation) => Effect.Effect<Crop.CropState | null>
  readonly advance: (delta: DeltaTimeSecs) => Effect.Effect<void>
  readonly advanceByBoneMeal: (location: Crop.CropLocation) => Effect.Effect<boolean>
  readonly snapshot: Effect.Effect<Crop.CropSnapshot>
  readonly restore: (snapshot: unknown) => Effect.Effect<void, Crop.CropValidationError>
  readonly reset: Effect.Effect<void>
}

export class CropService extends Context.Tag('@nerima-games/mc-sim/CropService')<
  CropService,
  CropServiceApi
>() {}

const copyCrop = (crop: Crop.CropState): Crop.CropState => ({
  ...crop,
  position: { ...crop.position },
})

const sortedCrops = (crops: Iterable<Crop.CropState>): ReadonlyArray<Crop.CropState> =>
  Array.from(crops, copyCrop).sort((left, right) =>
    Crop.cropLocationKey(left).localeCompare(Crop.cropLocationKey(right), 'en'),
  )

export const makeCropService = (): Effect.Effect<CropServiceApi> =>
  Effect.map(Ref.make(new Map<string, Crop.CropState>()), (state) => ({
    plant: (location, crop = 'potato_crop', soil = Crop.cropDefinitionFor(crop).soil) =>
      Ref.modify(state, (current) => {
        const key = Crop.cropLocationKey(location)
        if (current.has(key) || !Crop.canPlantCrop(crop, soil, location.dimension)) {
          return [false, current]
        }
        const next = new Map(current)
        next.set(key, { ...location, position: { ...location.position }, crop, growthSecs: 0 })
        return [true, next]
      }),
    cropAt: (location) =>
      Effect.map(Ref.get(state), (current) => {
        const crop = current.get(Crop.cropLocationKey(location))
        return crop === undefined ? null : copyCrop(crop)
      }),
    matureYieldsAt: (location) =>
      Effect.map(Ref.get(state), (current) => {
        const crop = current.get(Crop.cropLocationKey(location))
        return crop === undefined ? null : Crop.matureYieldsFor(crop)
      }),
    remove: (location) =>
      Ref.modify(state, (current) => {
        const key = Crop.cropLocationKey(location)
        const crop = current.get(key)
        if (crop === undefined) return [null, current]
        const next = new Map(current)
        next.delete(key)
        return [copyCrop(crop), next]
      }),
    advance: (delta) =>
      Ref.update(state, (current) =>
        new Map(Array.from(current, ([key, crop]) => [key, Crop.advanceCrop(crop, delta)])),
      ),
    advanceByBoneMeal: (location) =>
      Ref.modify(state, (current) => {
        const key = Crop.cropLocationKey(location)
        const crop = current.get(key)
        if (crop === undefined || Crop.isMatureCrop(crop)) return [false, current]
        const next = new Map(current)
        next.set(key, Crop.advanceCropByBoneMeal(crop))
        return [true, next]
      }),
    snapshot: Effect.map(Ref.get(state), (current) => ({ crops: sortedCrops(current.values()) })),
    restore: (snapshot) => {
      const validated = Crop.validateCropSnapshot(snapshot)
      return validated._tag === 'Invalid'
        ? Effect.fail(validated.error)
        : Ref.set(
            state,
            new Map(validated.snapshot.crops.map((crop) => [Crop.cropLocationKey(crop), copyCrop(crop)])),
          )
    },
    reset: Ref.set(state, new Map()),
  }))

export const CropServiceLayer: Layer.Layer<CropService> = Layer.effect(CropService, makeCropService())
