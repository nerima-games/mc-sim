/* eslint-disable no-control-regex -- Custom names must reject the JSON control-character range. */
import { Brand } from 'effect'
import type {
  AnvilCustomName as AnvilCustomNameType,
  AnvilEnchantmentId as AnvilEnchantmentIdType,
} from './anvil.js'

export const ANVIL_SNAPSHOT_VERSION = 1
export const ANVIL_MAX_CUSTOM_NAME_LENGTH = 50

/** Material consumed by an anvil operation; zero means the right input contributed nothing. */
export type AnvilMaterialCost = number & Brand.Brand<'AnvilMaterialCost'>

export const AnvilMaterialCost: Brand.Constructor<AnvilMaterialCost> = Brand.make<AnvilMaterialCost>(
  (value) => Number.isSafeInteger(value) && value >= 0 && value <= 99
    ? true
    : `AnvilMaterialCost must be an integer in [0, 99], received ${String(value)}`,
)

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

/** Narrow external text to a canonical enchantment id without throwing. */
export const isAnvilEnchantmentId = (value: string): value is AnvilEnchantmentIdType => isEnchantmentId(value)

/** Narrow external text to a canonical custom name without throwing. */
export const isAnvilCustomName = (value: string): value is AnvilCustomNameType => isCustomName(value)

export const AnvilEnchantmentId = (value: string): AnvilEnchantmentIdType => {
  if (!isAnvilEnchantmentId(value)) {
    throw new TypeError(`Invalid AnvilEnchantmentId: ${value}`)
  }

  return value
}

export const AnvilCustomName = (value: string): AnvilCustomNameType => {
  if (!isAnvilCustomName(value)) {
    throw new TypeError(`Invalid AnvilCustomName: ${value}`)
  }

  return value
}
