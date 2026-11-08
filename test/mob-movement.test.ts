import {
  BlockAxis,
  EntityIdSchema,
  NonNegativeTickCount,
  PositionAxis,
  resolveBlockCapabilities,
  resolveBlockProperties,
} from '@nerima-games/mc-kernel'
import * as Physics from '@nerima-games/mc-physics'
import { Result, Schema } from 'effect'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import * as Sim from '../src/index.js'
import { hostileNumber, hostileValue, invoke } from './public-property-helpers.js'

const cell = (x: number, y: number, z: number): Sim.MobPathCell => ({
  x: BlockAxis(x),
  y: BlockAxis(y),
  z: BlockAxis(z),
})

const solidProperties = Result.getOrThrow(resolveBlockProperties({}))
const solidCapabilities = Result.getOrThrow(resolveBlockCapabilities({ passable: false }))
const solidSample = { properties: solidProperties, capabilities: solidCapabilities }

const key = (x: number, y: number, z: number): string => `${x},${y},${z}`

const makeWorld = (
  blocks: ReadonlySet<string>,
  shapeOverrides: ReadonlyMap<string, Physics.BlockShape> = new Map(),
): Sim.MobMovementWorldPort => {
  const blockShapeAt = (x: BlockAxis, y: BlockAxis, z: BlockAxis): Physics.BlockShape | null => {
    if (!blocks.has(key(x, y, z))) return null
    return shapeOverrides.get(key(x, y, z)) ?? Physics.FULL_BLOCK_SHAPE
  }
  return {
    isPassable: (position) => !blocks.has(key(position.x, position.y, position.z)),
    hasSupport: (position) => blocks.has(key(position.x, position.y, position.z)),
    hazardAt: () => null,
    physics: {
      environment: {
        blockAt: (x, y, z) => Result.succeed(blocks.has(key(x, y, z)) ? solidSample : null),
        blockShapeAt,
      },
      blockPropertiesAt: (x, y, z) => Result.succeed(blocks.has(key(x, y, z)) ? solidProperties : null),
      blockShapeAt,
    },
  }
}

const blockShapeWithHeight = (height: number): Physics.BlockShape => ({
  minX: PositionAxis(0),
  minY: PositionAxis(0),
  minZ: PositionAxis(0),
  maxX: PositionAxis(1),
  maxY: PositionAxis(height),
  maxZ: PositionAxis(1),
})

const makePlatform = (): ReadonlySet<string> => {
  const blocks = new Set<string>()
  for (let x = -1; x <= 6; x += 1) {
    for (let z = -2; z <= 2; z += 1) {
      if (x !== 4 || z !== 0) blocks.add(key(x, 0, z))
    }
  }
  blocks.add(key(4, -3, 0))
  blocks.add(key(2, 1, 0))
  for (const z of [-2, -1, 1, 2]) {
    blocks.add(key(2, 1, z))
    blocks.add(key(2, 2, z))
  }
  return blocks
}

const makeMob = (name = 'mob-1'): Sim.MobMovementState => ({
  id: Schema.decodeUnknownSync(EntityIdSchema)(name),
  body: {
    kind: 'dynamic',
    x: PositionAxis(0.5),
    y: Physics.CentreY(1.9),
    z: PositionAxis(0.5),
    vx: Physics.BlocksPerSecond(0),
    vy: Physics.BlocksPerSecond(0),
    vz: Physics.BlocksPerSecond(0),
  },
  profile: {
    kind: 'ground',
    width: Physics.BlockLength(0.6),
    height: Physics.BlockLength(1.8),
    canJump: true,
  },
  goal: cell(5, 1, 0),
  path: [],
  pathIndex: NonNegativeTickCount(0),
  stuckTicks: NonNegativeTickCount(0),
  isGrounded: true,
})

