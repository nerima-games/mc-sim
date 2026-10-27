import {
  BARE_HANDED,
  BlockId,
  blockIdOf,
  blockOfPlaceableItem,
  canBlockStaySupported,
  dropOfBlockId,
  isPlaceableItem,
  resolvedBlockOfId,
  type BlockDrop,
  type BlockRegistryFailure,
  type BlockRegistryResolutionFailure,
  type BlockType,
  type HarvestContext,
  type ItemType,
  type ResolvedBlock,
} from '@nerima-games/mc-kernel'
import { Option, Result, type Brand } from 'effect'

export type BlockBreakDecision =
  | { readonly kind: 'blocked'; readonly reason: 'unknown' | 'air' | 'unbreakable' }
  | {
      readonly kind: 'broken'
      readonly id: BlockId
      readonly type: BlockType
      readonly drop?: BlockDrop
      readonly experience: number
    }

export type BlockPlacementDecision =
  | { readonly kind: 'rejected'; readonly reason: 'unknown-block' | 'air' | 'unsupported' }
  | { readonly kind: 'placed'; readonly id: BlockId; readonly type: BlockType }

export type PlaceableBlock = { readonly id: BlockId; readonly type: BlockType }

// mc-kernel exposes hardness and piston capability, but not a semantic
// "unbreakable" flag; keep the vanilla sentinel policy at this boundary.
const BEDROCK_HARDNESS = 100
const UNBREAKABLE_HARDNESS = 9000

const isUnbreakable = (block: ResolvedBlock): boolean =>
  block.properties.hardness >= UNBREAKABLE_HARDNESS ||
  (block.capabilities.pistonImmovable && block.properties.hardness >= BEDROCK_HARDNESS)

const brokenDecision = (
  id: BlockId,
  block: ResolvedBlock,
  context: HarvestContext,
): Result.Result<BlockBreakDecision, BlockRegistryResolutionFailure> =>
  Result.map(dropOfBlockId(id, context), (drop) => {
    const base = {
      kind: 'broken' as const,
      id,
      type: block.type,
      experience: block.properties.xpOnBreak,
    }

    return drop === undefined ? base : { ...base, drop }
  })

export const breakBlock = (
  id: number,
  context: HarvestContext = BARE_HANDED,
): Result.Result<BlockBreakDecision, Brand.BrandError | BlockRegistryResolutionFailure> =>
  Result.gen(function* () {
    const blockId = yield* BlockId.result(id)
    const block = yield* resolvedBlockOfId(blockId)

    if (block === undefined) {
      return { kind: 'blocked', reason: 'unknown' }
    }
    if (block.type === 'air') {
      return { kind: 'blocked', reason: 'air' }
    }
    if (isUnbreakable(block)) {
      return { kind: 'blocked', reason: 'unbreakable' }
    }

    return yield* brokenDecision(blockId, block, context)
  })

export const placeBlock = (
  id: number,
  supportBelow: number,
): Result.Result<
  BlockPlacementDecision,
  Brand.BrandError | BlockRegistryResolutionFailure | BlockRegistryFailure
> =>
  Result.gen(function* () {
    const blockId = yield* BlockId.result(id)
    const block = yield* resolvedBlockOfId(blockId)

    if (block === undefined) {
      return { kind: 'rejected', reason: 'unknown-block' }
    }
    if (block.type === 'air') {
      return { kind: 'rejected', reason: 'air' }
    }

    const supportId = yield* BlockId.result(supportBelow)
    const isSupported = yield* canBlockStaySupported(blockId, supportId)
    return isSupported
      ? { kind: 'placed', id: blockId, type: block.type }
      : { kind: 'rejected', reason: 'unsupported' }
  })

export const placeableBlockFromItem = (item: ItemType): PlaceableBlock | undefined => {
  if (!isPlaceableItem(item)) {
    return undefined
  }

  const type = blockOfPlaceableItem(item)
  const id = blockIdOf(type)
  return Option.isSome(id) ? { id: id.value, type } : undefined
}
