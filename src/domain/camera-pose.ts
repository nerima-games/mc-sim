/**
 * Camera pose — owned here, mirrored by mc-render.
 *
 * ---------------------------------------------------------------------------
 * The inversion this file exists to prevent
 * ---------------------------------------------------------------------------
 *
 * In the reference implementation the THREE camera object was the authority.
 * Simulation-facing code read its gaze back out of the renderer:
 *
 *   ts-minecraft/packages/app/application/frame/stages/attack-targeting.ts:18,24
 *     camera.getWorldDirection(scratchCameraDirection)
 *     const rayOrigin = camera.position
 *   ts-minecraft/packages/app/application/frame/stages/entity-update-stage.ts:182,189
 *     mob AI consumed `deps.camera.position` directly
 *   ts-minecraft/packages/app/application/frame/stages/interaction-bow-handler.ts:105,123-124
 *   ts-minecraft/packages/app/application/frame/stages/interaction-melee-handler.ts:142,213
 *   ts-minecraft/packages/app/application/frame/stages/interaction-right-click-handler.ts:73
 *   ts-minecraft/packages/app/application/frame/stages/interaction-stage-underwater.ts:37,42-44
 *   ...and seven more call sites.
 *
 * The rotation half of the truth did live in the simulation
 * (ts-minecraft/packages/entity/application/camera-state.ts, no THREE import),
 * and the render stage wrote it into the camera
 * (ts-minecraft/packages/app/application/frame/stages/camera-stage.ts:63-67).
 * So the pose travelled sim -> THREE -> sim, and the round trip is where the
 * chronic gotcha came from:
 *
 *   ts-minecraft/packages/app/application/main/qa-api-visual.ts:17-19
 *     // World position via matrixWorld — the frame composes the camera pose
 *     // into matrixWorld directly, so `.position` can be stale (or the origin).
 *
 * The mechanism is visible at
 * ts-minecraft/packages/app/application/frame/stages/render-stage.ts:41-48 and
 * :98-100: the render stage snapshots the camera, MUTATES the live object for
 * the attack-swing bob (`translateX`/`translateY`/`rotateZ`), and restores it
 * inside `Effect.ensuring`. Between those two points `.position` and
 * `matrixWorld` disagree, and any simulation code reading the camera in that
 * window silently gets the weapon-bob pose instead of the player's.
 *
 * ---------------------------------------------------------------------------
 * The replacement
 * ---------------------------------------------------------------------------
 *
 * mc-sim owns a `CameraPoseSnapshot` and publishes it once per frame.
 * mc-render mirrors it into a THREE camera and NEVER writes back. The
 * dependency graph makes the wrong direction unrepresentable: mc-render depends
 * on mc-sim, so mc-sim cannot depend on mc-render without a cycle, and the
 * dependency policy rejects cycles outright.
 *
 * A cosmetic effect such as the attack-swing bob therefore belongs entirely to
 * mc-render, applied on top of the mirrored pose and never folded back into it.
 * The simulation's answer to "where is the player looking" is unaffected by
 * whether a sword is currently swinging.
 */
import type { CameraPoseSnapshot, MonotonicTimeSecs, Position } from "@nerima-games/mc-kernel"
import { position } from "@nerima-games/mc-kernel"

/**
 * Pitch bound, radians.
 *
 * Not exactly ±π/2. At exactly straight up or straight down the forward vector
 * becomes parallel to the up vector and the yaw is no longer recoverable from
 * the orientation — gimbal lock, seen by the player as the view snapping to an
 * arbitrary heading. The reference uses the same epsilon
 * (ts-minecraft/packages/entity/domain/camera-state.ts:12-13).
 */
export const PITCH_EPSILON = 0.01
export const PITCH_MAX_RADIANS = Math.PI / 2 - PITCH_EPSILON
export const PITCH_MIN_RADIANS = -PITCH_MAX_RADIANS

/** Eye height above the player's feet origin, in blocks. */
export const EYE_LEVEL_OFFSET = 1.62