const stepOnce = (
  state: Sim.MobMovementState,
  world: Sim.MobMovementWorldPort,
  settings?: Sim.MobMovementSettings,
): Readonly<{ state: Sim.MobMovementState; searchesPerformed: NonNegativeTickCount; expandedNodes: NonNegativeTickCount; reachedGoal: boolean }> => {
  const result = Sim.stepMobMovementsForTick({ mobs: [state], world, ...(settings === undefined ? {} : { settings }) })
  expect(result._tag).toBe('MobMovementCompleted')
  if (result._tag !== 'MobMovementCompleted') throw new Error('mob tick was rejected')
  const [outcome] = result.outcomes
  if (outcome === undefined || outcome._tag !== 'MobAdvanced') {
    throw new Error(`mob tick did not advance: ${JSON.stringify(outcome)}`)
  }
  return {
    state: outcome.state,
    searchesPerformed: result.searchesPerformed,
    expandedNodes: result.expandedNodes,
    reachedGoal: outcome.reachedGoal,
  }
}

const movementResultFor = (input: unknown): Sim.MobMovementTickResult => {
  const value = invoke(Sim.stepMobMovementsForTick, [input])
  const decoded = Schema.decodeUnknownResult(Sim.MobMovementTickResultSchema, { onExcessProperty: 'error' })(value)
  expect(decoded._tag).toBe('Success')
  if (decoded._tag !== 'Success') throw new Error('movement result failed its public Schema')
  return decoded.success
}

const expectInputFailure = (input: unknown, reason: 'invalid-batch' | 'invalid-world'): void => {
  expect(movementResultFor(input)).toStrictEqual({
    _tag: 'MobMovementRejected',
    failure: { _tag: 'MobMovementInputFailure', index: NonNegativeTickCount(0), reason },
  })
}

it('moves a mob through the public API with fixed-tick physics around a hole and across a one-block ledge', () => {
  const world = makeWorld(makePlatform())
  let state = makeMob()
  const initialX = state.body.x
  const initialY = state.body.y
  let maxY: number = initialY
  let observedJump = false
  let observedFallAfterJump = false
  let observedLanding = false
  let detouredAroundHole = false
  let reachedGoal = false

  for (let tick = 0; tick < 180; tick += 1) {
    const advanced = stepOnce(state, world)
    state = advanced.state
    const previousMaxY = maxY
    observedJump ||= state.body.y > initialY + 0.1
    observedFallAfterJump ||= observedJump && state.body.y < previousMaxY - 0.1
    observedLanding ||= observedFallAfterJump && state.isGrounded
    maxY = Math.max(maxY, state.body.y)
    detouredAroundHole ||= state.path.some((node) => node.x === 4 && node.z !== 0)
    reachedGoal = advanced.reachedGoal
    if (reachedGoal) break
  }

  expect(state.body.x).toBeGreaterThan(initialX + 3)
  expect(maxY).toBeGreaterThan(initialY + 0.1)
  expect(observedJump).toBe(true)
  expect(observedFallAfterJump).toBe(true)
  expect(observedLanding).toBe(true)
  expect(detouredAroundHole).toBe(true)
  expect(reachedGoal).toBe(true)
  expect(state.isGrounded).toBe(true)
})

