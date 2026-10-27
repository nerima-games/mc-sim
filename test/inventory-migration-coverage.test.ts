import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import type { ItemType } from '@nerima-games/mc-kernel'
import { afterEach, vi } from 'vitest'
import { makeInventoryService } from '../src/application/inventory-service.js'
import * as Container from '../src/domain/container-storage.js'
import * as Craft from '../src/domain/crafting.js'
import * as Eq from '../src/domain/equipment.js'
import * as Inv from '../src/domain/inventory.js'
import * as Hotbar from '../src/domain/hotbar.js'
import * as Player from '../src/domain/player-storage.js'
import * as Recipe from '../src/domain/recipe.js'
import { STARTER_RECIPES } from '../src/domain/recipe-data.js'

const kernelFailures = vi.hoisted(() => ({ itemStackFailureCountdown: 0, itemDamageFailureCountdown: 0 }))

vi.mock('@nerima-games/mc-kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nerima-games/mc-kernel')>()
  return {
    ...actual,
    ItemDamage: Object.assign(
      (value: number) => actual.ItemDamage(value),
      actual.ItemDamage,
      {
        result: (value: number) => {
          if (kernelFailures.itemDamageFailureCountdown > 0) {
            kernelFailures.itemDamageFailureCountdown -= 1
            if (kernelFailures.itemDamageFailureCountdown === 0) return actual.ItemDamage.result(Number.NaN)
          }
          return actual.ItemDamage.result(value)
        },
      },
    ),
    itemStack: (...args: Parameters<typeof actual.itemStack>) => {
      if (kernelFailures.itemStackFailureCountdown > 0) {
        kernelFailures.itemStackFailureCountdown -= 1
        if (kernelFailures.itemStackFailureCountdown === 0) {
          const invalidCount = actual.StackCount.result(0)
          if (Result.isFailure(invalidCount)) return Result.fail(invalidCount.failure)
        }
      }
      return actual.itemStack(...args)
    },
  }
})

afterEach(() => {
  kernelFailures.itemStackFailureCountdown = 0
  kernelFailures.itemDamageFailureCountdown = 0
})

const requireSuccess = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const stack = (item: ItemType, count = 1): Inv.ItemStack =>
  requireSuccess(Inv.itemStack(item, count))

const stackThatFailsOnComponentSnapshot = (
  item: ItemType,
  count: number,
  failOnEnumeration: number,
): Inv.ItemStack => {
  const original = stack(item, count)
  let enumerations = 0
  const components = new Proxy(original.components, {
    ownKeys(target) {
      enumerations += 1
      if (enumerations === failOnEnumeration) throw new Error('component snapshot failed')
      return Reflect.ownKeys(target)
    },
  })
  return { ...original, components }
}

const oversizedStackThatFailsOnSpill = (item: ItemType): Inv.ItemStack => {
  const original = stack(item, 2)
  const components = { ...original.components }
  Object.defineProperty(components, 'maxStackSize', {
    value: 1,
    enumerable: true,
    configurable: true,
    writable: true,
  })
  let enumerations = 0
  const unstableComponents = new Proxy(components, {
    ownKeys(target) {
      enumerations += 1
      if (enumerations === 7) throw new Error('overflow stack snapshot failed')
      return Reflect.ownKeys(target)
    },
  })
  return { ...original, components: unstableComponents }
}

const expectHostileFailure = (failure: unknown): void => {
  expect(failure).toMatchObject({ _tag: 'ItemValidationFailure', reason: 'hostile-input' })
}

const expectResultFailure = <A, E>(result: Result.Result<A, E>): void => {
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) expectHostileFailure(result.failure)
}

const setSlot = (inventory: Inv.Inventory, index: number, item: Inv.ItemStack): void => {
  expect(Reflect.set(inventory.slots, index, item)).toBe(true)
}

const storedStack = (
  item: Inv.ItemStack,
  durability: Eq.Durability | null = null,
): Container.ContainerStoredStack => ({ ...item, durability })

const containerStorageWithSlot = (
  slot: Container.ContainerSlot,
  id = 'box',
): Container.ContainerStorage => ({
  containers: [{
    id,
    kind: 'chest',
    slots: [slot, ...Array.from({ length: Container.CHEST_CONTAINER_CAPACITY - 1 }, () => null)],
  }],
})

