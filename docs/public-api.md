# 公開API

plan.md §3.8 は主要な公開APIを「`tick(input, dt)`、各状態サービスの読み書き、チャンクダーティ通知」
と書いている。本書はそれを、**参照実装の実コードと突き合わせて**具体化したもの。
パスはすべて `takeokunn/ts-minecraft` リポジトリルート相対。

> **この公開APIが全下流の依存先（=最重要界面）。APIロックファイルを最初から適用**（plan.md §3.8）

## 0. 参照実装のサービス定義方式

参照実装は `Effect.Service` クラスを使う（`Context.Tag` ではない）。

```
packages/entity/application/player-service.ts:8-11
  export class PlayerService extends Effect.Service<PlayerService>()(
    '@minecraft/application/PlayerService',
    { effect: Effect.gen(function* () { ... }) }
  ) {}
```

**新実装は `Context.Tag` + 明示的な `Layer` を採る**（`application/*.ts` 参照）。理由:

- `Effect.Service` は実装と Tag を 1 つのクラスに束ねるため、テスト用の差し替え実装を作るのに
  クラス継承かキャストが要る。`Context.Tag` なら `Layer.succeed(Tag, fake)` で済む。
- **同じサービスを複数インスタンス作れる。** これが plan.md §3.8 の「再入可能な初期化」に効く。
  参照実装が `reset()` を後付けする羽目になったのは、シングルトンしか作れなかったためである
  （`packages/entity/application/player-service.ts:15-18` のコメント参照）。
- Tag の文字列は `@nerima-games/mc-sim/XxxService` に統一する（参照実装は `@minecraft/application/Xxx`）。

## 1. カメラ姿勢 — 最重要

### 1.1 公開するもの

```typescript
// domain/camera-pose.ts
type PlayerPose = {
  readonly feetPosition: Position   // 足元原点。命名で座標規約を運ぶ
  readonly yawRadians: number
  readonly pitchRadians: number
}

const PITCH_MAX_RADIANS: number     // pi/2 - 0.01
const EYE_LEVEL_OFFSET = 1.62
const clampPitch: (pitchRadians: number) => number
const applyLook: (pose: PlayerPose, deltaYaw: number, deltaPitch: number) => PlayerPose
const cameraPoseOf: (pose: PlayerPose, capturedAtSecs: MonotonicTimeSecs) => CameraPoseSnapshot
const forwardVector: (snapshot: CameraPoseSnapshot) => Position
const snapshotAgeSecs: (snapshot: CameraPoseSnapshot, now: MonotonicTimeSecs) => number

// application/player-service.ts
type PlayerServiceApi = {
  readonly pose: Effect.Effect<PlayerPose>
  readonly look: (deltaYaw: number, deltaPitch: number) => Effect.Effect<PlayerPose>
  readonly moveTo: (feetPosition: Position) => Effect.Effect<void>
  readonly cameraPose: Effect.Effect<CameraPoseSnapshot, never, ClockPort>   // 唯一の発行口
  readonly restore: (pose: PlayerPose) => Effect.Effect<void>
  readonly reset: Effect.Effect<void>
}
```

### 1.2 参照実装との照合

| 事項 | 参照実装 | 新実装 |
| --- | --- | --- |
| 姿勢の保持 | `packages/entity/application/camera-state.ts`（THREE import 無し。yaw/pitch のみ） | 同じ場所に置く。ただし位置も含める |
| pitch クランプ | `packages/entity/domain/camera-state.ts:12-13` `PITCH_LIMIT = Math.PI / 2 - 0.01` | `PITCH_MAX_RADIANS` として同値を維持 |
| THREE への適用 | `packages/app/application/frame/stages/camera-stage.ts:63-67` `camera.rotation.set(pitch, yaw, 0, 'YXZ')` | mc-render 側。mc-sim は関与しない |
| 視線ベクトル | `camera.getWorldDirection(...)` を 13 箇所が呼ぶ | `forwardVector(snapshot)` で mc-sim 側が答える |
| 目線高さ | `packages/app/.../camera-stage.ts` で描画側が加算 | **mc-sim が加算**（`cameraPoseOf`）。二重実装を作らない |