it('replans after the configured number of immobile ticks', () => {
  const physicsBlocks = new Set(makePlatform())
  physicsBlocks.add(key(1, 1, 0))
  physicsBlocks.add(key(1, 2, 0))
  const world = makeWorld(physicsBlocks)
  const hiddenWall = new Set([key(1, 1, 0), key(1, 2, 0)])
  const navigationWorld = {
    ...world,
    isPassable: (position: Sim.MobPathCell) => hiddenWall.has(key(position.x, position.y, position.z)) || world.isPassable(position),
  }
  const initialMob = makeMob('mob-stuck')
  const mob = { ...initialMob, body: { ...initialMob.body, x: PositionAxis(0.7) } }
  const initial = Sim.stepMobMovementsForTick({
    mobs: [mob],
    world: navigationWorld,
    settings: { stuckThresholdTicks: NonNegativeTickCount(1) },
  })
  expect(initial._tag).toBe('MobMovementCompleted')
  if (initial._tag !== 'MobMovementCompleted') throw new Error('first tick was rejected')
  const [first] = initial.outcomes
  if (first === undefined || first._tag !== 'MobAdvanced') {
    throw new Error(`first tick did not advance: ${JSON.stringify(first)}`)
  }
  expect(first.state.body.x).toBe(mob.body.x)
  expect(first.state.stuckTicks).toBe(NonNegativeTickCount(1))

  const oneTickBeforeDefaultThreshold = {
    ...first.state,
    stuckTicks: NonNegativeTickCount(Sim.DEFAULT_MOB_MOVEMENT_SETTINGS.stuckThresholdTicks - 1),
  }
  const defaultThresholdState = stepOnce(oneTickBeforeDefaultThreshold, navigationWorld, {})
  expect(defaultThresholdState.searchesPerformed).toBe(NonNegativeTickCount(0))
  expect(defaultThresholdState.state.stuckTicks).toBe(Sim.DEFAULT_MOB_MOVEMENT_SETTINGS.stuckThresholdTicks)

  const defaultThresholdReplan = stepOnce(defaultThresholdState.state, navigationWorld, {})
  expect(defaultThresholdReplan.searchesPerformed).toBe(NonNegativeTickCount(1))

  const next = Sim.stepMobMovementsForTick({
    mobs: [first.state],
    world: navigationWorld,
    settings: { stuckThresholdTicks: NonNegativeTickCount(1) },
  })
  expect(next._tag).toBe('MobMovementCompleted')
  if (next._tag !== 'MobMovementCompleted') throw new Error('replan tick was rejected')
  expect(next.searchesPerformed).toBe(NonNegativeTickCount(1))
})

it('keeps one simulation tick deterministic and enforces per-tick search limits for a mob group', () => {
  const world = makeWorld(makePlatform())
  const mobs = Array.from({ length: 100 }, (_, index) => makeMob(`mob-${index}`))
  const first = Sim.stepMobMovementsForTick({ mobs, world })
  const second = Sim.stepMobMovementsForTick({ mobs, world })

  expect(first).toStrictEqual(second)
  expect(first._tag).toBe('MobMovementCompleted')
  if (first._tag !== 'MobMovementCompleted') throw new Error('mob group tick was rejected')
  expect(first.searchesPerformed).toBe(Sim.DEFAULT_MOB_MOVEMENT_SETTINGS.maxSearchesPerTick)
  expect(first.outcomes).toHaveLength(100)
  const advanced = first.outcomes.filter((outcome) => outcome._tag === 'MobAdvanced')
  expect(advanced).toHaveLength(8)
  const firstAdvanced = advanced[0]
  if (firstAdvanced === undefined || firstAdvanced._tag !== 'MobAdvanced') throw new Error('first mob did not advance')
  expect(firstAdvanced.state.body.x).toBeCloseTo(mobs[0]!.body.x + 0.1, 10)
  expect(first.expandedNodes).toBeLessThanOrEqual(8 * Sim.DEFAULT_MOB_MOVEMENT_SETTINGS.maxNodesPerSearch)
})

it('returns a schema-valid empty tick without searching', () => {
  const empty = Sim.stepMobMovementsForTick({ mobs: [], world: makeWorld(makePlatform()) })
  expect(empty._tag).toBe('MobMovementCompleted')
  if (empty._tag !== 'MobMovementCompleted') throw new Error('empty tick was rejected')
  expect(empty.outcomes).toStrictEqual([])
  expect(empty.searchesPerformed).toBe(NonNegativeTickCount(0))
  expect(empty.expandedNodes).toBe(NonNegativeTickCount(0))
  expect(Schema.decodeUnknownResult(Sim.MobMovementTickResultSchema)(empty)._tag).toBe('Success')
})

