import { describe, expect, it } from '@effect/vitest'
import { blockIdOf } from '@nerima-games/mc-kernel'
import { breakBlock, placeBlock, placeableBlockFromItem } from '../src/domain/block-interaction'

describe('breakBlock', () => {
  it('rejects unknown ids and air', () => {
    expect(breakBlock(-1)).toStrictEqual({ kind: 'blocked', reason: 'unknown' })
    expect(breakBlock(blockIdOf('air'))).toStrictEqual({ kind: 'blocked', reason: 'air' })
  })

  it('keeps unbreakable blocks out of the drop pipeline', () => {
    expect(breakBlock(blockIdOf('bedrock'))).toStrictEqual({ kind: 'blocked', reason: 'unbreakable' })
    expect(breakBlock(blockIdOf('end_portal_frame'))).toStrictEqual({
      kind: 'blocked',
      reason: 'unbreakable',
    })
  })

  it('uses the kernel harvest context to resolve drops', () => {
    expect(breakBlock(blockIdOf('stone'))).toStrictEqual({
      kind: 'broken',
      id: blockIdOf('stone'),
      type: 'stone',
      experience: 0,
    })
    expect(breakBlock(blockIdOf('stone'), { heldTier: 'wooden' })).toStrictEqual({
      kind: 'broken',
      id: blockIdOf('stone'),
      type: 'stone',
      drop: { item: 'cobblestone', count: 1, affectedByFortune: false },
      experience: 0,
    })
  })
})

describe('placeBlock', () => {
  it('rejects unknown ids and air', () => {
    expect(placeBlock(-1, blockIdOf('stone'))).toStrictEqual({ kind: 'rejected', reason: 'unknown-block' })
    expect(placeBlock(blockIdOf('air'), blockIdOf('stone'))).toStrictEqual({ kind: 'rejected', reason: 'air' })
  })

  it('delegates support-sensitive placement to the kernel registry', () => {
    expect(placeBlock(blockIdOf('stone'), blockIdOf('air'))).toStrictEqual({
      kind: 'placed',
      id: blockIdOf('stone'),
      type: 'stone',
    })
    expect(placeBlock(blockIdOf('torch'), blockIdOf('air'))).toStrictEqual({
      kind: 'rejected',
      reason: 'unsupported',
    })
    expect(placeBlock(blockIdOf('torch'), blockIdOf('stone'))).toStrictEqual({
      kind: 'placed',
      id: blockIdOf('torch'),
      type: 'torch',
    })
    expect(placeBlock(blockIdOf('lily_pad'), blockIdOf('stone'))).toStrictEqual({
      kind: 'rejected',
      reason: 'unsupported',
    })
    expect(placeBlock(blockIdOf('lily_pad'), blockIdOf('water'))).toStrictEqual({
      kind: 'placed',
      id: blockIdOf('lily_pad'),
      type: 'lily_pad',
    })
  })
})

describe('placeableBlockFromItem', () => {
  it('derives the placeable block from the kernel item/block intersection', () => {
    expect(placeableBlockFromItem('stone')).toStrictEqual({ id: blockIdOf('stone'), type: 'stone' })
    expect(placeableBlockFromItem('stick')).toBeUndefined()
  })
})
