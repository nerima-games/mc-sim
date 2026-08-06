# テスト / 検証

## 1. plan.md が要求する検証（§3.8）

> **検証**: Node決定論シナリオテスト（「スポーン→採掘→インベントリをassert」を高速実行。
> クロックPortでfast-forward）+ **内蔵障害物コースプレビュー（歩く/泳ぐ/跳ぶ/スニークを操作確認）**

つまり 2 本立てである。

| 検証 | 何を保証するか | 状態 |
| --- | --- | --- |
| Node 決定論シナリオテスト | ロジックが正しいこと。CI で高速に回る | 実装済（`test/scenario.test.ts`） |
| 内蔵プレビュー | **人間が操作して確かめられること**。テストが見ない部分 | 実装済（[`apps/preview-sim/`](../apps/preview-sim/README.md)） |
| ── うち一人称の障害物コース | 歩く / 泳ぐ / 跳ぶ / スニークの操作確認 | **作れない。§2.1 を見ること** |

## 2. 完了条件（plan.md §6 Step 2）

> 各リポジトリの完了条件: ユニット/シナリオテスト green + **内蔵プレビューが操作可能**

**両方**が条件である。テストが緑でもプレビューが動かなければ完了ではない。

プレビューは `apps/preview-<name>/` に置く。モジュール契約（`GameModule`）には含めない
（plan.md §4.1 末尾）。本リポジトリのそれは [`apps/preview-sim/`](../apps/preview-sim/README.md)
であり、`pnpm preview` で起動する。`pnpm verify` には入らないが、`pnpm typecheck`
（`tsconfig.preview.json`）と `pnpm lint` と `pnpm check:deps` の対象には入っている。

### 2.1 障害物コースが作れない理由 —— 待っているのは kit ではない

本書の初版は「障害物コースは描画と入力を要するので mc-render / mc-playground-kit の
完成後にしか作れない」と書いていた。**依存の話は正しく、結論は間違っていた。**

**mc-sim は移動を所有していない。** `application/player-service.ts:20-39` の
`PlayerServiceApi` はこれで全部である:

```
pose · look · moveTo · cameraPose · restore · reset
```

速度が無い。加速度が無い。接地フラグが無い。しゃがみ状態が無い。浮力が無い。
コライダーが無い。ステップハイトが無い。`moveTo` は足元座標を書き込むだけで、
**何もそれに反対しない**。

したがって今日 mc-sim の上に一人称コースを載せると、プレイヤーは障害物を
**すり抜ける**。示せるのは「レンダラがミラーするポーズはスクリプトが書いたポーズ」
という一点だけで、それは `test/scenario.test.ts` にカメラを付けたものである。
歩く / 泳ぐ / 跳ぶ / スニークは**動詞**であり、plan.md §2.3-1 により体験層
（mc-physics / mx-gameplay）のものである。**kit ができても変わらない。**

`pnpm preview --scenario obstacle-course` はコースをテレポートスクリプトとして
実際に走らせる。何があって何が無いかを目で見るためである。

### 2.2 代わりに何を見せているか

mc-sim が所有しているのは、注入クロックで駆動される 8 つの状態機械である
（game-loop / time-service / inventory-service / player-service / autosave /
camera-pose / frame-timing / time-of-day）。そして
`setDayLength → setTimeOfDay` の順序ハザードは**野原に立っていても見えない**。

`apps/preview-sim/` は決定論シナリオステッパである。スクリプト化された入力列を与え、
フレームを 1 つずつ進め、ポーズ・カメラスナップショット・**2 つのクロック**・
日中時刻・インベントリ・オートセーブを同時に表示する。
plan.md §3.8 が実際に要求していること（「クロックPortでfast-forward」）に
3D の散歩より近い。

`--stats` は数値レポートで、**11 件の発見**に file:line と再現コマンドを付けて出した。
**11 件とも決着済み**（10 件修正 + SIM-6 は「移さない」という判断）。主なもの:

