# @nerima-games/mc-sim

## 0.3.0

### Minor Changes

- [#16](https://github.com/nerima-games/mc-sim/pull/16) [`6a3a2e6`](https://github.com/nerima-games/mc-sim/commit/6a3a2e69b4fd82b70b84fa85d317917023cbf2bc) Thanks [@takeokunn](https://github.com/takeokunn)! - Add the save coordinator (debounced writes with generation-consistent snapshot retry, at most one publish in flight) and the placement-consumption rule, both brought down from the composing app. The coordinator now takes its next batch and clears its running flag in one atomic update, closing a window where a request arriving between those two steps was lost.

### Patch Changes

- [#15](https://github.com/nerima-games/mc-sim/pull/15) [`6f50987`](https://github.com/nerima-games/mc-sim/commit/6f5098749dfc84cc13b3fd2580695c69c2b62ddf) Thanks [@takeokunn](https://github.com/takeokunn)! - Complete the org toolchain devDependency pin set: knip 6.33.0 (its verify gate arrives in Wave 3; the pin belongs to the Wave 0 table) plus @effect/vitest 0.30.0 where it was missing.

## 0.2.1

### Patch Changes

- [#13](https://github.com/nerima-games/mc-sim/pull/13) [`a476ff4`](https://github.com/nerima-games/mc-sim/commit/a476ff4412110e9b18e8902e45b196886a0b1826) Thanks [@takeokunn](https://github.com/takeokunn)! - Pin mc-physics 0.2.1, whose tsc-emitted declarations restore the projectile API types that 0.2.0's bundled d.ts dropped; consumers type-checking mc-sim's declarations against mc-physics no longer see missing exports.

## 0.2.0

### Minor Changes

- [`942bf64`](https://github.com/nerima-games/mc-sim/commit/942bf64403c3469e0a1b92d9174d73b8ce3a828d) Thanks [@takeokunn](https://github.com/takeokunn)! - Adopt `@nerima-games/mc-physics@0.2.0` (`@nerima-games/mc-kernel@0.5.0`) and retire the
  forked explosion, Primed TNT, and Arrow-projectile implementations in favour of named
  re-exports from physics, ending the manual-sync obligation the deltaTime clamp constants
  carried (`docs/design-notes.md` DN-03).
  
  **Breaking changes** (0.x, hence a minor bump rather than major):
  
  - `planExplosion` / `applyExplosionPlan` / `planPrimedTnt` / `applyPrimedTntPlan` produce
    different destruction patterns for the same seed: the xorshift-based block-destruction
    hash is replaced by kernel's `Math.sin`-based hash. Any saved seed relied on for a
    reproducible blast shape will now destroy a different set of blocks.
  - `planExplosion` / `applyExplosionPlan` drop their `<S>` / `<E, R>` generics
    (`ExplosionRequest<S>`, `ExplosionCommit<E, R>`) and become non-generic.
  - The `commit` callback passed to `applyExplosionPlan` and `applyPrimedTntPlan` is now a
    plain synchronous function returning `void`, not an `Effect.Effect<void, E, R>`, and has
    no typed failure channel (the old Effect's `E`). Callers invoke it directly inside their
    own transaction (e.g. `Ref.modify`) instead of `yield*`-ing it. `commit` must not throw;
    a caller whose commit can fail should wrap its own call to `commit` in `try`/`catch`
    rather than relying on a channel that no longer exists.
  - `PrimedTntState`'s discriminant field changes from `_tag: 'Primed' | 'Detonated'` to
    `kind: 'primed' | 'detonated'`.
  - `primeTnt`'s `fuseSecs` parameter becomes optional, defaulting to
    `DEFAULT_TNT_FUSE_SECS` (4 seconds).
  - `domain/projectile.ts` removes the Arrow-specific surface (`launchArrow`, `stepArrow`,
    `Arrow`, `ArrowLaunch`) in favour of physics's profile-injected
    `launchProjectile` / `stepProjectile`, `Projectile`, `ProjectileLaunch`, and the
    `ARROW_PROFILE` / `SNOWBALL_PROFILE` / `EGG_PROFILE` / `TRIDENT_PROFILE` profile
    constants. `ProjectileStep`'s `arrow` field is renamed to `projectile`.
    `raycastArrowBlock` is unaffected by this migration and stays as-is.
  - `ExplosionEntityEffect.id` (produced by `planExplosion`/`applyExplosionPlan`, including
    the explosion an ignited TNT triggers) is now a plain `string`, not mc-sim's branded
    `EntityId`. A caller that passes `effect.id` into `EntityManagerApi.despawn` or `.find`
    must re-brand it first with `EntityId(effect.id)` (`src/domain/entity-types.ts`); those
    methods still require `EntityId` (`src/application/entity-manager.ts`).
  - `SimPhysicsConfig.resolve` (`= @nerima-games/mc-physics`'s `ResolveOptions`,
    `src/stages/registration.ts`) drops `isBlockSolid` in favour of a required
    `blockPropertiesAt` plus an optional `blockShapeAt`. A host's own `isBlockSolid`
    predicate should move into `blockShapeAt` (see `test/stage-registration.test.ts` for the
    migrated fixture); once `blockShapeAt` is supplied it fully governs a cell and no longer
    falls through to `blockPropertiesAt` on a `null` shape.
  - If a host persists `PrimedTntState` (e.g. as part of a TNT entity's saved behaviour),
    that saved data needs a migration from `_tag: 'Primed' | 'Detonated'` to
    `kind: 'primed' | 'detonated'` before it can be loaded against 0.2.0.
  
  `domain/frame-timing.ts`'s clamp constants and functions now forward to physics's
  `MIN_DELTA_SECS` / `MAX_DELTA_SECS` / `FIRST_FRAME_DELTA_SECS` / `clampDeltaTime` /
  `deltaTimeBetween` instead of hand-copying them; `frameDeltaLossSecs` /
  `frameDeltaLossBetween` remain mc-sim-specific. `stages/registration.ts` adopts physics's
  `advanceFallTracking` / `FallTrackingState` in place of its inline fall-tracking copy, with
  no change to the public `LandingImpact` contract (public-api.md §4.2).

- [#11](https://github.com/nerima-games/mc-sim/pull/11) [`99cffbf`](https://github.com/nerima-games/mc-sim/commit/99cffbfbdda2e1d425ac19baff5351ab08b4ab4e) Thanks [@takeokunn](https://github.com/takeokunn)! - Toolchain frozen to org pin set (TypeScript 7.0.2, vitest 4.1.11, effect 3.22.1, node 24, pnpm 11.24.0); build switched to tsc emit; release workflow added
  mc-save 0.3.0: the v1→v2 save migration is removed; saves must be at the current format version

## 0.1.42

### Patch Changes

- [`a181cf3`](https://github.com/nerima-games/mc-sim/commit/a181cf36d1626528b4cce8fa60e1a6866361eefa) Thanks [@takeokunn](https://github.com/takeokunn)! - Add the shapeless Eye of Ender recipe to the shared starter recipe table.

- [`c921de9`](https://github.com/nerima-games/mc-sim/commit/c921de9c3be5659c306245e9e3c20e3c8535dacc) Thanks [@takeokunn](https://github.com/takeokunn)! - Expose projectile simulation primitives through the public API.

- [`60b72e4`](https://github.com/nerima-games/mc-sim/commit/60b72e4ebd6be357d1dd9c81e42d08e99f45bc59) Thanks [@takeokunn](https://github.com/takeokunn)! - Migrate repository layout and tooling onto the nerima-games org standard:

  - Move `index.ts` / `domain/` / `application/` / `stages/` under `src/` (`apps/` stays outside `src/`, at repo root).
  - Remove the `api-lock.md` snapshot/diff mechanism (`scripts/api-lock.ts`, `test/api-lock.test.ts`, `api:check`/`api:update`); breaking-change review is now human-only (API_STANDARD.md §3-4).
  - Remove `scripts/check-dependency-whitelist.ts` and its test; cross-repo dependency boundaries are now enforced via `.oxlintrc.json`'s `no-restricted-imports`.
  - Add `@nerima-games/mc-save` and `@nerima-games/mc-worldgen` to `dependencies`, matching the Tier2 graph declared in DEPENDENCY_POLICY.md and this repository's own `docs/architecture.md` (previously undeclared, though not yet imported directly — both are consumed today through provisional local mirrors pending their publication).
  - Enable the 99%-on-4-metrics coverage gate (`vitest.config.ts` thresholds) as a required, separate CI step (`pnpm test:coverage`), per TEST_STANDARD.md §3. Real measured coverage is below threshold on all 4 metrics; this is a known, accepted red rather than a deferred rollout.
  - SHA-pin `actions/checkout`, `actions/setup-node`, `actions/upload-artifact` in CI, add `persist-credentials: false`.
  - Add `.github/dependabot.yml` (github-actions + npm, weekly).
  - Add changesets (`@changesets/cli`, `@changesets/changelog-github`) and a `changeset status` CI check.

  No public API surface changed.

- [`2b859e8`](https://github.com/nerima-games/mc-sim/commit/2b859e8810aaa387b140547ac296cb7556828cd9) Thanks [@takeokunn](https://github.com/takeokunn)! - Add bounded primed-TNT fuse planning with one atomic fuse-and-explosion commit boundary.
