import { BlockAxis, NonNegativeTickCount } from '@nerima-games/mc-kernel'
import { BlockLength } from '@nerima-games/mc-physics'
import { Result, Schema } from 'effect'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import {
  DEFAULT_MOB_PATHFINDING_SETTINGS,
  MobPathFailureSchema,
  MobPathOutcomeSchema,
  MobPathProfileSchema,
  MobPathRequestSchema,
  MobPathfindingSettingsSchema,
  MobPathTickPlanSchema,
  planMobPathsForTick,
  type MobPathTickPlan,
  type MobPathCell,
  type MobPathProfile,
  type MobPathWorldPort,
} from '../src/domain/mob-pathfinding.js'
import { hostileValue, invoke } from './public-property-helpers.js'

const cell = (x: number, y: number, z: number): MobPathCell => ({
  x: BlockAxis(x),
  y: BlockAxis(y),
  z: BlockAxis(z),
})

const ground = (width = 0.6, height = 1.8, canJump = true): MobPathProfile => ({
  kind: 'ground',
  width: BlockLength(width),
  height: BlockLength(height),
  canJump,
})

const spider: MobPathProfile = {
  kind: 'spider',
  width: BlockLength(0.8),
  height: BlockLength(0.9),
}

type Bounds = Readonly<{ minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }>
type Hazard = Readonly<{ cell: MobPathCell; kind: 'water' | 'lava' | 'cactus' | 'fire' }>

const positionKey = (x: number, y: number, z: number): string => `${x},${y},${z}`

const world = (options: {
  readonly bounds?: Bounds
  readonly solids?: ReadonlyArray<MobPathCell>
  readonly hazards?: ReadonlyArray<Hazard>
} = {}): MobPathWorldPort => {
  const solids = new Set((options.solids ?? []).map(({ x, y, z }) => positionKey(x, y, z)))
  const hazards = new Map((options.hazards ?? []).map(({ cell: position, kind }) => [positionKey(position.x, position.y, position.z), kind]))
  const inBounds = ({ x, y, z }: MobPathCell): boolean => {
    const bounds = options.bounds
    return bounds === undefined || (
      x >= bounds.minX && x <= bounds.maxX &&
      y >= bounds.minY && y <= bounds.maxY &&
      z >= bounds.minZ && z <= bounds.maxZ
    )
  }

  return {
    isPassable: (position) => inBounds(position) && !solids.has(positionKey(position.x, position.y, position.z)),
    hasSupport: (position) => inBounds(position) && (
      position.y === 0 || solids.has(positionKey(position.x, position.y, position.z))
    ),
    hazardAt: (position) => hazards.get(positionKey(position.x, position.y, position.z)) ?? null,
  }
}

const uniformWorld: MobPathWorldPort = {
  isPassable: () => true,
  hasSupport: () => true,
  hazardAt: () => null,
}

const decodePlan = (value: unknown): void => {
  const decoded = Schema.decodeUnknownResult(MobPathTickPlanSchema, { onExcessProperty: 'error' })(value)
  expect(Result.isSuccess(decoded)).toBe(true)
}

const planned = (result: ReturnType<typeof planMobPathsForTick>): Extract<MobPathTickPlan, { _tag: 'MobPathsPlanned' }> | undefined => {
  expect(result._tag).toBe('MobPathsPlanned')
  return result._tag === 'MobPathsPlanned' ? result : undefined
}

it('finds a deterministic route and keeps the fixed tie order', () => {
  const result = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(1, 1, 1), profile: ground() }],
    world: world({ bounds: { minX: 0, maxX: 1, minY: 0, maxY: 3, minZ: 0, maxZ: 1 } }),
  }))
  expect(result).toBeDefined()
  if (result === undefined) return
  const outcome = result.outcomes[0]
  expect(outcome?._tag).toBe('PathFound')
  if (outcome?._tag !== 'PathFound') return
  expect(outcome.path.map(({ x, y, z }) => [x, y, z])).toEqual([[0, 1, 0], [1, 1, 0], [1, 1, 1]])
  decodePlan(result)
})