**`forwardVector` を用意した理由**は、下流に `camera.getWorldDirection()` を呼ぶ動機を残さないため。
参照実装ではこれが 13 箇所に散り、うち `attack-targeting.ts:18,24` /
`interaction-bow-handler.ts:105` / `interaction-melee-handler.ts:142,213` /
`interaction-right-click-handler.ts:73` / `entity-update-stage.ts:182,189` はすべて
**シミュレーション側のロジック**だった。

### 1.3 mc-render に要求すること（契約）

- `CameraPoseSnapshot` を**読むだけ**。書き戻す API は存在しない。
- 攻撃スイングのバンプのような演出は、ミラーした姿勢の**上に**適用し、mc-sim には戻さない。
  参照実装はこれを `packages/app/application/frame/stages/render-stage.ts:41-48,98-100` で
  生カメラを `translateX` / `rotateZ` して `Effect.ensuring` で戻す形にしており、その窓の間
  `.position` と `matrixWorld` が食い違った（`packages/app/application/main/qa-api-visual.ts:17-19`
  が「`.position` は stale になりうる」と警告している）。

## 2. TimeService

```typescript
type TimeServiceApi = {
  readonly advance: (dt: DeltaTimeSecs) => Effect.Effect<void>
  readonly timeOfDay: Effect.Effect<number>          // [0, 1)。0 = 真夜中。§2-0
  readonly dayLengthSecs: Effect.Effect<number>
  readonly moonPhase: Effect.Effect<number>          // 0..7
  readonly isNight: Effect.Effect<boolean>
  readonly setDayLength: (seconds: number) => Effect.Effect<void>
  readonly setTimeOfDay: (fraction: number) => Effect.Effect<void>
  readonly configureDay: (dayLengthSeconds: number, timeOfDayFraction: number) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<TimeState>
  readonly restore: (state: TimeState) => Effect.Effect<void>
}
```

### 2-0. `timeOfDay` の規約 — **0 は真夜中である**

`timeOfDay` は 1 日の中の位置を `[0, 1)` の分数で返す。**その原点は真夜中である。**

| 値 | 意味 |
| --- | --- |
| `0.0` | **真夜中**（`1.0` と同じ瞬間。だから `MAX_TIME_FRACTION = 0.9999` でクランプする） |
| `0.25` | 夜明け（`DAWN`） |
| `0.5` | 正午（`NOON`） |
| `0.75` | 日没（`DUSK`） |

したがって**夜は 0/1 境界を中心とする半日**であり、`isNight` はそのまま
`fraction < 0.25 || fraction > 0.75` である（`domain/time-of-day.ts:117-120`）。

これは参照実装の規約であり、**新規ワールドが `ticks: 7200 / dayLengthTicks: 24000` = 0.30 から始まる理由でもある。**
真夜中（0）から始めると夜の Mob 一式が新規プレイヤーの上にスポーンし、
日光に耐性のある敵対 Mob がリスポーン地点に居座って、ワールド生成直後に回復不能なデスループになる
（`domain/time-of-day.ts:77-92` が参照実装のコメントごと記録している）。0.30 は「朝方」である。

この規約に合わせているのは mc-sim だけではない。`mx-gameplay/domain/day-night.ts` の
`isNight` は本リポジトリの述語を**文字単位で同一に**再掲している。
敵対 Mob のスポーン規則と、それが適用される状態とが別リポジトリにあるため、
夜の境界は 2 か所に書き下し、**両方でテストが固定している**:

- 本リポジトリ `test/time-of-day.test.ts` — `is the half of the day centred on the 0/1 boundary`、
  `a fresh world starts in daylight, not at midnight with hostile mobs`
- mx-gameplay `test/day-night.test.ts` — `is the half of the day centred on the 0/1 boundary, exactly as mc-sim computes it`

> **既知の不整合（コード側の修正待ち）**: `domain/time-of-day.ts:106` の `timeOfDay` の doc コメントは
> 「`0 = dawn boundary, 0.5 = dusk boundary`」と書いており、**間違っている**。
> 同じファイルの `INITIAL_TIME_STATE` のコメント（:85「in this cycle 0 is MIDNIGHT」）とも、
> 直下の `isNight` の実装とも矛盾する。
> **挙動は一貫しており、正しいのは本節の表のほうである** — mx-gameplay もその挙動に合わせてある。
> 直すべきは 1 行のコメントだけである。

