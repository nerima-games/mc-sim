import { BlockAxis, EntityIdSchema, NonNegativeTickCount, type EntityId } from '@nerima-games/mc-kernel'
import * as Physics from '@nerima-games/mc-physics'
import { Brand, Result, Schema } from 'effect'
import {
  DEFAULT_MOB_PATHFINDING_SETTINGS,
  MobPathCellSchema,
  MobPathFailureSchema,
  MobPathProfileSchema,
  MobPathStepSchema,
  planMobPathsForTick,
  type MobPathCell,
  type MobPathFailure,
  type MobPathProfile,
  type MobPathStep,
  type MobPathWorldPort,
  type MobPathfindingSettings,
} from '../domain/mob-pathfinding.js'

const TickCountSchema: Schema.Codec<NonNegativeTickCount, number> = Schema.Int.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
).pipe(Schema.brand('NonNegativeTickCount'))

const PositiveTickCountSchema: Schema.Codec<NonNegativeTickCount, number> = Schema.Int.check(
  Schema.isGreaterThan(0),
  Schema.makeFilter(Number.isSafeInteger),
).pipe(Schema.brand('NonNegativeTickCount'))

const MovementSpeedSchema: Schema.Codec<Physics.BlocksPerSecond, number> = Schema.Finite.check(
  Schema.isGreaterThan(0),
).pipe(Schema.brand('BlocksPerSecond'))

const PositionAxisSchema = Schema.Finite.pipe(Schema.brand('PositionAxis'))
const CentreYSchema = Schema.Finite.pipe(Schema.brand('CentreY'))
const BlocksPerSecondSchema = Schema.Finite.pipe(Schema.brand('BlocksPerSecond'))
const MAX_MOB_FALL_DISTANCE = 16

const PhysicsBodySchema: Schema.Codec<Physics.Body, unknown> = Schema.Struct({
  kind: Schema.Literals(['dynamic', 'static', 'kinematic']),
  x: PositionAxisSchema,
  y: CentreYSchema,
  z: PositionAxisSchema,
  vx: BlocksPerSecondSchema,
  vy: BlocksPerSecondSchema,
  vz: BlocksPerSecondSchema,
})

export type MobMovementState = Readonly<{
  readonly id: EntityId
  readonly body: Physics.Body
  readonly profile: MobPathProfile
  readonly goal: MobPathCell
  /** Empty means that no route is cached; otherwise this starts with the origin node. */
  readonly path: ReadonlyArray<MobPathStep>
  /** Index of the next route node. It is zero only when `path` is empty. */
  readonly pathIndex: NonNegativeTickCount
  readonly stuckTicks: NonNegativeTickCount
  readonly isGrounded: boolean
}>

export type MobMovementRequest = MobMovementState

export type MobMovementWorldPort = MobPathWorldPort & Readonly<{
  readonly physics: Omit<Physics.ResolveOptions, 'halfWidth' | 'halfHeight' | 'stepHeight'>
}>

export type MobMovementSettings = Readonly<{
  readonly maxNodesPerSearch?: MobPathfindingSettings['maxNodesPerSearch']
  readonly maxSearchesPerTick?: MobPathfindingSettings['maxSearchesPerTick']
  readonly maxFallDistance?: MobPathfindingSettings['maxFallDistance']
  readonly movementSpeed?: Physics.BlocksPerSecond
  readonly jumpImpulse?: Physics.BlocksPerSecond
  readonly spiderClimbSpeed?: Physics.BlocksPerSecond
  readonly stuckThresholdTicks?: NonNegativeTickCount
}>

export type MobMovementTickInput = Readonly<{
  readonly mobs: ReadonlyArray<MobMovementRequest>
  readonly world: MobMovementWorldPort
  readonly settings?: MobMovementSettings
}>

export const DEFAULT_MOB_MOVEMENT_SETTINGS: Required<MobMovementSettings> = Object.freeze({
  ...DEFAULT_MOB_PATHFINDING_SETTINGS,
  movementSpeed: Physics.BlocksPerSecond(2),
  jumpImpulse: Physics.BlocksPerSecond(8.4),
  spiderClimbSpeed: Physics.BlocksPerSecond(2),
  stuckThresholdTicks: NonNegativeTickCount(20),
})

