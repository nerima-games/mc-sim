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
exported declarations: 299
supporting declarations: 30

## Exported

### AUTO_SAVE_INTERVAL  `const`

```ts
const AUTO_SAVE_INTERVAL: Duration.Duration;
```

### AchievementId  `type`

```ts
type AchievementId = string;
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

### BehaviourRepair  `type`

```ts
type BehaviourRepair<S> = (kind: EntityKind, behaviour: S) => S;
```

### BlockTarget  `type`

```ts
type BlockTarget = {
    readonly position: Position;
    readonly adjacentPosition: Position;
    readonly distance: number;
};
```

### CameraOrientation  `type`

```ts
type CameraOrientation = Pick<CameraPoseSnapshot, 'yawRadians' | 'pitchRadians'>;
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

### DEFAULT_MAX_HEALTH_POINTS  `const`

```ts
const DEFAULT_MAX_HEALTH_POINTS = 20;
```

### DEFAULT_MAX_HUNGER_POINTS  `const`

```ts
const DEFAULT_MAX_HUNGER_POINTS = 20;
```

### DEFAULT_SETTINGS  `const`

```ts
const DEFAULT_SETTINGS: Settings;
```

### DESPAWNED  `const`

```ts
const DESPAWNED: EntityTransition<never>;
```

### Damage  `type`

```ts
type Damage = {
    readonly amount: number;
    readonly cause: DamageCause;
};
```

### DamageAtResult  `type`

```ts
type DamageAtResult = Eq.DamageEquipmentResult | {
    readonly _tag: 'InvalidLocation';
};
```

### DamageCause  `type`

```ts
type DamageCause = string;
```

### DamageEquipmentResult  `type`

```ts
type DamageEquipmentResult = {
    readonly _tag: 'InvalidAmount';
    readonly amount: number;
} | {
    readonly _tag: 'Empty';
} | {
    readonly _tag: 'NotDamageable';
    readonly item: EquipmentItem;
} | {
    readonly _tag: 'Damaged';
    readonly item: EquipmentItem;
    readonly applied: number;
} | {
    readonly _tag: 'Broken';
    readonly item: EquipmentItem;
    readonly applied: number;
};
```

### DamageOutcome  `type`

```ts
type DamageOutcome = {
    readonly vitals: Vitals.Vitals;
    readonly died: boolean;
};
```

### DespawnOutcome  `type`

```ts
type DespawnOutcome<S> = {
    readonly roster: EntityRoster<S>;
    readonly despawned: boolean;
};
```

### Durability  `type`

```ts
type Durability = {
    readonly current: number;
    readonly max: number;
};
```

### EMPTY_STATISTICS  `const`

```ts
const EMPTY_STATISTICS: Statistics;
```

### ENTITY_ID_PREFIX  `const`

```ts
const ENTITY_ID_PREFIX = "e:";
```

### ENTITY_MANAGER_TAG_KEY  `const`

```ts
const ENTITY_MANAGER_TAG_KEY = "@nerima-games/mc-sim/EntityManager";
```

### EQUIPMENT_CATALOG  `const`

```ts
const EQUIPMENT_CATALOG: {
    readonly iron_helmet: {
        readonly slot: "head";
        readonly maxDurability: 165;
    };
    readonly iron_chestplate: {
        readonly slot: "chest";
        readonly maxDurability: 240;
    };
    readonly iron_leggings: {
        readonly slot: "legs";
        readonly maxDurability: 225;
    };
    readonly iron_boots: {
        readonly slot: "feet";
        readonly maxDurability: 195;
    };
    readonly flint_and_steel: {
        readonly slot: "offhand";
        readonly maxDurability: 64;
    };
};
```

### EQUIPMENT_SLOTS  `const`

```ts
const EQUIPMENT_SLOTS: readonly ["head", "chest", "legs", "feet", "offhand"];
```

### EXHAUSTION_PER_POINT  `const`

```ts
const EXHAUSTION_PER_POINT = 4;
```

### EXHAUSTION_PER_REGEN  `const`

```ts
const EXHAUSTION_PER_REGEN = 6;
```

### EXPERIENCE_MODULE_STAGE_PREFIXES  `const`

```ts
const EXPERIENCE_MODULE_STAGE_PREFIXES: readonly ["gameplay:", "redstone:", "ui:", "multiplayer:"];
```

### EYE_LEVEL_OFFSET  `const`

```ts
const EYE_LEVEL_OFFSET = 1.62;
```

### Entity  `type`

```ts
type Entity<S> = EntityState<S> & {
    readonly id: EntityId;
    readonly kind: EntityKind;
};
```

### EntityId  `const`

```ts
const EntityId: Brand.Brand.Constructor<EntityId>;
```

### EntityId  `type`

```ts
type EntityId = string & Brand.Brand<'EntityId'>;
```

### EntityKind  `const`

```ts
const EntityKind: Brand.Brand.Constructor<EntityKind>;
```

### EntityKind  `type`

```ts
type EntityKind = string & Brand.Brand<'EntityKind'>;
```

### EntityManager  `type`

```ts
type EntityManager = {
    readonly _tag: '@nerima-games/mc-sim/EntityManager';
};
```

### EntityManagerApi  `type`

```ts
type EntityManagerApi<S> = {
    readonly spawn: (request: SpawnRequest<S>) => Effect.Effect<Entity<S>>;
    readonly despawn: (id: EntityId) => Effect.Effect<boolean>;
    readonly entities: Effect.Effect<ReadonlyArray<Entity<S>>>;
    readonly find: (id: EntityId) => Effect.Effect<Entity<S> | undefined>;
    readonly count: Effect.Effect<number>;
    readonly countOfKind: (kind: EntityKind) => Effect.Effect<number>;
    readonly sweep: <A>(step: (entity: Entity<S>) => EntityStep<S, A>) => Effect.Effect<ReadonlyArray<A>>;
    readonly snapshot: Effect.Effect<EntityRoster<S>>;
    readonly restore: (roster: EntityRoster<S>) => Effect.Effect<RosterRepair>;
    readonly reset: Effect.Effect<void>;
};
```

