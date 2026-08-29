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
                                                     // ワールド**ブートストラップ**専用。§2-1
  readonly snapshot: Effect.Effect<TimeState>
  readonly restore: (state: TimeState) => Effect.Effect<void>   // ワールド**ロード**。§2-1
}
```

`domain/time-of-day.ts` 側に純粋な補助が 2 つある。

```typescript
const isValidTimeState: (state: TimeState) => boolean      // 復元前に呼ぶ側の問い合わせ口
const normaliseTimeState: (state: TimeState) => TimeState  // restore が内部で適用する修復
```

### 2-1. `configureDay` はブートストラップ、`restore` はロード

**両方をワールドロードが呼ぶものだと書いていた。後半は誤りだった（SIM-8）。**

`setTimeOfDay` は `ticks = fraction * dayLengthTicks` を書くので、状態を**day 0 に移す**。
ブートストラップはそれでよい。ロードは違う: 4 日目の夜にセーブしたワールドを
`configureDay(同じ引数)` で読み直すと、時刻は合っているのに**月齢が 0 に戻る**。
絶対 tick カウンタを保持している理由がまさに `moonPhase` なので（§2-0）、
これは「保持している意味を、保持しているコードが捨てる」形になる。

ロードは `restore(snapshot)` である。こちらは tick カウンタをそのまま戻す。

### 2-2. `restore` は壊れた `TimeState` を**修復**する（失敗しない）

セーブはバージョン境界を跨いで届く。`dayLengthTicks: 0` は分母なので、
全読み取りが `NaN` になり、そして **`isNight` は `false` を返した** ——
`NaN < 0.25` も `NaN > 0.75` も false だからである。エラーでも `NaN` でもなく、
呼び出し側がそのまま使う**ブール値**として恒久的な昼が返っていた（SIM-1）。
`setTimeOfDay` でも回復できない（`0.5 × 0 = 0`）。

`restore` は `normaliseTimeState` を通す。`setDayLength` と**同じ** [120, 1200] クランプを当て、
**大きさを持たない値**（`NaN` / `null` / `undefined` / 非数）は `DEFAULT_DAY_LENGTH_SECS` に落とす。
`±Infinity` は向きを持つので、指している側の境界にクランプする。
有効な `ticks` は**触らない**（日番号だから）。

- **エラーチャネルは足さない。** 修復可能なフィールド 1 つでワールドロードを失敗させると、
  直せるセーブが開けないセーブになる。知りたい呼び出し側は先に `isValidTimeState` を呼ぶ。
- **修復は `isNight` ではなく境界に置いた。** 理由は §2-0 のとおり、
  mx-gameplay がこの述語を文字単位で再掲しているためである。
- **型が `number` でも足りない。** これはバージョン境界を越えて届く値であり、
  欠落フィールドは `undefined`、`JSON.stringify(NaN)` は `null` を書く。どちらも `number` を名乗る。
  `Number.isNaN(null)` は `false` で `null / 60` は `0` なので、素朴な NaN 判定だけだと
  **最小値 120 s にクランプされて、意図的な値に見えてしまう**。判定は算術より前に置く。
- **`makeTimeService(initial)` / `TimeServiceLayer(initial)` も同じ修復を通す。**
  ロード済みワールドを層の構築時に渡すのは自然な使い方であり、`restore` だけを守ると
  同じ欠陥が別の入口で残る。

### 2-3. 個別 setter も全域である

`restore` は唯一の境界ではない。`clampDayLengthSecs` / `clampFraction` は
`Math.max` / `Math.min` の連鎖で、**`NaN` を伝播する**。したがって

```typescript
setDayLength(Number(''))   // 設定欄を空にした
```

は健全なワールドに `dayLengthTicks: NaN` を書き込み、そこから先は恒久的な昼になっていた。
`time-service.ts` は `setDayLength` 単独呼びを「**セッション中の設定変更**」の口として文書化しており、
まさにその経路である。しかも汚染はセーブを跨ぐ: `null` として保存され、120 s の日として復元され、
`restore` が守るはずだった**月齢がずれる**。

現在は clamp 自体が全域である。大きさを持たない日長は `DEFAULT_DAY_LENGTH_SECS`、
大きさを持たない fraction は `0`（真夜中 —— レンジ下限の入力が既に落ちる場所）になる。

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

> **解消済み**: `domain/time-of-day.ts` の `timeOfDay` の doc コメントは以前
> 「`0 = dawn boundary, 0.5 = dusk boundary`」と書いており、同じファイルの
> `INITIAL_TIME_STATE` のコメント（「in this cycle 0 is MIDNIGHT」）とも、
> 直下の `isNight` の実装とも矛盾していた。挙動は一貫していて、正しいのは本節の表のほうだった。
> 現在のコメントは本節に一致し、旧記述が何と矛盾していたかも併記してある。
>
> **`isNight` の実装には触れないこと。** SIM-1（`dayLengthTicks: 0` で恒久的な昼）は
> ここに `NaN` 分岐を足せば消えるように見えるが、それをすると mx-gameplay のミラーと
> 黙って食い違う。修復は `TimeService.restore` の側に置いてある（§2-2）。

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

## 2.4 CropService

作物はセーブを跨ぐ可変なワールド状態なので mc-sim が唯一の正を持つ。位置キーは
`dimension + BlockPosition` であり、同じ座標でも次元が違えば別の作物である。

```typescript
type CropLocation = { readonly dimension: Dimension; readonly position: BlockPosition }
type CropState = CropLocation & {
  readonly crop: 'wheat_crop' | 'potato_crop' | 'nether_wart_crop'
  readonly growthSecs: number
}
type CropSnapshot = { readonly crops: ReadonlyArray<CropState> }

type CropServiceApi = {
  readonly plant: (location: CropLocation, crop?: CropType, soil?: BlockType) => Effect.Effect<boolean>
  readonly cropAt: (location: CropLocation) => Effect.Effect<CropState | null>
  readonly matureYieldsAt: (location: CropLocation) => Effect.Effect<ReadonlyArray<ItemStack> | null>
  readonly remove: (location: CropLocation) => Effect.Effect<CropState | null>
  readonly advance: (delta: DeltaTimeSecs) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<CropSnapshot>
  readonly restore: (snapshot: unknown) => Effect.Effect<void, CropValidationError>
  readonly reset: Effect.Effect<void>
}
```

通常の `sim:physics` tick が `advance` をちょうど一度呼び、各作物は 480 秒で成熟する。
`CROP_REGISTRY` が成熟時間、種、土壌、許可次元、成熟時の保証収穫量を一貫して定義する。
wheat/potato は farmland、nether wart は soul sand を要求し、3 作物とも全次元で栽培できる。
保証収穫量は mx-gameplay の乱数範囲の下限と一致し、wheat は wheat 1 + seeds 1、potato は 2、
nether wart は 2。`matureYieldsAt` は全保証収穫物を返す。
未成熟なら `null`。`plant` は土壌不一致または占有済み位置を上書きせず `false` を返し、
`remove` は破壊前の状態を返す。

snapshot は位置キー順で決定論的に並び、JSON で往復できる。`restore` は未知キー、未知の次元・
作物、非整数座標、非有限または範囲外の成長値、重複位置を拒否し、失敗時は既存状態を変更しない。

## 3. GameLoop

```typescript
type FrameHandler = (dt: DeltaTimeSecs) => Effect.Effect<void>