| # | 内容 | 決着 |
| --- | --- | --- |
| SIM-11 | 順序ハザードの正典的な worked example が算術的に誤り（`0.60` ではなく `0.20`） | ヘッダを修正し、**コメントが表示する数値**を assert するテストを追加 |
| SIM-1 | `restore({dayLengthTicks: 0})` で全読み取りが NaN、**`isNight` は `false`**（恒久的な昼） | `normaliseTimeState` を境界で適用。`isNight` は**触っていない**（mx-gameplay がミラーしている） |
| SIM-3 | `removeItem` が `MAX_STACK_COUNT` 超のスロットで throw する | 派生カウントを clamp して全域化。破棄せず精算する道は `normaliseInventory` |
| SIM-2 | `restore` がスロット数を検査せず、36 → 2 に縮む | `normaliseInventory` を `restore` と constructor に適用。`restore` は leftover を返す |
| SIM-9 | `Effect.repeat` の性質で fork 直後に 1 回保存する | `Effect.schedule` に変更。最初の保存は t = interval |
| SIM-6 | オートセーブのクロックだけが `ClockPort` ではない | **移さない**判断。Port は瞬間を読むだけで `sleep` を持たず、mc-kernel ミラーなので増やせない。Effect の `Clock` は注入可能で、その事実をテストで固定した |
| SIM-7 / SIM-10 / SIM-5 | drop 数 / 停止後の frame 数 / clamp 損失が読めない | `GameLoopApi` に `framesDropped` / `secondsLostToClamp` を追加し、カウンタは `stop` を跨いで残す |

全件は [`apps/preview-sim/README.md`](../apps/preview-sim/README.md)。

**レポートは発見を削除していない。** 各節は「何が間違っていたか」を、いま読める値と
固定しているテスト名の隣に印字し続ける。修正された境界と、そもそも誰も見ていない境界とが、
再現可能であることだけを取り柄とするレポートの中で見分けられなくなるからである。

### 2.3 プレビューの依存

`apps/preview-sim/` は**このリポジトリ自身のモジュールと `effect` しか import しない**。
org パッケージも新規 npm 依存も無い。

- `scripts/check-dependency-whitelist.ts` の `SCAN_ROOTS` に `'apps'` が入っており、
  `isToolingOrTestPath` が `apps/` を tooling 扱いする（`index.ts` / `domain/` /
  `application/` 以外はすべて tooling）。したがって将来 kit を `devDependencies` で
  参照するプレビューを足しても、`dev-only-package-in-dependencies` /
  `dev-only-package-in-shipped-source` が機械的に守る。
- `Date.now()` / `new Date()` / `performance.now()` 禁止は `apps/` にも効く。
  このアプリはクロックを 2 つとも注入しているので抵触しない
  （`ClockPort` は `Ref<number>`、Effect の `Clock` は `TestContext`）。
  `mc-kernel-allow-time-source` エスケープハッチは使っていない。

## 3. 現在のテスト

`vitest run`。20 ファイル / 396 テスト。

| ファイル | テスト数 | 対応 |
| --- | ---: | --- |
| `test/scenario.test.ts` | 3 | plan.md §3.8 の決定論シナリオ本体 |
| `test/entity.test.ts` | 32 | エンティティ台帳の値側（[public-api.md](./public-api.md) §7）。§3.4 |
| `test/entity-manager.test.ts` | 20 | 台帳サービス・Tag・セーブ経路。DN-07 / DN-09。§3.4 |
| `test/time-of-day.test.ts` | 27 | DN-04。SIM-11 / SIM-1 の domain 側。clamp の全域性 |
| `test/time-service.test.ts` | 10 | **ワールドロード経路**。SIM-1 / SIM-8 |
| `test/frame-timing.test.ts` | 17 | DN-03。clamp 損失の定量化（SIM-5） |
| `test/game-loop.test.ts` | 12 | DN-02 / DN-08。SIM-7 / SIM-10 / SIM-5 |
| `test/camera-pose.test.ts` | 13 | DN-01 |
| `test/inventory.test.ts` | 29 | DN-06 / DN-07。SIM-2 / SIM-3。語彙外アイテムの破棄（§3.3） |
| `test/recipe.test.ts` | 27 | レシピモデル（[public-api.md](./public-api.md) §4.1）。§3.2 |
| `test/crafting.test.ts` | 13 | クラフトの原子性。DN-07 |
| `test/autosave.test.ts` | 12 | DN-05 / DN-08。SIM-9 / SIM-6 |
| `test/stage-registration.test.ts` | 17 | `sim:physics` の id と `after` 0 本（[responsibility.md](./responsibility.md) §2.1） |
| `test/check-dependency-whitelist.test.ts` | 27 | DN-12 + 依存ホワイトリスト本体 |
| `test/api-lock.test.ts` | 26 | 生成器 `scripts/api-lock.ts` の機構そのもの（§7 末尾） |
| `test/vitals.test.ts` | 50 | 体力 / 空腹 / XP の値側（[responsibility.md](./responsibility.md) §3.4）。NaN 免疫・XP 曲線・レート換算・修復順序。§3.5 |
| `test/vitals-service.test.ts` | 11 | 死の遷移の原子性、ワールドロード経路、DN-07 / DN-09。§3.5 |
| `test/statistics.test.ts` | 17 | 記録の全域性と冪等な `unlock`（[responsibility.md](./responsibility.md) §3.5） |
| `test/settings.test.ts` | 22 | clamp と、第 2 の所有者を作らないこと（[responsibility.md](./responsibility.md) §3.6） |

