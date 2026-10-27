import { Brand, Result, Schema, SchemaIssue } from 'effect'
import { DeltaTimeSecs, PositionAxis, position, type Position } from '@nerima-games/mc-kernel'

export const WITHER_MAX_HEALTH = 300
export const WITHER_SPAWN_CHARGE_SECS = 10
export type WitherHealthPoints = number & Brand.Brand<'WitherHealthPoints'>
export const WitherHealthPoints: Brand.Constructor<WitherHealthPoints> = Brand.make((value) =>
  Number.isFinite(value) && value >= 0
    ? true
    : `WitherHealthPoints must be finite and non-negative, received ${String(value)}`,
)

export type WitherChargeRemainingSecs = number & Brand.Brand<'WitherChargeRemainingSecs'>
export const WitherChargeRemainingSecs: Brand.Constructor<WitherChargeRemainingSecs> = Brand.make((value) =>
  Number.isFinite(value) && value >= 0
    ? true
    : `WitherChargeRemainingSecs must be finite and non-negative, received ${String(value)}`,
)

export type WitherDamageAmount = number & Brand.Brand<'WitherDamageAmount'>
export const WitherDamageAmount: Brand.Constructor<WitherDamageAmount> = Brand.make((value) =>
  Number.isFinite(value) && value >= 0
    ? true
    : `WitherDamageAmount must be finite and non-negative, received ${String(value)}`,
)

export type WitherProjectileSpeed = number & Brand.Brand<'WitherProjectileSpeed'>
export const WitherProjectileSpeed: Brand.Constructor<WitherProjectileSpeed> = Brand.make((value) =>
  Number.isFinite(value) && value > 0
    ? true
    : `WitherProjectileSpeed must be finite and positive, received ${String(value)}`,
)

export type WitherExplosionPower = number & Brand.Brand<'WitherExplosionPower'>
export const WitherExplosionPower: Brand.Constructor<WitherExplosionPower> = Brand.make((value) =>
  Number.isFinite(value) && value >= 0
    ? true
    : `WitherExplosionPower must be finite and non-negative, received ${String(value)}`,
)

export type WitherSummonMaterial = string & Brand.Brand<'WitherSummonMaterial'>
export const WitherSummonMaterial: Brand.Constructor<WitherSummonMaterial> = Brand.make((value) =>
  typeof value === 'string'
    ? true
    : `WitherSummonMaterial must be a string, received ${String(value)}`,
)

export const WITHER_ARMOUR_THRESHOLD: WitherHealthPoints = WitherHealthPoints(WITHER_MAX_HEALTH / 2)
export const WITHER_REGEN_PER_SEC = 1
export const WITHER_FOLLOW_ACCELERATION = 6
export const WITHER_MAX_SPEED = 5

export type WitherPhase = 'charging' | 'airborne' | 'armoured' | 'dead'
export type WitherSkullVariant = 'normal' | 'blue'
export type WitherDamageKind = 'melee' | 'ranged' | 'magic' | 'explosion' | 'void'

export type WitherState = {
  readonly phase: WitherPhase
  readonly healthPoints: WitherHealthPoints
  readonly chargeRemainingSecs: WitherChargeRemainingSecs
  readonly feetPosition: Position
  readonly velocity: Position
}
export type WitherSnapshot = {
  readonly kind: 'wither'
  readonly version: 1
  readonly state: WitherState
}

export type WitherSkullProjectileDescriptor = {
  readonly kind: 'wither_skull'
  readonly variant: WitherSkullVariant
  readonly origin: Position
  readonly direction: Position
  readonly speed: WitherProjectileSpeed
  readonly explosivePower: WitherExplosionPower
  readonly destroysResistantBlocks: boolean
}

export type WitherDeathDescriptor = {
  readonly despawn: { readonly kind: 'wither'; readonly reason: 'killed' }
  readonly drop: { readonly item: 'nether_star'; readonly count: 1; readonly position: Position }
}