type GameLoopApi = {
  readonly start: (handler: FrameHandler) => Effect.Effect<void>   // 再入可能
  readonly submitFrame: (at: MonotonicTimeSecs) => Effect.Effect<void>
  readonly stop: Effect.Effect<void>                                // 冪等・非ブロッキング
  readonly isRunning: Effect.Effect<boolean>
  readonly framesProcessed: Effect.Effect<number>    // stop を跨いで読める。§3-1
  readonly framesDropped: Effect.Effect<number>      // dropping queue が拒否した数。§3-1
  readonly secondsLostToClamp: Effect.Effect<number> // clamp が捨てたシミュレーション時間。§3-1
}
```

### 3-1. 捨てたものは数える

キューを drop すること自体も、巨大な delta を clamp すること自体も**正しい**。
間違っていたのは、どちらも**観測できなかった**ことである（SIM-7 / SIM-5）。

- `Queue.offer` は受理されたか否かを**返す**。それを `Effect.asVoid` で捨てていたので、
  ループも HUD もバグ報告も「フレームを落とした」と言えなかった。
  **引き算では復元できない**: submitted は呼び出し側の数字であり、processed は
  キューに残っている分だけ遅れる。だから offer の位置で数える。
- clamp の上限を超えた時間は世界に届かず、誰も返さない（背景タブ 30 秒で 29.95 秒）。
  `domain/frame-timing.ts` の `frameDeltaLossSecs` が量を定義し、ループが世代ごとに合算する。
  **下限側は数えない**。あちらは経過より*多く*時間を渡す側で、1 フレームで頭打ちになり、
  損失として符号付きで足すと本物のギャップと相殺して 0 に見えてしまう。

3 つとも `stop` を跨いで読める（SIM-10）。teardown はセッションレポートを書く瞬間であり、
以前はそこで 0 に戻っていた —— 一番読みたい瞬間が、唯一読めない瞬間だった。
`stop` が世代の最終値を 1 回読んで保持し、次の `start` が 0 に戻す。
「各 `start` が自分の状態を所有する」という規約は破れていない: 凍結した数値は共有可変フィールドではない。

参照実装 `packages/game/application/game-loop.ts:260 行` との差分:

| 事項 | 参照実装 | 新実装 |
| --- | --- | --- |
| フレーム源 | `requestAnimationFrame` を内部で呼ぶ（`buildScheduleFrame`, :135） | `submitFrame(at)` で外から供給。Node でテストできる |
| キュー | `Queue.dropping(QUEUE_CAPACITY)` (:106) | 同じ。容量 60 |
| 世代ごとの状態 | 長寿命の `Ref` を使い回す | **世代ごとに新規作成**。取り残しfiberが新世代を壊せない |
| 再入 | 後付け（:141-148 のコメントが経緯） | 最初から |
| 停止 | `Fiber.interruptFork`（:145, :198-201） | 同じ。加えて interrupt の**前**に detach |
| メンテナンスループ | 別 daemon (:228) | `startAutoSaveDaemon` が `Schedule.spaced` で定期保存し、停止時に fiber を interrupt |

`FrameHandler` の中身（stage の並び）は mc-sim の関心事ではない（[architecture.md](./architecture.md) §4.3）。

## 4. InventoryService

```typescript
type InventoryServiceApi = {
  readonly add: (item: ItemType, count: number) => Effect.Effect<number>     // 戻り値 = 入らなかった数
  readonly remove: (item: ItemType, count: number) => Effect.Effect<number>  // 戻り値 = 実際に取れた数
  readonly removeAt: (
    slotIndex: number,
    expectedItem: ItemType,
    count: number,
  ) => Effect.Effect<RemoveAtResult>
  readonly countOf: (item: ItemType) => Effect.Effect<number>
  readonly snapshot: Effect.Effect<Inventory>
  readonly restore: (inventory: Inventory) => Effect.Effect<number>  // 戻り値 = 入らなかった数。§4-1
  readonly reset: Effect.Effect<void>
  readonly getSlot: (slotIndex: number) => Effect.Effect<InventoryCarriedSlot>
  readonly getHotbarSlots: Effect.Effect<ReadonlyArray<InventoryCarriedSlot>>

  // --- クラフト（§4.1） ---
  readonly recipes: Effect.Effect<RecipeTable>
  readonly previewCraft: (grid: CraftGrid) => Effect.Effect<RecipeMatch>
  readonly craft: (grid: CraftGrid) => Effect.Effect<CraftResult>
}

type RemoveAtResult =
  | { readonly _tag: 'Removed'; readonly removed: number }
  | { readonly _tag: 'InvalidSlot' }
  | { readonly _tag: 'InvalidCount' }
  | { readonly _tag: 'EmptySlot' }
  | { readonly _tag: 'ItemMismatch'; readonly actualItem: ItemType }
  | { readonly _tag: 'Insufficient'; readonly available: number }
```

参照実装 `packages/inventory/application/inventory-service.ts:22-101` は 14 メソッド:
`getSlot` / `setSlot` / `damageSlot` / `repairMendingItemsWithXP` / `moveStack` / `sortInventory` /
`quickMove` / `addBlock` / `removeBlock` / `getHotbarSlots` / `getAllSlots` / `serialize` /
`clear` / `deserialize`。

現実装は add / remove / 照会 / 直列化 / クリアに加え、スロット操作を公開している。
現時点の実装状況:

- **スロット単位操作**: 選択スロットからの消費に必要な最小の原子的操作として
  `removeAt` は実装済み。`expectedItem` の照合と減算を単一の `Ref.modify` で行うため、
  UI が見た後にスロット内容が変わっても別アイテムを消費しない。失敗時は全スロット不変。
  `getSlot` / `setSlot` / `moveStack` / `quickMove` / `sortInventory` は実装済み。
  `moveStack` は空スロットへの移動、同種スタックの統合、異種スタックの交換を行い、
  `quickMove` はプレイヤーインベントリとホットバー間を移動する。`sortInventory` はアイテム名、
  数量の降順で並べ替える。すべての更新は `Ref.modify` で原子的に行い、耐久値もスタックと同期する。
- **耐久 / メンディング**（`damageSlot` / `repairMendingItemsWithXP`）: XP サービスと結合する。
  「何をしたら耐久が減るか」は mx-gameplay、「減った値を保持する」が mc-sim。
- **`addBlock` の失敗チャネル**: 参照実装は `Effect<void, InventoryError>`。
  新実装は満杯を**エラーにせず leftover として返す**。満杯は正常なゲーム状態であり、
  呼び出し側（mx-gameplay）はそれを地面のドロップアイテムに変換する。エラーにすると
  すべての呼び出し側が握り潰すことになり、握り潰した瞬間にアイテムが消える。
- **`ItemId` はもう無い。** mc-kernel が `ItemType`（閉じたリテラル union）を公開したので、
  暫定エイリアスは*付け替え*ではなく**削除**した（`domain/inventory.ts` のヘッダに理由）。
  署名はすべて `ItemType` を取る。これは公開型の破壊的変更なので、生成される宣言差分と
  （[versioning.md](./versioning.md)）を同じ変更単位で確認する。
- **`add` は採掘の継ぎ目でもある。** kernel の `dropOfBlockId(id, context?)` が返す
  `BlockDrop.item` は `ItemType` なので、`inventory.add(drop.item, drop.count)` が
  アダプタもキャストも無しで通る。**`addDrop(drop)` は足していない** —— 採掘は動詞であり
  mx-gameplay の責務（plan.md §2.3-1）で、ここに置くと mc-sim が `BlockDrop` /
  `HarvestContext` / 道具ゲートを写す羽目になる。

### 4-0. `HotbarService` — 選択状態と9スロット投影

参照実装の `packages/inventory/application/hotbar-service.ts` に対応する状態は、
インベントリ本体へ混ぜず `HotbarService` が所有する。選択値は 0..8 にクランプし、
スクロールは両端で循環する。スロット内容は `InventoryService.getHotbarSlots` を通して
読み、同じインベントリの `HOTBAR_START`（27）から 9 スロットを返す。

```typescript
type HotbarServiceApi = {
  readonly getSelectedSlot: Effect.Effect<number>
  readonly setSelectedSlot: (slot: number) => Effect.Effect<void>
  readonly scroll: (delta: number) => Effect.Effect<void>
  readonly getSelectedItem: Effect.Effect<InventoryCarriedSlot>
  readonly getSlots: Effect.Effect<ReadonlyArray<InventoryCarriedSlot>>
  readonly update: (input: HotbarInput) => Effect.Effect<void>
}
```

`HotbarServiceLayer` は `InventoryService` を要求する。ホストは入力イベントを
`HotbarInput`（直接選択またはホイール差分）へ変換して `update` を呼び、キー割り当てや
ポインタ入力そのものを mc-sim に持ち込まない。

### 4-0-1. `SimulationSave` — セーブされる状態

`domain/save-data.ts` の `SimulationSave` v2 は、セーブを跨ぐ状態を定義する。
`player.selectedHotbarSlot`（0..8）と `statistics.counters` /
`statistics.unlocked` を保存し、実績の registry / predicate は持たない。
`saveSimulation` / `loadSimulation` / `listSimulationSaves` は `mc-save` の
保存形式を利用する。v1 → v2 は保存形式の migration chain で初期選択 0 と空の統計台帳へ移行する。

### 4-1. `restore` はスロット数を再確立し、入らなかった数を返す

**`restore` は渡されたものをそのまま入れていた（SIM-2）。** スロット数の違うビルドが書いたセーブは
プレイヤーを黙って**リサイズ**する —— 2 スロットのセーブは 36 スロットのプレイヤーを 2 スロットにし、
その後に採掘した 1000 ブロックのうち 872 が地面に落ちる。症状は「なぜか常に満杯」だけである。
スナップショットはバージョン境界を跨いで届き、それはまさにスロット数が変わる瞬間である。

`domain/inventory.ts` の `normaliseInventory` が修復を 1 か所に持つ。

```typescript
type NormaliseOutcome = { readonly inventory: Inventory
                          readonly leftover: number
                          readonly discarded: number }   // ← 語彙付け替えで増えた。下記