it('steps up exactly one grid block and rejects a two-block grid rise', () => {
  const limits = { minX: 0, maxX: 1, minY: 0, maxY: 4, minZ: 0, maxZ: 0 }
  const oneBlockRise = { targetY: 2, solids: [cell(1, 1, 0)] }
  const exactStep = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(1, oneBlockRise.targetY, 0), profile: ground() }],
    world: world({ bounds: limits, solids: oneBlockRise.solids }),
  }))
  if (exactStep === undefined) return
  const exactOutcome = exactStep.outcomes[0]
  expect(exactOutcome?._tag).toBe('PathFound')
  if (exactOutcome?._tag === 'PathFound') expect(exactOutcome.path[1]?.action).toBe('jump')

  const twoBlockRise = { targetY: 3, solids: [cell(1, 1, 0), cell(1, 2, 0)] }
  const tooHigh = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(1, twoBlockRise.targetY, 0), profile: ground() }],
    world: world({ bounds: limits, solids: twoBlockRise.solids }),
  }))
  if (tooHigh === undefined) return
  expect(tooHigh.outcomes[0]).toEqual({ _tag: 'PathFailed', failure: { _tag: 'NoPath' } })

  const cannotJump = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(1, 2, 0), profile: ground(0.6, 1.8, false) }],
    world: world({ bounds: limits, solids: oneBlockRise.solids }),
  }))
  if (cannotJump === undefined) return
  expect(cannotJump.outcomes[0]).toEqual({ _tag: 'PathFailed', failure: { _tag: 'NoPath' } })
})

it('allows a three-block fall and rejects a four-block fall', () => {
  const start = cell(0, 5, 0)
  const threeBlockFall = planned(planMobPathsForTick({
    requests: [{ start, goal: cell(1, 2, 0), profile: ground() }],
    world: world({
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 7, minZ: 0, maxZ: 0 },
      solids: [cell(0, 4, 0), cell(1, 1, 0)],
    }),
  }))
  if (threeBlockFall === undefined) return
  const threeOutcome = threeBlockFall.outcomes[0]
  expect(threeOutcome?._tag).toBe('PathFound')
  if (threeOutcome?._tag === 'PathFound') expect(threeOutcome.path[1]?.action).toBe('fall')

  const fourBlockFall = planned(planMobPathsForTick({
    requests: [{ start, goal: cell(1, 1, 0), profile: ground() }],
    world: world({
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 7, minZ: 0, maxZ: 0 },
      solids: [cell(0, 4, 0)],
    }),
  }))
  if (fourBlockFall === undefined) return
  expect(fourBlockFall.outcomes[0]).toEqual({ _tag: 'PathFailed', failure: { _tag: 'NoPath' } })
})

it('uses mob width to reject a one-block corridor only when the body does not fit', () => {
  const walls = [
    cell(1, 1, -1), cell(1, 2, -1), cell(1, 1, 1), cell(1, 2, 1),
  ]
  const corridorWorld = world({
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 3, minZ: -1, maxZ: 1 },
    solids: walls,
  })
  const narrow = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(2, 1, 0), profile: ground(0.9) }],
    world: corridorWorld,
  }))
  if (narrow === undefined) return
  expect(narrow.outcomes[0]?._tag).toBe('PathFound')

  const wide = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(2, 1, 0), profile: ground(1.1) }],
    world: corridorWorld,
  }))
  if (wide === undefined) return
  expect(wide.outcomes[0]).toEqual({ _tag: 'PathFailed', failure: { _tag: 'NoPath' } })
})

it('bounds profile dimensions at 8 blocks for bounded per-node world queries', () => {
  const exactMaximum = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(0, 1, 0), profile: ground(8, 8) }],
    world: world(),
  }))
  if (exactMaximum === undefined) return
  expect(exactMaximum.outcomes[0]?._tag).toBe('PathFound')
  expect(Result.isSuccess(Schema.decodeUnknownResult(MobPathProfileSchema, { onExcessProperty: 'error' })(ground(8, 8))))
    .toBe(true)

  const tooWide = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(0, 1, 0), profile: ground(8.001, 1.8) }],
    world: world(),
  }))
  if (tooWide === undefined) return
  expect(tooWide.outcomes[0]).toEqual({
    _tag: 'PathFailed',
    failure: { _tag: 'InvalidInput', field: 'profile' },
  })

  const tooTall = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(0, 1, 0), profile: ground(0.6, 8.001) }],
    world: world(),
  }))
  if (tooTall === undefined) return
  expect(tooTall.outcomes[0]).toEqual({
    _tag: 'PathFailed',
    failure: { _tag: 'InvalidInput', field: 'profile' },
  })
  expect(Result.isFailure(Schema.decodeUnknownResult(MobPathProfileSchema, { onExcessProperty: 'error' })(ground(0.6, 8.001))))
    .toBe(true)
})

