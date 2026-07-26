# 設計注意

plan.md §3.8「設計注意（参照実装の実測知見）」の全項目を、参照実装の証跡（file:line）付きで展開し、
**それぞれを「書くべき回帰テスト」として名前で表現**したもの。

パスは `takeokunn/ts-minecraft` リポジトリルート相対。
「状態」列: **済** = 本リポジトリに回帰テストがある / **要** = 本実装時に必須 / **将来** = 該当機能の実装時に。

| ID | 設計注意 | 状態 |
| --- | --- | --- |
| DN-01 | カメラ所有権の反転を元に戻さない | 済 |
| DN-02 | ゲームループ・自動保存は `forkDaemon` + 明示 `stop()` + 再入可能 | 済 |
| DN-03 | deltaTime クランプは `min(max(0.001, raw), 0.05)` | 済 |
| DN-04 | `setDayLength → setTimeOfDay` の順 | 済 |
| DN-05 | 自動保存は `Schedule.spaced`（`fixed` ではない） | 済 |
| DN-06 | ブランデッドコンストラクタ必須 | 済（部分） |
| DN-07 | `Ref.modify` で TOCTOU 回避 | 済 |
| DN-08 | `Effect.catchAllCause` で defect をログに出す | 済 |
| DN-09 | アプリスコープのシングルトンは再入可能な初期化 | 済（部分） |
| DN-10 | 足元原点 vs AABB中心の Y 規約を型で区別 | 要 |
| DN-11 | 名指しブロックID判定をしない（能力フラグ参照） | 要 |
| DN-12 | `Date.now()` を使わない | 済 |

---

## DN-01 カメラ所有権の反転を元に戻さない

### plan.md §3.8

> **カメラ所有権**: 参照実装はTHREEカメラが正でシミュレーションが描画から視線を読む逆転構造だった
> （「camera.position を読むな matrixWorld を使え」という慢性gotchaの根源）。
> 新実装は sim が姿勢を所有し、THREEカメラはミラー

### 参照実装の証跡

姿勢の回転成分は実はシミュレーション側にあった:

```
packages/entity/application/camera-state.ts        （THREE import 無し。yaw/pitch を保持）
packages/entity/domain/camera-state.ts:12-13       PITCH_LIMIT = Math.PI / 2 - 0.01
```

描画 stage がそれを THREE カメラへ書く:

```
packages/app/application/frame/stages/camera-stage.ts:63-67
  camera.rotation.set(pitch, yaw, 0, 'YXZ')
```

**そして 13 箇所がそれを読み戻していた**（すべてシミュレーション側のロジック）:

```
packages/app/application/frame/stages/attack-targeting.ts:18       camera.getWorldDirection(scratchCameraDirection)
packages/app/application/frame/stages/attack-targeting.ts:24       const rayOrigin = camera.position
packages/app/application/frame/stages/entity-update-stage.ts:182   deps.camera.position
packages/app/application/frame/stages/entity-update-stage.ts:189   （Mob AI が消費）
packages/app/application/frame/stages/interaction-bow-handler.ts:105,123-124
packages/app/application/frame/stages/interaction-melee-handler.ts:142,213
packages/app/application/frame/stages/interaction-right-click-handler.ts:73
packages/app/application/frame/stages/interaction-stage-underwater.ts:37,42-44
```

慢性 gotcha の記録:

```
packages/app/application/main/qa-api-visual.ts:17-19
  // World position via matrixWorld — the frame composes the camera pose
  // into matrixWorld directly, so `.position` can be stale (or the origin).
```

**その stale がいつ起きるか**（これが根本原因）:

```
packages/app/application/frame/stages/render-stage.ts:41-48    攻撃スイングのため生カメラを
                                                                translateX / translateY / rotateZ で動かす
packages/app/application/frame/stages/render-stage.ts:98-100   Effect.ensuring で復元
```

この 2 点の間、`.position` と `matrixWorld` は食い違う。その窓でカメラを読んだ
シミュレーションコードは、プレイヤーの姿勢ではなく**武器バンプ後の姿勢**を得る。

