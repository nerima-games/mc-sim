/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-worldgen`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * mc-worldgen is a legitimate `dependencies` edge for mc-sim — `docs/
 * responsibility.md` §4 lists it among the parents, for reading blocks on the
 * physics path — so this mirror stands in for an UNPUBLISHED import rather than
 * a forbidden one. plan.md §6 Step 3 publishes bottom-up and nothing is on
 * GitHub Packages yet, so `scripts/check-dependency-whitelist.ts` would reject
 * an import of a package absent from `package.json#dependencies`.
 *
 * WHEN mc-worldgen IS PUBLISHED:
 *   1. add `@nerima-games/mc-worldgen` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './worldgen-vocabulary'` at `'@nerima-games/mc-worldgen'`.
 *
 * It is the SECOND mirror in this repository and the first that is not
 * `./kernel-vocabulary`. The rule that decides a mirror's home is stated in
 * `mx-gameplay/domain/portal-frame-port.ts` — 「a mirror's home is decided by
 * WHOSE BARREL REPLACES IT」 — and it is why this is a separate file rather than
 * three more lines in `./kernel-vocabulary`: that file is replaced by
 * `@nerima-games/mc-kernel`, which does not export `Dimension` and is not going
 * to. One mirror per source package, and any number of them per repository.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT A LOCAL UNION, WHICH IS THE THING IT MOST LOOKS LIKE
 * ---------------------------------------------------------------------------
 *
 * `Dimension` is a CLOSED LITERAL UNION, and for those the membership IS the
 * type — the argument `./kernel-vocabulary` makes at length for `ITEM_TYPES`.
 * A copy carrying two of the three members is not "less of the vocabulary", it
 * is a DIFFERENT TYPE under the same name: it typechecks locally, passes every
 * test in this repository, and rejects a save file that mc-worldgen considers
 * ordinary on the day the import is repointed.
 *
 * So the union below is transcribed CHARACTER FOR CHARACTER from
 * `mc-worldgen/domain/nether-travel.ts`, including `'end'` — which no rule in
 * THIS repository can currently reach, and which is here for the reason that
 * file gives for keeping it: a mirror of two-thirds of a type is the drift every
 * mirror header in the organisation is about.
 *
 * The hazard is real and it is documented at the source: the reference
 * implementation declares `Dimension` TWICE (`packages/world/domain/nether/
 * nether-travel.ts:17` and `packages/worker/domain/terrain-worker-protocol.ts:18`).
 * This repository mirrors the first and only the first.
 *
 * `mc-dev-meta`'s `pnpm check:mirrors` carries a row for this file, so the next
 * divergence is a failing gate rather than a repoint-day surprise.
 */

/**
 * Which world a cell — or a player — is in.
 *
 * TRANSCRIBED from `mc-worldgen/domain/nether-travel.ts`. mc-worldgen owns the
 * word; mc-sim owns the STATE of which one the player currently occupies, and
 * those being in different repositories is the ordinary shape of this project
 * rather than a split: mc-kernel owns `BlockType` while mc-worldgen's
 * `ChunkStore` holds the blocks.
 *
 * mc-sim DOES NOT BRANCH ON THIS VALUE. There is no `if (dimension === 'nether')`
 * anywhere in this repository and there must not be: what is different about the
 * Nether — the ceiling, the lava sea, the portal linkage, what spawns — is
 * generation (mc-worldgen) and rules (mx-gameplay). mc-sim records which one is
 * current and hands it back, exactly as it stores a `DamageCause` string it
 * never reads.
 */
export type Dimension = 'overworld' | 'nether' | 'end'
