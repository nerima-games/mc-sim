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

`--stats` は数値レポートで、**11 件の発見**に file:line と再現コマンドを付けて出す。
主なもの:

| # | 内容 | 場所 |
| --- | --- | --- |
| SIM-11 | 順序ハザードの正典的な worked example が算術的に誤り（`0.60` ではなく `0.20`） | `domain/time-of-day.ts:17-18` |
| SIM-1 | `restore({dayLengthTicks: 0})` で全読み取りが NaN、**`isNight` は `false`** | `application/time-service.ts:89` |
| SIM-3 | `removeItem` が `MAX_STACK_COUNT` 超のスロットで throw する | `domain/inventory.ts:158` (`removeItem`) |
| SIM-6 | オートセーブのクロックだけが `ClockPort` ではない | `application/autosave.ts:102-108` |

全件は [`apps/preview-sim/README.md`](../apps/preview-sim/README.md)。

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

`vitest run`。9 ファイル / 99 テスト。

| ファイル | テスト数 | 対応 |
| --- | ---: | --- |
| `test/scenario.test.ts` | 3 | plan.md §3.8 の決定論シナリオ本体 |
| `test/time-of-day.test.ts` | 13 | DN-04 |
| `test/frame-timing.test.ts` | 10 | DN-03 |
| `test/game-loop.test.ts` | 7 | DN-02 / DN-08 |
| `test/camera-pose.test.ts` | 13 | DN-01 |
| `test/inventory.test.ts` | 11 | DN-06 / DN-07 |
| `test/recipe.test.ts` | 25 | レシピモデル（[public-api.md](./public-api.md) §4.1）。§3.2 |
| `test/crafting.test.ts` | 13 | クラフトの原子性。DN-07 |
| `test/autosave.test.ts` | 9 | DN-05 / DN-08 |
| `test/kernel-mirror.test.ts` | 7 | `domain/kernel-vocabulary.ts` が mc-kernel と同形であること（§4.4） |
| `test/check-dependency-whitelist.test.ts` | 26 | DN-12 + 依存ホワイトリスト本体 |
| `test/api-lock.test.ts` | 26 | 生成器 `scripts/api-lock.ts` の機構そのもの（§7 末尾） |

### 3.1 `test/kernel-mirror.test.ts` が守っているもの

`domain/kernel-vocabulary.ts` は mc-kernel のローカルミラーであり、そのヘッダは
「これを削除して import を publish 済みパッケージに向け直せば型検査が通る」と約束している。
**その約束は何にも強制されておらず、実際に破られていた。**

本リポジトリの `ClockService` は 1 フィールド（`monotonicSecs`）で、
kernel（`mc-kernel/domain/clock.ts:43-48`）は 2 フィールドだった。
`FixedClockLayer` も、kernel がオブジェクトを取るところで裸の `MonotonicTimeSecs` を取っていた。

`tsc` には見えず、実行時には致命的である。`ClockPort` は `Context.Tag` であり、
Effect は Tag を**その文字列キー**で解決する。3 つのコピーすべてが
`'@nerima-games/mc-kernel/ClockPort'` を使っているので、2 つが同居するバンドル
（mc-playground-kit は mc-sim に依存する）では**狭いミラーの `Layer` が広いミラーの Tag を満たし**、
`wallClockEpochMillis` は使用時に `undefined` になる。

そこでこのファイルは、Tag キーを**文字列リテラルで**固定し、サービスの形を**両方向で**assert する
（狭めても広げても落ちる）。同じ内容のテストが mc-render と mc-playground-kit にもある。

### 3.2 レシピ / クラフトのテストが守っているもの

一致判定は**網羅的に**書ける種類の関数なので、そう書いてある。

| 何が壊れたら落ちるか | テスト |
| --- | --- |
| 平行移動 | `a 2x2 shape is the SAME recipe at all four positions in a 3x3 grid`、`a 1x2 shape is the SAME recipe at all six positions in a 3x3 grid`（位置を全列挙する） |
| 形が崩れたら一致しない | `a broken shape is not a translation of the whole shape`、`a hole in the pattern is a requirement, so a stray item breaks the match` |
| 2x2 グリッドで 3x3 レシピが作れてしまう | `a 3x3 recipe cannot be reached from the player 2x2 grid` |
| 鏡像 | `an asymmetric shape matches its left-right mirror, as vanilla does`、`the mirror travels with the translation, at every position` |
| 上下反転を鏡像と誤認する | `a vertical flip is NOT a mirror — a shape upside down is a different shape` |
| 順列 | `every permutation of the ingredients is the same recipe`（6 通り全列挙）、`position is irrelevant, not merely reorderable within a row` |
| 曖昧性が表順に依存する | `REGRESSION: the winner does not depend on where the recipe sits in the table`（全回転 + 逆順）、`equally specific matches are decided by id, in either table order` |
| 表に同順位の衝突が紛れ込む | `STARTER_RECIPES leans on specificity, never on the id tie-break` |
| 全域性 | `a ragged grid reads as empty where it is short, and does not throw`（mx-ui が画面状態から組むので、フレームの中で defect にしてはならない） |
| レシピの legend の打ち間違い | `every starter recipe matches its own canonical layout`（表の全件を、期待する id とともに固定する） |
| クラフトが中途半端に適用される | `REGRESSION: a craft short of an ingredient leaves the inventory untouched`、`REGRESSION: a craft with nowhere to put the result leaves the inventory untouched`（どちらも `toBe` で**参照同一性**を見る） |
| 先に空きを確認して最後の 1 回を断る | `removes the ingredients BEFORE offering the result, so the last craft still fits` |
| 並行クラフトで材料を超過して引く | `REGRESSION: concurrent crafts cannot overdraw — Ref.modify, not get-then-set`（DN-07） |

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

これは実際に起きていた欠陥である。本リポジトリの `ClockService` ミラーは 1 フィールドで、
mc-kernel と mc-playground-kit は 2 フィールドだった。
`test/kernel-mirror.test.ts` が現在、Tag キーの文字列とサービスの形を**両方向で**固定している
（広すぎても狭すぎても落ちる）。

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
