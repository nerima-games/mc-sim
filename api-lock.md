# API lock — @nerima-games/mc-sim

<!-- ------------------------------------------------------------------------- -->
<!-- GENERATED FILE. Do not edit by hand.                                      -->
<!--                                                                           -->
<!-- Regenerate with `pnpm api:update`. `pnpm api:check`, which `pnpm verify`  -->
<!-- runs, fails when this file is stale.                                      -->
<!--                                                                           -->
<!-- Every line below is part of the published surface of this package. A diff -->
<!-- here is a diff in what consumers can see, and is the thing plan.md §6     -->
<!-- Step 0-3 asks to be reviewed as a diff. See scripts/api-lock.ts for how   -->
<!-- it is produced and why it is produced this way.                           -->
<!-- ------------------------------------------------------------------------- -->

format: 1
exported declarations: 111
supporting declarations: 24

## Exported

### AUTO_SAVE_INTERVAL  `const`

```ts
const AUTO_SAVE_INTERVAL: Duration.Duration;
```

### AddOutcome  `type`

```ts
type AddOutcome = {
    readonly inventory: Inventory;
    readonly leftover: number;
};
```

### AutoSaveStatus  `type`

```ts
type AutoSaveStatus = 'saving' | 'saved' | 'error';
```

### AutoSaveStatusReporter  `type`

```ts
type AutoSaveStatusReporter = (status: AutoSaveStatus) => Effect.Effect<void>;
```

### CraftGrid  `type`

```ts
type CraftGrid = {
    readonly width: number;
    readonly height: number;
    readonly cells: ReadonlyArray<Slot>;
};
```

### CraftOutcome  `type`

```ts
type CraftOutcome = {
    readonly inventory: Inventory;
    readonly result: CraftResult;
};
```

### CraftResult  `type`

```ts
type CraftResult = {
    readonly _tag: 'Crafted';
    readonly recipeId: RecipeId;
    readonly output: ItemStack;
} | {
    readonly _tag: 'NoMatch';
} | {
    readonly _tag: 'MissingIngredients';
    readonly missing: ReadonlyArray<MissingIngredient>;
} | {
    readonly _tag: 'NoRoom';
};
```

### DEFAULT_DAY_LENGTH_SECS  `const`

```ts
const DEFAULT_DAY_LENGTH_SECS = 400;
```

### EXPERIENCE_MODULE_STAGE_PREFIXES  `const`

```ts
const EXPERIENCE_MODULE_STAGE_PREFIXES: readonly ["gameplay:", "redstone:", "ui:", "multiplayer:"];
```

### EYE_LEVEL_OFFSET  `const`

```ts
const EYE_LEVEL_OFFSET = 1.62;
```

### FIRST_FRAME_DELTA_SECS  `const`

```ts
const FIRST_FRAME_DELTA_SECS: DeltaTimeSecs;
```

### FRAME_QUEUE_CAPACITY  `const`

```ts
const FRAME_QUEUE_CAPACITY = 60;
```

### FrameHandler  `type`

```ts
type FrameHandler = (dt: DeltaTimeSecs) => Effect.Effect<void>;
```

### GameLoop  `class`

```ts
class GameLoop extends GameLoop_base {
}
```

### GameLoopApi  `type`

```ts
type GameLoopApi = {
    readonly start: (handler: FrameHandler) => Effect.Effect<void>;
    readonly submitFrame: (at: MonotonicTimeSecs) => Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
    readonly isRunning: Effect.Effect<boolean>;
    readonly framesProcessed: Effect.Effect<number>;
    readonly framesDropped: Effect.Effect<number>;
    readonly secondsLostToClamp: Effect.Effect<number>;
};
```

### GameLoopLayer  `const`

```ts
const GameLoopLayer: Layer.Layer<GameLoop>;
```

### INITIAL_PLAYER_POSE  `const`

```ts
const INITIAL_PLAYER_POSE: PlayerPose;
```

### INITIAL_TIME_STATE  `const`

```ts
const INITIAL_TIME_STATE: TimeState;
```

### INVENTORY_SLOT_COUNT  `const`

```ts
const INVENTORY_SLOT_COUNT = 36;
```

### Ingredient  `type`

```ts
type Ingredient = {
    readonly _tag: 'Exact';
    readonly item: ItemType;
};
```

### Inventory  `type`

```ts
type Inventory = {
    readonly slots: ReadonlyArray<Slot>;
};
```

### InventoryService  `class`

```ts
class InventoryService extends InventoryService_base {
}
```