export type WitherStep = {
  readonly state: WitherState
  readonly spawnExplosion: { readonly power: 7; readonly position: Position } | undefined
}
export type WitherStepFailure = Brand.BrandError

export type WitherDamageResult = {
  readonly state: WitherState
  readonly appliedDamage: WitherDamageAmount
  readonly ignored: boolean
  readonly death: WitherDeathDescriptor | undefined
}

const PositionAxisSchema: Schema.Codec<PositionAxis, number> = Schema.Finite.pipe(
  Schema.fromBrand('PositionAxis', PositionAxis),
)
const PositionSchema: Schema.Schema<Position> = Schema.Struct({
  x: PositionAxisSchema,
  y: PositionAxisSchema,
  z: PositionAxisSchema,
})
const WitherHealthPointsSchema: Schema.Codec<WitherHealthPoints, number> = Schema.Finite.pipe(
  Schema.fromBrand('WitherHealthPoints', WitherHealthPoints),
)
const WitherChargeRemainingSecsSchema: Schema.Codec<WitherChargeRemainingSecs, number> = Schema.Finite.pipe(
  Schema.fromBrand('WitherChargeRemainingSecs', WitherChargeRemainingSecs),
)
const WitherDamageAmountSchema: Schema.Codec<WitherDamageAmount, number> = Schema.Finite.pipe(
  Schema.fromBrand('WitherDamageAmount', WitherDamageAmount),
)

export const WitherStateSchema: Schema.Schema<WitherState> = Schema.Struct({
  phase: Schema.Literals(['charging', 'airborne', 'armoured', 'dead']),
  healthPoints: WitherHealthPointsSchema,
  chargeRemainingSecs: WitherChargeRemainingSecsSchema,
  feetPosition: PositionSchema,
  velocity: PositionSchema,
})

export const WitherStepSchema: Schema.Schema<WitherStep> = Schema.Struct({
  state: WitherStateSchema,
  spawnExplosion: Schema.Union([
    Schema.Struct({ power: Schema.Literal(7), position: PositionSchema }),
    Schema.Undefined,
  ]),
})

export const WitherStepFailureSchema: Schema.Schema<WitherStepFailure> = Schema.declare(
  (value: unknown): value is WitherStepFailure => value instanceof Brand.BrandError,
)

const WitherDeathDescriptorSchema = Schema.Struct({
  despawn: Schema.Struct({ kind: Schema.Literal('wither'), reason: Schema.Literal('killed') }),
  drop: Schema.Struct({
    item: Schema.Literal('nether_star'),
    count: Schema.Literal(1),
    position: PositionSchema,
  }),
})

export const WitherDamageResultSchema: Schema.Schema<WitherDamageResult> = Schema.Struct({
  state: WitherStateSchema,
  appliedDamage: WitherDamageAmountSchema,
  ignored: Schema.Boolean,
  death: Schema.Union([WitherDeathDescriptorSchema, Schema.Undefined]),
})