const normaliseInventory: (inventory: Inventory) => NormaliseOutcome
```

- 長さは常に `INVENTORY_SLOT_COUNT`。短いセーブは詰め物をし、**長いセーブは末尾を切り捨てず再挿入**する。
- アイテムごとの kernel stack limit 超のスロットは 1 スタックを残して余りを再挿入する。
- 0 / 小数 / `NaN` のスタックは空スロットになる（小数は整数部が残る）。
- **`ItemType` でない名前のスロットは捨て、`discarded` に数える**（新）。
- 再挿入は `addItem` を通るので top-up 規則が効き、**どうしても入らない分は `leftover` として返る**。

**`discarded` は `ItemId = string` を閉じた union に付け替えたことが作った穴を塞ぐためにある。**
以前は `'DIAMOND'` と書いてあるセーブも「妙だが合法」だった。いまは
**値が自分の型と食い違うスロット**になる —— `countOf` は数えるがどのレシピにも一致せず、
`Slot.item` が `ItemType` である以上、下流の誰にも見えない。セーブはバージョン境界を跨いで届き、
`ITEM_TYPES` を増やすのは kernel の MINOR リリースなので、これは仮定の話ではない。
`leftover` に混ぜないのは意味が違うからである: leftover は mx-gameplay が地面に湧かせる数だが、
存在しないアイテムは湧かせようがない。

`restore` の戻り値が `void` ではなく `number` なのは `add` と同じ判断である。満杯は正常なゲーム状態で、
その帰結は地面のドロップアイテムであり、ここで数を握り潰せばアイテムが消える。
**`restore` は `leftover` だけを返し、`discarded` は返さない。**
知りたいホストは `normaliseInventory`（公開・純粋・冪等）を先に自分で呼べばよく、
1 つの `number` に意味の違う 2 つを多重化しないほうがサービスの署名として正しい。
`makeInventoryService(initial)` も同じ修復を通す（`Layer` 経由で 2 スロットの世界が始まらないように）。

**`domain/inventory.ts` は「純粋かつ全域」と書いてある。書いてあるだけだった（SIM-3）。**
`removeItem` は `StackCount(left)` を書き、`StackCount` は `Brand.refined` なので [0, 64] の外で
**throw する**。フレームループの中ではそれが `Cause.Die` になり、`game-loop.ts` がログに出して
**握り潰す** —— 症状は「採掘とクラフトが動かなくなった」だけで、何も失敗しない。
現在はスロットの読みをガードし、派生する書き込みを clamp してあるので、
**この module が作っていない `Inventory` に対しても全域**である。
clamp は余りを失うので、それは sanctioned な道ではない: 精算するのは `normaliseInventory` であり、
`restore` がそれを通す以上、そのようなスロットはもう到達不能である。

## 4.1 レシピとクラフト

plan.md §7 は「クラフト = mc-sim（レシピと状態）+ mx-ui（画面）」、§2.3-1 は状態を基盤層に置く。
レシピ表は**名詞**（何が存在するかの台帳）なので本リポジトリにある。

```typescript
// domain/recipe.ts
type RecipeId = string                      // 'mc-sim:stick'。閉じた union には**しない**（§4.1-7）
type Ingredient = { readonly _tag: 'Exact'; readonly item: ItemType }
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

const exactly:          (item: ItemType) => Ingredient
const ingredientMatches:(ingredient: Ingredient, item: ItemType) => boolean
const shapedRecipe:     (id, rows: ReadonlyArray<string>, key: Record<string, ItemType>, output) => ShapedRecipe
const shapelessRecipe:  (id, items: ReadonlyArray<ItemType>, output) => ShapelessRecipe
const craftGrid:        (width, height, items: ReadonlyArray<ItemType | undefined>) => CraftGrid
const cellAt:           (grid: CraftGrid, x: number, y: number) => Slot
const matchRecipe:      (table: RecipeTable, grid: CraftGrid) => RecipeMatch   // 全域・表順非依存
const conflictsIn:      (table: RecipeTable) => ReadonlyArray<RecipeConflict>
// domain/recipe-data.ts
const STARTER_RECIPES:  RecipeTable                                            // 現行 kernel で表現できる公式データ（§4.1-7）

// domain/crafting.ts
type CraftResult =
  | { _tag: 'Crafted'; recipeId: RecipeId; output: ItemStack }
  | { _tag: 'NoMatch' }
  | { _tag: 'MissingIngredients'; missing: ReadonlyArray<MissingIngredient> }
  | { _tag: 'NoRoom' }