### EntityManagerLayer  `const`

```ts
const EntityManagerLayer: <S>(initial?: EntityRoster<S>, repairBehaviour?: BehaviourRepair<S>) => Layer.Layer<EntityManager>;
```

### EntityRoster  `type`

```ts
type EntityRoster<S> = {
    readonly entities: ReadonlyArray<Entity<S>>;
    readonly nextSerial: number;
};
```

### EntityState  `type`

```ts
type EntityState<S> = {
    readonly feetPosition: Position;
    readonly healthPoints: number;
    readonly behaviour: S;
};
```

### EntityStep  `type`

```ts
type EntityStep<S, A> = {
    readonly transition: EntityTransition<S>;
    readonly emit: A | undefined;
};
```

### EntityTransition  `type`

```ts
type EntityTransition<S> = {
    readonly _tag: 'Unchanged';
} | {
    readonly _tag: 'Changed';
    readonly state: EntityState<S>;
} | {
    readonly _tag: 'Despawned';
};
```

### EquipFromInventoryResult  `type`

```ts
type EquipFromInventoryResult = {
    readonly _tag: 'Equipped';
    readonly item: Eq.EquipmentItem;
} | {
    readonly _tag: 'InvalidInventorySlot';
} | {
    readonly _tag: 'InvalidEquipmentSlot';
} | {
    readonly _tag: 'Empty';
} | {
    readonly _tag: 'Occupied';
    readonly item: Eq.EquipmentItem;
} | {
    readonly _tag: 'Incompatible';
    readonly item: Inv.ItemStack;
};
```

### Equipment  `type`

```ts
type Equipment = {
    readonly slots: EquipmentSlots;
};
```

### EquipmentDefinition  `type`

```ts
type EquipmentDefinition = {
    readonly slot: EquipmentSlot;
    readonly maxDurability: number;
};
```

### EquipmentItem  `type`

```ts
type EquipmentItem = ItemStack & {
    readonly durability: Durability | null;
};
```

### EquipmentOutcome  `type`

```ts
type EquipmentOutcome<A> = {
    readonly equipment: Equipment;
    readonly result: A;
};
```

### EquipmentService  `class`

```ts
class EquipmentService extends EquipmentService_base {
}
```

### EquipmentServiceApi  `type`

```ts
type EquipmentServiceApi = {
    readonly equip: (slot: Equipment.EquipmentSlot, item: Equipment.EquipmentItem) => Effect.Effect<Equipment.EquipmentItem | null, Equipment.EquipmentValidationError>;
    readonly unequip: (slot: Equipment.EquipmentSlot) => Effect.Effect<Equipment.EquipmentItem | null, Equipment.EquipmentValidationError>;
    readonly swap: (first: Equipment.EquipmentSlot, second: Equipment.EquipmentSlot) => Effect.Effect<void, Equipment.EquipmentValidationError>;
    readonly damage: (slot: Equipment.EquipmentSlot, amount: number) => Effect.Effect<Equipment.DamageEquipmentResult, Equipment.EquipmentValidationError>;
    readonly snapshot: Effect.Effect<Equipment.Equipment>;
    readonly restore: (snapshot: unknown) => Effect.Effect<void, Equipment.EquipmentValidationError>;
    readonly reset: Effect.Effect<void>;
};
```

### EquipmentServiceLayer  `const`

```ts
const EquipmentServiceLayer: Layer.Layer<EquipmentService>;
```

### EquipmentSlot  `type`

```ts
type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];
```

### EquipmentSlots  `type`

```ts
type EquipmentSlots = Readonly<Record<EquipmentSlot, EquipmentItem | null>>;
```

### EquipmentValidationError  `type`

```ts
type EquipmentValidationError = {
    readonly _tag: 'EquipmentValidationError';
    readonly path: string;
    readonly reason: string;
};
```

### EquipmentValidationResult  `type`

```ts
type EquipmentValidationResult = {
    readonly _tag: 'Valid';
    readonly equipment: Equipment;
} | {
    readonly _tag: 'Invalid';
    readonly error: EquipmentValidationError;
};
```

### EquippableItemType  `type`

```ts
type EquippableItemType = keyof typeof EQUIPMENT_CATALOG;
```

### FIRST_FRAME_DELTA_SECS  `const`

```ts
const FIRST_FRAME_DELTA_SECS: DeltaTimeSecs;
```

### FLINT_AND_STEEL_MAX_DURABILITY  `const`

```ts
const FLINT_AND_STEEL_MAX_DURABILITY: 64;
```

### FOOD_TICK_SECS  `const`

```ts
const FOOD_TICK_SECS = 4;
```

### FRAME_QUEUE_CAPACITY  `const`

```ts
const FRAME_QUEUE_CAPACITY = 60;
```

### FoodTickSignal  `type`

```ts
type FoodTickSignal = 'none' | 'regen' | 'starve';
```

### FrameHandler  `type`

```ts
type FrameHandler = (dt: DeltaTimeSecs) => Effect.Effect<void>;
```

### GRAPHICS_QUALITIES  `const`

