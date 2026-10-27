import { Result, Schema } from 'effect'
import { BlockAxis, type BlockPosition } from '@nerima-games/mc-kernel/domain/coordinates'
import { DIMENSIONS, isDimension, type BlockType, type Dimension, type ItemType } from '@nerima-games/mc-kernel'
import { ItemStackSchema, itemStack, type ItemStack, type ItemStackFailure } from './inventory.js'

export const CROP_TYPES = ['wheat_crop', 'potato_crop', 'nether_wart_crop'] as const

export type CropType = (typeof CROP_TYPES)[number]

export const WHEAT_MATURITY_SECS = 480
export const POTATO_MATURITY_SECS = 480
export const NETHER_WART_MATURITY_SECS = 480
export const BONE_MEAL_GROWTH_SECS = 30

export type CropDefinition = {
  readonly crop: CropType
  readonly maturitySecs: number
  readonly seed: ItemType
  readonly soil: BlockType
  readonly dimensions: ReadonlyArray<Dimension>
  readonly guaranteedMatureYield: Result.Result<ReadonlyArray<ItemStack>, ItemStackFailure>
}

const ALL_DIMENSIONS = DIMENSIONS

export const CROP_REGISTRY: Record<CropType, CropDefinition> = {
  wheat_crop: {
    crop: 'wheat_crop',
    maturitySecs: WHEAT_MATURITY_SECS,
    seed: 'wheat_seeds',
    soil: 'farmland',
    dimensions: ALL_DIMENSIONS,
    guaranteedMatureYield: Result.all([itemStack('wheat', 1), itemStack('wheat_seeds', 1)]),
  },
  potato_crop: {
    crop: 'potato_crop',
    maturitySecs: POTATO_MATURITY_SECS,
    seed: 'potato',
    soil: 'farmland',
    dimensions: ALL_DIMENSIONS,
    guaranteedMatureYield: Result.all([itemStack('potato', 2)]),
  },
  nether_wart_crop: {
    crop: 'nether_wart_crop',
    maturitySecs: NETHER_WART_MATURITY_SECS,
    seed: 'nether_wart',
    soil: 'soul_sand',
    dimensions: ALL_DIMENSIONS,
    guaranteedMatureYield: Result.all([itemStack('nether_wart', 2)]),
  },
} as const

export type CropLocation = {
  readonly dimension: Dimension
  readonly position: BlockPosition
}

export type CropState = CropLocation & {
  readonly crop: CropType
  readonly growthSecs: number
}

export type CropSnapshot = {
  readonly crops: ReadonlyArray<CropState>
}

export const MatureYieldsSchema: Schema.Schema<ReadonlyArray<ItemStack> | null> = Schema.Union([
  Schema.Array(ItemStackSchema),
  Schema.Null,
])

export type CropValidationError = {
  readonly _tag: 'CropValidationError'
  readonly path: string
  readonly reason: string
}

export type CropValidationResult =
  | { readonly _tag: 'Valid'; readonly snapshot: CropSnapshot }
  | { readonly _tag: 'Invalid'; readonly error: CropValidationError }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isCropType = (value: unknown): value is CropType =>
  typeof value === 'string' && CROP_TYPES.some((crop) => crop === value)


export const cropDefinitionFor = (crop: CropType): CropDefinition => CROP_REGISTRY[crop]

export const maturitySecsFor = (crop: CropType): number => cropDefinitionFor(crop).maturitySecs

export const canPlantCrop = (crop: CropType, soil: BlockType, dimension: Dimension): boolean => {
  const definition = cropDefinitionFor(crop)
  return definition.soil === soil && definition.dimensions.includes(dimension)
}

export const isMatureCrop = (crop: CropState): boolean =>
  crop.growthSecs >= maturitySecsFor(crop.crop)

/** Guaranteed mature drops. mx-gameplay may add randomized bonus drops separately. */
export const matureYieldsFor = (
  crop: CropState,
): Result.Result<ReadonlyArray<ItemStack> | null, ItemStackFailure> =>
  isMatureCrop(crop)
    ? Result.map(cropDefinitionFor(crop.crop).guaranteedMatureYield, (stacks) =>
        stacks.map((stack) => ({ ...stack })))
    : Result.succeed(null)

const nonNegativeFinite = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0

export const advanceCrop = (crop: CropState, deltaSecs: number): CropState => {
  const maturitySecs = maturitySecsFor(crop.crop)
  return {
    ...crop,
    growthSecs: Math.min(
      maturitySecs,
      nonNegativeFinite(crop.growthSecs) + nonNegativeFinite(deltaSecs),
    ),
  }
}

export const advanceCropByBoneMeal = (crop: CropState): CropState =>
  advanceCrop(crop, BONE_MEAL_GROWTH_SECS)

const hasExactKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const invalid = (path: string, reason: string): CropValidationResult => ({
  _tag: 'Invalid',
  error: { _tag: 'CropValidationError', path, reason },
})

export const cropLocationKey = ({ dimension, position }: CropLocation): string =>
  JSON.stringify([dimension, position.x, position.y, position.z])

export const validateCropSnapshot = (value: unknown): CropValidationResult => {
  if (!isRecord(value) || !hasExactKeys(value, ['crops']) || !Array.isArray(value['crops'])) {
    return invalid('snapshot', 'expected exactly { crops: CropState[] }')
  }

  const crops: Array<CropState> = []
  const occupied = new Set<string>()

  for (const [index, candidate] of value['crops'].entries()) {
    const path = `crops[${String(index)}]`
    if (!isRecord(candidate) ||
      !hasExactKeys(candidate, ['dimension', 'position', 'crop', 'growthSecs'])) {
      return invalid(path, 'expected exactly dimension, position, crop, and growthSecs')
    }
    if (!isDimension(candidate['dimension'])) return invalid(`${path}.dimension`, 'unknown dimension')
    if (!isCropType(candidate['crop'])) return invalid(`${path}.crop`, 'unknown crop')
    if (!isRecord(candidate['position']) ||
      !hasExactKeys(candidate['position'], ['x', 'y', 'z'])) {
      return invalid(`${path}.position`, 'expected exactly integer x, y, and z')
    }

    const { x, y, z } = candidate['position']
    if ([x, y, z].some((axis) => typeof axis !== 'number' || !Number.isSafeInteger(axis))) {
      return invalid(`${path}.position`, 'coordinates must be safe integers')
    }
    const growthSecs = candidate['growthSecs']
    if (typeof growthSecs !== 'number' || !Number.isFinite(growthSecs) || growthSecs < 0 ||
      growthSecs > maturitySecsFor(candidate['crop'])) {
      return invalid(`${path}.growthSecs`, 'growth must be finite and within the crop maturity range')
    }

    const normalizedAxis = (axisValue: unknown) => {
      const numeric = Number(axisValue)
      return BlockAxis.result(Object.is(numeric, -0) ? 0 : numeric)
    }
    const axes = Result.all([
      normalizedAxis(x),
      normalizedAxis(y),
      normalizedAxis(z),
    ])
    if (Result.isFailure(axes)) return invalid(`${path}.position`, 'coordinates must be safe integers')
    const [blockX, blockY, blockZ] = axes.success
    const position: BlockPosition = { x: blockX, y: blockY, z: blockZ }
    const crop: CropState = {
      dimension: candidate['dimension'],
      position,
      crop: candidate['crop'],
      growthSecs,
    }
    const key = cropLocationKey(crop)
    if (occupied.has(key)) return invalid(path, 'duplicate crop location')
    occupied.add(key)
    crops.push(crop)
  }

  return { _tag: 'Valid', snapshot: { crops } }
}