### InventoryServiceApi  `type`

```ts
type InventoryServiceApi = {
    readonly add: (item: ItemType, count: number) => Effect.Effect<number>;
    readonly remove: (item: ItemType, count: number) => Effect.Effect<number>;
    readonly countOf: (item: ItemType) => Effect.Effect<number>;
    readonly snapshot: Effect.Effect<Inv.Inventory>;
    readonly restore: (inventory: Inv.Inventory) => Effect.Effect<number>;
    readonly reset: Effect.Effect<void>;
    readonly recipes: Effect.Effect<Recipe.RecipeTable>;
    readonly previewCraft: (grid: Recipe.CraftGrid) => Effect.Effect<Recipe.RecipeMatch>;
    readonly craft: (grid: Recipe.CraftGrid) => Effect.Effect<Craft.CraftResult>;
};
```

### InventoryServiceLayer  `const`

```ts
const InventoryServiceLayer: (initial?: Inv.Inventory, recipeTable?: Recipe.RecipeTable) => Layer.Layer<InventoryService>;
```

### ItemStack  `type`

```ts
type ItemStack = {
    readonly item: ItemType;
    readonly count: StackCount;
};
```

### MAX_DAY_LENGTH_SECS  `const`

```ts
const MAX_DAY_LENGTH_SECS = 1200;
```

### MAX_FRAME_DELTA_SECS  `const`

```ts
const MAX_FRAME_DELTA_SECS = 0.05;
```

### MAX_TIME_FRACTION  `const`

```ts
const MAX_TIME_FRACTION = 0.9999;
```

### MIN_DAY_LENGTH_SECS  `const`

```ts
const MIN_DAY_LENGTH_SECS = 120;
```

### MIN_FRAME_DELTA_SECS  `const`

```ts
const MIN_FRAME_DELTA_SECS = 0.001;
```

### MOON_PHASE_COUNT  `const`

```ts
const MOON_PHASE_COUNT = 8;
```

### MissingIngredient  `type`

```ts
type MissingIngredient = {
    readonly item: ItemType;
    readonly short: number;
};
```

### NormaliseOutcome  `type`

```ts
type NormaliseOutcome = {
    readonly inventory: Inventory;
    readonly leftover: number;
    readonly discarded: number;
};
```

### OWN_STAGE_PREFIX  `const`

```ts
const OWN_STAGE_PREFIX = "sim:";
```

### PITCH_EPSILON  `const`

```ts
const PITCH_EPSILON = 0.01;
```

### PITCH_MAX_RADIANS  `const`

```ts
const PITCH_MAX_RADIANS: number;
```

### PITCH_MIN_RADIANS  `const`

```ts
const PITCH_MIN_RADIANS: number;
```

### PatternCell  `type`

```ts
type PatternCell = Ingredient | undefined;
```

### PlayerPose  `type`

```ts
type PlayerPose = {
    readonly feetPosition: Position;
    readonly yawRadians: number;
    readonly pitchRadians: number;
};
```

### PlayerService  `class`

```ts
class PlayerService extends PlayerService_base {
}
```

### PlayerServiceApi  `type`

```ts
type PlayerServiceApi = {
    readonly pose: Effect.Effect<Camera.PlayerPose>;
    readonly look: (deltaYaw: number, deltaPitch: number) => Effect.Effect<Camera.PlayerPose>;
    readonly moveTo: (feetPosition: Position) => Effect.Effect<void>;
    readonly cameraPose: Effect.Effect<CameraPoseSnapshot, never, ClockPort>;
    readonly restore: (pose: Camera.PlayerPose) => Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
};
```

### PlayerServiceLayer  `const`

```ts
const PlayerServiceLayer: (initial?: Camera.PlayerPose) => Layer.Layer<PlayerService>;
```

### Recipe  `type`

```ts
type Recipe = ShapedRecipe | ShapelessRecipe;
```

### RecipeConflict  `type`

```ts
type RecipeConflict = {
    readonly reason: 'duplicate-id' | 'same-shape' | 'same-ingredients';
    readonly recipeIds: readonly [RecipeId, RecipeId];
};
```

### RecipeId  `type`

```ts
type RecipeId = string;
```

### RecipeMatch  `type`

```ts
type RecipeMatch = {
    readonly _tag: 'Match';
    readonly recipe: Recipe;
    readonly output: ItemStack;
} | {
    readonly _tag: 'NoMatch';
};
```

### RecipePattern  `type`

```ts
type RecipePattern = {
    readonly width: number;
    readonly height: number;
    readonly cells: ReadonlyArray<PatternCell>;
};
```