const ingredientCost: (grid: CraftGrid) => ReadonlyMap<ItemType, number>
const craftFromGrid:  (inventory: Inventory, table: RecipeTable, grid: CraftGrid) => CraftOutcome
```

### 4.1-1 mx-ui がこれで何を投影できるようになったか

`mx-ui/domain/inventory-view-model.ts` の `CraftingSnapshot.result` は 3 値
（`Match` / `NoMatch` / **`undefined` = mc-sim が答えていない**）で、
「mc-sim に `Recipe` が無かった」ため実際に常時 `undefined` だった。
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
  この規則を動かしているのは **出荷される表そのもの**（`mc-sim:flint-and-steel`）である。
  一時期は非対称な shaped が表から消えており、規則を動かしていたのは
  `test/recipe.test.ts` のローカル表だけだった（§4.1-7）。

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

### 4.1-6 現在の境界（型が繰り延べを見せる）

| 繰り延べ | 型でどう見えるか |
| --- | --- |
| 材料タグ（「任意の板材」） | `Ingredient` が**メンバ 1 つの tagged union**。消費側は既に `_tag` で分岐しているので、`Tag` の追加は破壊的変更にならない。裸の `ItemType` にしていたら破壊的変更になっていた |
| 1 セル複数個・残留アイテム（ケーキのバケツ） | 表現できない。黙って間違うのではなく**無い** |
| かまど | `domain/smelting.ts` の純粋な遷移として実装済み |
| 醸造 | `domain/brewing.ts` の純粋な遷移として `STARTER_BREWING_RECIPES` の4レシピを実装。現行 `mc-kernel` の `ItemType` 語彙で表現できない公式レシピは依存側の語彙拡張待ち |
| 金床 | `@nerima-games/mc-kernel` の汎用 anvil API を `src/index.ts` から再公開し、`domain/enchantment.ts` が対応するバニラ規則集合を渡す |
| エンチャント | `domain/enchantment-data.ts` に現行 `mc-kernel` の `ItemType` 語彙で表現できる 32 個の規則（最大レベル、適用先、競合）と、エンチャント本 / 同種アイテム別の金床コスト表を定義。`domain/enchantment-table-data.ts` / `domain/enchantment-table.ts` がテーブルのスロット計算・重み付き抽選・競合除去を提供し、語彙外の装備規則は `mc-kernel` の境界に残る |
| shapeless の重なり合う述語 | `matchesShapeless` は既にバックトラッキング割当（ソートして比較ではない）。`Tag` が入った日に貪欲法が誤答する経路を最初から塞いである |
| 複数個まとめてクラフト | `craft` は 1 回分 |

### 4.1-7 表は 7 件 → 5 件 → **7 件**（要求は値段つきで出され、7 個が通った）

`ItemId = string` を kernel の `ItemType`（当時は閉じた 16 リテラル）に付け替えた結果、
表の 7 件のうち 3 件が**存在しないアイテム**を名指していた。名指していたのは
`IRON_INGOT` / `FLINT` / `FLINT_AND_STEEL` / `GUNPOWDER` / `BLAZE_POWDER` / `COAL` /
`FIRE_CHARGE` / `CRAFTING_TABLE` の 8 個である。

**その場では mc-kernel に足させるのではなく、削った。** 理由は 3 つあった。

1. **語彙は所有パッケージから直接読む。** `ITEM_TYPES` と `ItemType` は
   `@nerima-games/mc-kernel` が所有し、mc-sim にローカルミラーやミラー検査コマンドは置かない。
   語彙の追加が必要な場合は、レシピ表から推測せず kernel 側の理由とともに依頼する。
2. **mc-sim の都合で足すべきでもない。** ロスタを 8 個ふくらませるのは、tier-2 のレシピ表を根拠に
   tier-1 の語彙を決めることになる。それは本プロジェクトが 2 回退けてきた
   「推測されたロスタ」と同じ形をしている。**要求は出す。ただし発議は kernel 側の理由で行われる。**
3. **削る代償が均一ではなかった。** 3 件の値段は違う。

| 削った / 替えた | それが動かしていた規則 | 代償 | いま |
| --- | --- | --- | --- |
| `mc-sim:crafting-table` → `mc-sim:glowstone` に**差し替え** | shaped 2x2 対称（平行移動） | **なし。** グロウストーン（ダスト 4 個）は同じ形の本家レシピで、しかも 16 個の中に収まる。出力しか違わない行は、そもそもコンテンツだった | **差し替えたまま。** `crafting_table` は要求から外し、kernel も入れていない |
| `mc-sim:fire-charge` を**削除** | shapeless・**相異なる 3 材料**（順列） | 代替が無い。16 個の中に「相異なる 3 材料の本家 shapeless」は存在しない | **復帰**（火薬 / ブレイズパウダー / 石炭 → 火の玉 3 個） |
| `mc-sim:flint-and-steel` を**削除** | shaped・**非対称**（左右鏡像） | 代替が無い。16 個の中に「非対称な本家 shaped」は存在しない | **復帰**（鉄インゴット / 火打石の対角） |

#### 要求は通った —— ただし kernel 側の理由で

kernel は要求した 8 個のうち **7 個**を `ITEM_TYPES` に入れた（ロスタは 16 → 23）。
入った理由は「mc-sim のレシピ表が要る」ではなく、**それぞれの kernel 側の理由**である:

| 追加 | kernel 側の理由 |
| --- | --- |
| `coal` / `iron_ingot` / `flint` | 鉱石ブロックと砂利の**ドロップ**。`BlockDropRule.item` は `ItemType \| 'self'` なので、どのレシピが名指すより先にここに要る |
| `gunpowder` / `blaze_powder` | mob ドロップ（規則は plan.md §3.11 で mx-gameplay、語彙は kernel） |
| `flint_and_steel` / `fire_charge` | §3.11 が flammable 能力に対して名指す**着火アイテム 2 つ** |

**`crafting_table` は要求したが入らなかった。** 上表の通りその行は同形の本家レシピに
差し替え済みで、リテラルを必要とするものが何も無い。理由の無い語彙を足さないという判断であり、
**この却下は正しい**。mc-kernel の登録表にも不要な語彙を追加していない。

#### 表がいま示すもの

現在の `STARTER_RECIPES` は `domain/recipe-data.ts` が所有する公開データであり、
現行 mc-kernel の `ItemType` 語彙で表現できる公式レシピだけを収録する。
レシピの型・コンストラクタ・一致判定は `domain/recipe.ts`、インベントリへの原子的な適用は
`domain/crafting.ts` が所有する。

shapeless、shaped の平行移動・左右鏡像・穴のあるパターン、3x3 グリッド制約、そして
曖昧性規則（shaped が shapeless に勝つ・表順非依存）は、出荷データを使う
`test/recipe.test.ts` と `test/crafting.test.ts` で検証する。曖昧性のためだけに必要な
`mc-sim:stick-from-loose-planks` はテスト fixture に限定し、公開データには含めない。

`conflictsIn(STARTER_RECIPES)` は空であることをテストで確認している。kernel に存在しない
アイテムを必要とする公式レシピは、この表へ暗黙に追加せず、kernel の語彙拡張とレシピデータの
追加を同じ変更として扱う。

## 4.2 着地衝撃通知

`sim:physics` は mc-physics の積分と衝突解決を順に呼び、その境界でのみ分かる
「空中から接地へ遷移した瞬間」を 1 フレームの値として公開する。落下距離の追跡自体は
mc-physics 0.2.0 の `advanceFallTracking` / `FallTrackingState` に委譲しており（旧: `stages/registration.ts`
内のインライン計算）、下記の公開契約（`LandingImpact` の形と `Some`/`None` の遷移条件）は変わっていない。

```typescript
type LandingImpact = {
  readonly fallDistance: number
  readonly impactVelocityY: number
}

type SimFrameState = {
  // 既存フィールドは省略
  readonly accumulatedFallDistance: Ref.Ref<number>
  readonly landingImpact: Ref.Ref<Option.Option<LandingImpact>>
}