export type BlockCell = { readonly x: PositionAxis; readonly y: PositionAxis; readonly z: PositionAxis }
export type WitherSummonMatch = {
  readonly axis: 'x' | 'z'
  readonly spawnPosition: Position
  readonly consumedBlocks: ReadonlyArray<BlockCell>
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const finite = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback


const positionOf = (x: number, y: number, z: number): Position =>
  position(PositionAxis(x), PositionAxis(y), PositionAxis(z))
const nonNegative = (value: number): number => Math.max(0, finite(value))
const repairPosition = (value: unknown): Position => {
  const coordinates = isRecord(value) ? value : {}
  return positionOf(
    finite(coordinates['x']),
    finite(coordinates['y']),
    finite(coordinates['z']),
  )
}
const invalidNumber = (value: unknown): Brand.BrandError =>
  new Brand.BrandError(new SchemaIssue.InvalidType(Schema.Number.ast, value))

const invalidEnvelope = (value: unknown): Brand.BrandError =>
  new Brand.BrandError(new SchemaIssue.InvalidType(Schema.Struct({}).ast, value))

const isWitherPhase = (value: unknown): value is WitherPhase =>
  value === 'charging' || value === 'airborne' || value === 'armoured' || value === 'dead'

const isPosition = (value: unknown): value is Position =>
  isRecord(value) &&
  typeof value['x'] === 'number' && PositionAxis.is(value['x']) &&
  typeof value['y'] === 'number' && PositionAxis.is(value['y']) &&
  typeof value['z'] === 'number' && PositionAxis.is(value['z'])

const isWitherState = (value: unknown): value is WitherState =>
  isRecord(value) && isWitherPhase(value['phase']) &&
  typeof value['healthPoints'] === 'number' && WitherHealthPoints.is(value['healthPoints']) &&
  typeof value['chargeRemainingSecs'] === 'number' && WitherChargeRemainingSecs.is(value['chargeRemainingSecs']) &&
  isPosition(value['feetPosition']) && isPosition(value['velocity'])

const phaseForHealth = (healthPoints: number): Exclude<WitherPhase, 'charging'> =>
  healthPoints <= 0 ? 'dead' : healthPoints <= WITHER_ARMOUR_THRESHOLD ? 'armoured' : 'airborne'

export const createWither = (feetPosition: Position): WitherState => ({
  phase: 'charging',
  healthPoints: WitherHealthPoints(WITHER_MAX_HEALTH),
  chargeRemainingSecs: WitherChargeRemainingSecs(WITHER_SPAWN_CHARGE_SECS),
  feetPosition: repairPosition(feetPosition),
  velocity: positionOf(0, 0, 0),
})

const scaledDirection = (from: Position, to: Position, magnitude: number): Position => {
  const scale = Math.max(
    Math.abs(from.x), Math.abs(from.y), Math.abs(from.z),
    Math.abs(to.x), Math.abs(to.y), Math.abs(to.z),
  )
  if (scale === 0) return positionOf(0, 0, 0)
  const dx = to.x / scale - from.x / scale
  const dy = to.y / scale - from.y / scale
  const dz = to.z / scale - from.z / scale
  const length = Math.hypot(dx, dy, dz)
  return length === 0
    ? positionOf(0, 0, 0)
    : positionOf((dx / length) * magnitude, (dy / length) * magnitude, (dz / length) * magnitude)
}

const clampVelocity = (x: number, y: number, z: number): Position => {
  const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
  if (scale === 0) return positionOf(0, 0, 0)
  const normalizedX = x / scale
  const normalizedY = y / scale
  const normalizedZ = z / scale
  const normalizedSpeed = Math.hypot(normalizedX, normalizedY, normalizedZ)
  if (scale <= WITHER_MAX_SPEED / normalizedSpeed) return positionOf(x, y, z)
  return positionOf(
    (normalizedX / normalizedSpeed) * WITHER_MAX_SPEED,
    (normalizedY / normalizedSpeed) * WITHER_MAX_SPEED,
    (normalizedZ / normalizedSpeed) * WITHER_MAX_SPEED,
  )
}

const accelerateAndClamp = (velocity: Position, acceleration: Position, delta: number): Position => {
  const x = velocity.x + acceleration.x * delta
  const y = velocity.y + acceleration.y * delta
  const z = velocity.z + acceleration.z * delta
  if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
    return clampVelocity(x, y, z)
  }

  // Dividing the updated velocity by delta preserves its direction while avoiding
  // the overflowed magnitude that clampVelocity immediately reduces.
  const scaledX = acceleration.x + velocity.x / delta
  const scaledY = acceleration.y + velocity.y / delta
  const scaledZ = acceleration.z + velocity.z / delta
  return clampVelocity(scaledX, scaledY, scaledZ)
}