### 新設計

- `PlayerService` が `PlayerPose` を持ち、`cameraPose` が `CameraPoseSnapshot` を発行する唯一の口。
- mc-render はミラーするだけ。書き戻す API は**存在しない**。
- 演出（攻撃スイングのバンプ等）はミラー後の姿勢の上に適用し、mc-sim には戻さない。
- 目線オフセット `1.62` は **mc-sim が加算**する。描画側が加算すると
  「狙っているブロック」と「ハイライトされているブロック」が二重実装になる。
- 構造的保証: `mc-render → mc-sim` があるため逆エッジは循環であり `pnpm check:deps` が落とす。

### 書くべき回帰テスト

| テスト名 | 場所 | 内容 |
| --- | --- | --- |
| `forwardVector — the sanctioned replacement for camera.getWorldDirection()` | `test/camera-pose.test.ts` | 視線ベクトルが mc-sim 側だけで計算できる（yaw 0 = -Z、yaw π/2 = -X、pitch 正 = 上、常に単位長） |
| `applies the eye offset HERE, not in the renderer` | `test/camera-pose.test.ts` | `cameraPoseOf` が feet + 1.62 を返す |
| `stops just short of vertical, so yaw never becomes unrecoverable` | `test/camera-pose.test.ts` | pitch クランプが ±(π/2 − 0.01) |
| `mc-render depends on mc-sim, which is what makes the reverse edge a cycle` | `test/check-dependency-whitelist.test.ts` | 依存グラフ上、逆エッジが循環になること |
| **（要追加）** `no THREE import reaches the simulation` | 本実装時 | `tsconfig.base.json` の `lib` に DOM が無いこと + `three` が `dependencies` に無いことを assert |
| **（要追加）** `a render-side weapon bob does not perturb the pose the simulation reports` | mc-render 側 | ミラー先を動かしても `cameraPose` が変わらない |

---

## DN-02 ゲームループ・自動保存は `forkDaemon` + 明示 `stop()` + 再入可能

### plan.md §3.8

> **ゲームループ・自動保存は `forkDaemon`**（スコープ非依存）+ 明示 `stop()`。
> 参照実装では2周目ワールドのデッドロック/やり残しfiberが最大級のバグ源だった。
> アプリスコープのシングルトンは**再入可能な初期化**を最初から

### 参照実装の証跡

```
packages/game/application/game-loop.ts:133   const fiber = yield* Effect.forkDaemon(processFrames)
packages/game/application/game-loop.ts:228   const fiber = yield* Effect.forkDaemon(maintenanceLoop)
```

再入可能化のコメント（後付けであることが読み取れる）:

```
packages/game/application/game-loop.ts:141-148
  // Re-entrant: this service is an app-scoped singleton reused across worlds,
  // and its fibers are daemons that outlive session teardown. A best-effort
  // quit stop() can be cut off by its timeout, so rather than fail
  // "already running", tear down any lingering processing fiber and start
  // fresh ...
  // interruptFork (not interrupt): a previous session's fiber can be slow to
  // wind down after its scope closed — awaiting its exit here deadlocked the
  // next world's startup behind the loading screen.

packages/game/application/game-loop.ts:198-201
  // interruptFork (not interrupt): a torn-down session's maintenance fiber can
  // take arbitrarily long to acknowledge interruption, and awaiting it here
  // left the second world stuck on the loading screen forever
  // (save & quit -> load hang).
```

同種の後付けが他サービスにもある:

```
packages/entity/application/player-service.ts:15-18
  // Clears every registered player. This service is an app-scoped singleton
  // reused across worlds, so a new session must reset it before re-creating
  // its player — otherwise create() fails "already exists".

packages/game/application/game-state-service.ts:87-92   （同種の reset）
```

### 新設計