const resetLandingImpact: (state: SimFrameState) => Effect.Effect<void>
```

- `fallDistance` は上昇終了後から接地までの**実際の下向き移動量**の合計である。
  `velocity * dt` の推定値ではないため、終端速度に達した後も距離は増え続ける。
- `impactVelocityY` は衝突解決前の積分済み Y 速度であり、通常の着地では負数である。
- `landingImpact` が `Some` になるのは `!wasGrounded && isGrounded` の遷移フレームだけである。
  次の `sim:physics` 開始時に `None` へ戻るため、消費者はこの stage より後で読む。
- 静止接地、段差への乗り上げ、上昇中にはイベントを発行しない。上昇分も落下距離へ含めない。
- `resetLandingImpact` は累積距離と通知を同時に消す。`PlayerService.moveTo` によるテレポートなど、
  通常の物理 stage を経由しない位置変更を行う呼び手は、同じ処理境界でこれを呼ぶ。
  stage 自身は mailbox の位置適用時と物理無効時に自動でリセットする。

`SimPhysicsConfig.resolve`（= `@nerima-games/mc-physics` の `ResolveOptions`、
`src/stages/registration.ts`）は mc-physics 0.2.0 で `isBlockSolid` を廃止し、必須の
`blockPropertiesAt` と任意の `blockShapeAt` に置き換えた。`blockShapeAt` を渡すセルはそちらが
全域的に支配し、形状が `null` でも `blockPropertiesAt` へフォールバックしない。ホストの旧
`isBlockSolid` 相当の判定は `blockShapeAt` 側へ移す（`test/stage-registration.test.ts` の
フィクスチャ参照）。

## 5. まだ設計していない公開API

plan.md §3.8 の責務のうち、界面をまだ書いていないもの。**着手前に本書へ追記すること。**

| 領域 | 参照実装 | 主な消費者 |
| --- | --- | --- |
| ~~`EntityManager`~~ | — | **§7 で設計済** |
| 体力 / 空腹 / XP | `health-service.ts` / `hunger-service.ts` / `xp-service.ts` | mx-gameplay / mx-ui |
| 実績 / 統計 | `achievement-service.ts` / `statistics-service.ts` | mx-gameplay / mx-ui（統計の記録・保存は実装済み。実績 registry / predicate は mx-gameplay） |
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

## 6. 公開面と配布物

公開ソースの入口は `src/index.ts` であり、配布物の入口は `package.json` の `exports` が指す
`dist/index.mjs` と `dist/index.d.ts` である。公開面の変更は、個別のロックファイルではなく
ソース・パッケージ宣言・生成された配布物を同じ変更単位で確認する。

| 確認対象 | 実施内容 |
| --- | --- |
| 公開型 | `pnpm typecheck` で source / test / preview の型を検査し、`dist/index.d.ts` を生成する |
| 実行時入口 | `pnpm build` で ESM バンドルを生成し、Node 24 から `dist/index.mjs` を import する |
| Effect サービス | `Context.Tag` と `Layer` の組み合わせを、公開 source と型宣言で確認する |
| 挙動 | `pnpm test` と `pnpm test:coverage` で純粋な遷移・サービス境界・統合シナリオを検査する |
| 依存境界 | `package.json` の直接依存、静的 import、TypeScript の型検査で所有パッケージを確認する |

### 6.1 Effect サービスの公開契約

`PlayerService`、`InventoryService`、`TimeService` などの Effect サービスは、Tag の識別子と
サービス値の型が一つの契約になる。`Context.Tag` / `Context.GenericTag` と `Layer` を直接公開し、
呼び出し側が同じ Tag を解決できる形を維持する。サービスの内部実装を変更しても、公開される
メソッド・戻り値・エラー型を変えない限り配布物の契約は変わらない。

### 6.2 宣言と挙動の役割分担

宣言の破綻は `pnpm typecheck` と `pnpm build` が捕捉し、実行時のバンドル解決は Node 24 の
公開入口 import で確認する。境界値、状態遷移、保存復元、サービス合成の回帰はテストが捕捉する。
いずれか一方を公開 API の証拠にしない。

公開面を変える変更では `src/index.ts`、`package.json` の `exports`、生成された
`dist/index.d.ts` / `dist/index.mjs` の差分と、上表の検査結果を同じ変更単位でレビューする。

## 7. EntityManager —— エンティティ台帳

plan.md §3.8 が責務文の**先頭**に置き、§5 の表が初回コミットから
「着手前に本書へ追記すること」付きで空けていた枠。本節がその追記である。
節番号が §6 の後ろなのは、§5 / §6 が他 5 ファイルから参照されているためで、
順序ではなく参照の安定を採った（`docs/versioning.md` §3-4、`README.md`、
`docs/testing.md`、`docs/architecture.md`、`docs/responsibility.md`）。

```typescript
// domain/entity.ts —— 純粋・全域・クロック無し
type EntityId   = string & Brand.Brand<'EntityId'>     // 'e:0'
type EntityKind = string & Brand.Brand<'EntityKind'>   // 'creeper'（**開いた**型。§7-2）

type EntityState<S> = {
  readonly feetPosition: Position     // 足元原点。命名で座標規約を運ぶ（DN-10）
  readonly healthPoints: number
  readonly behaviour: S               // ルール層の値。mc-sim は中を読まない（§7-1）
}
type Entity<S>      = EntityState<S> & { readonly id: EntityId; readonly kind: EntityKind }
type EntityRoster<S> = { readonly entities: ReadonlyArray<Entity<S>>; readonly nextSerial: number }

type EntityTransition<S> =
  | { readonly _tag: 'Unchanged' }                                  // 同じオブジェクトを再利用
  | { readonly _tag: 'Changed'; readonly state: EntityState<S> }
  | { readonly _tag: 'Despawned' }
type EntityStep<S, A> = { readonly transition: EntityTransition<S>; readonly emit: A | undefined }

const spawnEntity:    <S>(roster, request: SpawnRequest<S>) => SpawnOutcome<S>
const despawnEntity:  <S>(roster, id: EntityId) => DespawnOutcome<S>
const findEntity:     <S>(roster, id: EntityId) => Entity<S> | undefined
const countOfKind:    <S>(roster, kind: EntityKind) => number
const sweepRoster:    <S, A>(roster, step: (e: Entity<S>) => EntityStep<S, A>) => SweepOutcome<S, A>
const normaliseRoster: <S>(roster, repairBehaviour?: BehaviourRepair<S>) => NormaliseRosterOutcome<S>
const mintEntityId / serialOfEntityId / isEntityId / isEntityKind / emptyRoster
const UNCHANGED / DESPAWNED / changed

