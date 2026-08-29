---
'@nerima-games/mc-sim': minor
---

Adopt `@nerima-games/mc-physics@0.2.0` (`@nerima-games/mc-kernel@0.5.0`) and retire the
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
  plain synchronous function returning `void`, not an `Effect.Effect<void, E, R>`. Callers
  invoke it directly inside their own transaction (e.g. `Ref.modify`) instead of
  `yield*`-ing it.
- `PrimedTntState`'s discriminant field changes from `_tag: 'Primed' | 'Detonated'` to
  `kind: 'primed' | 'detonated'`.
- `primeTnt`'s `fuseSecs` parameter becomes optional, defaulting to
  `DEFAULT_TNT_FUSE_SECS` (4 seconds).
- `domain/projectile.ts` removes the Arrow-specific surface (`launchArrow`, `stepArrow`,
  `Arrow`, `ArrowLaunch`) in favour of physics's profile-injected
  `launchProjectile` / `stepProjectile`, `Projectile`, `ProjectileLaunch`, and the
  `ARROW_PROFILE` / `SNOWBALL_PROFILE` / `EGG_PROFILE` / `TRIDENT_PROFILE` profile
  constants. `ProjectileStep`'s `arrow` field is renamed to `projectile`.

`domain/frame-timing.ts`'s clamp constants and functions now forward to physics's
`MIN_DELTA_SECS` / `MAX_DELTA_SECS` / `FIRST_FRAME_DELTA_SECS` / `clampDeltaTime` /
`deltaTimeBetween` instead of hand-copying them; `frameDeltaLossSecs` /
`frameDeltaLossBetween` remain mc-sim-specific. `stages/registration.ts` adopts physics's
`advanceFallTracking` / `FallTrackingState` in place of its inline fall-tracking copy, with
no change to the public `LandingImpact` contract (public-api.md §4.2).