export const stepWither = (
  state: WitherState,
  deltaTimeSecs: unknown,
  targetPosition?: Position,
): Result.Result<WitherStep, WitherStepFailure> => Result.gen(function* () {
  if (!isWitherState(state)) return yield* Result.fail(invalidEnvelope(state))
  if (typeof deltaTimeSecs !== 'number') return yield* Result.fail(invalidNumber(deltaTimeSecs))
  const delta = yield* DeltaTimeSecs.result(deltaTimeSecs)
  if (state.phase === 'dead') return { state, spawnExplosion: undefined }

  if (state.phase === 'charging') {
    const chargeRemainingSecs = WitherChargeRemainingSecs(Math.max(0, state.chargeRemainingSecs - delta))
    if (chargeRemainingSecs > 0) {
      return { state: { ...state, chargeRemainingSecs }, spawnExplosion: undefined }
    }
    const next = { ...state, phase: 'airborne' as const, chargeRemainingSecs: WitherChargeRemainingSecs(0) }
    return { state: next, spawnExplosion: { power: 7, position: next.feetPosition } }
  }

  const healthPoints = WitherHealthPoints(Math.min(WITHER_MAX_HEALTH, state.healthPoints + WITHER_REGEN_PER_SEC * delta))
  const phase = state.phase === 'armoured' ? 'armoured' : phaseForHealth(healthPoints)
  if (targetPosition === undefined || delta === 0) {
    return { state: { ...state, healthPoints, phase }, spawnExplosion: undefined }
  }
  const acceleration = scaledDirection(state.feetPosition, repairPosition(targetPosition), WITHER_FOLLOW_ACCELERATION)
  const velocity = accelerateAndClamp(state.velocity, acceleration, delta)
  const feetX = yield* PositionAxis.result(state.feetPosition.x + velocity.x * delta)
  const feetY = yield* PositionAxis.result(state.feetPosition.y + velocity.y * delta)
  const feetZ = yield* PositionAxis.result(state.feetPosition.z + velocity.z * delta)
  return {
    state: {
      ...state,
      phase,
      healthPoints,
      velocity,
      feetPosition: position(feetX, feetY, feetZ),
    },
    spawnExplosion: undefined,
  }
})

export const damageWither = (
  state: WitherState,
  amount: unknown,
  kind: WitherDamageKind,
): Result.Result<WitherDamageResult, WitherStepFailure> => Result.gen(function* () {
  if (!isWitherState(state)) return yield* Result.fail(invalidEnvelope(state))
  if (typeof amount !== 'number') return yield* Result.fail(invalidNumber(amount))
  const damage = yield* WitherDamageAmount.result(amount)
  if (kind !== 'melee' && kind !== 'ranged' && kind !== 'magic' && kind !== 'explosion' && kind !== 'void') {
    return yield* Result.fail(invalidEnvelope(kind))
  }
  const ignored = state.phase === 'dead' || state.phase === 'charging' || (state.phase === 'armoured' && kind === 'ranged')
  if (ignored || damage === 0) return { state, appliedDamage: WitherDamageAmount(0), ignored, death: undefined }

  const healthPoints = WitherHealthPoints(Math.max(0, state.healthPoints - damage))
  const phase = phaseForHealth(healthPoints)
  const next = { ...state, healthPoints, phase }
  const death: WitherDeathDescriptor | undefined = phase === 'dead'
    ? {
        despawn: { kind: 'wither', reason: 'killed' },
        drop: { item: 'nether_star', count: 1, position: next.feetPosition },
      }
    : undefined
  return { state: next, appliedDamage: WitherDamageAmount(state.healthPoints - healthPoints), ignored: false, death }
})

export const witherSkullProjectile = (
  origin: Position,
  target: Position,
  variant: WitherSkullVariant,
): WitherSkullProjectileDescriptor => ({
  kind: 'wither_skull',
  variant: variant === 'blue' ? 'blue' : 'normal',
  origin: repairPosition(origin),
  direction: scaledDirection(repairPosition(origin), repairPosition(target), 1),
  speed: WitherProjectileSpeed(variant === 'blue' ? 12 : 10),
  explosivePower: WitherExplosionPower(1),
  destroysResistantBlocks: variant === 'blue',
})