### RecipeTable  `type`

```ts
type RecipeTable = ReadonlyArray<Recipe>;
```

### RemoveOutcome  `type`

```ts
type RemoveOutcome = {
    readonly inventory: Inventory;
    readonly removed: number;
};
```

### SIM_STAGE_IDS  `const`

```ts
const SIM_STAGE_IDS: {
    readonly physics: StageId;
};
```

### STARTER_RECIPES  `const`

```ts
const STARTER_RECIPES: RecipeTable;
```

### ShapedRecipe  `type`

```ts
type ShapedRecipe = {
    readonly _tag: 'Shaped';
    readonly id: RecipeId;
    readonly pattern: RecipePattern;
    readonly output: ItemStack;
};
```

### ShapelessRecipe  `type`

```ts
type ShapelessRecipe = {
    readonly _tag: 'Shapeless';
    readonly id: RecipeId;
    readonly ingredients: ReadonlyArray<Ingredient>;
    readonly output: ItemStack;
};
```

### SimFrameState  `type`

```ts
type SimFrameState = {
    readonly resolvedFeetPosition: Ref.Ref<Option.Option<Position>>;
};
```

### Slot  `type`

```ts
type Slot = ItemStack | undefined;
```

### TICKS_PER_SECOND  `const`

```ts
const TICKS_PER_SECOND = 60;
```

### TimeService  `class`

```ts
class TimeService extends TimeService_base {
}
```

### TimeServiceApi  `type`

```ts
type TimeServiceApi = {
    readonly advance: (dt: DeltaTimeSecs) => Effect.Effect<void>;
    readonly timeOfDay: Effect.Effect<number>;
    readonly dayLengthSecs: Effect.Effect<number>;
    readonly moonPhase: Effect.Effect<number>;
    readonly isNight: Effect.Effect<boolean>;
    readonly setDayLength: (seconds: number) => Effect.Effect<void>;
    readonly setTimeOfDay: (fraction: number) => Effect.Effect<void>;
    readonly configureDay: (dayLengthSeconds: number, timeOfDayFraction: number) => Effect.Effect<void>;
    readonly snapshot: Effect.Effect<Time.TimeState>;
    readonly restore: (state: Time.TimeState) => Effect.Effect<void>;
};
```

### TimeServiceLayer  `const`

```ts
const TimeServiceLayer: (initial?: Time.TimeState) => Layer.Layer<TimeService>;
```

### TimeState  `type`

```ts
type TimeState = {
    readonly ticks: number;
    readonly dayLengthTicks: number;
};
```

### UPSTREAM_STAGE_IDS  `const`

```ts
const UPSTREAM_STAGE_IDS: {};
```

### addItem  `const`

```ts
const addItem: (inventory: Inventory, item: ItemType, count: number) => AddOutcome;
```

### advance  `const`

```ts
const advance: (state: TimeState, dt: DeltaTimeSecs) => TimeState;
```

### applyLook  `const`

```ts
const applyLook: (pose: PlayerPose, deltaYaw: number, deltaPitch: number) => PlayerPose;
```

### autoSaveSchedule  `const`

```ts
const autoSaveSchedule: (interval?: Duration.Duration) => Schedule.Schedule<number>;
```

### cameraPoseOf  `const`

```ts
const cameraPoseOf: (pose: PlayerPose, capturedAtSecs: MonotonicTimeSecs) => CameraPoseSnapshot;
```

### cellAt  `const`

```ts
const cellAt: (grid: CraftGrid, x: number, y: number) => Slot;
```

### clampFrameDelta  `const`

```ts
const clampFrameDelta: (rawDeltaSecs: number) => DeltaTimeSecs;
```

### clampPitch  `const`

```ts
const clampPitch: (pitchRadians: number) => number;
```

### conflictsIn  `const`

```ts
const conflictsIn: (table: RecipeTable) => ReadonlyArray<RecipeConflict>;
```

### countOf  `const`

```ts
const countOf: (inventory: Inventory, item: ItemType) => number;
```

### craftFromGrid  `const`

```ts
const craftFromGrid: (inventory: Inventory, table: RecipeTable, grid: CraftGrid) => CraftOutcome;
```

### craftGrid  `const`

```ts
const craftGrid: (width: number, height: number, items: ReadonlyArray<ItemType | undefined>) => CraftGrid;
```

### dayLengthSecs  `const`

```ts
const dayLengthSecs: (state: TimeState) => number;
```