const containerStorageWithTwoSlots = (
  source: Container.ContainerSlot,
  destination: Container.ContainerSlot,
): Container.ContainerStorage => ({
  containers: [
    {
      id: 'source',
      kind: 'chest',
      slots: [source, ...Array.from({ length: Container.CHEST_CONTAINER_CAPACITY - 1 }, () => null)],
    },
    {
      id: 'destination',
      kind: 'chest',
      slots: [destination, ...Array.from({ length: Container.CHEST_CONTAINER_CAPACITY - 1 }, () => null)],
    },
  ],
})

describe('inventory migration constructor-failure edges', () => {
  it('returns failures from addItemStack while merging and opening a slot', () => {
    const mergeFailure = Inv.addItemStack(
      { slots: [stackThatFailsOnComponentSnapshot('stone', 2, 5)] },
      stack('stone'),
    )
    expectResultFailure(mergeFailure)

    const emptySlotFailure = Inv.addItemStack(
      Inv.emptyInventory(),
      stackThatFailsOnComponentSnapshot('stone', 2, 4),
    )
    expectResultFailure(emptySlotFailure)
  })

  it('propagates remove and in-range normalization constructor failures', () => {
    expectResultFailure(Inv.removeItem(
      { slots: [stackThatFailsOnComponentSnapshot('stone', 2, 3)] },
      'stone',
      1,
    ))

    expectResultFailure(Inv.normaliseInventory({
      slots: [stackThatFailsOnComponentSnapshot('stone', 2, 4)],
    }))
  })

  it('reports failures while spilling an out-of-range slot or an oversized stack', () => {
    const extendedSlots = [...Inv.emptyInventory().slots]
    extendedSlots.push(stackThatFailsOnComponentSnapshot('stone', 1, 3))
    expectResultFailure(Inv.normaliseInventory({ slots: extendedSlots }))

    expectResultFailure(Inv.normaliseInventory({
      slots: [oversizedStackThatFailsOnSpill('oak_planks')],
    }))
  })

  it('propagates an ItemStack Result failure while inserting an overflow stack', () => {
    const slots = [...Inv.emptyInventory().slots, stack('stone')]
    kernelFailures.itemStackFailureCountdown = 2

    const result = Inv.normaliseInventory({ slots })
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) expect(result.failure).toMatchObject({ _tag: 'BrandError' })
  })
})

describe('inventory service constructor-failure edges', () => {
  it.effect('keeps state unchanged when setSlot cannot normalize its carried stack', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService()
      const result = yield* Effect.result(service.setSlot(
        0,
        stackThatFailsOnComponentSnapshot('stone', 2, 2),
      ))
      expectResultFailure(result)
      expect(yield* service.countOf('stone')).toBe(0)
    }))

  it.effect('propagates failures from add, remove, removeAt, and click', () =>
    Effect.gen(function* () {
      const addService = yield* makeInventoryService()
      const addInventory = yield* addService.snapshot
      setSlot(addInventory, 0, stackThatFailsOnComponentSnapshot('stone', 2, 5))
      expectResultFailure(yield* Effect.result(addService.add('stone', 1)))

      const removeService = yield* makeInventoryService()
      const removeInventory = yield* removeService.snapshot
      setSlot(removeInventory, 0, stackThatFailsOnComponentSnapshot('stone', 2, 3))
      expectResultFailure(yield* Effect.result(removeService.remove('stone', 1)))

      const removeAtService = yield* makeInventoryService()
      const removeAtInventory = yield* removeAtService.snapshot
      setSlot(removeAtInventory, 0, stackThatFailsOnComponentSnapshot('stone', 2, 3))
      expectResultFailure(yield* Effect.result(removeAtService.removeAt(0, 'stone', 1)))

      const clickService = yield* makeInventoryService()
      const clickInventory = yield* clickService.snapshot
      setSlot(clickInventory, 0, stackThatFailsOnComponentSnapshot('stone', 2, 2))
      expectResultFailure(yield* Effect.result(clickService.click({
        _tag: 'LeftClick',
        slotIndex: 0,
        carried: stack('stone'),
      })))
    }))

  it.effect('propagates failures from moveStack target and source reconstruction', () =>
    Effect.gen(function* () {
      const targetService = yield* makeInventoryService()
      const targetInventory = yield* targetService.snapshot
      setSlot(targetInventory, 0, stack('stone', 2))
      setSlot(targetInventory, 1, stackThatFailsOnComponentSnapshot('stone', 63, 2))
      expectResultFailure(yield* Effect.result(targetService.moveStack(0, 1)))

      const sourceService = yield* makeInventoryService()
      const sourceInventory = yield* sourceService.snapshot
      setSlot(sourceInventory, 0, stackThatFailsOnComponentSnapshot('stone', 3, 2))
      setSlot(sourceInventory, 1, stack('stone', 63))
      expectResultFailure(yield* Effect.result(sourceService.moveStack(0, 1)))
    }))

  it.effect('propagates quickMove failures while merging, opening, and retaining a source slot', () =>
    Effect.gen(function* () {
      const mergeService = yield* makeInventoryService()
      const mergeInventory = yield* mergeService.snapshot
      setSlot(mergeInventory, Hotbar.HOTBAR_START, stack('stone', 2))
      setSlot(mergeInventory, 9, stackThatFailsOnComponentSnapshot('stone', 1, 2))
      expectResultFailure(yield* Effect.result(mergeService.quickMove(Hotbar.HOTBAR_START)))

      const emptyService = yield* makeInventoryService()
      const emptyInventory = yield* emptyService.snapshot
      setSlot(emptyInventory, 0, stackThatFailsOnComponentSnapshot('stone', 2, 1))
      expectResultFailure(yield* Effect.result(emptyService.quickMove(0)))

      const remainingService = yield* makeInventoryService()
      const remainingInventory = yield* remainingService.snapshot
      setSlot(remainingInventory, Hotbar.HOTBAR_START, stackThatFailsOnComponentSnapshot('stone', 2, 28))
      for (let index = 0; index < Hotbar.HOTBAR_START; index += 1) {
        setSlot(remainingInventory, index, stack('stone', index === 0 ? 63 : 64))
      }
      expectResultFailure(yield* Effect.result(remainingService.quickMove(Hotbar.HOTBAR_START)))
    }))

  it.effect('propagates restore and craft failures through their service effects', () =>
    Effect.gen(function* () {
      const restoreService = yield* makeInventoryService()
      expectResultFailure(yield* Effect.result(restoreService.restore({
        slots: [stackThatFailsOnComponentSnapshot('stone', 2, 4)],
      })))

      const craftService = yield* makeInventoryService()
      const inventory = yield* craftService.snapshot
      setSlot(inventory, 0, stackThatFailsOnComponentSnapshot('oak_log', 2, 3))
      const grid = requireSuccess(Recipe.craftGrid(1, 1, ['oak_log']))
      expectResultFailure(yield* Effect.result(craftService.craft(grid)))
    }))
})

