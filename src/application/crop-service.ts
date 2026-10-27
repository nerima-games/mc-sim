import { Context, Effect, Layer, Ref, Result, Schema } from 'effect'
import { isBlockType, isDimension } from '@nerima-games/mc-kernel'
import { BlockAxis } from '@nerima-games/mc-kernel/domain/coordinates'
import type { BlockType } from '@nerima-games/mc-kernel'
import * as Inventory from '../domain/inventory.js'
import type { ItemStack, ItemStackFailure } from '../domain/inventory.js'
import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'
import * as Crop from '../domain/crop.js'

export type CropServiceApi = {
  readonly plant: (
    location: Crop.CropLocation,
    crop?: Crop.CropType,
    soil?: BlockType,
  ) => Effect.Effect<boolean, Crop.CropValidationError>
  readonly cropAt: (
    location: Crop.CropLocation,
  ) => Effect.Effect<Crop.CropState | null, Crop.CropValidationError>
  readonly matureYieldsAt: (
    location: Crop.CropLocation,
  ) => Effect.Effect<ReadonlyArray<ItemStack> | null, ItemStackFailure | Crop.CropValidationError>
  readonly remove: (
    location: Crop.CropLocation,
  ) => Effect.Effect<Crop.CropState | null, Crop.CropValidationError>
  readonly advance: (delta: DeltaTimeSecs) => Effect.Effect<void>
  readonly advanceByBoneMeal: (
    location: Crop.CropLocation,
  ) => Effect.Effect<boolean, Crop.CropValidationError>
  readonly snapshot: Effect.Effect<Crop.CropSnapshot>
  readonly restore: (snapshot: unknown) => Effect.Effect<void, Crop.CropValidationError>
  readonly reset: Effect.Effect<void>
}

export const CropServicePlantSuccessSchema: Schema.Codec<boolean, boolean> = Schema.Boolean
export const CropServiceCropAtSuccessSchema: Schema.Codec<Crop.CropState | null, unknown> =
  Schema.NullOr(Crop.CropStateSchema)
export const CropServiceMatureYieldsSuccessSchema: Schema.Codec<ReadonlyArray<ItemStack> | null, unknown> =
  Crop.MatureYieldsSchema
export const CropServiceRemoveSuccessSchema: Schema.Codec<Crop.CropState | null, unknown> =
  Schema.NullOr(Crop.CropStateSchema)
export const CropServiceAdvanceSuccessSchema: Schema.Codec<void, undefined> = Schema.Undefined
export const CropServiceAdvanceByBoneMealSuccessSchema: Schema.Codec<boolean, boolean> = Schema.Boolean
export const CropServiceSnapshotSuccessSchema: Schema.Codec<Crop.CropSnapshot, unknown> =
  Crop.CropSnapshotSchema
export const CropServiceRestoreSuccessSchema: Schema.Codec<void, undefined> = Schema.Undefined
export const CropServiceResetSuccessSchema: Schema.Codec<void, undefined> = Schema.Undefined

export const CropServiceValidationErrorSchema: Schema.Codec<Crop.CropValidationError, unknown> =
  Crop.CropValidationErrorSchema
export const CropServiceMatureYieldsErrorSchema: Schema.Codec<
  ItemStackFailure | Crop.CropValidationError,
  unknown
> = Schema.Union([Inventory.ItemStackFailureSchema, Crop.CropValidationErrorSchema])
export const CropServiceNoFailureSchema: Schema.Codec<never, never> = Schema.Never

const CropServiceBase: Context.ServiceClass<CropService, '@nerima-games/mc-sim/CropService', CropServiceApi> =
  Context.Service<CropService, CropServiceApi>()('@nerima-games/mc-sim/CropService')

export class CropService extends CropServiceBase {}

const copyCrop = (crop: Crop.CropState): Crop.CropState => ({
  ...crop,
  position: { ...crop.position },
})

const sortedCrops = (crops: Iterable<Crop.CropState>): ReadonlyArray<Crop.CropState> =>
  Array.from(crops, copyCrop).sort((left, right) =>
    Crop.cropLocationKey(left).localeCompare(Crop.cropLocationKey(right), 'en'),
  )


const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const cropValidationError = (path: string, reason: string): Crop.CropValidationError => ({
  _tag: 'CropValidationError',
  path,
  reason,
})

