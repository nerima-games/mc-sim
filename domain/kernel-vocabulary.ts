/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-kernel`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * plan.md §6 Step 3 publishes the repositories bottom-up: a repository is
 * published to GitHub Packages only once its interface has held still, and only
 * then may its consumers pin it. Nothing is published yet, so mc-sim cannot
 * `import ... from '@nerima-games/mc-kernel'` — there is no package to resolve,
 * and `scripts/check-dependency-whitelist.ts` would in any case reject an
 * import of something absent from `package.json#dependencies`.
 *
 * Rather than invent a different vocabulary that would have to be reconciled
 * later, this file mirrors the handful of kernel declarations mc-sim actually
 * uses, verbatim in shape and semantics, from
 * `mc-kernel/domain/{quantities,coordinates,clock,camera,identifiers,frame,item-type}.ts`.
 *
 * WHEN mc-kernel IS PUBLISHED:
 *   1. add `@nerima-games/mc-kernel` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './kernel-vocabulary'` at `'@nerima-games/mc-kernel'`.
 * Nothing else should need to change. If step 3 turns out not to typecheck,
 * this file has drifted and the drift is the bug.
 *
 * The mirror is deliberately MINIMAL — only what mc-sim uses. A larger mirror
 * would be a larger thing to keep honest.
 *
 * ---------------------------------------------------------------------------
 * ONE EXCEPTION TO "MINIMAL": the Clock Port is mirrored WHOLE
 * ---------------------------------------------------------------------------
 *
 * `ClockPort` is a `Context.Tag`, and Effect resolves Tags by their TEXTUAL
 * KEY — here, `'@nerima-games/mc-kernel/ClockPort'`. Two classes built from the
 * same key are the same service at runtime and two unrelated nominal types to
 * TypeScript, so a NARROWER mirror of `ClockService` is not "less of the
 * vocabulary", it is a silent runtime hazard: a `Layer` built against a
 * one-field mirror satisfies a two-field tag, and the missing field reads
 * `undefined` in a repository that never saw this file.
 *
 * `EpochMillis`, `fixedClock`, `wallClockEpochMillis` and the object-shaped
 * `FixedClockLayer` are therefore mirrored even though nothing in mc-sim reads a
 * wall clock. `test/kernel-mirror.test.ts` pins the shape against kernel's, so
 * the next divergence fails CI rather than a frame.
 *
 * ---------------------------------------------------------------------------
 * THE SECOND EXCEPTION: `ITEM_TYPES` is mirrored WHOLE, all one hundred one literals
 * ---------------------------------------------------------------------------
 *
 * For every other declaration here, "minimal" means "the names mc-sim uses".
 * For a closed literal union it cannot mean that, because THE MEMBERSHIP IS THE
 * TYPE. A mirror carrying only the six items mc-sim's recipe table names would
 * be a NARROWER type under the same name: `isItemType('sand')` would answer
 * `false` here and `true` in kernel, and an `Inventory` holding `'sand'` — which
 * kernel says is a perfectly ordinary item — would be rejected by a signature
 * that claims to speak kernel's vocabulary.
 *
 * That is the ClockPort hazard again with a different payload. It is also the
 * more dangerous direction: a mirror that is WIDER than kernel's roster (an item
 * mc-sim finds convenient, added here) typechecks locally, ships a recipe table
 * kernel's `ItemType` rejects, and the failure surfaces on the day the mirror is
 * deleted — which is the one day this file promised would be uneventful.
 *
 * So the roster is transcribed exactly, in kernel's order, and
 * `test/kernel-mirror.test.ts` pins it literally. ADDING AN ITEM HERE IS NOT A
 * DECISION THIS REPOSITORY CAN TAKE: kernel owns the roster (its
 * `docs/versioning.md` §6 classifies growing it MINOR), and mc-sim's part is to
 * ask for what it needs and to live inside the answer meanwhile.
 *
 * That is what happened, in both directions. mc-sim asked for eight literals
 * with the cost written down (`domain/recipe.ts`, `docs/public-api.md` §4.1-7),
 * kernel granted SEVEN of them on kernel-side reasons of its own — ore and
 * gravel drops, mob drops, and the two ignition items for the flammable
 * capability — and declined the eighth, `crafting_table`.
 *
 * ---------------------------------------------------------------------------
 * HOW THIS MIRROR CAME TO BE WRONG, which is the thing worth reading
 * ---------------------------------------------------------------------------
 *
 * The roster then went from 23 to 97 in kernel and THIS FILE DID NOT FOLLOW, so
 * it sat at 23 while claiming in its own header to be kernel's vocabulary. The
 * gap was not caught by anything local, and could not have been: mc-sim's suite
 * is green against its own copy, because a mirror that pins itself is a test
 * that a value equals itself. It surfaced only in mc-dev-meta's
 * `pnpm check:repoint`, which deletes a mirror, points the imports at the real
 * module and runs `tsc` — mx-gameplay mirrors kernel at 97, mc-sim mirrored it
 * at 23, and the two disagreed at the seam.
 *
 * That is worth stating plainly because a SHORT mirror is not the safe
 * direction. The header above warns about the WIDE one (an item mc-sim finds
 * convenient) and that warning is right, but a short mirror is the same defect:
 * it is a NARROWER type under kernel's name, and it fails at the same moment —
 * the day the mirror is deleted.
 *
 * `crafting_table` is now IN the roster, and the route it took is the reason
 * this paragraph exists rather than a footnote. It was declined on mc-sim's
 * request and this file recorded the refusal correctly; kernel later added it on
 * a block-side reason of its own (its registry row drops itself, so the row
 * needed an item of that name to be true). Nothing told mc-sim. A recorded "no"
 * does not stay "no", and a mirror that treats one as settled drifts silently.
 *
 * What is NOT mirrored, deliberately: `mc-kernel/domain/block-item.ts`
 * (`PlaceableItemType`, `itemOfBlock`, `blockOfPlaceableItem`) and the drop
 * resolution in `block-registry.ts` (`resolveDropItem`, `dropOfBlockId`). Those
 * answer "what does breaking this block give you" and "can this item be put
 * back into the world", which are mx-gameplay's verbs (plan.md §2.3-1). mc-sim
 * needs to know that an item HAS a name, not where the name came from.
 */
import { Brand, Context, Effect, Layer } from 'effect'

// ---------------------------------------------------------------------------
// Quantities — mirrors mc-kernel/domain/quantities.ts
// ---------------------------------------------------------------------------

/**
 * Elapsed simulation time for one frame, in seconds. Finite and non-negative.
 * A zero delta is legal: a frame may be scheduled twice inside one clock tick.
 */
export type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>

export const DeltaTimeSecs = Brand.refined<DeltaTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`DeltaTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * A reading from a monotonic clock, in seconds. Never decreases; the origin is
 * unspecified, so only differences are meaningful. Comes from `ClockPort`.
 */
