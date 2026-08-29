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
