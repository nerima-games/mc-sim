import fc from 'fast-check'
import { Result } from 'effect'
import { expect, it } from 'vitest'
import * as Container from '../src/domain/container-storage.js'
import { SchemaErrorSchema } from '../src/schema-errors.js'
import { assertResultContract, hostileValue, invoke, unknownValue } from './public-property-helpers.js'

const checks = { numRuns: 100, seed: 0x43535452 }
const kinds: ReadonlyArray<Container.ContainerKind> = [
  'chest', 'shulker_box', 'dispenser', 'dropper', 'hopper',
]

it('direct container helpers handle hostile inputs without throwing', () => {
  fc.assert(fc.property(unknownValue, hostileValue, (input, scalar) => {
    const worldId = Container.worldContainerId(input)
    assertResultContract(
      'container-storage.worldContainerId(hostile value)',
      () => worldId,
      Container.WorldContainerIdSchema,
      SchemaErrorSchema,
    )

    invoke(Container.containerCapacity, [input])
    invoke(Container.emptyContainer, [input, scalar])
    invoke(Container.containerIdAt, [scalar, input])
    invoke(Container.worldContainerIdAt, [input])
    invoke(Container.findContainer, [input, scalar])
    invoke(Container.drainContainer, [input, scalar])
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

    const empty = Container.emptyContainer(id, kind)
    expect(empty.id).toBe(id)
    expect(empty.kind).toBe(kind)
    expect(empty.slots).toHaveLength(Number(capacity))
    expect(empty.slots.every((slot) => slot === null)).toBe(true)

    const position = { x, y, z }
    const idAt = Container.containerIdAt(dimension, position)
    expect(idAt).toBe(`${dimension}:${x},${y},${z}`)

    const address = { dimension, position }
    const worldIdAt = Container.worldContainerIdAt(address)
    expect(worldIdAt).toBe(idAt)

    const worldId = Container.worldContainerId(idAt)
    expect(Result.isSuccess(worldId)).toBe(true)
    assertResultContract(
      'container-storage.worldContainerId(valid id)',
      () => worldId,
      Container.WorldContainerIdSchema,
      SchemaErrorSchema,
    )
    if (Result.isSuccess(worldId)) {
      expect(worldId.success).toBe(idAt)
    }

    const created = Container.createContainer(Container.emptyContainerStorage(), id, kind)
    const source = created.storage.containers[0]
    expect(source).toBeDefined()
    if (source === undefined) return
    const found = Container.findContainer(created.storage, id)
    expect(found).toBeDefined()
    if (found === undefined) return
    expect(found).toStrictEqual(source)
    expect(found).not.toBe(source)
    expect(found.slots).not.toBe(source.slots)
    expect(Container.findContainer(created.storage, 'missing-container')).toBeUndefined()

    const drained = Container.drainContainer(created.storage, id)
    expect(drained.result._tag).toBe('Drained')
    expect(drained.storage.containers).toHaveLength(0)
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
    const worldId = Container.worldContainerId(input)
    assertResultContract(
      'container-storage.worldContainerId(hostile scalar)',
      () => worldId,
      Container.WorldContainerIdSchema,
      SchemaErrorSchema,
    )
  }), checks)

  fc.assert(fc.property(positions, (position) => {
    const id = invoke(Container.containerIdAt, ['overworld', position])
    expect((id as { readonly _tag?: unknown })._tag).toBe('InvalidContainerPosition')
  }), checks)

  fc.assert(fc.property(addresses, (address) => {
    const id = invoke(Container.worldContainerIdAt, [address])
    expect((id as { readonly _tag?: unknown })._tag).toBe('InvalidContainerAddress')
  }), checks)

  fc.assert(fc.property(invalidStorage, (storage) => {
    expect((invoke(Container.findContainer, [storage, 'broken']) as { readonly _tag?: unknown })._tag).toBe('InvalidContainerStorage')
    expect((invoke(Container.drainContainer, [storage, 'broken']) as { readonly _tag?: unknown })._tag).toBe('InvalidContainerStorage')
  }), checks)

  for (const id of [null, undefined, '', ' ', 0, Symbol('id')]) {
    expect((invoke(Container.emptyContainer, [id, 'chest']) as { readonly _tag?: unknown })._tag).toBe('InvalidContainerId')
    expect((invoke(Container.findContainer, [Container.emptyContainerStorage(), id]) as { readonly _tag?: unknown })._tag).toBe('InvalidContainerId')
    expect((invoke(Container.drainContainer, [Container.emptyContainerStorage(), id]) as { readonly _tag?: unknown })._tag).toBe('InvalidContainerId')
  }
})