```ts
const GRAPHICS_QUALITIES: readonly ["low", "medium", "high", "ultra"];
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

### GraphicsQuality  `type`

```ts
type GraphicsQuality = (typeof GRAPHICS_QUALITIES)[number];
```

### INITIAL_PLAYER_DIMENSION  `const`

```ts
const INITIAL_PLAYER_DIMENSION: Dimension;
```

### INITIAL_PLAYER_POSE  `const`

```ts
const INITIAL_PLAYER_POSE: PlayerPose;
```

### INITIAL_TIME_STATE  `const`

```ts
const INITIAL_TIME_STATE: TimeState;
```

### INITIAL_WEATHER_STATE  `const`

```ts
const INITIAL_WEATHER_STATE: WeatherState;
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

### InventoryCarriedSlot  `type`

```ts
type InventoryCarriedSlot = InventoryCarriedStack | undefined;
```

### InventoryCarriedStack  `type`

```ts
type InventoryCarriedStack = Inv.ItemStack & {
    readonly durability?: Eq.Durability | undefined;
};
```

### InventoryClick  `type`

```ts
type InventoryClick = {
    readonly _tag: 'LeftClick';
    readonly slotIndex: number;
    readonly carried: InventoryCarriedSlot;
} | {
    readonly _tag: 'RightClick';
    readonly slotIndex: number;
    readonly carried: InventoryCarriedSlot;
};
```

### InventoryClickResult  `type`

```ts
type InventoryClickResult = {
    readonly _tag: 'PickedUp';
    readonly carried: InventoryCarriedStack;
} | {
    readonly _tag: 'Placed';
    readonly carried: InventoryCarriedSlot;
} | {
    readonly _tag: 'Merged';
    readonly carried: InventoryCarriedSlot;
} | {
    readonly _tag: 'Swapped';
    readonly carried: InventoryCarriedStack;
} | {
    readonly _tag: 'NoChange';
    readonly carried: InventoryCarriedSlot;
} | {
    readonly _tag: 'InvalidSlot';
    readonly carried: InventoryCarriedSlot;
} | {
    readonly _tag: 'InvalidCount';
    readonly carried: InventoryCarriedSlot;
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
    readonly removeAt: (slotIndex: number, expectedItem: ItemType, count: number) => Effect.Effect<Inv.RemoveAtResult>;
    readonly click: (click: InventoryClick) => Effect.Effect<InventoryClickResult>;
    readonly countOf: (item: ItemType) => Effect.Effect<number>;
    readonly snapshot: Effect.Effect<Inv.Inventory>;
    readonly equipmentSnapshot: Effect.Effect<Eq.Equipment>;
    readonly storageSnapshot: Effect.Effect<Storage.PlayerStorage>;
    readonly restoreStorage: (snapshot: unknown) => Effect.Effect<void, Storage.PlayerStorageValidationError>;
    readonly equipFromInventory: (inventorySlot: number, equipmentSlot: Eq.EquipmentSlot) => Effect.Effect<Storage.EquipFromInventoryResult>;
    readonly unequipToInventory: (equipmentSlot: Eq.EquipmentSlot, inventorySlot?: number) => Effect.Effect<Storage.UnequipToInventoryResult>;
    readonly damageAt: (location: Storage.StorageLocation, amount: number) => Effect.Effect<Storage.DamageAtResult>;
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

### MAX_EXHAUSTION  `const`

```ts
const MAX_EXHAUSTION = 40;
```

### MAX_FOV_DEGREES  `const`

```ts
const MAX_FOV_DEGREES = 110;
```

### MAX_FRAME_DELTA_SECS  `const`

```ts
const MAX_FRAME_DELTA_SECS = 0.05;
```

### MAX_MOUSE_SENSITIVITY  `const`

```ts
const MAX_MOUSE_SENSITIVITY = 3;
```

### MAX_RENDER_DISTANCE  `const`

```ts
const MAX_RENDER_DISTANCE = 16;
```

### MAX_TIME_FRACTION  `const`

```ts
const MAX_TIME_FRACTION = 0.9999;
```

### MAX_VOLUME  `const`

```ts
const MAX_VOLUME = 1;
```

### MIN_DAY_LENGTH_SECS  `const`

```ts
const MIN_DAY_LENGTH_SECS = 120;
```

### MIN_FOV_DEGREES  `const`

```ts
const MIN_FOV_DEGREES = 30;
```

### MIN_FRAME_DELTA_SECS  `const`

```ts
const MIN_FRAME_DELTA_SECS = 0.001;
```

### MIN_MOUSE_SENSITIVITY  `const`

```ts
const MIN_MOUSE_SENSITIVITY = 0.1;
```

### MIN_RENDER_DISTANCE  `const`

```ts
const MIN_RENDER_DISTANCE = 2;
```

### MIN_VOLUME  `const`

```ts
const MIN_VOLUME = 0;
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

### MovementIntent  `type`

```ts
type MovementIntent = {
    readonly forward: number;
    readonly strafe: number;
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

### NormaliseRosterOutcome  `type`

```ts
type NormaliseRosterOutcome<S> = RosterRepair & {
    readonly roster: EntityRoster<S>;
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
    readonly dimension: Effect.Effect<Dimension>;
    readonly look: (deltaYaw: number, deltaPitch: number) => Effect.Effect<Camera.PlayerPose>;
    readonly moveTo: (feetPosition: Position) => Effect.Effect<void>;
    readonly setDimension: (dimension: Dimension) => Effect.Effect<void>;
    readonly cameraPose: Effect.Effect<CameraPoseSnapshot, never, ClockPort>;
    readonly restore: (pose: Camera.PlayerPose, dimension: Dimension) => Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
};
```

### PlayerServiceLayer  `const`

```ts
const PlayerServiceLayer: (initial?: Camera.PlayerPose, initialDimension?: Dimension) => Layer.Layer<PlayerService>;
```

### PlayerStorage  `type`

```ts
type PlayerStorage = {
    readonly inventory: Inv.Inventory;
    readonly equipment: Eq.Equipment;
    readonly inventoryDurability: ReadonlyArray<Eq.Durability | null>;
};
```

### PlayerStorageValidationError  `type`

```ts
type PlayerStorageValidationError = {
    readonly _tag: 'PlayerStorageValidationError';
    readonly path: string;
    readonly reason: string;
};
```

### PlayerStorageValidationResult  `type`

```ts
type PlayerStorageValidationResult = {
    readonly _tag: 'Valid';
    readonly storage: PlayerStorage;
} | {
    readonly _tag: 'Invalid';
    readonly error: PlayerStorageValidationError;
};
```

### REGEN_HUNGER_THRESHOLD  `const`

```ts
const REGEN_HUNGER_THRESHOLD = 18;
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