it('routes around water, lava, cactus, and fire', () => {
  const hazardKinds: ReadonlyArray<'water' | 'lava' | 'cactus' | 'fire'> = ['water', 'lava', 'cactus', 'fire']
  for (const kind of hazardKinds) {
    const result = planned(planMobPathsForTick({
      requests: [{ start: cell(0, 1, 0), goal: cell(2, 1, 0), profile: ground() }],
      world: world({
        bounds: { minX: 0, maxX: 2, minY: 0, maxY: 3, minZ: 0, maxZ: 1 },
        hazards: [{ cell: cell(1, 1, 0), kind }],
      }),
    }))
    if (result === undefined) return
    const outcome = result.outcomes[0]
    expect(outcome?._tag, kind).toBe('PathFound')
    if (outcome?._tag === 'PathFound') {
      expect(outcome.path.some((step) => step.x === 1 && step.z === 0)).toBe(false)
    }
  }
})

it('lets spiders climb a wall and excludes swimmers and flyers by tagged failure', () => {
  const wall = [cell(1, 1, 0), cell(1, 2, 0), cell(1, 3, 0)]
  const boundedWorld = world({
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 6, minZ: 0, maxZ: 0 },
    solids: wall,
  })
  const spiderResult = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(2, 1, 0), profile: spider }],
    world: boundedWorld,
  }))
  expect(spiderResult).toBeDefined()
  if (spiderResult === undefined) return
  const spiderOutcome = spiderResult.outcomes[0]
  expect(spiderOutcome?._tag).toBe('PathFound')
  if (spiderOutcome?._tag === 'PathFound') expect(spiderOutcome.path.some((step) => step.action === 'climb')).toBe(true)

  const unsupported = planned(planMobPathsForTick({
    requests: [
      { start: cell(0, 1, 0), goal: cell(1, 1, 0), profile: { kind: 'swimmer', width: BlockLength(0.8), height: BlockLength(0.8) } },
      { start: cell(0, 1, 0), goal: cell(1, 1, 0), profile: { kind: 'flyer', width: BlockLength(0.8), height: BlockLength(0.8) } },
    ],
    world: boundedWorld,
  }))
  if (unsupported === undefined) return
  expect(unsupported.outcomes).toEqual([
    { _tag: 'PathFailed', failure: { _tag: 'UnsupportedProfile', kind: 'swimmer' } },
    { _tag: 'PathFailed', failure: { _tag: 'UnsupportedProfile', kind: 'flyer' } },
  ])
})

it('distinguishes no path from search-node and per-tick budgets', () => {
  const corridor = world({ bounds: { minX: 0, maxX: 4, minY: 0, maxY: 3, minZ: 0, maxZ: 0 } })
  const nodeLimited = planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(4, 1, 0), profile: ground() }],
    world: corridor,
    settings: {
      ...DEFAULT_MOB_PATHFINDING_SETTINGS,
      maxNodesPerSearch: NonNegativeTickCount(1),
    },
  })
  const nodeLimitedPlan = planned(nodeLimited)
  if (nodeLimitedPlan === undefined) return
  const nodeOutcome = nodeLimitedPlan.outcomes[0]
  expect(nodeOutcome).toEqual({
    _tag: 'PathFailed',
    failure: { _tag: 'NodeBudgetExhausted', maxNodes: 1, expandedNodes: 1 },
  })

  const noRoute = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(2, 1, 0), profile: ground() }],
    world: world({
      bounds: { minX: 0, maxX: 2, minY: 0, maxY: 3, minZ: 0, maxZ: 0 },
      solids: [cell(1, 1, 0), cell(1, 2, 0)],
    }),
  }))
  if (noRoute === undefined) return
  expect(noRoute.outcomes[0]).toEqual({ _tag: 'PathFailed', failure: { _tag: 'NoPath' } })

  const crowd = planned(planMobPathsForTick({
    requests: Array.from({ length: 100 }, () => ({ start: cell(0, 1, 0), goal: cell(0, 1, 0), profile: ground() })),
    world: corridor,
  }))
  if (crowd === undefined) return
  expect(crowd.searchesPerformed).toBe(8)
  expect(crowd.nextSearchCursor).toBe(8)
  expect(crowd.outcomes.filter((outcome) => outcome._tag === 'PathFound')).toHaveLength(8)
  expect(crowd.outcomes.slice(8).every((outcome) =>
    outcome._tag === 'PathFailed' && outcome.failure._tag === 'TickBudgetExhausted'))
    .toBe(true)
  expect(crowd.expandedNodes).toBeLessThanOrEqual(8 * DEFAULT_MOB_PATHFINDING_SETTINGS.maxNodesPerSearch)
})

