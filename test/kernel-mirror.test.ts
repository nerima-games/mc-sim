/**
 * The kernel mirror is pinned against kernel's documented shape.
 *
 * ---------------------------------------------------------------------------
 * What this file is defending against
 * ---------------------------------------------------------------------------
 *
 * `domain/kernel-vocabulary.ts` is a temporary local copy of
 * `@nerima-games/mc-kernel`, and its header promises that deleting it and
 * repointing every import at the published package will typecheck. Nothing
 * enforced that promise, and it had already been broken: this repository's
 * `ClockService` carried ONE field (`monotonicSecs`) where kernel's
 * (`mc-kernel/domain/clock.ts:43-48`) carries two, and `FixedClockLayer` took a
 * bare `MonotonicTimeSecs` where kernel's takes an object.
 *
 * The divergence was invisible to `tsc` and fatal at runtime, because
 * `ClockPort` is a `Context.Tag` and Effect resolves Tags BY THEIR TEXTUAL KEY.
 * All three copies of the tag use `'@nerima-games/mc-kernel/ClockPort'`, so in
 * any bundle that contains two of them — mc-playground-kit depends on mc-sim —
 * the narrow mirror's `Layer` satisfies the wide mirror's tag and
 * `wallClockEpochMillis` is `undefined` at the point of use. TypeScript cannot
 * see it: the two classes are nominally distinct types that denote one service.
 *
 * So the shape is asserted here in both directions, at compile time and at
 * runtime, and the tag key is asserted literally. A future narrowing OR
 * widening of the mirror fails CI instead of a frame.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  ClockPort,
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  fixedClock,
  isItemType,
  ITEM_TYPES,
  MonotonicTimeSecs,
  monotonicSecs,
  wallClockEpochMillis,
  type ClockService,
  type ItemType,
} from '../domain/kernel-vocabulary'
import { STARTER_RECIPES } from '../domain/recipe'

/**
 * Kernel's `ClockService`, restated from `mc-kernel/domain/clock.ts:43-48`.
 *
 * Written out rather than imported because mc-kernel is not published — which
 * is the same reason the mirror exists at all. When it is published, this alias
 * becomes `import type { ClockService } from '@nerima-games/mc-kernel'` and the
 * assertions below keep their meaning unchanged.
 */
type KernelClockService = {
  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>
  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>
}

/** Kernel's documented `FixedClockLayer` signature, same source, lines 68-71. */
type KernelFixedClockLayer = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}) => Layer.Layer<ClockPort>

const instant = {
  monotonicSecs: MonotonicTimeSecs(1_234.5),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
}

const CLOCK_SERVICE_FIELDS = ['monotonicSecs', 'wallClockEpochMillis'] as const

describe('the ClockPort mirror is kernel’s ClockPort', () => {
  // REGRESSION: the tag key is the whole hazard. Two classes with this string
  // are one service at runtime, so the mirrors must agree on the SHAPE too —
  // which is what the rest of this block checks.
  it.effect('uses kernel’s tag key verbatim, which is why the shape has to match', () =>
    Effect.sync(() => {
      expect(ClockPort.key).toBe('@nerima-games/mc-kernel/ClockPort')
    }),
  )

  it.effect('REGRESSION: the mirrored ClockService is not NARROWER than kernel’s', () =>
    Effect.sync(() => {
      // Compile-time half: a mirror value must be usable where kernel's service
      // is wanted. Dropping a field breaks this line.
      const asKernel: KernelClockService = fixedClock(instant)
      // Runtime half: the fields must actually be there, not merely typed.
      expect(Object.keys(asKernel).sort()).toStrictEqual([...CLOCK_SERVICE_FIELDS])
    }),
  )

  it.effect('REGRESSION: the mirrored ClockService is not WIDER than kernel’s', () =>
    Effect.sync(() => {
      // An object literal, so excess-property checking applies: a field kernel
      // does not have breaks this line, and a field kernel has that the mirror
      // has dropped breaks it too.
      const asMirror: ClockService = {
        monotonicSecs: Effect.succeed(instant.monotonicSecs),
        wallClockEpochMillis: Effect.succeed(instant.wallClockEpochMillis),
      }
      expect(Object.keys(asMirror).sort()).toStrictEqual([...CLOCK_SERVICE_FIELDS])
    }),
  )

  it.effect('REGRESSION: FixedClockLayer takes kernel’s object argument, not a bare reading', () =>
    Effect.gen(function* () {
      // Assigning in both directions pins the signature exactly: a bare
      // `(at: MonotonicTimeSecs)` — what this mirror used to declare — fails.
      const asKernel: KernelFixedClockLayer = FixedClockLayer
      const asMirror: typeof FixedClockLayer = asKernel

      const readings = yield* Effect.all({
        monotonic: monotonicSecs,
        wall: wallClockEpochMillis,
      }).pipe(Effect.provide(asMirror(instant)))

      expect(readings.monotonic).toBe(1_234.5)
      expect(readings.wall).toBe(1_700_000_000_000)
    }),
  )
})

