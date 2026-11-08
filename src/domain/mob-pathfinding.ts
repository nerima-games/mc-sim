import { BlockAxis, NonNegativeTickCount } from '@nerima-games/mc-kernel'
import type { BlockLength } from '@nerima-games/mc-physics'
import { Result, Schema } from 'effect'

export type MobPathCell = Readonly<{ x: BlockAxis; y: BlockAxis; z: BlockAxis }>

export type MobPathStep =
  | (MobPathCell & Readonly<{ action: 'start' | 'walk' | 'jump' | 'fall' }>)
  | (MobPathCell & Readonly<{ action: 'climb'; wall: Readonly<{ x: -1 | 0 | 1; z: -1 | 0 | 1 }> }>)

export type MobPathProfile =
  | Readonly<{ kind: 'ground'; width: BlockLength; height: BlockLength; canJump: boolean }>
  | Readonly<{ kind: 'spider'; width: BlockLength; height: BlockLength }>
  | Readonly<{ kind: 'swimmer'; width: BlockLength; height: BlockLength }>
  | Readonly<{ kind: 'flyer'; width: BlockLength; height: BlockLength }>

export type MobPathWorldPort = Readonly<{
  isPassable: (cell: MobPathCell) => boolean
  hasSupport: (cell: MobPathCell) => boolean
  hazardAt: (cell: MobPathCell) => 'water' | 'lava' | 'cactus' | 'fire' | null
}>

export type MobPathRequest = Readonly<{
  start: MobPathCell
  goal: MobPathCell
  profile: MobPathProfile
}>

export type MobPathTickInput = Readonly<{
  requests: ReadonlyArray<MobPathRequest>
  world: MobPathWorldPort
  settings?: MobPathfindingSettings
}>

export type MobPathfindingSettings = Readonly<{
  maxNodesPerSearch: NonNegativeTickCount
  maxSearchesPerTick: NonNegativeTickCount
  maxFallDistance: BlockAxis
}>

export const DEFAULT_MOB_PATHFINDING_SETTINGS: MobPathfindingSettings = Object.freeze({
  maxNodesPerSearch: NonNegativeTickCount(256),
  maxSearchesPerTick: NonNegativeTickCount(8),
  maxFallDistance: BlockAxis(3),
})

export type MobPathFailure =
  | Readonly<{ _tag: 'InvalidInput'; field: 'request' | 'start' | 'goal' | 'profile' }>
  | Readonly<{ _tag: 'UnsupportedProfile'; kind: 'swimmer' | 'flyer' }>
  | Readonly<{ _tag: 'NoPath' }>
  | Readonly<{ _tag: 'NodeBudgetExhausted'; maxNodes: NonNegativeTickCount; expandedNodes: NonNegativeTickCount }>
  | Readonly<{ _tag: 'TickBudgetExhausted'; maxSearches: NonNegativeTickCount }>

export type MobPathOutcome =
  | Readonly<{ _tag: 'PathFound'; path: ReadonlyArray<MobPathStep>; expandedNodes: NonNegativeTickCount }>
  | Readonly<{ _tag: 'PathFailed'; failure: MobPathFailure }>

export type MobPathTickPlan =
  | Readonly<{
      _tag: 'InvalidMobPathfindingInput'
      field: 'input' | 'requests' | 'world'
    }>
  | Readonly<{
      _tag: 'InvalidMobPathfindingSettings'
      field: keyof MobPathfindingSettings | 'settings'
    }>
  | Readonly<{
      _tag: 'MobPathsPlanned'
      outcomes: ReadonlyArray<MobPathOutcome>
      searchesPerformed: NonNegativeTickCount
      expandedNodes: NonNegativeTickCount
    }>