it('returns typed failures for NaN coordinates, negative dimensions, zero budgets, and malformed request entries', () => {
  const baseWorld = world()
  const invalidCoordinate = invoke(planMobPathsForTick, [{
    requests: [{ start: { x: Number.NaN, y: 1, z: 0 }, goal: cell(1, 1, 0), profile: ground() }],
    world: baseWorld,
  }])
  decodePlan(invalidCoordinate)
  const decodedCoordinate = Schema.decodeUnknownResult(MobPathTickPlanSchema, { onExcessProperty: 'error' })(invalidCoordinate)
  expect(Result.isSuccess(decodedCoordinate)).toBe(true)
  if (Result.isSuccess(decodedCoordinate) && decodedCoordinate.success._tag === 'MobPathsPlanned') {
    expect(decodedCoordinate.success.outcomes[0]).toEqual({
      _tag: 'PathFailed',
      failure: { _tag: 'InvalidInput', field: 'start' },
    })
  }

  const negativeDimension = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(1, 1, 0), profile: ground(-0.1) }],
    world: baseWorld,
  }))
  if (negativeDimension === undefined) return
  expect(negativeDimension.outcomes[0]).toEqual({
    _tag: 'PathFailed',
    failure: { _tag: 'InvalidInput', field: 'profile' },
  })

  const zeroBudget = planMobPathsForTick({
    requests: [],
    world: baseWorld,
    settings: {
      ...DEFAULT_MOB_PATHFINDING_SETTINGS,
      maxSearchesPerTick: NonNegativeTickCount(0),
    },
  })
  expect(zeroBudget).toEqual({ _tag: 'InvalidMobPathfindingSettings', field: 'maxSearchesPerTick' })

  const zeroNodeBudget = planMobPathsForTick({
    requests: [],
    world: baseWorld,
    settings: {
      ...DEFAULT_MOB_PATHFINDING_SETTINGS,
      maxNodesPerSearch: NonNegativeTickCount(0),
    },
  })
  expect(zeroNodeBudget).toEqual({ _tag: 'InvalidMobPathfindingSettings', field: 'maxNodesPerSearch' })

  const excessiveFallLimit = planMobPathsForTick({
    requests: [],
    world: baseWorld,
    settings: {
      ...DEFAULT_MOB_PATHFINDING_SETTINGS,
      maxFallDistance: BlockAxis(17),
    },
  })
  expect(excessiveFallLimit).toEqual({ _tag: 'InvalidMobPathfindingSettings', field: 'maxFallDistance' })
  expect(Result.isSuccess(Schema.decodeUnknownResult(MobPathfindingSettingsSchema, { onExcessProperty: 'error' })(DEFAULT_MOB_PATHFINDING_SETTINGS)))
    .toBe(true)

  const explicitUndefinedSettings = invoke(planMobPathsForTick, [{
    requests: [],
    world: baseWorld,
    settings: undefined,
  }])
  decodePlan(explicitUndefinedSettings)
  expect(explicitUndefinedSettings).toEqual({ _tag: 'InvalidMobPathfindingSettings', field: 'settings' })

  const explicitNullSettings = invoke(planMobPathsForTick, [{
    requests: [],
    world: baseWorld,
    settings: null,
  }])
  decodePlan(explicitNullSettings)
  expect(explicitNullSettings).toEqual({ _tag: 'InvalidMobPathfindingSettings', field: 'settings' })

  const malformedRequest = invoke(planMobPathsForTick, [{ requests: [null], world: baseWorld }])
  decodePlan(malformedRequest)
  const decodedFailure = Schema.decodeUnknownResult(MobPathFailureSchema)({ _tag: 'InvalidInput', field: 'request' })
  expect(Result.isSuccess(decodedFailure)).toBe(true)
  expect(Schema.decodeUnknownResult(MobPathOutcomeSchema)({
    _tag: 'PathFailed',
    failure: { _tag: 'InvalidInput', field: 'request' },
  })._tag).toBe('Success')
})

