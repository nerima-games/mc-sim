import {
  BARE_HANDED,
  blockIdOf,
  blockOfPlaceableItem,
  canBlockStaySupported,
  dropOfBlockId,
  isPlaceableItem,
  resolvedBlockOfId,
  type BlockDrop,
  type BlockId,
  type BlockType,
  type HarvestContext,
  type ItemType,
} from '@nerima-games/mc-kernel'

// mc-kernel exposes hardness and piston capability, but not a semantic
// "unbreakable" flag; keep the vanilla sentinel policy at this boundary.
const BEDROCK_HARDNESS = 100
const UNBREAKABLE_HARDNESS = 9000

type ResolvedBlock = NonNullable<ReturnType<typeof resolvedBlockOfId>>

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

export type PlaceableBlock = {
  readonly id: BlockId
  readonly type: BlockType
}

const isUnbreakable = (block: ResolvedBlock): boolean =>
  block.properties.hardness >= UNBREAKABLE_HARDNESS ||
  (block.capabilities.pistonImmovable && block.properties.hardness >= BEDROCK_HARDNESS)

const brokenDecision = (block: ResolvedBlock, context: HarvestContext): BlockBreakDecision => {
  const drop = dropOfBlockId(blockIdOf(block.type), context)
  const base = {
    kind: 'broken' as const,
    id: blockIdOf(block.type),
    type: block.type,
    experience: block.properties.xpOnBreak,
  }

  return drop === undefined ? base : { ...base, drop }
}

export const breakBlock = (id: number, context: HarvestContext = BARE_HANDED): BlockBreakDecision => {
  const block = resolvedBlockOfId(id)

  if (block === undefined) {
    return { kind: 'blocked', reason: 'unknown' }
  }
  if (block.type === 'air') {
    return { kind: 'blocked', reason: 'air' }
  }
  if (isUnbreakable(block)) {
    return { kind: 'blocked', reason: 'unbreakable' }
  }

  return brokenDecision(block, context)
}

export const placeBlock = (id: number, supportBelow: number): BlockPlacementDecision => {
  const block = resolvedBlockOfId(id)

  if (block === undefined) {
    return { kind: 'rejected', reason: 'unknown-block' }
  }
  if (block.type === 'air') {
    return { kind: 'rejected', reason: 'air' }
  }
  if (!canBlockStaySupported(id, supportBelow)) {
    return { kind: 'rejected', reason: 'unsupported' }
  }

  return { kind: 'placed', id: blockIdOf(block.type), type: block.type }
}

export const placeableBlockFromItem = (item: ItemType): PlaceableBlock | undefined => {
  if (!isPlaceableItem(item)) {
    return undefined
  }

  const type = blockOfPlaceableItem(item)
  return { id: blockIdOf(type), type }
}