const BlockAxisSchema = Schema.Int.check(Schema.makeFilter(Number.isSafeInteger)).pipe(Schema.brand('BlockAxis'))
// Keep per-node world queries bounded even when a caller supplies an oversized profile.
const MAX_MOB_PATH_DIMENSION = 8
// Bound vertical neighbor generation; the default fall distance is three blocks.
const MAX_MOB_FALL_DISTANCE = 16
const MobDimensionSchema = Schema.Finite.check(
  Schema.makeFilter((value) => value > 0 && value <= MAX_MOB_PATH_DIMENSION),
).pipe(Schema.brand('BlockLength'))
const NonNegativeTickCountSchema = Schema.Int.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0),
).pipe(Schema.brand('NonNegativeTickCount'))
const PositiveTickCountSchema = Schema.Int.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0),
).pipe(Schema.brand('NonNegativeTickCount'))
const MobFallDistanceSchema = Schema.Int.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 1 && value <= MAX_MOB_FALL_DISTANCE),
).pipe(Schema.brand('BlockAxis'))

const MobPathCellFields = {
  x: BlockAxisSchema,
  y: BlockAxisSchema,
  z: BlockAxisSchema,
}

export const MobPathCellSchema: Schema.Codec<MobPathCell, unknown> = Schema.Struct(MobPathCellFields)

const ClimbWallSchema = Schema.Struct({
  x: Schema.Literals([-1, 0, 1]),
  z: Schema.Literals([-1, 0, 1]),
}).check(Schema.makeFilter((wall) => (wall.x === 0) !== (wall.z === 0)))

export const MobPathStepSchema: Schema.Codec<MobPathStep, unknown> = Schema.Union([
  Schema.Struct({ ...MobPathCellFields, action: Schema.Literals(['start', 'walk', 'jump', 'fall']) }),
  Schema.Struct({
    ...MobPathCellFields,
    action: Schema.Literal('climb'),
    wall: ClimbWallSchema,
  }),
])

const MobPathProfileSchemaInternal = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('ground'), width: MobDimensionSchema, height: MobDimensionSchema, canJump: Schema.Boolean }),
  Schema.Struct({ kind: Schema.Literal('spider'), width: MobDimensionSchema, height: MobDimensionSchema }),
  Schema.Struct({ kind: Schema.Literal('swimmer'), width: MobDimensionSchema, height: MobDimensionSchema }),
  Schema.Struct({ kind: Schema.Literal('flyer'), width: MobDimensionSchema, height: MobDimensionSchema }),
])

export const MobPathProfileSchema: Schema.Codec<MobPathProfile, unknown> = MobPathProfileSchemaInternal

export const MobPathRequestSchema: Schema.Codec<MobPathRequest, unknown> = Schema.Struct({
  start: MobPathCellSchema,
  goal: MobPathCellSchema,
  profile: MobPathProfileSchema,
})

const MobPathfindingSettingsSchemaInternal = Schema.Struct({
  maxNodesPerSearch: PositiveTickCountSchema,
  maxSearchesPerTick: PositiveTickCountSchema,
  maxFallDistance: MobFallDistanceSchema,
}).check(Schema.makeFilter((settings) => Number(settings.maxNodesPerSearch) * Number(settings.maxSearchesPerTick) <= Number.MAX_SAFE_INTEGER))

export const MobPathfindingSettingsSchema: Schema.Codec<MobPathfindingSettings, unknown> = MobPathfindingSettingsSchemaInternal

const MobPathFailureSchemaInternal = Schema.Union([
  Schema.TaggedStruct('InvalidInput', { field: Schema.Literals(['request', 'start', 'goal', 'profile']) }),
  Schema.TaggedStruct('UnsupportedProfile', { kind: Schema.Literals(['swimmer', 'flyer']) }),
  Schema.TaggedStruct('NoPath', {}),
  Schema.TaggedStruct('NodeBudgetExhausted', { maxNodes: NonNegativeTickCountSchema, expandedNodes: NonNegativeTickCountSchema }),
  Schema.TaggedStruct('TickBudgetExhausted', { maxSearches: NonNegativeTickCountSchema }),
])

export const MobPathFailureSchema: Schema.Codec<MobPathFailure, unknown> = MobPathFailureSchemaInternal