### emptyInventory  `const`

```ts
const emptyInventory: () => Inventory;
```

### exactly  `const`

```ts
const exactly: (item: ItemType) => Ingredient;
```

### forwardVector  `const`

```ts
const forwardVector: (snapshot: CameraPoseSnapshot) => Position;
```

### frameDeltaBetween  `const`

```ts
const frameDeltaBetween: (previousSecs: number | undefined, nowSecs: number) => DeltaTimeSecs;
```

### frameDeltaLossBetween  `const`

```ts
const frameDeltaLossBetween: (previousSecs: number | undefined, nowSecs: number) => number;
```

### frameDeltaLossSecs  `const`

```ts
const frameDeltaLossSecs: (rawDeltaSecs: number) => number;
```

### ingredientCost  `const`

```ts
const ingredientCost: (grid: CraftGrid) => ReadonlyMap<ItemType, number>;
```

### ingredientMatches  `const`

```ts
const ingredientMatches: (ingredient: Ingredient, item: ItemType) => boolean;
```

### isEmpty  `const`

```ts
const isEmpty: (inventory: Inventory) => boolean;
```

### isNight  `const`

```ts
const isNight: (state: TimeState) => boolean;
```

### isValidTimeState  `const`

```ts
const isValidTimeState: (state: TimeState) => boolean;
```

### itemStack  `const`

```ts
const itemStack: (item: ItemType, count: number) => ItemStack;
```

### makeGameLoop  `const`

```ts
const makeGameLoop: () => Effect.Effect<GameLoopApi>;
```

### makeInventoryService  `const`

```ts
const makeInventoryService: (initial?: Inv.Inventory, recipeTable?: Recipe.RecipeTable) => Effect.Effect<InventoryServiceApi>;
```

### makePlayerService  `const`

```ts
const makePlayerService: (initial?: Camera.PlayerPose) => Effect.Effect<PlayerServiceApi>;
```

### makeSimFrameState  `const`

```ts
const makeSimFrameState: Effect.Effect<SimFrameState>;
```

### makeSimStages  `const`

```ts
const makeSimStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, TimeService | PlayerService>;
```

### makeSimStagesForPreview  `const`

```ts
const makeSimStagesForPreview: Effect.Effect<{
    readonly state: SimFrameState;
    readonly stages: ReadonlyArray<StageRegistration>;
}, never, TimeService | PlayerService>;
```

### makeTimeService  `const`

```ts
const makeTimeService: (initial?: Time.TimeState) => Effect.Effect<TimeServiceApi>;
```

### matchRecipe  `const`

```ts
const matchRecipe: (table: RecipeTable, grid: CraftGrid) => RecipeMatch;
```

### moonPhase  `const`

```ts
const moonPhase: (state: TimeState) => number;
```

### normaliseInventory  `const`

```ts
const normaliseInventory: (inventory: Inventory) => NormaliseOutcome;
```

### normaliseTimeState  `const`

```ts
const normaliseTimeState: (state: TimeState) => TimeState;
```

### performAutoSaveTick  `const`

```ts
const performAutoSaveTick: <E>(persist: Effect.Effect<void, E>, reporter?: AutoSaveStatusReporter) => Effect.Effect<void>;
```

### removeItem  `const`

```ts
const removeItem: (inventory: Inventory, item: ItemType, count: number) => RemoveOutcome;
```

### setDayLength  `const`

```ts
const setDayLength: (state: TimeState, seconds: number) => TimeState;
```

### setDayLengthThenTimeOfDay  `const`

```ts
const setDayLengthThenTimeOfDay: (state: TimeState, seconds: number, fraction: number) => TimeState;
```

### setTimeOfDay  `const`

```ts
const setTimeOfDay: (state: TimeState, fraction: number) => TimeState;
```

### shapedRecipe  `const`

```ts
const shapedRecipe: (id: RecipeId, rows: ReadonlyArray<string>, key: Readonly<Record<string, ItemType>>, output: ItemStack) => ShapedRecipe;
```

### shapelessRecipe  `const`

```ts
const shapelessRecipe: (id: RecipeId, items: ReadonlyArray<ItemType>, output: ItemStack) => ShapelessRecipe;
```

### simModule  `const`

```ts
const simModule: GameModule<InventoryService | PlayerService | TimeService, never, never, PlayerService | TimeService>;
```

### simStages  `const`

```ts
const simStages: (state: SimFrameState, time: TimeServiceApi, player: PlayerServiceApi) => ReadonlyArray<StageRegistration>;
```