export const MobMovementSettingsSchema: Schema.Codec<MobMovementSettings, unknown> = Schema.Struct({
  maxNodesPerSearch: Schema.optionalKey(PositiveTickCountSchema),
  maxSearchesPerTick: Schema.optionalKey(PositiveTickCountSchema),
  maxFallDistance: Schema.optionalKey(Schema.Int.check(
    Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0 && value <= MAX_MOB_FALL_DISTANCE),
  ).pipe(Schema.brand('BlockAxis'))),
  movementSpeed: Schema.optionalKey(MovementSpeedSchema),
  jumpImpulse: Schema.optionalKey(MovementSpeedSchema),
  spiderClimbSpeed: Schema.optionalKey(MovementSpeedSchema),
  stuckThresholdTicks: Schema.optionalKey(PositiveTickCountSchema),
}).check(Schema.makeFilter((settings) => {
  const maxNodes = settings.maxNodesPerSearch ?? DEFAULT_MOB_MOVEMENT_SETTINGS.maxNodesPerSearch
  const maxSearches = settings.maxSearchesPerTick ?? DEFAULT_MOB_MOVEMENT_SETTINGS.maxSearchesPerTick
  return Number(maxNodes) * Number(maxSearches) <= Number.MAX_SAFE_INTEGER
}))

export type MobMovementFailure =
  | Readonly<{
      readonly _tag: 'MobMovementInputFailure'
      readonly index: NonNegativeTickCount
      readonly reason: 'invalid-batch' | 'invalid-request' | 'invalid-world' | 'invalid-settings'
    }>
  | Readonly<{
      readonly _tag: 'MobMovementPathFailure'
      readonly index: NonNegativeTickCount
      readonly failure: MobPathFailure
    }>
  | Readonly<{
      readonly _tag: 'MobMovementPhysicsFailure'
      readonly index: NonNegativeTickCount
      readonly reason: 'invalid-body' | 'step-body-failed'
    }>

type MobMovementInputFailureReason = 'invalid-batch' | 'invalid-request' | 'invalid-world' | 'invalid-settings'

const MobMovementFailureSchemaInternal = Schema.Union([
  Schema.TaggedStruct('MobMovementInputFailure', {
    index: TickCountSchema,
    reason: Schema.Literals(['invalid-batch', 'invalid-request', 'invalid-world', 'invalid-settings']),
  }),
  Schema.TaggedStruct('MobMovementPathFailure', {
    index: TickCountSchema,
    failure: MobPathFailureSchema,
  }),
  Schema.TaggedStruct('MobMovementPhysicsFailure', {
    index: TickCountSchema,
    reason: Schema.Literals(['invalid-body', 'step-body-failed']),
  }),
])

export const MobMovementFailureSchema: Schema.Codec<MobMovementFailure, unknown> = MobMovementFailureSchemaInternal

export const MobMovementStateSchema: Schema.Codec<MobMovementState, unknown> = Schema.Struct({
  id: EntityIdSchema,
  body: PhysicsBodySchema,
  profile: MobPathProfileSchema,
  goal: MobPathCellSchema,
  path: Schema.Array(MobPathStepSchema),
  pathIndex: TickCountSchema,
  stuckTicks: TickCountSchema,
  isGrounded: Schema.Boolean,
})

export type MobMovementOutcome =
  | Readonly<{ readonly _tag: 'MobAdvanced'; readonly state: MobMovementState; readonly reachedGoal: boolean }>
  | Readonly<{ readonly _tag: 'MobStepFailed'; readonly failure: MobMovementFailure }>

export type MobMovementTickResult =
  | Readonly<{
      readonly _tag: 'MobMovementCompleted'
      readonly outcomes: ReadonlyArray<MobMovementOutcome>
      readonly searchesPerformed: NonNegativeTickCount
      readonly expandedNodes: NonNegativeTickCount
    }>
  | Readonly<{ readonly _tag: 'MobMovementRejected'; readonly failure: MobMovementFailure }>

const MobMovementOutcomeSchema: Schema.Codec<MobMovementOutcome, unknown> = Schema.Union([
  Schema.TaggedStruct('MobAdvanced', {
    state: MobMovementStateSchema,
    reachedGoal: Schema.Boolean,
  }),
  Schema.TaggedStruct('MobStepFailed', { failure: MobMovementFailureSchema }),
])