describe('container storage constructor-failure edges', () => {
  it('returns an ItemStackFailure from snapshot validation and its container loop', () => {
    const source = storedStack(stackThatFailsOnComponentSnapshot('stone', 2, 2))
    const result = Container.validateContainerStorageSnapshot({
      version: Container.CONTAINER_STORAGE_SNAPSHOT_VERSION,
      containers: [{
        id: 'box',
        kind: 'chest',
        slots: [source, ...Array.from({ length: Container.CHEST_CONTAINER_CAPACITY - 1 }, () => null)],
      }],
    })
    expect(result).toMatchObject({
      _tag: 'ItemStackFailure',
      error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })
  })

  it('propagates transfer failures for moved, remaining player, and remaining container stacks', () => {
    const moved = Container.transferContainerItem(
      Player.emptyPlayerStorage(),
      containerStorageWithSlot(storedStack(stackThatFailsOnComponentSnapshot('stone', 2, 2))),
      { direction: 'ContainerToPlayer', containerId: 'box', playerSlot: 0, containerSlot: 0, count: 1 },
    )
    expect(moved.result).toMatchObject({
      _tag: 'ItemStackFailure', error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })

    const playerSource = Player.storageFromInventory({
      slots: [stackThatFailsOnComponentSnapshot('stone', 2, 3), ...Inv.emptyInventory().slots.slice(1)],
    })
    const playerRemaining = Container.transferContainerItem(
      playerSource,
      containerStorageWithSlot(null),
      { direction: 'PlayerToContainer', containerId: 'box', playerSlot: 0, containerSlot: 0, count: 1 },
    )
    expect(playerRemaining.result).toMatchObject({
      _tag: 'ItemStackFailure', error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })

    const containerRemaining = Container.transferContainerItem(
      Player.emptyPlayerStorage(),
      containerStorageWithSlot(storedStack(stackThatFailsOnComponentSnapshot('stone', 2, 3))),
      { direction: 'ContainerToPlayer', containerId: 'box', playerSlot: 0, containerSlot: 0, count: 1 },
    )
    expect(containerRemaining.result).toMatchObject({
      _tag: 'ItemStackFailure', error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })
  })

  it('propagates a Result failure when the moved stack is inserted into player storage', () => {
    const playerStorage = Player.emptyPlayerStorage()
    const containerStorage = containerStorageWithSlot(storedStack(stack('stone', 2)))
    kernelFailures.itemStackFailureCountdown = 3

    const transfer = Container.transferContainerItem(playerStorage, containerStorage, {
      direction: 'ContainerToPlayer',
      containerId: 'box',
      playerSlot: 0,
      containerSlot: 0,
      count: 1,
    })

    expect(transfer.result).toMatchObject({ _tag: 'ItemStackFailure', error: { _tag: 'BrandError' } })
    expect(transfer.playerStorage).toBe(playerStorage)
    expect(transfer.containerStorage).toBe(containerStorage)
  })

  it('propagates extraction failures while preserving the source storage', () => {
    const partial = containerStorageWithSlot(storedStack(stackThatFailsOnComponentSnapshot('stone', 2, 2)))
    const remainingFailure = Container.extractContainerItem(partial, {
      containerId: 'box', containerSlot: 0, count: 1,
    })
    expect(remainingFailure.result).toMatchObject({
      _tag: 'ItemStackFailure', error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })
    expect(remainingFailure.storage).toBe(partial)

    const full = containerStorageWithSlot(storedStack(stackThatFailsOnComponentSnapshot('stone', 1, 2)))
    const extractedFailure = Container.extractContainerItem(full, {
      containerId: 'box', containerSlot: 0, count: 1,
    })
    expect(extractedFailure.result).toMatchObject({
      _tag: 'ItemStackFailure', error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })
    expect(extractedFailure.storage).toBe(full)
  })

  it('propagates container move failures while preserving the source storage', () => {
    const partial = containerStorageWithTwoSlots(
      storedStack(stackThatFailsOnComponentSnapshot('stone', 2, 2)),
      null,
    )
    const remainingFailure = Container.moveContainerItem(partial, {
      sourceContainerId: 'source', sourceSlot: 0,
      destinationContainerId: 'destination', destinationSlot: 0, count: 1,
    })
    expect(remainingFailure.result).toMatchObject({
      _tag: 'ItemStackFailure', error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })
    expect(remainingFailure.storage).toBe(partial)

    const full = containerStorageWithTwoSlots(
      storedStack(stackThatFailsOnComponentSnapshot('stone', 1, 2)),
      null,
    )
    const destinationFailure = Container.moveContainerItem(full, {
      sourceContainerId: 'source', sourceSlot: 0,
      destinationContainerId: 'destination', destinationSlot: 0, count: 1,
    })
    expect(destinationFailure.result).toMatchObject({
      _tag: 'ItemStackFailure', error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })
    expect(destinationFailure.storage).toBe(full)
  })
})

