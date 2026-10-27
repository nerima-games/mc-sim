import fc from 'fast-check'
import { expect, it } from 'vitest'
import * as Container from '../src/domain/container-storage.js'
import { assertResultContract, finiteTree, hostileValue, invoke, isRecord, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 100, seed: 0x43535452 }
const kinds: ReadonlyArray<Container.ContainerKind> = [
  'chest', 'shulker_box', 'dispenser', 'dropper', 'hopper',
]

const tagged = (value: unknown, tags: ReadonlyArray<string>): boolean =>
  isRecord(value) && typeof value['_tag'] === 'string' && tags.includes(value['_tag'])

type ContainerView = Readonly<Record<string, unknown>> & {
  readonly id: string
  readonly kind: Container.ContainerKind
  readonly slots: ReadonlyArray<unknown>
}

const validContainer = (value: unknown): value is ContainerView => {
  if (!isRecord(value) || typeof value['id'] !== 'string' || !kinds.includes(value['kind'] as Container.ContainerKind) ||
      !Array.isArray(value['slots'])) return false
  const capacity = invoke(Container.containerCapacity, [value['kind']])
  return typeof capacity === 'number' && value['slots'].length === capacity &&
    value['slots'].every((slot) => slot === null || isRecord(slot))
}

type DrainOutcomeView = Readonly<Record<string, unknown>> & {
  readonly storage: Readonly<Record<string, unknown>> & { readonly containers: ReadonlyArray<unknown> }
  readonly result: Readonly<Record<string, unknown>> & { readonly _tag: string }
}

const validDrainOutcome = (value: unknown): value is DrainOutcomeView =>
  isRecord(value) && isRecord(value['storage']) && Array.isArray(value['storage']['containers']) &&
  isRecord(value['result']) && ['Drained', 'ContainerNotFound'].includes(String(value['result']['_tag'])) &&
  finiteTree(value)

it('direct container helpers return typed failures or finite valid values for hostile inputs', () => {
  fc.assert(fc.property(unknownValue, hostileValue, (input, scalar) => {
    const worldId = invoke(Container.worldContainerId, [input])
    assertResultContract(worldId, (success) => typeof success === 'string' && success.length > 0)

    const capacity = invoke(Container.containerCapacity, [input])
    if (typeof capacity === 'number') {
      expect(Number.isSafeInteger(capacity) && capacity > 0).toBe(true)
    } else {
      expect(tagged(capacity, ['InvalidContainerKind'])).toBe(true)
    }

    const empty = invoke(Container.emptyContainer, [input, scalar])
    expect(validContainer(empty) || tagged(empty, ['InvalidContainerId', 'InvalidContainerKind'])).toBe(true)
    expect(finiteTree(empty)).toBe(true)

    const id = invoke(Container.containerIdAt, [scalar, input])
    expect(typeof id === 'string' && id.length > 0 ||
      tagged(id, ['InvalidContainerDimension', 'InvalidContainerPosition'])).toBe(true)
    expect(finiteTree(id)).toBe(true)

    const worldIdAt = invoke(Container.worldContainerIdAt, [input])
    expect(typeof worldIdAt === 'string' && worldIdAt.length > 0 ||
      tagged(worldIdAt, ['InvalidContainerAddress'])).toBe(true)
    expect(finiteTree(worldIdAt)).toBe(true)

    const found = invoke(Container.findContainer, [input, scalar])
    expect(found === undefined || validContainer(found) ||
      tagged(found, ['InvalidContainerId', 'InvalidContainerStorage'])).toBe(true)
    expect(finiteTree(found)).toBe(true)

    const drained = invoke(Container.drainContainer, [input, scalar])
    expect(validDrainOutcome(drained) ||
      tagged(drained, ['InvalidContainerId', 'InvalidContainerStorage'])).toBe(true)
  }), checks)
})