/**
 * Player pose, as the simulation holds it.
 *
 * Note `feetPosition`, not `position`. plan.md §3.4 records that in the
 * reference EVERY "things are floating" bug was a mismatch between a
 * feet-origin convention and an AABB-centre convention. The field name carries
 * the convention so that a mistake reads wrongly at the call site.
 */
export type PlayerPose = {
  readonly feetPosition: Position
  readonly yawRadians: number
  readonly pitchRadians: number
}

export const INITIAL_PLAYER_POSE: PlayerPose = {
  feetPosition: position(0, 0, 0),
  yawRadians: 0,
  pitchRadians: 0,
}

/** Clamp a pitch into the gimbal-safe range. */
export const clampPitch = (pitchRadians: number): number =>
  Math.max(PITCH_MIN_RADIANS, Math.min(PITCH_MAX_RADIANS, pitchRadians))

/**
 * Apply a look delta.
 *
 * Yaw is NOT wrapped into [0, 2π). Wrapping would make "how far did the view
 * turn between these two frames" ambiguous at the seam, and consumers that care
 * about the absolute heading can normalise themselves. Pitch IS clamped,
 * because unlike yaw it has a physical limit.
 */
export const applyLook = (pose: PlayerPose, deltaYaw: number, deltaPitch: number): PlayerPose => ({
  ...pose,
  yawRadians: pose.yawRadians + deltaYaw,
  pitchRadians: clampPitch(pose.pitchRadians + deltaPitch),
})

export const withFeetPosition = (pose: PlayerPose, feetPosition: Position): PlayerPose => ({
  ...pose,
  feetPosition,
})

/**
 * Produce the snapshot mc-render will mirror.
 *
 * `capturedAtSecs` must come from `ClockPort`. It is a parameter rather than a
 * clock read inside this function so that the function stays pure and the
 * caller — `application/simulation.ts` — remains the single place where time
 * enters the simulation.
 *
 * The eye offset is applied HERE, not in the renderer. If the renderer applied
 * it, the simulation's notion of the ray origin for block targeting and the
 * renderer's notion of the eye would be two independent implementations of the
 * same rule, and they would eventually disagree by a fraction of a block —
 * which the player experiences as "I clicked the block above the one I aimed
 * at".
 */
export const cameraPoseOf = (pose: PlayerPose, capturedAtSecs: MonotonicTimeSecs): CameraPoseSnapshot => ({
  position: position(pose.feetPosition.x, pose.feetPosition.y + EYE_LEVEL_OFFSET, pose.feetPosition.z),
  yawRadians: pose.yawRadians,
  pitchRadians: pose.pitchRadians,
  capturedAtSecs,
})

/**
 * Unit forward vector implied by a snapshot.
 *
 * Provided so that no consumer ever needs to ask a THREE camera for its world
 * direction. This is the sanctioned answer to "where is the player looking",
 * and it is computable in Node with no renderer present — which is what makes
 * the block-targeting scenario tests headless.
 *
 * Convention: yaw 0 looks down -Z, yaw increases towards -X (THREE's 'YXZ'
 * Euler order, matching ts-minecraft/packages/app/application/frame/stages/camera-stage.ts:67).
 */
export type CameraOrientation = Pick<CameraPoseSnapshot, 'yawRadians' | 'pitchRadians'>

export const forwardVector = (snapshot: CameraOrientation): Position => {
  const cosPitch = Math.cos(snapshot.pitchRadians)
  return position(
    -Math.sin(snapshot.yawRadians) * cosPitch,
    Math.sin(snapshot.pitchRadians),
    -Math.cos(snapshot.yawRadians) * cosPitch,
  )
}

/**
 * Age of a snapshot at a given instant, in seconds. Negative under clock skew,
 * which is a real condition (a worker stamping a pose ahead of the reader) and
 * is surfaced rather than clamped away.
 */
export const snapshotAgeSecs = (snapshot: CameraPoseSnapshot, now: MonotonicTimeSecs): number =>
  now - snapshot.capturedAtSecs