### RemoveAtOutcome  `type`

```ts
type RemoveAtOutcome = {
    readonly inventory: Inventory;
    readonly result: RemoveAtResult;
};
```

### RemoveAtResult  `type`

```ts
type RemoveAtResult = {
    readonly _tag: 'Removed';
    readonly removed: number;
} | {
    readonly _tag: 'InvalidSlot';
} | {
    readonly _tag: 'InvalidCount';
} | {
    readonly _tag: 'EmptySlot';
} | {
    readonly _tag: 'ItemMismatch';
    readonly actualItem: ItemType;
} | {
    readonly _tag: 'Insufficient';
    readonly available: number;
};
```

### RemoveOutcome  `type`

```ts
type RemoveOutcome = {
    readonly inventory: Inventory;
    readonly removed: number;
};
```

### RosterRepair  `type`

```ts
type RosterRepair = {
    readonly discarded: number;
    readonly reidentified: number;
};
```

### SIM_STAGE_IDS  `const`

```ts
const SIM_STAGE_IDS: {
    readonly physics: StageId;
};
```

### SPAWN_SATURATION  `const`

```ts
const SPAWN_SATURATION = 5;
```

### SPAWN_VITALS  `const`

```ts
const SPAWN_VITALS: Vitals;
```

### STARTER_RECIPES  `const`

```ts
const STARTER_RECIPES: RecipeTable;
```

### Settings  `type`

```ts
type Settings = {
    readonly renderDistance: number;
    readonly fovDegrees: number;
    readonly graphicsQuality: GraphicsQuality;
    readonly audioEnabled: boolean;
    readonly masterVolume: number;
    readonly musicVolume: number;
    readonly sfxVolume: number;
    readonly mouseSensitivity: number;
    readonly keyBindings: Readonly<Record<string, string>>;
};
```

### SettingsService  `class`

```ts
class SettingsService extends SettingsService_base {
}
```

### SettingsServiceApi  `type`

```ts
type SettingsServiceApi = {
    readonly snapshot: Effect.Effect<Settings.Settings>;
    readonly update: (patch: Partial<Settings.Settings>) => Effect.Effect<Settings.Settings>;
    readonly bindKey: (action: string, code: string) => Effect.Effect<void>;
    readonly unbindKey: (action: string) => Effect.Effect<void>;
    readonly restore: (settings: Settings.Settings) => Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
};
```

### SettingsServiceLayer  `const`

```ts
const SettingsServiceLayer: (initial?: Settings.Settings) => Layer.Layer<SettingsService>;
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
    readonly movementIntent: Ref.Ref<MovementIntent>;
    readonly jumpIntent: Ref.Ref<boolean>;
    readonly velocity: Ref.Ref<Vec3>;
    readonly isGrounded: Ref.Ref<boolean>;
    readonly physicsConfig: Ref.Ref<Option.Option<SimPhysicsConfig>>;
};
```

### SimPhysicsConfig  `type`

```ts
type SimPhysicsConfig = {
    readonly resolve: ResolveOptions;
    readonly walkSpeed: number;
    readonly jumpSpeed: number;
};
```

### Slot  `type`

```ts
type Slot = ItemStack | undefined;
```

### SpawnOutcome  `type`

```ts
type SpawnOutcome<S> = {
    readonly roster: EntityRoster<S>;
    readonly entity: Entity<S>;
};
```

### SpawnRequest  `type`

```ts
type SpawnRequest<S> = {
    readonly kind: EntityKind;
    readonly feetPosition: Position;
    readonly healthPoints: number;
    readonly behaviour: S;
};
```

### StatisticKey  `type`

```ts
type StatisticKey = string;
```

### Statistics  `type`

```ts
type Statistics = {
    readonly counters: Readonly<Record<StatisticKey, number>>;
    readonly unlocked: ReadonlyArray<AchievementId>;
};
```

### StatisticsService  `class`

```ts
class StatisticsService extends StatisticsService_base {
}
```

### StatisticsServiceApi  `type`

```ts
type StatisticsServiceApi = {
    readonly snapshot: Effect.Effect<Statistics.Statistics>;
    readonly record: (key: Statistics.StatisticKey, amount?: number) => Effect.Effect<void>;
    readonly counterOf: (key: Statistics.StatisticKey) => Effect.Effect<number>;
    readonly unlock: (id: Statistics.AchievementId) => Effect.Effect<void>;
    readonly isUnlocked: (id: Statistics.AchievementId) => Effect.Effect<boolean>;
    readonly restore: (statistics: Statistics.Statistics) => Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
};
```

### StatisticsServiceLayer  `const`

```ts
const StatisticsServiceLayer: (initial?: Statistics.Statistics) => Layer.Layer<StatisticsService>;
```

### StorageLocation  `type`