export const MobPathOutcomeSchema: Schema.Codec<MobPathOutcome, unknown> = Schema.Union([
  Schema.TaggedStruct('PathFound', { path: Schema.Array(MobPathStepSchema), expandedNodes: NonNegativeTickCountSchema }),
  Schema.TaggedStruct('PathFailed', { failure: MobPathFailureSchema }),
])

const InvalidMobPathfindingSettingsSchema = Schema.TaggedStruct('InvalidMobPathfindingSettings', {
  field: Schema.Literals(['maxNodesPerSearch', 'maxSearchesPerTick', 'maxFallDistance', 'settings']),
})

const InvalidMobPathfindingInputSchema = Schema.TaggedStruct('InvalidMobPathfindingInput', {
  field: Schema.Literals(['input', 'requests', 'world']),
})

export const MobPathTickPlanSchema: Schema.Codec<MobPathTickPlan, unknown> = Schema.Union([
  InvalidMobPathfindingInputSchema,
  InvalidMobPathfindingSettingsSchema,
  Schema.TaggedStruct('MobPathsPlanned', {
    outcomes: Schema.Array(MobPathOutcomeSchema),
    searchesPerformed: NonNegativeTickCountSchema,
    expandedNodes: NonNegativeTickCountSchema,
  }),
])

type SearchSettings = MobPathfindingSettings
type PositionKey = string

type PathNode = Readonly<{ step: MobPathStep; parent: PathNode | undefined }>

type QueueEntry = Readonly<{
  cell: MobPathCell
  key: PositionKey
  g: number
  h: number
  path: PathNode
}>

type Transition = MobPathStep

const keyOf = (cell: MobPathCell): PositionKey => `${cell.x},${cell.y},${cell.z}`

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCell = (value: unknown): value is MobPathCell =>
  isRecord(value) &&
  Number.isSafeInteger(value['x']) &&
  Number.isSafeInteger(value['y']) &&
  Number.isSafeInteger(value['z'])

const makeCell = (x: number, y: number, z: number): MobPathCell | undefined => {
  const checked = Result.all([BlockAxis.result(x), BlockAxis.result(y), BlockAxis.result(z)])
  if (Result.isFailure(checked)) return undefined
  const [validX, validY, validZ] = checked.success
  return { x: validX, y: validY, z: validZ }
}

const offsetCell = (cell: MobPathCell, dx: number, dy: number, dz: number): MobPathCell | undefined =>
  makeCell(cell.x + dx, cell.y + dy, cell.z + dz)

const isProfileKind = (kind: unknown): kind is MobPathProfile['kind'] =>
  kind === 'ground' || kind === 'spider' || kind === 'swimmer' || kind === 'flyer'

const isWorldPort = (value: unknown): value is MobPathWorldPort =>
  isRecord(value) &&
  typeof value['isPassable'] === 'function' &&
  typeof value['hasSupport'] === 'function' &&
  typeof value['hazardAt'] === 'function'


const isValidProfile = (profile: unknown): profile is MobPathProfile => {
  if (!isRecord(profile) || !isProfileKind(profile['kind'])) return false
  if (typeof profile['width'] !== 'number' || !Number.isFinite(profile['width']) || profile['width'] <= 0 || profile['width'] > MAX_MOB_PATH_DIMENSION) return false
  if (typeof profile['height'] !== 'number' || !Number.isFinite(profile['height']) || profile['height'] <= 0 || profile['height'] > MAX_MOB_PATH_DIMENSION) return false
  return profile['kind'] !== 'ground' || typeof profile['canJump'] === 'boolean'
}

const invalidSettingsField = (settings: unknown): keyof MobPathfindingSettings | 'settings' | undefined => {
  if (!isRecord(settings)) return 'settings'
  const budgets: ReadonlyArray<'maxNodesPerSearch' | 'maxSearchesPerTick'> = [
    'maxNodesPerSearch', 'maxSearchesPerTick',
  ]
  for (const field of budgets) {
    const value = settings[field]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return field
  }
  const fallDistance = settings['maxFallDistance']
  if (typeof fallDistance !== 'number' || !Number.isSafeInteger(fallDistance) || fallDistance < 1 || fallDistance > MAX_MOB_FALL_DISTANCE) {
    return 'maxFallDistance'
  }
  const maxNodes = settings['maxNodesPerSearch']
  const maxSearches = settings['maxSearchesPerTick']
  if (typeof maxNodes !== 'number' || typeof maxSearches !== 'number' || maxNodes * maxSearches > Number.MAX_SAFE_INTEGER) {
    return 'maxNodesPerSearch'
  }
  return undefined
}

