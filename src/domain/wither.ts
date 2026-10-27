import { Brand, Result } from 'effect'
import { PositionAxis, position, type Position } from '@nerima-games/mc-kernel'

export const WITHER_MAX_HEALTH = 300
export const WITHER_SPAWN_CHARGE_SECS = 10
export const WITHER_ARMOUR_THRESHOLD: number = WITHER_MAX_HEALTH / 2
export const WITHER_REGEN_PER_SEC = 1
export const WITHER_FOLLOW_ACCELERATION = 6
export const WITHER_MAX_SPEED = 5

export type WitherPhase = 'charging' | 'airborne' | 'armoured' | 'dead'
export type WitherSkullVariant = 'normal' | 'blue'
export type WitherDamageKind = 'melee' | 'ranged' | 'magic' | 'explosion' | 'void'

export type WitherState = {
  readonly phase: WitherPhase
  readonly healthPoints: number
  readonly chargeRemainingSecs: number
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
  readonly speed: number
  readonly explosivePower: number
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
  readonly appliedDamage: number
  readonly ignored: boolean
  readonly death: WitherDeathDescriptor | undefined
}

export type BlockCell = { readonly x: number; readonly y: number; readonly z: number }
export type WitherSummonMaterial = 'air' | 'soul_sand' | 'soul_soil' | 'wither_skeleton_skull' | string
export type WitherSummonMatch = {
  readonly axis: 'x' | 'z'
  readonly spawnPosition: Position
  readonly consumedBlocks: ReadonlyArray<BlockCell>
}

const finite = (value: number, fallback = 0): number => (Number.isFinite(value) ? value : fallback)


const positionOf = (x: number, y: number, z: number): Position =>
  position(PositionAxis(x), PositionAxis(y), PositionAxis(z))
const nonNegative = (value: number): number => Math.max(0, finite(value))
const repairPosition = (value: Position): Position =>
  positionOf(finite(value?.x), finite(value?.y), finite(value?.z))

const phaseForHealth = (healthPoints: number): Exclude<WitherPhase, 'charging'> =>
  healthPoints <= 0 ? 'dead' : healthPoints <= WITHER_ARMOUR_THRESHOLD ? 'armoured' : 'airborne'

export const createWither = (feetPosition: Position): WitherState => ({
  phase: 'charging',
  healthPoints: WITHER_MAX_HEALTH,
  chargeRemainingSecs: WITHER_SPAWN_CHARGE_SECS,
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

  // Scale by delta before multiplying so a large finite timestep cannot overflow
  // the velocity that is immediately capped to WITHER_MAX_SPEED.
  const scaledX = acceleration.x + velocity.x / delta
  const scaledY = acceleration.y + velocity.y / delta
  const scaledZ = acceleration.z + velocity.z / delta
  const scaledSpeed = Math.hypot(scaledX, scaledY, scaledZ)
  if (scaledSpeed === 0) return positionOf(0, 0, 0)
  if (scaledSpeed > WITHER_MAX_SPEED / delta) {
    return clampVelocity(scaledX, scaledY, scaledZ)
  }
  return clampVelocity(scaledX * delta, scaledY * delta, scaledZ * delta)
}

export const stepWither = (
  state: WitherState,
  deltaTimeSecs: number,
  targetPosition?: Position,
): Result.Result<WitherStep, WitherStepFailure> => Result.gen(function* () {
  if (state.phase === 'dead') return { state, spawnExplosion: undefined }
  const delta = nonNegative(deltaTimeSecs)

  if (state.phase === 'charging') {
    const chargeRemainingSecs = Math.max(0, state.chargeRemainingSecs - delta)
    if (chargeRemainingSecs > 0) {
      return { state: { ...state, chargeRemainingSecs }, spawnExplosion: undefined }
    }
    const next = { ...state, phase: 'airborne' as const, chargeRemainingSecs: 0 }
    return { state: next, spawnExplosion: { power: 7, position: next.feetPosition } }
  }

  const healthPoints = Math.min(WITHER_MAX_HEALTH, state.healthPoints + WITHER_REGEN_PER_SEC * delta)
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
  amount: number,
  kind: WitherDamageKind,
): WitherDamageResult => {
  const damage = nonNegative(amount)
  const ignored = state.phase === 'dead' || state.phase === 'charging' || (state.phase === 'armoured' && kind === 'ranged')
  if (ignored || damage === 0) return { state, appliedDamage: 0, ignored, death: undefined }

  const healthPoints = Math.max(0, state.healthPoints - damage)
  const phase = phaseForHealth(healthPoints)
  const next = { ...state, healthPoints, phase }
  const death: WitherDeathDescriptor | undefined = phase === 'dead'
    ? {
        despawn: { kind: 'wither', reason: 'killed' },
        drop: { item: 'nether_star', count: 1, position: next.feetPosition },
      }
    : undefined
  return { state: next, appliedDamage: state.healthPoints - healthPoints, ignored: false, death }
}

export const witherSkullProjectile = (
  origin: Position,
  target: Position,
  variant: WitherSkullVariant,
): WitherSkullProjectileDescriptor => ({
  kind: 'wither_skull',
  variant,
  origin: repairPosition(origin),
  direction: scaledDirection(repairPosition(origin), repairPosition(target), 1),
  speed: variant === 'blue' ? 12 : 10,
  explosivePower: 1,
  destroysResistantBlocks: variant === 'blue',
})

const add = (cell: BlockCell, dx: number, dy: number, dz: number): BlockCell => ({
  x: cell.x + dx,
  y: cell.y + dy,
  z: cell.z + dz,
})

export const matchWitherSummon = (
  base: BlockCell,
  blockAt: (cell: BlockCell) => WitherSummonMaterial | undefined,
): Result.Result<WitherSummonMatch | undefined, Brand.BrandError> =>
  Result.gen(function* () {
    const x = yield* PositionAxis.result(base.x)
    const y = yield* PositionAxis.result(base.y)
    const z = yield* PositionAxis.result(base.z)
    const validBase = { x, y, z }

    for (const axis of ['x', 'z'] as const) {
      const side = axis === 'x' ? ([1, 0, 0] as const) : ([0, 0, 1] as const)
      const body = [validBase, add(validBase, 0, 1, 0), add(validBase, side[0], 1, side[2]), add(validBase, -side[0], 1, -side[2])]
      const skulls = [-1, 0, 1].map((offset) => add(validBase, side[0] * offset, 2, side[2] * offset))
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

export const serializeWither = (state: WitherState): WitherSnapshot => ({ kind: 'wither', version: 1, state })

export const restoreWither = (snapshot: WitherSnapshot): WitherState => {
  const healthPoints = Math.min(WITHER_MAX_HEALTH, nonNegative(snapshot.state.healthPoints))
  const chargeRemainingSecs = Math.min(WITHER_SPAWN_CHARGE_SECS, nonNegative(snapshot.state.chargeRemainingSecs))
  const phase = healthPoints <= 0
    ? 'dead'
    : snapshot.state.phase === 'charging' && chargeRemainingSecs > 0
      ? 'charging'
      : snapshot.state.phase === 'armoured' || healthPoints <= WITHER_ARMOUR_THRESHOLD
        ? 'armoured'
        : 'airborne'
  return {
    phase,
    healthPoints,
    chargeRemainingSecs: phase === 'charging' ? chargeRemainingSecs : 0,
    feetPosition: repairPosition(snapshot.state.feetPosition),
    velocity: repairPosition(snapshot.state.velocity),
  }
}
