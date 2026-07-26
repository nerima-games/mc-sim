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
  readonly timeOfDay: Effect.Effect<number>          // [0, 1)
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

## 5. まだ設計していない公開API

plan.md §3.8 の責務のうち、界面をまだ書いていないもの。**着手前に本書へ追記すること。**

| 領域 | 参照実装 | 主な消費者 |
| --- | --- | --- |
| `EntityManager` | `packages/entity/application/`（mob/ 含む） | mx-gameplay / mx-multiplayer / mc-render |
| 体力 / 空腹 / XP | `health-service.ts` / `hunger-service.ts` / `xp-service.ts` | mx-gameplay / mx-ui |
| 実績 / 統計 | `achievement-service.ts` / `statistics-service.ts` | mx-ui |
| 設定状態 | `packages/game/application/settings-service.ts` (107) + `.config.ts` (70) + `.schema.ts` (79) | mx-ui / mc-render |
| チャンクダーティ通知 | `packages/world` 側の dirty フラグ + `packages/app` の同期 stage | **mc-render**（`WorldRenderer` が購読） |
| ドロップ / 経験値オーブ | `dropped-item-service.ts` / `dropped-xp-orb-service.ts` | mx-gameplay / mc-render |
| かまど / チェスト / 装備 / レシピ | `packages/inventory/application/` の各 service | mx-ui / mx-gameplay |
| `GameModule` の実体 | — | mc-compose |

チャンクダーティ通知は**最優先で設計すべき**である。mc-render の `WorldRenderer` は
「chunk ダーティ購読 → メッシュ更新」が主機能であり（plan.md §3.9）、この界面が無いと
mc-render が着手できない。

## 6. APIロック

plan.md §6 Step 0-3 / §9 未決。ツールは未選定（api-extractor 相当の Effect-TS 互換手段）。
決まるまでの暫定運用として `test/public-api.test.ts` 相当（公開シンボルの一覧を assert する
テスト）を置く手はあるが、現時点では未実装。**publish 開始（plan.md §6 Step 3）までに必須。**