const compareEntries = (left: QueueEntry, right: QueueEntry): number =>
  left.g + left.h - (right.g + right.h) ||
  left.h - right.h ||
  left.cell.z - right.cell.z ||
  left.cell.x - right.cell.x ||
  left.cell.y - right.cell.y

type HeapNode = {
  entry: QueueEntry
  left: HeapNode | undefined
  right: HeapNode | undefined
  rank: number
}

const heapRank = (node: HeapNode | undefined): number => node?.rank ?? 0

const mergeHeaps = (left: HeapNode | undefined, right: HeapNode | undefined): HeapNode | undefined => {
  if (left === undefined) return right
  if (right === undefined) return left

  let first = left
  let second = right
  if (compareEntries(first.entry, second.entry) > 0) {
    first = right
    second = left
  }

  first.right = mergeHeaps(first.right, second)
  if (heapRank(first.left) < heapRank(first.right)) {
    const previousLeft = first.left
    first.left = first.right
    first.right = previousLeft
  }
  first.rank = heapRank(first.right) + 1
  return first
}

class MinHeap {
  private root: HeapNode | undefined
  private sizeValue = 0

  public get length(): number {
    return this.sizeValue
  }

  public push(value: QueueEntry): void {
    this.root = mergeHeaps(this.root, { entry: value, left: undefined, right: undefined, rank: 1 })
    this.sizeValue += 1
  }

  public pop(): QueueEntry | undefined {
    const first = this.root
    if (first === undefined) return undefined
    this.root = mergeHeaps(first.left, first.right)
    this.sizeValue -= 1
    return first.entry
  }
}

const heuristic = (from: MobPathCell, to: MobPathCell, maxFallDistance: number): number =>
  Math.abs(from.x - to.x) +
  Math.abs(from.z - to.z) +
  Math.abs(from.y - to.y) / maxFallDistance

const footprintCells = (cell: MobPathCell, profile: MobPathProfile): ReadonlyArray<MobPathCell> => {
  const halfWidth = profile.width / 2
  const minX = Math.floor(cell.x + 0.5 - halfWidth + 1e-10)
  const maxX = Math.floor(cell.x + 0.5 + halfWidth - 1e-10)
  const minZ = Math.floor(cell.z + 0.5 - halfWidth + 1e-10)
  const maxZ = Math.floor(cell.z + 0.5 + halfWidth - 1e-10)
  const cells: Array<MobPathCell> = []
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) {
      const footprint = makeCell(x, cell.y, z)
      if (footprint === undefined) return []
      cells.push(footprint)
    }
  }
  return cells
}

const occupiedCells = (cell: MobPathCell, profile: MobPathProfile): ReadonlyArray<MobPathCell> => {
  const footprint = footprintCells(cell, profile)
  if (footprint.length === 0) return []
  const heightInBlocks = Math.ceil(profile.height)
  const cells: Array<MobPathCell> = []
  for (const base of footprint) {
    for (let offset = 0; offset < heightInBlocks; offset += 1) {
      const occupied = offsetCell(base, 0, offset, 0)
      if (occupied === undefined) return []
      cells.push(occupied)
    }
  }
  return cells
}

const isBodyClear = (cell: MobPathCell, profile: MobPathProfile, world: MobPathWorldPort): boolean => {
  const cells = occupiedCells(cell, profile)
  return cells.length > 0 && cells.every((occupied) => world.isPassable(occupied) && world.hazardAt(occupied) === null)
}

