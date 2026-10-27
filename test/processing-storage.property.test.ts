import fc from 'fast-check'
import { Effect, Result } from 'effect'
import { expect, it } from 'vitest'
import {
  makeBrewingService,
  makeBrewingServiceRegistration,
  type BrewingServiceApi,
} from '../src/application/brewing-service.js'
import {
  makeFurnaceService,
  makeFurnaceServiceRegistration,
  type FurnaceServiceApi,
} from '../src/application/furnace-service.js'
import { makeInventoryService } from '../src/application/inventory-service.js'
import {
  makeWorldCommitCoordinator,
  WorldCommitCoordinator,
  type WorldCommitCoordinatorApi,
} from '../src/application/world-commit-coordinator.js'
import {
  createContainer,
  emptyContainerStorage,
  snapshotContainerStorage,
  transferContainerItem,
  validateContainerStorageSnapshot,
} from '../src/domain/container-storage.js'
import { emptyBrewingState, advanceBrewing, validateBrewingSnapshot } from '../src/domain/brewing.js'
import { emptyFurnaceState, advanceFurnace, validateFurnaceSnapshot } from '../src/domain/smelting.js'
import { emptyPlayerStorage, validatePlayerStorageSnapshot } from '../src/domain/player-storage.js'
import { ReplicatedOwnerIdSchema } from '../src/application/replicated-state.js'
import { WorldIdSchema } from '@nerima-games/mc-kernel'
import { Layer, Schema } from 'effect'

const hostileValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.double(),
  fc.string(),
  fc.boolean(),
  fc.constantFrom<unknown>(
    null,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
    -1,
    0,
  ),
)

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const finiteTree = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(finiteTree)
  if (isRecord(value)) return Object.values(value).every(finiteTree)
  return true
}

const successValue = (value: Readonly<Record<string, unknown>>): unknown =>
  value['success'] ?? value['value']

const isTaggedFailure = (value: unknown): boolean => {
  if (!isRecord(value) || value['_tag'] !== 'Failure') return false
  const failure = value['failure'] ?? value['error']
  return isRecord(failure) && typeof failure['_tag'] === 'string'
}

const assertOutcome = (value: unknown, validSuccess: (success: unknown) => boolean): void => {
  expect(isRecord(value)).toBe(true)
  if (!isRecord(value)) return
  if (value['_tag'] === 'Failure') {
    expect(isTaggedFailure(value)).toBe(true)
    return
  }
  expect(value['_tag']).toBe('Success')
  const success = successValue(value)
  expect(finiteTree(success)).toBe(true)
  expect(validSuccess(success)).toBe(true)
}

const invoke = (operation: (...args: never[]) => unknown, args: ReadonlyArray<unknown>): unknown =>
  Reflect.apply(operation, undefined, args)

const invokeEffect = <A, E, R>(
  operation: (...args: never[]) => Effect.Effect<A, E, R>,
  args: ReadonlyArray<unknown>,
): Effect.Effect<A, E, R> => Reflect.apply(operation, undefined, args)

const ownerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('property-tests')
const worldId = Schema.decodeUnknownSync(WorldIdSchema)('processing-storage-property-tests')

const makeBrewingFixture = Effect.gen(function* () {
  const registration = Result.getOrThrow(makeBrewingServiceRegistration(ownerId))
  const coordinator = yield* makeWorldCommitCoordinator({ world: worldId, owners: [registration] })
  const brewing = yield* makeBrewingService(ownerId)
  return { brewing, coordinator }
})

const makeFurnaceFixture = Effect.gen(function* () {
  const registration = Result.getOrThrow(makeFurnaceServiceRegistration(ownerId))
  const coordinator = yield* makeWorldCommitCoordinator({ world: worldId, owners: [registration] })
  const furnace = yield* makeFurnaceService(ownerId)
  return { furnace, coordinator }
})

const runBrewing = <A, E>(
  fixture: Readonly<{ brewing: BrewingServiceApi; coordinator: WorldCommitCoordinatorApi }>,
  effect: Effect.Effect<A, E, WorldCommitCoordinator>,
) => Effect.runPromise(Effect.provide(effect, Layer.succeed(WorldCommitCoordinator, fixture.coordinator)))

const runFurnace = <A, E>(
  fixture: Readonly<{ furnace: FurnaceServiceApi; coordinator: WorldCommitCoordinatorApi }>,
  effect: Effect.Effect<A, E, WorldCommitCoordinator>,
) => Effect.runPromise(Effect.provide(effect, Layer.succeed(WorldCommitCoordinator, fixture.coordinator)))

