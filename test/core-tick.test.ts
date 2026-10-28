import { describe, expect, it } from '@effect/vitest'
import { DomainEventSchema, SimulationTick, WorldIdSchema } from '@nerima-games/mc-kernel'
import { Brand, Cause, Deferred, Effect, Fiber, Ref, Result, Schema } from 'effect'
import type { DomainEvent } from '../src/application/domain-event-bus.js'
import {
  makeCoreTick,
  type CoreTickCoordinator,
  type CoreTickStageCandidate,
  type CoreTickStageInput,
} from '../src/application/core.js'
import { IntentSchema } from '../src/application/intent-queue.js'
import type { QueuedIntent } from '../src/application/intent-queue.js'
import type { ReplicatedOwnerId } from '../src/application/replicated-state.js'
import {
  WorldRevisionConflict,
  type ReplicatedOwnerCandidate,
  type WorldCommitRequest,
} from '../src/application/world-commit-coordinator.js'

const makeTick = Brand.nominal<SimulationTick>()
const makeRevision = Brand.nominal<WorldCommitRequest['expectedRevision']>()
const makeOwnerId = Brand.nominal<ReplicatedOwnerId>()
const makeWorldId = Schema.decodeUnknownSync(WorldIdSchema)

const commitDeltaFor = (request: WorldCommitRequest) => ({
  world: makeWorldId('core-tick-test-world'),
  revision: makeRevision(Number(request.expectedRevision) + 1),
  changes: request.changes.map(({ ownerId, state }) => ({ owner: ownerId, state })),
  blockChanges: [],
})

const readyIntent = (id: string, sequence: number, targetTick: number = 1): QueuedIntent => ({
  sequence: Brand.nominal<QueuedIntent['sequence']>()(sequence),
  intent: Schema.decodeUnknownSync(IntentSchema)({
    id,
    targetTick,
    source: 'local',
    payload: { _tag: 'MeleeAttack', actor: 'player-1' },
  }),
})

const levelUp = (entity: string, tick: number): DomainEvent =>
  Schema.decodeUnknownSync(DomainEventSchema)({
    _tag: 'LevelUp',
    tick,
    entity,
    position: { dimension: 'overworld', x: 0, y: 64, z: 0 },
    level: 2,
  })

const emptyCandidate = (): CoreTickStageCandidate => ({
  changes: [],
  expectedDimensions: [],
  events: [],
})

type TestStages = {
  intentsAndRules: (input: CoreTickStageInput) => Effect.Effect<CoreTickStageCandidate>
  stations: (input: CoreTickStageInput) => Effect.Effect<CoreTickStageCandidate>
  environment: (input: CoreTickStageInput) => Effect.Effect<CoreTickStageCandidate>
  entities: (input: CoreTickStageInput) => Effect.Effect<CoreTickStageCandidate>
}

const noOpStages = (): TestStages => ({
  intentsAndRules: () => Effect.succeed(emptyCandidate()),
  stations: () => Effect.succeed(emptyCandidate()),
  environment: () => Effect.succeed(emptyCandidate()),
  entities: () => Effect.succeed(emptyCandidate()),
})

const coordinatorAt = (
  revision: WorldCommitRequest['expectedRevision'],
  onCommit: CoreTickCoordinator['commit'] = (request) => Effect.succeed(commitDeltaFor(request)),
): CoreTickCoordinator => ({
  revision: Effect.succeed(revision),
  commit: onCommit,
})

const candidateFor = (
  stage: string,
  tick: number,
  log: Array<string>,
): CoreTickStageCandidate => ({
  changes: [{ ownerId: makeOwnerId(`${stage}-owner`), state: { stage, tick } }],
  expectedDimensions: [],
  events: [levelUp(`${stage}-entity`, tick)],
  restore: () => Effect.sync(() => log.push(`restore:${stage}`)),
})

