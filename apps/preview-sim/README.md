# apps/preview-sim

mc-sim の**内蔵プレビュー**。plan.md §6 Step 2 の「内蔵プレビューが操作可能」に対する回答。

plan.md §2.3-4「プレビューは検証対象と同居する」に従い、
**このリポジトリの中の dev アプリケーション**である。
パッケージではない。`index.ts` からは公開されない。利用側から import できない。

```console
$ pnpm preview                                        # 対話モード
$ pnpm preview --help                                 # キー割り当てとオプション
$ pnpm preview --list                                 # シナリオ一覧
$ pnpm preview --stats                                # 絵ではなく数値レポート（発見はここ）
$ pnpm preview --once --ascii --at 130                # 1 フレームを文字で標準出力へ
$ pnpm preview --scenario corrupt-save --at 280 --once --ascii
```

`pnpm verify` はこれを実行しない。ただし `pnpm typecheck`（`tsconfig.preview.json`）と
`pnpm lint` と `pnpm check:deps` の対象には**入っている**。

## なぜ「障害物コース」ではなく「シナリオステッパ」なのか

[docs/testing.md](../../docs/testing.md) §1 は plan.md §3.8 を引いて、
このリポジトリのプレビューを**障害物コース（歩く / 泳ぐ / 跳ぶ / スニークを操作確認）**と定めている。
そして §2.1 は「mc-render と mc-playground-kit ができるまで作れない」と書いている。

**依存関係の話は正しい。結論は正しくない。足りないのはハーネスではないからである。**

### mc-sim は移動を所有していない

`application/player-service.ts:20-39` の `PlayerServiceApi` は、これで全部である:

```
pose · look · moveTo · cameraPose · restore · reset
```

速度が無い。加速度が無い。接地フラグが無い。しゃがみ状態が無い。浮力が無い。
コライダーが無い。ステップハイトが無い。`moveTo` は足元座標を書き込むだけで、
**何もそれに反対しない**。

だから今日の mc-sim の上に一人称の障害物コースを作ると、プレイヤーは
**すべての障害物をすり抜ける**。示せるのは「レンダラがミラーするポーズは
スクリプトが書いたポーズである」という一点だけで、それは
`test/scenario.test.ts` にカメラを付けたものにすぎない。

歩く / 泳ぐ / 跳ぶ / スニークは mc-physics と mx-gameplay の**動詞**である
（plan.md §2.3-1「基盤層は名詞、体験層は動詞」）。
障害物コースはキャラクタコントローラを最初に所有したリポジトリのものである。
**mc-playground-kit ができてもこれは変わらない。**

`--scenario obstacle-course` はコースをテレポートスクリプトとして実際に走らせる。
何があって何が無いかを読者が自分の目で見るためである。

### mc-sim が所有しているものは、一人称では見えない

game-loop / time-service / inventory-service / player-service / autosave /
camera-pose / frame-timing / time-of-day —— 8 つとも、注入されたクロックで駆動される
状態機械である。そして `setDayLength → setTimeOfDay` の順序ハザードは、
**野原に立っていても絶対に見えない**。

ステッパは、スクリプト化された入力列を与え、フレームを 1 つずつ進め、
ポーズ・カメラスナップショット・**2 つのクロック**・日中時刻・インベントリ・
オートセーブを**同時に**表示する。これは plan.md §3.8 が実際に要求していること
（「Node決定論シナリオテスト … クロックPortでfast-forward」）に 3D の散歩より近く、
しかも散歩には見えないものが見える。

## 2 つのクロック

このアプリはクロックを 2 つ注入する。**それ自体が発見である。**

| | 何か | mc-sim での見え方 |
| --- | --- | --- |
| `ClockPort` | mc-kernel の Port（`domain/kernel-vocabulary.ts` にミラー） | `cameraPose: Effect<…, never, ClockPort>` —— **型に出る** |
| Effect `Clock` | `Schedule.spaced` が sleep する先 | `startAutoSaveDaemon: Effect<Fiber.RuntimeFiber<…>>` —— **型に出ない** |

`application/player-service.ts` は「クロック依存を型に見せることが、
これを `Date.now()` に『単純化』されるのを防ぐ」と書いている。
「いつ」を決めることだけが仕事のサービスが、それをしていない —— という指摘（SIM-6）は妥当だった。

**結論は「移さない」で、理由は `application/autosave.ts` にある。** Port は**瞬間を読む**もので、
スケジュールは**期間だけ眠る**もの。`ClockPort` に `sleep` は無く、mc-kernel のミラーなので
足すこともできない（Tag は文字列キーで解決されるため、広いミラーは `test/kernel-mirror.test.ts` が
潰している当のハザードそのものになる）。Port で駆動すると polling になり、
`TestClock.adjust` では進まなくなって、オートセーブのテスト一式が手回しハーネスに変わる。

