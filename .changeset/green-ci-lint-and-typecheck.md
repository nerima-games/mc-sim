---
---

Fix CI: `pnpm-workspace.yaml` pinned `@nerima-games/mc-kernel` to a local
`link:../mc-kernel` path that only exists on a developer machine with a
sibling checkout; in CI (and any clean checkout) this produced a dangling
symlink and `pnpm typecheck` failed with `TS2307` for every kernel import.
Resolved to the published registry package instead.

Fix lint: `.oxlintrc.json` still listed ~30 `eslint`-plugin formatting rules
(`indent`, `comma-dangle`, `array-bracket-spacing`, etc.) that no longer exist
in oxlint 1.76.0, which made oxlint refuse to parse the config at all —
`pnpm lint` was silently running with bare built-in defaults, including the
`no-restricted-imports` Tier2 dependency-boundary check. Removed the dead
rules, switched the `style` category to `off` (matching
`@nerima-games/mc-kernel` and `@nerima-games/mc-save`, both already on this
pattern) since it otherwise bundles opinionated shape rules
(`no-magic-numbers`, `sort-keys`, `id-length`, ...) never reviewed or
intended by this repository, and fixed the Tier2 `no-restricted-imports`
pattern to use `group` instead of `regex` (the latter is silently a no-op
under oxlint 1.76.0).

Refactored a handful of functions flagged by the now-actually-running
`complexity` rule (`container-storage.ts`, `player-storage.ts`,
`inventory-service.ts`, `vehicle.ts`, `explosion.ts`, `vitals-validation.ts`,
and the preview-sim dev tool) into smaller pieces. Pure extraction, no
behavior change — the full test suite (548 tests) passes unchanged.

No change to the published package's public API or behaviour — empty
changeset, no version bump.