it('maps a standing foot exactly on a block boundary without lifting a lower position', () => {
  const world = makeWorld(new Set([key(0, 0, 0)]))
  const exactStanding = {
    ...makeMob('mob-boundary-exact'),
    body: { ...makeMob('mob-boundary-exact').body, y: Physics.CentreY(1.9) },
    goal: cell(0, 1, 0),
  }
  const exact = Sim.stepMobMovementsForTick({ mobs: [exactStanding], world })
  expect(exact._tag).toBe('MobMovementCompleted')
  if (exact._tag !== 'MobMovementCompleted') throw new Error('exact boundary tick was rejected')
  const [exactOutcome] = exact.outcomes
  expect(exactOutcome?._tag).toBe('MobAdvanced')
  if (exactOutcome === undefined || exactOutcome._tag !== 'MobAdvanced') throw new Error('exact boundary mob did not advance')
  expect(exactOutcome.state.path[0]?.y).toBe(BlockAxis(1))

  const genuinelyLower = {
    ...makeMob('mob-boundary-lower'),
    body: { ...makeMob('mob-boundary-lower').body, y: Physics.CentreY(1.899) },
    goal: cell(0, 1, 0),
  }
  const lower = Sim.stepMobMovementsForTick({ mobs: [genuinelyLower], world })
  expect(lower._tag).toBe('MobMovementCompleted')
  if (lower._tag !== 'MobMovementCompleted') throw new Error('lower boundary tick was rejected')
  expect(lower.outcomes[0]).toStrictEqual({
    _tag: 'MobStepFailed',
    failure: { _tag: 'MobMovementPathFailure', index: NonNegativeTickCount(0), failure: { _tag: 'NoPath' } },
  })
})

it('keeps movement settings Schema bounds aligned with pathfinding budgets', () => {
  const maxFallDistance = Schema.decodeUnknownResult(Sim.MobMovementSettingsSchema)({ maxFallDistance: BlockAxis(16) })
  const excessiveFallDistance = Schema.decodeUnknownResult(Sim.MobMovementSettingsSchema)({ maxFallDistance: BlockAxis(17) })
  const excessiveSearchProduct = Schema.decodeUnknownResult(Sim.MobMovementSettingsSchema)({
    maxNodesPerSearch: NonNegativeTickCount(Number.MAX_SAFE_INTEGER),
    maxSearchesPerTick: NonNegativeTickCount(2),
  })

  expect(maxFallDistance._tag).toBe('Success')
  expect(excessiveFallDistance._tag).toBe('Failure')
  expect(excessiveSearchProduct._tag).toBe('Failure')
})

it('uses a one-block physics step limit, allowing height 1.0 and stopping at 1.001', () => {
  const blocks = new Set([key(0, -1, 0), key(1, 0, 0), key(1, -1, 0), key(2, -1, 0)])
  const state = (name: string): Sim.MobMovementState => {
    const initial = makeMob(name)
    return {
      ...initial,
      body: {
        ...initial.body,
        x: PositionAxis(0.7),
        y: Physics.CentreY(0.9),
      },
      goal: cell(1, 0, 0),
      path: [
        { ...cell(0, 0, 0), action: 'start' },
        { ...cell(1, 0, 0), action: 'walk' },
      ],
      pathIndex: NonNegativeTickCount(1),
      isGrounded: true,
    }
  }
  const advanceAtHeight = (height: number, name: string) => {
    const world = makeWorld(blocks, new Map([[key(1, 0, 0), blockShapeWithHeight(height)]]))
    return stepOnce(state(name), world)
  }

  const exact = advanceAtHeight(1, 'mob-step-exact')
  const above = advanceAtHeight(1.001, 'mob-step-above')
  expect(exact.state.body.x).toBeGreaterThan(0.7)
  expect(above.state.body.x).toBe(0.7)
})

it('counts horizontal or waypoint progress rather than gravity-only motion as progress', () => {
  const blocks = new Set(makePlatform())
  blocks.add(key(1, 3, 0))
  const world = makeWorld(blocks)
  const initial = makeMob('mob-fall')
  const state = {
    ...initial,
    body: {
      ...initial.body,
      x: PositionAxis(0.7),
      y: Physics.CentreY(2.9),
    },
    isGrounded: false,
    goal: cell(1, 1, 0),
    path: [
      { ...cell(0, 2, 0), action: 'start' as const },
      { ...cell(1, 1, 0), action: 'fall' as const },
    ],
    pathIndex: NonNegativeTickCount(1),
  }
  const advanced = stepOnce(state, world, { stuckThresholdTicks: NonNegativeTickCount(5) })
  expect(advanced.state.body.x).toBe(state.body.x)
  expect(advanced.state.body.y).toBeLessThan(state.body.y)
  expect(advanced.state.stuckTicks).toBe(NonNegativeTickCount(1))
})

