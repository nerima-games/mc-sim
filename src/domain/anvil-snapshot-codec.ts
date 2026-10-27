/* eslint-disable no-magic-numbers, no-undefined, no-ternary, prefer-destructuring, sort-keys -- Snapshot validation reports every wire-level issue with its exact path. */
import { Brand, Result, Schema, SchemaTransformation } from 'effect'
import {
  ANVIL_SNAPSHOT_VERSION,
  anvilCustomNameFromValidated,
  anvilEnchantmentIdFromValidated,
  isCustomName,
  isEnchantmentId,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
} from './anvil-primitives.js'
import { canonicalEnchantments } from './anvil-normalization.js'
import { maxStackCountOfItem } from '@nerima-games/mc-kernel'
import { isItemType } from '@nerima-games/mc-kernel'
import { StackCount } from '@nerima-games/mc-kernel'
import type {
  AnvilDurability,
  AnvilEnchantment,
  AnvilCustomName as AnvilCustomNameType,
  AnvilSnapshotEncodingResult,
  AnvilSnapshotResult,
  AnvilEnchantmentId as AnvilEnchantmentIdType,
  AnvilSnapshotString as AnvilSnapshotStringType,
  AnvilState,
  AnvilValidationIssue,
  CanonicalAnvilItemPayload,
  CanonicalAnvilState,
} from './anvil.js'

const brandAnvilSnapshotString = Brand.nominal<AnvilSnapshotStringType>()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Reject a key this format does not define.
 *
 * The snapshot carries an explicit version, and that is the mechanism a new
 * field arrives through. So an extra key at a version this decoder recognises
 * is not a newer format being read by an older reader — it is corruption, or a
 * producer that disagrees with this one. Accepting it silently would turn
 * either into missing state rather than a reported failure, and the shape
 * freezes at 1.0.0.
 */
const rejectUnknownKeys = (
  value: Record<string, unknown>,
  known: ReadonlySet<string>,
  path: string,
  issues: Array<AnvilValidationIssue>,
): void => {
  // `for...in` with a hasOwn guard rather than `Object.keys`, and a Set rather
  // than an array: this runs once per record on the decode path, and the first
  // version — which allocated a key array and scanned a list per key — measured
  // 35% slower on the snapshot-decoding benchmark than no check at all.
  for (const key in value) {
    if (Object.hasOwn(value, key) && !known.has(key)) {
      issues.push({ path: `${path}.${key}`, reason: 'is not a field of this format' })
    }
  }
}

// Hoisted so decoding a record does not build its own key set every call.
const SNAPSHOT_KEYS: ReadonlySet<string> = new Set(['version', 'state'])
const STATE_KEYS: ReadonlySet<string> = new Set(['left', 'right', 'rename', 'experienceLevels'])
const ITEM_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  'item',
  'durability',
  'enchantments',
  'repairCost',
  'customName',
])
const DURABILITY_KEYS: ReadonlySet<string> = new Set(['current', 'max'])
const ENCHANTMENT_KEYS: ReadonlySet<string> = new Set(['id', 'level'])
const INPUT_STACK_KEYS: ReadonlySet<string> = new Set(['payload', 'count'])

const decodeDurability = (
  value: unknown,
  path: string,
  issues: Array<AnvilValidationIssue>,
): AnvilDurability | null | undefined => {
  if (value === null) return null
  if (
    isRecord(value) &&
    isPositiveSafeInteger(value['current']) &&
    isPositiveSafeInteger(value['max']) &&
    value['current'] <= value['max']
  ) {
    rejectUnknownKeys(value, DURABILITY_KEYS, path, issues)
    return { current: value['current'], max: value['max'] }
  }

  issues.push({ path, reason: 'must be null or valid remaining durability' })
  return
}

const decodeCustomName = (
  value: unknown,
  path: string,
  issues: Array<AnvilValidationIssue>,
): AnvilCustomNameType | null | undefined => {
  if (value === null) return null
  if (typeof value === 'string' && isCustomName(value)) return anvilCustomNameFromValidated(value)

  issues.push({ path, reason: 'must be null or a valid custom name' })
  return
}