```ts
type StorageLocation = {
    readonly _tag: 'Inventory';
    readonly slotIndex: number;
} | {
    readonly _tag: 'Equipment';
    readonly slot: Eq.EquipmentSlot;
};
```

### StorageOutcome  `type`

```ts
type StorageOutcome<A> = {
    readonly storage: PlayerStorage;
    readonly result: A;
};
```

### SweepOutcome  `type`

```ts
type SweepOutcome<S, A> = {
    readonly roster: EntityRoster<S>;
    readonly emitted: ReadonlyArray<A>;
};
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

### UNCHANGED  `const`

```ts
const UNCHANGED: EntityTransition<never>;
```

### UPSTREAM_STAGE_IDS  `const`

```ts
const UPSTREAM_STAGE_IDS: {};
```

### UnequipToInventoryResult  `type`

```ts
type UnequipToInventoryResult = {
    readonly _tag: 'Unequipped';
    readonly item: Eq.EquipmentItem;
    readonly slotIndex: number;
} | {
    readonly _tag: 'InvalidEquipmentSlot';
} | {
    readonly _tag: 'InvalidInventorySlot';
} | {
    readonly _tag: 'Empty';
} | {
    readonly _tag: 'OccupiedInventorySlot';
} | {
    readonly _tag: 'InventoryFull';
};
```

### Vitals  `type`

```ts
type Vitals = {
    readonly healthPoints: number;
    readonly maxHealthPoints: number;
    readonly hungerPoints: number;
    readonly maxHungerPoints: number;
    readonly saturation: number;
    readonly exhaustion: number;
    readonly foodTimerSecs: number;
    readonly totalExperience: number;
    readonly lastDamageCause: DamageCause | undefined;
};
```

### VitalsService  `class`

```ts
class VitalsService extends VitalsService_base {
}
```

### VitalsServiceApi  `type`

```ts
type VitalsServiceApi = {
    readonly snapshot: Effect.Effect<Vitals.Vitals>;
    readonly view: Effect.Effect<Vitals.VitalsView>;
    readonly damage: (damage: Vitals.Damage) => Effect.Effect<DamageOutcome>;
    readonly heal: (amount: number) => Effect.Effect<Vitals.Vitals>;
    readonly addExhaustion: (amount: number) => Effect.Effect<void>;
    readonly eat: (foodPoints: number, saturationModifier: number) => Effect.Effect<void>;
    readonly advanceFoodTimer: (dt: DeltaTimeSecs) => Effect.Effect<Vitals.FoodTickSignal>;
    readonly addExperience: (amount: number) => Effect.Effect<Vitals.Vitals>;
    readonly respawn: Effect.Effect<void>;
    readonly restore: (vitals: Vitals.Vitals) => Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
};
```

### VitalsServiceLayer  `const`

```ts
const VitalsServiceLayer: (initial?: Vitals.Vitals) => Layer.Layer<VitalsService>;
```

### VitalsView  `type`

```ts
type VitalsView = {
    readonly healthPoints: number;
    readonly maxHealthPoints: number;
    readonly hungerPoints: number;
    readonly maxHungerPoints: number;
    readonly experienceLevel: number;
    readonly experienceProgress: number;
};
```

### WEATHERS  `const`

```ts
const WEATHERS: readonly ["clear", "rain", "thunder"];
```

### Weather  `type`

```ts
type Weather = (typeof WEATHERS)[number];
```

### WeatherService  `class`

```ts
class WeatherService extends WeatherService_base {
}
```

### WeatherServiceApi  `type`

```ts
type WeatherServiceApi = {
    readonly snapshot: Effect.Effect<Weather.WeatherState>;
    readonly applyTransition: (next: Weather.WeatherState) => Effect.Effect<Weather.WeatherState>;
    readonly restore: (weather: Weather.WeatherState) => Effect.Effect<void>;
    readonly reset: Effect.Effect<void>;
};
```

### WeatherServiceLayer  `const`

```ts
const WeatherServiceLayer: (initial?: Weather.WeatherState) => Layer.Layer<WeatherService>;
```

### WeatherState  `type`

```ts
type WeatherState = {
    readonly weather: Weather;
    readonly remainingSecs: number;
};
```

### addExhaustion  `const`

```ts
const addExhaustion: (vitals: Vitals, amount: number) => Vitals;
```

### addExperience  `const`

```ts
const addExperience: (vitals: Vitals, amount: number) => Vitals;
```

### addItem  `const`

```ts
const addItem: (inventory: Inventory, item: ItemType, count: number) => AddOutcome;
```

### advance  `const`

```ts
const advance: (state: TimeState, dt: DeltaTimeSecs) => TimeState;
```

### advanceFoodTimer  `const`

```ts
const advanceFoodTimer: (vitals: Vitals, dt: DeltaTimeSecs) => readonly [FoodTickSignal, Vitals];
```

### applyDamage  `const`

```ts
const applyDamage: (vitals: Vitals, damage: Damage) => Vitals;
```

### applyLook  `const`

```ts
const applyLook: (pose: PlayerPose, deltaYaw: number, deltaPitch: number) => PlayerPose;
```

### applySettings  `const`

```ts
const applySettings: (current: Settings, patch: Partial<Settings>) => Settings;
```

### autoSaveSchedule  `const`

```ts
const autoSaveSchedule: (interval?: Duration.Duration) => Schedule.Schedule<number>;
```

### bindKey  `const`

```ts
const bindKey: (settings: Settings, action: string, code: string) => Settings;
```

### cameraPoseOf  `const`

```ts
const cameraPoseOf: (pose: PlayerPose, capturedAtSecs: MonotonicTimeSecs) => CameraPoseSnapshot;
```

### cellAt  `const`

```ts
const cellAt: (grid: CraftGrid, x: number, y: number) => Slot;
```

### changed  `const`

```ts
const changed: <S>(state: EntityState<S>) => EntityTransition<S>;
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

