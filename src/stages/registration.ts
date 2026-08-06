/**
 * mc-sim's contribution to the frame (plan.md §4.1).
 *
 * ---------------------------------------------------------------------------
 * Why this file exists at all
 * ---------------------------------------------------------------------------
 *
 * `sim:physics` is named in an `after` edge by mx-gameplay, mx-redstone, mx-ui
 * AND mc-render — every cross-repository ordering edge in the roster points at
 * it — and until this file existed nothing registered it. mc-compose's
 * `resolveStageOrder` drops an edge that names an absent stage, so all four were
 * being deleted on the way in and the frame's inter-repository order was coming
 * entirely from mc-compose's skeleton. The skeleton is supposed to be a
 * convenience layered OVER declared constraints (plan.md §2.3-3); it was the
 * only thing there. See `stage-ids.ts` for the four citations.
 *
 * ---------------------------------------------------------------------------
 * One stage, and what it advances
 * ---------------------------------------------------------------------------
 *
 * `stage-ids.ts` argues which of this repository's recurring work is a stage:
 * the game loop is the caller of stages, autosave is a duration-driven daemon,
 * and advancing the world by one frame is the stage. Concretely `sim:physics`
 * does two things, and BOTH are writes through a service that already owns the
 * state rather than into anything this file holds:
 *
 * 1. THE WORLD CLOCK. `TimeService.advance(dt)`. This is not a liberty taken by
 *    a stage named "physics" — mx-gameplay looked for somewhere to put it and
 *    concluded it was mc-sim's, in writing:
 *
 *      mx-gameplay/stages/registration.ts:276-284
 *        // FIRST CUT, and deliberately empty rather than "advance the clock".
 *        // ADVANCING the clock is mc-sim's: `TimeService.advance(dt)` over
 *        // `mc-sim/domain/time-of-day.ts`, which owns the absolute tick
 *        // counter, the day-length denominator, the `setDayLength ->
 *        // setTimeOfDay` ordering rule and the value that reaches the save
 *        // file. This stage held a second copy of that state until it was
 *        // deleted.
 *
 *    So the clock has to be advanced by mc-sim, exactly once per frame, and the
 *    only question left is WHICH mc-sim stage. There is one, and putting the
 *    advance in it is also the placement that is correct by construction — see
 *    the next section, which is the real argument and is not a short one.
 *
 * 2. THE PLAYER'S RESOLVED POSE. Written through `PlayerService.moveTo`.
 *    A one-frame resolved-position mailbox remains the highest-priority
 *    compatibility path. When physics is configured, this stage instead samples
 *    the current player pose, steps a body through mc-physics and writes the
 *    resolved feet position back through the owning service. The body position
 *    is intentionally reconstructed every frame rather than copied into this
 *    module's state, so external teleports and restores become the next step's
 *    baseline.
 *
 * ---------------------------------------------------------------------------
 * Why the clock advance is IN `sim:physics` rather than in a second stage
 * ---------------------------------------------------------------------------
 *
 * The obvious alternative is a second registration, and both spellings of it are
 * measurably worse. mc-compose's `domain/stage-order.ts` matches a stage to a
 * phase on the NAME half of its id — the part after the last colon — and its
 * skeleton (`domain/stage-skeleton.ts`) is the only thing that places a stage
 * this repository cannot order with an `after` edge:
 *
 * - `sim:time-weather` lands in the `simulation:time-weather` phase, which
 *   ALREADY CONTAINS `gameplay:time-weather`. mc-compose adds no edge between
 *   two stages of one phase, deliberately — "compose orders phases; a module
 *   orders itself within one" — so the tie-break decides, and the tie-break is
 *   lexicographic: `gameplay:time-weather` < `sim:time-weather`. mx-gameplay's
 *   stage, whose stated job is to apply the CONSEQUENCES of the hour, would read
 *   an hour that this frame had not yet advanced. Every frame. And mc-sim could
 *   not repair it: `StageRegistration` has `after` and no `before`, so the fix
 *   would have to be an `after: [sim:time-weather]` edge in mx-gameplay.
 *
 * - `sim:time`, `sim:clock` or any other name matches NO phase, and
 *   `priorityOf` answers `MAX_SAFE_INTEGER` for a stage in no phase, which sorts
 *   it after every stage that is in one. The world clock would advance after the
 *   HUD had already been drawn from it. That is the same defect this repository
 *   is registering a stage to fix, self-inflicted.
 *
 * Inside `sim:physics` there is no such question. The skeleton puts
 * `simulation:physics` FIRST in simulation, so every stage in the frame that
 * reads the hour — interactions, entities, fluids, redstone, time/weather, the
 * HUD — reads the hour of the frame it is running in. The placement is a
 * consequence of the one id this repository was already obliged to register, not
 * an opinion about the global order.
 *
 * The physics state below contains only integration inputs and results. The
 * authoritative pose and clock remain in `PlayerService` and `TimeService`.
 */