### 3.5 体力 / 空腹 / XP のテストが守っているもの

**この 4 ファイルのうち「機能が動くこと」を見ているものは半分も無い。** 名前を付けた失敗のほうを挙げる。

| テスト | 何を守るか | 変異させると |
| --- | --- | --- |
| `REGRESSION: a NaN blow must not make a player immortal` | `20 - NaN` は `NaN` で、`NaN <= 0` は偽。一撃で**二度と死なないプレイヤー**ができる。緑のスイートからは見えない（何も throw せず、型も合っており、単に死ななくなる）。mx-gameplay のアリーナプレビューが F5 として実測した欠陥のプレイヤー側 | `delta` の NaN ガードを外すと 4 本赤 |
| `REGRESSION: the food tick is FOUR SECONDS, not eighty of mc-sim ticks` | 参照実装の 80 は 20 tick/s での 4 秒。mc-sim は 60 tick/s なので、転記すると空腹が 3 倍速く減り、しかも忠実な移植に見える | `FOOD_TICK_SECS` を `80 / 60` にすると 4 本赤 |
| `REGRESSION: the XP curve is the reference curve, and its closed form is the sum of it` | 累計の閉じた式は**導出**であり、誰も検算しない導出は手数の多い捏造定数である。`experienceCostOfLevel` の逐次加算と 0..400 で突き合わせる | 閉じた式の `352` を `350` にすると 2 本赤 |
| `REGRESSION: a non-finite experience total must not hang the level lookup` | 参照実装の `levelFromXP` は `while (true)` で、`NaN` でも `Infinity` でも比較が永久に偽。セーブファイル 1 つでフレームループが**無音で凍る** | ガードを外すと「誤った数」ではなく**ハング**する。実測: 60 秒で未完了（正常時 0.5 秒）。同期の無限ループなので vitest のタイムアウトでは中断できない |
| `REGRESSION: a broken maximum must not drag a legal current value out of range` | 各フィールドは**修復済みの**上限に対して clamp する。上限のほうが壊れているセーブが 2 つの実装を分ける唯一のケースで、全フィールド境界を満たしつつ交差境界を破る状態を作る —— 参照実装の `PlayerHealthInvariant` が捕まえるために存在し、schema では**拒否しかできない**形 | 上限をディスク上の値にすると 1 本赤 |
| `REGRESSION: a repaired maximum must be a number a screen can build a row from` | **プレビューが見つけた。** 無限大の上限を「指している側の境界」= `MAX_SAFE_INTEGER` に clamp すると、`isValidVitals` が通し、全テストが緑のまま、画面が `hunger 99.0/9007199254740991` と表示する。mx-ui は 2 ポイントごとに 1 アイコンを `Array.from` で作る | `MAX_SAFE_INTEGER` clamp に戻すと 1 本赤 |
| `REGRESSION: a restored accumulator must not sit above its own threshold` | **プレビューが見つけた。** 疲労度を [0, 40] に clamp するだけだと、復元された 40 が閾値の上に居座り、**次の 0.01 のスプリントが空腹を 10 減らす**。剰余はカスケードが残したはずの値そのものなので、これは reset ではなく修復である | clamp に戻すと 3 本赤 |
| `REGRESSION: exactly one blow reports the kill` | 「この一撃が殺したか」は書き込み前後の比較であり、書き込みの外で計算すれば read-decide-write になる。死亡画面が 2 回出るのと 1 回も出ないのは同じバグ | `died` を `isDead(next)` にすると 1 本赤 |
| `REGRESSION: settings must not become a second owner of the day length` | 日長は `TimeState` の分母として既に mc-sim にある。2 人目の所有者が空を飛ばす（`mx-gameplay/docs/architecture.md:142-148`） | フィールドを足すとキー一覧が赤 |
| `REGRESSION: the string "false" must not become a true` | `Boolean('false')` は `true`。古い schema が書いたセーブは stringify されたブールが来る場所そのもので、これはプレイヤーが切った設定を勝手に入れ直す唯一の型変換 | `Boolean(...)` にすると 1 本赤 |
| `REGRESSION: reset is RESTORE DEFAULTS, and must not be on the world-teardown path` | 他の 5 サービスと `reset` の意味が違う唯一のサービス。ワールド teardown に繋ぐと、別のセーブを開くたびに設定が無音で戻る | —— 意味の記録であり、変異ではなくホストの配線を守る |

