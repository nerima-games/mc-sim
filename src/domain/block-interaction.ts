import {
  BARE_HANDED,
  blockIdOf,
  blockOfPlaceableItem,
  canBlockStaySupported,
  dropOfBlockId,
  isPlaceableItem,
  resolvedBlockOfId,
  type HarvestContext,
  type ItemType,
  type BlockBreakDecision,
  type BlockPlacementDecision,
  type PlaceableBlock,
  type ResolvedBlock,
} from '@nerima-games/mc-kernel'

export type { BlockBreakDecision, BlockPlacementDecision, PlaceableBlock } from '@nerima-games/mc-kernel'

// mc-kernel exposes hardness and piston capability, but not a semantic
// "unbreakable" flag; keep the vanilla sentinel policy at this boundary.
const BEDROCK_HARDNESS = 100
const UNBREAKABLE_HARDNESS = 9000

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