import { Effect, Layer, Option, Ref } from 'effect'
import {
  CentreY,
  FootY,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  centreOfFoot,
  footOfCentre,
  integrateBody,
  resolveBody,
  vec3,
  type Body,
  type ResolveOptions,
  type Vec3,
} from '@nerima-games/mc-physics'
import { InventoryService, InventoryServiceLayer } from '../application/inventory-service'
import { CropService, CropServiceLayer, type CropServiceApi } from '../application/crop-service'
import { PlayerService, PlayerServiceLayer, type PlayerServiceApi } from '../application/player-service'
import { TimeService, TimeServiceLayer, type TimeServiceApi } from '../application/time-service'
import { position, type GameModule, type Position, type StageRegistration } from '@nerima-games/mc-kernel'
import { SIM_STAGE_IDS } from './stage-ids'

export type MovementIntent = {
  readonly forward: number
  readonly strafe: number
}

export type SimPhysicsConfig = {
  readonly resolve: ResolveOptions
  readonly walkSpeed: number
  readonly jumpSpeed: number
}

export type LandingImpact = {
  readonly fallDistance: number
  readonly impactVelocityY: number
}

/**
 * Frame-local inputs and integration results for mc-sim's stage.
 *
 * Note what is NOT here, because the absence is the design: no position, no
 * pose, no tick counter, no accumulated time, no frame count. `PlayerService`
 * owns the pose, `TimeService` owns the clock, and `GameLoop` already counts
 * frames — a copy of any of them here would be a second answer to a question
 * this repository exists to have exactly one answer to, which is the failure
 * mx-gameplay described when it deleted its own copy of the time of day.
 */
export type SimFrameState = {
  /**
   * A compatibility override for the resolved feet position for this frame.
   *
   * `Option`, and taken with `getAndSet(none)` rather than read with `get`,
   * because an override belongs to the frame that produced it. A plain
   * value would be re-applied on every later frame, so a stalled integrator
   * producer would not read as "no override" but would actively overwrite
   * anything else that had legitimately moved them — a teleport, or a world
   * load's `PlayerService.restore`. Draining it is what makes "the integrator
   * spoke on this frame" distinguishable from "it spoke once, ages ago".
   */
  readonly resolvedFeetPosition: Ref.Ref<Option.Option<Position>>
  readonly movementIntent: Ref.Ref<MovementIntent>
  readonly jumpIntent: Ref.Ref<boolean>
  readonly velocity: Ref.Ref<Vec3>
  readonly isGrounded: Ref.Ref<boolean>
  readonly accumulatedFallDistance: Ref.Ref<number>
  readonly landingImpact: Ref.Ref<Option.Option<LandingImpact>>
  readonly physicsConfig: Ref.Ref<Option.Option<SimPhysicsConfig>>
}

export type SimInputPort = {
  readonly setMovementIntent: (intent: MovementIntent) => Effect.Effect<void>
  readonly setJumpIntent: (pressed: boolean) => Effect.Effect<void>
}

const boundedIntent = (value: number): number =>
  Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0

export const makeSimInputPort = (state: SimFrameState): SimInputPort => ({
  setMovementIntent: (intent) =>
    Ref.set(state.movementIntent, {
      forward: boundedIntent(intent.forward),
      strafe: boundedIntent(intent.strafe),
    }),
  setJumpIntent: (pressed) => Ref.set(state.jumpIntent, pressed),
})

