---
"@nerima-games/mc-sim": patch
---

Migrate repository layout and tooling onto the nerima-games org standard:

- Move `index.ts` / `domain/` / `application/` / `stages/` under `src/` (`apps/` stays outside `src/`, at repo root).
- Remove the `api-lock.md` snapshot/diff mechanism (`scripts/api-lock.ts`, `test/api-lock.test.ts`, `api:check`/`api:update`); breaking-change review is now human-only (API_STANDARD.md §3-4).
- Remove `scripts/check-dependency-whitelist.ts` and its test; cross-repo dependency boundaries are now enforced via `oxlint.json`'s `no-restricted-imports`.
- Add `@nerima-games/mc-save` and `@nerima-games/mc-worldgen` to `dependencies`, matching the Tier2 graph declared in DEPENDENCY_POLICY.md and this repository's own `docs/architecture.md` (previously undeclared, though not yet imported directly — both are consumed today through provisional local mirrors pending their publication).
- Enable the 99%-on-4-metrics coverage gate (`vitest.config.ts` thresholds) as a required, separate CI step (`pnpm test:coverage`), per TEST_STANDARD.md §3. Real measured coverage is below threshold on all 4 metrics; this is a known, accepted red rather than a deferred rollout.
- SHA-pin `actions/checkout`, `actions/setup-node`, `actions/upload-artifact` in CI, add `persist-credentials: false`.
- Add `.github/dependabot.yml` (github-actions + npm, weekly).
- Add changesets (`@changesets/cli`, `@changesets/changelog-github`) and a `changeset status` CI check.

No public API surface changed.