Effect の `Clock` もサービスであり、`TestClock` が差し替えるのはそれである。
つまり**どちらのクロックも注入されている**。呼び出し側が知るべきなのは
「Port を渡せ」ではなく「決定論的なリプレイは Effect Clock も設定しろ」で、
それは `test/autosave.test.ts` が固定している。詳細は `--stats` の `AUTOSAVE-CLOCK`。

このアプリは前者を `Ref<number>` で、後者を `TestContext.TestContext` で backing する。
だから 5 秒のオートセーブ間隔は実時間 0 秒で、全部再現可能である。
`Date.now()` / `new Date()` / `performance.now()` はこのアプリのどこにも無い。
`scripts/check-dependency-whitelist.ts` の `mc-kernel-allow-time-source`
エスケープハッチは**使っていない**。

## シナリオ

| 名前 | 何を見せるか |
| --- | --- |
| `mine-and-nightfall` | plan.md §3.8 のシナリオそのもの。スポーン → 採掘 → 日没まで早送り |
| `obstacle-course` | docs/testing.md が要求するコースを、今の mc-sim で走らせるとどうなるか |
| `tab-refocus` | deltaTime クランプの両端。背景タブ 30 秒が何を失うか |
| `day-length-hazard` | 順序ハザードと、その双子（`configureDay` が月齢を捨てる） |
| `second-world` | 同じサービスインスタンスでのワールド再ロード（DN-02 / DN-09） |
| `corrupt-save` | `restore()` は何でも受け取る。以前はうち 3 つが回復不能だった |
| `clock-divergence` | 2 つのクロックを引き離すと、オートセーブはどちらに従うか |
| `vitals` | 体力 / 空腹 / XP と、「何がダメージを与えるか」を持たないとはどういうことか |

## 見つけたもの

`--stats` が全部を数値で出す。各項目に再現コマンドが付いている。
**11 件とも決着済み**（10 件修正 + SIM-6 は「移さない」判断）。

| # | 内容 | 決着 |
| --- | --- | --- |
| SIM-11 | **順序ハザードの正典的な説明が算術的に間違っている。** `0.60` ではなく `0.20` | ヘッダを両方向とも書き下し、**コメントが印字する数値**を assert するテストを追加 |
| SIM-1 | `TimeService.restore({dayLengthTicks: 0})` → 全読み取りが NaN、**`isNight` は `false`**（恒久的な昼） | `normaliseTimeState` を `restore` に適用。`isNight` は**不変**（mx-gameplay のミラー） |
| SIM-3 | `removeItem` は `MAX_STACK_COUNT` 超のスロットで**throw する**。純粋・全域と書いてあるのに | スロットの読みをガードし派生する書き込みを clamp。全域になった |
| SIM-2 | `InventoryService.restore` はスロット数を検査しない。36 スロットが 2 になる | `normaliseInventory` を適用。`restore` は入らなかった数を返す |
| SIM-6 | オートセーブのクロックだけが Port ではない | **移さない。** Port は瞬間を読むだけで `sleep` を持てない。理由を `application/autosave.ts` に記載 |
| SIM-8 | `configureDay` は「ワールドロードが呼ぶもの」と書いてあるが、月齢を 0 に戻す | doc を「ブートストラップ専用」に。ロード経路のテストを新設 |
| SIM-9 | `Effect.repeat` の性質で、オートセーブは fork した瞬間に 1 回走る | `Effect.schedule` に変更。最初の保存は t = interval |
| SIM-7 | `Queue.offer` の drop シグナルが捨てられている。落ちたフレーム数を誰も知れない | `GameLoopApi.framesDropped` を追加。offer の位置で数える |
| SIM-10 | `framesProcessed` は停止後 0 を返す。teardown レポートが最も欲しい瞬間に読めない | `stop` が最終値を 1 回読んで保持。次の `start` が 0 に戻す |
| SIM-5 | クランプで失われた時間は誰も数えていない | `frameDeltaLossSecs` + `GameLoopApi.secondsLostToClamp` |

### `vitals` シナリオが見つけた 2 件

**この 2 件はプレビューが見つけた。** 追加した 50 本の domain テストは 1 本も捕まえておらず、
`isValidVitals` も両方を通していた。どちらも「修復関数が、この module 自身が作れない状態を作る」形である。

