import { Effect, Layer, Result, Schema } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import {
  BrewingService,
  BrewingServiceLayer,
  BrewingServiceStateSchema,
  makeBrewingService,
  makeBrewingServiceRegistration,
  type BrewingServiceApi,
} from '../src/application/brewing-service.js'
import { ReplicatedOwnerIdSchema } from '../src/application/replicated-state.js'
import {
  makeWorldCommitCoordinator,
  WorldCommitCoordinator,
  WorldRevisionConflict,
  type WorldCommitCoordinatorApi,
} from '../src/application/world-commit-coordinator.js'
import { BREWING_FUEL_ITEM, BREWING_TIME_SECS } from '../src/domain/brewing.js'
import { itemStack } from '../src/domain/inventory.js'
import { WorldIdSchema, WorldRevisionSchema } from '@nerima-games/mc-kernel'

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const brewingOwnerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('test:brewing')

const makeBrewingFixture = Effect.gen(function* () {
  const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('brewing-service-test')
  const registration = must(makeBrewingServiceRegistration(brewingOwnerId))
  const coordinator = yield* makeWorldCommitCoordinator({ world, owners: [registration] })
  const brewing = yield* makeBrewingService(brewingOwnerId)
  return { brewing, coordinator }
})

type BrewingFixture = Readonly<{
  brewing: BrewingServiceApi
  coordinator: WorldCommitCoordinatorApi
}>

const withBrewing = <A, E, R>(
  run: (fixture: BrewingFixture) => Effect.Effect<A, E, R>,
) =>
  Effect.flatMap(makeBrewingFixture, (fixture) =>
    Effect.provide(run(fixture), Layer.succeed(WorldCommitCoordinator, fixture.coordinator)),
  )

describe('BrewingService', () => {
  it.effect('commits bottles, ingredient, fuel and brew progress through the world coordinator', () =>
    withBrewing(({ brewing, coordinator }) =>
      Effect.gen(function* () {
        yield* brewing.setBottle(0, must(itemStack('water_bottle', 1)))
        yield* brewing.setBottle(1, must(itemStack('water_bottle', 1)))
        yield* brewing.setIngredient(must(itemStack('nether_wart', 1)))
        yield* brewing.setFuel(must(itemStack(BREWING_FUEL_ITEM, 1)))
        yield* brewing.addFuel

        const outcome = yield* brewing.advance(BREWING_TIME_SECS)
        expect(outcome.brewedCount).toBe(1)
        expect((yield* brewing.snapshot).bottles).toEqual([
          must(itemStack('awkward_potion', 1)),
          must(itemStack('awkward_potion', 1)),
          undefined,
        ])

        const committed = yield* coordinator.snapshot(brewingOwnerId, BrewingServiceStateSchema)
        expect(committed.state.bottles[0]?.item).toBe('awkward_potion')
        expect(committed.state.ingredient).toBeUndefined()
      }),
    ),
  )

  it.effect('rejects malformed replicated service states', () =>
    Effect.gen(function* () {
      const malformedStates: ReadonlyArray<unknown> = [
        1,
        null,
        [],
        { bottles: [] },
        {
          bottles: [undefined, undefined, undefined],
          fuelCharges: 0,
          brewProgressSecs: 0,
          fuel: undefined,
          extra: undefined,
        },
        {
          bottles: [],
          ingredient: undefined,
          fuel: undefined,
          fuelCharges: 0,
          brewProgressSecs: 0,
        },
      ]

      for (const state of malformedStates) {
        const decoded = yield* Effect.result(
          Schema.decodeUnknownEffect(BrewingServiceStateSchema)(state),
        )
        expect(Result.isFailure(decoded)).toBe(true)
      }
    }),
  )

  it.effect('preserves committed state after invalid commands and failed restore', () =>
    withBrewing(({ brewing }) =>
      Effect.gen(function* () {
        yield* brewing.setBottle(0, must(itemStack('water_bottle', 1)))
        const before = yield* brewing.snapshot

        const invalidBottle = yield* Effect.result(brewing.setBottle(3, undefined))
        expect(Result.isFailure(invalidBottle)).toBe(true)
        const invalidAdvance = yield* Effect.result(brewing.advance(-1))
        expect(Result.isFailure(invalidAdvance)).toBe(true)
        const invalidRestore = yield* Effect.result(brewing.restore({ bottles: [] }))
        expect(Result.isFailure(invalidRestore)).toBe(true)
        expect(yield* brewing.snapshot).toBe(before)
      }),
    ),
  )

  it.effect('leaves owner state unchanged when the coordinator rejects a commit', () =>
    withBrewing(({ brewing, coordinator }) =>
      Effect.gen(function* () {
        const before = yield* coordinator.snapshot(brewingOwnerId, BrewingServiceStateSchema)
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
          brewing.setBottle(0, must(itemStack('water_bottle', 1))).pipe(
            Effect.provide(Layer.succeed(WorldCommitCoordinator, rejectingCoordinator)),
          ),
        )
        expect(Result.isFailure(rejected)).toBe(true)

        const after = yield* coordinator.snapshot(brewingOwnerId, BrewingServiceStateSchema)
        expect(after).toStrictEqual(before)
      }),
    ),
  )

  it.effect('caps fuel, restores a snapshot and resets through the coordinator', () =>
    withBrewing(({ brewing }) =>
      Effect.gen(function* () {
        yield* brewing.setFuel(must(itemStack(BREWING_FUEL_ITEM, 64)))
        for (let charge = 0; charge < 21; charge += 1) yield* brewing.addFuel
        expect((yield* brewing.snapshot).fuelCharges).toBe(20)

        const saved = yield* brewing.snapshot
        yield* brewing.reset
        expect((yield* brewing.snapshot).fuelCharges).toBe(0)
        yield* brewing.restore(saved)
        expect((yield* brewing.snapshot).fuelCharges).toBe(20)
      }),
    ),
  )

  it.effect('validates owner initialization and provides a fresh service layer', () =>
    withBrewing(({ coordinator }) =>
      Effect.gen(function* () {
        expect(Result.isFailure(makeBrewingServiceRegistration(brewingOwnerId, { bottles: [] }))).toBe(true)

        const brewing = yield* BrewingService
        expect((yield* brewing.snapshot).fuelCharges).toBe(0)
      }).pipe(
        Effect.provide(
          Layer.merge(
            BrewingServiceLayer(brewingOwnerId),
            Layer.succeed(WorldCommitCoordinator, coordinator),
          ),
        ),
      ),
    ),
  )
})