**同時実行テストの限界を実測した。** `twenty concurrent blows produce exactly one kill` は、
`damage` を `Ref.get` + 別の `Ref.updateAndGet` に書き換える変異では**緑のまま**である
（Effect のファイバがその 2 操作の間で交錯しなかった）。
このテストが固定しているのは**不変条件であって実装ではない**。
`Ref.modify` の根拠はサービスのヘッダの議論であり、この assertion ではない ——
スイートが通ることを理由に `Ref.modify` を消そうとする人のために、テストファイルにも書いてある。

### 3.0 `--stats` の発見を閉じたときに何をしたか

**ゆるいテストは、それ自体が発見だった。** SIM-9（fork 直後の保存）を長く見逃した直接の原因は
`test/autosave.test.ts` の `toBeGreaterThanOrEqual(4)` で、4 回でも 5 回でも通る。
SIM-11 に至ってはどのテストも捕まえられない —— テストは**コード**を assert しており、
コードは正しく、間違っていたのはコメントのほうだったからである。

したがって発見を閉じるたびに、対応するテストは次のどちらかにした。

1. **正確な値に締める。** 下限ではなく回数、`not.toThrow()` を明示的に、境界は両側から。
2. **assert する対象を変える。** SIM-11 のテストは「コメントが印字している数値」を assert する。
   コードではなくドキュメントを固定するテストであり、§4.5 の「失敗の名前を付ける」に従って
   `REGRESSION: the module header worked example is the arithmetic` と名乗っている。

### 3.0.1 修正そのものへの敵対的レビューで出た 3 件

修正を入れたあと、それを**壊しにいく**レビューを別途かけた。インベントリ・フレームタイミング・
ゲームループ・オートセーブは破れなかったが、時刻モジュールで 3 件が出た。いずれも修正済みで、
3 件とも「片方だけ直した」形の欠陥だった —— **同じ関数の隣の行が既に守っている**、あるいは
**兄弟サービスが既に閉じている**穴が残っていた。

| 何が出たか | なぜ出たか | 現在 |
| --- | --- | --- |
| `normaliseTimeState({ticks: 0})`（フィールド欠落）が `dayLengthTicks: NaN` を返す —— **修復関数が SIM-1 を再生産していた** | `ticks` は `Number.isFinite` で守り、`dayLengthTicks` は `Number.isNaN` で守った。`Number.isNaN(undefined)` は `false` | 両方 `typeof` + NaN で判定。`null`（`JSON.stringify(NaN)` の出力）も `undefined` も文字列も DEFAULT に落ちる |
| `makeTimeService(initial)` が `initial` を正規化しない | `makeInventoryService` では閉じた穴を、時刻側で閉じ忘れた。`TimeServiceLayer(loadedState)` は公開 API | constructor も `normaliseTimeState` を通す |
| `setDayLength(NaN)` / `setTimeOfDay(NaN)` が健全な世界を汚染し、セーブを跨いで月齢がずれる | `clampDayLengthSecs` は `Math.max`/`Math.min` の連鎖で、**NaN を伝播する**。`Number('')` は `NaN` で、空にした設定欄がそれ | clamp 自体を全域化。`restore` だけが境界ではなかった |

