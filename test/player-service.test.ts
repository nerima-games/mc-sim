import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Result, Schema } from 'effect'
import { vi } from 'vitest'
import { INITIAL_PLAYER_DIMENSION, makePlayerService, type PlayerServiceInputError } from '../src/application/player-service'
import { PLAYER_REPLICATED_OWNER_ID, PlayerServiceSnapshotSchema } from '../src/application/replicated-state'
import * as Camera from '../src/domain/camera-pose'
import { INITIAL_PLAYER_POSE } from '../src/domain/camera-pose'
import {
  DimensionRevisionSchema,
  PositionAxis,
  WorldIdSchema,
  WorldRevisionSchema,
  position as kernelPosition,
  type Dimension,
} from '@nerima-games/mc-kernel'
import { makeWorldCommitCoordinator, WorldCommitCoordinator } from '../src/application/world-commit-coordinator'

const position = (x: number, y: number, z: number) =>
  kernelPosition(PositionAxis(x), PositionAxis(y), PositionAxis(z))

/**
 * THE state this file was created for.
 *
 * `PlayerService` had six members and not one of them named a world, so
 * mc-worldgen's `resolveNetherTravel` could compute WHERE a portal comes out
 * and nothing could record that the player was now somewhere else.
 * `mx-gameplay/domain/player-port.ts` named the missing members exactly —
 * 「there is no `PlayerServiceApi.dimension` and no
 * `PlayerServiceApi.setDimension`」 — and these are they.
 */
describe('the dimension is state, and it is the player’s', () => {
  it.effect('a fresh player is in the overworld', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      expect(yield* player.dimension).toBe('overworld')
      expect(INITIAL_PLAYER_DIMENSION).toBe('overworld')
    }),
  )

  it.effect('setDimension records the switch and nothing else', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      const before = yield* player.pose

      yield* player.setDimension('nether')

      expect(yield* player.dimension).toBe('nether')
      // The pose is UNTOUCHED. `setDimension` is not a teleport; the two writes
      // are separate members and the caller pairs them.
      expect(yield* player.pose).toStrictEqual(before)
    }),
  )

  it.effect('the third member of the union is reachable, though no rule reaches it', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      yield* player.setDimension('end')
      expect(yield* player.dimension).toBe('end')
    }),
  )

  it.effect('a runtime dimension outside the kernel union fails without poisoning player state', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      const outcome = yield* Effect.result(
        Reflect.apply(player.setDimension, undefined, [null]) as Effect.Effect<void, PlayerServiceInputError>,
      )

      expect(Result.isFailure(outcome)).toBe(true)
      if (Result.isFailure(outcome)) {
        expect(outcome.failure).toStrictEqual({
          _tag: 'PlayerServiceInputError',
          reason: 'invalid-dimension',
          field: 'dimension',
        })
      }
      expect(yield* player.dimension).toBe(INITIAL_PLAYER_DIMENSION)
      const candidate = yield* player.replicatedCandidate
      expect(Result.isSuccess(Schema.decodeUnknownResult(PlayerServiceSnapshotSchema)(candidate))).toBe(true)
    }),
  )
})

/**
 * REGRESSION: moveTo and setDimension commute.
 *
 * `application/player-service.ts` says the pairing is the CALLER's to get right,
 * which is only a safe thing to say if the two orders cannot disagree. They are
 * separate `Ref.update`s over one `Ref`, so this pins that neither clobbers the
 * other's field — the failure a `{ ...current }` spread gets wrong by dropping a
 * key would show up here and nowhere else in the suite.
 */
describe('REGRESSION: a crossing is order-independent', () => {
  const destination = position(12, 70, -4)

  it.effect('move then switch, and switch then move, leave the same state', () =>
    Effect.gen(function* () {
      const moveFirst = yield* makePlayerService()
      yield* moveFirst.moveTo(destination)
      yield* moveFirst.setDimension('nether')

      const switchFirst = yield* makePlayerService()
      yield* switchFirst.setDimension('nether')
      yield* switchFirst.moveTo(destination)

      expect(yield* moveFirst.dimension).toBe(yield* switchFirst.dimension)
      expect(yield* moveFirst.pose).toStrictEqual(yield* switchFirst.pose)
      expect(yield* moveFirst.pose).toStrictEqual({
        ...INITIAL_PLAYER_POSE,
        feetPosition: destination,
      })
    }),
  )

  it.effect('look does not disturb the dimension', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      yield* player.setDimension('nether')
      yield* player.look(0.5, 0.25)
      expect(yield* player.dimension).toBe('nether')
    }),
  )
})

/**
 * REGRESSION: a save taken in the Nether does not open in the Overworld.
 *
 * This is the failure the required second parameter of `restore` exists to make
 * unrepresentable. With an optional parameter — or a separate setter a caller
 * could forget — restoring a Nether save would put the player at the saved
 * coordinates in the Overworld, with no crash and no error, and the only
 * available bug report is 「セーブが変な場所で開く」.
 */