// application/entity-manager.ts
type EntityManagerApi<S> = {
  readonly spawn:       (request: SpawnRequest<S>) => Effect.Effect<Entity<S>>
  readonly despawn:     (id: EntityId) => Effect.Effect<boolean>
  readonly entities:    Effect.Effect<ReadonlyArray<Entity<S>>>        // ゼロコピー。§7-3
  readonly find:        (id: EntityId) => Effect.Effect<Entity<S> | undefined>
  readonly count:       Effect.Effect<number>
  readonly countOfKind: (kind: EntityKind) => Effect.Effect<number>
  readonly sweep:       <A>(step: (e: Entity<S>) => EntityStep<S, A>) => Effect.Effect<ReadonlyArray<A>>
  readonly snapshot:    Effect.Effect<EntityRoster<S>>
  readonly restore:     (roster: EntityRoster<S>) => Effect.Effect<RosterRepair>   // §7-4
  readonly reset:       Effect.Effect<void>
}
const ENTITY_MANAGER_TAG_KEY = '@nerima-games/mc-sim/EntityManager'
const entityManagerTag:   <S>() => Context.Tag<EntityManager, EntityManagerApi<S>>
const makeEntityManager:  <S>(initial?, repairBehaviour?) => Effect.Effect<EntityManagerApi<S>>
const EntityManagerLayer: <S>(initial?, repairBehaviour?) => Layer.Layer<EntityManager>
```

### 7-0 なぜ今これが要るのか —— mx-gameplay が書き残した理由

mx-gameplay の `domain/mob/` には**完成したクリーパーのルールが 4 本**ある
（導火線・爆風・スポーン条件・ドロップ）。`gameplay:entities` stage はその 4 本を
**1 本も呼んでいない**。`mx-gameplay/stages/registration.ts:230-246` が理由を書いている:

> THE CREEPER IS NOT RUN HERE, AND THE REASON IS THE POINT. [...] Running them
> would need something to iterate over: a roster of mobs with positions and
> health, and a way to ask how far each one is from the player. That is state, it
> has to survive a save/load round trip, and by the test in this file's header it
> therefore belongs to mc-sim.
>
> A local `Ref<Map<MobId, CreeperFuse>>` here would run today and would be the
> same mistake as the `timeOfDaySecs` Ref this file used to hold: a second owner
> of a noun, diverging from the one that gets saved.

plan.md §7 の「状態管理は sim、AI/スポーン/ドロップのルールは gameplay」と
[responsibility.md](./responsibility.md) §3.1 の「Mob という存在がいて座標と体力を持つ」が
そのまま本節の範囲である。**Mob の挙動は 1 行も入っていない。**
`domain/entity.ts` に `'creeper'` という文字列は 1 つも無く、`countOfKind` は
呼び出し側が渡した文字列を比較するだけである（DN-11）。

### 7-1 `CreeperFuse` を「知らないまま」運ぶ —— 型引数

mx-gameplay の `CreeperFuse` は明示的に**ホストが保持して返す値**として設計されている
（`creeper-fuse.ts`: 「No `Ref`, no map from entity to fuse [...] the CREEPER is
saved state (mc-sim's)」）。したがって mc-sim は**名指しできない値**を持つ必要がある。
mx-gameplay を import することはできない（逆向きの依存は循環になる）し、
「これはクリーパーだから」と分岐することもできない（DN-11 の境界）。

素直な綴り 2 通りはどちらも同じ方向に間違っている。

| 案 | 何が壊れるか |
| --- | --- |
| `behaviour: Record<string, unknown>` / `unknown` | **型が消える。** mx-gameplay 側の読み出しが全部キャストになり、それは `ItemId = string` が作った「間違いようがないので正しくもなれない型」（`application/inventory-service.ts`）そのもの |
| 挙動の閉じた union を**ここで**宣言 | mc-sim が Mob ロスタの第 2 の所有者になる。mx-gameplay が Mob を 1 種類足すたびに mc-sim の公開面が変わる —— plan.md §8 の第 1 リスクを、意見を持てないリポジトリが駆動する |

採ったのは**型引数**である。`Entity<S>` が `S` を運び、本モジュールのすべての関数が
`S` に対して parametric で、`S` に対して行う操作は「入れる」「そのまま返す」
「ロード時にホスト自身の修復関数へ渡す」の 3 つしかない。
ホストは `S` を 1 度だけ —— 両リポジトリが同時に見える唯一の場所で —— 具体化し、
mx-gameplay はキャストもアダプタも無しで `CreeperFuse` を読み書きする。
`test/entity.test.ts` は無知そのものを固定する: mc-sim が解釈しうるフィールドを 1 つも持たない値が、
spawn / sweep / snapshot / restore を**参照同一性のまま**通り抜ける。

**Tag が `Context.Tag` クラスではなく関数なのはこのためである。** クラスは自分の Tag に対して
generic になれない。`Context.GenericTag<EntityManager, EntityManagerApi<S>>(KEY)` は
クラスが束ねている 2 つを分ける —— **コンテキスト同一性**（`EntityManager`。引数を持たず、
すべての `R` に現れるのはこちら）と**サービス値型**（引数を持つ）。
Effect は Tag を文字列キーで解決するので、どの具体化も同じ 1 つのサービスを指す。

これは依存パッケージの型をローカルで再宣言することによる形の不一致とは**別物**である。
ローカルのミラーを許すと、少ないフィールドの Layer が別の Tag を満たし、
欠けたフィールドが `undefined` になる。こちらはどの具体化もメソッドも引数も同一で、
違うのは **mc-sim が決して読まないフィールドの静的な型だけ**である。
間違った `S` を選んだ消費者が得るのは「自分で誤って説明した値」であり、
それは `unknown` 経由のキャストと同じ帰結で、違いは選択が 1 か所
（ホストの `EntityManagerLayer<S>()`）に書き下されていることである。

### 7-2 ID の設計 —— ブランデッド文字列と、**保存されるカウンタ**

`EntityId` は `Brand.refined` の非空白文字列で、`mc-kernel/domain/identifiers.ts` の
`WorldId` / `StageId` と**同じ形・同じ refinement** である。数値 ID ではなく文字列なのは
永続化境界で 2^53 の問題を持ち込まないためで、ブランドが付いているのは
「無関係な文字列を数種類持っている」唯一のフィールドだからである。

**kernel の語彙ミラーには入れていない。** kernel の `identifiers.ts` に
エンティティ ID は無い。台帳が mc-sim のものである以上、その鍵も mc-sim のものである
—— kernel が kernel 側の理由で公開する日までは（`ItemType` のときと同じ順序）。

**`EntityRoster.nextSerial` はセーブされる状態の一部である。これが「ID がセーブを生き延びる」の実体である。**
毎回 0 から採番する台帳は、ロード直後の新しい Mob に `e:1` を再発行する ——
セーブが既に `e:1` を持っているのに。同じ ID の 2 体は `findEntity` から片方しか見えず、
もう片方は despawn 不能になる。参照実装で最も高くついたシングルトンのバグ
（"Player already exists"、`packages/entity/application/player-service.ts:15-18`）の、
名前を数字に替えた形である。

採番は**乱数ではない**。`Math.random()` が無い理由は `Date.now()` が無い理由と同じで（DN-12）、
plan.md §5.1-3 が参照実装のテストをオラクルとして使う前提に決定性を置いているためである。
カウンタは再現するが UUID は再現しない。

### 7-3 反復はホットパスである —— `entities` はゼロコピー、無風の sweep は無音

`gameplay:entities` は**毎フレーム全 Mob**を走る。plan.md §5.2 は 1 節まるごとが
フレーム毎のアロケーションの話であり、ここは公開面がそれを取り消せる場所である。
契約は実装詳細ではなく**性質**として書いてあり、テストは時間ではなく**参照同一性**を assert する。

- `entities` は台帳が持っている**その配列**を返す。コピーも `Array.from` も投影も無い。
  書き込みを挟まない 2 回の読みは、同じ配列・同じオブジェクトを返す。
- `Unchanged` のエンティティは**同じオブジェクトが結果に入る**。1 体だけ変えた sweep の後、
  他の 999 体は `toBe` で同一である（レンダラとネットワーク差分が参照比較できる）。
- **何も変わらず何も emit しなかった sweep は、引数の roster をそのまま返し、配列を 1 本も作らない。**
  結果配列は最初に実際に変わったエンティティで初めて生成され、変わらなかった前半から作られる。
  無風のフレーム —— 全員 Dormant、プレイヤーは遠く —— のコストは Mob 1 体あたり
  クロージャ呼び出し 1 回だけである。これは mx-gameplay が 1 階層上で DN-GP-1 に対して
  やっていること（「An idle tick stops HERE, without touching the store」）と同じ規律である。

`find` は線形である。Map を併置すれば O(1) になるが**書き込みのたびに第 2 の構造を作る**ことになり、
参照実装が敵対 Mob を 16 体で打ち切っている（`MAX_HOSTILE_COUNT`）台帳に対して、
フレーム上のパスでアロケーションを払ってフレーム外のパスを速くすることになる。
索引は「検討して作らなかった」ものであり、`domain/entity.ts` に再検討の引き金ごと書いてある。

**書き込み口は `sweep` 1 本だけである。** `moveTo` も `damage` も `setBehaviour` も無い。
第 2 の書き込み口は不変条件を守る場所が 2 か所になることであり、しかも爆風の場合は
「半径内の全エンティティにダメージ」＝ 1 パスであって N 回の原子更新ではない。
1 体だけの更新は `sweep` の中で id を見ればよく、触らなかったエンティティのコストはゼロである。

### 7-4 `restore` は全域 —— そして**修復が修復対象を再生産しかけた**

`normaliseInventory` / `normaliseTimeState` と同じ判断である。セーブはバージョン境界を跨いで届き、
それは異常ではなく通常であり、直せるフィールドでワールドロードを失敗させると
**直せるセーブが開けないセーブになる**。エラーチャネルは無く、代わりに何を変えたかが
`RosterRepair` として返る（`InventoryService.restore` が `leftover` を返すのと同じ判断）。

修復は 5 つ。

1. **入れ物。** `entities` が無い / 配列でない → 空。穴や `null` は飛ばす。
2. **kind。** 非空白文字列でなければ**エンティティごと捨てて `discarded` に数える**。
   唯一修復不能なフィールドである —— 既定の kind は「mc-sim が Mob を発明する」ことにしかならない。
3. **座標と体力。** 値に修復する。**捨てない。** 大きさを持たない座標は 0 になる ——
   `domain/time-of-day.ts` の `clampFraction`（「大きさを持たない値は 0 = 真夜中。実在する瞬間であることが効く」）
   と同じ論法である。逆（`NaN` の Mob を捨てる）を採らなかったのは、`NaN` があらゆる距離判定を
   false にするため、起爆範囲からも despawn 半径からも見えない**不死で到達不能な Mob** になるからで、
   原点に立っている Mob は少なくとも**目で見える間違い**である。
4. **ID。** 空白の ID と、同じセーブ内で既に使われた ID は**採番し直して `reidentified` に数える**。
   本モジュールが採番していない ID でも一意なら**触らない** —— 他ビルドの `'creeper-7'` は
   鍵として完璧に機能し、改名はロードが守ろうとしている参照そのものを壊す。
5. **カウンタ。** 保存された値が何であれ、結果の `nextSerial` は存在するどの採番済み serial よりも大きい。

**修復 5 は 2 度読む必要があった。** [testing.md](./testing.md) §3.0.1 が記録している
「修復関数が SIM-1 を再生産していた」には、ここに正確な相似形がある:
修復 4 の採番には serial が要る → 素直な供給源は保存された `nextSerial` →
その `nextSerial` は**いま修復しているファイルのフィールド**である。
信じると、`nextSerial: 0` と書いてある切り詰められたセーブの重複 `e:0` は `e:0` に採番し直され、
**修復が取り除くはずの衝突をそのまま出力しながら `reidentified: 1` と報告する。**
だからカウンタは、何かが採番するより**先に**、実際に存在する ID の上で確定する。
`test/entity.test.ts` は両方を固定する ——「カウンタが嘘のセーブを修復しても衝突しない」と、
「修復済みを修復すると 0 を報告する」（不動点であること。将来の修復が不動点でなければ落ちる）。

**コンストラクタも同じ修復を通る。** `makeInventoryService` がスロット数で塞ぎ、
`makeTimeService` が後から日長で塞いだ穴と同じである（§3.0.1）: `XxxLayer(loadedState)` は
ホストがロード済みワールドを渡す自然な形であり、`restore` だけを守ると別の入口が空く。

### 7-5 ホストがやること —— クリーパーを動かすための呼び出し列

`simModule` には**まだ入れていない**。`stages/registration.ts` が `InventoryService` を
`simModule.layers` に入れている理由（mc-compose の `docs/e2e-triage.md` §4.3 が計測した
「2 リポジトリが共有するサービスを組み立てる場所が 1 つでないと何が起きるか」）は
1 語残らずここにも当てはまるが、`simModule` は `const` であり `S` は**ホストの選択**である。
既定値を出荷することは `BehaviourRepair` の無い `EntityManagerApi<unknown>` を出荷することであり、
その隣に自分の型付き Layer を merge したホストは、モジュール契約に従ったつもりで
§4.3 が計測した 2 インスタンスの欠陥を作る。**どのホストにとっても誤っている既定値は、既定値が無いより悪い。**
`simModule` が型引数を持つかどうかは配線の段の判断であり、公開面の破壊的変更なので、
計測できるホストができてから採るべきである。

したがってホストは、`simModule.layers` と**同じ `Effect.provide` の中で**明示的に渡す。

```typescript
// 1. 世界を組む —— roster は sim の他のサービスと同じ 1 回の provide の中で建てる
const world = Layer.merge(simModule.layers, EntityManagerLayer<CreeperFuse>())

