/**
 * Named regression tests for mc-sim's contribution to the frame.
 *
 * Two things are being pinned, and neither is visible to `tsc` or to
 * `pnpm check:deps`, because both are expressed with STRINGS rather than with
 * imports:
 *
 *   - plan.md §2.3-1 / §2.3-3 — WHAT is declared: one id, and no `after` edge at
 *     all. `stages/stage-ids.ts` argues why the empty edge set is a decision.
 *   - the stage does its per-frame work THROUGH `TimeService` and
 *     `PlayerService` rather than keeping a copy of what they own. That is the
 *     failure mx-gameplay described when it deleted its own time-of-day state
 *     (`mx-gameplay/stages/registration.ts:276-284`), and a stage is the easiest
 *     place in the repository to reintroduce it: nothing stops a registration
 *     allocating a `Ref` and calling it the clock.
 */
import { describe, expect, it } from '@effect/vitest'
import {
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  vec3,
} from '@nerima-games/mc-physics'
import { Effect, Layer, Option, Ref } from 'effect'
import {
  InventoryService,
  InventoryServiceLayer,
} from '../application/inventory-service'
import { PlayerService, PlayerServiceLayer } from '../application/player-service'
import { TimeService, TimeServiceLayer } from '../application/time-service'
import {
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  MonotonicTimeSecs,
  position,
  StageId,
  type GameModule,
  type StageRegistration,
} from '../domain/kernel-vocabulary'
import * as Time from '../domain/time-of-day'
import {
  makeControllableSimStagesWithPhysics,
  makeSimFrameState,
  makeSimStages,
  makeSimStagesForPreview,
  makeSimStagesForPreviewWithPhysics,
  makeSimStagesWithPhysics,
  simModule,
  simStages,
  type MovementIntent,
  type SimPhysicsConfig,
} from '../stages/registration'
import * as PublicApi from '../index'
import type {
  MovementIntent as PublicMovementIntent,
  SimPhysicsConfig as PublicSimPhysicsConfig,
} from '../index'
import {
  EXPERIENCE_MODULE_STAGE_PREFIXES,
  OWN_STAGE_PREFIX,
  SIM_STAGE_IDS,
  UPSTREAM_STAGE_IDS,
} from '../stages/stage-ids'

const SimulationLayer = Layer.mergeAll(
  InventoryServiceLayer(),
  PlayerServiceLayer(),
  TimeServiceLayer(),
)

/**
 * `FrameServices` is `ClockPort` (kernel's real alias — see
 * `domain/kernel-vocabulary.ts` on why this repository may not mirror it as
 * `never`), so running a stage means discharging a clock even when the stage
 * does not read one. Frozen rather than moving: nothing below measures a
 * duration, and a clock that advanced by itself would make it impossible to
 * tell "the stage read the clock" from "the stage did not".
 */
const FrozenClockLayer = FixedClockLayer({
  monotonicSecs: MonotonicTimeSecs(1_000),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
})

const makePhysicsConfig = (
  isBlockSolid: SimPhysicsConfig['resolve']['isBlockSolid'],
): SimPhysicsConfig => ({
  resolve: {
    halfWidth: PLAYER_HALF_WIDTH,
    halfHeight: PLAYER_HALF_HEIGHT,
    isBlockSolid,
  },
  walkSpeed: 4,
  jumpSpeed: 7,
})

const AirPhysicsConfig = makePhysicsConfig(() => false)
const FloorPhysicsConfig = makePhysicsConfig((_bx, by) => by === -1)

const allAfterEdges = (stages: ReadonlyArray<StageRegistration>): ReadonlyArray<string> =>
  stages.flatMap((stage) => [...(stage.after ?? [])])