### countOfKind  `const`

```ts
const countOfKind: <S>(roster: EntityRoster<S>, kind: EntityKind) => number;
```

### counterOf  `const`

```ts
const counterOf: (statistics: Statistics, key: StatisticKey) => number;
```

### craftFromGrid  `const`

```ts
const craftFromGrid: (inventory: Inventory, table: RecipeTable, grid: CraftGrid) => CraftOutcome;
```

### craftGrid  `const`

```ts
const craftGrid: (width: number, height: number, items: ReadonlyArray<ItemType | undefined>) => CraftGrid;
```

### damageAt  `const`

```ts
const damageAt: (storage: PlayerStorage, location: StorageLocation, amount: number) => StorageOutcome<DamageAtResult>;
```

### damageEquipment  `const`

```ts
const damageEquipment: (equipment: Equipment, slot: EquipmentSlot, amount: number) => EquipmentOutcome<DamageEquipmentResult>;
```

### dayLengthSecs  `const`

```ts
const dayLengthSecs: (state: TimeState) => number;
```

### despawnEntity  `const`

```ts
const despawnEntity: <S>(roster: EntityRoster<S>, id: EntityId) => DespawnOutcome<S>;
```

### durability  `const`

```ts
const durability: (current: number, max: number) => Durability;
```

### durabilityForItem  `const`

```ts
const durabilityForItem: (item: ItemType) => Durability | null;
```

### eat  `const`

```ts
const eat: (vitals: Vitals, foodPoints: number, saturationModifier: number) => Vitals;
```

### emptyEquipment  `const`

```ts
const emptyEquipment: () => Equipment;
```

### emptyInventory  `const`

```ts
const emptyInventory: () => Inventory;
```

### emptyPlayerStorage  `const`

```ts
const emptyPlayerStorage: () => PlayerStorage;
```

### emptyRoster  `const`

```ts
const emptyRoster: <S>() => EntityRoster<S>;
```

### entityManagerTag  `const`

```ts
const entityManagerTag: <S>() => Context.Tag<EntityManager, EntityManagerApi<S>>;
```

### equip  `const`

```ts
const equip: (equipment: Equipment, slot: EquipmentSlot, item: EquipmentItem) => EquipmentOutcome<EquipmentItem | null>;
```

### equipFromInventory  `const`

```ts
const equipFromInventory: (storage: PlayerStorage, inventorySlot: number, equipmentSlot: Eq.EquipmentSlot) => StorageOutcome<EquipFromInventoryResult>;
```

### equipmentDefinitionFor  `const`

```ts
const equipmentDefinitionFor: (item: ItemType) => EquipmentDefinition | undefined;
```

### equipmentItem  `const`

```ts
const equipmentItem: (stack: ItemStack, itemDurability?: Durability | null) => EquipmentItem;
```

### equippedAt  `const`

```ts
const equippedAt: (equipment: Equipment, slot: EquipmentSlot) => EquipmentItem | null;
```

### exactly  `const`

```ts
const exactly: (item: ItemType) => Ingredient;
```

### experienceCostOfLevel  `const`

```ts
const experienceCostOfLevel: (level: number) => number;
```

### experienceLevel  `const`

```ts
const experienceLevel: (vitals: Vitals) => number;
```

### experienceProgress  `const`

```ts
const experienceProgress: (vitals: Vitals) => number;
```

### findEntity  `const`

```ts
const findEntity: <S>(roster: EntityRoster<S>, id: EntityId) => Entity<S> | undefined;
```

### forwardVector  `const`

```ts
const forwardVector: (snapshot: CameraOrientation) => Position;
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

### heal  `const`

```ts
const heal: (vitals: Vitals, amount: number) => Vitals;
```

### ingredientCost  `const`

```ts
const ingredientCost: (grid: CraftGrid) => ReadonlyMap<ItemType, number>;
```

### ingredientMatches  `const`

```ts
const ingredientMatches: (ingredient: Ingredient, item: ItemType) => boolean;
```

### isDead  `const`

```ts
const isDead: (vitals: Vitals) => boolean;
```

### isDurability  `const`

```ts
const isDurability: (value: unknown) => value is Durability;
```

### isEmpty  `const`

```ts
const isEmpty: (inventory: Inventory) => boolean;
```

### isEntityId  `const`

```ts
const isEntityId: (value: unknown) => value is EntityId;
```

### isEntityKind  `const`

```ts
const isEntityKind: (value: unknown) => value is EntityKind;
```

### isEquipmentItem  `const`

```ts
const isEquipmentItem: (value: unknown) => value is EquipmentItem;
```

### isEquipmentItemForSlot  `const`

```ts
const isEquipmentItemForSlot: (slot: EquipmentSlot, item: EquipmentItem) => boolean;
```

### isEquipmentSlot  `const`

```ts
const isEquipmentSlot: (value: unknown) => value is EquipmentSlot;
```

### isEquippableItemType  `const`

```ts
const isEquippableItemType: (item: ItemType) => item is EquippableItemType;
```

### isGraphicsQuality  `const`

```ts
const isGraphicsQuality: (value: unknown) => value is GraphicsQuality;
```

### isNight  `const`

```ts
const isNight: (state: TimeState) => boolean;
```

### isUnlocked  `const`

```ts
const isUnlocked: (statistics: Statistics, id: AchievementId) => boolean;
```

### isValidDurabilityForItem  `const`

```ts
const isValidDurabilityForItem: (item: ItemType, value: unknown) => value is Durability;
```

### isValidSettings  `const`

```ts
const isValidSettings: (settings: Settings) => boolean;
```

### isValidStatistics  `const`

```ts
const isValidStatistics: (statistics: Statistics) => boolean;
```

### isValidTimeState  `const`

```ts
const isValidTimeState: (state: TimeState) => boolean;
```

### isValidVitals  `const`

```ts
const isValidVitals: (vitals: Vitals) => boolean;
```

### isValidWeatherState  `const`

```ts
const isValidWeatherState: (value: unknown) => value is WeatherState;
```

### isWeather  `const`

```ts
const isWeather: (value: unknown) => value is Weather;
```

### itemStack  `const`

```ts
const itemStack: (item: ItemType, count: number) => ItemStack;
```

### keyBindingFor  `const`

```ts
const keyBindingFor: (settings: Settings, action: string) => string | undefined;
```

### levelForTotalExperience  `const`

```ts
const levelForTotalExperience: (totalExperience: number) => number;
```

### makeControllableSimStagesWithPhysics  `const`

```ts
const makeControllableSimStagesWithPhysics: (config: SimPhysicsConfig) => Effect.Effect<{
    readonly state: SimFrameState;
    readonly stages: ReadonlyArray<StageRegistration>;
}, never, TimeService | PlayerService>;
```

### makeEntityManager  `const`

```ts
const makeEntityManager: <S>(initial?: EntityRoster<S>, repairBehaviour?: BehaviourRepair<S>) => Effect.Effect<EntityManagerApi<S>>;
```

### makeEquipmentService  `const`

```ts
const makeEquipmentService: () => Effect.Effect<EquipmentServiceApi>;
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
const makePlayerService: (initial?: Camera.PlayerPose, initialDimension?: Dimension) => Effect.Effect<PlayerServiceApi>;
```

### makeSettingsService  `const`

```ts
const makeSettingsService: (initial?: Settings.Settings) => Effect.Effect<SettingsServiceApi>;
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