it('returns typed failures for malformed public input, goal, profile, and aggregate settings', () => {
  const invalidRoot = invoke(planMobPathsForTick, [{ requests: [], world: world(), extra: true }])
  decodePlan(invalidRoot)
  expect(invalidRoot).toEqual({ _tag: 'InvalidMobPathfindingInput', field: 'input' })

  const invalidRequests = invoke(planMobPathsForTick, [{ requests: null, world: world() }])
  decodePlan(invalidRequests)
  expect(invalidRequests).toEqual({ _tag: 'InvalidMobPathfindingInput', field: 'requests' })

  const invalidSearchCursor = invoke(planMobPathsForTick, [{
    requests: [],
    world: world(),
    searchCursor: -1,
  }])
  decodePlan(invalidSearchCursor)
  expect(invalidSearchCursor).toEqual({ _tag: 'InvalidMobPathfindingInput', field: 'searchCursor' })

  const invalidWorld = invoke(planMobPathsForTick, [{
    requests: [],
    world: { isPassable: () => true, hasSupport: () => true },
  }])
  decodePlan(invalidWorld)
  expect(invalidWorld).toEqual({ _tag: 'InvalidMobPathfindingInput', field: 'world' })

  const invalidGoal = invoke(planMobPathsForTick, [{
    requests: [{ start: cell(0, 1, 0), goal: { x: 1, y: 1.5, z: 0 }, profile: ground() }],
    world: world(),
  }])
  decodePlan(invalidGoal)
  expect(invalidGoal).toEqual({
    _tag: 'MobPathsPlanned',
    outcomes: [{ _tag: 'PathFailed', failure: { _tag: 'InvalidInput', field: 'goal' } }],
    searchesPerformed: 0,
    expandedNodes: 0,
    nextSearchCursor: 0,
  })

  const invalidProfileKind = invoke(planMobPathsForTick, [{
    requests: [{
      start: cell(0, 1, 0),
      goal: cell(1, 1, 0),
      profile: { kind: 'unknown', width: 0.6, height: 0.9 },
    }],
    world: world(),
  }])
  decodePlan(invalidProfileKind)
  expect(invalidProfileKind).toEqual({
    _tag: 'MobPathsPlanned',
    outcomes: [{ _tag: 'PathFailed', failure: { _tag: 'InvalidInput', field: 'profile' } }],
    searchesPerformed: 0,
    expandedNodes: 0,
    nextSearchCursor: 0,
  })

  const aggregateBudgetOverflow = invoke(planMobPathsForTick, [{
    requests: [],
    world: world(),
    settings: {
      maxNodesPerSearch: Number.MAX_SAFE_INTEGER,
      maxSearchesPerTick: 2,
      maxFallDistance: 3,
    },
  }])
  decodePlan(aggregateBudgetOverflow)
  expect(aggregateBudgetOverflow).toEqual({
    _tag: 'InvalidMobPathfindingSettings',
    field: 'maxNodesPerSearch',
  })
})