/**
 * An Effect rather than a constant, so a test, each preview and the game can
 * hold their own.
 *
 * plan.md §3.8 records app-scope singletons as among the reference's worst bug
 * sources: a second world load inherited the first world's fibers and refs and
 * deadlocked. `application/game-loop.ts` is re-entrant from its first commit for
 * the same reason and this file must not undo it.
 */
export const makeSimFrameState: Effect.Effect<SimFrameState> = Effect.all({
  resolvedFeetPosition: Ref.make(Option.none<Position>()),
  movementIntent: Ref.make<MovementIntent>({ forward: 0, strafe: 0 }),
  jumpIntent: Ref.make(false),
  velocity: Ref.make<Vec3>(vec3(0, 0, 0)),
  isGrounded: Ref.make(false),
  accumulatedFallDistance: Ref.make(0),
  landingImpact: Ref.make(Option.none<LandingImpact>()),
  physicsConfig: Ref.make(Option.none<SimPhysicsConfig>()),
})

/**
 * Clear fall tracking across an authored discontinuity such as teleport,
 * restore or respawn. This prevents distance from two unrelated poses being
 * combined into one landing event.
 */
export const resetLandingImpact = (state: SimFrameState): Effect.Effect<void> =>
  Effect.all(
    [
      Ref.set(state.accumulatedFallDistance, 0),
      Ref.set(state.landingImpact, Option.none<LandingImpact>()),
    ],
    { discard: true },
  )

/**
 * The one stage mc-sim registers.
 *
 * Note what is NOT here: any resolution of a total order, and — uniquely in the
 * roster so far — any `after` at all. `stage-ids.ts` gives the three reasons.
 * The array is a single element and stays an array because that is
 * `GameModule.frameStages`' type, not because a second stage is expected.
 */