### slotAt  `const`

```ts
const slotAt: (inventory: Inventory, index: number) => Slot;
```

### snapshotAgeSecs  `const`

```ts
const snapshotAgeSecs: (snapshot: CameraPoseSnapshot, now: MonotonicTimeSecs) => number;
```

### startAutoSaveDaemon  `const`

```ts
const startAutoSaveDaemon: <E>(persist: Effect.Effect<void, E>, interval?: Duration.Duration, reporter?: AutoSaveStatusReporter) => Effect.Effect<Fiber.RuntimeFiber<number, never>>;
```

### timeOfDay  `const`

```ts
const timeOfDay: (state: TimeState) => number;
```

### withFeetPosition  `const`

```ts
const withFeetPosition: (pose: PlayerPose, feetPosition: Position) => PlayerPose;
```

## Supporting declarations

Not exported from the barrel, but named by the signatures above, so a
consumer is exposed to them. `Context.Tag` service classes emit their real
type onto one of these.

### CameraPoseSnapshot  `type`

```ts
type CameraPoseSnapshot = {
    readonly position: Position;
    readonly yawRadians: number;
    readonly pitchRadians: number;
    readonly capturedAtSecs: MonotonicTimeSecs;
};
```

### ClockPort  `class`

```ts
class ClockPort extends ClockPort_base {
}
```

### ClockPort_base  `const`

```ts
const ClockPort_base: Context.TagClass<ClockPort, "@nerima-games/mc-kernel/ClockPort", ClockService>;
```

### ClockService  `type`

```ts
type ClockService = {
    readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>;
    readonly wallClockEpochMillis: Effect.Effect<EpochMillis>;
};
```

### DeltaTimeSecs  `const`

```ts
const DeltaTimeSecs: Brand.Brand.Constructor<DeltaTimeSecs>;
```

### DeltaTimeSecs  `type`

```ts
type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>;
```

### EpochMillis  `const`

```ts
const EpochMillis: Brand.Brand.Constructor<EpochMillis>;
```

### EpochMillis  `type`

```ts
type EpochMillis = number & Brand.Brand<'EpochMillis'>;
```

### FrameServices  `type`

```ts
type FrameServices = ClockPort;
```

### GameLoop_base  `const`

```ts
const GameLoop_base: Context.TagClass<GameLoop, "@nerima-games/mc-sim/GameLoop", GameLoopApi>;
```

### GameModule  `interface`

```ts
interface GameModule<ROut, E, RIn, RRegister = never> {
    readonly layers: Layer.Layer<ROut, E, RIn>;
    readonly frameStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, RRegister>;
}
```

### ITEM_TYPES  `const`

```ts
const ITEM_TYPES: readonly ["stone", "cobblestone", "dirt", "grass_block", "sand", "gravel", "oak_log", "oak_planks", "oak_leaves", "glass", "torch", "glowstone", "piston", "stick", "glowstone_dust", "wooden_pickaxe"];
```

### InventoryService_base  `const`

```ts
const InventoryService_base: Context.TagClass<InventoryService, "@nerima-games/mc-sim/InventoryService", InventoryServiceApi>;
```

### ItemType  `type`

```ts
type ItemType = (typeof ITEM_TYPES)[number];
```

### MonotonicTimeSecs  `const`

```ts
const MonotonicTimeSecs: Brand.Brand.Constructor<MonotonicTimeSecs>;
```

### MonotonicTimeSecs  `type`

```ts
type MonotonicTimeSecs = number & Brand.Brand<'MonotonicTimeSecs'>;
```

### PlayerService_base  `const`

```ts
const PlayerService_base: Context.TagClass<PlayerService, "@nerima-games/mc-sim/PlayerService", PlayerServiceApi>;
```

### Position  `type`

```ts
type Position = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### StackCount  `const`

```ts
const StackCount: Brand.Brand.Constructor<StackCount>;
```

### StackCount  `type`

```ts
type StackCount = number & Brand.Brand<'StackCount'>;
```

### StageId  `const`

```ts
const StageId: Brand.Brand.Constructor<StageId>;
```

### StageId  `type`

```ts
type StageId = string & Brand.Brand<'StageId'>;
```

### StageRegistration  `interface`

```ts
interface StageRegistration {
    readonly id: StageId;
    readonly after?: ReadonlyArray<StageId>;
    readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>;
}
```

### TimeService_base  `const`

```ts
const TimeService_base: Context.TagClass<TimeService, "@nerima-games/mc-sim/TimeService", TimeServiceApi>;
```