it('container helpers preserve capacities, world keys, lookup copies, and drain results for valid inputs', () => {
  const input = fc.record({
    id: fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/),
    dimension: fc.constantFrom('overworld', 'nether', 'end'),
    x: fc.integer({ min: -1_000_000, max: 1_000_000 }),
    y: fc.integer({ min: -1_000_000, max: 1_000_000 }),
    z: fc.integer({ min: -1_000_000, max: 1_000_000 }),
    kind: fc.constantFrom(...kinds),
  })

  fc.assert(fc.property(input, ({ id, dimension, x, y, z, kind }) => {
    const capacity = invoke(Container.containerCapacity, [kind])
    expect(Number.isSafeInteger(capacity) && Number(capacity) > 0).toBe(true)

    const empty = invoke(Container.emptyContainer, [id, kind])
    expect(validContainer(empty)).toBe(true)
    if (!validContainer(empty)) return
    expect(empty['id']).toBe(id)
    expect(empty['kind']).toBe(kind)
    expect(empty['slots'].every((slot) => slot === null)).toBe(true)

    const position = { x, y, z }
    const idAt = invoke(Container.containerIdAt, [dimension, position])
    expect(idAt).toBe(`${dimension}:${x},${y},${z}`)

    const address = { dimension, position }
    const worldIdAt = invoke(Container.worldContainerIdAt, [address])
    expect(worldIdAt).toBe(idAt)

    const worldId = invoke(Container.worldContainerId, [idAt])
    assertResultContract(worldId, (success) => success === idAt)

    const created = Container.createContainer(Container.emptyContainerStorage(), id, kind)
    const found = invoke(Container.findContainer, [created.storage, id])
    expect(validContainer(found)).toBe(true)
    if (validContainer(found)) {
      expect(found['id']).toBe(id)
      expect(found['kind']).toBe(kind)
      expect(found['slots']).not.toBe(created.storage.containers[0]?.slots)
    }
    expect(invoke(Container.findContainer, [created.storage, 'missing-container'])).toBeUndefined()

    const drained = invoke(Container.drainContainer, [created.storage, id])
    expect(validDrainOutcome(drained)).toBe(true)
    if (validDrainOutcome(drained)) {
      expect(drained['result']['_tag']).toBe('Drained')
      expect(drained['storage']['containers']).toHaveLength(0)
    }
  }), checks)
})

it('container helpers reject malformed positions, addresses, ids, and storage without throwing', () => {
  const throwingPosition = Object.defineProperties({}, {
    x: { enumerable: true, get: () => { throw new Error('hostile coordinate getter') } },
    y: { enumerable: true, value: 0 },
    z: { enumerable: true, value: 0 },
  })
  const positions = fc.constantFrom<unknown>(
    null,
    undefined,
    {},
    { x: '1', y: 2, z: 3 },
    { x: Number.NaN, y: 2, z: 3 },
    { x: Number.POSITIVE_INFINITY, y: 2, z: 3 },
    { x: 1.5, y: 2, z: 3 },
    { x: Symbol('x'), y: 2, z: 3 },
    throwingPosition,
  )
  const addresses = fc.constantFrom<unknown>(
    null,
    undefined,
    {},
    { dimension: '', position: { x: 1, y: 2, z: 3 } },
    { dimension: 'overworld', position: null },
    { dimension: 'overworld', position: { x: 1.5, y: 2, z: 3 } },
    { dimension: 'overworld', position: throwingPosition },
  )
  const invalidStorage = fc.constantFrom<unknown>(
    null,
    undefined,
    {},
    { containers: null },
    { containers: [null] },
    { containers: [{ id: 'broken', kind: 'chest', slots: null }] },
    { containers: [{ id: 'broken', kind: 'chest', slots: Array(27).fill({}) }] },
    { containers: [{ id: 'broken', kind: 'chest', slots: Array(27).fill(null), extra: true }] },
  )

  fc.assert(fc.property(hostileValue, (input) => {
    const worldId = invoke(Container.worldContainerId, [input])
    assertResultContract(worldId, (success) => typeof success === 'string' && success.length > 0)
  }), checks)

  fc.assert(fc.property(positions, (position) => {
    const id = invoke(Container.containerIdAt, ['overworld', position])
    expect(tagged(id, ['InvalidContainerPosition'])).toBe(true)
  }), checks)

  fc.assert(fc.property(addresses, (address) => {
    const id = invoke(Container.worldContainerIdAt, [address])
    expect(tagged(id, ['InvalidContainerAddress'])).toBe(true)
  }), checks)

  fc.assert(fc.property(invalidStorage, (storage) => {
    expect(tagged(invoke(Container.findContainer, [storage, 'broken']), ['InvalidContainerStorage'])).toBe(true)
    expect(tagged(invoke(Container.drainContainer, [storage, 'broken']), ['InvalidContainerStorage'])).toBe(true)
  }), checks)

  for (const id of [null, undefined, '', ' ', 0, Symbol('id')]) {
    expect(tagged(invoke(Container.emptyContainer, [id, 'chest']), ['InvalidContainerId'])).toBe(true)
    expect(tagged(invoke(Container.findContainer, [Container.emptyContainerStorage(), id]), ['InvalidContainerId'])).toBe(true)
    expect(tagged(invoke(Container.drainContainer, [Container.emptyContainerStorage(), id]), ['InvalidContainerId'])).toBe(true)
  }
})