const hasSafeSupport = (cell: MobPathCell, profile: MobPathProfile, world: MobPathWorldPort): boolean => {
  const footprint = footprintCells(cell, profile)
  return footprint.length > 0 && footprint.every((foot) => {
    const support = offsetCell(foot, 0, -1, 0)
    return support !== undefined && world.hasSupport(support) && world.hazardAt(support) === null
  })
}

const canStand = (cell: MobPathCell, profile: MobPathProfile, world: MobPathWorldPort): boolean =>
  isBodyClear(cell, profile, world) && hasSafeSupport(cell, profile, world)

const wallDirections = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
] as const

const climbWall = (
  cell: MobPathCell,
  profile: MobPathProfile,
  world: MobPathWorldPort,
): Readonly<{ x: -1 | 0 | 1; z: -1 | 0 | 1 }> | undefined => {
  const wallCells = occupiedCells(cell, profile)
  for (const wall of wallDirections) {
    const touchesWall = wallCells.some((occupied) => {
      const side = offsetCell(occupied, wall.x, 0, wall.z)
      return side !== undefined && !world.isPassable(side) && world.hasSupport(side)
    })
    if (touchesWall) return wall
  }
  return undefined
}

const pathStep = (cell: MobPathCell, action: 'start' | 'walk' | 'jump' | 'fall'): MobPathStep => ({ ...cell, action })

const climbStep = (
  cell: MobPathCell,
  wall: Readonly<{ x: -1 | 0 | 1; z: -1 | 0 | 1 }>,
): MobPathStep => ({ ...cell, action: 'climb', wall })

const fallTransitionsFrom = (
  sameLevel: MobPathCell,
  profile: MobPathProfile,
  world: MobPathWorldPort,
  settings: SearchSettings,
): ReadonlyArray<Transition> => {
  const transitions: Array<Transition> = []
  for (let fall = 1; fall <= settings.maxFallDistance; fall += 1) {
    const landing = offsetCell(sameLevel, 0, -fall, 0)
    if (landing === undefined) continue
    let descentIsClear = true
    for (let offset = 1; offset <= fall; offset += 1) {
      const descentCell = offsetCell(sameLevel, 0, -offset, 0)
      if (descentCell === undefined || !isBodyClear(descentCell, profile, world)) {
        descentIsClear = false
        break
      }
    }
    if (descentIsClear && canStand(landing, profile, world)) transitions.push(pathStep(landing, 'fall'))
  }
  return transitions
}

const transitionsFrom = (
  cell: MobPathCell,
  profile: MobPathProfile,
  world: MobPathWorldPort,
  settings: SearchSettings,
): ReadonlyArray<Transition> => {
  const transitions: Array<Transition> = []
  const directions = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
  ] as const

  for (const direction of directions) {
    const sameLevel = offsetCell(cell, direction.x, 0, direction.z)
    if (sameLevel === undefined) continue
    if (canStand(sameLevel, profile, world)) transitions.push(pathStep(sameLevel, 'walk'))

    const canJump = profile.kind === 'spider' || (profile.kind === 'ground' && profile.canJump)
    if (canJump) {
      const stepUp = offsetCell(sameLevel, 0, 1, 0)
      if (stepUp !== undefined && canStand(stepUp, profile, world)) transitions.push(pathStep(stepUp, 'jump'))
    }

    transitions.push(...fallTransitionsFrom(sameLevel, profile, world, settings))
  }

  if (profile.kind === 'spider') {
    const up = offsetCell(cell, 0, 1, 0)
    if (up !== undefined && isBodyClear(up, profile, world)) {
      const wall = climbWall(up, profile, world) ?? climbWall(cell, profile, world)
      if (wall !== undefined) transitions.push(climbStep(up, wall))
    }
  }

  return transitions
}

