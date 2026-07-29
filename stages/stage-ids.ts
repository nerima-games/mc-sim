/**
 * Every `StageId` this repository writes down, in one file.
 *
 * See `../domain/kernel-vocabulary.ts` for why a stage id is a string and what
 * that implies: naming one creates no import and no dependency edge, so an
 * `after` constraint is invisible to `pnpm check:deps`. Collecting them here is
 * what makes them reviewable, and `test/stage-registration.test.ts` reads this
 * file and fails if an edge points somewhere it should not.
 *
 * ---------------------------------------------------------------------------
 * The live defect this file closes
 * ---------------------------------------------------------------------------
 *
 * FOUR repositories declare `after: [StageId('sim:physics')]`:
 *
 *   mx-gameplay/stages/stage-ids.ts:71   `gameplay:interactions`
 *   mx-redstone/stages/stage-ids.ts:57   `redstone:power`
 *   mx-ui/stages/stage-ids.ts:49         `ui:hud-sync`
 *   mc-render/stages/stage-ids.ts:124    `render:camera-mirror`
 *
 * Those are ALL FOUR of the roster's cross-repository ordering edges — every
 * other `after` in the whole 16-repository roster names a stage in the same
 * repository as the stage declaring it. And until this file existed, mc-sim had
 * no `stages/` directory at all, so all four dangled.
 *
 * A dangling edge is not an error: mc-compose's `resolveStageOrder` drops it and
 * reports it, because "run me after input, if there is input" is a sanctioned
 * idiom (`mc-kernel/domain/frame.ts`). But that idiom is for edges that MIGHT
 * not be there. Here the frame's only inter-repository ordering was resolved by
 * mc-compose's skeleton alone, with every declared cross-repository constraint
 * silently deleted first — and no single repository could see that, because each
 * of the four can only see its own edge.
 *
 * mc-compose measured the consequence and it is worth stating exactly, because
 * it is smaller than it sounds and the smallness is the point: binding these
 * four edges does NOT move the resolved frame. The skeleton already put physics
 * before interactions, redstone, hud-sync and camera-mirror, so the newly-bound
 * edges are implied by it. What changes is that the ordering is now DECLARED as
 * well as arranged — the four modules' stated requirements are met by a stage
 * that exists, rather than being dropped on the way in and happening to be
 * satisfied anyway.
 */
import { StageId } from '../domain/kernel-vocabulary'

/**
 * Stages owned by mc-sim.
 *
 * ---------------------------------------------------------------------------
 * Why exactly one
 * ---------------------------------------------------------------------------
 *
 * Three things in this repository plausibly happen "every frame". Only one of
 * them is a stage:
 *
 * - `application/game-loop.ts` — NOT a stage. It is the thing that CALLS the
 *   stages: `submitFrame` offers an instant, the daemon computes the clamped
 *   delta and invokes the `FrameHandler` that mc-compose assembles from the
 *   resolved order. A stage that drove the loop would be the loop scheduling
 *   itself.
 *
 * - `application/autosave.ts` — NOT a stage. It is a `Schedule.spaced` daemon
 *   forked with `Effect.forkDaemon`, and its whole design turns on being on a
 *   DURATION rather than on a frame: `spaced` measures from the end of the
 *   previous save so a backgrounded tab cannot produce a catch-up stampede, and
 *   the first save is due at t = interval rather than on the fork. Making it a
 *   stage would save once per frame, which is not a smaller version of the same
 *   thing but a different one.
 *
 * - advancing the world by one frame — a stage, and the one below. This is the
 *   work that must happen exactly once per frame, and anything that must happen
 *   exactly once per frame is a stage by definition.
 */
export const SIM_STAGE_IDS = {
  /**
   * Advance the authoritative simulation by one frame.
   *
   * The id is not a choice: four repositories already name `sim:physics` in an
   * `after` edge, so this is the id that has to exist and this is the stage
   * their edges are about. See the module header.
   *
   * What it advances is argued for at the registration itself
   * (`registration.ts`) — the world clock through `TimeService`, and the
   * player's resolved pose through `PlayerService`. Both are writes THROUGH the
   * services that already own that state; the stage holds none of its own.
   */
  physics: StageId('sim:physics'),
} as const

/**
 * Stages owned by OTHER repositories that mc-sim orders itself against.
 *
 * EMPTY, and deliberately so rather than by omission — an absence nobody wrote
 * down is indistinguishable from an oversight, which is the failure this whole
 * directory exists to repair.
 *
 * plan.md §4.2's skeleton puts `input` before simulation, so the tempting
 * declaration is `after: [StageId('render:input')]`. Three independent reasons
 * not to:
 *
 * 1. IT IS A CLAIM ABOUT THE GLOBAL ORDER, which plan.md §2.3-3 reserves to
 *    mc-compose. mx-gameplay's `stages/stage-ids.ts:50-58` refuses the same edge
 *    for the same reason, in almost these words: "Declare what your own
 *    correctness needs; let mc-compose have the rest." mc-sim is the bottom of
 *    the experience-facing order, so what its own correctness needs is nothing.
 *
 * 2. mc-sim CANNOT SEE mc-render. `mc-render -> mc-sim` is a declared edge, so
 *    the reverse is an outright cycle and `pnpm check:deps` rejects it. An
 *    `after` edge would evade that gate — it is a string — while coupling this
 *    repository's frame position to a repository that depends on it. That is the
 *    camera-ownership inversion of plan.md §3.8 reappearing in the frame order
 *    instead of in a type.
 *
 * 3. IT WOULD NOT BE TRUE OF EVERY BUILD. A headless server, a scenario test and
 *    `apps/preview-sim` all run a frame with no input stage registered at all.
 *    The simulation does not stop being correct in those builds, so the
 *    constraint is not this repository's.
 *
 * The stage-prefix guard in `test/stage-registration.test.ts` reads this object;
 * it stays meaningful when the object is empty, because what it asserts is that
 * nothing has been ADDED that names an experience module.
 */
export const UPSTREAM_STAGE_IDS = {} as const satisfies Readonly<Record<string, StageId>>

/**
 * The `<repo>:` prefixes belonging to the four experience modules (plan.md
 * §2.2). Used by the regression test that enforces §2.3-1's zero-edge rule at
 * the ordering level as well as at the import level.
 *
 * mc-sim is a foundation module and none of these is its own prefix, so for this
 * repository the rule is total: an `after` edge starting with ANY of them is
 * wrong. mc-sim is the parent of all four; ordering itself against a child would
 * invert the dependency exactly as reason 2 above describes, and would pass
 * `pnpm check:deps` while doing it.
 */
export const EXPERIENCE_MODULE_STAGE_PREFIXES = ['gameplay:', 'redstone:', 'ui:', 'multiplayer:'] as const

/** This repository's own prefix. */
export const OWN_STAGE_PREFIX = 'sim:'
