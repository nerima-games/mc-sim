import { Context, Effect, Layer, Result, Schema } from 'effect'
import { applyVanillaAnvil, planVanillaAnvil } from '../domain/enchantment.js'
import {
  ANVIL_SNAPSHOT_VERSION,
  decodeAnvilSnapshot,
  type AnvilApplyResult,
  type AnvilInputStack,
  type AnvilPlan,
  type AnvilRejectionReason,
  type AnvilState,
  type AnvilValidationIssue,
  type CanonicalAnvilItemPayload,
  type CanonicalAnvilState,
} from '../domain/anvil.js'
import { AnvilMaterialCost as createAnvilMaterialCost } from '../domain/anvil-primitives.js'
import { SchemaErrorSchema } from '../schema-errors.js'
import {
  ReplicatedOwnerChangeSchema,
  type ReplicatedOwnerId,
  type ReplicatedWorldDelta,
  replicatedWorldDeltaSchema,
} from './replicated-state.js'
import {
  WorldCommitCoordinator,
  WorldCommitCoordinatorErrorSchema,
  type ReplicatedOwnerCandidate,
  type ReplicatedOwnerRegistration,
  type WorldCommitCoordinatorError,
} from './world-commit-coordinator.js'

export type AnvilServiceState = Readonly<{
  input: AnvilState
  output: CanonicalAnvilItemPayload | null
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactKeys = (value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean => {
  const expected = new Set(keys)
  const actual = Object.keys(value)
  return actual.length === expected.size && actual.every((key) => expected.has(key))
}

const isAnvilInput = (value: unknown): value is AnvilState => {
  const valid = Result.try({
    try: () => decodeAnvilSnapshot({ version: ANVIL_SNAPSHOT_VERSION, state: value }).ok,
    catch: () => false,
  })
  return Result.isSuccess(valid) && valid.success
}

export const AnvilServiceInputSchema: Schema.Codec<AnvilState, unknown> =
  Schema.declare(isAnvilInput)

const isCanonicalPayload = (value: unknown): value is CanonicalAnvilItemPayload => {
  const valid = Result.try({
    try: () => {
      if (!isRecord(value) || !hasExactKeys(value, ['item', 'durability', 'enchantments', 'repairCost', 'customName'])) return false
      const snapshot = decodeAnvilSnapshot({
        version: ANVIL_SNAPSHOT_VERSION,
        state: { left: value, right: null, rename: null, experienceLevels: 0 },
      })
      return snapshot.ok && snapshot.snapshot.state.left !== null
    },
    catch: () => false,
  })
  return Result.isSuccess(valid) && valid.success
}

const isAnvilServiceState = (value: unknown): value is AnvilServiceState => {
  const valid = Result.try({
    try: () => {
      if (!isRecord(value) || !hasExactKeys(value, ['input', 'output']) || !isAnvilInput(value['input'])) return false
      return value['output'] === null || isCanonicalPayload(value['output'])
    },
    catch: () => false,
  })
  return Result.isSuccess(valid) && valid.success
}

export const AnvilServiceStateSchema: Schema.Codec<AnvilServiceState, unknown> =
  Schema.declare(isAnvilServiceState)

export type AnvilServiceApplyFailure = Readonly<{
  _tag: 'AnvilServiceApplyFailure'
  reason: AnvilRejectionReason
  issues: ReadonlyArray<AnvilValidationIssue>
}>

export const AnvilServiceApplyFailureSchema: Schema.Codec<AnvilServiceApplyFailure, unknown> =
  Schema.TaggedStruct('AnvilServiceApplyFailure', {
    reason: Schema.Literals([
      'invalid-input',
      'invalid-rules',
      'incompatible-input',
      'invalid-enchantment',
      'enchantment-conflict',
      'nothing-to-do',
      'too-expensive',
      'insufficient-experience',
    ]),
    issues: Schema.Array(Schema.Struct({ path: Schema.String, reason: Schema.String })),
  })

export type AnvilServiceApplyResult = Readonly<{
  output: CanonicalAnvilItemPayload
  levelCost: number
  materialCost: number
  delta: ReplicatedWorldDelta<unknown>
}>

const AnvilServiceDeltaSchema = replicatedWorldDeltaSchema(ReplicatedOwnerChangeSchema)

export const AnvilServiceApplyResultSchema: Schema.Codec<AnvilServiceApplyResult, unknown> =
  Schema.declare((value: unknown): value is AnvilServiceApplyResult => {
    const valid = Result.try({
      try: () => {
        if (
          !isRecord(value) ||
          !hasExactKeys(value, ['output', 'levelCost', 'materialCost', 'delta']) ||
          !isCanonicalPayload(value['output']) ||
          typeof value['levelCost'] !== 'number' || !Number.isSafeInteger(value['levelCost']) || value['levelCost'] < 0 ||
          typeof value['materialCost'] !== 'number'
        ) return false
        const materialCost = createAnvilMaterialCost(value['materialCost'])
        return Result.isSuccess(materialCost) && Result.isSuccess(Schema.decodeUnknownResult(AnvilServiceDeltaSchema)(value['delta']))
      },
      catch: () => false,
    })
    return Result.isSuccess(valid) && valid.success
  })

export type AnvilServiceError =
  | Schema.SchemaError
  | WorldCommitCoordinatorError
  | AnvilServiceApplyFailure

export const AnvilServiceErrorSchema: Schema.Codec<AnvilServiceError, unknown> = Schema.Union([
  SchemaErrorSchema,
  WorldCommitCoordinatorErrorSchema,
  AnvilServiceApplyFailureSchema,
])

export type AnvilServiceApi = Readonly<{
  snapshot: Effect.Effect<AnvilServiceState, Schema.SchemaError | WorldCommitCoordinatorError, WorldCommitCoordinator>
  setInputs: (input: unknown) => Effect.Effect<void, AnvilServiceError, WorldCommitCoordinator>
  plan: Effect.Effect<AnvilPlan, Schema.SchemaError | WorldCommitCoordinatorError, WorldCommitCoordinator>
  apply: Effect.Effect<AnvilServiceApplyResult, AnvilServiceError, WorldCommitCoordinator>
}>

const AnvilServiceBase: Context.ServiceClass<
  AnvilService,
  '@nerima-games/mc-sim/AnvilService',
  AnvilServiceApi
> = Context.Service<AnvilService, AnvilServiceApi>()('@nerima-games/mc-sim/AnvilService')

export class AnvilService extends AnvilServiceBase {}

const serviceFailure = (
  reason: AnvilRejectionReason,
  issues: ReadonlyArray<AnvilValidationIssue>,
): AnvilServiceApplyFailure => ({ _tag: 'AnvilServiceApplyFailure', reason, issues })

const inputFromCanonical = (state: CanonicalAnvilState): AnvilState => ({
  left: state.left,
  right: state.right === null
    ? null
    : { payload: state.right.payload, count: state.right.count } satisfies AnvilInputStack,
  rename: state.rename,
  experienceLevels: state.experienceLevels,
})

const canonicalInputOf = (
  input: unknown,
): Result.Result<AnvilState, AnvilServiceApplyFailure> => {
  const snapshot = Result.try({
    try: () => decodeAnvilSnapshot({ version: ANVIL_SNAPSHOT_VERSION, state: input }),
    catch: () => undefined,
  })
  if (Result.isFailure(snapshot)) {
    return Result.fail(serviceFailure('invalid-input', [{ path: '$.state', reason: 'must be a valid anvil input state' }]))
  }
  if (!snapshot.success.ok) return Result.fail(serviceFailure('invalid-input', snapshot.success.issues))
  return Result.succeed(inputFromCanonical(snapshot.success.snapshot.state))
}

const canonicalStateOf = (initial: unknown): Result.Result<AnvilServiceState, AnvilServiceApplyFailure> =>
  Result.map(canonicalInputOf(initial), (input) => ({ input, output: null }))

const EMPTY_ANVIL_STATE: AnvilState = {
  left: null,
  right: null,
  rename: null,
  experienceLevels: 0,
}

export const makeAnvilServiceRegistration = (
  ownerId: ReplicatedOwnerId,
  initial?: unknown,
): Result.Result<ReplicatedOwnerRegistration<typeof AnvilServiceStateSchema>, AnvilServiceApplyFailure> => {
  const state = canonicalStateOf(initial === undefined ? EMPTY_ANVIL_STATE : initial)
  return Result.map(state, (initialState) => ({
    ownerId,
    schema: AnvilServiceStateSchema,
    initialState,
  }))
}

export const makeAnvilService = (
  ownerId: ReplicatedOwnerId,
): Effect.Effect<AnvilServiceApi> =>
  Effect.succeed({
    snapshot: Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
      Effect.map(coordinator.snapshot(ownerId, AnvilServiceStateSchema), ({ state }) => state),
    ),
    setInputs: (input) => Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(AnvilServiceInputSchema)(input)
      const canonicalInput = yield* Effect.fromResult(canonicalInputOf(decoded))
      const coordinator = yield* WorldCommitCoordinator
      const snapshot = yield* coordinator.snapshot(ownerId, AnvilServiceStateSchema)
      yield* coordinator.commit({
        expectedRevision: snapshot.revision,
        expectedDimensions: [],
        changes: [{ ownerId, state: { input: canonicalInput, output: null } }],
      })
    }),
    plan: Effect.flatMap(WorldCommitCoordinator, (coordinator) =>
      Effect.map(coordinator.snapshot(ownerId, AnvilServiceStateSchema), ({ state }) =>
        planVanillaAnvil(state.input),
      ),
    ),
    apply: Effect.gen(function* () {
      const coordinator = yield* WorldCommitCoordinator
      const snapshot = yield* coordinator.snapshot(ownerId, AnvilServiceStateSchema)
      const applied: AnvilApplyResult = applyVanillaAnvil(snapshot.state.input)
      if (!applied.ok) return yield* Effect.fail(serviceFailure(applied.reason, applied.issues))

      const nextInput = yield* Effect.fromResult(canonicalInputOf(applied.state))
      const nextState: AnvilServiceState = { input: nextInput, output: applied.output }
      const delta = yield* coordinator.commit({
        expectedRevision: snapshot.revision,
        expectedDimensions: [],
        changes: [{ ownerId, state: nextState } satisfies ReplicatedOwnerCandidate],
      })
      return {
        output: applied.output,
        levelCost: applied.levelCost,
        materialCost: applied.materialCost,
        delta,
      }
    }),
  })

export const AnvilServiceLayer = (
  ownerId: ReplicatedOwnerId,
): Layer.Layer<AnvilService> =>
  Layer.effect(AnvilService, makeAnvilService(ownerId))
