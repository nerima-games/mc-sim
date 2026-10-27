import { Effect, Layer, Result, Schema } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import {
  FurnaceService,
  FurnaceServiceLayer,
  FurnaceServiceStateSchema,
  makeFurnaceService,
  makeFurnaceServiceRegistration,
  type FurnaceServiceApi,
} from '../src/application/furnace-service.js'
import {
  ReplicatedOwnerIdSchema,
} from '../src/application/replicated-state.js'
import {
  makeWorldCommitCoordinator,
  WorldCommitCoordinator,
  WorldRevisionConflict,
  type WorldCommitCoordinatorApi,
} from '../src/application/world-commit-coordinator.js'
import { emptyInventory, itemStack } from '../src/domain/inventory.js'
import { VANILLA_SMELTING_RECIPES } from '../src/domain/smelting.js'
import { WorldIdSchema, WorldRevisionSchema } from '@nerima-games/mc-kernel'

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const furnaceOwnerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('test:furnace')

const makeFurnaceFixture = Effect.gen(function* () {
  const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('furnace-service-test')
  const registration = must(makeFurnaceServiceRegistration(furnaceOwnerId))
  const coordinator = yield* makeWorldCommitCoordinator({ world, owners: [registration] })
  const furnace = yield* makeFurnaceService(furnaceOwnerId)
  return { furnace, coordinator }
})

type FurnaceFixture = Readonly<{
  furnace: FurnaceServiceApi
  coordinator: WorldCommitCoordinatorApi
}>

const withFurnace = <A, E, R>(
  run: (fixture: FurnaceFixture) => Effect.Effect<A, E, R>,
) =>
  Effect.flatMap(makeFurnaceFixture, (fixture) =>
    Effect.provide(run(fixture), Layer.succeed(WorldCommitCoordinator, fixture.coordinator)),
  )

describe('FurnaceService', () => {
  it.effect('commits input, fuel, tick, output and experience state through the world coordinator', () =>
    withFurnace(({ furnace, coordinator }) =>
      Effect.gen(function* () {
        yield* furnace.setInput(must(itemStack('iron_ore', 1)))
        yield* furnace.setFuel(must(itemStack('coal', 1)))

        const recipe = VANILLA_SMELTING_RECIPES.find((candidate) => candidate.input === 'iron_ore')
        expect(recipe).toBeDefined()
        const outcome = yield* furnace.advance(10)
        expect(outcome.smeltedCount).toBe(1)
        expect((yield* furnace.snapshot).output?.item).toBe('iron_ingot')

        const committed = yield* coordinator.snapshot(furnaceOwnerId, FurnaceServiceStateSchema)
        expect(committed.state.furnace.output?.item).toBe('iron_ingot')
        expect(committed.state.experience).toBeGreaterThan(0)

        const collected = yield* furnace.collectOutput(emptyInventory())
        expect(collected.result._tag).toBe('Collected')
        expect(collected.inventory.slots.some((slot) => slot?.item === 'iron_ingot')).toBe(true)
        expect((yield* furnace.snapshot).output).toBeUndefined()

        const experience = yield* furnace.collectExperience
        expect(experience).toBeGreaterThan(0)
        expect(yield* furnace.collectExperience).toBe(0)
      }),
    ),
  )

  it.effect('rejects malformed replicated service states', () =>
    Effect.gen(function* () {
      const furnaceState = {
        station: 'furnace',
        input: undefined,
        fuel: undefined,
        output: undefined,
        fuelTimeRemainingSecs: 0,
        fuelTimeTotalSecs: 0,
        cookProgressSecs: 0,
      }
      const malformedStates: ReadonlyArray<unknown> = [
        1,
        null,
        [],
        { furnace: furnaceState, experience: 0, extra: true },
        { other: furnaceState, experience: 0 },
        { furnace: furnaceState, extra: 0 },
        { furnace: {}, experience: 0 },
        { furnace: furnaceState, experience: '0' },
        { furnace: furnaceState, experience: -1 },
      ]

      for (const state of malformedStates) {
        const decoded = yield* Effect.result(
          Schema.decodeUnknownEffect(FurnaceServiceStateSchema)(state),
        )
        expect(Result.isFailure(decoded)).toBe(true)
      }
    }),
  )

  it.effect('keeps committed state when advance, collection or restore fails', () =>
    withFurnace(({ furnace }) =>
      Effect.gen(function* () {
        yield* furnace.setInput(must(itemStack('iron_ore', 1)))
        yield* furnace.setFuel(must(itemStack('coal', 1)))
        const before = yield* furnace.snapshot

        const invalidAdvance = yield* Effect.result(furnace.advance(-1))
        expect(Result.isFailure(invalidAdvance)).toBe(true)
        expect(yield* furnace.snapshot).toBe(before)

        yield* furnace.advance(10)
        const readyToCollect = yield* furnace.snapshot

        const blocked = yield* furnace.collectOutput({
          slots: Array.from({ length: 36 }, () => must(itemStack('cobblestone', 64))),
        })
        expect(blocked.result._tag).toBe('NoRoom')
        expect(yield* furnace.snapshot).toBe(readyToCollect)

        const invalidRestore = yield* Effect.result(furnace.restore({}))
        expect(Result.isFailure(invalidRestore)).toBe(true)
        expect(yield* furnace.snapshot).toBe(readyToCollect)
      }),
    ),
  )

  it.effect('leaves owner state unchanged when the coordinator rejects a commit', () =>
    withFurnace(({ furnace, coordinator }) =>
      Effect.gen(function* () {
        const before = yield* coordinator.snapshot(furnaceOwnerId, FurnaceServiceStateSchema)
        const rejectingCoordinator: WorldCommitCoordinatorApi = {
          ...coordinator,
          commit: (request) =>
            Effect.flatMap(
              Schema.decodeUnknownEffect(WorldRevisionSchema)(request.expectedRevision + 1),
              (actual) => Effect.fail(new WorldRevisionConflict({
                expected: request.expectedRevision,
                actual,
              })),
            ),
        }

        const rejected = yield* Effect.result(
          furnace.setInput(must(itemStack('iron_ore', 1))).pipe(
            Effect.provide(Layer.succeed(WorldCommitCoordinator, rejectingCoordinator)),
          ),
        )
        expect(Result.isFailure(rejected)).toBe(true)

        const after = yield* coordinator.snapshot(furnaceOwnerId, FurnaceServiceStateSchema)
        expect(after).toStrictEqual(before)
      }),
    ),
  )

  it.effect('validates owner initialization, restores snapshots and resets through the coordinator', () =>
    withFurnace(({ furnace }) =>
      Effect.gen(function* () {
        expect(Result.isFailure(
          makeFurnaceServiceRegistration(furnaceOwnerId, { station: 'campfire' }),
        )).toBe(true)

        yield* furnace.setInput(must(itemStack('iron_ore', 1)))
        const saved = yield* furnace.snapshot
        yield* furnace.reset
        expect((yield* furnace.snapshot).input).toBeUndefined()
        yield* furnace.restore(saved)
        expect((yield* furnace.snapshot).input?.item).toBe('iron_ore')
      }),
    ),
  )

  it.effect('provides a service layer for a registered owner', () =>
    withFurnace(({ coordinator }) =>
      Effect.gen(function* () {
        const furnace = yield* FurnaceService
        expect((yield* furnace.snapshot).station).toBe('furnace')
      }).pipe(
        Effect.provide(
          Layer.merge(
            FurnaceServiceLayer(furnaceOwnerId),
            Layer.succeed(WorldCommitCoordinator, coordinator),
          ),
        ),
      ),
    ),
  )
})