describe('CoreTick', () => {
  it.effect('rejects an invalid initial tick before creating the tick runtime', () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(makeCoreTick({
        coordinator: coordinatorAt(makeRevision(0)),
        stages: noOpStages(),
        publish: () => Effect.void,
        initialTick: makeTick(-1),
      }))

      expect(result._tag).toBe('Failure')
      if (result._tag === 'Failure') {
        expect(result.failure._tag).toBe('CoreTickInvalidTick')
      }
    }),
  )

  it.effect('runs the fixed stage order, groups owner changes, restores, publishes, and advances the passed next tick', () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const requests: Array<WorldCommitRequest> = []
      const stage = (name: string) => (input: CoreTickStageInput) => Effect.sync(() => {
        log.push(`stage:${name}:${input.tick}:${input.previous.length}`)
        return candidateFor(name, input.tick, log)
      })
      const stages = {
        intentsAndRules: stage('intentsAndRules'),
        stations: stage('stations'),
        environment: stage('environment'),
        entities: stage('entities'),
      }
      const coordinator = coordinatorAt(makeRevision(7), (request) => Effect.sync(() => {
        requests.push(request)
        log.push(`commit:${request.changes.length}`)
        return commitDeltaFor(request)
      }))
      const core = yield* makeCoreTick({
        coordinator,
        stages,
        publish: (event) => Effect.sync(() => {
          if (event._tag === 'LevelUp') log.push(`publish:${event.entity}`)
        }),
      })
      const ready = readyIntent('attack-1', 0)

      yield* core.runTick(SimulationTick(1), [ready])

      expect(log).toStrictEqual([
        'stage:intentsAndRules:1:0',
        'stage:stations:1:1',
        'stage:environment:1:2',
        'stage:entities:1:3',
        'commit:4',
        'restore:intentsAndRules',
        'restore:stations',
        'restore:environment',
        'restore:entities',
        'publish:intentsAndRules-entity',
        'publish:stations-entity',
        'publish:environment-entity',
        'publish:entities-entity',
      ])
      expect(requests).toHaveLength(1)
      expect(requests[0]?.expectedRevision).toBe(7)
      expect(requests[0]?.changes).toStrictEqual([
        { ownerId: makeOwnerId('intentsAndRules-owner'), state: { stage: 'intentsAndRules', tick: 1 } },
        { ownerId: makeOwnerId('stations-owner'), state: { stage: 'stations', tick: 1 } },
        { ownerId: makeOwnerId('environment-owner'), state: { stage: 'environment', tick: 1 } },
        { ownerId: makeOwnerId('entities-owner'), state: { stage: 'entities', tick: 1 } },
      ] satisfies ReadonlyArray<ReplicatedOwnerCandidate>)
    }),
  )

  it.effect('retains taken intents across a stage failure and retries every stage with the latest revision', () =>
    Effect.gen(function* () {
      const latestRevision = yield* Ref.make(makeRevision(3))
      const observedRevisions: Array<number> = []
      const seenReady: Array<ReadonlyArray<QueuedIntent>> = []
      const log: Array<string> = []
      let environmentRuns = 0
      const stageFailure = { _tag: 'CoreTickStageFailure' as const }
      const ready = [
        readyIntent('late-sequence', 2),
        readyIntent('first-sequence', 1),
        readyIntent('earlier-tick', 3, 0),
      ]
      const output = emptyCandidate()
      const core = yield* makeCoreTick<typeof stageFailure>({
        coordinator: {
          revision: Ref.get(latestRevision),
          commit: (request) => Effect.succeed(commitDeltaFor(request)),
        },
        publish: () => Effect.void,
        stages: {
          intentsAndRules: (input) => Effect.sync(() => {
            observedRevisions.push(Number(input.expectedRevision))
            seenReady.push(input.ready)
            return emptyCandidate()
          }),
          stations: () => Effect.succeed(emptyCandidate()),
          environment: () => {
            environmentRuns += 1
            return environmentRuns === 1
              ? Effect.fail(stageFailure)
              : Effect.succeed(output)
          },
          entities: () => Effect.succeed({
            ...candidateFor('entity', 1, log),
            events: [],
          }),
        },
      })

      const firstAttempt = yield* Effect.result(core.runTick(SimulationTick(1), ready))
      expect(Result.isFailure(firstAttempt)).toBe(true)
      yield* Ref.set(latestRevision, makeRevision(9))

      yield* core.runTick(SimulationTick(1), [
        readyIntent('duplicate-sequence', 1),
        readyIntent('new-earlier-tick', 4, 0),
      ])

      expect(seenReady.map((batch) => batch.map(({ intent }) => intent.id))).toStrictEqual([
        ['earlier-tick', 'first-sequence', 'late-sequence'],
        ['earlier-tick', 'new-earlier-tick', 'first-sequence', 'late-sequence'],
      ])
      expect(seenReady[1]).toHaveLength(4)
      expect(seenReady[1]?.map(({ sequence, intent }) => [intent.targetTick, sequence])).toStrictEqual([
        [0, 3],
        [0, 4],
        [1, 1],
        [1, 2],
      ])
      expect(new Set(seenReady[1]?.map(({ sequence }) => sequence)).size).toBe(seenReady[1]?.length)
      expect(observedRevisions).toStrictEqual([3, 9])
      yield* core.runTick(SimulationTick(2), [])
      expect(seenReady[2]).toStrictEqual([])
      expect(observedRevisions).toStrictEqual([3, 9, 9])
    }),
  )

  it.effect('keeps candidates staged after a failed grouped commit and retries before restoring or publishing', () =>
    Effect.gen(function* () {
      const latestRevision = yield* Ref.make(makeRevision(2))
      const operations: Array<string> = []
      const requests: Array<WorldCommitRequest> = []
      const conflict = new WorldRevisionConflict({
        expected: makeRevision(2),
        actual: makeRevision(3),
      })
      let commitAttempts = 0
      const output: CoreTickStageCandidate = {
        changes: [{ ownerId: makeOwnerId('rules-owner'), state: { value: 1 } }],
        expectedDimensions: [],
        events: [levelUp('rules', 1)],
        restore: () => Effect.sync(() => operations.push('restore')),
      }
      const core = yield* makeCoreTick({
        coordinator: {
          revision: Ref.get(latestRevision),
          commit: (request) => {
            requests.push(request)
            commitAttempts += 1
            operations.push(`commit:${Number(request.expectedRevision)}`)
            return commitAttempts === 1
              ? Effect.fail(conflict)
              : Effect.succeed(commitDeltaFor(request))
          },
        },
        publish: () => Effect.sync(() => operations.push('publish')),
        stages: {
          intentsAndRules: () => Effect.succeed(output),
          stations: () => Effect.succeed(emptyCandidate()),
          environment: () => Effect.succeed(emptyCandidate()),
          entities: () => Effect.succeed(emptyCandidate()),
        },
      })

      const firstAttempt = yield* Effect.result(core.runTick(SimulationTick(1), [readyIntent('commit-retry', 0)]))
      expect(Result.isFailure(firstAttempt)).toBe(true)
      expect(operations).toStrictEqual(['commit:2'])
      yield* Ref.set(latestRevision, makeRevision(8))

      yield* core.runTick(SimulationTick(1), [])

      expect(requests).toHaveLength(2)
      expect(operations).toStrictEqual(['commit:2', 'commit:8', 'restore', 'publish'])
    }),
  )

  it.effect('terminates after a restore failure following commit without rerunning stages or publishing events', () =>
    Effect.gen(function* () {
      const operations: Array<string> = []
      const stageCalls: Array<string> = []
      let commitCalls = 0
      const restoreFailure = { _tag: 'CoreTickRestoreFailure' as const }
      const candidate: CoreTickStageCandidate<typeof restoreFailure> = {
        changes: [{ ownerId: makeOwnerId('restore-failure-owner'), state: { value: 1 } }],
        expectedDimensions: [],
        events: [levelUp('restore-failure', 1)],
        restore: () => { operations.push('restore'); return Effect.fail(restoreFailure) },
      }
      const core = yield* makeCoreTick<typeof restoreFailure>({
        coordinator: coordinatorAt(makeRevision(0), (request) => Effect.sync(() => {
          commitCalls += 1
          operations.push('commit')
          return commitDeltaFor(request)
        })),
        stages: {
          intentsAndRules: () => Effect.sync(() => { stageCalls.push('intentsAndRules'); return candidate }),
          stations: () => Effect.sync(() => { stageCalls.push('stations'); return emptyCandidate() }),
          environment: () => Effect.sync(() => { stageCalls.push('environment'); return emptyCandidate() }),
          entities: () => Effect.sync(() => { stageCalls.push('entities'); return emptyCandidate() }),
        },
        publish: () => Effect.sync(() => { operations.push('publish') }),
      })

      const first = yield* Effect.result(core.runTick(SimulationTick(1), [readyIntent('committed-intent', 0)]))
      const sameTick = yield* Effect.result(core.runTick(SimulationTick(1), []))
      const nextTick = yield* Effect.result(core.runTick(SimulationTick(2), [readyIntent('later-intent', 1, 2)]))

      expect(Result.isFailure(first)).toBe(true)
      if (Result.isFailure(first)) {
        expect(first.failure._tag).toBe('CoreTickPostCommitFailure')
        if (first.failure._tag === 'CoreTickPostCommitFailure') {
          expect(Number(first.failure.committedTick)).toBe(1)
          expect(Cause.hasFails(first.failure.cause)).toBe(true)
          const preservedFailure = Cause.findError(first.failure.cause)
          expect(Result.isSuccess(preservedFailure)).toBe(true)
          if (Result.isSuccess(preservedFailure)) {
            expect(preservedFailure.success).toBe(restoreFailure)
          }
        }
      }
      expect(Result.isFailure(sameTick)).toBe(true)
      if (Result.isFailure(sameTick)) {
        expect(sameTick.failure._tag).toBe('CoreTickTerminated')
        if (sameTick.failure._tag === 'CoreTickTerminated') {
          expect(Number(sameTick.failure.committedTick)).toBe(1)
        }
      }
      expect(Result.isFailure(nextTick)).toBe(true)
      if (Result.isFailure(nextTick)) {
        expect(nextTick.failure._tag).toBe('CoreTickTerminated')
        if (nextTick.failure._tag === 'CoreTickTerminated') {
          expect(Number(nextTick.failure.committedTick)).toBe(1)
        }
      }
      expect(stageCalls).toStrictEqual(['intentsAndRules', 'stations', 'environment', 'entities'])
      expect(commitCalls).toBe(1)
      expect(operations).toStrictEqual(['commit', 'restore'])
    }),
  )

  it.effect('rejects malformed and out-of-order ticks before buffering their ready intents', () =>
    Effect.gen(function* () {
      const seenReady: Array<ReadonlyArray<QueuedIntent>> = []
      const stages = noOpStages()
      stages.intentsAndRules = (input) => Effect.sync(() => {
        seenReady.push(input.ready)
        return emptyCandidate()
      })
      const core = yield* makeCoreTick({
        coordinator: coordinatorAt(makeRevision(0)),
        stages,
        publish: () => Effect.void,
      })
      const ready = readyIntent('invalid-tick-ready', 0)
      const invalid = yield* Effect.result(core.runTick(makeTick(-1), [ready]))
      const outOfOrder = yield* Effect.result(core.runTick(SimulationTick(2), [ready]))
      expect(Result.isFailure(invalid)).toBe(true)
      expect(Result.isFailure(outOfOrder)).toBe(true)

      yield* core.runTick(SimulationTick(1), [])
      expect(seenReady).toStrictEqual([[]])
    }),
  )

  it.effect('rejects malformed ready intents before running stages, committing, or publishing', () =>
    Effect.gen(function* () {
      let stageCalls = 0
      let commitCalls = 0
      let publishCalls = 0
      const stages = noOpStages()
      stages.intentsAndRules = () => Effect.sync(() => {
        stageCalls += 1
        return {
          changes: [{ ownerId: makeOwnerId('ready-owner'), state: { value: 1 } }],
          expectedDimensions: [],
          events: [levelUp('ready-entity', 1)],
        }
      })
      const core = yield* makeCoreTick({
        coordinator: coordinatorAt(makeRevision(0), (request) => Effect.sync(() => {
          commitCalls += 1
          return commitDeltaFor(request)
        })),
        stages,
        publish: () => Effect.sync(() => { publishCalls += 1 }),
      })

      const malformed = yield* Effect.result(core.runTick(makeTick(1), [null] as never))
      expect(malformed._tag).toBe('Failure')
      if (malformed._tag === 'Failure') expect(malformed.failure._tag).toBe('CoreTickInvalidReadyIntents')
      expect(stageCalls).toBe(0)
      expect(commitCalls).toBe(0)
      expect(publishCalls).toBe(0)

      const valid = yield* Effect.result(core.runTick(makeTick(1), [readyIntent('valid-after-invalid', 0)]))
      expect(valid._tag).toBe('Success')
      expect(stageCalls).toBe(1)
      expect(commitCalls).toBe(1)
      expect(publishCalls).toBe(1)
    }),
  )

  it.effect('rejects tick overflow before running stages or accepting ready intents', () =>
    Effect.gen(function* () {
      let stageCalls = 0
      const stages = noOpStages()
      stages.intentsAndRules = () => Effect.sync(() => {
        stageCalls += 1
        return emptyCandidate()
      })
      const core = yield* makeCoreTick({
        coordinator: coordinatorAt(makeRevision(0)),
        initialTick: makeTick(Number.MAX_SAFE_INTEGER),
        stages,
        publish: () => Effect.void,
      })
      const overflow = yield* Effect.result(core.runTick(makeTick(Number.MAX_SAFE_INTEGER + 1), [readyIntent('overflow-ready', 0)]))
      expect(Result.isFailure(overflow)).toBe(true)
      expect(stageCalls).toBe(0)
    }),
  )

  it.effect('skips commit, restore, and event publication for ticks without owner changes', () =>
    Effect.gen(function* () {
      let commitCalls = 0
      let publishCalls = 0
      const seenTicks: Array<number> = []
      const stages = noOpStages()
      stages.intentsAndRules = (input) => Effect.sync(() => {
        seenTicks.push(Number(input.tick))
        return emptyCandidate()
      })
      stages.entities = () => Effect.succeed({
        changes: [],
        expectedDimensions: [],
        events: [levelUp('uncommitted', 1)],
        restore: () => Effect.sync(() => { publishCalls += 100 }),
      })
      const core = yield* makeCoreTick({
        coordinator: coordinatorAt(makeRevision(0), (request) => Effect.sync(() => {
          commitCalls += 1
          return commitDeltaFor(request)
        })),
        stages,
        publish: () => Effect.sync(() => { publishCalls += 1 }),
      })

      yield* core.runTick(SimulationTick(1), [])
      yield* core.runTick(SimulationTick(2), [])

      expect(commitCalls).toBe(0)
      expect(publishCalls).toBe(0)
      expect(seenTicks).toStrictEqual([1, 2])
    }),
  )

  it.effect('keeps the committed tick uninterruptible while event publication is backpressured', () =>
    Effect.gen(function* () {
      const publishStarted = yield* Deferred.make<void>()
      const releasePublish = yield* Deferred.make<void>()
      const interruptStarted = yield* Deferred.make<void>()
      let commitCalls = 0
      let publishCalls = 0
      const seenTicks: Array<number> = []
      const stages = noOpStages()
      stages.intentsAndRules = (input) => Effect.sync(() => {
        seenTicks.push(Number(input.tick))
        return emptyCandidate()
      })
      stages.entities = (input) => Effect.succeed(input.tick === SimulationTick(1) ? {
        changes: [{ ownerId: makeOwnerId('backpressure-owner'), state: { value: 1 } }],
        expectedDimensions: [],
        events: [levelUp('backpressure', 1)],
      } : emptyCandidate())
      const core = yield* makeCoreTick({
        coordinator: coordinatorAt(makeRevision(0), (request) => Effect.sync(() => {
          commitCalls += 1
          return commitDeltaFor(request)
        })),
        stages,
        publish: () => Effect.gen(function* () {
          publishCalls += 1
          yield* Deferred.succeed(publishStarted, undefined)
          yield* Deferred.await(releasePublish)
        }),
      })
      const tickFiber = yield* Effect.forkChild(core.runTick(SimulationTick(1), []))
      yield* Deferred.await(publishStarted)
      const interruptFiber = yield* Effect.forkChild(Effect.andThen(
        Deferred.succeed(interruptStarted, undefined),
        Fiber.interrupt(tickFiber),
      ))
      yield* Deferred.await(interruptStarted)
      yield* Deferred.succeed(releasePublish, undefined)
      yield* Fiber.await(interruptFiber)
      yield* Fiber.await(tickFiber)
      yield* core.runTick(SimulationTick(2), [])

      expect(commitCalls).toBe(1)
      expect(publishCalls).toBe(1)
      expect(seenTicks).toStrictEqual([1, 2])
    }),
  )

  it.effect('serializes overlapping calls and rejects the later stale tick without accepting its ready batch', () =>
    Effect.gen(function* () {
      const firstStageStarted = yield* Deferred.make<void>()
      const releaseFirstStage = yield* Deferred.make<void>()
      const secondCallStarted = yield* Deferred.make<void>()
      const seenReady: Array<ReadonlyArray<QueuedIntent>> = []
      const seenTicks: Array<number> = []
      let stageCalls = 0
      const stages = noOpStages()
      stages.intentsAndRules = (input) => Effect.gen(function* () {
        stageCalls += 1
        seenReady.push(input.ready)
        seenTicks.push(Number(input.tick))
        if (stageCalls === 1) {
          yield* Deferred.succeed(firstStageStarted, undefined)
          yield* Deferred.await(releaseFirstStage)
        }
        return emptyCandidate()
      })
      const core = yield* makeCoreTick({
        coordinator: coordinatorAt(makeRevision(0)),
        stages,
        publish: () => Effect.void,
      })
      const firstReady = readyIntent('first-concurrent', 0)
      const secondReady = readyIntent('second-concurrent', 1)
      const firstFiber = yield* Effect.forkChild(core.runTick(SimulationTick(1), [firstReady]))
      yield* Deferred.await(firstStageStarted)
      const secondFiber = yield* Effect.forkChild(Effect.gen(function* () {
        yield* Deferred.succeed(secondCallStarted, undefined)
        return yield* Effect.result(core.runTick(SimulationTick(1), [secondReady]))
      }))
      yield* Deferred.await(secondCallStarted)
      yield* Effect.yieldNow
      yield* Deferred.succeed(releaseFirstStage, undefined)

      yield* Fiber.join(firstFiber)
      const secondResult = yield* Fiber.join(secondFiber)
      yield* core.runTick(SimulationTick(2), [])

      expect(Result.isFailure(secondResult)).toBe(true)
      expect(seenReady).toStrictEqual([[firstReady], []])
      expect(seenTicks).toStrictEqual([1, 2])
      expect(stageCalls).toBe(2)
    }),
  )
})