1. `Effect.forkDaemon`（`fork` ではない）。
2. `stop` は **detach してから interrupt**。中断された `stop` が半端な状態を残さない。
3. `Fiber.interruptFork`（`interrupt` ではない）。遅い fiber を待たない。
4. `start` は**再入可能**。「already running」で失敗しない。
5. **世代ごとに状態を新規作成**（キュー・フレームカウンタ・前回時刻）。取り残された旧 fiber は
   自分の detach 済み状態に書くだけで、新しい世界を壊せない。

### 書くべき回帰テスト

| テスト名 | 場所 | 内容 |
| --- | --- | --- |
| `REGRESSION: a second start() succeeds — this is the second-world-load bug` | `test/game-loop.test.ts` | stop → start が通り、旧ハンドラが呼ばれない |
| `REGRESSION: start() while ALREADY running replaces the loop instead of failing` | `test/game-loop.test.ts` | 停止せずに start してもエラーにならない |
| `stop() is idempotent, so a best-effort teardown may run twice` | `test/game-loop.test.ts` | |
| `stop() halts processing, and submitting afterwards is a silent no-op` | `test/game-loop.test.ts` | |
| `each Layer build is an independent world, which is what re-entrancy needs` | `test/scenario.test.ts` | 2 つの世界が干渉しない + `reset` が効く |
| **（要追加）** `a second world load completes within N frames of the first` | 本実装時 | デッドロックしないことを時間で assert |
| **（要追加）** `no fiber survives world teardown` | 本実装時 | `Fiber.roots` 相当で取り残し fiber を数える |

---

## DN-03 deltaTime クランプは `min(max(0.001, raw), 0.05)`

### 参照実装の証跡

```
packages/game/application/game-loop.ts:116-119
  const rawDelta = lastTimestamp === 0
    ? FIRST_FRAME_DELTA_SECS
    : (timestamp - lastTimestamp) / 1000
  const deltaTime = DeltaTimeSecs.make(Math.min(Math.max(0.001, rawDelta), 0.05))

packages/core/domain/constants.ts:9
  export const FIRST_FRAME_DELTA_SECS: DeltaTimeSecs = DeltaTimeSecs.make(0.016)
```

plan.md は §3.4（mc-physics）でも同じ制約を挙げている。**両リポジトリで同値を維持すること。**
ずれると「クランプしたつもりが片方だけ」になり、症状が物理側にだけ出る。

### 各境界の理由

| 境界 | 値 | 理由 |
| --- | --- | --- |
| 上限 | 0.05（= 20 fps 下限） | タブ復帰時の巨大 delta を 1 ステップで積分すると、Euler + AABB がコライダを跨いで「壁抜け」する。クランプすると**遅くなるだけで間違わない** |
| 下限 | 0.001 | 240 Hz や二重スケジュールで実際にこの桁の delta が来る。0 だと率の計算がゼロ除算 |
| 初回 | 0.016 | 前フレームが無いので差が計算できない。60 Hz 1 フレーム相当の作り話だが、再現可能で有界。0 にすると初回だけ挙動が変わり、シナリオテストの中に隠れる |

### 新設計での差分

- `NaN` を `FIRST_FRAME_DELTA_SECS` に落とす。`Math.min` / `Math.max` は NaN を伝播するため、
  参照実装の式は NaN をそのまま通す。NaN 位置は不可視で、数千フレーム後に発症する。
- 「前フレーム無し」の番兵を `lastTimestamp === 0` ではなく `undefined` にする。
  単調クロックは 0 を返してよいので、参照実装では番兵と正当な値が区別できない。

### 書くべき回帰テスト

`test/frame-timing.test.ts`。境界値は**定数からの算術ではなくリテラルで** assert する
（両辺が同じ定数を読むテストは、定数を「整理」した瞬間に緑のまま壁抜けが復活する）。

| テスト名 | 内容 |
| --- | --- |
| `the three constants are the reference implementation values, literally` | 0.001 / 0.05 / 0.016 |
| `clamps a tab-refocus jump to 0.05 — the simulation runs slow, never wrong` | 30 秒 → 0.05、`+Infinity` → 0.05 |
| `clamps a denormal or negative delta up to 0.001, so no rate divides by zero` | 0 / 1e-9 / 負 / `-Infinity` |
| `leaves the boundary values themselves alone` | 0.001 と 0.05 は素通し |
| `maps NaN to the first-frame delta rather than poisoning every later position` | |
| `the result is always inside the clamp range, for any input at all` | 13 入力 |
| `treats a monotonic reading of exactly 0 as a real timestamp, not as "no frame yet"` | 番兵の差分 |