参照実装 `packages/game/application/time-service.ts:16-62` は 7 メソッド
（`advanceTick` / `getTimeOfDay` / `getMoonPhase` / `isNight` / `getDayLength` /
`setDayLength` / `setTimeOfDay`）。差分は 3 点。

1. **`configureDay` を追加。** `setDayLength → setTimeOfDay` の順序制約を「関数が 1 個ある」に
   還元する。参照実装で順序を守っているのは
   `packages/app/application/main/session-bootstrap-world-presentation-time.ts:26-27` だけであり、
   `packages/app/application/frame/stages/input-stage-runtime.ts:17-30` は設定変更時に
   `setDayLength` 単独を呼んで時刻をずらしている（DN-04 参照）。
2. **`snapshot` / `restore` を追加。** 参照実装は `TimeState` を外に出す口が無く、
   セーブは別経路だった。永続化とマルチプレイヤー同期の両方が必要とする。
3. **`getXxx(): Effect<T>` ではなく `xxx: Effect<T>`。** 引数を取らないものを関数にしない。

定数はすべて参照実装と同値（`packages/game/application/time-service-state.ts`）:
`TICKS_PER_SECOND = 60`、`[MIN, MAX]_DAY_LENGTH_SECS = [120, 1200]`、
`MAX_TIME_FRACTION = 0.9999`、`INITIAL_TIME_STATE = { ticks: 7200, dayLengthTicks: 24000 }`。

## 3. GameLoop

```typescript
type FrameHandler = (dt: DeltaTimeSecs) => Effect.Effect<void>

type GameLoopApi = {
  readonly start: (handler: FrameHandler) => Effect.Effect<void>   // 再入可能
  readonly submitFrame: (at: MonotonicTimeSecs) => Effect.Effect<void>
  readonly stop: Effect.Effect<void>                                // 冪等・非ブロッキング
  readonly isRunning: Effect.Effect<boolean>
  readonly framesProcessed: Effect.Effect<number>
}
```

参照実装 `packages/game/application/game-loop.ts:260 行` との差分:

| 事項 | 参照実装 | 新実装 |
| --- | --- | --- |
| フレーム源 | `requestAnimationFrame` を内部で呼ぶ（`buildScheduleFrame`, :135） | `submitFrame(at)` で外から供給。Node でテストできる |
| キュー | `Queue.dropping(QUEUE_CAPACITY)` (:106) | 同じ。容量 60 |
| 世代ごとの状態 | 長寿命の `Ref` を使い回す | **世代ごとに新規作成**。取り残しfiberが新世代を壊せない |
| 再入 | 後付け（:141-148 のコメントが経緯） | 最初から |
| 停止 | `Fiber.interruptFork`（:145, :198-201） | 同じ。加えて interrupt の**前**に detach |
| メンテナンスループ | 別 daemon (:228) | 未実装。同じ規約で足す |

`FrameHandler` の中身（stage の並び）は mc-sim の関心事ではない（[architecture.md](./architecture.md) §4.3）。

## 4. InventoryService

```typescript
type InventoryServiceApi = {
  readonly add: (item: ItemId, count: number) => Effect.Effect<number>     // 戻り値 = 入らなかった数
  readonly remove: (item: ItemId, count: number) => Effect.Effect<number>  // 戻り値 = 実際に取れた数
  readonly countOf: (item: ItemId) => Effect.Effect<number>
  readonly snapshot: Effect.Effect<Inventory>
  readonly restore: (inventory: Inventory) => Effect.Effect<void>
  readonly reset: Effect.Effect<void>

  // --- クラフト（§4.1） ---
  readonly recipes: Effect.Effect<RecipeTable>
  readonly previewCraft: (grid: CraftGrid) => Effect.Effect<RecipeMatch>
  readonly craft: (grid: CraftGrid) => Effect.Effect<CraftResult>
}
```

参照実装 `packages/inventory/application/inventory-service.ts:22-101` は 14 メソッド:
`getSlot` / `setSlot` / `damageSlot` / `repairMendingItemsWithXP` / `moveStack` / `sortInventory` /
`quickMove` / `addBlock` / `removeBlock` / `getHotbarSlots` / `getAllSlots` / `serialize` /
`clear` / `deserialize`。