### makeSimStagesForPreviewWithPhysics  `const`

```ts
const makeSimStagesForPreviewWithPhysics: (config: SimPhysicsConfig) => Effect.Effect<{
    readonly state: SimFrameState;
    readonly stages: ReadonlyArray<StageRegistration>;
}, never, TimeService | PlayerService>;
```

### makeSimStagesWithPhysics  `const`

```ts
const makeSimStagesWithPhysics: (config: SimPhysicsConfig) => Effect.Effect<ReadonlyArray<StageRegistration>, never, TimeService | PlayerService>;
```

### makeStatisticsService  `const`

```ts
const makeStatisticsService: (initial?: Statistics.Statistics) => Effect.Effect<StatisticsServiceApi>;
```

### makeTimeService  `const`

```ts
const makeTimeService: (initial?: Time.TimeState) => Effect.Effect<TimeServiceApi>;
```

### makeVitalsService  `const`

```ts
const makeVitalsService: (initial?: Vitals.Vitals) => Effect.Effect<VitalsServiceApi>;
```

### makeWeatherService  `const`

```ts
const makeWeatherService: (initial?: Weather.WeatherState) => Effect.Effect<WeatherServiceApi>;
```

### matchRecipe  `const`

```ts
const matchRecipe: (table: RecipeTable, grid: CraftGrid) => RecipeMatch;
```

### maxStackCountForItem  `const`

```ts
const maxStackCountForItem: (item: ItemType) => number;
```

### mintEntityId  `const`

```ts
const mintEntityId: (serial: number) => EntityId;
```

### moonPhase  `const`

```ts
const moonPhase: (state: TimeState) => number;
```

### normaliseInventory  `const`

```ts
const normaliseInventory: (inventory: Inventory) => NormaliseOutcome;
```

### normaliseRoster  `const`

```ts
const normaliseRoster: <S>(roster: EntityRoster<S>, repairBehaviour?: BehaviourRepair<S>) => NormaliseRosterOutcome<S>;
```

### normaliseSettings  `const`

```ts
const normaliseSettings: (settings: Settings) => Settings;
```

### normaliseStatistics  `const`

```ts
const normaliseStatistics: (statistics: Statistics) => Statistics;
```

### normaliseTimeState  `const`

```ts
const normaliseTimeState: (state: TimeState) => TimeState;
```

### normaliseVitals  `const`

```ts
const normaliseVitals: (vitals: Vitals) => Vitals;
```

### normaliseWeatherState  `const`

```ts
const normaliseWeatherState: (value: unknown) => WeatherState;
```

### performAutoSaveTick  `const`

```ts
const performAutoSaveTick: <E>(persist: Effect.Effect<void, E>, reporter?: AutoSaveStatusReporter) => Effect.Effect<void>;
```

### record  `const`

```ts
const record: (statistics: Statistics, key: StatisticKey, amount?: number) => Statistics;
```

### removeItem  `const`

```ts
const removeItem: (inventory: Inventory, item: ItemType, count: number) => RemoveOutcome;
```

### removeItemAt  `const`

```ts
const removeItemAt: (inventory: Inventory, slotIndex: number, expectedItem: ItemType, count: number) => RemoveAtOutcome;
```

### respawn  `const`

```ts
const respawn: (vitals: Vitals) => Vitals;
```

### serialOfEntityId  `const`