describe('the mirrored brands are kernel’s brands', () => {
  // plan.md §3.4's [0.001, 0.05] clamp is a FRAME-LOOP concern and is applied
  // at the boundary by `domain/frame-timing.ts`. Kernel's brand stays loose, so
  // this mirror's must too: a stricter mirror would reject values kernel calls
  // valid while being nominally indistinguishable from kernel's own brand.
  it.effect('DeltaTimeSecs is finite and non-negative — kernel’s refinement, not the clamp', () =>
    Effect.sync(() => {
      expect(DeltaTimeSecs(0)).toBe(0)
      expect(DeltaTimeSecs(0.0001)).toBe(0.0001)
      expect(DeltaTimeSecs(30)).toBe(30)
      expect(() => DeltaTimeSecs(-0.000_001)).toThrow()
      expect(() => DeltaTimeSecs(Number.NaN)).toThrow()
      expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )

  it.effect('MonotonicTimeSecs is finite and non-negative', () =>
    Effect.sync(() => {
      expect(MonotonicTimeSecs(0)).toBe(0)
      expect(() => MonotonicTimeSecs(-1)).toThrow()
      expect(() => MonotonicTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )

  it.effect('EpochMillis is a safe integer, so a fractional millisecond cannot be persisted', () =>
    Effect.sync(() => {
      expect(EpochMillis(0)).toBe(0)
      expect(EpochMillis(1_700_000_000_000)).toBe(1_700_000_000_000)
      expect(() => EpochMillis(1.5)).toThrow()
      expect(() => EpochMillis(Number.MAX_SAFE_INTEGER + 2)).toThrow()
    }),
  )
})

/**
 * The item roster, pinned literally.
 *
 * ---------------------------------------------------------------------------
 * Why a literal list is the right assertion here, and only here
 * ---------------------------------------------------------------------------
 *
 * docs/testing.md §4.6 refuses tests that read a constant on both sides,
 * because such a test asserts that a value equals itself. This block is the
 * inversion of that rule, not an exception to it: the constant IS the contract.
 * `ITEM_TYPES` is a transcription of another repository's array, and the failure
 * being defended against is a transcription that drifted — an item quietly
 * added because mc-sim found it convenient, or a `lower_snake` spelling
 * mistyped. Reading `ITEM_TYPES` on both sides would pass through every one of
 * those.
 *
 * mc-dev-meta's `pnpm check:mirrors` is the sibling check that can see BOTH
 * repositories, and it compares the mirror against kernel's real module. This
 * one runs where mc-kernel is not installed and cannot, so it pins the
 * transcription: the two together are "the mirror matches the source" and "the
 * mirror is what its author thought it was".
 *
 * WHEN KERNEL GROWS THE ROSTER (additive, MINOR): this list is updated in the
 * SAME commit as `domain/kernel-vocabulary.ts`, from kernel's `ITEM_TYPES`, and
 * never from what mc-sim would like to write a recipe for.
 *
 * That has now happened twice, and the second time is the one to read, because
 * the procedure did NOT work. Sixteen became twenty-three with drop rules and
 * mob drops behind each literal, and this list was re-transcribed in the same
 * commit — that is the procedure working. Then kernel went from twenty-three to
 * ninety-seven and NOTHING HERE MOVED, for as long as it took mc-dev-meta's
 * `pnpm check:repoint` to delete the mirror and typecheck against the real
 * module.
 *
 * Note what this test could and could not do about that. It pins mc-sim's
 * transcription against a SECOND hand-written copy of kernel's roster, so it
 * catches an author editing one and not the other — real drift, worth catching.
 * It cannot catch BOTH being stale together, which is exactly what happened,
 * because neither copy can see kernel. Only the cross-repository check can, and
 * the two are complementary rather than redundant: this one says "the mirror is
 * what its author thought it was", `check:repoint` says "what its author
 * thought was right".
 *
 * BOTH LISTS ARE NOW MACHINE-DUMPED from kernel's module rather than retyped,
 * which removes the transcription slip but not the staleness — the update still
 * has to be triggered by somebody, and `check:repoint` is what triggers it.
 */
describe('the mirrored item roster is kernel’s item roster', () => {
  /**
   * Transcribed from `mc-kernel/domain/item-type.ts`, in kernel's order, which
   * is also the order kernel's `api-lock.md` records at `### ITEM_TYPES`.
   */
  const KERNEL_ITEM_TYPES = [
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
    'stick',
    'glowstone_dust',
    'wooden_pickaxe',
    'stone_pickaxe',
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
    'ladder',
    'kelp',
    'seagrass',
    'rail',
    'powered_rail',
    'pressure_plate',
    'stone_slab',
    'string',
    'snowball',
  ] as const

  it.effect('REGRESSION: the roster is kernel’s, member for member and in order', () =>
    Effect.sync(() => {
      // Order matters as well as membership: `PLACEABLE_ITEM_TYPES` in kernel is
      // `ITEM_TYPES.filter(...)`, so a reordering here would be a reordering of
      // a list kernel publishes, and mx-ui's hotbar reads that list.
      expect([...ITEM_TYPES]).toStrictEqual([...KERNEL_ITEM_TYPES])

      // Compile-time half, both directions: neither union may be wider than the
      // other. An item added to the mirror alone fails the first line; an item
      // dropped from it fails the second.
      const asKernel: (typeof KERNEL_ITEM_TYPES)[number] = 'stick' as ItemType
      const asMirror: ItemType = 'stick' as (typeof KERNEL_ITEM_TYPES)[number]
      expect([asKernel, asMirror]).toStrictEqual(['stick', 'stick'])
    }),
  )

  it.effect('the spelling is lower_snake, which is what made the repoint a re-casing', () =>
    Effect.sync(() => {
      // mc-sim's provisional strings were UPPER_SNAKE. A save or a network frame
      // written by that build says `OAK_PLANKS`, and this is the line that says
      // the two are not the same name.
      for (const item of ITEM_TYPES) {
        expect({ item, ok: /^[a-z][a-z_]*$/u.test(item) }).toStrictEqual({ item, ok: true })
      }
      expect(isItemType('OAK_PLANKS')).toBe(false)
      expect(isItemType('oak_planks')).toBe(true)
    }),
  )

  it.effect('isItemType accepts exactly the roster and nothing else', () =>
    Effect.sync(() => {
      for (const item of KERNEL_ITEM_TYPES) {
        expect({ item, accepted: isItemType(item) }).toStrictEqual({ item, accepted: true })
      }
      // `crafting_table` USED TO BE ASSERTED HERE, as the item mc-sim asked for
      // and kernel declined. Kernel has since added it on a block-side reason of
      // its own, so this line was asserting a refusal that had expired — the
      // mirror was 74 literals short and this probe was one of the things
      // standing guard over the gap. It now lives in the roster above.
      //
      // `air`, `water` and `bedrock` are the durable ones: kernel's header calls
      // `air` a sentinel meaning "no block here" and not a thing, and none of
      // the three is an item in this build. `snow` is the interesting probe —
      // `snowball` IS an item (it is what snow drops) and `snow` is not, so a
      // transcription that reached for the block name would fail here.
      for (const absent of ['air', 'water', 'bedrock', 'lava', 'snow', '']) {
        expect({ absent, accepted: isItemType(absent) }).toStrictEqual({ absent, accepted: false })
      }
    }),
  )

  it.effect('REGRESSION: every item the shipped recipe table names is in kernel’s roster', () =>
    Effect.sync(() => {
      // `tsc` already proves this, and the proof evaporates the moment anyone
      // reaches for a cast to get a recipe to compile. The table is small and
      // this is cheap, so it is asserted rather than assumed.
      const named = STARTER_RECIPES.flatMap((recipe) => [
        recipe.output.item,
        ...(recipe._tag === 'Shaped'
          ? recipe.pattern.cells.flatMap((cell) => (cell === undefined ? [] : [cell.item]))
          : recipe.ingredients.map((ingredient) => ingredient.item)),
      ])

      expect(named.length).toBeGreaterThan(0)
      expect([...new Set(named)].filter((item) => !isItemType(item))).toStrictEqual([])
    }),
  )
})