it('returns per-mob failures for invalid bodies, path indexes, and unsupported profiles', () => {
  const world = makeWorld(makePlatform())
  const dynamic = makeMob('mob-invalid-state')
  const staticBody = { ...dynamic, body: { ...dynamic.body, kind: 'static' as const } }
  const invalidPathIndex = { ...dynamic, pathIndex: NonNegativeTickCount(1) }
  const unrepresentablePosition = {
    ...dynamic,
    body: { ...dynamic.body, x: PositionAxis(Number.MAX_SAFE_INTEGER + 1) },
  }
  const unrepresentablePhysicsSize = {
    ...dynamic,
    profile: { ...dynamic.profile, height: Physics.BlockLength(Number.MIN_VALUE) },
    goal: cell(1, 1, 0),
    path: [
      { ...cell(0, 1, 0), action: 'start' as const },
      { ...cell(1, 1, 0), action: 'walk' as const },
    ],
    pathIndex: NonNegativeTickCount(1),
  }
  const swimmer = {
    ...dynamic,
    profile: { kind: 'swimmer' as const, width: Physics.BlockLength(0.6), height: Physics.BlockLength(1.8) },
  }

  for (const mob of [staticBody, invalidPathIndex]) {
    const result = Sim.stepMobMovementsForTick({ mobs: [mob], world })
    expect(result).toStrictEqual({
      _tag: 'MobMovementCompleted',
      outcomes: [{
        _tag: 'MobStepFailed',
        failure: { _tag: 'MobMovementInputFailure', index: NonNegativeTickCount(0), reason: 'invalid-request' },
      }],
      searchesPerformed: NonNegativeTickCount(0),
      expandedNodes: NonNegativeTickCount(0),
    })
  }

  const invalidCell = Sim.stepMobMovementsForTick({ mobs: [unrepresentablePosition], world })
  expect(invalidCell).toStrictEqual({
    _tag: 'MobMovementCompleted',
    outcomes: [{
      _tag: 'MobStepFailed',
      failure: { _tag: 'MobMovementPhysicsFailure', index: NonNegativeTickCount(0), reason: 'invalid-body' },
    }],
    searchesPerformed: NonNegativeTickCount(0),
    expandedNodes: NonNegativeTickCount(0),
  })

  const invalidPhysicsSize = Sim.stepMobMovementsForTick({ mobs: [unrepresentablePhysicsSize], world })
  expect(invalidPhysicsSize).toStrictEqual({
    _tag: 'MobMovementCompleted',
    outcomes: [{
      _tag: 'MobStepFailed',
      failure: { _tag: 'MobMovementPhysicsFailure', index: NonNegativeTickCount(0), reason: 'invalid-body' },
    }],
    searchesPerformed: NonNegativeTickCount(0),
    expandedNodes: NonNegativeTickCount(0),
  })

  const unsupported = Sim.stepMobMovementsForTick({ mobs: [swimmer], world })
  expect(unsupported).toStrictEqual({
    _tag: 'MobMovementCompleted',
    outcomes: [{
      _tag: 'MobStepFailed',
      failure: {
        _tag: 'MobMovementPathFailure',
        index: NonNegativeTickCount(0),
        failure: { _tag: 'UnsupportedProfile', kind: 'swimmer' },
      },
    }],
    searchesPerformed: NonNegativeTickCount(0),
    expandedNodes: NonNegativeTickCount(0),
  })
})

it('uses spider climb velocity for a cached climb step', () => {
  const world = makeWorld(new Set([key(0, 0, 0), key(1, 1, 0)]))
  const initial = makeMob('mob-spider')
  const spider: Sim.MobMovementState = {
    ...initial,
    body: { ...initial.body, y: Physics.CentreY(1.45) },
    profile: { kind: 'spider', width: Physics.BlockLength(0.6), height: Physics.BlockLength(0.9) },
    goal: cell(0, 2, 0),
    path: [
      { ...cell(0, 1, 0), action: 'start' },
      { ...cell(0, 2, 0), action: 'climb', wall: { x: 1, z: 0 } },
    ],
    pathIndex: NonNegativeTickCount(1),
  }

  const advanced = stepOnce(spider, world)
  expect(advanced.searchesPerformed).toBe(NonNegativeTickCount(0))
  expect(advanced.state.body.x).toBeGreaterThan(spider.body.x)
  expect(advanced.state.body.y).toBeGreaterThan(spider.body.y)
  expect(advanced.state.stuckTicks).toBe(NonNegativeTickCount(0))
})