export const MobMovementTickResultSchema: Schema.Codec<MobMovementTickResult, unknown> = Schema.Union([
  Schema.TaggedStruct('MobMovementCompleted', {
    outcomes: Schema.Array(MobMovementOutcomeSchema),
    searchesPerformed: TickCountSchema,
    expandedNodes: TickCountSchema,
  }),
  Schema.TaggedStruct('MobMovementRejected', { failure: MobMovementFailureSchema }),
])

type EffectiveSettings = Required<MobMovementSettings>
type ParsedRequest = Readonly<{ index: NonNegativeTickCount; request: MobMovementRequest; start: MobPathCell }>
type PreparedMovementRequests = Readonly<{
  requests: ReadonlyArray<ParsedRequest>
  statesByIndex: ReadonlyMap<number, MobMovementRequest>
  failures: Map<number, MobMovementFailure>
}>
type PlannedMovementPaths = Readonly<{
  pathByIndex: ReadonlyMap<number, ReadonlyArray<MobPathStep>>
  searchesPerformed: NonNegativeTickCount
  expandedNodes: NonNegativeTickCount
}>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyMovementInputKeys = (input: Readonly<Record<string, unknown>>): boolean =>
  Object.keys(input).every((key) => key === 'mobs' || key === 'world' || key === 'settings')

const isWorldPort = (value: unknown): value is MobMovementWorldPort => {
  if (!isRecord(value)) return false
  if (typeof value['isPassable'] !== 'function' || typeof value['hasSupport'] !== 'function' || typeof value['hazardAt'] !== 'function') {
    return false
  }
  const physics = value['physics']
  if (!isRecord(physics)) return false
  const environment = physics['environment']
  if (!isRecord(environment) || typeof environment['blockAt'] !== 'function') return false
  if (environment['blockShapeAt'] !== undefined && typeof environment['blockShapeAt'] !== 'function') return false
  if (typeof physics['blockPropertiesAt'] !== 'function') return false
  if (physics['blockShapeAt'] !== undefined && typeof physics['blockShapeAt'] !== 'function') return false
  return physics['bouncinessAt'] === undefined || typeof physics['bouncinessAt'] === 'function'
}

const inputFailure = (index: NonNegativeTickCount, reason: MobMovementInputFailureReason): MobMovementFailure => ({
  _tag: 'MobMovementInputFailure',
  index,
  reason,
})

const failureForIndex = (index: NonNegativeTickCount, reason: 'invalid-body' | 'step-body-failed'): MobMovementFailure => ({
  _tag: 'MobMovementPhysicsFailure',
  index,
  reason,
})

const isSupportedProfile = (profile: MobPathProfile): profile is Extract<MobPathProfile, { kind: 'ground' | 'spider' }> =>
  profile.kind === 'ground' || profile.kind === 'spider'

const isValidRequest = (request: MobMovementRequest): boolean => {
  if (request.body.kind !== 'dynamic') return false
  if (!Number.isFinite(request.body.x) || !Number.isFinite(request.body.y) || !Number.isFinite(request.body.z)) return false
  if (!Number.isFinite(request.body.vx) || !Number.isFinite(request.body.vy) || !Number.isFinite(request.body.vz)) return false
  if (!Number.isFinite(request.profile.width) || request.profile.width <= 0) return false
  if (!Number.isFinite(request.profile.height) || request.profile.height <= 0) return false
  if (request.path.length === 0) return request.pathIndex === 0
  return request.pathIndex >= 1 && request.pathIndex <= request.path.length
}

const cellForBody = (request: MobMovementRequest): Result.Result<MobPathCell, Brand.BrandError> => {
  const x = BlockAxis.result(Math.floor(request.body.x))
  const y = BlockAxis.result(Math.floor(request.body.y - request.profile.height / 2 + 1e-9))
  const z = BlockAxis.result(Math.floor(request.body.z))
  return Result.map(Result.all([x, y, z]), ([validX, validY, validZ]): MobPathCell => ({ x: validX, y: validY, z: validZ }))
}