3 件目は、`isNight` の doc コメントが「これは値が入る境界の側で直してある」と主張していたので、
**その主張を真にするために必要**でもあった。ドキュメントに書いた保証は、テストと同じ強さで守る。

### 3.1 公開済み `mc-kernel` の直接利用

mc-sim は `@nerima-games/mc-kernel` を厳密な version で直接依存し、共有語彙と
`ClockPort` を公開 package から import する。ローカルの `kernel-vocabulary.ts` と
mirror-only test は削除済みである。

この境界は、`ClockPort` の実行時キーとサービス形状を一つの公開定義に揃えるために必要である。
以前のローカルミラーは `monotonicSecs` だけを持ち、kernel 側の
`wallClockEpochMillis` を欠いていた。Effect は `Context.Tag` を文字列キーで解決するため、
型検査をすり抜けた狭い `Layer` は実行時に不足フィールドを残す。

現在は公開 package の `ClockPort` を直接利用するので、この二重定義は発生しない。変更時は
`pnpm typecheck` と実行時テストで package 契約を検証し、同じ語彙を別のローカル定数から
再生成しない。

### 3.2 レシピ / クラフトのテストが守っているもの

一致判定は**網羅的に**書ける種類の関数なので、そう書いてある。

| 何が壊れたら落ちるか | テスト |
| --- | --- |
| 平行移動 | `a 2x2 shape is the SAME recipe at all four positions in a 3x3 grid`、`a 1x2 shape is the SAME recipe at all six positions in a 3x3 grid`（位置を全列挙する） |
| 形が崩れたら一致しない | `a broken shape is not a translation of the whole shape`、`a hole in the pattern is a requirement, so a stray item breaks the match` |
| 2x2 グリッドで 3x3 レシピが作れてしまう | `a 3x3 recipe cannot be reached from the player 2x2 grid` |
| 鏡像 | `an asymmetric shape matches its left-right mirror, as vanilla does`、`the mirror travels with the translation, at every position`（**出荷される表**の `mc-sim:flint-and-steel`。ローカル表 `MIRROR_TABLE` は削除した —— [public-api.md](./public-api.md) §4.1-7） |
| 上下反転を鏡像と誤認する | `a vertical flip is NOT a mirror — a shape upside down is a different shape` |
| 鏡像規則が「未使用」に見えて消される | `REGRESSION: a shipped recipe distinguishes the mirror, so deleting it breaks the game`（`STARTER_RECIPES` の shaped に**左右非対称なものが在る**ことを assert し、その全件について鏡像レイアウトが同じレシピに一致することも見る。表を対称な行だけに戻すと落ちる） |
| 順列 | `every permutation of the ingredients is the same recipe`（6 通り全列挙、**出荷される表**の `mc-sim:fire-charge`）、`position is irrelevant, not merely reorderable within a row`、`an identical ingredient pair permutes too, which is the degenerate case` |
| 曖昧性が表順に依存する | `REGRESSION: the winner does not depend on where the recipe sits in the table`（全回転 + 逆順）、`equally specific matches are decided by id, in either table order` |
| 表に同順位の衝突が紛れ込む | `STARTER_RECIPES leans on specificity, never on the id tie-break` |
| 全域性 | `a ragged grid reads as empty where it is short, and does not throw`（mx-ui が画面状態から組むので、フレームの中で defect にしてはならない） |
| レシピの legend の打ち間違い | `every starter recipe matches its own canonical layout`（表の全件を、期待する id とともに固定する） |
| クラフトが中途半端に適用される | `REGRESSION: a craft short of an ingredient leaves the inventory untouched`、`REGRESSION: a craft with nowhere to put the result leaves the inventory untouched`（どちらも `toBe` で**参照同一性**を見る） |
| 先に空きを確認して最後の 1 回を断る | `removes the ingredients BEFORE offering the result, so the last craft still fits` |
| 並行クラフトで材料を超過して引く | `REGRESSION: concurrent crafts cannot overdraw — Ref.modify, not get-then-set`（DN-07） |