describe('§2.3-1 zero edges between experience modules', () => {
  it.effect('REGRESSION: no `after` edge names an experience module — mc-sim is their parent', () =>
    Effect.gen(function* () {
      const stages = yield* makeSimStages
      // mc-sim is a foundation module, so unlike the mx-* repositories NONE of
      // the four prefixes is its own: every one of them is a child, and an edge
      // to a child would invert the dependency while passing `pnpm check:deps`,
      // which cannot see a string.
      const foreign = allAfterEdges(stages).filter((edge) =>
        EXPERIENCE_MODULE_STAGE_PREFIXES.some((prefix) => edge.startsWith(prefix)),
      )

      expect(foreign).toStrictEqual([])
      expect(EXPERIENCE_MODULE_STAGE_PREFIXES).not.toContain(OWN_STAGE_PREFIX)
    }).pipe(Effect.provide(SimulationLayer)),
  )

  it.effect('REGRESSION: every declared upstream stage belongs to a foundation repository', () =>
    Effect.sync(() => {
      for (const id of Object.values(UPSTREAM_STAGE_IDS)) {
        const isExperienceModule = EXPERIENCE_MODULE_STAGE_PREFIXES.some((prefix) =>
          String(id).startsWith(prefix),
        )
        expect(isExperienceModule).toBe(false)
      }
    }),
  )
})

describe('§2.3-3 the total order belongs to mc-compose', () => {
  it.effect('registers exactly `sim:physics`, the id four repositories already name', () =>
    Effect.gen(function* () {
      const stages = yield* makeSimStages

      expect(stages.map((stage) => stage.id)).toStrictEqual([StageId('sim:physics')])
      expect(SIM_STAGE_IDS.physics).toBe('sim:physics')
    }).pipe(Effect.provide(SimulationLayer)),
  )

  it.effect('REGRESSION: declares NO ordering edge, and the absence is asserted rather than assumed', () =>
    Effect.gen(function* () {
      const stages = yield* makeSimStages

      // `exactOptionalPropertyTypes` is on, so an absent `after` and an
      // `after: undefined` are different values — and mc-compose's roster
      // manifest transcribes the distinction. Assert the property is ABSENT.
      for (const stage of stages) {
        expect(Object.keys(stage).sort()).toStrictEqual(['id', 'run'])
        expect('after' in stage).toBe(false)
      }
      expect(Object.keys(UPSTREAM_STAGE_IDS)).toStrictEqual([])
    }).pipe(Effect.provide(SimulationLayer)),
  )

  it.effect('REGRESSION: a registration carries constraints and nothing else — no priority, no index', () =>
    Effect.gen(function* () {
      const stages = yield* makeSimStages
      for (const stage of stages) {
        // Anything beyond these three would be this repository stating an
        // absolute position, which §2.3-3 reserves to mc-compose.
        for (const key of Object.keys(stage)) {
          expect(['id', 'after', 'run']).toContain(key)
        }
      }
    }).pipe(Effect.provide(SimulationLayer)),
  )

  it.effect('StageId rejects a blank id', () =>
    Effect.sync(() => {
      expect(() => StageId('  ')).toThrow()
      expect(StageId('sim:physics')).toBe('sim:physics')
    }),
  )
})

