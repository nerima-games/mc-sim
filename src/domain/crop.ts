import type { BlockPosition, BlockType, ItemType } from '@nerima-games/mc-kernel'
import { itemStack, type ItemStack } from './inventory'
import type { Dimension } from './worldgen-vocabulary'

export const CROP_TYPES = ['wheat_crop', 'potato_crop', 'nether_wart_crop'] as const satisfies ReadonlyArray<BlockType>

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
  readonly guaranteedMatureYield: ReadonlyArray<ItemStack>
}

const ALL_DIMENSIONS = ['overworld', 'nether', 'end'] as const satisfies ReadonlyArray<Dimension>

export const CROP_REGISTRY = {
  wheat_crop: {
    crop: 'wheat_crop',
    maturitySecs: WHEAT_MATURITY_SECS,
    seed: 'wheat_seeds',
    soil: 'farmland',
    dimensions: ALL_DIMENSIONS,
    guaranteedMatureYield: [itemStack('wheat', 1), itemStack('wheat_seeds', 1)],
  },
  potato_crop: {
    crop: 'potato_crop',
    maturitySecs: POTATO_MATURITY_SECS,
    seed: 'potato',
    soil: 'farmland',
    dimensions: ALL_DIMENSIONS,
    guaranteedMatureYield: [itemStack('potato', 2)],
  },
  nether_wart_crop: {
    crop: 'nether_wart_crop',
    maturitySecs: NETHER_WART_MATURITY_SECS,
    seed: 'nether_wart',
    soil: 'soul_sand',
    dimensions: ALL_DIMENSIONS,
    guaranteedMatureYield: [itemStack('nether_wart', 2)],
  },
} as const satisfies Record<CropType, CropDefinition>

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

export type CropValidationError = {
  readonly _tag: 'CropValidationError'
  readonly path: string
  readonly reason: string
}

export type CropValidationResult =
  | { readonly _tag: 'Valid'; readonly snapshot: CropSnapshot }
  | { readonly _tag: 'Invalid'; readonly error: CropValidationError }

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
export const matureYieldsFor = (crop: CropState): ReadonlyArray<ItemStack> | null =>
  isMatureCrop(crop)
    ? cropDefinitionFor(crop.crop).guaranteedMatureYield.map((stack) => ({ ...stack }))
    : null

/** The primary guaranteed mature drop retained for backwards compatibility. */
export const matureYieldFor = (crop: CropState): ItemStack | null =>
  matureYieldsFor(crop)?.[0] ?? null

export const advanceCrop = (crop: CropState, deltaSecs: number): CropState => ({
  ...crop,
  growthSecs: Math.min(maturitySecsFor(crop.crop), crop.growthSecs + deltaSecs),
})

export const advanceCropByBoneMeal = (crop: CropState): CropState =>
  advanceCrop(crop, BONE_MEAL_GROWTH_SECS)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const isDimension = (value: unknown): value is Dimension =>
  value === 'overworld' || value === 'nether' || value === 'end'

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
    if (![x, y, z].every((axis) => typeof axis === 'number' && Number.isSafeInteger(axis))) {
      return invalid(`${path}.position`, 'coordinates must be safe integers')
    }
    const growthSecs = candidate['growthSecs']
    if (typeof growthSecs !== 'number' || !Number.isFinite(growthSecs) || growthSecs < 0 ||
      growthSecs > maturitySecsFor(candidate['crop'])) {
      return invalid(`${path}.growthSecs`, 'growth must be finite and within the crop maturity range')
    }

    const crop: CropState = {
      dimension: candidate['dimension'],
      position: { x, y, z } as BlockPosition,
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