### 3.3 語彙の付け替えが作った穴と、それを守るテスト

`ItemId = string` を kernel の閉じた `ItemType` に付け替えると、**セーブの読み込み経路に穴が開く**。
`Slot.item` は `ItemType` と型が付くのに、実際に流れてくるのは mc-save が JSON から起こした
生の文字列であり、誰も検査しない。`'DIAMOND'`（1 コミット前の mc-sim 自身の綴り）を持つセーブは、
付け替え前は「妙だが合法」だったが、付け替え後は**値が自分の型と食い違うスロット**になる。

`normaliseInventory` がこれを捨てて `discarded` に数える。テストは 3 件:

| 何が壊れたら落ちるか | テスト |
| --- | --- |
| 語彙外アイテムがそのまま居座る | `an item this build has no vocabulary for is DISCARDED, and counted` |
| 破棄が `leftover` に混ざる（＝存在しないアイテムを地面に湧かせろと言う） | `a discard takes only its own slot, and the accounting stays separate` |
| サービス経由で数が消える | `a discarded item is not in restore’s number, and the number is still obtainable` |

型の上では `isItemType(slot.item)` の否定側は `never` に絞られる。**そこがテストする理由である** ——
この関数が存在する目的の値は、このリポジトリから来ない。

### 3.4 エンティティ台帳のテストが守っているもの

3 つは**時間ではなく参照同一性**を assert する。ホットパスの性質を「速い」で固定すると
CI のノイズで落ちるか、遅くなっても緑のままになるかのどちらかにしかならない
（[public-api.md](./public-api.md) §7-3）。

| 何が壊れたら落ちるか | テスト |
| --- | --- |
| `entities` が防御的コピーを返すようになる | `entities resolves to the roster's OWN array, not a copy`（2 回の読みが `toBe`） |
| 無風の sweep が配列を作り直す | `an idle sweep returns the ARGUMENT roster — no array, no object, nothing` |
| 変わらなかったエンティティが作り直される | `an UNCHANGED entity is the SAME object after a sweep that changed a different one` |
| ルールが id や kind を書き換えられるようになる | `a rule cannot change an id or a kind, because a transition does not carry one` |
| mc-sim が behaviour の中を見はじめる | `the behaviour is carried through BY REFERENCE`、`per-kind state survives the round trip, and mc-sim never looked inside it`（どちらも `toBe`） |
| ID がセーブを跨いで安定しなくなる | `ids are stable across a snapshot/restore cycle`（カウンタが戻ることまで見る） |
| 切り詰められた / 他ビルドのセーブで例外が出る | `a truncated save loads as an empty world instead of throwing`、`restore repairs a FOREIGN save rather than throwing, and says what it changed` |
| **修復が修復対象を再生産する** | `REGRESSION: the repair does not re-mint the very collision it exists to remove`（`nextSerial` が嘘のセーブ）、`a repaired roster is a FIXED POINT — repairing it again reports nothing` |
| コンストラクタ経由の入口が塞がれていない | `the CONSTRUCTOR repairs too, because a Layer is the other way a save gets in`（§3.0.1 の 2 件目と同型） |
| 並行 spawn が同じ ID を採番する | `REGRESSION: concurrent spawns all land — Ref.modify, not get-then-set`（DN-07） |
| Tag のキー文字列が黙って変わる | `the key is the contract with four repositories, pinned as a literal`（§4.6 のとおりリテラルで） |