describe('player storage constructor-failure edges', () => {
  it.effect('keeps the inventory service snapshot unchanged when durability branding fails', () =>
    Effect.gen(function* () {
      const service = yield* makeInventoryService({
        slots: [stack('bow'), stack('stone'), ...Array.from({ length: 34 }, () => undefined)],
      })
      const before = yield* service.storageSnapshot
      kernelFailures.itemDamageFailureCountdown = 1

      const result = yield* service.consumeAndDamageAt({
        consume: { item: 'stone', count: 1 },
        damage: { location: { _tag: 'Inventory', slotIndex: 0 }, expectedItem: 'bow', amount: 1 },
      })
      expect(result).toMatchObject({
        _tag: 'EquipmentFailure', error: { _tag: 'BrandError' },
      })
      expect(yield* service.storageSnapshot).toStrictEqual(before)
    }),
  )

  it('keeps storage unchanged when damage construction returns a BrandError', () => {
    const storage = Player.storageFromInventory({
      slots: [stack('bow'), stack('stone'), ...Array.from({ length: 34 }, () => undefined)],
    })
    kernelFailures.itemDamageFailureCountdown = 1

    const damaged = Player.damageAt(storage, { _tag: 'Inventory', slotIndex: 0 }, 1)
    expect(damaged.result).toMatchObject({
      _tag: 'EquipmentFailure', error: { _tag: 'BrandError' },
    })
    expect(damaged.storage).toBe(storage)

    kernelFailures.itemDamageFailureCountdown = 1
    const consumed = Player.consumeAndDamageAt(storage, {
      consume: { item: 'stone', count: 1 },
      damage: { location: { _tag: 'Inventory', slotIndex: 0 }, expectedItem: 'bow', amount: 1 },
    })
    expect(consumed.result).toMatchObject({
      _tag: 'EquipmentFailure', error: { _tag: 'BrandError' },
    })
    expect(consumed.storage).toBe(storage)
  })

  it('returns snapshot failures from the outer player-storage validator', () => {
    const empty = Player.emptyPlayerStorage()
    const result = Player.validatePlayerStorageSnapshot({
      inventory: {
        slots: [stackThatFailsOnComponentSnapshot('stone', 2, 2), ...empty.inventory.slots.slice(1)],
      },
      equipment: empty.equipment,
      inventoryDurability: empty.inventoryDurability,
    })
    expect(result).toMatchObject({
      _tag: 'ItemStackFailure',
      error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })
  })

  it('propagates add, merge, and leftover constructor failures', () => {
    const emptyAdd = Player.addStoredStack(
      Player.emptyPlayerStorage(),
      storedStack(stackThatFailsOnComponentSnapshot('stone', 2, 2)),
    )
    expect(emptyAdd.result).toMatchObject({
      _tag: 'ItemStackFailure', error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })

    const mergeStack = stackThatFailsOnComponentSnapshot('stone', 2, 4)
    const mergeStorage = Player.storageFromInventory({
      slots: [mergeStack, ...Inv.emptyInventory().slots.slice(1)],
    })
    const merge = Player.addStoredStack(mergeStorage, storedStack(mergeStack))
    expect(merge.result).toMatchObject({
      _tag: 'ItemStackFailure', error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })
    expect(merge.storage).toBe(mergeStorage)

    const fullStorage = Player.storageFromInventory({
      slots: Array.from({ length: Inv.INVENTORY_SLOT_COUNT }, () => stack('dirt', 64)),
    })
    const leftover = Player.addStoredStack(
      fullStorage,
      storedStack(stackThatFailsOnComponentSnapshot('stone', 2, 38)),
    )
    expect(leftover.result).toMatchObject({
      _tag: 'ItemStackFailure', error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })
    expect(leftover.storage).toBe(fullStorage)
  })

  it('propagates unequip and consume failures without partially changing storage', () => {
    const empty = Player.emptyPlayerStorage()
    const helmet = {
      ...stackThatFailsOnComponentSnapshot('iron_helmet', 1, 1),
      durability: { current: 165, max: 165 },
    }
    const equipped: Player.PlayerStorage = {
      ...empty,
      equipment: { slots: { ...empty.equipment.slots, head: helmet } },
    }
    const unequipped = Player.unequipToInventory(equipped, 'head')
    expect(unequipped.result).toMatchObject({
      _tag: 'ItemStackFailure', error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })
    expect(unequipped.storage).toBe(equipped)

    const consumableStorage = Player.storageFromInventory({
      slots: [
        stack('flint_and_steel'),
        stackThatFailsOnComponentSnapshot('oak_planks', 2, 3),
        ...Inv.emptyInventory().slots.slice(2),
      ],
    })
    const consumed = Player.consumeAndDamageAt(consumableStorage, {
      consume: { item: 'oak_planks', count: 1 },
      damage: {
        location: { _tag: 'Inventory', slotIndex: 0 },
        expectedItem: 'flint_and_steel',
        amount: 1,
      },
    })
    expect(consumed.result).toMatchObject({
      _tag: 'ItemStackFailure', error: { _tag: 'ItemValidationFailure', reason: 'hostile-input' },
    })
    expect(consumed.storage).toBe(consumableStorage)
  })
})

describe('crafting constructor-failure edges', () => {
  it('propagates an ingredient removal failure without spending any inventory', () => {
    const recipes = requireSuccess(STARTER_RECIPES)
    const grid = requireSuccess(Recipe.craftGrid(1, 1, ['oak_log']))
    const inventory: Inv.Inventory = {
      slots: [stackThatFailsOnComponentSnapshot('oak_log', 2, 3)],
    }
    const result = Craft.craftFromGrid(inventory, recipes, grid)
    expectResultFailure(result)
  })

  it('propagates an output insertion failure after charging ingredients atomically', () => {
    const output = Result.succeed(stack('stone'))
    const recipe = requireSuccess(Recipe.shapelessRecipe('coverage:dirt-to-stone', ['dirt'], output))
    const grid = requireSuccess(Recipe.craftGrid(1, 1, ['dirt']))
    const inventory: Inv.Inventory = {
      slots: [stackThatFailsOnComponentSnapshot('stone', 2, 5), stack('dirt')],
    }
    const result = Craft.craftFromGrid(inventory, [recipe], grid)
    expectResultFailure(result)
  })
})