const searchPath = (
  request: MobPathRequest,
  world: MobPathWorldPort,
  settings: SearchSettings,
): MobPathOutcome => {
  const { start, goal, profile } = request
  if (!isBodyClear(start, profile, world)) return { _tag: 'PathFailed', failure: { _tag: 'NoPath' } }

  const startKey = keyOf(start)
  const goalKey = keyOf(goal)
  const startPath = { step: pathStep(start, 'start'), parent: undefined }
  const open = new MinHeap()
  const bestG = new Map<PositionKey, number>([[startKey, 0]])
  const closed = new Set<PositionKey>()
  open.push({ cell: start, key: startKey, g: 0, h: heuristic(start, goal, settings.maxFallDistance), path: startPath })
  let expandedNodes = 0

  while (expandedNodes < settings.maxNodesPerSearch) {
    const current = open.pop()
    if (current === undefined) break
    if (closed.has(current.key)) continue
    if (current.key === goalKey) {
      const path: Array<MobPathStep> = []
      for (let node: PathNode | undefined = current.path; node !== undefined; node = node.parent) path.push(node.step)
      path.reverse()
      return { _tag: 'PathFound', path, expandedNodes: NonNegativeTickCount(expandedNodes + 1) }
    }

    closed.add(current.key)
    expandedNodes += 1
    for (const next of transitionsFrom(current.cell, profile, world, settings)) {
      const nextKey = keyOf(next)
      if (closed.has(nextKey)) continue
      const nextG = current.g + 1 + Math.abs(next.y - current.cell.y)
      const previousG = bestG.get(nextKey)
      if (previousG !== undefined && previousG <= nextG) continue
      bestG.set(nextKey, nextG)
      open.push({
        cell: { x: next.x, y: next.y, z: next.z },
        key: nextKey,
        g: nextG,
        h: heuristic(next, goal, settings.maxFallDistance),
        path: { step: next, parent: current.path },
      })
    }
  }

  if (open.length > 0) {
    return {
      _tag: 'PathFailed',
      failure: {
        _tag: 'NodeBudgetExhausted',
        maxNodes: settings.maxNodesPerSearch,
        expandedNodes: NonNegativeTickCount(expandedNodes),
      },
    }
  }
  return { _tag: 'PathFailed', failure: { _tag: 'NoPath' } }
}

type ValidatedPathEntry<A> =
  | Readonly<{ _tag: 'Request'; source: A; request: MobPathRequest }>
  | Readonly<{ _tag: 'Outcome'; source: A; outcome: Extract<MobPathOutcome, { _tag: 'PathFailed' }> }>

type PlannedPathEntry<A> = Readonly<{ source: A; outcome: MobPathOutcome }>
type PlannedMobPaths<A> = Readonly<{
  outcomes: ReadonlyArray<PlannedPathEntry<A>>
  searchesPerformed: NonNegativeTickCount
  expandedNodes: NonNegativeTickCount
}>

const planValidatedEntries = <A>(
  entries: ReadonlyArray<ValidatedPathEntry<A>>,
  world: MobPathWorldPort,
  settings: SearchSettings,
): PlannedMobPaths<A> => {
  const outcomes: Array<PlannedPathEntry<A>> = []
  let searchesPerformed = 0
  let expandedNodes = 0

  for (const entry of entries) {
    if (entry._tag === 'Outcome') {
      outcomes.push({ source: entry.source, outcome: entry.outcome })
      continue
    }

    const request = entry.request
    if (request.profile.kind === 'swimmer' || request.profile.kind === 'flyer') {
      outcomes.push({
        source: entry.source,
        outcome: { _tag: 'PathFailed', failure: { _tag: 'UnsupportedProfile', kind: request.profile.kind } },
      })
      continue
    }
    if (searchesPerformed >= settings.maxSearchesPerTick) {
      outcomes.push({
        source: entry.source,
        outcome: {
          _tag: 'PathFailed',
          failure: { _tag: 'TickBudgetExhausted', maxSearches: settings.maxSearchesPerTick },
        },
      })
      continue
    }

    searchesPerformed += 1
    const outcome = searchPath(request, world, settings)
    if (outcome._tag === 'PathFound') expandedNodes += outcome.expandedNodes
    if (outcome._tag === 'PathFailed' && outcome.failure._tag === 'NodeBudgetExhausted') {
      expandedNodes += outcome.failure.expandedNodes
    }
    outcomes.push({ source: entry.source, outcome })
  }

  return {
    outcomes,
    searchesPerformed: NonNegativeTickCount(searchesPerformed),
    expandedNodes: NonNegativeTickCount(expandedNodes),
  }
}