const decodeCropLocation = (
  value: unknown,
): Effect.Effect<Crop.CropLocation, Crop.CropValidationError> => {
  if (!isRecord(value)) {
    return Effect.fail(cropValidationError('location', 'expected a valid dimension and block position'))
  }
  const dimension = value['dimension']
  const position = value['position']
  if (!isDimension(dimension) || !isRecord(position)) {
    return Effect.fail(cropValidationError('location', 'expected a valid dimension and block position'))
  }
  const x = position['x']
  const y = position['y']
  const z = position['z']
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' ||
      !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Number.isSafeInteger(z)) {
    return Effect.fail(cropValidationError('location.position', 'coordinates must be safe integers'))
  }
  const axes = Result.all([BlockAxis.result(x), BlockAxis.result(y), BlockAxis.result(z)])
  if (Result.isFailure(axes)) {
    return Effect.fail(cropValidationError('location.position', 'coordinates must be safe integers'))
  }
  return Effect.succeed({ dimension, position: { x: axes.success[0], y: axes.success[1], z: axes.success[2] } })
}

const decodeCropType = (
  value: unknown,
): Effect.Effect<Crop.CropType, Crop.CropValidationError> =>
  Crop.isCropType(value)
    ? Effect.succeed(value)
    : Effect.fail(cropValidationError('crop', 'unknown crop type'))

const decodeSoil = (
  value: unknown,
): Effect.Effect<BlockType, Crop.CropValidationError> =>
  isBlockType(value)
    ? Effect.succeed(value)
    : Effect.fail(cropValidationError('soil', 'unknown block type'))

export const makeCropService = (): Effect.Effect<CropServiceApi> =>
  Effect.map(Ref.make(new Map<string, Crop.CropState>()), (state) => ({
    plant: (location, crop = 'potato_crop', soil) => Effect.gen(function* () {
      const validCrop = yield* decodeCropType(crop)
      const validLocation = yield* decodeCropLocation(location)
      const validSoil = soil === undefined
        ? Crop.cropDefinitionFor(validCrop).soil
        : yield* decodeSoil(soil)
      return yield* Ref.modify(state, (current) => {
        const key = Crop.cropLocationKey(validLocation)
        if (current.has(key) || !Crop.canPlantCrop(validCrop, validSoil, validLocation.dimension)) {
          return [false, current]
        }
        const next = new Map(current)
        next.set(key, {
          ...validLocation,
          position: { ...validLocation.position },
          crop: validCrop,
          growthSecs: 0,
        })
        return [true, next]
      })
    }),
    cropAt: (location) => Effect.flatMap(decodeCropLocation(location), (validLocation) =>
      Effect.map(Ref.get(state), (current) => {
        const crop = current.get(Crop.cropLocationKey(validLocation))
        return crop === undefined ? null : copyCrop(crop)
      }),
    ),
    matureYieldsAt: (location) => Effect.flatMap(decodeCropLocation(location), (validLocation) =>
      Effect.flatMap(Ref.get(state), (current) => {
        const crop = current.get(Crop.cropLocationKey(validLocation))
        return crop === undefined
          ? Effect.succeed(null)
          : Effect.fromResult(Crop.matureYieldsFor(crop))
      }),
    ),
    remove: (location) => Effect.flatMap(decodeCropLocation(location), (validLocation) =>
      Ref.modify(state, (current) => {
        const key = Crop.cropLocationKey(validLocation)
        const crop = current.get(key)
        if (crop === undefined) return [null, current]
        const next = new Map(current)
        next.delete(key)
        return [copyCrop(crop), next]
      }),
    ),
    advance: (delta) =>
      Effect.map(Ref.update(state, (current) =>
        new Map(Array.from(current, ([key, crop]) => [key, Crop.advanceCrop(crop, delta)])),
      ), () => undefined),
    advanceByBoneMeal: (location) => Effect.flatMap(decodeCropLocation(location), (validLocation) =>
      Ref.modify(state, (current) => {
        const key = Crop.cropLocationKey(validLocation)
        const crop = current.get(key)
        if (crop === undefined || Crop.isMatureCrop(crop)) return [false, current]
        const next = new Map(current)
        next.set(key, Crop.advanceCropByBoneMeal(crop))
        return [true, next]
      }),
    ),
    snapshot: Effect.map(Ref.get(state), (current) => ({ crops: sortedCrops(current.values()) })),
    restore: (snapshot) => {
      const validated = Crop.validateCropSnapshot(snapshot)
      return validated._tag === 'Invalid'
        ? Effect.fail(validated.error)
        : Effect.map(Ref.set(
            state,
            new Map(validated.snapshot.crops.map((crop) => [Crop.cropLocationKey(crop), copyCrop(crop)])),
          ), () => undefined)
    },
    reset: Effect.map(Ref.set(state, new Map()), () => undefined),
  }))

export const CropServiceLayer: Layer.Layer<CropService> = Layer.effect(CropService, makeCropService())