export const simStages = (
  state: SimFrameState,
  time: TimeServiceApi,
  player: PlayerServiceApi,
  crops: CropServiceApi,
): ReadonlyArray<StageRegistration> => [
  {
    id: SIM_STAGE_IDS.physics,
    // No `after`, and that is a decision with an argument behind it rather than
    // an omission: see `stage-ids.ts`'s `UPSTREAM_STAGE_IDS`. mc-sim is the
    // bottom of the experience-facing order, it cannot see the one repository
    // whose stage plausibly precedes it (mc-render, which depends on mc-sim),
    // and a build with no input stage at all — a scenario test, a headless
    // server — is still a correct simulation.
    run: (dt) =>
      Effect.gen(function* () {
        // Landing impact is a one-frame signal. Consumers must read it after
        // this stage and before the next frame starts.
        yield* Ref.set(state.landingImpact, Option.none<LandingImpact>())

        // The world clock, advanced exactly once per frame. `dt` is supplied by
        // the frame, never read from a clock: `application/game-loop.ts` has
        // already clamped it through `domain/frame-timing.ts`, so a tab that was
        // backgrounded for thirty seconds delivers 0.05 here and the simulation
        // runs slow rather than teleporting the player through a collider.
        //
        // A zero `dt` is legal (kernel's brand admits it, and a frame can be
        // scheduled twice inside one clock tick), and `Time.advance` handles it
        // by advancing nothing. Nothing here divides by `dt`.
        yield* time.advance(dt)
        yield* crops.advance(dt)

        // Compatibility overrides win for exactly one frame and skip physics.
        // Draining the mailbox prevents a stale position from being re-applied.
        const resolved = yield* Ref.getAndSet(state.resolvedFeetPosition, Option.none<Position>())
        if (Option.isSome(resolved)) {
          yield* resetLandingImpact(state)
          yield* player.moveTo(resolved.value)
          return
        }

        const physicsConfig = yield* Ref.get(state.physicsConfig)
        if (Option.isNone(physicsConfig)) {
          yield* resetLandingImpact(state)
          return
        }

        const config = physicsConfig.value
        const pose = yield* player.pose
        const movementIntent = yield* Ref.get(state.movementIntent)
        const jumpIntent = yield* Ref.get(state.jumpIntent)
        const velocity = yield* Ref.get(state.velocity)
        const wasGrounded = yield* Ref.get(state.isGrounded)
        const intentMagnitude = Math.hypot(movementIntent.forward, movementIntent.strafe)
        const intentScale = intentMagnitude > 1 ? 1 / intentMagnitude : 1
        const forward = movementIntent.forward * intentScale
        const strafe = movementIntent.strafe * intentScale
        const sinYaw = Math.sin(pose.yawRadians)
        const cosYaw = Math.cos(pose.yawRadians)
        const vx = (-sinYaw * forward + cosYaw * strafe) * config.walkSpeed
        const vz = (-cosYaw * forward - sinYaw * strafe) * config.walkSpeed
        const resolveOptions: ResolveOptions = {
          ...config.resolve,
          halfWidth: PLAYER_HALF_WIDTH,
          halfHeight: PLAYER_HALF_HEIGHT,
        }
        const centreY = centreOfFoot(FootY(pose.feetPosition.y), PLAYER_HALF_HEIGHT)
        const supportedNow =
          jumpIntent &&
          !wasGrounded &&
          resolveBody(
            {
              kind: 'kinematic',
              x: pose.feetPosition.x,
              y: centreY,
              z: pose.feetPosition.z,
              vx,
              vy: velocity.y,
              vz,
            },
            dt,
            resolveOptions,
          ).isGrounded
        const body: Body = {
          kind: 'dynamic',
          x: pose.feetPosition.x,
          y: centreY,
          z: pose.feetPosition.z,
          vx,
          vy: jumpIntent && (wasGrounded || supportedNow) ? config.jumpSpeed : velocity.y,
          vz,
        }
        const integrated = integrateBody(body, dt)
        const resolvedBody = resolveBody(integrated, dt, resolveOptions)
        const downwardDistance = Math.max(0, body.y - resolvedBody.body.y)
        const priorFallDistance = wasGrounded
          ? 0
          : yield* Ref.get(state.accumulatedFallDistance)
        const fallDistance = integrated.vy < 0 ? priorFallDistance + downwardDistance : 0

        if (!wasGrounded && resolvedBody.isGrounded && fallDistance > 0 && integrated.vy < 0) {
          yield* Ref.set(
            state.landingImpact,
            Option.some({ fallDistance, impactVelocityY: integrated.vy }),
          )
        }
        yield* Ref.set(
          state.accumulatedFallDistance,
          resolvedBody.isGrounded || integrated.vy >= 0 ? 0 : fallDistance,
        )

        yield* Ref.set(
          state.velocity,
          vec3(resolvedBody.body.vx, resolvedBody.body.vy, resolvedBody.body.vz),
        )
        yield* Ref.set(state.isGrounded, resolvedBody.isGrounded)
        yield* player.moveTo(
          position(
            resolvedBody.body.x,
            footOfCentre(CentreY(resolvedBody.body.y), PLAYER_HALF_HEIGHT),
            resolvedBody.body.z,
          ),
        )
      }),
  },
]

/**
 * Build the module's state and its stages together, acquiring the services the
 * stage writes through.
 *
 * This is exactly `GameModule.frameStages` — see `simModule` below. The services
 * are acquired HERE, at registration time, which is the whole reason kernel made
 * `frameStages` an Effect: with a plain array there is no context in which to
 * acquire anything, so every service any stage touched would have had to live in
 * `FrameServices`, and kernel — tier 1 — would have had to name mc-sim's
 * services to declare it. See `mc-kernel/domain/frame.ts`.
 */
export const makeSimStages: Effect.Effect<
  ReadonlyArray<StageRegistration>,
  never,
  TimeService | PlayerService | CropService
> = Effect.gen(function* () {
  const time = yield* TimeService
  const player = yield* PlayerService
  const crops = yield* CropService
  const state = yield* makeSimFrameState
  return simStages(state, time, player, crops)
})

export const makeSimStagesWithPhysics = (
  config: SimPhysicsConfig,
): Effect.Effect<ReadonlyArray<StageRegistration>, never, TimeService | PlayerService | CropService> =>
  Effect.gen(function* () {
    const time = yield* TimeService
    const player = yield* PlayerService
    const crops = yield* CropService
    const state = yield* makeSimFrameState
    yield* Ref.set(state.physicsConfig, Option.some(config))
    return simStages(state, time, player, crops)
  })

