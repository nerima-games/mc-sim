import { describe, expect, it } from '@effect/vitest'
import { type BlockType, blockIdOf } from '@nerima-games/mc-kernel'
import { Option, Result } from 'effect'
import { breakBlock, placeBlock, placeableBlockFromItem } from '../src/domain/block-interaction'

const id = (type: BlockType) => Option.getOrThrow(blockIdOf(type))

describe('breakBlock', () => {
  it('rejects unknown ids and air', () => {
    expect(Result.getOrThrow(breakBlock(65535))).toStrictEqual({ kind: 'blocked', reason: 'unknown' })
    expect(Result.getOrThrow(breakBlock(id('air')))).toStrictEqual({ kind: 'blocked', reason: 'air' })
  })

  it('propagates invalid block-id failures', () => {
    expect(Result.isFailure(breakBlock(-1))).toBe(true)
  })

  it('keeps unbreakable blocks out of the drop pipeline', () => {
    expect(Result.getOrThrow(breakBlock(id('bedrock')))).toStrictEqual({ kind: 'blocked', reason: 'unbreakable' })
    expect(Result.getOrThrow(breakBlock(id('end_portal_frame')))).toStrictEqual({
      kind: 'blocked',
      reason: 'unbreakable',
    })
  })

  it('uses the kernel harvest context to resolve drops', () => {
    expect(Result.getOrThrow(breakBlock(id('stone')))).toStrictEqual({
      kind: 'broken',
      id: id('stone'),
      type: 'stone',
      experience: 0,
    })
    expect(Result.getOrThrow(breakBlock(id('stone'), { heldTier: 'wooden' }))).toStrictEqual({
      kind: 'broken',
      id: id('stone'),
      type: 'stone',
      drop: { item: 'cobblestone', count: 1, affectedByFortune: false },
      experience: 0,
    })
  })
})

describe('placeBlock', () => {
  it('rejects unknown ids and air', () => {
    expect(Result.getOrThrow(placeBlock(65535, id('stone')))).toStrictEqual({
      kind: 'rejected',
      reason: 'unknown-block',
    })
    expect(Result.getOrThrow(placeBlock(id('air'), id('stone')))).toStrictEqual({
      kind: 'rejected',
      reason: 'air',
    })
  })

  it('propagates invalid block-id failures', () => {
    expect(Result.isFailure(placeBlock(-1, id('stone')))).toBe(true)
    expect(Result.isFailure(placeBlock(id('stone'), -1))).toBe(true)
  })

  it('delegates support-sensitive placement to the kernel registry', () => {
    expect(Result.getOrThrow(placeBlock(id('stone'), id('air')))).toStrictEqual({
      kind: 'placed',
      id: id('stone'),
      type: 'stone',
    })
    expect(Result.getOrThrow(placeBlock(id('torch'), id('air')))).toStrictEqual({
      kind: 'rejected',
      reason: 'unsupported',
    })
    expect(Result.getOrThrow(placeBlock(id('torch'), id('stone')))).toStrictEqual({
      kind: 'placed',
      id: id('torch'),
      type: 'torch',
    })
    expect(Result.getOrThrow(placeBlock(id('lily_pad'), id('stone')))).toStrictEqual({
      kind: 'rejected',
      reason: 'unsupported',
    })
    expect(Result.getOrThrow(placeBlock(id('lily_pad'), id('water')))).toStrictEqual({
      kind: 'placed',
      id: id('lily_pad'),
      type: 'lily_pad',
    })
  })
})

describe('placeableBlockFromItem', () => {
  it('derives the placeable block from the kernel item/block intersection', () => {
    expect(Result.getOrThrow(placeableBlockFromItem('stone'))).toStrictEqual({
      id: id('stone'),
      type: 'stone',
    })
    expect(Result.getOrThrow(placeableBlockFromItem('stick'))).toBeUndefined()
  })
})
