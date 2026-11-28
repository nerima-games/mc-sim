/**
 * Player movement through mc-physics `applyMovementInput` / `applyMovementFriction`.
 *
 * Every expected number is derived from the movement model rather than read
 * back from the code: ground friction is slipperiness 0.6 * 0.91, ice 0.98 * 0.91,
 * and the input acceleration is scaled so that `walkSpeed` is the steady speed
 * on ordinary ground (see `VANILLA_WALK_SPEED`).
 */
import { describe, expect, it } from '@effect/vitest'
import {
  FULL_BLOCK_SHAPE,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  DEFAULT_MOVEMENT_CONFIG,
} from '@nerima-games/mc-physics'
import { Effect, Layer, Ref, Result } from 'effect'
import {
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  MonotonicTimeSecs,
  PositionAxis,
  position as kernelPosition,
} from '@nerima-games/mc-kernel'
import { CropServiceLayer } from '../src/application/crop-service'
import { InventoryServiceLayer } from '../src/application/inventory-service'
import { PlayerService, PlayerServiceLayer } from '../src/application/player-service'
import { TimeServiceLayer } from '../src/application/time-service'
import { VANILLA_WALK_SPEED } from '../src/stages/player-movement'
import {
  makeControllableSimStagesWithPhysics,
  type MovementIntent,
  type SimPhysicsConfig,
} from '../src/stages/registration'

const SimulationLayer = Layer.mergeAll(
  InventoryServiceLayer(),
  PlayerServiceLayer(),
  TimeServiceLayer(),
  CropServiceLayer,
)
const FrozenClockLayer = FixedClockLayer({
  monotonicSecs: MonotonicTimeSecs(1_000),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
})

const TICK = DeltaTimeSecs(0.05)
const WALK_SPEED = 4
const JUMP_SPEED = 7
const PLAIN_BLOCK = 1
const LADDER = 18
const SOUL_SAND = 47
const ICE = 48

const GROUND_FRICTION = 0.6 * 0.91
const ICE_FRICTION = 0.98 * 0.91

const forward: MovementIntent = { forward: 1, strafe: 0 }
const diagonal: MovementIntent = { forward: 1, strafe: 1 }
const idle: MovementIntent = { forward: 0, strafe: 0 }

type Cell = (bx: number, by: number, bz: number) => boolean
type BlockIds = (bx: number, by: number, bz: number) => number | null

/** Solid cells are full cubes; `blockIdAt` names every cell so ice, soul sand and ladders are reachable. */
const makeConfig = (solid: Cell, blockIdAt: BlockIds): SimPhysicsConfig => ({
  resolve: {
    halfWidth: PLAYER_HALF_WIDTH,
    halfHeight: PLAYER_HALF_HEIGHT,
    environment: { blockAt: () => Result.succeed(null) },
    blockPropertiesAt: () => Result.succeed(null),
    blockShapeAt: (bx, by, bz) => (solid(bx, by, bz) ? FULL_BLOCK_SHAPE : null),
    blockIdAt,
  },
  walkSpeed: WALK_SPEED,
  jumpSpeed: JUMP_SPEED,
})

const floorOf = (id: number): SimPhysicsConfig =>
  makeConfig((_bx, by) => by === -1, (_bx, by) => (by === -1 ? id : 0))

type Sample = { readonly x: number; readonly y: number; readonly z: number; readonly speed: number; readonly vy: number }

/** Runs one tick per intent and records the feet position and horizontal speed after each. */
const walk = (
  config: SimPhysicsConfig,
  intents: ReadonlyArray<MovementIntent>,
  options: {
    readonly sneak?: boolean
    readonly jump?: boolean
    readonly start?: readonly [number, number, number]
  } = {},
) =>
  Effect.gen(function* () {
    const player = yield* PlayerService
    const { state, stages, input } = yield* makeControllableSimStagesWithPhysics(config)
    const [x, y, z] = options.start ?? [0.5, 0, 0.5]
    yield* player.moveTo(kernelPosition(PositionAxis(x), PositionAxis(y), PositionAxis(z)))
    yield* input.setSneakIntent(options.sneak ?? false)
    yield* input.setJumpIntent(options.jump ?? false)
    const samples: Array<Sample> = []
    for (const intent of intents) {
      yield* input.setMovementIntent(intent)
      yield* stages[0]?.run(TICK) ?? Effect.void
      const feet = (yield* player.pose).feetPosition
      const velocity = yield* Ref.get(state.velocity)
      samples.push({
        x: feet.x,
        y: feet.y,
        z: feet.z,
        speed: Math.hypot(velocity.x, velocity.z),
        vy: velocity.y,
      })
    }
    return samples
  })