**mx-gameplay のルールは transcribe してある。** `test/entity.test.ts` の
`describe('the shape mx-gameplay is waiting for')` は導火線の状態機械を書き写して
sweep 越しに走らせる。import はできない（mx-gameplay → mc-sim の逆向きは循環）ので、
これは**ルールの第 2 実装ではなく**、台帳が実際に使われる形で動くことを見るための代役である。
定数（3 ブロック / 1.5 秒 / オーバーシュートで起爆）は
`mx-gameplay/domain/mob/creeper-fuse.ts` のものであり、あちらの `test/mob.test.ts` が本体を固定している。

## 4. テストの書き方（本リポジトリの規約）

### 4.1 `@effect/vitest` の `it.effect`

主 API は `it.effect`。純粋な assertion だけの場合も `Effect.sync(() => { ... })` で包む
（テストの実行モデルを 1 つに保つため）。

```typescript
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

it.effect('name', () => Effect.sync(() => { expect(...).toBe(...) }))
it.effect('name', () => Effect.gen(function* () { ... }).pipe(Effect.provide(SomeLayer)))
```

**`it.effect` は TestClock を提供する。** `Effect.sleep` は `TestClock.adjust` を呼ばないと進まない。
これは仮想時間でスケジュールを検証できるということで、`test/autosave.test.ts` の
spaced / fixed 対比はこれに依存している。

### 4.2 `environment: 'node'` 固定

`vitest.config.ts` は `environment: 'node'`。**ブラウザや WebGL を要するテストを書かないこと。**
mc-sim のコードは DOM に触れない（`tsconfig.base.json` の `lib: ["ES2024"]`）ので、
そもそもそういうテストは書けないはずである。書けてしまったら設計が漏れている。

### 4.3 `it.effect` + `Effect.fork` + `Deferred.await` の注意

plan.md §3.13 は mx-ui について「DOMイベントフローのテストで `Effect.fork` + `Deferred.await` を
`it.effect` で書くとデッドロックする — プレーン `it` + `Effect.runPromise` を使う」と記録している。

**mc-sim では `it.effect` + `forkDaemon` + `Deferred.await` は動く**（`test/game-loop.test.ts` が
実際にそうしている）。違いは、mc-sim の待ち合わせが Effect ランタイム内で完結し、
DOM イベントループを跨がないこと。DOM を跨ぐ待ち合わせを書く必要が出たら、それは mc-sim の
責務境界を越えている合図である。

### 4.4 決定論シナリオの型

```typescript
const controllableClock = Effect.gen(function* () {
  const nowRef = yield* Ref.make(0)
  const layer = Layer.succeed(ClockPort, {
    monotonicSecs: Ref.get(nowRef).pipe(Effect.map(MonotonicTimeSecs)),
    // 凍結。しかも `nowRef` とは意図的に無関係にしてある。
    // 壁時計は「2 本目の monotonic クロック」ではない。両者を一緒に動かすと、
    // `wallClockEpochMillis` を経過時間の計算に使ってしまっているコードが隠れる。
    wallClockEpochMillis: Effect.succeed(EpochMillis(1_700_000_000_000)),
  })
  return { layer, tick: (secs: number) => Ref.update(nowRef, (v) => v + secs) }
})
```

**`ClockService` は 2 フィールドである。両方を書くこと。** `monotonicSecs` だけの
`Layer.succeed(ClockPort, { … })` は書けてしまうが、それは危険である —— `ClockPort` は
`Context.Tag` であり、Effect は Tag を**その文字列キー**（`'@nerima-games/mc-kernel/ClockPort'`）で
解決する。狭い Layer は広い Tag をそのまま満たし、`wallClockEpochMillis` は使用時に `undefined` になる。
TypeScript には見えない（キーが同じ 2 つのクラスは、名前的には別型でありながら実行時には同じサービスである）。

これは実際に起きていた欠陥である。現在は公開済み mc-kernel の `ClockPort` を直接利用するため、
本リポジトリ内に `ClockService` のローカルミラーや `test/kernel-mirror.test.ts` は存在しない。
契約の形状は公開 package の型検査と実行時テストで固定する。

これが fast-forward の仕組み。「次の夜明けまで待つ」が算術になり、20 分のテストが数マイクロ秒になる。
`test/scenario.test.ts` を新しいシナリオの雛形として使うこと。

### 4.5 回帰テストは失敗の名前を付ける