---

## DN-04 `setDayLength → setTimeOfDay` の順

### plan.md §3.8

> `TimeService`: `setDayLength()` が tick 分母を変えるため、必ず `setDayLength → setTimeOfDay` の順

### 参照実装の証跡

```
packages/game/application/time-service-state.ts:32-33
  export const getTimeOfDayFromState = (state) =>
    (state.ticks % state.dayLengthTicks) / state.dayLengthTicks

packages/game/application/time-service-state.ts:45-48
  setDayLengthOnState = (seconds) => (state) => ({ ...state, dayLengthTicks: clamp(seconds) * 60 })
  （ticks はそのまま = 分母だけ変わる = 時刻が動く）

packages/game/application/time-service-state.ts:50-53
  setTimeOfDayOnState = (fraction) => (state) => ({ ...state, ticks: clamp(fraction) * state.dayLengthTicks })
  （その時点の分母を掛ける = 分母が正しくないと結果も正しくない）
```

順序を守っている唯一の呼び出し:

```
packages/app/application/main/session-bootstrap-world-presentation-time.ts:26-27
  yield* timeService.setDayLength(...)
  yield* timeService.setTimeOfDay(...)
```

順序を壊している呼び出し（**現存するバグ**）:

```
packages/app/application/frame/stages/input-stage-runtime.ts:17-30
  設定変更時に setDayLength 単独を呼ぶ → 時刻が副作用で動く
```

### なぜ表現を直さないのか

正規化した小数（0..1）を保持すれば 2 つの操作は可換になり、この危険は消える。
同時に `getMoonPhase = floor(ticks / dayLengthTicks) % 8` も消える。
**絶対 tick カウンタが正しい表現であり、順序制約はその対価**である。
対価は「覚えておく」ではなく「名前を付けて回帰テストで固定する」で払う。

### 新設計での差分

`configureDay(dayLengthSeconds, timeOfDayFraction)` を用意し、順序制約を
「関数が 1 個ある」に還元する。個別 setter も残す（設定変更時に片方だけ必要な場合が実在する）
が、両方やりたい呼び出し側が順序を決める立場に立たないようにする。

### 書くべき回帰テスト

`test/time-of-day.test.ts` の `describe('REGRESSION: setDayLength must run BEFORE setTimeOfDay')`。

| テスト名 | 内容 |
| --- | --- |
| `correct order — the requested time of day is the time of day you get` | |
| `wrong order — setDayLength afterwards silently DOUBLES the time of day` | 0.30 が 0.60 になる |
| `the two orders disagree — which is the whole reason the rule exists` | |
| `setDayLengthThenTimeOfDay is the correct order, so callers cannot get it wrong` | |
| `setDayLength ALONE is still legal, and its side effect on time of day is real` | 単独呼びの副作用を assert として明文化 |
| `keeps the ABSOLUTE tick counter, so the moon phase advances across days` | 正規化してはいけない理由 |
| `a fresh world starts in daylight, not at midnight with hostile mobs` | `{ ticks: 7200, dayLengthTicks: 24000 }` |

---

## DN-05 自動保存は `Schedule.spaced`（`fixed` ではない）

### plan.md §3.8

> 自動保存は `Schedule.spaced`（fixed はタブ復帰時にバースト）

### 参照実装の証跡

```
packages/app/application/main/session-autosave.ts:62-66
  Effect.forkDaemon(Effect.repeat(performAutoSaveTick(...), Schedule.spaced(interval)))
packages/app/application/main/session-autosave.ts:54
  export const AUTO_SAVE_INTERVAL = Duration.seconds(5)
```

参照実装は `Schedule.fixed` を**どこでも使っていない**。周期処理はすべて `spaced`:

```
packages/app/application/main/session-runtime-multiplayer-chat.ts:55
packages/app/application/main/session-runtime-overlays.ts:161, 215, 228
packages/rendering/presentation/perf-hud-counters.ts:30
packages/presentation/hud/debug-overlay-runtime.ts:101
packages/presentation/menu/pause-menu.ts:204
```

### 違いの実体

`fixed(d)` は絶対グリッド（0, d, 2d, ...）で発火する。中断された分は再開時にまとめて due になり、
Effect はそれらを連続発火して追いつこうとする。タブを 2 分放置して戻ると、
IndexedDB への書き込みが 24 回連続で走り、プレイヤーが画面を見た瞬間に数秒固まる。

`spaced(d)` は**前回の実行終了から** d を測る。取りこぼしは取りこぼしたまま。

### 併せて必須: tick は total、catch は repeat の内側

```
packages/app/application/main/session-autosave.ts:20-33（コメント全文が根拠）
  CRITICAL: the catchAllCause MUST stay INSIDE this tick, not outside the repeat.
  `Effect.repeat(effect, schedule)` re-runs `effect` only while it succeeds — if a
  failure escaped the repeated effect, the repetition would stop and autosave would
  silently die after the first transient error, losing every later edit on a crash.
  ...
  `catchAllCause` (not `catchAll`) is deliberate: it catches EVERYTHING — typed
  failures, AND defects (a thrown exception inside a save surfaces as `Cause.Die`,
  which `catchAll` would miss and let escape, killing the daemon).
```

### 書くべき回帰テスト

`test/autosave.test.ts`。

| テスト名 | 内容 |
| --- | --- |
| `the interval is measured from the END of the previous run` | `TestClock` で 100 ms 間隔 + 40 ms の tick → 1000 ms で 7 回 |
| `Schedule.fixed would have produced a different, larger count` | 同条件で 10 回。**対比が無いと最初のテストは意味を持たない** |
| `recovers from a TYPED failure and stays total` | |
| `recovers from a DEFECT too — this is why it is catchAllCause, not catchAll` | |
| `a DEFECT in the status reporter cannot abort persistence` | |
| `keeps saving after a failing tick, which fixed-outside-repeat would not` | daemon 経由 |
| `the default interval is the reference implementation value` | 5000 ms |

---

## DN-06 ブランデッドコンストラクタ必須

### plan.md §3.8 / §5.1-3

参照実装は `DeltaTimeSecs.make(...)`（`Schema.brand`）を使う
（`packages/game/application/game-loop.ts:119`、`packages/core/domain/constants.ts:9`）。

新実装は mc-kernel が `Brand.refined`（`effect` の `Brand`）で **検証つき**ブランドを定義する
（`mc-kernel/domain/quantities.ts`）。素の `number` を通す道は明示的な cast だけ。

### 適用範囲（本リポジトリ）

| 型 | 用途 | 注意 |
| --- | --- | --- |
| `DeltaTimeSecs` | フレーム delta | **入力はブランドしない**。`clampFrameDelta(raw: number)` はレンジ外を受けるのが仕事であり、ブランドすると境界で throw に化けてクランプの意味が消える |
| `MonotonicTimeSecs` | クロック読み値・スナップショット時刻 | |
| `StackCount` | スロット内個数 | **`addItem(count: number)` はブランドしない**。1 スタックを超える投入（クリエイティブ give、大量ドロップ）が正当であり、それを複数スロットに配るのがこの関数の仕事 |

**「境界でブランドする」と「内部でブランドを持つ」は別**である。上の 2 つの例外は、
ブランドを付けると関数の存在理由が消えるケース。

### 書くべき回帰テスト

| テスト名 | 場所 | 状態 |
| --- | --- | --- |
| `rejects non-positive and non-integer counts without corrupting anything` | `test/inventory.test.ts` | 済 |
| **（要追加）** `every branded constructor rejects its out-of-range value` | mc-kernel 側 | mc-kernel の `test/branded-types.test.ts` が担当 |

---