const add = (
  cell: BlockCell,
  dx: number,
  dy: number,
  dz: number,
): Result.Result<BlockCell, Brand.BrandError> =>
  Result.gen(function* () {
    return {
      x: yield* PositionAxis.result(cell.x + dx),
      y: yield* PositionAxis.result(cell.y + dy),
      z: yield* PositionAxis.result(cell.z + dz),
    }
  })

export const matchWitherSummon = (
  base: BlockCell,
  blockAt: (cell: BlockCell) => WitherSummonMaterial | undefined,
): Result.Result<WitherSummonMatch | undefined, Brand.BrandError> =>
  Result.gen(function* () {
    if (!isRecord(base) || typeof blockAt !== 'function') return yield* Result.fail(invalidEnvelope(base))
    if (
      typeof base['x'] !== 'number' || !Number.isFinite(base['x']) ||
      typeof base['y'] !== 'number' || !Number.isFinite(base['y']) ||
      typeof base['z'] !== 'number' || !Number.isFinite(base['z'])
    ) {
      return yield* Result.fail(invalidEnvelope(base))
    }
    const x = yield* PositionAxis.result(base.x)
    const y = yield* PositionAxis.result(base.y)
    const z = yield* PositionAxis.result(base.z)
    const validBase = { x, y, z }

    for (const axis of ['x', 'z'] as const) {
      const side = axis === 'x' ? ([1, 0, 0] as const) : ([0, 0, 1] as const)
      const body = [
        validBase,
        yield* add(validBase, 0, 1, 0),
        yield* add(validBase, side[0], 1, side[2]),
        yield* add(validBase, -side[0], 1, -side[2]),
      ]
      const skulls: Array<BlockCell> = []
      for (const offset of [-1, 0, 1]) {
        skulls.push(yield* add(validBase, side[0] * offset, 2, side[2] * offset))
      }
      if (
        body.every((cell) => blockAt(cell) === 'soul_sand' || blockAt(cell) === 'soul_soil') &&
        skulls.every((cell) => blockAt(cell) === 'wither_skeleton_skull')
      ) {
        const spawnX = yield* PositionAxis.result(x + 0.5)
        const spawnY = yield* PositionAxis.result(y + 1)
        const spawnZ = yield* PositionAxis.result(z + 0.5)
        return {
          axis,
          spawnPosition: position(spawnX, spawnY, spawnZ),
          consumedBlocks: [...body, ...skulls],
        }
      }
    }
    return undefined
  })

function normaliseWitherState(value: unknown): WitherState {
  const state = isRecord(value) ? value : {}
  const rawHealthPoints = state['healthPoints']
  const rawChargeRemainingSecs = state['chargeRemainingSecs']
  const healthPoints = WitherHealthPoints(Math.min(
    WITHER_MAX_HEALTH,
    nonNegative(typeof rawHealthPoints === 'number' ? rawHealthPoints : Number.NaN),
  ))
  const chargeRemainingSecs = WitherChargeRemainingSecs(Math.min(
    WITHER_SPAWN_CHARGE_SECS,
    nonNegative(typeof rawChargeRemainingSecs === 'number' ? rawChargeRemainingSecs : Number.NaN),
  ))
  const rawPhase = state['phase']
  const phase = healthPoints <= 0
    ? 'dead'
    : rawPhase === 'charging' && chargeRemainingSecs > 0
      ? 'charging'
      : rawPhase === 'armoured' || healthPoints <= WITHER_ARMOUR_THRESHOLD
        ? 'armoured'
        : 'airborne'
  return {
    phase,
    healthPoints,
    chargeRemainingSecs: phase === 'charging' ? chargeRemainingSecs : WitherChargeRemainingSecs(0),
    feetPosition: repairPosition(state['feetPosition']),
    velocity: repairPosition(state['velocity']),
  }
}

export const serializeWither = (state: WitherState): WitherSnapshot => ({
  kind: 'wither',
  version: 1,
  state: normaliseWitherState(state),
})

export const restoreWither = (snapshot: WitherSnapshot): WitherState =>
  normaliseWitherState(isRecord(snapshot) ? snapshot['state'] : undefined)