const sameCell = (left: MobPathCell, right: MobPathCell): boolean =>
  left.x === right.x && left.y === right.y && left.z === right.z

const pathEndsAtGoal = (request: MobMovementRequest): boolean => {
  const last = request.path[request.path.length - 1]
  return last !== undefined && sameCell(last, request.goal)
}

const isNearStep = (body: Physics.Body, profile: MobPathProfile, step: MobPathStep): boolean => {
  const expectedX = step.x + 0.5
  const expectedY = step.y + profile.height / 2
  const expectedZ = step.z + 0.5
  const tolerance = Math.max(0.15, profile.width * 0.4)
  return (
    Math.abs(body.x - expectedX) <= tolerance &&
    Math.abs(body.y - expectedY) <= 0.2 &&
    Math.abs(body.z - expectedZ) <= tolerance
  )
}

const distanceToStep = (body: Physics.Body, profile: MobPathProfile, step: MobPathStep): number =>
  Math.hypot(
    step.x + 0.5 - body.x,
    step.y + profile.height / 2 - body.y,
    step.z + 0.5 - body.z,
  )

const horizontalDistanceToStep = (body: Physics.Body, step: MobPathStep): number =>
  Math.hypot(step.x + 0.5 - body.x, step.z + 0.5 - body.z)

const advancePathIndex = (request: MobMovementRequest): NonNegativeTickCount => {
  let index = request.pathIndex
  while (index < request.path.length) {
    const step = request.path[index]
    if (step === undefined || !isNearStep(request.body, request.profile, step)) break
    const next = NonNegativeTickCount.result(index + 1)
    if (Result.isFailure(next)) break
    index = next.success
  }
  return index
}

const resolveOptionsFor = (
  world: MobMovementWorldPort,
  request: MobMovementRequest,
): Result.Result<Physics.ResolveOptions, Brand.BrandError> => {
  const halfWidth = Physics.BlockLength.result(request.profile.width / 2)
  const halfHeight = Physics.HalfHeight.result(request.profile.height / 2)
  const stepHeight = Physics.BlockLength.result(1)
  return Result.map(Result.all([halfWidth, halfHeight, stepHeight]), ([validHalfWidth, validHalfHeight, validStepHeight]) => ({
    ...world.physics,
    halfWidth: validHalfWidth,
    halfHeight: validHalfHeight,
    stepHeight: validStepHeight,
  }))
}

const velocityFor = (
  request: MobMovementRequest,
  step: MobPathStep | undefined,
  settings: EffectiveSettings,
): Result.Result<Physics.Body, Brand.BrandError> => {
  if (step === undefined) {
    return Result.map(
      Result.all([
        Physics.BlocksPerSecond.result(0),
        Physics.BlocksPerSecond.result(request.body.vy),
        Physics.BlocksPerSecond.result(0),
      ]),
      ([vx, vy, vz]) => ({ ...request.body, vx, vy, vz }),
    )
  }

  const differenceX = step.x + 0.5 - request.body.x
  const differenceZ = step.z + 0.5 - request.body.z
  let vxValue: number
  let vzValue: number
  if (step.action === 'climb') {
    vxValue = step.wall.x * settings.spiderClimbSpeed
    vzValue = step.wall.z * settings.spiderClimbSpeed
  } else {
    const distance = Math.hypot(differenceX, differenceZ)
    vxValue = distance === 0 ? 0 : (differenceX / distance) * settings.movementSpeed
    vzValue = distance === 0 ? 0 : (differenceZ / distance) * settings.movementSpeed
  }

  const vyValue = step.action === 'climb'
    ? settings.spiderClimbSpeed
    : step.action === 'jump' && request.isGrounded
      ? settings.jumpImpulse
      : request.body.vy

  return Result.map(
    Result.all([
      Physics.BlocksPerSecond.result(vxValue),
      Physics.BlocksPerSecond.result(vyValue),
      Physics.BlocksPerSecond.result(vzValue),
    ]),
    ([vx, vy, vz]) => ({ ...request.body, vx, vy, vz }),
  )
}

const hasReachedGoal = (request: MobMovementRequest): boolean => {
  const end = request.path[request.path.length - 1]
  return (
    end !== undefined &&
    sameCell(end, request.goal) &&
    isNearStep(request.body, request.profile, end) &&
    request.isGrounded
  )
}