const repeat = (intent: MovementIntent, ticks: number): ReadonlyArray<MovementIntent> =>
  Array.from({ length: ticks }, () => intent)

/** Distance covered in the last tick, which is the speed once acceleration and friction balance. */
const lastStep = (samples: ReadonlyArray<Sample>): number => {
  const [before, after] = samples.slice(-2)
  if (before === undefined || after === undefined) throw new Error('need two samples')
  return Math.hypot(after.x - before.x, after.z - before.z)
}

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(SimulationLayer), Effect.provide(FrozenClockLayer))

describe('walking on level ground', () => {
  it.effect('accelerates to walkSpeed instead of starting at it', () =>
    run(
      Effect.gen(function* () {
        const samples = yield* walk(floorOf(PLAIN_BLOCK), repeat(forward, 80))
        const first = Math.hypot((samples[0]?.x ?? 0) - 0.5, (samples[0]?.z ?? 0) - 0.5)

        expect(first).toBeLessThan(WALK_SPEED * 0.05 * 0.6)
        expect(lastStep(samples)).toBeCloseTo(WALK_SPEED * 0.05, 3)
      }),
    ),
  )

  it.effect('does not exceed walkSpeed on a diagonal', () =>
    run(
      Effect.gen(function* () {
        const samples = yield* walk(floorOf(PLAIN_BLOCK), repeat(diagonal, 80))

        expect(lastStep(samples)).toBeCloseTo(WALK_SPEED * 0.05, 3)
      }),
    ),
  )

  it('keeps walkSpeed tied to the mc-physics default acceleration', () => {
    // Guards VANILLA_WALK_SPEED: with the default ground acceleration the steady
    // speed must still be 4.317, or the scaling in movementConfigFor is wrong.
    const steady = Number(DEFAULT_MOVEMENT_CONFIG.groundAcceleration) / 20 / (1 - GROUND_FRICTION)

    expect(steady).toBeCloseTo(VANILLA_WALK_SPEED, 2)
  })

  it.effect('slows by ground friction when the key is released', () =>
    run(
      Effect.gen(function* () {
        const samples = yield* walk(floorOf(PLAIN_BLOCK), [...repeat(forward, 80), idle])
        const [moving, released] = samples.slice(-2)

        expect((released?.speed ?? 0) / (moving?.speed ?? 1)).toBeCloseTo(GROUND_FRICTION, 3)
      }),
    ),
  )
})

describe('sneaking', () => {
  it.effect('walks at 0.3 of the normal speed', () =>
    run(
      Effect.gen(function* () {
        const sneaking = yield* walk(floorOf(PLAIN_BLOCK), repeat(forward, 80), { sneak: true })
        const walking = yield* walk(floorOf(PLAIN_BLOCK), repeat(forward, 80))

        expect(lastStep(sneaking) / lastStep(walking)).toBeCloseTo(DEFAULT_MOVEMENT_CONFIG.sneakMultiplier, 3)
      }),
    ),
  )

  // Ground exists only where x < 0. Strafing +x with yaw 0 walks toward the edge.
  const ledge = makeConfig((bx, by) => by === -1 && bx < 0, (bx, by) => (by === -1 && bx < 0 ? PLAIN_BLOCK : 0))
  const towardEdge = repeat({ forward: 0, strafe: 1 }, 120)

  it.effect('walks off the edge when not sneaking', () =>
    run(
      Effect.gen(function* () {
        const samples = yield* walk(ledge, towardEdge, { start: [-0.5, 0, 0.5] })

        expect(samples.at(-1)?.y ?? 0).toBeLessThan(-1)
      }),
    ),
  )

  it.effect('stops at the edge and stays on the ground', () =>
    run(
      Effect.gen(function* () {
        const samples = yield* walk(ledge, towardEdge, { start: [-0.5, 0, 0.5], sneak: true })
        const end = samples.at(-1)

        expect(end?.y).toBeCloseTo(0)
        // Like vanilla, the body may hang over the edge until its hitbox no longer touches the
        // ground, so its centre stops less than one half width past the edge at x = 0.
        expect(end?.x ?? 1).toBeLessThan(Number(PLAYER_HALF_WIDTH))
        expect(end?.x ?? 0).toBeGreaterThan(0)
      }),
    ),
  )
})