現スケルトンはこのうち add / remove / 照会 / 直列化 / クリアに相当する 6 個だけを持つ。
本実装で埋めるべき差分:

- **スロット単位操作**（`getSlot` / `setSlot` / `moveStack` / `quickMove` / `sortInventory`）:
  mx-ui のインベントリ画面が必要とする。
- **耐久 / メンディング**（`damageSlot` / `repairMendingItemsWithXP`）: XP サービスと結合する。
  「何をしたら耐久が減るか」は mx-gameplay、「減った値を保持する」が mc-sim。
- **`addBlock` の失敗チャネル**: 参照実装は `Effect<void, InventoryError>`。
  新実装は満杯を**エラーにせず leftover として返す**。満杯は正常なゲーム状態であり、
  呼び出し側（mx-gameplay）はそれを地面のドロップアイテムに変換する。エラーにすると
  すべての呼び出し側が握り潰すことになり、握り潰した瞬間にアイテムが消える。
- `ItemId` は暫定 `string`。本来は mc-kernel の `ItemType`（リテラル union、網羅性チェックつき）。

## 4.1 レシピとクラフト

plan.md §7 は「クラフト = mc-sim（レシピと状態）+ mx-ui（画面）」、§2.3-1 は状態を基盤層に置く。
レシピ表は**名詞**（何が存在するかの台帳）なので本リポジトリにある。

```typescript
// domain/recipe.ts
type RecipeId = string                      // 'mc-sim:stick'。ItemId と同じ理由で暫定 string
type Ingredient = { readonly _tag: 'Exact'; readonly item: ItemId }
type PatternCell = Ingredient | undefined
type RecipePattern = { readonly width: number; readonly height: number
                       readonly cells: ReadonlyArray<PatternCell> }   // 空の外周は trim 済
type ShapedRecipe    = { _tag: 'Shaped';    id; pattern: RecipePattern; output: ItemStack }
type ShapelessRecipe = { _tag: 'Shapeless'; id; ingredients: ReadonlyArray<Ingredient>; output }
type Recipe = ShapedRecipe | ShapelessRecipe
type RecipeTable = ReadonlyArray<Recipe>

type CraftGrid = { readonly width: number; readonly height: number
                   readonly cells: ReadonlyArray<Slot> }
type RecipeMatch =
  | { readonly _tag: 'Match'; readonly recipe: Recipe; readonly output: ItemStack }
  | { readonly _tag: 'NoMatch' }

const exactly:          (item: ItemId) => Ingredient
const ingredientMatches:(ingredient: Ingredient, item: ItemId) => boolean
const shapedRecipe:     (id, rows: ReadonlyArray<string>, key: Record<string, ItemId>, output) => ShapedRecipe
const shapelessRecipe:  (id, items: ReadonlyArray<ItemId>, output) => ShapelessRecipe
const craftGrid:        (width, height, items: ReadonlyArray<ItemId | undefined>) => CraftGrid
const cellAt:           (grid: CraftGrid, x: number, y: number) => Slot
const matchRecipe:      (table: RecipeTable, grid: CraftGrid) => RecipeMatch   // 全域・表順非依存
const conflictsIn:      (table: RecipeTable) => ReadonlyArray<RecipeConflict>
const STARTER_RECIPES:  RecipeTable                                            // 7 件

// domain/crafting.ts
type CraftResult =
  | { _tag: 'Crafted'; recipeId: RecipeId; output: ItemStack }
  | { _tag: 'NoMatch' }
  | { _tag: 'MissingIngredients'; missing: ReadonlyArray<MissingIngredient> }
  | { _tag: 'NoRoom' }
const ingredientCost: (grid: CraftGrid) => ReadonlyMap<ItemId, number>
const craftFromGrid:  (inventory: Inventory, table: RecipeTable, grid: CraftGrid) => CraftOutcome
```

### 4.1-1 mx-ui がこれで何を投影できるようになったか

`mx-ui/domain/inventory-view-model.ts` の `CraftingSnapshot.result` は 3 値
（`Match` / `NoMatch` / **`undefined` = mc-sim が答えていない**）で、
「mc-sim に `Recipe` が無い（`api-lock.md` に存在しない）」ため実際に常時 `undefined` だった。
クラフト画面の出力枠は毎回 `unknown` を描いていた。mx-ui がレシピを発明しなかったのは
§2.3-1 の通り**正しい**ので、埋めるべき穴はこちら側にあった。