/**
 * mc-sim as a `GameModule` (plan.md §4.1).
 *
 * Read the type parameters as the argument for `RRegister` being separate from
 * `RIn`:
 *
 *   ROut      = InventoryService | PlayerService | TimeService | CropService — mc-sim provides them
 *   RIn       = never  — nothing has to be given for those Layers to build
 *   RRegister = PlayerService | TimeService | CropService — registering `sim:physics` needs three
 *
 * Both registration services are in `ROut` and neither is in `RIn`. Collapsing
 * `RRegister` into `RIn` would demand that a host supply the very services this
 * module ships — the same inversion mc-render documents for `InputService`.
 *
 * ---------------------------------------------------------------------------
 * Why `layers` carries `InventoryService` too, and what that does NOT settle
 * ---------------------------------------------------------------------------
 *
 * No stage here touches the inventory. It is in `ROut` because `ROut` is "what
 * this module provides to a running game", and mc-compose's
 * `docs/e2e-triage.md` §4.3 measured what goes wrong without a single place that
 * builds it: mx-gameplay writes to an `InventoryService` and mx-ui reads one,
 * both must see ONE instance, and `InventoryServiceLayer` is `Layer.effect` so
 * every separate `Effect.provide` builds another. A `GameModule` is the shape in
 * which a host provides the Layer once and takes `frameStages` from inside that
 * same provide, so the mistake becomes unwritable.
 *
 * It does not settle §4.3's actual question, which is WHO provides it: mc-compose
 * may not import mc-sim (`transitive-import`, `pnpm check:deps`), so the answer
 * lies with whoever builds the browser entry point. This file only makes sure
 * that when that is decided there is exactly one thing to hand them.
 *
 * `GameLoop` is deliberately NOT in `ROut`. It takes the `FrameHandler` that a
 * host assembles from mc-compose's resolved order, so it is constructed by the
 * host that owns the order, not shipped inside the module whose stages the order
 * contains.
 */
export const simModule: GameModule<
  InventoryService | PlayerService | TimeService | CropService,
  never,
  never,
  PlayerService | TimeService | CropService
> = {
  layers: Layer.mergeAll(
    InventoryServiceLayer(),
    PlayerServiceLayer(),
    TimeServiceLayer(),
    CropServiceLayer,
  ),
  frameStages: makeSimStages,
}

/**
 * The module's stages together with the state they close over.
 *
 * `makeSimStages` deliberately does not expose the state: a consumer that could
 * reach into it could write the player's position without going through
 * `PlayerService`, which is the ownership inversion `domain/camera-pose.ts`
 * exists to prevent, wearing a different hat. Previews and tests need it, so
 * they get it here, explicitly, and the name says what it is for.
 *
 * Like `makeSimStages` it runs IN a context and cannot bring its own — see
 * mc-render's note on why a standalone Layer constant is a trap, which applies
 * verbatim: the stateful service layers are `Layer.effect`, so
 * providing one twice is two services, and a stage closes over the instance it
 * was handed.
 */
export const makeSimStagesForPreview: Effect.Effect<
  { readonly state: SimFrameState; readonly stages: ReadonlyArray<StageRegistration> },
  never,
  TimeService | PlayerService | CropService
> = Effect.gen(function* () {
  const time = yield* TimeService
  const player = yield* PlayerService
  const crops = yield* CropService
  const state = yield* makeSimFrameState
  return { state, stages: simStages(state, time, player, crops) }
})

/**
 * Physics-enabled stages together with the input state a production host owns.
 * The host writes movement and jump intent; player position remains owned by
 * `PlayerService` and is sampled afresh by the stage on every frame.
 */
export const makeControllableSimStagesWithPhysics = (
  config: SimPhysicsConfig,
): Effect.Effect<
  {
    readonly state: SimFrameState
    readonly stages: ReadonlyArray<StageRegistration>
    readonly input: SimInputPort
  },
  never,
  TimeService | PlayerService | CropService
> =>
  Effect.gen(function* () {
    const time = yield* TimeService
    const player = yield* PlayerService
    const crops = yield* CropService
    const state = yield* makeSimFrameState
    yield* Ref.set(state.physicsConfig, Option.some(config))
    return { state, stages: simStages(state, time, player, crops), input: makeSimInputPort(state) }
  })

/** Preview-compatible name retained alongside the production host API. */
export const makeSimStagesForPreviewWithPhysics = makeControllableSimStagesWithPhysics