| # | 内容 | 決着 |
| --- | --- | --- |
| SIM-15 | `normaliseVitals` が無限大の上限を「指している側の境界」= `MAX_SAFE_INTEGER` に clamp し、画面が `hunger 99.0/9007199254740991` と表示した。mx-ui は 2 ポイントごとに 1 アイコンを `Array.from` で作るので、巨大な上限は**長い行ではなく行が無い**のと同じである | 上限は**有限でなければならない**。無限大の上限は「行を作れる大きさを述べていない」ので、大きさを持たない値と同じ扱いにしてデフォルトへ落とす。有限で大きいものは**触らない** —— 何が正当な上限かはルールであり、mc-sim はその所有者ではない（§3.1 と同じ議論） |
| SIM-16 | `normaliseVitals` が疲労度を [0, 40] に clamp するだけだったので、復元された 40 が閾値の上に居座り、**次の 0.01 のスプリントが空腹を 10 減らした** | 剰余まで**決着させる**。剰余はカスケードが残したはずの値そのものなので reset ではなく修復であり、逆にカスケードを実際に走らせると「セーブを開いただけで空腹が 10 減る」という反対向きの失敗になる |

**mx-ui 側に 1 件残っている。報告済みで、ここでは直せない。**
`mx-ui/domain/hud-view-model.ts` の `safeMaxPoints` は非有限の上限を守っているが
（`Array.from({length: Infinity})` が `RangeError` を投げるため、とヘッダに書いてある）、
**有限で巨大な上限は守っていない**。`Array.from({length: 5e8})` は throw こそしないが同じ結果になる。
mc-sim 側の修復はもう非有限を渡さないが、上限の値を決めるのはルール層であって mc-sim ではないので、
行の長さが生存可能であることを保証できるのは行を作る側だけである。

**`--stats` は発見を消していない。** 各節は「何が間違っていたか」を、いま読める値と
固定しているテスト名の隣に出し続ける。検査した境界と、誰も見ていない境界とを、
数値レポートの中で見分けられなくしないためである。

`findings` パネル（`p` でトグル）はこのうち 8 つを**現在のワールドに対する述語**として評価する。
述語も書き換えてあり、いまは 2 種類ある。

- **修復が走ったこと**を示すもの（SIM-1 / SIM-2 / SIM-3）。壊れた入力は今も同じように届くので、
  `corrupt-save` で `HIT` が出なくなったら、シナリオが境界に届かなくなったということである。
- **数えられるようになった量**（SIM-5 / SIM-7 / SIM-10）。`HIT` は「報告すべき値がある」であって
  「壊れている」ではない。

## このアプリがモデル化できていないこと、1 つ

`--scenario tab-refocus` の 30 秒ギャップでは、ログにオートセーブが 6 連発する。
**それは `Schedule.spaced` の正しい挙動である** —— 5 秒間隔で 30 秒経てば 6 回であり、
実クロックで 30 秒走っても同じことが起きる。

モデル化できていないのは**その先**である。`application/autosave.ts:8-24` が
`Schedule.fixed` を避ける理由として挙げているのは「タブを 2 分放置して戻ると
24 個のオートセーブが一斉に殺到する」で、それが起きないのは
**ブラウザがバックグラウンドタブのタイマーを絞る**からである。
`TestClock.adjust(30s)` は「30 秒ぶんの時間が経ち、その間ランタイムは自由に走れた」
という状況しか作れない。タイマー絞りに相当するものが `TestClock` には無い。

つまりこのシナリオが見せているのは**「プロセスが 30 秒遅かった」場合**であって、
**「タブが 30 秒止まっていた」場合**ではない。前者は `spaced` と `fixed` で差が出ず、
差が出るのは後者である。その差を出しているのは `--stats` の `AUTOSAVE-SCHEDULE` のほうで、
そこでは tick 自身が 40 ms sleep するので `spaced` が 7 回、`fixed` が 10 回になる。

## 依存

**このリポジトリ自身のモジュールと `effect` だけ。**
`effect` は既に `dependencies` にある。org パッケージも新規 npm 依存も無い。
`apps` は `SCAN_ROOTS` に入っているので、import は `domain/` と同じゲートを通る。

## ファイル

```
main.ts        エントリ、状態、キー処理、--once / --stats / --list
options.ts     CLI パーサ（純粋）
script.ts      シナリオ定義（データのみ。何も実行しない）
world.ts       mc-sim のサービスを ManagedRuntime + TestContext の上に立てる
panels.ts      パネル（純粋。WorldView と Style だけの関数）
probes.ts      --stats の数値レポート
style.ts       色と整形（純粋）
terminal.ts    このアプリで唯一の非純粋モジュール（Node の stdio）
```