it('handles safe-integer movement bounds with typed no-path results', () => {
  const overflowingBody = planMobPathsForTick({
    requests: [{
      start: cell(0, Number.MAX_SAFE_INTEGER, 0),
      goal: cell(0, Number.MAX_SAFE_INTEGER, 0),
      profile: ground(0.6, 1.8),
    }],
    world: uniformWorld,
  })
  decodePlan(overflowingBody)
  expect(overflowingBody._tag).toBe('MobPathsPlanned')
  if (overflowingBody._tag === 'MobPathsPlanned') {
    expect(overflowingBody.outcomes[0]).toEqual({
      _tag: 'PathFailed',
      failure: { _tag: 'NoPath' },
    })
  }

  const underflowingLanding = planMobPathsForTick({
    requests: [{
      start: cell(0, Number.MIN_SAFE_INTEGER, 0),
      goal: cell(1, Number.MIN_SAFE_INTEGER, 0),
      profile: ground(0.6, 0.5, false),
    }],
    world: uniformWorld,
  })
  decodePlan(underflowingLanding)
  expect(underflowingLanding._tag).toBe('MobPathsPlanned')
  if (underflowingLanding._tag === 'MobPathsPlanned') {
    expect(underflowingLanding.outcomes[0]).toEqual({
      _tag: 'PathFailed',
      failure: { _tag: 'NoPath' },
    })
  }

  const minimumAxisStep = planMobPathsForTick({
    requests: [{
      start: cell(Number.MIN_SAFE_INTEGER, 1, 0),
      goal: cell(Number.MIN_SAFE_INTEGER + 1, 1, 0),
      profile: ground(0.6, 0.5, false),
    }],
    world: uniformWorld,
  })
  decodePlan(minimumAxisStep)
  expect(minimumAxisStep._tag).toBe('MobPathsPlanned')
  if (minimumAxisStep._tag === 'MobPathsPlanned') {
    expect(minimumAxisStep.outcomes[0]?._tag).toBe('PathFound')
  }
})

it('keeps spider movement grounded when there is no clearance above its current cell', () => {
  const overheadBlockedWorld = world({
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 3, minZ: 0, maxZ: 0 },
    solids: [cell(0, 2, 0)],
  })
  const result = planned(planMobPathsForTick({
    requests: [{ start: cell(0, 1, 0), goal: cell(1, 1, 0), profile: spider }],
    world: overheadBlockedWorld,
  }))
  expect(result).toBeDefined()
  if (result === undefined) return
  const outcome = result.outcomes[0]
  expect(outcome?._tag).toBe('PathFound')
  if (outcome?._tag === 'PathFound') {
    expect(outcome.path.some((step) => step.action === 'climb')).toBe(false)
  }
})

it('compares equal-priority alternatives by X and Y before preserving route order', () => {
  const rowWorld: MobPathWorldPort = {
    isPassable: ({ z }) => z === 0,
    hasSupport: ({ z }) => z === 0,
    hazardAt: () => null,
  }
  const sameRowTie = planned(planMobPathsForTick({
    requests: [{ start: cell(2, 1, 0), goal: cell(2, 2, 0), profile: ground(0.6, 0.5, true) }],
    world: rowWorld,
  }))
  expect(sameRowTie).toBeDefined()
  if (sameRowTie === undefined) return
  decodePlan(sameRowTie)
  const sameRowOutcome = sameRowTie.outcomes[0]
  expect(sameRowOutcome?._tag).toBe('PathFound')
  if (sameRowOutcome?._tag === 'PathFound') {
    expect(sameRowOutcome.path.map(({ x, y, z, action }) => [x, y, z, action])).toEqual([
      [2, 1, 0, 'start'],
      [1, 1, 0, 'walk'],
      [2, 2, 0, 'jump'],
    ])
  }

  const sameColumnTie = planned(planMobPathsForTick({
    requests: [{ start: cell(2, 2, 0), goal: cell(4, 2, 0), profile: ground(0.6, 0.5, true) }],
    world: rowWorld,
  }))
  expect(sameColumnTie).toBeDefined()
  if (sameColumnTie === undefined) return
  decodePlan(sameColumnTie)
  const sameColumnOutcome = sameColumnTie.outcomes[0]
  expect(sameColumnOutcome?._tag).toBe('PathFound')
  if (sameColumnOutcome?._tag === 'PathFound') {
    expect(sameColumnOutcome.path.map(({ x, y, z, action }) => [x, y, z, action])).toEqual([
      [2, 2, 0, 'start'],
      [3, 2, 0, 'walk'],
      [4, 2, 0, 'walk'],
    ])
  }
})