// 2. gameplay:entities の中身（mx-gameplay 側。mc-sim は 1 行も書かない）
const roster = yield* entityManagerTag<CreeperFuse>()
const player = yield* PlayerService
const feet   = (yield* player.pose).feetPosition

const blasts = yield* roster.sweep<Explosion>((entity) => {
  if (entity.kind !== CREEPER_KIND) {
    return { transition: UNCHANGED, emit: undefined }        // 触らない = 無コスト
  }
  const senses = { distanceToTargetBlocks: distance(entity.feetPosition, feet) }
  const step   = stepCreeperFuse(entity.behaviour, senses, dt)   // ← mx-gameplay の既存ルール
  return {
    transition: step.fuse === entity.behaviour
      ? UNCHANGED
      : changed({ ...entity, behaviour: step.fuse }),
    emit: step.explosion,
  }
})

// 3. 爆発の発生条件は mx-gameplay。汎用爆風を計画し、ホストが一括適用する
for (const blast of blasts) { /* planExplosion(...) → applyExplosionPlan(plan, commit) */ }

// 4. スポーン: canHostileSpawnAt(candidate) が Spawn を返し、かつ
//    (yield* roster.countOfKind(CREEPER_KIND)) < MAX_HOSTILE_COUNT のときだけ
yield* roster.spawn({ kind: CREEPER_KIND, feetPosition, healthPoints: 20, behaviour: DORMANT_FUSE })

// 5. ドロップ: rollMobDrops(CREEPER_DROPS, kill, rollsFor) → inventory.add(...)
//    そのあと roster.despawn(id)（あるいは同じ sweep の中で DESPAWNED）
```

`mx-gameplay/domain/mob/` は**この配線で 1 行も変わらない。**
`hostile-spawn.ts` のヘッダが「HOW MANY（`MAX_HOSTILE_COUNT = 16` against a live census）は
mc-sim と一緒に到着する」と書いているものが `countOfKind` であり、
`stages/registration.ts` が「this stage grows a loop」と書いているループが `sweep` である。

### 7-6 いま入れていないもの

| 繰り延べ | いまどう見えるか |
| --- | --- |
| `EntityKind` の閉じたロスタ | **開いた**ブランデッド文字列。kernel が `EntityType` を公開する日に別名 1 本の付け替えになる。ここで発明すれば「推測されたロスタ」を 3 度目にやることになり、しかも plan.md §3.11 が Mob の同一性をルール層に置いている以上、見えないリポジトリの代わりに推測することになる |
| 最大体力 / 当たり判定 / 移動速度 | 無い。kind ごとの定数はルール層のもので、表をミラーすれば mc-sim が「クリーパーとは何か」を知る商売に戻る |
| `find` の索引 | 線形のまま（§7-3） |
| ドロップアイテム / 経験値オーブのエンティティ | §5 の表に残っている。台帳自体は kind を選ばないので、`EntityKind('dropped_item')` として**今日でも入る** —— 入っていないのは「落ちたアイテムがどう振る舞うか」がルールだからである |
| `simModule` への同梱 | §7-5 |

## 8. 爆発計画

**mc-physics 0.2.0（mc-kernel 0.5.0）採用に伴う破壊的変更。** `domain/explosion.ts` /
`domain/primed-tnt.ts` は独自実装（xorshift ベースの破壊ハッシュ）を廃止し、
`@nerima-games/mc-physics`（= mc-kernel 実装）への named re-export に置き換わった。
本節は**この新 API を現状として**記述する。旧実装からの非互換点:

- **同一 seed の破壊パターンが変わる**(旧 xorshift ハッシュ → kernel の `Math.sin` ベースの
  ハッシュ)。保存済み seed をリプレイして同一の破壊結果を期待するホスト・fixture は影響を受ける。
- `planExplosion` / `applyExplosionPlan` のジェネリック `<S>`（`ExplosionRequest<S>` /
  `ExplosionCommit<E, R>` 込み）が消え、非ジェネリックになった。
- `applyExplosionPlan` / `applyPrimedTntPlan` の `commit` は
  `Effect.Effect<void, E, R>` を返す契約から `void` を返す**同期関数**に変わった。
  host はもう `yield*` せず、`Ref.modify` などの中で `commit` を直接呼ぶ。
- `PrimedTntState` の判別フィールドは `_tag: 'Primed' | 'Detonated'` から
  `kind: 'primed' | 'detonated'` に変わった（下記 §8.1）。
- `primeTnt` の `fuseSecs` は必須引数から省略可能引数になった（下記 §8.1）。

`domain/explosion.ts` は、爆発の発生条件やブロック種別ごとのゲームルールを持たず、
与えられた読み取り面から破壊対象・エンティティへのダメージ・ノックバックを計画する。

```typescript
type ExplosionBlockReader = (
  position: ExplosionBlockPosition,
) => ExplosionBlock | undefined