const decodeEnchantment = (
  candidate: unknown,
  path: string,
  seen: Set<AnvilEnchantmentIdType>,
  issues: Array<AnvilValidationIssue>,
): AnvilEnchantment | undefined => {
  if (!isRecord(candidate)) {
    issues.push({ path, reason: 'must be an object' })
    return
  }

  const id = candidate['id']
  const level = candidate['level']
  if (!isEnchantmentId(id)) {
    issues.push({ path: `${path}.id`, reason: 'must be a canonical enchantment id' })
    return
  }
  if (!isPositiveSafeInteger(level)) {
    issues.push({ path: `${path}.level`, reason: 'must be a positive safe integer' })
    return
  }

  const canonicalId = anvilEnchantmentIdFromValidated(id)
  if (seen.has(canonicalId)) {
    issues.push({ path: `${path}.id`, reason: 'must be unique' })
    return
  }

  rejectUnknownKeys(candidate, ENCHANTMENT_KEYS, path, issues)
  seen.add(canonicalId)
  return { id: canonicalId, level }
}

const decodeEnchantments = (
  value: unknown,
  path: string,
  issues: Array<AnvilValidationIssue>,
): Array<AnvilEnchantment> => {
  if (!Array.isArray(value)) {
    issues.push({ path, reason: 'must be an array' })
    return []
  }

  const seen = new Set<AnvilEnchantmentIdType>()
  const enchantments: Array<AnvilEnchantment> = []
  for (const [index, candidate] of value.entries()) {
    const enchantment = decodeEnchantment(candidate, `${path}.${String(index)}`, seen, issues)
    if (enchantment !== undefined) enchantments.push(enchantment)
  }
  return enchantments
}

const decodeItemPayload = (
  value: unknown,
  path: string,
  issues: Array<AnvilValidationIssue>,
): CanonicalAnvilItemPayload | undefined => {
  if (!isRecord(value)) {
    issues.push({ path, reason: 'must be an object' })
    return
  }

  rejectUnknownKeys(value, ITEM_PAYLOAD_KEYS, path, issues)

  const itemValue = value['item']
  const item = typeof itemValue === 'string' && isItemType(itemValue) ? itemValue : undefined
  if (item === undefined) issues.push({ path: `${path}.item`, reason: 'must be a known item type' })

  const durability = decodeDurability(value['durability'], `${path}.durability`, issues)

  const repairCostValue = value['repairCost'] === undefined ? 0 : value['repairCost']
  const repairCost = isNonNegativeSafeInteger(repairCostValue) ? repairCostValue : undefined
  if (repairCost === undefined) {
    issues.push({ path: `${path}.repairCost`, reason: 'must be a non-negative safe integer' })
  }

  const customName = decodeCustomName(value['customName'] ?? null, `${path}.customName`, issues)
  const enchantments = decodeEnchantments(value['enchantments'], `${path}.enchantments`, issues)

  if (
    item === undefined ||
    durability === undefined ||
    repairCost === undefined ||
    customName === undefined
  ) return

  return {
    item,
    durability: durability === null ? null : { ...durability },
    enchantments: canonicalEnchantments(enchantments),
    repairCost,
    customName,
  }
}

const decodeRightInput = (
  value: unknown,
  path: string,
  issues: Array<AnvilValidationIssue>,
): CanonicalAnvilState['right'] | undefined => {
  if (value === null) return null
  if (!isRecord(value)) {
    issues.push({ path, reason: 'must be null or an input stack' })
    return
  }

  rejectUnknownKeys(value, INPUT_STACK_KEYS, path, issues)

  const payload = decodeItemPayload(value['payload'], `${path}.payload`, issues)
  const countValue = value['count']
  if (typeof countValue !== 'number') {
    issues.push({ path: `${path}.count`, reason: 'must be a positive safe integer' })
    return
  }
  const count = StackCount.result(countValue)
  if (Result.isFailure(count)) {
    issues.push({ path: `${path}.count`, reason: count.failure.message })
    return
  }
  if (payload !== undefined && countValue > maxStackCountOfItem(payload.item)) {
    issues.push({ path: `${path}.count`, reason: 'exceeds the item stack limit' })
    return
  }
  if (payload !== undefined && payload.durability !== null && countValue !== 1) {
    issues.push({ path: `${path}.count`, reason: 'durable item payloads cannot stack' })
    return
  }
  if (payload === undefined) return

  return { payload, count: count.success }
}

