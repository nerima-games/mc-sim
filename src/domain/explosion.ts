import { PositionAxis, position, type Position } from '@nerima-games/mc-kernel'
import { Result } from 'effect'
import { isEntityId, type EntityId } from './entity-types.js'

export type ExplosionBlockPosition = {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type ExplosionBlock = {
  /** Blast resistance must be finite, non-negative and within the safe numeric range. */
  readonly resistance: number
  /** Bedrock-like cells participate in shielding but can never be destroyed. */
  readonly destructible: boolean
}

/** `undefined` means that the cell is not loaded and must not be crossed or changed. */
export type ExplosionBlockReader = (position: ExplosionBlockPosition) => ExplosionBlock | undefined

export type ExplosionEntity = {
  readonly id: EntityId
  readonly feetPosition: Position
}

export type ExplosionEntityEffect = {
  readonly id: EntityId
  readonly damage: number
  readonly knockback: Position
  readonly exposure: number
}

export type ExplosionLimits = {
  readonly maxVisitedBlocks: number
  readonly maxRaySteps: number
  readonly maxAffectedEntities: number
}

export const DEFAULT_EXPLOSION_LIMITS: ExplosionLimits = {
  maxVisitedBlocks: 16_384,
  maxRaySteps: 128,
  maxAffectedEntities: 1_024,
}

export type ExplosionRequest = {
  readonly center: Position
  readonly radius: number
  readonly seed: number
  readonly blocks: ExplosionBlockReader
  readonly entities: ReadonlyArray<ExplosionEntity>
  readonly limits?: Partial<ExplosionLimits>
}

export type ExplosionValidationFailure = Readonly<{
  readonly _tag: 'ExplosionValidationFailure'
  readonly path: string
  readonly reason: string
}>

export const MAX_EXPLOSION_RADIUS = 64

export type ExplosionPlan = {
  readonly center: Position
  readonly radius: number
  readonly seed: number
  readonly destroyedBlocks: ReadonlyArray<ExplosionBlockPosition>
  readonly entityEffects: ReadonlyArray<ExplosionEntityEffect>
  readonly visitedBlocks: number
  readonly limits: ExplosionLimits
  readonly truncated: boolean
}

export type ExplosionMutation = Pick<ExplosionPlan, 'destroyedBlocks' | 'entityEffects'>

/**
 * A host implements this as one world transaction. The API deliberately has no
 * per-block callback: either the complete mutation commits, or none of it does.
 */
export type ExplosionCommit = (mutation: ExplosionMutation) => void

const validationFailure = (path: string, reason: string): ExplosionValidationFailure => ({
  _tag: 'ExplosionValidationFailure',
  path,
  reason,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const keyOf = ({ x, y, z }: ExplosionBlockPosition): string => `${x},${y},${z}`

const checkedBlockReader = (reader: ExplosionBlockReader) => {
  let failure: ExplosionValidationFailure | undefined
  const read: ExplosionBlockReader = (blockPosition) => {
    const value: unknown = reader(blockPosition)
    if (value === undefined) return undefined
    if (!isRecord(value)) {
      failure ??= validationFailure(`blocks[${keyOf(blockPosition)}]`, 'expected a block snapshot')
      return undefined
    }
    const resistance = value['resistance']
    const destructible = value['destructible']
    if (
      typeof resistance !== 'number' || !Number.isFinite(resistance) ||
      resistance < 0 || resistance > Number.MAX_SAFE_INTEGER
    ) {
      failure ??= validationFailure(
        `blocks[${keyOf(blockPosition)}].resistance`,
        'must be finite, non-negative and within the safe numeric range',
      )
      return undefined
    }
    if (typeof destructible !== 'boolean') {
      failure ??= validationFailure(`blocks[${keyOf(blockPosition)}].destructible`, 'must be a boolean')
      return undefined
    }
    return { resistance, destructible }
  }
  return { read, failure: () => failure }
}

const normaliseLimit = (
  value: unknown,
  path: string,
  fallback: number,
): Result.Result<number, ExplosionValidationFailure> => {
  if (value === undefined) return Result.succeed(fallback)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return Result.fail(validationFailure(path, 'must be a non-negative safe integer'))
  }
  return Result.succeed(value)
}

const normaliseLimits = (
  limits: unknown,
): Result.Result<ExplosionLimits, ExplosionValidationFailure> => {
  if (limits === undefined) return Result.succeed({ ...DEFAULT_EXPLOSION_LIMITS })
  if (!isRecord(limits)) return Result.fail(validationFailure('limits', 'expected an object'))
  return Result.map(Result.all([
    normaliseLimit(limits['maxVisitedBlocks'], 'limits.maxVisitedBlocks', DEFAULT_EXPLOSION_LIMITS.maxVisitedBlocks),
    normaliseLimit(limits['maxRaySteps'], 'limits.maxRaySteps', DEFAULT_EXPLOSION_LIMITS.maxRaySteps),
    normaliseLimit(
      limits['maxAffectedEntities'],
      'limits.maxAffectedEntities',
      DEFAULT_EXPLOSION_LIMITS.maxAffectedEntities,
    ),
  ]), ([maxVisitedBlocks, maxRaySteps, maxAffectedEntities]) => ({
    maxVisitedBlocks,
    maxRaySteps,
    maxAffectedEntities,
  }))
}

export const validateExplosionRequest = (
  request: ExplosionRequest,
): Result.Result<void, ExplosionValidationFailure> => {
  if (!isRecord(request)) return Result.fail(validationFailure('request', 'expected an object'))
  if (!Number.isFinite(request.radius) || request.radius < 0 || request.radius > MAX_EXPLOSION_RADIUS) {
    return Result.fail(validationFailure('radius', `must be finite and between 0 and ${MAX_EXPLOSION_RADIUS}`))
  }
  if (!Number.isFinite(request.seed) || Math.abs(request.seed) > Number.MAX_SAFE_INTEGER) {
    return Result.fail(validationFailure('seed', 'must be finite and within the safe numeric range'))
  }
  if (!isRecord(request.center)) return Result.fail(validationFailure('center', 'expected a position'))
  const coordinates = [
    ['center.x', request.center.x],
    ['center.y', request.center.y],
    ['center.z', request.center.z],
  ] as const
  for (const [path, value] of coordinates) {
    if (!Number.isFinite(value)) return Result.fail(validationFailure(path, 'must be finite'))
    if (Math.abs(value) + request.radius > Number.MAX_SAFE_INTEGER) {
      return Result.fail(validationFailure(path, 'must remain within safe block coordinates'))
    }
  }
  if (typeof request.blocks !== 'function') return Result.fail(validationFailure('blocks', 'expected a block reader'))
  if (!Array.isArray(request.entities)) return Result.fail(validationFailure('entities', 'expected an array'))
  for (let index = 0; index < request.entities.length; index += 1) {
    const entity: unknown = request.entities[index]
    if (!isRecord(entity) || !isEntityId(entity['id'])) {
      return Result.fail(validationFailure(`entities[${index}]`, 'expected an entity with an id'))
    }
    const feetPosition = entity['feetPosition']
    if (!isRecord(feetPosition)) {
      return Result.fail(validationFailure(`entities[${index}].feetPosition`, 'expected a position'))
    }
    for (const axis of ['x', 'y', 'z'] as const) {
      const value = feetPosition[axis]
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return Result.fail(validationFailure(`entities[${index}].feetPosition.${axis}`, 'must be finite'))
      }
    }
  }
  return Result.map(normaliseLimits(request.limits), () => undefined)
}

const HASH_SEED_FACTOR = 19.19
const HASH_X_FACTOR = 12.9898
const HASH_Y_FACTOR = 78.233
const HASH_Z_FACTOR = 37.719
const HASH_SCALE = 43_758.5453

const hashUnit = (seed: number, x: number, y: number, z: number): number => {
  const value =
    Math.sin(
      seed * HASH_SEED_FACTOR +
        x * HASH_X_FACTOR +
        y * HASH_Y_FACTOR +
        z * HASH_Z_FACTOR,
    ) * HASH_SCALE
  return value - Math.floor(value)
}

const positionOf = (x: number, y: number, z: number): Position =>
  position(PositionAxis(x), PositionAxis(y), PositionAxis(z))

// Preserve the established four-samples-per-block result for normal explosions.
// Above this radius, sharing radial prefixes prevents a single large explosion
// from tracing O(radius) samples independently for O(radius^3) target cells.
const MAX_DIRECT_TRACE_RADIUS = 8

type Trace = { readonly loaded: boolean; readonly attenuation: number; readonly steps: number }

type RadialTrace = {
  readonly attenuationTo: (target: ExplosionBlockPosition, distance: number) => Trace
  readonly readBlock: ExplosionBlockReader
}

const trace = (
  center: Position,
  destination: Position,
  targetKey: string | undefined,
  blocks: ExplosionBlockReader,
  maxSteps: number,
): Trace => {
  const dx = destination.x - center.x
  const dy = destination.y - center.y
  const dz = destination.z - center.z
  const distance = Math.hypot(dx, dy, dz)
  if (distance === 0) return { loaded: true, attenuation: 0, steps: 0 }

  // Four samples per block make thin walls reliable without an unbounded ray.
  const required = Math.max(1, Math.ceil(distance * 4))
  const samples = Math.min(required, maxSteps)
  if (samples < required) return { loaded: false, attenuation: 0, steps: samples }

  let attenuation = 0
  let previousKey = ''
  for (let step = 1; step <= samples; step += 1) {
    const ratio = step / samples
    const cell = {
      x: Math.floor(center.x + dx * ratio),
      y: Math.floor(center.y + dy * ratio),
      z: Math.floor(center.z + dz * ratio),
    }
    const key = keyOf(cell)
    if (key === previousKey) continue
    previousKey = key
    const block = blocks(cell)
    if (block === undefined) return { loaded: false, attenuation, steps: step }
    if (key !== targetKey) attenuation += block.resistance + 0.3
  }
  return { loaded: true, attenuation, steps: samples }
}

const radialTrace = (
  center: Position,
  blocks: ExplosionBlockReader,
  maxSteps: number,
): RadialTrace => {
  const centerCell = {
    x: Math.floor(center.x),
    y: Math.floor(center.y),
    z: Math.floor(center.z),
  }
  const centerKey = keyOf(centerCell)
  const blockCache = new Map<string, ExplosionBlock | undefined>()
  const pathCache = new Map<string, Trace>()

  const readBlock = (blockPosition: ExplosionBlockPosition): ExplosionBlock | undefined => {
    const key = keyOf(blockPosition)
    if (blockCache.has(key)) return blockCache.get(key)
    const block = blocks(blockPosition)
    blockCache.set(key, block)
    return block
  }

  const pathThrough = (cell: ExplosionBlockPosition): Trace => {
    const key = keyOf(cell)
    const cached = pathCache.get(key)
    if (cached !== undefined) return cached

    const block = readBlock(cell)
    if (block === undefined) {
      const result = { loaded: false, attenuation: 0, steps: 0 }
      pathCache.set(key, result)
      return result
    }

    if (key === centerKey) {
      const result = {
        loaded: true,
        attenuation: block.resistance + 0.3,
        steps: 1,
      }
      pathCache.set(key, result)
      return result
    }

    const parent = {
      x: cell.x - Math.sign(cell.x - centerCell.x),
      y: cell.y - Math.sign(cell.y - centerCell.y),
      z: cell.z - Math.sign(cell.z - centerCell.z),
    }
    const prefix = pathThrough(parent)
    const result = prefix.loaded
      ? {
          loaded: true,
          attenuation: prefix.attenuation + block.resistance + 0.3,
          steps: prefix.steps + 1,
        }
      : prefix
    pathCache.set(key, result)
    return result
  }

  return {
    readBlock,
    attenuationTo: (target, distance) => {
      if (keyOf(target) === centerKey) return { loaded: true, attenuation: 0, steps: 0 }
      const required = Math.max(1, Math.ceil(distance * 4))
      if (required > maxSteps) return { loaded: false, attenuation: 0, steps: maxSteps }
      const parent = {
        x: target.x - Math.sign(target.x - centerCell.x),
        y: target.y - Math.sign(target.y - centerCell.y),
        z: target.z - Math.sign(target.z - centerCell.z),
      }
      const prefix = pathThrough(parent)
      return prefix.loaded
        ? { loaded: true, attenuation: prefix.attenuation, steps: required }
        : prefix
    },
  }
}

const entityExposure = (
  center: Position,
  entity: ExplosionEntity,
  blocks: ExplosionBlockReader,
  maxSteps: number,
): number => {
  // Feet, torso, and head prevent a one-cell ledge from acting like a full-height wall.
  const heights = [0.1, 0.9, 1.7]
  let visible = 0
  for (const height of heights) {
    const result = trace(center, positionOf(entity.feetPosition.x, entity.feetPosition.y + height, entity.feetPosition.z), undefined, blocks, maxSteps)
    if (result.loaded && result.attenuation < 1) visible += 1
  }
  return visible / heights.length
}

/** Build a deterministic, bounded explosion without mutating either owner. */
type DestroyedBlockPlan = {
  readonly destroyedBlocks: Array<ExplosionBlockPosition>
  readonly visitedBlocks: number
  readonly truncated: boolean
}

const planDestroyedBlocks = (
  request: ExplosionRequest,
  center: Position,
  radius: number,
  seed: number,
  limits: ExplosionLimits,
): DestroyedBlockPlan => {
  const destroyedBlocks: ExplosionBlockPosition[] = []
  let visitedBlocks = 0
  let truncated = false

  const minimumX = Math.floor(center.x - radius)
  const maximumX = Math.floor(center.x + radius)
  const minimumY = Math.floor(center.y - radius)
  const maximumY = Math.floor(center.y + radius)
  const minimumZ = Math.floor(center.z - radius)
  const maximumZ = Math.floor(center.z + radius)
  const sharedTrace = radius > MAX_DIRECT_TRACE_RADIUS
    ? radialTrace(center, request.blocks, limits.maxRaySteps)
    : undefined
  const readBlock = sharedTrace?.readBlock ?? request.blocks

  outer: for (let y = minimumY; y <= maximumY && !truncated; y += 1) {
    for (let z = minimumZ; z <= maximumZ && !truncated; z += 1) {
      for (let x = minimumX; x <= maximumX && !truncated; x += 1) {
        const target = { x, y, z }
        const distance = Math.hypot(x + 0.5 - center.x, y + 0.5 - center.y, z + 0.5 - center.z)
        if (distance > radius) continue
        if (visitedBlocks >= limits.maxVisitedBlocks) {
          truncated = true
          break outer
        }
        visitedBlocks += 1
        const block = readBlock(target)
        if (block === undefined || !block.destructible) continue
        const ray = sharedTrace === undefined
          ? trace(center, positionOf(x + 0.5, y + 0.5, z + 0.5), keyOf(target), request.blocks, limits.maxRaySteps)
          : sharedTrace.attenuationTo(target, distance)
        if (!ray.loaded) {
          if (ray.steps >= limits.maxRaySteps) truncated = true
          continue
        }
        const blast = radius * (0.7 + hashUnit(seed, x, y, z) * 0.6) - distance - ray.attenuation
        if (blast > block.resistance) destroyedBlocks.push(target)
      }
    }
  }

  return { destroyedBlocks, visitedBlocks, truncated }
}

export const planExplosion = (
  request: ExplosionRequest,
): Result.Result<ExplosionPlan, ExplosionValidationFailure> => {
  const requestResult = validateExplosionRequest(request)
  if (Result.isFailure(requestResult)) return Result.fail(requestResult.failure)

  const center = positionOf(request.center.x, request.center.y, request.center.z)
  const radius = request.radius
  const seed = request.seed
  const limitsResult = normaliseLimits(request.limits)
  if (Result.isFailure(limitsResult)) return Result.fail(limitsResult.failure)
  const limits = limitsResult.success
  const blocks = checkedBlockReader(request.blocks)
  const blockPlan = planDestroyedBlocks({ ...request, blocks: blocks.read }, center, radius, seed, limits)
  const blockFailure = blocks.failure()
  if (blockFailure !== undefined) return Result.fail(blockFailure)
  const entityEffects: ExplosionEntityEffect[] = []
  const entityCount = Math.min(request.entities.length, limits.maxAffectedEntities)
  let truncated = blockPlan.truncated
  if (entityCount < request.entities.length) truncated = true
  for (const [index, entity] of request.entities.slice(0, entityCount).entries()) {
    const { feetPosition } = entity
    const target = {
      x: feetPosition.x,
      y: feetPosition.y + 0.9,
      z: feetPosition.z,
    }
    const dx = target.x - center.x
    const dy = target.y - center.y
    const dz = target.z - center.z
    const distance = Math.hypot(dx, dy, dz)
    if (!Number.isFinite(distance)) {
      return Result.fail(validationFailure(`entities[${index}].feetPosition`, 'distance from center must be finite'))
    }
    if (radius > 0 && distance <= radius) {
      const exposure = entityExposure(center, entity, blocks.read, limits.maxRaySteps)
      const exposureFailure = blocks.failure()
      if (exposureFailure !== undefined) return Result.fail(exposureFailure)
      if (exposure > 0) {
        const impact = Math.max(0, 1 - distance / radius) * exposure
        const directionLength = Math.hypot(
          target.x - center.x,
          target.y - center.y,
          target.z - center.z,
        )
        let direction: Position = positionOf(0, 0, 0)
        if (directionLength > 0) {
          direction = positionOf(
            (target.x - center.x) / directionLength,
            (target.y - center.y) / directionLength,
            (target.z - center.z) / directionLength,
          )
        }
        const damage =
          (impact * impact + impact) *
            0.5 *
            7 *
            radius +
          1
        entityEffects.push({
          damage,
          exposure,
          id: entity.id,
          knockback: positionOf(
            direction.x * impact,
            direction.y * impact,
            direction.z * impact,
          ),
        })
      }
    }
  }

  return Result.succeed({
    center,
    radius,
    seed,
    destroyedBlocks: blockPlan.destroyedBlocks,
    entityEffects,
    visitedBlocks: blockPlan.visitedBlocks,
    limits,
    truncated,
  })
}

/** Delegate the entire planned mutation to one host-owned atomic transaction. */
export const applyExplosionPlan = (plan: ExplosionPlan, commit: ExplosionCommit): void =>
  commit({
    destroyedBlocks: plan.destroyedBlocks,
    entityEffects: plan.entityEffects,
  })