type ExplosionLimits = {
  readonly maxVisitedBlocks: number
  readonly maxRaySteps: number
  readonly maxAffectedEntities: number
}

declare const DEFAULT_EXPLOSION_LIMITS: ExplosionLimits

declare const planExplosion: (request: ExplosionRequest) => ExplosionPlan

type ExplosionCommit = (mutation: ExplosionMutation) => void

declare const applyExplosionPlan: (
  plan: ExplosionPlan,
  commit: ExplosionCommit,
) => void
```

`planExplosion` は純粋関数である。同じ seed・snapshot・入力には同じ結果を返し、距離減衰、
ブロック耐性、遮蔽を計算する。reader が `undefined` を返すセルは未ロード境界として扱い、
その先へ ray を進めず、破壊対象にも含めない。

計算量は `maxVisitedBlocks`・`maxRaySteps`・`maxAffectedEntities` で制限できる。
上限に達した計画は `truncated: true` を返すため、ホストは適用・延期・破棄を明示的に選べる。

計画と適用は分離されている。`applyExplosionPlan` は完成済みの `ExplosionMutation` を
`commit` に **1 回だけ、同期的に**渡し、`ChunkStore` や entity roster を個別には変更しない。
原子性とロールバックは具体的な保存先を所有するホストの責務であり、host は自分の
`Ref.modify` や Effect の中から `commit` を直接呼ぶ（`Effect` の `E` / `R` はもう関与しない）。

**`commit` は throw しないこと。** 型付き失敗チャネル（旧 `Effect` の `E`）は無くなったため、
`commit` の内部で失敗しうる処理を行う呼び出し側は、その呼び出しを自前で `try`/`catch` すること。

### 8.1 Primed TNT

`domain/primed-tnt.ts` も同じく `@nerima-games/mc-physics`（= mc-kernel）への re-export である。
host 所有の fuse snapshot を 1 要求あたり最大 `MAX_TNT_FUSE_ADVANCE_SECS`（10）秒だけ進める。

```typescript
type PrimedTntState =
  | { readonly kind: 'primed'; readonly remainingFuseSecs: number }
  | { readonly kind: 'detonated' }

declare const DEFAULT_TNT_FUSE_SECS = 4

declare const MAX_TNT_FUSE_ADVANCE_SECS = 10

declare const primeTnt: (fuseSecs?: number) => PrimedTntState

declare const planPrimedTnt: (request: PrimedTntRequest) => PrimedTntPlan

type PrimedTntCommit = (mutation: PrimedTntMutation) => void

declare const applyPrimedTntPlan: (
  plan: PrimedTntPlan,
  commit: PrimedTntCommit,
) => void
```

`primeTnt` の `fuseSecs` は省略可能で、省略時は `DEFAULT_TNT_FUSE_SECS`（4 秒）。非有限な値は
0 に丸める（`Number.isFinite` で弾き、負値は 0 にクランプ）。

`planPrimedTnt` は fuse が尽きた呼び出しでだけ既存の `planExplosion` を呼び、終端状態
（`kind: 'detonated'`）への再入力から二度目の爆発を生成しない。上限を超えた時間は
`deferredSecs` として返す。

`applyPrimedTntPlan` は `expected` snapshot、次の fuse 状態、任意の爆発 mutation を
一つの `PrimedTntMutation` に束ね、`commit` を **1 回だけ、同期的に**呼ぶ。`explosion`
フィールドは、その呼び出しで実際に起爆した（`plan.explosion` が存在する）ときだけ含まれる。
host は同じ更新単位（`Ref.modify` など）の中で `expected` を比較してから、
TNT entity の更新または除去と block/entity effects を一括適用する。

**`commit` は throw しないこと。** §8 と同じ理由で型付き失敗チャネルは無い。失敗しうる処理は
呼び出し側が `try`/`catch` する。

## 9. Projectile

**破壊的変更。** `domain/projectile.ts` は矢専用だった API（`launchArrow` / `stepArrow` /
`Arrow` / `ArrowLaunch`）を撤去し、`@nerima-games/mc-physics` の汎用 projectile エンジンへの
re-export に置き換わった。旧シグネチャは存在しないため、呼び出し側はコンパイルエラーになる。

| 旧（撤去） | 新 |
| --- | --- |
| `launchArrow(launch)` | `launchProjectile(launch)` |
| `stepArrow(state, dt, world)` | `stepProjectile(state, dt, world, ARROW_PROFILE)` |
| `Arrow` | `Projectile` |
| `ArrowLaunch` | `ProjectileLaunch` |
| `ProjectileStep.arrow` | `ProjectileStep.projectile`（フィールド名も変更） |

```typescript
type ProjectileProfile = {
  readonly gravity: number
  readonly airDrag: number
  readonly waterDrag: number
  readonly maxLifetimeSeconds: number
  readonly shooterGraceSeconds: number
}

declare const ARROW_PROFILE: ProjectileProfile
declare const SNOWBALL_PROFILE: ProjectileProfile
declare const EGG_PROFILE: ProjectileProfile
declare const TRIDENT_PROFILE: ProjectileProfile

type ProjectileLaunch = {
  readonly position: Position
  readonly yawRadians: number
  readonly pitchRadians: number
  readonly speed: number
  readonly shooterId?: string
}

type Projectile =
  | { readonly position: Position; readonly velocity: Position; readonly ageSeconds: number; readonly shooterId?: string; readonly state: 'flying' }
  | { /* 同上のフィールド */ readonly state: 'stuck'; readonly hit: ProjectileHit; readonly recoverable: boolean }
  | { /* 同上のフィールド */ readonly state: 'despawned'; readonly reason: 'invalid' | 'lifetime' | 'world' | 'entity-hit' }

type ProjectileStep = { readonly projectile: Projectile; readonly hit?: ProjectileHit }

type ProjectileEntity = { readonly id: string; readonly bounds: AABB }

declare const launchProjectile: (launch: ProjectileLaunch) => Projectile
declare const stepProjectile: (
  state: Projectile,
  dt: number,
  world: ProjectileWorld,
  profile: ProjectileProfile,
) => ProjectileStep
```

`launchProjectile` の運動学はプロファイルに依存しない —— 初速は yaw/pitch/speed だけから決まる。
プロファイル（重力・空気抵抗・水中抵抗・最大寿命・射手の無敵猶予）は `stepProjectile` の呼び出しごとに
渡すので、同じ関数で矢・雪玉・卵・トライデントを表現できる。`ARROW_PROFILE` は
`@nerima-games/mc-kernel` の `ARROW_GRAVITY` / `ARROW_AIR_DRAG` / `ARROW_WATER_DRAG` /
`ARROW_MAX_LIFETIME_SECONDS` / `ARROW_SHOOTER_GRACE_SECONDS` とビット単位で一致することを
`test/projectile.test.ts` が固定する。

`domain/projectile.ts` はこれとは別に、mc-sim 自身が持つ `raycastArrowBlock` を今回の
移行でも変えずに提供する。DDA の詳細を隠して、始点・終点・「このブロックは遮蔽するか」の
述語から最初の遮蔽ボクセルを解決するユーティリティである。

```typescript
type ArrowBlockImpact = { readonly distance: number; readonly point: Position }
type IsArrowBlocker = (x: number, y: number, z: number) => boolean
declare const raycastArrowBlock: (
  from: Position,
  to: Position,
  isBlocking: IsArrowBlocker,
) => Option.Option<ArrowBlockImpact>
```