const moveOne = (
  index: NonNegativeTickCount,
  request: MobMovementRequest,
  world: MobMovementWorldPort,
  settings: EffectiveSettings,
): MobMovementOutcome => {
  const pathIndex = advancePathIndex(request)
  const nextStep = request.path[pathIndex]
  const velocity = velocityFor(request, nextStep, settings)
  if (Result.isFailure(velocity)) {
    return {
      _tag: 'MobStepFailed',
      failure: failureForIndex(index, 'invalid-body'),
    }
  }

  const options = resolveOptionsFor(world, request)
  if (Result.isFailure(options)) {
    return {
      _tag: 'MobStepFailed',
      failure: failureForIndex(index, 'invalid-body'),
    }
  }

  const stepped = Physics.stepBody(velocity.success, Physics.DeltaTimeSecs(0.05), options.success)
  if (Result.isFailure(stepped)) {
    return {
      _tag: 'MobStepFailed',
      failure: failureForIndex(index, 'step-body-failed'),
    }
  }

  const body = stepped.success.body
  const reachedGoal = hasReachedGoal({ ...request, body, pathIndex, isGrounded: stepped.success.isGrounded })
  const madeProgress = nextStep !== undefined && (nextStep.action === 'climb'
    ? distanceToStep(body, request.profile, nextStep) + 1e-9 < distanceToStep(request.body, request.profile, nextStep)
    : horizontalDistanceToStep(body, nextStep) + 1e-9 < horizontalDistanceToStep(request.body, nextStep))
  const stuckValue = reachedGoal || madeProgress ? 0 : request.stuckTicks + 1
  const stuckTicks = NonNegativeTickCount.result(stuckValue)
  const nextIndex = NonNegativeTickCount.result(pathIndex)
  if (Result.isFailure(stuckTicks) || Result.isFailure(nextIndex)) {
    return {
      _tag: 'MobStepFailed',
      failure: failureForIndex(index, 'invalid-body'),
    }
  }

  return {
    _tag: 'MobAdvanced',
    reachedGoal,
    state: {
      ...request,
      body,
      pathIndex: nextIndex.success,
      stuckTicks: stuckTicks.success,
      isGrounded: stepped.success.isGrounded,
    },
  }
}

const rejected = (failure: MobMovementFailure): MobMovementTickResult => ({
  _tag: 'MobMovementRejected',
  failure,
})

const settingsFor = (
  rawSettings: unknown,
  wasProvided: boolean,
): Result.Result<EffectiveSettings, 'invalid-settings'> => {
  if (!wasProvided) return Result.succeed(DEFAULT_MOB_MOVEMENT_SETTINGS)
  const decoded = Schema.decodeUnknownResult(MobMovementSettingsSchema, { onExcessProperty: 'error' })(rawSettings)
  if (Result.isFailure(decoded)) return Result.fail('invalid-settings')

  const settings = decoded.success
  const effective: EffectiveSettings = {
    maxNodesPerSearch: settings.maxNodesPerSearch ?? DEFAULT_MOB_MOVEMENT_SETTINGS.maxNodesPerSearch,
    maxSearchesPerTick: settings.maxSearchesPerTick ?? DEFAULT_MOB_MOVEMENT_SETTINGS.maxSearchesPerTick,
    maxFallDistance: settings.maxFallDistance ?? DEFAULT_MOB_MOVEMENT_SETTINGS.maxFallDistance,
    movementSpeed: settings.movementSpeed ?? DEFAULT_MOB_MOVEMENT_SETTINGS.movementSpeed,
    jumpImpulse: settings.jumpImpulse ?? DEFAULT_MOB_MOVEMENT_SETTINGS.jumpImpulse,
    spiderClimbSpeed: settings.spiderClimbSpeed ?? DEFAULT_MOB_MOVEMENT_SETTINGS.spiderClimbSpeed,
    stuckThresholdTicks: settings.stuckThresholdTicks ?? DEFAULT_MOB_MOVEMENT_SETTINGS.stuckThresholdTicks,
  }
  if (
    effective.maxNodesPerSearch <= 0 || effective.maxSearchesPerTick <= 0 || effective.maxFallDistance <= 0 ||
    effective.movementSpeed <= 0 || effective.jumpImpulse <= 0 || effective.spiderClimbSpeed <= 0 ||
    effective.stuckThresholdTicks <= 0
  ) {
    return Result.fail('invalid-settings')
  }
  return Result.succeed(effective)
}

