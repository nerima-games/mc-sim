import { Effect, Layer, Result, Schema } from 'effect'
import * as fc from 'fast-check'
import { describe, expect, it } from '@effect/vitest'
import { VANILLA_ENCHANTMENT_COSTS, WorldIdSchema } from '@nerima-games/mc-kernel'
import {
  AnvilServiceApplyResultSchema,
  AnvilServiceErrorSchema,
  AnvilServiceInputSchema,
  AnvilServiceStateSchema,
  AnvilService,
  AnvilServiceLayer,
  makeAnvilServiceRegistration,
  type AnvilServiceApi,
} from '../src/application/anvil-service.js'
import { ReplicatedOwnerIdSchema } from '../src/application/replicated-state.js'
import {
  makeWorldCommitCoordinator,
  WorldCommitCoordinator,
  type WorldCommitCoordinatorApi,
} from '../src/application/world-commit-coordinator.js'
import {
  AnvilEnchantmentId,
  type AnvilEnchantment,
  type AnvilItemPayload,
  type AnvilState,
} from '../src/domain/anvil.js'

const must = <A, E>(result: Result.Result<A, E>): A => {
  if (Result.isFailure(result)) throw result.failure
  return result.success
}

const ownerId = Schema.decodeUnknownSync(ReplicatedOwnerIdSchema)('test:anvil')

const enchantment = (id: string, level: number): AnvilEnchantment => {
  const result = AnvilEnchantmentId(id)
  if (Result.isFailure(result)) throw new Error('Expected a valid fixture enchantment id')
  return { id: result.success, level }
}

const payload = (
  item: AnvilItemPayload['item'],
  overrides: Partial<AnvilItemPayload> = {},
): AnvilItemPayload => ({
  item,
  durability: null,
  enchantments: [],
  ...overrides,
})

const makeAnvilFixture = Effect.gen(function* () {
  const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('anvil-service-test')
  const registration = must(makeAnvilServiceRegistration(ownerId))
  const coordinator = yield* makeWorldCommitCoordinator({ world, owners: [registration] })
  const anvil = yield* Effect.gen(function* () {
    return yield* AnvilService
  }).pipe(Effect.provide(AnvilServiceLayer(ownerId)))
  return { anvil, coordinator }
})

type AnvilFixture = Readonly<{
  anvil: AnvilServiceApi
  coordinator: WorldCommitCoordinatorApi
}>

const withAnvil = <A, E, R>(run: (fixture: AnvilFixture) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(makeAnvilFixture, (fixture) =>
    Effect.provide(run(fixture), Layer.succeed(WorldCommitCoordinator, fixture.coordinator)),
  )

describe('AnvilService', () => {
  it('strictly decodes input and replicated state schemas', () => {
    const empty = {
      left: null,
      right: null,
      rename: null,
      experienceLevels: 0,
    } satisfies AnvilState
    const registration = must(makeAnvilServiceRegistration(ownerId))

    expect(Result.isSuccess(Schema.decodeUnknownResult(AnvilServiceInputSchema)(empty))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(AnvilServiceInputSchema)({ ...empty, ignored: true }))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(AnvilServiceInputSchema)({
      ...empty,
      left: { item: 'iron_sword', durability: null, enchantments: [], ignored: true },
    }))).toBe(true)
    expect(Result.isSuccess(Schema.decodeUnknownResult(AnvilServiceStateSchema)(registration.initialState))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(AnvilServiceStateSchema)({
      ...registration.initialState,
      ignored: true,
    }))).toBe(true)
    expect(Result.isFailure(makeAnvilServiceRegistration(ownerId, null))).toBe(true)

    const hostileInput = new Proxy({}, {
      ownKeys: () => { throw new Error('hostile key enumeration') },
    })
    expect(Result.isFailure(makeAnvilServiceRegistration(ownerId, hostileInput))).toBe(true)
    expect(Result.isFailure(Schema.decodeUnknownResult(AnvilServiceApplyResultSchema)(hostileInput))).toBe(true)
  })

  it.effect('combines two tools with kernel enchantment cost and commits the result atomically', () =>
    withAnvil(({ anvil, coordinator }) =>
      Effect.gen(function* () {
        const sharpness3 = enchantment('sharpness', 3)
        const input: AnvilState = {
          left: payload('iron_sword', {
            durability: { current: 100, max: 250 },
            enchantments: [sharpness3],
            repairCost: 3,
          }),
          right: {
            payload: payload('iron_sword', {
              durability: { current: 100, max: 250 },
              enchantments: [sharpness3],
              repairCost: 1,
            }),
            count: 1,
          },
          rename: null,
          experienceLevels: 20,
        }
        const expectedLevelCost = 2 + 4 * Number(VANILLA_ENCHANTMENT_COSTS.sharpness.item) + 3 + 1

        yield* anvil.setInputs(input)
        expect(yield* anvil.plan).toMatchObject({ ok: true, levelCost: expectedLevelCost, materialCost: 1 })
        const before = yield* coordinator.snapshot(ownerId, AnvilServiceStateSchema)
        const applied = yield* anvil.apply
        const after = yield* coordinator.snapshot(ownerId, AnvilServiceStateSchema)

        expect(applied).toMatchObject({
          output: {
            item: 'iron_sword',
            durability: { current: 230, max: 250 },
            enchantments: [enchantment('sharpness', 4)],
          },
          levelCost: expectedLevelCost,
          materialCost: 1,
        })
        expect(applied.delta.revision).toBeGreaterThan(before.revision)
        expect(after.state.input).toMatchObject({
          left: null,
          right: null,
          experienceLevels: 20 - expectedLevelCost,
        })
        expect(after.state.output).toStrictEqual(applied.output)
        expect(Result.isSuccess(Schema.decodeUnknownResult(AnvilServiceApplyResultSchema)(applied))).toBe(true)
      }),
    ),
  )

  it.effect('returns typed schema and domain failures without changing committed state', () =>
    withAnvil(({ anvil }) =>
      Effect.gen(function* () {
        const before = yield* anvil.snapshot
        const invalidInput = yield* Effect.result(anvil.setInputs({ left: 'iron_sword' }))
        expect(Result.isFailure(invalidInput)).toBe(true)
        if (Result.isFailure(invalidInput)) {
          expect(Result.isSuccess(Schema.decodeUnknownResult(AnvilServiceErrorSchema)(invalidInput.failure))).toBe(true)
        }
        expect(yield* anvil.snapshot).toStrictEqual(before)

        const invalidPlan = yield* Effect.result(anvil.apply)
        expect(invalidPlan).toMatchObject({
          _tag: 'Failure',
          failure: { _tag: 'AnvilServiceApplyFailure', reason: 'invalid-input' },
        })
        expect(yield* anvil.snapshot).toStrictEqual(before)
      }),
    ),
  )

  it('returns typed failures or schema-decodable success for arbitrary service input', async () => {
    const fixture = await Effect.runPromise(makeAnvilFixture)
    await fc.assert(fc.asyncProperty(fc.anything({ maxDepth: 4 }), async (input) => {
      let outcome: Result.Result<void, unknown>
      try {
        outcome = await Effect.runPromise(
          Effect.result(fixture.anvil.setInputs(input).pipe(
            Effect.provideService(WorldCommitCoordinator, fixture.coordinator),
          )),
        )
      } catch {
        return false
      }
      if (Result.isFailure(outcome)) {
        return Result.isSuccess(Schema.decodeUnknownResult(AnvilServiceErrorSchema)(outcome.failure))
      }
      return Result.isSuccess(Schema.decodeUnknownResult(AnvilServiceInputSchema)(input))
    }))
  })
})