/** Shared with movement after the caller has decoded each request and setting. */
export const planValidatedMobPathsForMovement = <A>(
  requests: ReadonlyArray<Readonly<{ source: A; request: MobPathRequest }>>,
  world: MobPathWorldPort,
  settings: MobPathfindingSettings,
): PlannedMobPaths<A> => planValidatedEntries(
  requests.map(({ source, request }): ValidatedPathEntry<A> => ({ _tag: 'Request', source, request })),
  world,
  settings,
)

export const planMobPathsForTick = (input: MobPathTickInput): MobPathTickPlan => {
  if (!isRecord(input)) return { _tag: 'InvalidMobPathfindingInput', field: 'input' }
  const allowedInputKeys = new Set(['requests', 'world', 'settings'])
  if (Object.keys(input).some((key) => !allowedInputKeys.has(key))) {
    return { _tag: 'InvalidMobPathfindingInput', field: 'input' }
  }
  const requests = input['requests']
  if (!Array.isArray(requests)) return { _tag: 'InvalidMobPathfindingInput', field: 'requests' }
  const world = input['world']
  if (!isWorldPort(world)) return { _tag: 'InvalidMobPathfindingInput', field: 'world' }

  const providedSettings: unknown = Object.prototype.hasOwnProperty.call(input, 'settings')
    ? input['settings']
    : DEFAULT_MOB_PATHFINDING_SETTINGS
  const badField = invalidSettingsField(providedSettings)
  const decodedSettings = Schema.decodeUnknownResult(MobPathfindingSettingsSchema, {
    onExcessProperty: 'error',
  })(providedSettings)
  if (Result.isFailure(decodedSettings)) {
    return { _tag: 'InvalidMobPathfindingSettings', field: badField ?? 'settings' }
  }
  const settings: SearchSettings = decodedSettings.success
  const entries: Array<ValidatedPathEntry<unknown>> = []

  for (const rawRequest of requests) {
    if (!isRecord(rawRequest)) {
      entries.push({
        _tag: 'Outcome',
        source: rawRequest,
        outcome: { _tag: 'PathFailed', failure: { _tag: 'InvalidInput', field: 'request' } },
      })
      continue
    }
    const start = rawRequest['start']
    const goal = rawRequest['goal']
    const profile = rawRequest['profile']
    if (!isCell(start)) {
      entries.push({
        _tag: 'Outcome',
        source: rawRequest,
        outcome: { _tag: 'PathFailed', failure: { _tag: 'InvalidInput', field: 'start' } },
      })
      continue
    }
    if (!isCell(goal)) {
      entries.push({
        _tag: 'Outcome',
        source: rawRequest,
        outcome: { _tag: 'PathFailed', failure: { _tag: 'InvalidInput', field: 'goal' } },
      })
      continue
    }
    if (!isValidProfile(profile)) {
      entries.push({
        _tag: 'Outcome',
        source: rawRequest,
        outcome: { _tag: 'PathFailed', failure: { _tag: 'InvalidInput', field: 'profile' } },
      })
      continue
    }
    const decodedRequest = Schema.decodeUnknownResult(MobPathRequestSchema, {
      onExcessProperty: 'error',
    })(rawRequest)
    if (Result.isFailure(decodedRequest)) {
      entries.push({
        _tag: 'Outcome',
        source: rawRequest,
        outcome: { _tag: 'PathFailed', failure: { _tag: 'InvalidInput', field: 'request' } },
      })
      continue
    }
    entries.push({ _tag: 'Request', source: rawRequest, request: decodedRequest.success })
  }

  const planned = planValidatedEntries(entries, world, settings)
  return {
    _tag: 'MobPathsPlanned',
    outcomes: planned.outcomes.map(({ outcome }) => outcome),
    searchesPerformed: planned.searchesPerformed,
    expandedNodes: planned.expandedNodes,
  }
}