it('rejects excess request and settings fields and unknown tags at strict schema boundaries', () => {
  const baseWorld = world()
  const requestWithExtraField = {
    start: cell(0, 1, 0),
    goal: cell(1, 1, 0),
    profile: ground(),
    extra: true,
  }
  const decodedExtraRequest = Schema.decodeUnknownResult(MobPathRequestSchema, {
    onExcessProperty: 'error',
  })(requestWithExtraField)
  expect(Result.isFailure(decodedExtraRequest)).toBe(true)

  const extraRequestPlan = invoke(planMobPathsForTick, [{
    requests: [requestWithExtraField],
    world: baseWorld,
  }])
  decodePlan(extraRequestPlan)
  expect(extraRequestPlan).toEqual({
    _tag: 'MobPathsPlanned',
    outcomes: [{ _tag: 'PathFailed', failure: { _tag: 'InvalidInput', field: 'request' } }],
    searchesPerformed: 0,
    expandedNodes: 0,
    nextSearchCursor: 0,
  })

  const profileWithUnknownTag = { ...ground(), _tag: 'UnknownProfile' }
  const decodedUnknownProfileTag = Schema.decodeUnknownResult(MobPathProfileSchema, {
    onExcessProperty: 'error',
  })(profileWithUnknownTag)
  expect(Result.isFailure(decodedUnknownProfileTag)).toBe(true)
  const unknownProfileTagPlan = invoke(planMobPathsForTick, [{
    requests: [{ start: cell(0, 1, 0), goal: cell(1, 1, 0), profile: profileWithUnknownTag }],
    world: baseWorld,
  }])
  decodePlan(unknownProfileTagPlan)
  expect(unknownProfileTagPlan).toEqual({
    _tag: 'MobPathsPlanned',
    outcomes: [{ _tag: 'PathFailed', failure: { _tag: 'InvalidInput', field: 'request' } }],
    searchesPerformed: 0,
    expandedNodes: 0,
    nextSearchCursor: 0,
  })

  const settingsWithExtraField = { ...DEFAULT_MOB_PATHFINDING_SETTINGS, extra: true }
  const decodedExtraSettings = Schema.decodeUnknownResult(MobPathfindingSettingsSchema, {
    onExcessProperty: 'error',
  })(settingsWithExtraField)
  expect(Result.isFailure(decodedExtraSettings)).toBe(true)
  const extraSettingsPlan = invoke(planMobPathsForTick, [{
    requests: [],
    world: baseWorld,
    settings: settingsWithExtraField,
  }])
  decodePlan(extraSettingsPlan)
  expect(extraSettingsPlan).toEqual({ _tag: 'InvalidMobPathfindingSettings', field: 'settings' })

  const decodedUnknownOutcomeTag = Schema.decodeUnknownResult(MobPathOutcomeSchema, {
    onExcessProperty: 'error',
  })({ _tag: 'UnknownOutcome' })
  expect(Result.isFailure(decodedUnknownOutcomeTag)).toBe(true)
})

const independentFootprint = (position: MobPathCell, profile: MobPathProfile): ReadonlyArray<MobPathCell> => {
  const half = profile.width / 2
  const lowX = Math.floor(position.x + 0.5 - half + 1e-10)
  const highX = Math.floor(position.x + 0.5 + half - 1e-10)
  const lowZ = Math.floor(position.z + 0.5 - half + 1e-10)
  const highZ = Math.floor(position.z + 0.5 + half - 1e-10)
  const result: Array<MobPathCell> = []
  for (let x = lowX; x <= highX; x += 1) {
    for (let z = lowZ; z <= highZ; z += 1) result.push(cell(x, position.y, z))
  }
  return result
}

const independentlyClear = (position: MobPathCell, profile: MobPathProfile, port: MobPathWorldPort): boolean => {
  const feet = independentFootprint(position, profile)
  return feet.length > 0 && feet.every((base) => {
    for (let vertical = 0; vertical < Math.ceil(profile.height); vertical += 1) {
      const occupied = cell(base.x, base.y + vertical, base.z)
      if (!port.isPassable(occupied) || port.hazardAt(occupied) !== null) return false
    }
    return true
  })
}

const independentlySupported = (position: MobPathCell, profile: MobPathProfile, port: MobPathWorldPort): boolean =>
  independentFootprint(position, profile).every((base) => {
    const below = cell(base.x, base.y - 1, base.z)
    return port.hasSupport(below) && port.hazardAt(below) === null
  })