it('jumps vertically when a mob is already centered over the jump waypoint', () => {
  const world = makeWorld(new Set([key(0, 0, 0), key(1, 0, 0), key(2, 0, 0)]))
  const initial = makeMob('mob-vertical-jump')
  const mob: Sim.MobMovementState = {
    ...initial,
    body: { ...initial.body, x: PositionAxis(1.5) },
    goal: cell(1, 2, 0),
    path: [
      { ...cell(0, 1, 0), action: 'start' },
      { ...cell(1, 2, 0), action: 'jump' },
    ],
    pathIndex: NonNegativeTickCount(1),
  }

  const advanced = stepOnce(mob, world)
  expect(advanced.state.body.x).toBe(mob.body.x)
  expect(advanced.state.body.z).toBe(mob.body.z)
  expect(advanced.state.body.y).toBeGreaterThan(mob.body.y)
})

it('returns a typed failure if stuck tick count would exceed its brand', () => {
  const initial = makeMob('mob-stuck-overflow')
  const mob = {
    ...initial,
    goal: cell(0, 1, 0),
    path: [{ ...cell(0, 1, 0), action: 'start' as const }],
    pathIndex: NonNegativeTickCount(1),
    stuckTicks: NonNegativeTickCount(Number.MAX_SAFE_INTEGER),
  }
  const result = Sim.stepMobMovementsForTick({ mobs: [mob], world: makeWorld(new Set()) })

  expect(result).toStrictEqual({
    _tag: 'MobMovementCompleted',
    outcomes: [{
      _tag: 'MobStepFailed',
      failure: { _tag: 'MobMovementPhysicsFailure', index: NonNegativeTickCount(0), reason: 'invalid-body' },
    }],
    searchesPerformed: NonNegativeTickCount(0),
    expandedNodes: NonNegativeTickCount(0),
  })
})

it('returns a schema-valid failure when physics block lookup fails', () => {
  const world = makeWorld(makePlatform())
  const invalidPosition = PositionAxis.result(Number.NaN)
  if (Result.isSuccess(invalidPosition)) throw new Error('invalid position fixture unexpectedly decoded')
  const failingPhysicsWorld: Sim.MobMovementWorldPort = {
    ...world,
    physics: {
      environment: { blockAt: world.physics.environment.blockAt },
      blockPropertiesAt: () => Result.fail(invalidPosition.failure),
    },
  }
  const initial = makeMob('mob-physics-failure')
  const mob = {
    ...initial,
    goal: cell(1, 1, 0),
    path: [
      { ...cell(0, 1, 0), action: 'start' as const },
      { ...cell(1, 1, 0), action: 'walk' as const },
    ],
    pathIndex: NonNegativeTickCount(1),
  }

  const result = Sim.stepMobMovementsForTick({ mobs: [mob], world: failingPhysicsWorld })
  expect(result).toStrictEqual({
    _tag: 'MobMovementCompleted',
    outcomes: [{
      _tag: 'MobStepFailed',
      failure: { _tag: 'MobMovementPhysicsFailure', index: NonNegativeTickCount(0), reason: 'step-body-failed' },
    }],
    searchesPerformed: NonNegativeTickCount(0),
    expandedNodes: NonNegativeTickCount(0),
  })
  expect(Schema.decodeUnknownResult(Sim.MobMovementTickResultSchema, { onExcessProperty: 'error' })(result)._tag)
    .toBe('Success')
})