const requestNeedsPath = (
  request: MobMovementRequest,
  settings: EffectiveSettings,
): boolean => {
  const lastPathStep = request.path[request.path.length - 1]
  const goalMatches = request.path.length > 0 && pathEndsAtGoal(request) && lastPathStep !== undefined && sameCell(request.goal, lastPathStep)
  const atGoal = request.path.length > 0 && hasReachedGoal(request)
  return !goalMatches || (!atGoal && request.stuckTicks >= settings.stuckThresholdTicks)
}

const prepareMovementRequests = (
  rawMobs: ReadonlyArray<unknown>,
  settings: EffectiveSettings,
  zeroIndex: NonNegativeTickCount,
): Result.Result<PreparedMovementRequests, MobMovementFailure> => {
  const requests: Array<ParsedRequest> = []
  const statesByIndex = new Map<number, MobMovementRequest>()
  const failures = new Map<number, MobMovementFailure>()

  for (let index = 0; index < rawMobs.length; index += 1) {
    const indexValue = NonNegativeTickCount.result(index)
    if (Result.isFailure(indexValue)) return Result.fail(inputFailure(zeroIndex, 'invalid-batch'))
    const decoded = Schema.decodeUnknownResult(MobMovementStateSchema, { onExcessProperty: 'error' })(rawMobs[index])
    if (Result.isFailure(decoded) || !isValidRequest(decoded.success)) {
      failures.set(index, inputFailure(indexValue.success, 'invalid-request'))
      continue
    }

    const request = decoded.success
    if (!isSupportedProfile(request.profile)) {
      failures.set(index, {
        _tag: 'MobMovementPathFailure',
        index: indexValue.success,
        failure: { _tag: 'UnsupportedProfile', kind: request.profile.kind },
      })
      continue
    }

    const currentCell = cellForBody(request)
    if (Result.isFailure(currentCell)) {
      failures.set(index, failureForIndex(indexValue.success, 'invalid-body'))
      continue
    }

    statesByIndex.set(index, request)
    if (requestNeedsPath(request, settings)) {
      requests.push({ index: indexValue.success, request, start: currentCell.success })
    }
  }

  return Result.succeed({ requests, statesByIndex, failures })
}

const planMovementPaths = (
  requests: ReadonlyArray<ParsedRequest>,
  failures: Map<number, MobMovementFailure>,
  world: MobMovementWorldPort,
  settings: EffectiveSettings,
  zeroIndex: NonNegativeTickCount,
): Result.Result<PlannedMovementPaths, MobMovementFailure> => {
  const pathByIndex = new Map<number, ReadonlyArray<MobPathStep>>()
  let searchesPerformed = NonNegativeTickCount(0)
  let expandedNodes = NonNegativeTickCount(0)
  if (requests.length === 0) {
    return Result.succeed({ pathByIndex, searchesPerformed, expandedNodes })
  }

  const plan = planMobPathsForTick({
    requests: requests.map(({ request, start }) => ({ start, goal: request.goal, profile: request.profile })),
    world,
    settings: {
      maxNodesPerSearch: settings.maxNodesPerSearch,
      maxSearchesPerTick: settings.maxSearchesPerTick,
      maxFallDistance: settings.maxFallDistance,
    },
  })
  if (plan._tag !== 'MobPathsPlanned') {
    return Result.fail(inputFailure(zeroIndex, 'invalid-settings'))
  }

  searchesPerformed = plan.searchesPerformed
  expandedNodes = plan.expandedNodes
  for (let resultIndex = 0; resultIndex < plan.outcomes.length; resultIndex += 1) {
    const parsed = requests[resultIndex]
    const outcome = plan.outcomes[resultIndex]
    if (parsed === undefined || outcome === undefined) continue
    if (outcome._tag === 'PathFound') {
      pathByIndex.set(parsed.index, [...outcome.path])
      continue
    }
    failures.set(parsed.index, {
      _tag: 'MobMovementPathFailure',
      index: parsed.index,
      failure: outcome.failure,
    })
  }

  return Result.succeed({ pathByIndex, searchesPerformed, expandedNodes })
}