## DN-07 `Ref.modify` で TOCTOU 回避

### 参照実装の証跡

```
packages/entity/application/player-service.ts:22-29
  存在チェックと挿入を 1 ステップに融合（Ref.modify で [alreadyExists, nextMap] を返す）
packages/entity/application/player-service.ts:31-40
  updatePosition も同型
packages/entity/application/health-service.ts:68-86
  ダメージ遷移で `justDied` を同じステップ内で計算し、死亡シグナルが 1 回だけ出るようにしている
```

`Ref.get` → 判断 → `Ref.set` に割ると、その間に別 fiber（自動保存 daemon、ネットワーク
メッセージハンドラ、並行 stage）が入り、片方の書き込みが黙って消える。

### クラフトがこの規約を決めた場所

`craft` が独立した `CraftingService` ではなく `InventoryService` にあるのは、この項目のためである。
原子性は「1 つの Ref」でしか成立しない。独自の Ref を持つサービスは、このインベントリを
読み → 判断し → 書き戻すしかなく、その窓がまさに TOCTOU になる。
しかも積荷が悪い: 材料の減算と成果の加算は**2 つの書き込み**で、どちらを落としても
アイテムが増えるか消えるかする。判断ごと `Ref.modify` の中に入れてあり、
失敗パスは受け取ったインベントリを**参照ごと**返すので、中途半端な適用は表現できない
（[public-api.md](./public-api.md) §4.1-5、`domain/crafting.ts`）。

### 書くべき回帰テスト

| テスト名 | 場所 | 内容 |
| --- | --- | --- |
| `REGRESSION: concurrent adds all land — Ref.modify, not get-then-set` | `test/inventory.test.ts` | 50 fiber で 1 個ずつ add → 合計 50 |
| `concurrent removes never take more than exists` | `test/inventory.test.ts` | 在庫 10 に対し 20 fiber が 1 個ずつ remove → 合計 10 |
| `REGRESSION: concurrent crafts cannot overdraw — Ref.modify, not get-then-set` | `test/crafting.test.ts` | 板材 20（＝棒 10 回分）に 50 fiber → 成功はちょうど 10 |
| **（要追加）** `a death signal fires exactly once under concurrent damage` | 体力実装時 | 参照実装 health-service.ts:68-86 相当 |

---

## DN-08 `Effect.catchAllCause` で defect をログに出す

### 参照実装の証跡

```
packages/game/application/game-loop.ts:123-125
  Effect.catchAllCause((cause) => Effect.logError(`Frame error: ${Cause.pretty(cause)}`))
packages/app/application/main/session-autosave.ts:46-50
```

`catchAll` は typed failure しか捕まえない。stage の中で例外を throw すると `Cause.Die` になり、
`catchAll` はそれを見逃してループごと落とす。`Cause.pretty` を通さないとスタックが残らない。

### 書くべき回帰テスト

| テスト名 | 場所 |
| --- | --- |
| `a handler DEFECT is logged and the loop keeps running` | `test/game-loop.test.ts` |
| `recovers from a DEFECT too — this is why it is catchAllCause, not catchAll` | `test/autosave.test.ts` |

---

## DN-09 アプリスコープのシングルトンは再入可能な初期化

DN-02 と表裏。参照実装は `reset()` を**後から**足している:

```
packages/entity/application/player-service.ts:15-18
packages/game/application/game-state-service.ts:87-92
```

新実装の方針は 2 段構え。

1. **そもそもシングルトンにしない。** `makeXxxService()` を公開し、`Layer` はその上の薄い包み。
   複数ワールドを 1 プロセスで動かせる（mc-playground-kit がプレビューを 2 枚並べる）。
2. それでもアプリスコープになるものには `reset` を**最初から**置く。

### 書くべき回帰テスト

| テスト名 | 場所 |
| --- | --- |
| `each Layer build is an independent world, which is what re-entrancy needs` | `test/scenario.test.ts` |
| **（要追加）** `every app-scoped service exposes reset, and reset returns it to its initial snapshot` | 本実装時。サービスを増やすたびに追加 |