const decodeState = (
  value: unknown,
  path: string,
  issues: Array<AnvilValidationIssue>,
): CanonicalAnvilState | undefined => {
  if (!isRecord(value)) {
    issues.push({ path, reason: 'must be an object' })
    return
  }

  rejectUnknownKeys(value, STATE_KEYS, path, issues)

  const leftValue = value['left']
  const left = leftValue === null ? null : decodeItemPayload(leftValue, `${path}.left`, issues)

  const right = decodeRightInput(value['right'], `${path}.right`, issues)

  const rename = decodeCustomName(value['rename'], `${path}.rename`, issues)

  const experienceLevelsValue = value['experienceLevels']
  const experienceLevels = isNonNegativeSafeInteger(experienceLevelsValue)
    ? experienceLevelsValue
    : undefined
  if (experienceLevels === undefined) {
    issues.push({ path: `${path}.experienceLevels`, reason: 'must be a non-negative safe integer' })
  }

  if (left === undefined || right === undefined || rename === undefined || experienceLevels === undefined) {
    return
  }
  return { left, right, rename, experienceLevels }
}

export function snapshotAnvilState(state: AnvilState): AnvilSnapshotResult
export function snapshotAnvilState(state: AnvilState): AnvilSnapshotResult {
  const issues: Array<AnvilValidationIssue> = []
  const decoded = decodeState(state, '$.state', issues)
  return decoded === undefined || issues.length > 0
    ? { ok: false, issues }
    : { ok: true, snapshot: { version: ANVIL_SNAPSHOT_VERSION, state: decoded } }
}

export const decodeAnvilSnapshot = (value: unknown): AnvilSnapshotResult => {
  const issues: Array<AnvilValidationIssue> = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '$', reason: 'must be an object' }] }
  rejectUnknownKeys(value, SNAPSHOT_KEYS, '$', issues)
  if (value['version'] !== ANVIL_SNAPSHOT_VERSION) {
    issues.push({ path: '$.version', reason: `must be ${String(ANVIL_SNAPSHOT_VERSION)}` })
  }
  const state = decodeState(value['state'], '$.state', issues)
  return state === undefined || issues.length > 0
    ? { ok: false, issues }
    : { ok: true, snapshot: { version: ANVIL_SNAPSHOT_VERSION, state } }
}

const ANVIL_SNAPSHOT_JSON_SCHEMA = Schema.String.pipe(
  Schema.decodeTo(Schema.Unknown, SchemaTransformation.fromJsonString()),
)

export const decodeAnvilSnapshotString = (encoded: string): AnvilSnapshotResult => {
  const parsed = Schema.decodeUnknownResult(ANVIL_SNAPSHOT_JSON_SCHEMA)(encoded)
  if (Result.isFailure(parsed)) {
    return { ok: false, issues: [{ path: '$', reason: 'must be valid JSON' }] }
  }
  return decodeAnvilSnapshot(parsed.success)
}

/** Narrow external snapshot storage text to a validated branded token. */
export const isAnvilSnapshotString = (value: string): value is AnvilSnapshotStringType =>
  decodeAnvilSnapshotString(value).ok

/** Validate an external JSON snapshot string before it becomes a branded persistence token. */
export const AnvilSnapshotString = (
  value: string,
): Result.Result<AnvilSnapshotStringType, Extract<AnvilSnapshotResult, { readonly ok: false }>> => {
  const decoded = decodeAnvilSnapshotString(value)
  return decoded.ok
    ? Result.succeed(brandAnvilSnapshotString(value))
    : Result.fail(decoded)
}

export function encodeAnvilSnapshot(state: AnvilState): AnvilSnapshotEncodingResult
export function encodeAnvilSnapshot(state: AnvilState): AnvilSnapshotEncodingResult {
  const snapshot = snapshotAnvilState(state)
  if (!snapshot.ok) return snapshot

  // snapshotAnvilState has already canonicalized and validated every field.
  // Re-entering AnvilSnapshotString here would parse and validate this fresh
  // snapshot a second time, while the public constructor still validates text
  // supplied by callers.
  const encoded = brandAnvilSnapshotString(JSON.stringify(snapshot.snapshot))
  return { ok: true, encoded, snapshot: snapshot.snapshot }
}