describe('REGRESSION: restore carries both halves of a location', () => {
  it.effect('restore installs the dimension it was given', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      const saved = { ...INITIAL_PLAYER_POSE, feetPosition: position(100, 40, 100) }

      yield* player.restore(saved, 'nether')

      expect(yield* player.dimension).toBe('nether')
      expect(yield* player.pose).toStrictEqual(saved)
    }),
  )

  it.effect('restore overwrites a dimension already set', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      yield* player.setDimension('end')

      yield* player.restore(INITIAL_PLAYER_POSE, 'overworld')

      expect(yield* player.dimension).toBe('overworld')
    }),
  )
})

/**
 * REGRESSION: reset discards the dimension too (DN-09).
 *
 * A `reset` that returns the pose to spawn while leaving the player in the
 * Nether is a teardown path that silently keeps one field of the world it was
 * told to discard — the shape `docs/responsibility.md` §3.6 records for
 * `SettingsService.reset`, where a host wired to a world-teardown path produced
 * a defect nobody could write a bug report for.
 */
describe('REGRESSION: reset is a whole fresh world', () => {
  it.effect('reset returns both pose and dimension to the fresh-world values', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      yield* player.moveTo(position(-800, 12, 640))
      yield* player.setDimension('nether')

      yield* player.reset

      expect(yield* player.dimension).toBe(INITIAL_PLAYER_DIMENSION)
      expect(yield* player.pose).toStrictEqual(INITIAL_PLAYER_POSE)
    }),
  )

  it.effect('a service constructed in the nether still resets to the overworld', () =>
    Effect.gen(function* () {
      const nether: Dimension = 'nether'
      const player = yield* makePlayerService(INITIAL_PLAYER_POSE, nether)
      expect(yield* player.dimension).toBe('nether')

      yield* player.reset

      expect(yield* player.dimension).toBe('overworld')
    }),
  )
})
describe('REGRESSION: invalid runtime poses do not enter player state', () => {
  it.effect('look rejects non-finite deltas and leaves the pose unchanged', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      const before = yield* player.pose

      const yawFailure = yield* Effect.flip(player.look(Number.NaN, 0))
      const pitchFailure = yield* Effect.flip(player.look(0, Number.POSITIVE_INFINITY))

      expect(yawFailure).toStrictEqual({
        _tag: 'PlayerServiceInputError',
        reason: 'invalid-look',
        field: 'deltaYaw',
      })
      expect(pitchFailure).toStrictEqual({
        _tag: 'PlayerServiceInputError',
        reason: 'invalid-look',
        field: 'deltaPitch',
      })
      expect(yield* player.pose).toStrictEqual(before)
    }),
  )

  it.effect('look rejects a finite delta whose accumulated yaw overflows', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      yield* player.look(Number.MAX_VALUE, 0)
      const before = yield* player.pose

      const failure = yield* Effect.flip(player.look(Number.MAX_VALUE, 0))

      expect(failure).toStrictEqual({
        _tag: 'PlayerServiceInputError',
        reason: 'invalid-look',
        field: 'yawRadians',
      })
      expect(yield* player.pose).toStrictEqual(before)
    }),
  )

  it.effect('construction rejects a non-finite initial pose', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(makePlayerService({ ...INITIAL_PLAYER_POSE, pitchRadians: Number.NaN }))

      expect(failure).toStrictEqual({
        _tag: 'PlayerServiceInputError',
        reason: 'invalid-pose',
        field: 'pitchRadians',
      })
    }),
  )

  it.effect('construction rejects a missing runtime pose', () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(makePlayerService(JSON.parse('null')))

      expect(failure).toStrictEqual({
        _tag: 'PlayerServiceInputError',
        reason: 'invalid-pose',
        field: 'pose',
      })
    }),
  )

  it.effect('restore rejects a non-finite pose and preserves pose and dimension', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      yield* player.setDimension('nether')
      const beforePose = yield* player.pose
      const beforeDimension = yield* player.dimension

      const missingFailure = yield* Effect.flip(player.restore(JSON.parse('null'), 'end'))
      const failure = yield* Effect.flip(
        player.restore({ ...INITIAL_PLAYER_POSE, yawRadians: Number.POSITIVE_INFINITY }, 'end'),
      )

      expect(missingFailure).toStrictEqual({
        _tag: 'PlayerServiceInputError',
        reason: 'invalid-pose',
        field: 'pose',
      })
      expect(failure).toStrictEqual({
        _tag: 'PlayerServiceInputError',
        reason: 'invalid-pose',
        field: 'yawRadians',
      })
      expect(yield* player.pose).toStrictEqual(beforePose)
      expect(yield* player.dimension).toBe(beforeDimension)
    }),
  )

  it.effect('restore rejects a non-finite feet coordinate', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      const malformedPose = JSON.parse('{"feetPosition":{"x":0,"y":null,"z":0},"yawRadians":0,"pitchRadians":0}')

      const failure = yield* Effect.flip(player.restore(malformedPose, 'nether'))

      expect(failure).toStrictEqual({
        _tag: 'PlayerServiceInputError',
        reason: 'invalid-pose',
        field: 'feetPosition.y',
      })
      expect(yield* player.pose).toStrictEqual(INITIAL_PLAYER_POSE)
      expect(yield* player.dimension).toBe('overworld')
    }),
  )

  it.effect('moveTo rejects each non-finite runtime coordinate and preserves the pose', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      const before = yield* player.pose
      const invalidPositions = [
        JSON.parse('null'),
        JSON.parse('{"x":null,"y":0,"z":0}'),
        JSON.parse('{"x":0,"y":null,"z":0}'),
        JSON.parse('{"x":0,"y":0,"z":null}'),
      ]

      const failures = yield* Effect.forEach(invalidPositions, (invalidPosition) =>
        Effect.flip(player.moveTo(invalidPosition)),
      )

      expect(failures.map((failure) => failure.field)).toStrictEqual([
        'feetPosition',
        'feetPosition.x',
        'feetPosition.y',
        'feetPosition.z',
      ])
      expect(failures.every((failure) => failure.reason === 'invalid-position')).toBe(true)
      expect(yield* player.pose).toStrictEqual(before)
    }),
  )

  it.effect('reports camera failures and rejects invalid poses returned by the camera boundary', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      const cameraFailure = Result.fail({ _tag: 'CameraPoseInputError', field: 'pose' } as const)
      const failedApply = vi.spyOn(Camera, 'applyLook').mockReturnValue(cameraFailure)
      try {
        const failure = yield* Effect.flip(player.look(0, 0))
        expect(failure).toMatchObject({
          _tag: 'PlayerServiceInputError',
          reason: 'invalid-look',
          field: 'pitchRadians',
        })
      } finally {
        failedApply.mockRestore()
      }

      const invalidPose = { ...INITIAL_PLAYER_POSE, yawRadians: Number.NaN }
      const invalidApply = vi.spyOn(Camera, 'applyLook').mockReturnValue(Result.succeed(invalidPose))
      try {
        const failure = yield* Effect.flip(player.look(0, 0))
        expect(failure).toMatchObject({
          _tag: 'PlayerServiceInputError',
          reason: 'invalid-look',
          field: 'yawRadians',
        })
      } finally {
        invalidApply.mockRestore()
      }
    }),
  )
})
describe('PlayerService replicated snapshots', () => {
  it.effect('reads committed state at the coordinator revision and submits local candidates through its owner API', () =>
    Effect.gen(function* () {
      const player = yield* makePlayerService()
      const initialCandidate = yield* player.replicatedCandidate
      const world = yield* Schema.decodeUnknownEffect(WorldIdSchema)('player-world')
      const revisionZero = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(0)
      const revisionOne = yield* Schema.decodeUnknownEffect(WorldRevisionSchema)(1)
      const dimensionRevisionZero = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(0)
      const dimensionRevisionOne = yield* Schema.decodeUnknownEffect(DimensionRevisionSchema)(1)
      const coordinator = yield* makeWorldCommitCoordinator({
        world,
        owners: [{
          ownerId: PLAYER_REPLICATED_OWNER_ID,
          schema: PlayerServiceSnapshotSchema,
          initialState: initialCandidate,
        }],
      })
      const coordinatorLayer = Layer.succeed(WorldCommitCoordinator, coordinator)
      const destination = position(12, 70, -4)

      yield* player.moveTo(destination)
      yield* player.setDimension('nether')
      yield* player.look(0.5, 0.25)
      const beforeCommit = yield* Effect.provide(player.snapshot, coordinatorLayer)

      expect(beforeCommit.revision).toBe(0)
      expect(beforeCommit.state.pose.feetPosition).toStrictEqual({
        dimension: 'overworld',
        x: 0,
        y: 0,
        z: 0,
      })

      const delta = yield* Effect.provide(
        player.submitReplicatedCandidate(revisionZero, dimensionRevisionZero),
        coordinatorLayer,
      )
      const committed = yield* Effect.provide(player.snapshot, coordinatorLayer)

      expect(delta.revision).toBe(1)
      expect(delta.changes.map(({ owner }) => owner)).toStrictEqual([PLAYER_REPLICATED_OWNER_ID])
      expect(committed.revision).toBe(delta.revision)
      expect(committed.state.pose.feetPosition).toStrictEqual({
        dimension: 'nether',
        x: 12,
        y: 70,
        z: -4,
      })
      expect(committed.state.pose.yawRadians).toBe(0.5)
      expect(committed.state.pose.pitchRadians).toBe(0.25)
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(1)
      expect(yield* coordinator.dimensionRevision('nether')).toBe(1)

      yield* player.look(0.25, 0)
      const sameDimensionDelta = yield* Effect.provide(
        player.submitReplicatedCandidate(revisionOne, dimensionRevisionOne),
        coordinatorLayer,
      )
      expect(sameDimensionDelta.revision).toBe(2)
      expect(yield* coordinator.dimensionRevision('overworld')).toBe(1)
      expect(yield* coordinator.dimensionRevision('nether')).toBe(2)
    }),
  )
})
