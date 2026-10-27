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
const playerOwnerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('test:player')
const PlayerTransferStateSchema = Schema.Struct({ inventory: Schema.Unknown, experience: Schema.Finite })

const makeFurnaceFixture = Effect.gen(function* () {
  const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('furnace-service-test')
  const registration = must(makeFurnaceServiceRegistration(furnaceOwnerId))
  const playerRegistration = {
    ownerId: playerOwnerId,
    schema: PlayerTransferStateSchema,
    initialState: { inventory: emptyInventory(), experience: 0 },
  }
  const coordinator = yield* makeWorldCommitCoordinator({ world, owners: [registration, playerRegistration] })
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
        const beforeInput = yield* coordinator.snapshot(furnaceOwnerId, FurnaceServiceStateSchema)
        yield* furnace.setInput(must(itemStack('iron_ore', 1)))
        const afterInput = yield* coordinator.snapshot(furnaceOwnerId, FurnaceServiceStateSchema)
        expect(afterInput.revision).not.toBe(beforeInput.revision)
        yield* furnace.setFuel(must(itemStack('coal', 1)))

        const recipe = VANILLA_SMELTING_RECIPES.find((candidate) => candidate.input === 'iron_ore')
        expect(recipe).toBeDefined()
        const outcome = yield* furnace.advance(10)
        expect(outcome.smeltedCount).toBe(1)
        expect((yield* furnace.snapshot).output?.item).toBe('iron_ingot')

        const furnaceBeforeOutput = yield* coordinator.snapshot(furnaceOwnerId, FurnaceServiceStateSchema)
        expect(furnaceBeforeOutput.state.furnace.output?.item).toBe('iron_ingot')
        expect(furnaceBeforeOutput.state.experience).toBeGreaterThan(0)
        const playerBeforeOutput = yield* coordinator.snapshot(playerOwnerId, PlayerTransferStateSchema)

        const output = yield* furnace.prepareCollectOutput(emptyInventory())
        expect(output.outcome.result._tag).toBe('Collected')
        expect(output.outcome.inventory.slots.some((slot) => slot?.item === 'iron_ingot')).toBe(true)
        const outputFurnaceCandidate = output.ownerCandidate
        if (outputFurnaceCandidate === undefined) throw new Error('collected output missing furnace candidate')

        const failedOutputCommit = yield* Effect.result(coordinator.commit({
          expectedRevision: output.expectedRevision,
          expectedDimensions: [],
          changes: [
            outputFurnaceCandidate,
            { ownerId: playerOwnerId, state: { inventory: output.outcome.inventory, experience: 'invalid' } },
          ],
        }))
        expect(Result.isFailure(failedOutputCommit)).toBe(true)
        expect(yield* coordinator.snapshot(furnaceOwnerId, FurnaceServiceStateSchema)).toStrictEqual(furnaceBeforeOutput)
        expect(yield* coordinator.snapshot(playerOwnerId, PlayerTransferStateSchema)).toStrictEqual(playerBeforeOutput)

        yield* coordinator.commit({
          expectedRevision: output.expectedRevision,
          expectedDimensions: [],
          changes: [
            outputFurnaceCandidate,
            {
              ownerId: playerOwnerId,
              state: { ...playerBeforeOutput.state, inventory: output.outcome.inventory },
            },
          ],
        })
        const playerAfterOutput = yield* coordinator.snapshot(playerOwnerId, PlayerTransferStateSchema)
        expect(playerAfterOutput.state.inventory).toStrictEqual(output.outcome.inventory)
        expect((yield* furnace.snapshot).output).toBeUndefined()

        const experience = yield* furnace.prepareCollectExperience
        expect(experience.experience).toBeGreaterThan(0)
        const experienceFurnaceCandidate = experience.ownerCandidate
        if (experienceFurnaceCandidate === undefined) throw new Error('collected experience missing furnace candidate')
        const furnaceBeforeExperience = yield* coordinator.snapshot(furnaceOwnerId, FurnaceServiceStateSchema)

        const failedExperienceCommit = yield* Effect.result(coordinator.commit({
          expectedRevision: experience.expectedRevision,
          expectedDimensions: [],
          changes: [
            experienceFurnaceCandidate,
            {
              ownerId: playerOwnerId,
              state: { ...playerAfterOutput.state, experience: Number.NaN },
            },
          ],
        }))
        expect(Result.isFailure(failedExperienceCommit)).toBe(true)
        expect(yield* coordinator.snapshot(furnaceOwnerId, FurnaceServiceStateSchema)).toStrictEqual(furnaceBeforeExperience)
        expect(yield* coordinator.snapshot(playerOwnerId, PlayerTransferStateSchema)).toStrictEqual(playerAfterOutput)

        yield* coordinator.commit({
          expectedRevision: experience.expectedRevision,
          expectedDimensions: [],
          changes: [
            experienceFurnaceCandidate,
            {
              ownerId: playerOwnerId,
              state: { ...playerAfterOutput.state, experience: experience.experience },
            },
          ],
        })
        expect((yield* coordinator.snapshot(furnaceOwnerId, FurnaceServiceStateSchema)).state.experience).toBe(0)
        expect((yield* coordinator.snapshot(playerOwnerId, PlayerTransferStateSchema)).state.experience).toBe(experience.experience)

        const noExperience = yield* furnace.prepareCollectExperience
        expect(noExperience.experience).toBe(0)
        expect(noExperience.ownerCandidate).toBeUndefined()
      }),
    ),
  )

  it.effect('rejects malformed inventory before preparing furnace output', () =>
    withFurnace(({ furnace, coordinator }) =>
      Effect.gen(function* () {
        yield* furnace.setInput(must(itemStack('iron_ore', 1)))
        yield* furnace.setFuel(must(itemStack('coal', 1)))
        yield* furnace.advance(10)
        const before = yield* coordinator.snapshot(furnaceOwnerId, FurnaceServiceStateSchema)

        const result = yield* Effect.result(furnace.prepareCollectOutput(null as never))

        expect(result).toMatchObject({
          _tag: 'Failure',
          failure: { _tag: 'FurnaceStateValidationFailure', path: 'inventory' },
        })
        expect(yield* coordinator.snapshot(furnaceOwnerId, FurnaceServiceStateSchema)).toStrictEqual(before)
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

        const blocked = yield* furnace.prepareCollectOutput({
          slots: Array.from({ length: 36 }, () => must(itemStack('cobblestone', 64))),
        })
        expect(blocked.outcome.result._tag).toBe('NoRoom')
        expect(blocked.ownerCandidate).toBeUndefined()
        expect(yield* furnace.snapshot).toStrictEqual(readyToCollect)

        const invalidRestore = yield* Effect.result(furnace.restore({}))
        expect(Result.isFailure(invalidRestore)).toBe(true)
        expect(yield* furnace.snapshot).toStrictEqual(readyToCollect)
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