`InventoryService.previewCraft(grid)` が返す `RecipeMatch` は、
mx-ui の `CraftingResultSnapshot` と**同じ 2 ケース・同じタグ名**である。
mx-ui 側は導出ではなく改名でつながる（`Match` の `output` を `MirroredItemStack` に写すだけ）。
`undefined` が残るのは「まだ問い合わせていないフレーム」だけになり、
「無い」と「作れない」の区別は mx-ui が意図した通りに機能する。

### 4.1-2 曖昧性の解決規則

2 つのレシピが同じグリッドに一致することは異常ではなく実在する
（緩い shapeless レシピが、具体的な shaped レシピの隣に追加される）。
本家は登録順で解決するため、答えがロード順に依存する。**本リポジトリはそれを採らない。**

1. **より具体的なほうが勝つ** — shaped > shapeless。shaped の一致集合は、同じ材料の
   shapeless の一致集合の**真部分集合**である（位置を固定するぶんだけ狭い）。
   狭いほうを選ぶのが「より具体的」の通常の意味であり、これは形式の性質であって好みではない。
2. 同順位なら **`RecipeId` の辞書順で小さいほう**。

規則 2 が発動する時点で表自体が誤りである。規則の価値は「誤りが再現可能であること」だけで、
再現可能を**報告可能**にするのが `conflictsIn` である
（`test/recipe.test.ts` が `STARTER_RECIPES` に対して空を固定している）。

一致した全レシピは**グリッドの占有セルをちょうど消費する**（shaped は占有ボックス＝パターン、
shapeless は個数一致）ため、「材料が多いほうが具体的」という第 3 の規則は空振りする。
だから書いていない。

### 4.1-3 shaped の平行移動と鏡像

- **平行移動**: パターンは構築時に空の外周を trim（`RecipePattern` の不変条件）、
  グリッド側は占有セルの**タイトな外接ボックス**を取る。2 つの同サイズ矩形の比較に還元されるので、
  3x3 の中の 2x2 は 4 通りを試すのではなく 1 回で決まる。
  同じ判定が「3x3 レシピはプレイヤーの 2x2 グリッドでは作れない」も兼ねる（別ルール不要）。
- **鏡像**: 左右のみ。本家と同じで、火打石と打ち金は対角なので鏡像も一致する。
  **上下反転は鏡像ではない**（松明は「炭の下に棒」ではない）。受け入れると誰も書いていないレシピが増える。

### 4.1-4 材料はインベントリから引く（グリッドは値であって状態ではない）

`CraftGrid` は呼び出し側が渡す**値**で、mc-sim が保持する状態ではない。
グリッドは画面が開いている間しか存在せず、画面は mx-ui（plan.md §3.13）であり、
36 スロットと同期し閉じたら地面に落とす必要のある**第 2 のアイテム置き場**を mc-sim が持つと、
「プレイヤーの持ち物はどこにあるか」の正が 2 つになる。

したがってグリッドは**仕様**として読む（どのレシピか、セルごとに何を消費するか）。
課金先はインベントリで、`Ref.modify` **1 回**である。
代償は正直に書いておく: 画面が開いている間、グリッドに見えているアイテムはまだインベントリにある。
mx-ui は「移動」ではなく「予約」を描くことになる。
グリッドが自分でアイテムを**所有する**設計は繰り延べであり、その時はインベントリ状態として
（閉じたら落とすルールごと）入る。`craftFromGrid` の変更にはならない。

### 4.1-5 なぜ `craft` が CraftingService ではなく InventoryService にあるのか

原子性のため。DN-07 の `Ref.modify` は「1 つの Ref」でしか成立しない。
独自の Ref を持つ CraftingService は、このインベントリを読み → 判断し → 書き戻すしかなく、
読みと書きの間が TOCTOU になる。しかも積荷が悪い: 材料の減算と成果の加算は**2 つの書き込み**で、
どちらを落としてもアイテムが増えるか消えるかする。
サービスを増やさないので公開面も 1 つも増えない（plan.md §8 第 2 リスク）。