```ts
const serialOfEntityId: (id: string) => number | undefined;
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

### spawnEntity  `const`

```ts
const spawnEntity: <S>(roster: EntityRoster<S>, request: SpawnRequest<S>) => SpawnOutcome<S>;
```

### startAutoSaveDaemon  `const`

```ts
const startAutoSaveDaemon: <E>(persist: Effect.Effect<void, E>, interval?: Duration.Duration, reporter?: AutoSaveStatusReporter) => Effect.Effect<Fiber.RuntimeFiber<number, never>>;
```

### storageFromInventory  `const`

```ts
const storageFromInventory: (inventory: Inv.Inventory) => PlayerStorage;
```

### swapEquipment  `const`

```ts
const swapEquipment: (equipment: Equipment, first: EquipmentSlot, second: EquipmentSlot) => Equipment;
```

### sweepRoster  `const`

```ts
const sweepRoster: <S, A>(roster: EntityRoster<S>, step: (entity: Entity<S>) => EntityStep<S, A>) => SweepOutcome<S, A>;
```

### targetBlockFromCamera  `const`

```ts
const targetBlockFromCamera: (camera: CameraPoseSnapshot, maxDistance: number, isTargetable: IsTargetable) => Option.Option<BlockTarget>;
```

### targetBlockFromPlayerPose  `const`

```ts
const targetBlockFromPlayerPose: (playerPose: PlayerPose, maxDistance: number, isTargetable: IsTargetable) => Option.Option<BlockTarget>;
```

### timeOfDay  `const`

```ts
const timeOfDay: (state: TimeState) => number;
```

### totalExperienceAtLevel  `const`

```ts
const totalExperienceAtLevel: (level: number) => number;
```

### unbindKey  `const`

```ts
const unbindKey: (settings: Settings, action: string) => Settings;
```

### unequip  `const`

```ts
const unequip: (equipment: Equipment, slot: EquipmentSlot) => EquipmentOutcome<EquipmentItem | null>;
```

### unequipToInventory  `const`

```ts
const unequipToInventory: (storage: PlayerStorage, equipmentSlot: Eq.EquipmentSlot, requestedSlot?: number) => StorageOutcome<UnequipToInventoryResult>;
```

### unlock  `const`

```ts
const unlock: (statistics: Statistics, id: AchievementId) => Statistics;
```

### validateEquipmentSnapshot  `const`

```ts
const validateEquipmentSnapshot: (value: unknown) => EquipmentValidationResult;
```

### validatePlayerStorageSnapshot  `const`

```ts
const validatePlayerStorageSnapshot: (value: unknown) => PlayerStorageValidationResult;
```

### vitalsView  `const`

```ts
const vitalsView: (vitals: Vitals) => VitalsView;
```

### withFeetPosition  `const`

```ts
const withFeetPosition: (pose: PlayerPose, feetPosition: Position) => PlayerPose;
```

### withInventory  `const`

```ts
const withInventory: (storage: PlayerStorage, inventory: Inv.Inventory) => PlayerStorage;
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

### Dimension  `type`

```ts
type Dimension = 'overworld' | 'nether' | 'end';
```

### EpochMillis  `const`

```ts
const EpochMillis: Brand.Brand.Constructor<EpochMillis>;
```

### EpochMillis  `type`

```ts
type EpochMillis = number & Brand.Brand<'EpochMillis'>;
```

### EquipmentService_base  `const`

```ts
const EquipmentService_base: Context.TagClass<EquipmentService, "@nerima-games/mc-sim/EquipmentService", EquipmentServiceApi>;
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
const ITEM_TYPES: readonly ["stone", "cobblestone", "dirt", "grass_block", "sand", "gravel", "oak_log", "oak_planks", "oak_leaves", "glass", "torch", "glowstone", "piston", "stick", "glowstone_dust", "wooden_pickaxe", "coal", "iron_ingot", "flint", "gunpowder", "blaze_powder", "flint_and_steel", "fire_charge", "iron_helmet", "iron_chestplate", "iron_leggings", "iron_boots", "granite", "diorite", "andesite", "deepslate", "obsidian", "smooth_basalt", "calcite", "amethyst_block", "sandstone", "prismarine", "soul_sand", "coal_block", "iron_block", "gold_block", "diamond_block", "redstone_block", "lapis_block", "emerald_block", "redstone_torch", "lever", "stone_button", "repeater", "redstone_lamp", "observer", "comparator", "dispenser", "hopper", "end_stone", "end_portal_frame", "end_portal_frame_filled", "chorus_flower", "chorus_plant", "dragon_egg", "end_crystal", "end_rod", "end_stone_bricks", "ender_chest", "purpur_block", "purpur_pillar", "purpur_slab", "purpur_stairs", "shulker_box", "crafting_table", "furnace", "chest", "door", "oak_stairs", "anvil", "cauldron", "bed", "enchanting_table", "brewing_stand", "tnt", "nether_brick", "netherrack", "raw_iron", "raw_gold", "diamond", "emerald", "lapis_lazuli", "redstone_dust", "amethyst_shard", "wheat_seeds", "potato", "nether_wart", "ladder", "kelp", "seagrass", "rail", "powered_rail", "pressure_plate", "stone_slab", "string", "snowball"];
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

### SettingsService_base  `const`

```ts
const SettingsService_base: Context.TagClass<SettingsService, "@nerima-games/mc-sim/SettingsService", SettingsServiceApi>;
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

### StatisticsService_base  `const`

```ts
const StatisticsService_base: Context.TagClass<StatisticsService, "@nerima-games/mc-sim/StatisticsService", StatisticsServiceApi>;
```

### TimeService_base  `const`

```ts
const TimeService_base: Context.TagClass<TimeService, "@nerima-games/mc-sim/TimeService", TimeServiceApi>;
```

### VitalsService_base  `const`

```ts
const VitalsService_base: Context.TagClass<VitalsService, "@nerima-games/mc-sim/VitalsService", VitalsServiceApi>;
```

### WeatherService_base  `const`

```ts
const WeatherService_base: Context.TagClass<WeatherService, "@nerima-games/mc-sim/WeatherService", WeatherServiceApi>;
```
