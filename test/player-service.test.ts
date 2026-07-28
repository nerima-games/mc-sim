import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { INITIAL_PLAYER_DIMENSION, makePlayerService } from '../application/player-service'
import { INITIAL_PLAYER_POSE } from '../domain/camera-pose'
import { position } from '../domain/kernel-vocabulary'
import type { Dimension } from '../domain/worldgen-vocabulary'

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