---

## DN-10 足元原点 vs AABB中心の Y 規約を型で区別

plan.md §3.4（mc-physics）の知見だが、**座標を持つのは mc-sim** なので本リポジトリの責務。

> 「物が浮く」バグ類は例外なく**足元原点 vs AABB中心のY規約不一致**が原因。座標規約を型で区別する
> ブロックは `[y, y+1]` を占有。スポーンと物理平面は `surfaceY+1` 基準

現状は `PlayerPose.feetPosition` という**フィールド名**で規約を運んでいる（呼び出し側で誤りが読める）。
本実装では mc-kernel 側でブランド型に格上げすることを検討する。

### 書くべき回帰テスト（要）

| テスト名 | 内容 |
| --- | --- |
| `a spawn at surfaceY+1 leaves the player standing on the block, not inside it` | |
| `feet origin and AABB centre are not interchangeable` | 型レベルで弾けること、または実行時に検出できること |
| `ground-clamp runs AFTER step(), not before` | plan.md §3.4。順序を崩すと物が浮く |

---

## DN-11 名指しブロックID判定をしない

plan.md §3.1 / §5.1-1。参照実装は `blockTypeToIndex('SAND')` 式の名指しが
**51ファイル229箇所**（plan.md の計数）に散った。mc-kernel の
`docs/capability-flag-audit.md` は別計数で **比較文脈 192 箇所 / 61 ファイル**、
membership テーブル約 30 定義 / 28 ファイル、和集合 78 ファイルと実測している。

mc-sim にブロック挙動の判断は**無い**（すべて能力フラグ参照か、mx-gameplay の責務）が、
インベントリのスタック上限やアイテム分類で同じ罠に入りうる。

### レシピ表はこの規則の**例外ではなく**、規則が区別している側である

`domain/recipe.ts` の `STARTER_RECIPES` には `'OAK_PLANKS'` のようなアイテム ID リテラルが並ぶ。
これは**データ**であって挙動の分岐ではない。同ファイルの一致判定は `Ingredient` と
グリッドのセルを比較するだけで、`=== 'STONE'` 型の名指し分岐を 1 つも持たない。
DN-11 が禁じているのは後者である。

mc-kernel が `ItemType` を公開したら、この表のリテラルはリテラル union のメンバになり、
綴りを間違えた行は**型検査で落ちる**。いま `ItemId = string` なので落ちないという事実は、
表を書かない理由ではなく `ItemType` を早く出す理由である。

### 書くべき回帰テスト（要）

| テスト名 | 内容 |
| --- | --- |
| `no behavioural branch names a block or item literal` | ソースを走査して `=== 'STONE'` 相当が無いことを assert。`scripts/check-dependency-whitelist.ts` と同じ機構で書ける |

---

## DN-12 `Date.now()` を使わない

plan.md §4.3 / §5.1-3。時刻はすべて注入された Clock Port から取る。

強制は `scripts/check-dependency-whitelist.ts` の `findBannedTimeSources`
（`Date.now()` / `new Date()` / `performance.now()` の 3 つ）。
**oxlint.json ではない** — oxlint 0.12 は `no-restricted-syntax` も
`no-restricted-properties` も実装しておらず、`no-restricted-globals` は一覧に出るが実装されていない
（mc-kernel で 0.12.0 に対し実測確認済み。3 ルールすべて設定しても診断 0 件）。
oxlint が該当ルールを実装したら oxlint.json へ移し、スクリプト側の time-source 節を消す。

Clock Port の実装アダプタだけは実クロックを読む必要があるため、
その行に `mc-kernel-allow-time-source` コメントを付けると除外される。

### 書くべき回帰テスト

| テスト名 | 場所 |
| --- | --- |
| `catches all three raw clock reads, with line numbers` | `test/check-dependency-whitelist.test.ts` |
| `ignores the same text inside a comment or a string` | 同上 |
| `the escape hatch exempts exactly the line that carries it` | 同上 |
| `is reproducible: the same script twice produces byte-identical state` | `test/scenario.test.ts` |
