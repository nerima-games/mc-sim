import { SimulationTick, type SimulationTick as SimulationTickValue } from '@nerima-games/mc-kernel'
import { Brand, Cause, Effect, Ref, Result, Schema, Semaphore } from 'effect'
import type { DomainEvent, DomainEventBusApi } from './domain-event-bus.js'
import { QueuedIntentSchema, type QueuedIntent } from './intent-queue.js'
import type {
  DimensionRevisionExpectation,
  ReplicatedOwnerCandidate,
  WorldCommitCoordinatorApi,
  WorldCommitCoordinatorError,
  WorldCommitRequest,
} from './world-commit-coordinator.js'
import type { ReplicatedOwnerChange, ReplicatedWorldDelta } from './replicated-state.js'

export type CoreTickStageName = 'intentsAndRules' | 'stations' | 'environment' | 'entities'

export type CoreTickStageCandidate<StageError = never> = Readonly<{
  changes: ReadonlyArray<ReplicatedOwnerCandidate>
  expectedDimensions: ReadonlyArray<DimensionRevisionExpectation>
  events: ReadonlyArray<DomainEvent>
  restore?: (delta: ReplicatedWorldDelta<ReplicatedOwnerChange>) => Effect.Effect<void, StageError>
  value?: unknown
}>

export type CoreTickStageRecord<StageError = never> = Readonly<{
  name: CoreTickStageName
  candidate: CoreTickStageCandidate<StageError>
}>

export type CoreTickStageInput<StageError = never> = Readonly<{
  tick: SimulationTickValue
  ready: ReadonlyArray<QueuedIntent>
  expectedRevision: WorldCommitRequest['expectedRevision']
  previous: ReadonlyArray<CoreTickStageRecord<StageError>>
}>

export type CoreTickStage<StageError = never> = (
  input: CoreTickStageInput<StageError>,
) => Effect.Effect<CoreTickStageCandidate<StageError>, StageError>

export type CoreTickCoordinator = Readonly<{
  revision: WorldCommitCoordinatorApi['revision']
  commit: WorldCommitCoordinatorApi['commit']
}>

export type CoreTickOptions<StageError = never> = Readonly<{
  coordinator: CoreTickCoordinator
  publish: DomainEventBusApi['publish']
  stages: Readonly<{
    intentsAndRules: CoreTickStage<StageError>
    stations: CoreTickStage<StageError>
    environment: CoreTickStage<StageError>
    entities: CoreTickStage<StageError>
  }>
  initialTick?: SimulationTickValue
}>

export type CoreTickInputError =
  | Readonly<{
      _tag: 'CoreTickInvalidOptions'
      value: unknown
    }>
  | Readonly<{
      _tag: 'CoreTickInvalidTick'
      value: unknown
      reason: Brand.BrandError
    }>
  | Readonly<{
      _tag: 'CoreTickTickOverflow'
      current: SimulationTickValue
      reason: Brand.BrandError
    }>
  | Readonly<{
      _tag: 'CoreTickOutOfOrder'
      expected: SimulationTickValue
      actual: SimulationTickValue
    }>
  | Readonly<{
      _tag: 'CoreTickInvalidReadyIntents'
      value: unknown
      reason: Schema.SchemaError
    }>

export type CoreTickPostCommitFailure<StageError = never> = Readonly<{
  _tag: 'CoreTickPostCommitFailure'
  committedTick: SimulationTickValue
  cause: Cause.Cause<StageError | Schema.SchemaError>
}>

export type CoreTickTerminated<StageError = never> = Readonly<{
  _tag: 'CoreTickTerminated'
  committedTick: SimulationTickValue
  failure: CoreTickPostCommitFailure<StageError>
}>

export type CoreTickError<StageError> =
  | CoreTickInputError
  | StageError
  | WorldCommitCoordinatorError
  | CoreTickPostCommitFailure<StageError>
  | CoreTickTerminated<StageError>

export type CoreTickApi<StageError = never> = Readonly<{
  runTick: (
    tick: SimulationTickValue,
    ready: ReadonlyArray<QueuedIntent>,
  ) => Effect.Effect<void, CoreTickError<StageError>>
}>

type PendingTick = Readonly<{
  ready: ReadonlyArray<QueuedIntent>
}>

type TickValidation =
  | Readonly<{ _tag: 'Valid'; tick: SimulationTickValue }>
  | CoreTickInputError

const stageOrder: ReadonlyArray<CoreTickStageName> = [
  'intentsAndRules',
  'stations',
  'environment',
  'entities',
]

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCoreTickOptions = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  const coordinator = value['coordinator']
  const stages = value['stages']
  if (!isRecord(coordinator) || !isRecord(stages)) return false
  return Effect.isEffect(coordinator['revision']) &&
    typeof coordinator['commit'] === 'function' &&
    typeof value['publish'] === 'function' &&
    stageOrder.every((name) => typeof stages[name] === 'function')
}

