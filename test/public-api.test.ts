import { expect, it } from '@effect/vitest'
import { DeltaTimeSecs, PositionAxis, SimulationTick, position } from '@nerima-games/mc-kernel'
import { Effect, Result } from 'effect'
import {
  EntityId,
  DomainEventBus,
  DomainEventBusLayer,
  EventSubscriberCapacitySchema,
  IntentPayloadSchema,
  IntentQueue,
  IntentQueueLayer,
  IntentSchema,
  PlayerServiceSnapshotSchema,
  ReplicatedOwnerIdSchema,
  WorldCommitCoordinator,
  WorldCommitCoordinatorLayer,
  advanceFixedStep,
  migrateSimulationSaveV3,
  planExplosion,
  initialFixedStepAccumulator,
  pauseFixedStep,
  resumeFixedStep,
} from '../src/index.js'
import {
  fixedStepMainParityExpected,
  fixedStepMainParityInput,
  fixedStepParityCases,
} from './fixtures/effect4-parity/fixed-step.js'
import { explosionMainParityCases } from './fixtures/effect4-parity/explosion.js'
import { HeadlessHarness, HeadlessHarnessSessionFactory, HeadlessHarnessTestLayer } from '../src/testing/index.js'

it('publishes the C1-C4 service and schema entry points', () => {
  expect(typeof migrateSimulationSaveV3).toBe('function')
  expect(IntentSchema).toBeDefined()
  expect(IntentPayloadSchema).toBeDefined()
  expect(IntentQueue).toBeDefined()
  expect(IntentQueueLayer).toBeDefined()
  expect(DomainEventBus).toBeDefined()
  expect(DomainEventBusLayer).toBeDefined()
  expect(EventSubscriberCapacitySchema).toBeDefined()
  expect(ReplicatedOwnerIdSchema).toBeDefined()
  expect(PlayerServiceSnapshotSchema).toBeDefined()
  expect(WorldCommitCoordinator).toBeDefined()
  expect(WorldCommitCoordinatorLayer).toBeDefined()
  expect(HeadlessHarness).toBeDefined()
  expect(HeadlessHarnessTestLayer).toBeDefined()
  expect(HeadlessHarnessSessionFactory).toBeDefined()
})

const normalizeFixedStepResult = (result: ReturnType<typeof advanceFixedStep>) =>
  Result.isFailure(result)
    ? { _tag: 'Failure', error: result.failure }
    : { _tag: 'Success', value: result.success }

it.effect('preserves fixed-step outputs for Effect 4 parity inputs', () =>
  Effect.sync(() => {
    for (const row of fixedStepParityCases) {
      const result = advanceFixedStep(initialFixedStepAccumulator(), DeltaTimeSecs(row.delta))
      if (Result.isFailure(result)) throw new Error('fixed-step parity input failed')

      expect(result.success.ticks).toBe(row.ticks)
      expect(result.success.state.tick).toBe(row.tick)
      expect(result.success.state.accumulator).toBeCloseTo(row.remainder)
      expect(result.success.interpolationFraction).toBeCloseTo(row.fraction)
      expect(result.success.overloaded).toBe(row.overloaded)
    }
  }),
)

it.effect('matches fixed-step outputs recorded from the pre-migration main revision', () =>
  Effect.sync(() => {
    let state = initialFixedStepAccumulator(SimulationTick(fixedStepMainParityInput.initialTick))
    const sequence = fixedStepMainParityInput.deltas.map((delta) => {
      const result = advanceFixedStep(state, DeltaTimeSecs(delta))
      if (Result.isFailure(result)) return normalizeFixedStepResult(result)

      state = result.success.state
      return normalizeFixedStepResult(result)
    })
    const paused = pauseFixedStep(state)
    const pausedAdvance = normalizeFixedStepResult(
      advanceFixedStep(paused, DeltaTimeSecs(fixedStepMainParityInput.pausedDelta)),
    )
    const resumeAdvance = normalizeFixedStepResult(
      advanceFixedStep(resumeFixedStep(paused), DeltaTimeSecs(fixedStepMainParityInput.resumedDelta)),
    )
    const overflow = normalizeFixedStepResult(
      advanceFixedStep(
        initialFixedStepAccumulator(SimulationTick(fixedStepMainParityInput.overflowTick)),
        DeltaTimeSecs(fixedStepMainParityInput.overflowDelta),
      ),
    )

    expect({ sequence, pausedAdvance, resumeAdvance, overflow }).toEqual(fixedStepMainParityExpected)
  }),
)

it.effect('matches explosion outputs recorded from the pre-migration main revision', () =>
  Effect.sync(() => {
    for (const row of explosionMainParityCases) {
      const result = planExplosion({
        center: position(
          PositionAxis(row.input.center.x),
          PositionAxis(row.input.center.y),
          PositionAxis(row.input.center.z),
        ),
        radius: row.input.radius,
        seed: row.input.seed,
        blocks: ({ x, y, z }) => {
          if (row.input.blockWorld === 'all-destructible') {
            return { resistance: 0, destructible: true }
          }
          if (
            row.input.blockWorld === 'single-target' &&
            row.input.targetBlock !== undefined &&
            row.input.targetBlock.x === x &&
            row.input.targetBlock.y === y &&
            row.input.targetBlock.z === z
          ) {
            return { resistance: 0, destructible: true }
          }
          return { resistance: 0, destructible: false }
        },
        entities: row.input.entities.map((entity) => ({
          id: EntityId(entity.id),
          feetPosition: position(
            PositionAxis(entity.feetPosition.x),
            PositionAxis(entity.feetPosition.y),
            PositionAxis(entity.feetPosition.z),
          ),
        })),
        ...(row.input.limits === undefined ? {} : { limits: row.input.limits }),
      })

      expect(result).toEqual(row.expected)
    }
  }),
)