it('brewing domain and service reject bad elapsed values or retain valid finite state', async () => {
  const initial = Result.getOrThrow(emptyBrewingState())
  const fixture = await Effect.runPromise(makeBrewingFixture)
  await fc.assert(
    fc.asyncProperty(hostileValue, async (elapsed) => {
      const domainOutcome = invoke(advanceBrewing, [initial, elapsed])
      assertOutcome(domainOutcome, (success) =>
        isRecord(success) && validateBrewingSnapshot(success['state'])._tag === 'Valid',
      )

      const serviceOutcome = await runBrewing(
        fixture,
        Effect.result(invokeEffect(fixture.brewing.advance, [elapsed])),
      )
      assertOutcome(serviceOutcome, (success) =>
        isRecord(success) && validateBrewingSnapshot(success['state'])._tag === 'Valid',
      )
      const snapshot = await runBrewing(fixture, fixture.brewing.snapshot)
      expect(validateBrewingSnapshot(snapshot)._tag).toBe('Valid')
      expect(finiteTree(snapshot)).toBe(true)
    }),
    { numRuns: 100 },
  )
})

it('smelting domain and service reject bad elapsed values or retain valid finite state', async () => {
  const initial = Result.getOrThrow(emptyFurnaceState())
  const fixture = await Effect.runPromise(makeFurnaceFixture)
  await fc.assert(
    fc.asyncProperty(hostileValue, async (elapsed) => {
      const domainOutcome = invoke(advanceFurnace, [initial, elapsed])
      assertOutcome(domainOutcome, (success) =>
        isRecord(success) && validateFurnaceSnapshot(success['state'])._tag === 'Valid',
      )

      const serviceOutcome = await runFurnace(
        fixture,
        Effect.result(invokeEffect(fixture.furnace.advance, [elapsed])),
      )
      assertOutcome(serviceOutcome, (success) =>
        isRecord(success) && validateFurnaceSnapshot(success['state'])._tag === 'Valid',
      )
      const snapshot = await runFurnace(fixture, fixture.furnace.snapshot)
      expect(validateFurnaceSnapshot(snapshot)._tag).toBe('Valid')
      expect(finiteTree(snapshot)).toBe(true)
    }),
    { numRuns: 100 },
  )
})

it('container transfer rejects invalid counts or produces valid finite storage', () => {
  const player = emptyPlayerStorage()
  const containerStorage = createContainer(emptyContainerStorage(), 'property-chest').storage
  const container = containerStorage.containers[0]
  expect(container).toBeDefined()
  if (container === undefined) return

  fc.assert(
    fc.property(hostileValue, (count) => {
      const outcome = invoke(transferContainerItem, [player, containerStorage, {
        direction: 'ContainerToPlayer',
        containerId: container.id,
        playerSlot: 0,
        containerSlot: 0,
        count,
      }])
      expect(isRecord(outcome)).toBe(true)
      if (!isRecord(outcome)) return
      expect(isRecord(outcome['result']) && typeof outcome['result']['_tag'] === 'string').toBe(true)
      expect(validatePlayerStorageSnapshot(outcome['playerStorage'])._tag).toBe('Valid')
      const snapshot = invoke(snapshotContainerStorage, [outcome['containerStorage']])
      expect(validateContainerStorageSnapshot(snapshot)._tag).toBe('Valid')
      expect(finiteTree(outcome)).toBe(true)
    }),
    { numRuns: 100 },
  )
})

it('InventoryService transfer rejects invalid counts without corrupting either stored side', async () => {
  const service = await Effect.runPromise(makeInventoryService())
  await Effect.runPromise(service.createContainer('property-service-chest'))

  await fc.assert(
    fc.asyncProperty(hostileValue, async (count) => {
      const outcome = await Effect.runPromise(
        invokeEffect(service.transferContainerItem, [{
          direction: 'ContainerToPlayer',
          containerId: 'property-service-chest',
          playerSlot: 0,
          containerSlot: 0,
          count,
        }]),
      )
      expect(isRecord(outcome) && typeof outcome['_tag'] === 'string').toBe(true)
      const player = await Effect.runPromise(service.storageSnapshot)
      const containers = await Effect.runPromise(service.containerStorageSnapshot)
      expect(validatePlayerStorageSnapshot(player)._tag).toBe('Valid')
      expect(validateContainerStorageSnapshot(containers)._tag).toBe('Valid')
      expect(finiteTree({ player, containers })).toBe(true)
    }),
    { numRuns: 100 },
  )
})