const validateTick = (
  current: SimulationTickValue,
  input: SimulationTickValue,
): TickValidation => {
  const nextResult = SimulationTick.result(current + 1)
  if (Result.isFailure(nextResult)) {
    return {
      _tag: 'CoreTickTickOverflow',
      current,
      reason: nextResult.failure,
    }
  }

  const inputResult = SimulationTick.result(input)
  if (Result.isFailure(inputResult)) {
    return {
      _tag: 'CoreTickInvalidTick',
      value: input,
      reason: inputResult.failure,
    }
  }

  return inputResult.success === nextResult.success
    ? { _tag: 'Valid', tick: inputResult.success }
    : {
        _tag: 'CoreTickOutOfOrder',
        expected: nextResult.success,
        actual: inputResult.success,
      }
}

const mergeReady = (
  retained: ReadonlyArray<QueuedIntent>,
  incoming: ReadonlyArray<QueuedIntent>,
): ReadonlyArray<QueuedIntent> => {
  const bySequence = new Map<number, QueuedIntent>()
  for (const queued of retained) bySequence.set(queued.sequence, queued)
  for (const queued of incoming) {
    if (!bySequence.has(queued.sequence)) bySequence.set(queued.sequence, queued)
  }
  return [...bySequence.values()].sort((left, right) => {
    const tickOrder = left.intent.targetTick - right.intent.targetTick
    return tickOrder !== 0 ? tickOrder : left.sequence - right.sequence
  })
}

const hasChanges = (
  changes: ReadonlyArray<ReplicatedOwnerCandidate>,
): changes is readonly [ReplicatedOwnerCandidate, ...ReadonlyArray<ReplicatedOwnerCandidate>] =>
  changes.length > 0

export const makeCoreTick = <StageError = never>(
  options: CoreTickOptions<StageError>,
): Effect.Effect<CoreTickApi<StageError>, CoreTickInputError> => {
  if (!isCoreTickOptions(options)) {
    return Effect.fail({ _tag: 'CoreTickInvalidOptions', value: options })
  }
  const initialTick = options.initialTick ?? SimulationTick(0)
  const validInitialTick = SimulationTick.result(initialTick)
  if (Result.isFailure(validInitialTick)) {
    return Effect.fail({
      _tag: 'CoreTickInvalidTick',
      value: initialTick,
      reason: validInitialTick.failure,
    })
  }

  return Effect.gen(function* () {
    const currentTick = yield* Ref.make(validInitialTick.success)
    const pendingTick = yield* Ref.make<PendingTick | undefined>(undefined)
    const terminal = yield* Ref.make<CoreTickPostCommitFailure<StageError> | undefined>(undefined)
    const semaphore = yield* Semaphore.make(1)

    const runTick: CoreTickApi<StageError>['runTick'] = (tick, ready) =>
      Effect.uninterruptibleMask((restore) =>
        semaphore.withPermit(Effect.gen(function* () {
          const terminalFailure = yield* Ref.get(terminal)
          if (terminalFailure !== undefined) {
            const failure: CoreTickTerminated<StageError> = {
              _tag: 'CoreTickTerminated',
              committedTick: terminalFailure.committedTick,
              failure: terminalFailure,
            }
            return yield* Effect.fail(failure)
          }

          const current = yield* Ref.get(currentTick)
          const validation = validateTick(current, tick)
          if (validation._tag !== 'Valid') return yield* Effect.fail(validation)

          const readyResult = Schema.decodeUnknownResult(Schema.Array(QueuedIntentSchema))(ready)
          if (Result.isFailure(readyResult)) {
            return yield* Effect.fail({
              _tag: 'CoreTickInvalidReadyIntents' as const,
              value: ready,
              reason: readyResult.failure,
            })
          }

          const pending = yield* Ref.get(pendingTick)
          const retainedReady = pending === undefined ? [] : pending.ready
          const acceptedReady = mergeReady(retainedReady, readyResult.success)
          yield* Ref.set(pendingTick, { ready: acceptedReady })

          const expectedRevision = yield* options.coordinator.revision
          const previous: Array<CoreTickStageRecord<StageError>> = []
          for (const name of stageOrder) {
            const candidate = yield* restore(options.stages[name]({
              tick: validation.tick,
              ready: acceptedReady,
              expectedRevision,
              previous,
            }))
            previous.push({ name, candidate })
          }

          const changes = previous.flatMap(({ candidate }) => candidate.changes)
          if (hasChanges(changes)) {
            const delta = yield* options.coordinator.commit({
              expectedRevision,
              expectedDimensions: previous.flatMap(({ candidate }) => candidate.expectedDimensions),
              changes,
            })

            const postCommit = yield* Effect.exit(Effect.gen(function* () {
              for (const { candidate } of previous) {
                if (candidate.restore !== undefined) yield* candidate.restore(delta)
              }

              for (const { candidate } of previous) {
                for (const event of candidate.events) yield* options.publish(event)
              }
            }))

            if (postCommit._tag === 'Failure') {
              const failure: CoreTickPostCommitFailure<StageError> = {
                _tag: 'CoreTickPostCommitFailure',
                committedTick: validation.tick,
                cause: postCommit.cause,
              }
              yield* Ref.set(terminal, failure)
              yield* Ref.set(currentTick, validation.tick)
              yield* Ref.set(pendingTick, undefined)
              return yield* Effect.fail(failure)
            }
          }

          yield* Ref.set(currentTick, validation.tick)
          yield* Ref.set(pendingTick, undefined)
        })),
      )

    return {
      runTick,
    }
  })
}