const assertPathUsesLegalGroundEdges = (
  path: ReadonlyArray<Readonly<{ x: BlockAxis; y: BlockAxis; z: BlockAxis; action: string }>>,
  profile: MobPathProfile,
  port: MobPathWorldPort,
): void => {
  for (let index = 0; index < path.length; index += 1) {
    const step = path[index]
    expect(step).toBeDefined()
    if (step === undefined) continue
    const current = step
    expect(independentlyClear(current, profile, port)).toBe(true)
    if (index > 0) expect(independentlySupported(current, profile, port)).toBe(true)
    if (index === 0) continue

    const previous = path[index - 1]
    if (previous === undefined) continue
    const horizontal = Math.abs(current.x - previous.x) + Math.abs(current.z - previous.z)
    const rise = current.y - previous.y
    if (current.action === 'walk') {
      expect(horizontal).toBe(1)
      expect(rise).toBe(0)
    } else if (current.action === 'jump') {
      expect(horizontal).toBe(1)
      expect(rise).toBe(1)
      expect(profile.kind === 'ground' && profile.canJump).toBe(true)
    } else if (current.action === 'fall') {
      expect(horizontal).toBe(1)
      expect(rise).toBeLessThan(0)
      expect(rise).toBeGreaterThanOrEqual(-3)
      for (let offset = 1; offset <= -rise; offset += 1) {
        const alongFall = cell(current.x, previous.y - offset, current.z)
        expect(independentlyClear(alongFall, profile, port)).toBe(true)
      }
    } else {
      expect(profile.kind).toBe('spider')
    }
  }
}

it('returns schema-valid paths whose generated edges independently satisfy the movement rules', async () => {
  const solidPositions = fc.array(
    fc.tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 2 }), fc.integer({ min: 0, max: 2 })),
    { maxLength: 12 },
  )
  const generatedWorlds = fc.record({
    solids: solidPositions,
    hazardShift: fc.integer({ min: 0, max: 1 }),
  })

  await fc.assert(fc.property(generatedWorlds, ({ solids: positions, hazardShift }) => {
    const solids = positions.map(([x, y, z]) => cell(x, y, z))
    const hazards: ReadonlyArray<Hazard> = [
      { cell: cell(1 + hazardShift, 1, 0), kind: 'water' },
      { cell: cell(2 + hazardShift, 1, 2), kind: 'lava' },
      { cell: cell(3 - hazardShift, 1, 1), kind: 'cactus' },
      { cell: cell(1 + hazardShift, 2, 2), kind: 'fire' },
    ]
    expect(hazards.map(({ kind }) => kind)).toEqual(['water', 'lava', 'cactus', 'fire'])
    const port = world({
      bounds: { minX: 0, maxX: 4, minY: 0, maxY: 4, minZ: 0, maxZ: 2 },
      solids,
      hazards,
    })
    const start = cell(0, 1, 1)
    const goal = cell(4, 1, 1)
    const profile = ground(0.8, 1.8)
    const result = planMobPathsForTick({ requests: [{ start, goal, profile }], world: port })
    decodePlan(result)
    if (result._tag !== 'MobPathsPlanned') return
    const outcome = result.outcomes[0]
    if (outcome?._tag !== 'PathFound') return
    const decodedOutcome = Schema.decodeUnknownResult(MobPathOutcomeSchema, { onExcessProperty: 'error' })(outcome)
    expect(Result.isSuccess(decodedOutcome)).toBe(true)
    expect(outcome.path[0]).toMatchObject({ x: start.x, y: start.y, z: start.z, action: 'start' })
    expect(outcome.path.at(-1)).toMatchObject({ x: goal.x, y: goal.y, z: goal.z })
    assertPathUsesLegalGroundEdges(outcome.path, profile, port)
  }), { numRuns: 100 })
})

it('returns a schema-decodable tagged result for arbitrary hostile public inputs without throwing', async () => {
  await fc.assert(fc.property(hostileValue, (value) => {
    const output = invoke(planMobPathsForTick, [value])
    const decoded = Schema.decodeUnknownResult(MobPathTickPlanSchema, { onExcessProperty: 'error' })(output)
    expect(Result.isSuccess(decoded)).toBe(true)
  }), { numRuns: 100 })
})