describe('block surfaces', () => {
  it.effect('keeps momentum on ice: speed decays by 0.98 * 0.91, not by ground friction', () =>
    run(
      Effect.gen(function* () {
        const samples = yield* walk(floorOf(ICE), [...repeat(forward, 300), idle])
        const [moving, released] = samples.slice(-2)

        expect((released?.speed ?? 0) / (moving?.speed ?? 1)).toBeCloseTo(ICE_FRICTION, 3)
        expect(ICE_FRICTION).toBeGreaterThan(GROUND_FRICTION)
      }),
    ),
  )

  it.effect('walks slower on soul sand by 2.508 / 4.317', () =>
    run(
      Effect.gen(function* () {
        const soulSand = yield* walk(floorOf(SOUL_SAND), repeat(forward, 80))
        const plain = yield* walk(floorOf(PLAIN_BLOCK), repeat(forward, 80))

        expect(lastStep(soulSand) / lastStep(plain)).toBeCloseTo(2.508 / VANILLA_WALK_SPEED, 3)
      }),
    ),
  )
})

describe('ladders', () => {
  // A ladder column at x = 0, z = 0 from y = 0 up to y = 10; the floor is plain stone.
  const inColumn = (bx: number, by: number, bz: number): boolean => bx === 0 && bz === 0 && by >= 0 && by < 10
  const ladder = makeConfig(
    (_bx, by) => by === -1,
    (bx, by, bz) => (inColumn(bx, by, bz) ? LADDER : by === -1 ? PLAIN_BLOCK : 0),
  )
  const start = { start: [0.5, 2, 0.5] } as const

  // Climbing with the jump key keeps the body out of the wall. Pressing forward into a wall while
  // climbing stalls in mc-physics 0.6.0 (see the pull request description), so it is not asserted.
  it.effect('climbs while jump is held', () =>
    run(
      Effect.gen(function* () {
        const ticks = 20
        const samples = yield* walk(ladder, repeat(idle, ticks), { ...start, jump: true })
        const climbed = (samples.at(-1)?.y ?? 0) - 2
        const climbSpeed = Number(DEFAULT_MOVEMENT_CONFIG.climbSpeed)

        // mc-physics adds one tick of gravity before the move, so the climb is slower than
        // climbSpeed; it is still far above what a body without a ladder does (fall).
        expect(climbed).toBeGreaterThan(0.7 * climbSpeed * ticks * 0.05)
        expect(samples.at(-1)?.vy ?? 0).toBeCloseTo(climbSpeed, 3)
      }),
    ),
  )

  it.effect('slides down no faster than the descent cap with no input', () =>
    run(
      Effect.gen(function* () {
        const samples = yield* walk(ladder, repeat(idle, 40), start)
        const fastest = Math.min(...samples.map(({ vy }) => vy))

        expect(samples.at(-1)?.y ?? 2).toBeLessThan(2)
        expect(fastest).toBeGreaterThanOrEqual(-Number(DEFAULT_MOVEMENT_CONFIG.climbDescentMaxSpeed))
      }),
    ),
  )

  it.effect('falls freely when the same column is not a ladder', () =>
    run(
      Effect.gen(function* () {
        const plainColumn = makeConfig(
          (_bx, by) => by === -1,
          (_bx, by) => (by === -1 ? PLAIN_BLOCK : 0),
        )
        const samples = yield* walk(plainColumn, repeat(idle, 40), start)

        expect(Math.min(...samples.map(({ vy }) => vy))).toBeLessThan(-Number(DEFAULT_MOVEMENT_CONFIG.climbDescentMaxSpeed))
      }),
    ),
  )
})
