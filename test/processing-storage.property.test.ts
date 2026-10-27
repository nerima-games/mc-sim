import fc from 'fast-check'
import { Effect, Result } from 'effect'
import { expect, it } from 'vitest'
import {
  makeBrewingService,
  makeBrewingServiceRegistration,
  BrewingServiceErrorSchema,
  type BrewingServiceApi,
} from '../src/application/brewing-service.js'
import {
  makeFurnaceService,
  makeFurnaceServiceRegistration,
  FurnaceServiceErrorSchema,
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
import {
  emptyBrewingState,
  advanceBrewing,
  BrewingFailureSchema,
  BrewingOutcomeSchema,
  BrewingSnapshotValidationResultSchema,
  validateBrewingSnapshot,
} from '../src/domain/brewing.js'
import {
  emptyFurnaceState,
  advanceFurnace,
  FurnaceFailureSchema,
  FurnaceOutcomeSchema,
  FurnaceSnapshotValidationResultSchema,
  validateFurnaceSnapshot,
} from '../src/domain/smelting.js'
import { emptyPlayerStorage, validatePlayerStorageSnapshot } from '../src/domain/player-storage.js'
import { ReplicatedOwnerIdSchema } from '../src/application/replicated-state.js'
import { WorldIdSchema } from '@nerima-games/mc-kernel'
import { Layer, Schema } from 'effect'
import {
  assertResultContract,
  finiteTree,
  hostileValue,
  invokeEffect,
} from './public-property-helpers.js'

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
      const domainOutcome = advanceBrewing(initial, elapsed as never)
      assertResultContract(
        'advanceBrewing.domain',
        () => domainOutcome as Result.Result<unknown, unknown>,
        BrewingOutcomeSchema,
        BrewingFailureSchema,
      )

      const serviceOutcome = await runBrewing(
        fixture,
        Effect.result(invokeEffect(fixture.brewing.advance, [elapsed])),
      )
      assertResultContract(
        'BrewingService.advance',
        () => serviceOutcome,
        BrewingOutcomeSchema,
        BrewingServiceErrorSchema,
      )
      const snapshot = await runBrewing(fixture, fixture.brewing.snapshot)
      const validatedSnapshot = validateBrewingSnapshot(snapshot)
      expect(Schema.is(BrewingSnapshotValidationResultSchema)(validatedSnapshot)).toBe(true)
      expect(validatedSnapshot._tag).toBe('Valid')
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
      const domainOutcome = advanceFurnace(initial, elapsed as never)
      assertResultContract(
        'advanceFurnace.domain',
        () => domainOutcome as Result.Result<unknown, unknown>,
        FurnaceOutcomeSchema,
        FurnaceFailureSchema,
      )

      const serviceOutcome = await runFurnace(
        fixture,
        Effect.result(invokeEffect(fixture.furnace.advance, [elapsed])),
      )
      assertResultContract(
        'FurnaceService.advance',
        () => serviceOutcome,
        FurnaceOutcomeSchema,
        FurnaceServiceErrorSchema,
      )
      const snapshot = await runFurnace(fixture, fixture.furnace.snapshot)
      const validatedSnapshot = validateFurnaceSnapshot(snapshot)
      expect(Schema.is(FurnaceSnapshotValidationResultSchema)(validatedSnapshot)).toBe(true)
      expect(validatedSnapshot._tag).toBe('Valid')
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
      const outcome = transferContainerItem(player, containerStorage, {
        direction: 'ContainerToPlayer',
        containerId: container.id,
        playerSlot: 0,
        containerSlot: 0,
        count,
      } as never)
      expect(validatePlayerStorageSnapshot(outcome.playerStorage)._tag).toBe('Valid')
      const snapshot = snapshotContainerStorage(outcome.containerStorage)
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
      expect(finiteTree(outcome)).toBe(true)
      const player = await Effect.runPromise(service.storageSnapshot)
      const containers = await Effect.runPromise(service.containerStorageSnapshot)
      expect(validatePlayerStorageSnapshot(player)._tag).toBe('Valid')
      expect(validateContainerStorageSnapshot(containers)._tag).toBe('Valid')
      expect(finiteTree({ player, containers })).toBe(true)
    }),
    { numRuns: 100 },
  )
})