DN-xx に対応するテストは `REGRESSION: ...` で始め、**機能名ではなく失敗の名前**を付ける
（例: `REGRESSION: setDayLength must run BEFORE setTimeOfDay`）。
テストが何を守っているか、削除しようとした人にその場で分かる必要がある。

### 4.6 定数は算術ではなくリテラルで assert する

`expect(clampFrameDelta(30)).toBe(0.05)` と書く。`toBe(MAX_FRAME_DELTA_SECS)` と書かない。
両辺が同じ定数を読むテストは、定数を「整理」した瞬間に緑のまま壊れる。
実測で確定した値（0.001 / 0.05 / 0.016 / `{ticks: 7200, dayLengthTicks: 24000}` / 5000 ms）は
すべてリテラルで固定する。

## 5. カバレッジ

**閾値は現在設定していない。意図的である。**

参照実装は branches / functions / lines / statements の 99% を強制している。
スケルトンに 99% を課しても意味がない: 型だけのモジュール数個で自明に満たされ、
本実装の品質について何も言わない。

- 計測とレポートは常に動く（`pnpm test:coverage`、CI でもアーティファクト化）。
- **99% ゲートは完了条件（§2）到達時に `vitest.config.ts` と CI の両方で有効化する。**
  `vitest.config.ts` の `coverage.thresholds` にコメントアウトした形で置いてある。

## 6. CI

`.github/workflows/ci.yaml`。`pnpm verify` と同じ内容 + カバレッジ。

```
typecheck (build + test の 2 プロジェクト)
  → lint (oxlint)
  → check:deps (依存ホワイトリスト + 循環 + Date.now() 禁止)  ← ハードゲート
  → api:check (api-lock.md が公開 API と一致するか)          ← ハードゲート
  → test
  → coverage (閾値なし、アーティファクト化)
```

`API lock` を `verify` 経由だけでなく独立ステップにしてあるのは、ステップ名を見ただけで
落ちた理由が分かるようにするため。中身は `pnpm api:check` で、`pnpm verify` の中でも
`check:deps` と `test` の間で走る（[public-api.md](./public-api.md) §6）。

`check:deps` は plan.md §5.1-4「依存ホワイトリストCIを初回コミットから」の実体。
参照実装の `check-package-dag.ts` は警告を出して常に 0 で終了していた
（落ちないゲートはゲートではなくドキュメントである）。本リポジトリのものは違反があれば必ず非ゼロ終了する。

## 7. これから必要なテスト

[design-notes.md](./design-notes.md) の「（要追加）」印を参照。特に重要な未実装:

| テスト | 対応 | いつ |
| --- | --- | --- |
| `no THREE import reaches the simulation` | DN-01 | mc-render 着手前 |
| `no fiber survives world teardown` | DN-02 | ワールドライフサイクル実装時 |
| `ground-clamp runs AFTER step(), not before` | DN-10 | mc-physics 結合時 |
| `feet origin and AABB centre are not interchangeable` | DN-10 | 同上 |
| `no behavioural branch names a block or item literal` | DN-11 | インベントリ本実装時 |
| `every app-scoped service exposes reset` | DN-09 | サービスを増やすたび |
| 参照実装 fixture との互換テスト | plan.md §3.5 | セーブフォーマット定義時 |

**APIロックの diff はこの表から外れた。** 実装済みで、しかも vitest のテストではない。
「コミット済みの `api-lock.md` が現在の公開面と一致するか」は `pnpm api:check` が見る
（`pnpm verify` と CI の両方で走る）。vitest 側の `test/api-lock.test.ts` が見ているのは
別のこと —— 生成器 `scripts/api-lock.ts` の機構そのもの（並びがロケール非依存であること、
可搬性ガードが弾くべきものを弾き `import("effect/Cause")` を弾かないこと、
レンダリングしたスナップショットが元のエントリに parse し戻ること、失敗時に出す diff が正しいこと）である。
このファイルも 16 リポジトリに byte-identical で vendor されている。
ゲート本体を vitest に複製しないのは、同じことを知るために Program をもう一度丸ごと構築する
コストを払うことになるからである。詳細は [public-api.md](./public-api.md) §6。