type MovementStepContext = Readonly<{
  statesByIndex: ReadonlyMap<number, MobMovementRequest>
  failures: ReadonlyMap<number, MobMovementFailure>
  pathByIndex: ReadonlyMap<number, ReadonlyArray<MobPathStep>>
  world: MobMovementWorldPort
  settings: EffectiveSettings
}>

const stepMobAtIndex = (index: number, context: MovementStepContext): MobMovementOutcome => {
  const zeroIndex = NonNegativeTickCount(0)
  const indexValue = NonNegativeTickCount.result(index)
  if (Result.isFailure(indexValue)) {
    return { _tag: 'MobStepFailed', failure: inputFailure(zeroIndex, 'invalid-batch') }
  }
  const failure = context.failures.get(index)
  if (failure !== undefined) return { _tag: 'MobStepFailed', failure }

  const original = context.statesByIndex.get(index)
  if (original === undefined) {
    return { _tag: 'MobStepFailed', failure: inputFailure(indexValue.success, 'invalid-request') }
  }

  const selectedPath = context.pathByIndex.get(index)
  const path = selectedPath ?? [...original.path]
  const pathIndex = selectedPath === undefined ? original.pathIndex : NonNegativeTickCount(1)
  const movementRequest: MobMovementRequest = {
    ...original,
    path,
    pathIndex,
    stuckTicks: selectedPath === undefined ? original.stuckTicks : NonNegativeTickCount(0),
  }
  const currentCell = cellForBody(movementRequest)
  const shouldStep = Result.isSuccess(currentCell) && path.length > 0
  if (!shouldStep && !hasReachedGoal(movementRequest)) {
    return { _tag: 'MobStepFailed', failure: inputFailure(indexValue.success, 'invalid-request') }
  }

  return moveOne(indexValue.success, movementRequest, context.world, context.settings)
}

const stepPreparedMobs = (
  mobCount: number,
  prepared: PreparedMovementRequests,
  planned: PlannedMovementPaths,
  world: MobMovementWorldPort,
  settings: EffectiveSettings,
): Array<MobMovementOutcome> => {
  const context: MovementStepContext = {
    statesByIndex: prepared.statesByIndex,
    failures: prepared.failures,
    pathByIndex: planned.pathByIndex,
    world,
    settings,
  }
  return Array.from({ length: mobCount }, (_, index) => stepMobAtIndex(index, context))
}

/** Advance each requested mob by exactly one 20 Hz simulation tick. */
export const stepMobMovementsForTick = (input: MobMovementTickInput): MobMovementTickResult => {
  const zeroIndex = NonNegativeTickCount(0)
  if (!isRecord(input)) return rejected(inputFailure(zeroIndex, 'invalid-batch'))
  if (!hasOnlyMovementInputKeys(input)) return rejected(inputFailure(zeroIndex, 'invalid-batch'))
  const rawMobs = input['mobs']
  const worldValue = input['world']
  if (!Array.isArray(rawMobs)) return rejected(inputFailure(zeroIndex, 'invalid-batch'))
  if (!isWorldPort(worldValue)) return rejected(inputFailure(zeroIndex, 'invalid-world'))

  const settingsResult = settingsFor(input['settings'], Object.hasOwn(input, 'settings'))
  if (Result.isFailure(settingsResult)) return rejected(inputFailure(zeroIndex, 'invalid-settings'))
  const settings = settingsResult.success

  const prepared = prepareMovementRequests(rawMobs, settings, zeroIndex)
  if (Result.isFailure(prepared)) return rejected(prepared.failure)
  const planned = planMovementPaths(prepared.success.requests, prepared.success.failures, worldValue, settings, zeroIndex)
  if (Result.isFailure(planned)) return rejected(planned.failure)

  return {
    _tag: 'MobMovementCompleted',
    outcomes: stepPreparedMobs(rawMobs.length, prepared.success, planned.success, worldValue, settings),
    searchesPerformed: planned.success.searchesPerformed,
    expandedNodes: planned.success.expandedNodes,
  }
}
