# @nerima-games/mc-sim

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