失敗は 3 種類とも**結果**であって error channel ではない。満杯を `leftover` で返すのと同じ理由
（§4）。`MissingIngredients` と `NoRoom` を分けてあるのは、材料不足で灰色の枠と
置き場所不足で灰色の枠は、プレイヤーへの指示が違うからである。

**全失敗パスは受け取ったインベントリを参照ごとそのまま返す。** 中途半端に適用されたクラフトは
「起きにくい」のではなく**表現できない**（`craftFromGrid` で変更後を返す行は最終行の 1 か所だけ）。
材料の除去は成果の提示より**先**に行う。除去が成果の置き場を空けることがあり、
先に空きを見ると「満杯だから作れない」と断ることになるが、それはまさにプレイヤーが
場所を空けるためにクラフトする場面である。

### 4.1-6 いま入れていないもの（型が繰り延べを見せる）

| 繰り延べ | 型でどう見えるか |
| --- | --- |
| 材料タグ（「任意の板材」） | `Ingredient` が**メンバ 1 つの tagged union**。消費側は既に `_tag` で分岐しているので、`Tag` の追加は破壊的変更にならない。裸の `ItemId` にしていたら破壊的変更になっていた |
| 1 セル複数個・残留アイテム（ケーキのバケツ） | 表現できない。黙って間違うのではなく**無い** |
| かまど / 醸造 / 金床 / エンチャント | plan.md §7 の残り。グリッド形ではないので、ここには 1 つも無い |
| shapeless の重なり合う述語 | `matchesShapeless` は既にバックトラッキング割当（ソートして比較ではない）。`Tag` が入った日に貪欲法が誤答する経路を最初から塞いである |
| 複数個まとめてクラフト | `craft` は 1 回分 |

## 5. まだ設計していない公開API

plan.md §3.8 の責務のうち、界面をまだ書いていないもの。**着手前に本書へ追記すること。**

| 領域 | 参照実装 | 主な消費者 |
| --- | --- | --- |
| `EntityManager` | `packages/entity/application/`（mob/ 含む） | mx-gameplay / mx-multiplayer / mc-render |
| 体力 / 空腹 / XP | `health-service.ts` / `hunger-service.ts` / `xp-service.ts` | mx-gameplay / mx-ui |
| 実績 / 統計 | `achievement-service.ts` / `statistics-service.ts` | mx-ui |
| 設定状態 | `packages/game/application/settings-service.ts` (107) + `.config.ts` (70) + `.schema.ts` (79) | mx-ui / mc-render |
| ~~チャンクダーティ通知~~ | — | **mc-worldgen に移った。下記** |
| ドロップ / 経験値オーブ | `dropped-item-service.ts` / `dropped-xp-orb-service.ts` | mx-gameplay / mc-render |
| ~~レシピ~~ | — | **§4.1 で設計済** |
| かまど / チェスト / 装備 | `packages/inventory/application/` の各 service | mx-ui / mx-gameplay |
| `GameModule` の実体 | — | mc-compose |

### チャンクダーティ通知は mc-worldgen のものになった

これは長らく本リポジトリの最優先項目として挙がっていた（mc-render の `WorldRenderer` が
着手できない直接の原因だった）。**設計されたが、ここではない。**

plan.md §3.8 の公開 API 文が挙げる「チャンクダーティ通知」は、
§3.7 が mc-worldgen に与える `ChunkManager`（ロード / アンロード / **ダーティフラグ**）と
両立しない。フラグと通知を別リポジトリに置くと、worldgen → sim のエッジが無い（循環になる）以上、
mc-sim 側は毎フレーム全チャンクを走査するしかなくなる。

決着は `ChunkStore`（`@nerima-games/mc-worldgen/ChunkStore`）で、
`subscribeDirty` が「前回見て以降に変わったチャンク」を購読者ごとに返す。
mc-render は plan.md §2.1 に既にある `render → worldgen` エッジで直接購読し、
**mc-sim の公開 API はこの件で 1 つも増えない**（plan.md §8 の第 2 リスクに照らすと、これは利得である）。

詳細と、逆の選択のコストは `mc-worldgen/docs/public-api.md` §6。
本リポジトリ側の判断根拠は [responsibility.md](./responsibility.md) §3.3。

