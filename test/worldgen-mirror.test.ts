/**
 * The mc-worldgen mirror is pinned against mc-worldgen's published union.
 *
 * ---------------------------------------------------------------------------
 * What this file is defending against, and why it cannot be defended elsewhere
 * ---------------------------------------------------------------------------
 *
 * `domain/worldgen-vocabulary.ts` carries exactly one declaration —
 * `Dimension`, a three-member closed literal union — and for a closed union
 * MEMBERSHIP IS THE TYPE. A copy that loses `'end'`, or gains a fourth member,
 * or renames one, is a DIFFERENT TYPE under the same name. It typechecks here,
 * passes every other test in this repository, and fails on the day
 * `@nerima-games/mc-worldgen` is published and the import is repointed.
 *
 * `mc-dev-meta`'s `pnpm check:mirrors` carries a row for this file and CANNOT
 * catch that. Its two probe kinds read runtime values, and a type-only module
 * exports none; the row's own comment says so in the first person. This test is
 * the weaker guarantee that stands in until a roster probe exists — weaker
 * because mc-sim could edit it in the same commit that breaks the mirror, which
 * is exactly what happened to `ITEM_TYPES` when it sat at 23 literals against
 * kernel's 97 for a week while `check:mirrors` reported `ok` on every run.
 *
 * So the union is asserted in BOTH DIRECTIONS at compile time. One direction
 * catches a narrowing; the other catches a widening, and the widening is the
 * more dangerous one — a mirror wider than its source accepts a value the
 * source rejects, and the rejection arrives at the seam rather than here.
 */
import { describe, expect, it } from 'vitest'
import type { Dimension } from '../src/domain/worldgen-vocabulary'

/**
 * mc-worldgen's roster, transcribed from `domain/nether-travel.ts`.
 *
 * Written out rather than imported because mc-worldgen is not published — the
 * same reason the mirror exists at all. When it is published, this array is
 * deleted and the assertions below run against the real union.
 */
const WORLDGEN_DIMENSIONS = ['overworld', 'nether', 'end'] as const

type WorldgenDimension = (typeof WORLDGEN_DIMENSIONS)[number]

/**
 * Both directions, at compile time.
 *
 * `Exclude<A, B>` is `never` exactly when every member of A is a member of B, so
 * a mirror that drops `'end'` makes the first alias `'end'` rather than `never`
 * and the assignment below stops compiling. A mirror that INVENTS a member
 * breaks the second. Neither is a runtime failure, which is why they are here as
 * types rather than expectations.
 */
type MissingFromMirror = Exclude<WorldgenDimension, Dimension>
type ExtraInMirror = Exclude<Dimension, WorldgenDimension>

const _noMemberIsMissing: MissingFromMirror extends never ? true : false = true
const _noMemberIsInvented: ExtraInMirror extends never ? true : false = true

describe('the mc-worldgen mirror has not drifted', () => {
  it('pins the compile-time assertions so they are not dead code', () => {
    // The two constants above are the real test and a reader could mistake them
    // for unused declarations; naming them here is what stops someone deleting
    // them as lint noise, which is how a compile-time assertion usually dies.
    expect(_noMemberIsMissing).toBe(true)
    expect(_noMemberIsInvented).toBe(true)
  })

  it('carries three dimensions, and the third is the unreachable one', () => {
    expect(WORLDGEN_DIMENSIONS).toHaveLength(3)
    // `'end'` is reachable by NO rule in this repository and is mirrored anyway.
    // `mc-worldgen/domain/nether-travel.ts` gives the reason: a mirror of
    // two-thirds of a type is the drift every mirror header is about.
    expect(WORLDGEN_DIMENSIONS).toContain('end')
  })

  it('every member is assignable to the mirrored type', () => {
    const asDimensions: ReadonlyArray<Dimension> = WORLDGEN_DIMENSIONS
    expect(asDimensions).toStrictEqual(['overworld', 'nether', 'end'])
  })
})