it('returns schema-valid failures for invalid values and never throws on generated hostile inputs', () => {
  const world = makeWorld(makePlatform())
  const state = makeMob('mob-invalid')
  const invalidNumber = invoke(Sim.stepMobMovementsForTick, [{
    mobs: [{ ...state, body: { ...state.body, x: Number.NaN } }],
    world,
  }])
  const invalidMobBatch = { mobs: null, world }
  const excessBatchKey = invoke(Sim.stepMobMovementsForTick, [{ mobs: [state], world, _tag: 'unexpected' }])
  const invalidSettingsInputs: ReadonlyArray<unknown> = [
    { mobs: [state], world, settings: undefined },
    { mobs: [state], world, settings: { movementSpeed: undefined } },
    { mobs: [state], world, settings: { movementSpeed: null } },
    { mobs: [state], world, settings: { maxSearchesPerTick: NonNegativeTickCount(0) } },
  ]
  const invalidPhysicsWorlds: ReadonlyArray<unknown> = [
    null,
    { ...world, isPassable: null },
    { ...world, hasSupport: 1 },
    { ...world, hazardAt: false },
    { ...world, physics: null },
    { ...world, physics: { ...world.physics, environment: null } },
    { ...world, physics: { ...world.physics, environment: { ...world.physics.environment, blockAt: 1 } } },
    { ...world, physics: { ...world.physics, blockPropertiesAt: null } },
    {
      ...world,
      physics: {
        ...world.physics,
        environment: { ...world.physics.environment, blockShapeAt: 'not-callable' },
      },
    },
    { ...world, physics: { ...world.physics, blockShapeAt: 1 } },
    { ...world, physics: { ...world.physics, bouncinessAt: false } },
  ]

  for (const invalidWorld of invalidPhysicsWorlds) {
    expectInputFailure({ mobs: [state], world: invalidWorld }, 'invalid-world')
  }
  expectInputFailure(invalidMobBatch, 'invalid-batch')

  const invalidNumberDecoded = Schema.decodeUnknownResult(Sim.MobMovementTickResultSchema, { onExcessProperty: 'error' })(invalidNumber)
  expect(invalidNumberDecoded._tag).toBe('Success')
  if (invalidNumberDecoded._tag === 'Success') {
    expect(invalidNumberDecoded.success).toStrictEqual({
      _tag: 'MobMovementCompleted',
      outcomes: [{
        _tag: 'MobStepFailed',
        failure: { _tag: 'MobMovementInputFailure', index: NonNegativeTickCount(0), reason: 'invalid-request' },
      }],
      searchesPerformed: NonNegativeTickCount(0),
      expandedNodes: NonNegativeTickCount(0),
    })
  }

  expectInputFailure(excessBatchKey, 'invalid-batch')

  const explicitlyUndefinedSetting = Schema.decodeUnknownResult(Sim.MobMovementSettingsSchema, { onExcessProperty: 'error' })({
    movementSpeed: undefined,
  })
  expect(explicitlyUndefinedSetting._tag).toBe('Failure')

  for (const input of invalidSettingsInputs) {
    const value = invoke(Sim.stepMobMovementsForTick, [input])
    const decoded = Schema.decodeUnknownResult(Sim.MobMovementTickResultSchema, { onExcessProperty: 'error' })(value)
    expect(decoded._tag).toBe('Success')
    if (decoded._tag === 'Success') {
      expect(decoded.success).toStrictEqual({
        _tag: 'MobMovementRejected',
        failure: { _tag: 'MobMovementInputFailure', index: NonNegativeTickCount(0), reason: 'invalid-settings' },
      })
    }
  }

  fc.assert(
    fc.property(hostileValue, (hostile) => {
      const result = invoke(Sim.stepMobMovementsForTick, [hostile])
      const decoded = Schema.decodeUnknownResult(Sim.MobMovementTickResultSchema, { onExcessProperty: 'error' })(result)
      expect(decoded._tag, 'mob movement result Schema').toBe('Success')
    }),
    { numRuns: 40, seed: 0x534d3301 },
  )

  fc.assert(
    fc.property(hostileNumber, (x) => {
      const value = invoke(Sim.stepMobMovementsForTick, [{
        mobs: [{ ...state, body: { ...state.body, x } }],
        world,
      }])
      const decoded = Schema.decodeUnknownResult(Sim.MobMovementTickResultSchema, { onExcessProperty: 'error' })(value)
      expect(decoded._tag, 'hostile body coordinate result Schema').toBe('Success')
    }),
    { numRuns: 40, seed: 0x534d3302 },
  )
})