export type MonotonicTimeSecs = number & Brand.Brand<'MonotonicTimeSecs'>

export const MonotonicTimeSecs = Brand.refined<MonotonicTimeSecs>(
  (value) => Number.isFinite(value) && value >= 0,
  (value) => Brand.error(`MonotonicTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * A wall-clock reading: milliseconds since the Unix epoch. Only for values a
 * human reads or that must survive a save/load round trip — never for durations,
 * because it can jump in either direction.
 *
 * Mirrored solely so that `ClockService` below has kernel's real shape.
 */
export type EpochMillis = number & Brand.Brand<'EpochMillis'>

export const EpochMillis = Brand.refined<EpochMillis>(
  (value) => Number.isSafeInteger(value),
  (value) => Brand.error(`EpochMillis must be a safe integer number of milliseconds, received ${value}`),
)

/** Maximum items in one inventory stack. Kernel fixes the representable range only. */
export const MAX_STACK_COUNT = 64

/** Number of items in one inventory stack. Integer in [0, MAX_STACK_COUNT]. */
export type StackCount = number & Brand.Brand<'StackCount'>

export const StackCount = Brand.refined<StackCount>(
  (value) => Number.isInteger(value) && value >= 0 && value <= MAX_STACK_COUNT,
  (value) => Brand.error(`StackCount must be an integer in [0, ${MAX_STACK_COUNT}], received ${value}`),
)

// ---------------------------------------------------------------------------
// Item vocabulary — mirrors mc-kernel/domain/item-type.ts
// ---------------------------------------------------------------------------

/**
 * Every item that exists. Transcribed from `mc-kernel/domain/item-type.ts`,
 * in kernel's order, and NOT extensible from here — see the header.
 *
 * `lower_snake_case`, matching kernel's `BLOCK_TYPES`. mc-sim's provisional
 * strings were `UPPER_SNAKE` (`'OAK_PLANKS'`), so repointing was a re-casing as
 * well as a re-typing.
 *
 * The rosters OVERLAP rather than nest: an item that is also a block is spelled
 * identically to the block (`dirt`), which is what makes kernel's
 * `PlaceableItemType = ItemType & BlockType` a derivation instead of a third
 * hand-written list. `stick`, `glowstone_dust` and `wooden_pickaxe` are among
 * the entries that are not blocks and never will be; the drop-override items
 * further down (`raw_iron`, `diamond`, `string`, `snowball`, …) are the rest.
 *
 * THE LIST BELOW WAS NOT TYPED BY HAND. It was dumped from kernel's module by
 * importing `ITEM_TYPES` and emitting its members in index order, because the
 * failure this file has already had once is a transcription that drifted, and
 * re-transcribing 97 literals by eye is how it would have happened again.
 */
export const ITEM_TYPES = [
  // Items that are also blocks. Spelled identically to their `BlockType`.
  'stone',
  'cobblestone',
  'dirt',
  'grass_block',
  'sand',
  'gravel',
  'oak_log',
  'oak_planks',
  'oak_leaves',
  'glass',
  'torch',
  'glowstone',
  'piston',

  // Items that are not blocks, and never will be. These are the entries that
  // make `ItemType` un-assignable to `BlockType`.
  'stick',
  'glowstone_dust',
  'wooden_pickaxe',
  'stone_pickaxe',

  // Granted to mc-sim's costed request, each with a kernel-side reason recorded
  // beside it in `mc-kernel/domain/item-type.ts`: `coal` / `iron_ingot` /
  // `flint` are what ore blocks and gravel drop (`BlockDropRule.item` is
  // `ItemType | 'self'`), `gunpowder` / `blaze_powder` are mob drops, and
  // `flint_and_steel` / `fire_charge` are the two ignition items the flammable
  // capability names.
  'coal',
  'iron_ingot',
  'flint',
  'gunpowder',
  'blaze_powder',
  'flint_and_steel',
  'fire_charge',
  'iron_helmet',
  'iron_chestplate',
  'iron_leggings',
  'iron_boots',

  // Items that are also blocks (55), added when kernel's `BLOCK_TYPES` reached
  // the reference's full roster. Kernel's rule, stated before it was applied: a
  // block gets an item form if and only if its registry row's `drops` rule
  // resolves to ITSELF and yields something. Without these the rows would be
  // lies — a row saying a block drops itself, with no item of that name to drop.
  //
  // `crafting_table` is here. It was DECLINED on mc-sim's original request and
  // this mirror recorded that; kernel later added it on its own block-side
  // reason, which is the roster moving under the mirror exactly as the header
  // says it may.
  'granite',
  'diorite',
  'andesite',
  'deepslate',
  'obsidian',
  'smooth_basalt',
  'calcite',
  'amethyst_block',
  'sandstone',
  'prismarine',
  'soul_sand',
  'coal_block',
  'iron_block',
  'gold_block',
  'diamond_block',
  'redstone_block',
  'lapis_block',
  'emerald_block',
  'redstone_torch',
  'lever',
  'stone_button',
  'repeater',
  'redstone_lamp',
  'observer',
  'comparator',
  'dispenser',
  'hopper',
  'end_stone',
  'end_portal_frame',
  'end_portal_frame_filled',
  'chorus_flower',
  'chorus_plant',
  'dragon_egg',
  'end_crystal',
  'end_rod',
  'end_stone_bricks',
  'ender_chest',
  'purpur_block',
  'purpur_pillar',
  'purpur_slab',
  'purpur_stairs',
  'shulker_box',
  'crafting_table',
  'furnace',
  'chest',
  'door',
  'oak_stairs',
  'anvil',
  'cauldron',
  'bed',
  'enchanting_table',
  'brewing_stand',
  'tnt',
  'nether_brick',
  'netherrack',

  // Items that are NOT blocks (10), each the right-hand side of a row in the
  // reference's `INVENTORY_DROP_OVERRIDES`. `raw_iron` / `raw_gold` rather than
  // ingots is the reference's answer and not a slip: the ore yields raw material
  // and the furnace pays the XP. `iron_ingot` above is a different item.
  'raw_iron',
  'raw_gold',
  'diamond',
  'emerald',
  'lapis_lazuli',
  'redstone_dust',
  'amethyst_shard',
  'wheat_seeds',
  'potato',
  'nether_wart',

  // Seven older registry rows that carried the default "yields itself" rule and
  // had no item form, so breaking a ladder gave you nothing. Not guesses: the
  // item a block drops when NOT overridden is its own name.
  'ladder',
  'kelp',
  'seagrass',
  'rail',
  'powered_rail',
  'pressure_plate',
  'stone_slab',

  // `cobweb` -> `string` and `snow` -> `snowball` are override rows. NOTE that
  // `string` is an ITEM NAME — the thread a cobweb drops — and not a stray type
  // name that wandered in. It is the entry most likely to be "tidied away".
  'string',
  'snowball',
] as const

/**
 * Item identity. A CLOSED literal union, so a misspelled item is a compile
 * error rather than a slot nobody can ever match a recipe against.
 *
 * This replaced `domain/inventory.ts`'s `export type ItemId = string`, which
 * kernel's `item-type.ts` header names as one of the three provisional aliases
 * the published type exists to retire. mc-sim does not re-alias it: there is one
 * name for it now, and it is kernel's.
 */
export type ItemType = (typeof ITEM_TYPES)[number]

const ITEM_TYPE_LOOKUP: ReadonlySet<string> = new Set<string>(ITEM_TYPES)

/**
 * Narrowing guard for item names arriving from outside the type system.
 *
 * mc-sim has exactly one such boundary and it is the important one: a saved
 * inventory is item names in a file, written by a build whose roster may differ
 * from this one's. `normaliseInventory` (`./inventory`) runs this on the
 * world-load path, because a `Slot` typed `ItemType` holding `'diamond'` is a
 * value that disagrees with its own type and nothing downstream would ever
 * notice.
 */
export const isItemType = (value: string): value is ItemType => ITEM_TYPE_LOOKUP.has(value)

// ---------------------------------------------------------------------------
// Coordinates — mirrors mc-kernel/domain/coordinates.ts (the continuous part)
// ---------------------------------------------------------------------------

/** A continuous world-space point. Y is up, 1 block = 1 unit. */
export type Position = {
  readonly x: number
  readonly y: number
  readonly z: number
}

export const position = (x: number, y: number, z: number): Position => ({ x, y, z })

// ---------------------------------------------------------------------------
// Clock Port — mirrors mc-kernel/domain/clock.ts
// ---------------------------------------------------------------------------

export type ClockService = {
  /** Monotonic reading. Only differences between readings are meaningful. */
  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>
  /** Wall-clock reading. Never use for durations. */
  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>
}

export class ClockPort extends Context.Tag('@nerima-games/mc-kernel/ClockPort')<ClockPort, ClockService>() {}

/** A clock frozen at one instant. Platform-independent, hence shippable by kernel. */
export const fixedClock = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}): ClockService => ({
  monotonicSecs: Effect.succeed(at.monotonicSecs),
  wallClockEpochMillis: Effect.succeed(at.wallClockEpochMillis),
})

/** `fixedClock` as a Layer, for deterministic tests and replays. */
export const FixedClockLayer = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}): Layer.Layer<ClockPort> => Layer.succeed(ClockPort, fixedClock(at))

/** Read the monotonic clock. The only sanctioned answer to "what time is it?". */
export const monotonicSecs: Effect.Effect<MonotonicTimeSecs, never, ClockPort> = Effect.flatMap(
  ClockPort,
  (clock) => clock.monotonicSecs,
)

/** Read the wall clock. Only for human-facing or persisted values. */
export const wallClockEpochMillis: Effect.Effect<EpochMillis, never, ClockPort> = Effect.flatMap(
  ClockPort,
  (clock) => clock.wallClockEpochMillis,
)

// ---------------------------------------------------------------------------
// Camera pose — mirrors mc-kernel/domain/camera.ts
// ---------------------------------------------------------------------------

/**
 * The camera pose, as a value.
 *
 * plan.md §4.3 / §5.1-2: mc-sim owns the truth and mc-render mirrors it. The
 * type deliberately has no setter and must never grow one — see
 * `domain/camera-pose.ts` in this repository, which owns the only sanctioned
 * ways to produce one.
 */
export type CameraPoseSnapshot = {
  readonly position: Position
  readonly yawRadians: number
  readonly pitchRadians: number
  readonly capturedAtSecs: MonotonicTimeSecs
}

// ---------------------------------------------------------------------------
// Identifiers — mirrors mc-kernel/domain/identifiers.ts
// ---------------------------------------------------------------------------

/**
 * Identifies a frame stage. Stage ids are the vertices of the per-frame
 * ordering graph and are STRINGS ON PURPOSE: `after: [StageId('sim:physics')]`
 * expresses "run me after mc-sim's physics" without importing anything from
 * mc-sim's stage module (plan.md §2.3-1, §2.3-3).
 *
 * Convention: `<owning-repo-suffix>:<stage>`. Everything this repository owns is
 * prefixed `sim:`.
 *
 * Note the consequence for this repository in particular: `sim:physics` is
 * named in an `after` edge by mx-gameplay, mx-redstone, mx-ui AND mc-render, and
 * not one of those four names creates an import. So nothing in the type system
 * or in `pnpm check:deps` was ever going to notice that mc-sim registered no
 * such stage — which is precisely how all four edges came to dangle at once.
 */
export type StageId = string & Brand.Brand<'StageId'>

export const StageId = Brand.refined<StageId>(
  (value) => value.trim().length > 0,
  (value) => Brand.error(`StageId must be a non-blank string, received ${JSON.stringify(value)}`),
)

// ---------------------------------------------------------------------------
// Frame contract — mirrors mc-kernel/domain/frame.ts
// ---------------------------------------------------------------------------

/**
 * The context every frame stage may assume is present. Kernel's answer, settled
 * by the vertical-slice spike: `ClockPort`, and nothing else.
 *
 * The `mx-*` repositories mirror this as `never`, because they are stage AUTHORS
 * and an `Effect<void, never, never>` is assignable wherever an
 * `Effect<void, never, ClockPort>` is wanted. That shortcut is NOT available
 * here, and the reason is that this repository is the measurement kernel settled
 * the alias on: `mc-kernel/domain/frame.ts` names
 * `mc-sim`'s `PlayerServiceApi.cameraPose` — `Effect<CameraPoseSnapshot, never,
 * ClockPort>` — as the decisive case, because its clock requirement sits on the
 * METHOD rather than on acquiring the service, so a stage that captured
 * `PlayerService` at registration time still needs `ClockPort` a frame later.
 * Mirroring `never` in the repository that produced that measurement would make
 * this file disagree with the argument it is the evidence for.
 */
export type FrameServices = ClockPort

/**
 * One unit of per-frame work, contributed by a repository.
 *
 * `after` declares ORDERING EDGES ONLY. It is not a dependency on the named
 * stage existing, and it is not a request for a position in the sequence: the
 * total order over all stages from all modules is resolved solely by mc-compose
 * (plan.md §2.3-3, §4.2).
 *
 * NOTE WHAT IS NOT HERE: a `before`. The contract is one-directional, so a stage
 * that must PRECEDE another can say nothing at all — its position is the
 * skeleton's to give. That asymmetry is why this repository declares no `after`
 * edges (see `stages/stage-ids.ts`) and it is worth knowing before reading them.
 *
 * Reproduced verbatim from plan.md §4.1, `interface` and all.
 */
export interface StageRegistration {
  readonly id: StageId
  readonly after?: ReadonlyArray<StageId>
  readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>
}

/**
 * A repository's contribution to a running game.
 *
 * `ROut`      — services this module provides.
 * `E`         — errors that can occur while *building* those services.
 * `RIn`       — services this module needs to be given in order to build.
 * `RRegister` — services this module needs in order to REGISTER its stages.
 *
 * `frameStages` is an EFFECT, not an array, and mc-sim is one of the reasons:
 * `sim:physics` is meaningless without a `TimeService` and a `PlayerService`, so
 * building it requires ACQUIRING them, and a value offers no context in which to
 * do that. With an array the only channel left was `run`, which would have
 * forced both services into `FrameServices` and therefore forced kernel — tier 1
 * — to name mc-sim's services. See `mc-kernel/domain/frame.ts`.
 *
 * `RRegister` is separate from `RIn` for the same reason it is in mc-render:
 * both services above are ones this module PROVIDES (they are in `ROut`), not
 * ones it needs to be given. Folding them into `RIn` would say mc-sim cannot be
 * built until something else supplies what mc-sim itself ships.
 */
export interface GameModule<ROut, E, RIn, RRegister = never> {
  readonly layers: Layer.Layer<ROut, E, RIn>
  readonly frameStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, RRegister>
}