describe('the stage works through the services, and keeps no copy of what they own', () => {
  it.effect('REGRESSION: `sim:physics` advances the world clock through TimeService', () =>
    Effect.gen(function* () {
      const time = yield* TimeService
      const stages = yield* makeSimStages
      const physics = stages.find((stage) => stage.id === SIM_STAGE_IDS.physics)

      const before = yield* time.snapshot
      yield* physics?.run(DeltaTimeSecs(0.5)) ?? Effect.void
      const after = yield* time.snapshot

      // The strong form of "through the service": the value the SERVICE reports
      // is exactly what `domain/time-of-day.ts` computes for that delta. A stage
      // holding its own accumulator could make `after.ticks` move and this
      // equality would still hold — but only if it wrote the result back, which
      // is the property that matters.
      expect(after).toStrictEqual(Time.advance(before, DeltaTimeSecs(0.5)))
      expect(after.ticks).toBeGreaterThan(before.ticks)
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('REGRESSION: two registrations over ONE TimeService advance ONE clock', () =>
    Effect.gen(function* () {
      // This is the assertion that a private accumulator cannot pass. Two
      // independent `makeSimStages` share nothing of their own, so if the tick
      // count after running both is the sum of both deltas, the state they moved
      // is the service's and not theirs.
      const time = yield* TimeService
      const first = yield* makeSimStages
      const second = yield* makeSimStages

      const before = yield* time.snapshot
      yield* first[0]?.run(DeltaTimeSecs(0.25)) ?? Effect.void
      yield* second[0]?.run(DeltaTimeSecs(0.25)) ?? Effect.void
      const after = yield* time.snapshot

      expect(after).toStrictEqual(
        Time.advance(Time.advance(before, DeltaTimeSecs(0.25)), DeltaTimeSecs(0.25)),
      )
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('REGRESSION: frame state has only mailbox, intent and physical continuity refs', () =>
    Effect.gen(function* () {
      const { state } = yield* makeSimStagesForPreview

      expect(Object.keys(state)).toStrictEqual([
        'resolvedFeetPosition',
        'movementIntent',
        'jumpIntent',
        'velocity',
        'isGrounded',
        'physicsConfig',
      ])
      expect(yield* Ref.get(state.resolvedFeetPosition)).toStrictEqual(Option.none())
      expect(yield* Ref.get(state.movementIntent)).toStrictEqual({ forward: 0, strafe: 0 })
      expect(yield* Ref.get(state.jumpIntent)).toBe(false)
      expect(yield* Ref.get(state.velocity)).toStrictEqual(vec3(0, 0, 0))
      expect(yield* Ref.get(state.isGrounded)).toBe(false)
      expect(yield* Ref.get(state.physicsConfig)).toStrictEqual(Option.none())
    }).pipe(Effect.provide(SimulationLayer)),
  )

  it.effect('writes the resolved position through PlayerService, never around it', () =>
    Effect.gen(function* () {
      const player = yield* PlayerService
      const { state, stages } = yield* makeSimStagesForPreview

      yield* Ref.set(state.resolvedFeetPosition, Option.some(position(3, 64, -7)))
      yield* stages[0]?.run(DeltaTimeSecs(0.016)) ?? Effect.void

      expect((yield* player.pose).feetPosition).toStrictEqual(position(3, 64, -7))
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('REGRESSION: a resolved position is DRAINED, so a stalled integrator cannot overwrite a teleport', () =>
    Effect.gen(function* () {
      const player = yield* PlayerService
      const { state, stages } = yield* makeSimStagesForPreview
      const physics = stages[0]

      yield* Ref.set(state.resolvedFeetPosition, Option.some(position(3, 64, -7)))
      yield* physics?.run(DeltaTimeSecs(0.016)) ?? Effect.void

      // Something else legitimately moves the player: a world load's `restore`,
      // a debug teleport, a spawn reset.
      yield* player.moveTo(position(100, 70, 100))

      // A frame on which the integrator produced nothing must write nothing. If
      // the stage merely READ the Ref, this frame would drag the player back to
      // (3, 64, -7) and the teleport would look like a rubber-band bug.
      yield* physics?.run(DeltaTimeSecs(0.016)) ?? Effect.void

      expect((yield* player.pose).feetPosition).toStrictEqual(position(100, 70, 100))
      expect(yield* Ref.get(state.resolvedFeetPosition)).toStrictEqual(Option.none())
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('a dt of zero advances nothing and fails nothing', () =>
    Effect.gen(function* () {
      const time = yield* TimeService
      const stages = yield* makeSimStages

      const before = yield* time.snapshot
      yield* stages[0]?.run(DeltaTimeSecs(0)) ?? Effect.void

      expect(yield* time.snapshot).toStrictEqual(before)
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('each call to makeSimFrameState yields independent state (re-entrant initialisation)', () =>
    Effect.gen(function* () {
      // plan.md §3.8: app-scope singletons were among the reference's worst bug
      // sources, and `application/game-loop.ts` is re-entrant from its first
      // commit for that reason. A stage that shared frame state between two
      // worlds would undo it one directory over.
      const first = yield* makeSimFrameState
      const second = yield* makeSimFrameState

      yield* Ref.set(first.resolvedFeetPosition, Option.some(position(1, 2, 3)))
      yield* Ref.set(first.movementIntent, { forward: 1, strafe: -1 })
      yield* Ref.set(first.jumpIntent, true)
      yield* Ref.set(first.velocity, vec3(4, 5, 6))
      yield* Ref.set(first.isGrounded, true)
      yield* Ref.set(first.physicsConfig, Option.some(AirPhysicsConfig))

      expect(yield* Ref.get(second.resolvedFeetPosition)).toStrictEqual(Option.none())
      expect(yield* Ref.get(second.movementIntent)).toStrictEqual({ forward: 0, strafe: 0 })
      expect(yield* Ref.get(second.jumpIntent)).toBe(false)
      expect(yield* Ref.get(second.velocity)).toStrictEqual(vec3(0, 0, 0))
      expect(yield* Ref.get(second.isGrounded)).toBe(false)
      expect(yield* Ref.get(second.physicsConfig)).toStrictEqual(Option.none())
    }),
  )
})

describe('the physical simulation path is opt-in and player pose remains authoritative', () => {
  it.effect('legacy mode with physicsConfig none leaves the player pose unchanged', () =>
    Effect.gen(function* () {
      const player = yield* PlayerService
      const { stages } = yield* makeSimStagesForPreview
      const before = yield* player.pose

      yield* stages[0]?.run(DeltaTimeSecs(0.05)) ?? Effect.void

      expect(yield* player.pose).toStrictEqual(before)
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('mailbox position wins and skips every physics state update for that frame', () =>
    Effect.gen(function* () {
      const player = yield* PlayerService
      const { state, stages } = yield* makeControllableSimStagesWithPhysics(AirPhysicsConfig)
      const target = position(3, 64, -7)

      yield* Ref.set(state.resolvedFeetPosition, Option.some(target))
      yield* Ref.set(state.movementIntent, { forward: 1, strafe: 1 })
      yield* Ref.set(state.jumpIntent, true)
      yield* Ref.set(state.velocity, vec3(1, 2, 3))
      yield* Ref.set(state.isGrounded, true)
      yield* stages[0]?.run(DeltaTimeSecs(0.25)) ?? Effect.void

      expect((yield* player.pose).feetPosition).toStrictEqual(target)
      expect(yield* Ref.get(state.resolvedFeetPosition)).toStrictEqual(Option.none())
      expect(yield* Ref.get(state.velocity)).toStrictEqual(vec3(1, 2, 3))
      expect(yield* Ref.get(state.isGrounded)).toBe(true)
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('converts forward and strafe intent through current player yaw', () =>
    Effect.gen(function* () {
      const player = yield* PlayerService
      const { state, stages } = yield* makeControllableSimStagesWithPhysics(AirPhysicsConfig)
      yield* player.look(Math.PI / 2, 0)
      yield* Ref.set(state.movementIntent, { forward: 0.5, strafe: -0.25 })

      yield* stages[0]?.run(DeltaTimeSecs(0.25)) ?? Effect.void

      const velocity = yield* Ref.get(state.velocity)
      const pose = yield* player.pose
      expect(velocity.x).toBeCloseTo(-2)
      expect(velocity.z).toBeCloseTo(1)
      expect(pose.feetPosition.x).toBeCloseTo(-0.5)
      expect(pose.feetPosition.z).toBeCloseTo(0.25)
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('clamps diagonal movement to walkSpeed without reducing single-axis speed', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* makeControllableSimStagesWithPhysics(AirPhysicsConfig)
      const physics = stages[0]

      yield* Ref.set(state.movementIntent, { forward: 1, strafe: 0 })
      yield* physics?.run(DeltaTimeSecs(0.1)) ?? Effect.void
      const singleAxis = yield* Ref.get(state.velocity)

      yield* Ref.set(state.movementIntent, { forward: 1, strafe: 1 })
      yield* physics?.run(DeltaTimeSecs(0.1)) ?? Effect.void
      const diagonal = yield* Ref.get(state.velocity)

      expect(Math.hypot(singleAxis.x, singleAxis.z)).toBeCloseTo(AirPhysicsConfig.walkSpeed)
      expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(AirPhysicsConfig.walkSpeed)
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('does not apply jumpSpeed while airborne', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* makeControllableSimStagesWithPhysics(AirPhysicsConfig)
      yield* Ref.set(state.jumpIntent, true)
      yield* Ref.set(state.velocity, vec3(0, -1, 0))

      yield* stages[0]?.run(DeltaTimeSecs(0.1)) ?? Effect.void

      expect((yield* Ref.get(state.velocity)).y).toBeLessThan(-1)
      expect(yield* Ref.get(state.isGrounded)).toBe(false)
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('applies jumpSpeed only after the body is grounded', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* makeControllableSimStagesWithPhysics(FloorPhysicsConfig)
      const physics = stages[0]

      yield* physics?.run(DeltaTimeSecs(0.016)) ?? Effect.void
      expect(yield* Ref.get(state.isGrounded)).toBe(true)

      yield* Ref.set(state.jumpIntent, true)
      yield* physics?.run(DeltaTimeSecs(0.1)) ?? Effect.void

      const velocity = yield* Ref.get(state.velocity)
      expect(velocity.y).toBeGreaterThan(0)
      expect(velocity.y).toBeLessThan(FloorPhysicsConfig.jumpSpeed)
      expect(yield* Ref.get(state.isGrounded)).toBe(false)
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('responds to the first jump intent when the initial pose is supported', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* makeControllableSimStagesWithPhysics(FloorPhysicsConfig)
      yield* Ref.set(state.jumpIntent, true)

      yield* stages[0]?.run(DeltaTimeSecs(0.1)) ?? Effect.void

      const velocity = yield* Ref.get(state.velocity)
      expect(velocity.y).toBeGreaterThan(0)
      expect(velocity.y).toBeLessThan(FloorPhysicsConfig.jumpSpeed)
      expect(yield* Ref.get(state.isGrounded)).toBe(false)
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('lands on a floor and converts centre Y back to exact feet Y', () =>
    Effect.gen(function* () {
      const player = yield* PlayerService
      const { state, stages } = yield* makeControllableSimStagesWithPhysics(FloorPhysicsConfig)
      yield* player.moveTo(position(0, 0.2, 0))
      yield* Ref.set(state.velocity, vec3(0, -5, 0))

      yield* stages[0]?.run(DeltaTimeSecs(0.05)) ?? Effect.void

      expect((yield* player.pose).feetPosition.y).toBeCloseTo(0)
      expect((yield* Ref.get(state.velocity)).y).toBe(0)
      expect(yield* Ref.get(state.isGrounded)).toBe(true)
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('carries vertical velocity from one frame into the next', () =>
    Effect.gen(function* () {
      const { state, stages } = yield* makeControllableSimStagesWithPhysics(AirPhysicsConfig)
      const physics = stages[0]
      yield* Ref.set(state.velocity, vec3(0, 3, 0))

      yield* physics?.run(DeltaTimeSecs(0.1)) ?? Effect.void
      const first = yield* Ref.get(state.velocity)
      yield* physics?.run(DeltaTimeSecs(0.1)) ?? Effect.void
      const second = yield* Ref.get(state.velocity)

      expect(first.y).toBeGreaterThan(0)
      expect(second.y).toBeGreaterThan(0)
      expect(second.y).toBeLessThan(first.y)
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )

  it.effect('uses an external teleport as the next frame baseline instead of a cached body position', () =>
    Effect.gen(function* () {
      const player = yield* PlayerService
      const { state, stages } = yield* makeControllableSimStagesWithPhysics(AirPhysicsConfig)
      yield* Ref.set(state.movementIntent, { forward: 1, strafe: 0 })
      yield* player.moveTo(position(100, 50, 100))

      yield* stages[0]?.run(DeltaTimeSecs(0.05)) ?? Effect.void

      const feet = (yield* player.pose).feetPosition
      expect(feet.x).toBeCloseTo(100)
      expect(feet.z).toBeCloseTo(99.8)
    }).pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer)),
  )
})

describe('mc-sim is a real GameModule', () => {
  it.effect('its frameStages IS the registration Effect this file already exported, and is re-entrant', () =>
    Effect.gen(function* () {
      expect(simModule.frameStages).toBe(makeSimStages)

      const first = yield* simModule.frameStages
      const second = yield* simModule.frameStages
      expect(first).not.toBe(second)
    }).pipe(Effect.provide(SimulationLayer)),
  )

  it.effect('its layers build the three services mc-sim provides, in one place', () =>
    Effect.gen(function* () {
      // The point of a `GameModule` is that a host provides `layers` ONCE and
      // takes `frameStages` from inside that same provide. `InventoryService` is
      // in `ROut` even though no stage touches it, because mc-compose's
      // docs/e2e-triage.md §4.3 measured what goes wrong when the writer
      // (mx-gameplay) and the reader (mx-ui) end up with two instances.
      const module: GameModule<
        InventoryService | PlayerService | TimeService,
        never,
        never,
        PlayerService | TimeService
      > = simModule

      const seen = yield* Effect.all({
        inventory: InventoryService,
        player: PlayerService,
        time: TimeService,
        stages: module.frameStages,
      }).pipe(Effect.provide(module.layers))

      expect(seen.inventory).toBeDefined()
      expect(seen.player).toBeDefined()
      expect(seen.time).toBeDefined()
      expect(seen.stages.map((stage) => stage.id)).toStrictEqual([SIM_STAGE_IDS.physics])
    }),
  )

  it.effect('REGRESSION: registration needs PlayerService and TimeService, and says so in RRegister', () =>
    Effect.gen(function* () {
      // Both are services mc-sim PROVIDES. If this ever compiles with `never`
      // the stage has stopped acquiring them — i.e. it has started keeping its
      // own state — and the test above would be the next one to fail.
      const needsBoth: Effect.Effect<
        ReadonlyArray<StageRegistration>,
        never,
        PlayerService | TimeService
      > = simModule.frameStages
      const physicsNeedsBoth: Effect.Effect<
        ReadonlyArray<StageRegistration>,
        never,
        PlayerService | TimeService
      > = makeSimStagesWithPhysics(AirPhysicsConfig)
      const controllableNeedsBoth: Effect.Effect<
        { readonly state: unknown; readonly stages: ReadonlyArray<StageRegistration> },
        never,
        PlayerService | TimeService
      > = makeSimStagesForPreviewWithPhysics(AirPhysicsConfig)

      const stages = yield* needsBoth.pipe(Effect.provide(SimulationLayer))
      expect(stages).toHaveLength(1)
      expect(yield* physicsNeedsBoth.pipe(Effect.provide(SimulationLayer))).toHaveLength(1)
      expect((yield* controllableNeedsBoth.pipe(Effect.provide(SimulationLayer))).stages).toHaveLength(1)
    }),
  )

  it('exports physical factories and their config types from the package root', () => {
    const intent: PublicMovementIntent = { forward: 1, strafe: 0 }
    const config: PublicSimPhysicsConfig = AirPhysicsConfig
    const registrationIntent: MovementIntent = intent

    expect(PublicApi.makeSimStagesWithPhysics).toBe(makeSimStagesWithPhysics)
    expect(PublicApi.makeSimStagesForPreviewWithPhysics).toBe(
      makeSimStagesForPreviewWithPhysics,
    )
    expect(PublicApi.makeControllableSimStagesWithPhysics).toBe(
      makeControllableSimStagesWithPhysics,
    )
    expect(config).toBe(AirPhysicsConfig)
    expect(registrationIntent).toStrictEqual(intent)
  })

  it.effect('simStages is callable directly with service handles, for a preview that owns them', () =>
    Effect.gen(function* () {
      const time = yield* TimeService
      const player = yield* PlayerService
      const state = yield* makeSimFrameState

      expect(simStages(state, time, player).map((stage) => stage.id)).toStrictEqual([
        SIM_STAGE_IDS.physics,
      ])
    }).pipe(Effect.provide(SimulationLayer)),
  )
})
