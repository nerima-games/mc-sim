import type { BlockPosition, BlockType } from '@nerima-games/mc-kernel'
import { itemStack, type ItemStack } from './inventory'
import type { Dimension } from './worldgen-vocabulary'

export const CROP_TYPES = ['potato_crop'] as const satisfies ReadonlyArray<BlockType>

export type CropType = (typeof CROP_TYPES)[number]

export const POTATO_MATURITY_SECS = 480

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

export const maturitySecsFor = (_crop: CropType): number => POTATO_MATURITY_SECS

export const isMatureCrop = (crop: CropState): boolean =>
  crop.growthSecs >= maturitySecsFor(crop.crop)

/** The guaranteed mature drop. Experience rules may add bonus drops separately. */
export const matureYieldFor = (crop: CropState): ItemStack | null =>
  isMatureCrop(crop) ? itemStack('potato', 2) : null

export const advanceCrop = (crop: CropState, deltaSecs: number): CropState => ({
  ...crop,
  growthSecs: Math.min(maturitySecsFor(crop.crop), crop.growthSecs + deltaSecs),
})

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