## 6. APIロック

plan.md §6 Step 0-3 が初回コミットに求める「公開 API のレポートを diff レビュー」。
**実装されている。** §9 の未決事項「API ロックファイルのツール選定
（api-extractor 相当の Effect-TS 互換手段）」はこれで決着した。

| 項目 | 内容 |
| --- | --- |
| 生成物 | リポジトリ直下の `api-lock.md`（公開宣言 70 件 + 参照されている非 export 宣言 17 件。コミット対象） |
| 生成器 | `scripts/api-lock.ts`（16 リポジトリに byte-identical で vendor。`scripts/check-dependency-whitelist.ts` と同じ方式で、編集してよいのは `REPOSITORY_POLICY` だけ） |
| 検査 | `pnpm api:check` — `api-lock.md` が実際の公開 API と食い違えば非ゼロ終了 |
| 更新 | `pnpm api:update` |
| 配線 | `pnpm verify` の `check:deps` と `test` の間、および CI の独立ステップ |
| 追加依存 | **なし**（`typescript` は既に devDependency） |

理由と実測の正本は mc-kernel の `docs/versioning.md` §7（§7-1 なぜ api-extractor ではないのか、
§7-2 仕組み、§7-3 決定性、§7-4 捕まえないもの、§7-5 運用）。ここでは mc-sim にとって何が変わったかだけ書く。

### 6.1 mc-sim がまさに api-extractor に見えないケースだった

本ドキュメント §0 が決めた通り、新実装のサービスは `Context.Tag` + 明示的な `Layer` である。
TypeScript の declaration emit はこれを 2 つに分けて出し、`api-lock.md` は両方を記録する:

```ts
class PlayerService extends PlayerService_base {
}
const PlayerService_base: Context.TagClass<PlayerService, "@nerima-games/mc-sim/PlayerService", PlayerServiceApi>;
```

`@microsoft/api-extractor` は後者を「forgotten export」として警告に落とし、前者の空の殻しかレポートに書かない。
つまり **Tag 識別子文字列と束ねられた service 型 —— 契約そのもの —— が消える**。
mc-kernel で実測したところ、Tag 識別子を改名してもレポートはバイト単位で同一だった。
mc-sim にとってこれは致命的である。Tag 識別子は §3.2 の 6 リポジトリが `Layer` を解決する鍵であり、
これが黙って変わると各リポジトリは単体では型検査を通ったまま、合成した瞬間に実行時で壊れる。
自前の `scripts/api-lock.ts` は「公開面が参照している非 export の宣言」を第 2 節に取り込むので、
`PlayerService_base` / `GameLoop_base` / `InventoryService_base` / `TimeService_base` が全部写る。

api-extractor の名誉のために書いておくと、ノイズ耐性（関数本体の編集・非公開ヘルパの追加・
barrel の並べ替え・devDependency の bump で diff が出ないこと）は api-extractor も全部通っていた。
差が出たのは**検出側**だけである。

### 6.2 plan.md §8 第 2 リスクに対する意味

[architecture.md](./architecture.md) §3.2 が言う通り、mc-sim の API が揺れると 6 リポジトリに波及する。
これまでその「揺れ」を検出する仕組みは無く、レビュアの注意力が唯一の防波堤だった。
いまは `PlayerService` の Tag 文字列を書き換えれば `pnpm api:check` が
`pnpm verify` の `test` より**前**の段で非ゼロで落ちる。リスクは緩和済みと言ってよい。

`docs/versioning.md` §3 の「APIロックファイルが 4 週間変更されていない」も、
`api-lock.md` が最後に変わったコミットから数えられるようになった。計測の起点が客観的な事実になっている。

### 6.3 捕まえないもの

- **挙動。** `clampPitch` の境界や `advance` の返り値が変わってもこのファイルは動かない。
  DN-01 / DN-03 の回帰テストの仕事である（[testing.md](./testing.md)）。
- **interface / 型リテラルのメンバ順。** tsc の emit 順（＝ソース順）を保つので、
  `PlayerServiceApi` のメンバを並べ替えると API 変更でなくても diff になる。承認は 1 行で済む。

公開面を変える PR は `pnpm api:update` の結果を**同じ PR に**含めること。差分がレビュー対象そのものである。
