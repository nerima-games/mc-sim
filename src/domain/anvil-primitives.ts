/* eslint-disable no-control-regex -- Custom names must reject the JSON control-character range. */
import { Brand, Result } from 'effect'
import type {
  AnvilCustomName as AnvilCustomNameType,
  AnvilEnchantmentId as AnvilEnchantmentIdType,
} from './anvil.js'

export const ANVIL_SNAPSHOT_VERSION = 1
export const ANVIL_MAX_CUSTOM_NAME_LENGTH = 50

/** Material consumed by an anvil operation; zero means the right input contributed nothing. */
export type AnvilMaterialCost = number & Brand.Brand<'AnvilMaterialCost'>

const anvilMaterialCostBrand: Brand.Constructor<AnvilMaterialCost> = Brand.make<AnvilMaterialCost>(
  (value) => Number.isSafeInteger(value) && value >= 0 && value <= 99
    ? true
    : `AnvilMaterialCost must be an integer in [0, 99], received ${String(value)}`,
)
const trustedAnvilMaterialCost = Brand.nominal<AnvilMaterialCost>()

export type AnvilPrimitiveFailure = Readonly<{
  readonly _tag: 'AnvilPrimitiveFailure'
  readonly brand: 'AnvilEnchantmentId' | 'AnvilCustomName'
  readonly value: string
  readonly message: string
}>

const anvilEnchantmentIdBrand = Brand.nominal<AnvilEnchantmentIdType>()
const anvilCustomNameBrand = Brand.nominal<AnvilCustomNameType>()

/** Construct a cost in code paths whose arithmetic guarantees the [0, 99] range. */
export const anvilMaterialCostFromInvariant = (value: number): AnvilMaterialCost =>
  trustedAnvilMaterialCost(value)

export const AnvilMaterialCost = (value: number): Result.Result<AnvilMaterialCost, Brand.BrandError> =>
  anvilMaterialCostBrand.result(value)

export const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export const isEnchantmentId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9_.:/-]{0,127}$/.test(value)

export const isCustomName = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= ANVIL_MAX_CUSTOM_NAME_LENGTH &&
  !/[\u0000-\u001f\u007f]/.test(value)

/** Narrow external text to a canonical enchantment id. */
export const isAnvilEnchantmentId = (value: unknown): value is AnvilEnchantmentIdType => isEnchantmentId(value)

/** Narrow external text to a canonical custom name. */
export const isAnvilCustomName = (value: unknown): value is AnvilCustomNameType => isCustomName(value)

export const anvilEnchantmentIdFromValidated = (value: string): AnvilEnchantmentIdType =>
  anvilEnchantmentIdBrand(value)

export const AnvilEnchantmentId = (value: string): Result.Result<AnvilEnchantmentIdType, AnvilPrimitiveFailure> =>
  isAnvilEnchantmentId(value)
    ? Result.succeed(anvilEnchantmentIdBrand(value))
    : Result.fail({
        _tag: 'AnvilPrimitiveFailure',
        brand: 'AnvilEnchantmentId',
        value,
        message: `Invalid AnvilEnchantmentId: ${value}`,
      })

export const anvilCustomNameFromValidated = (value: string): AnvilCustomNameType =>
  anvilCustomNameBrand(value)

export const AnvilCustomName = (value: string): Result.Result<AnvilCustomNameType, AnvilPrimitiveFailure> =>
  isAnvilCustomName(value)
    ? Result.succeed(anvilCustomNameBrand(value))
    : Result.fail({
        _tag: 'AnvilPrimitiveFailure',
        brand: 'AnvilCustomName',
        value,
        message: `Invalid AnvilCustomName: ${value}`,
      })
