# テスト / 検証

## 1. plan.md が要求する検証（§3.8）

> **検証**: Node決定論シナリオテスト（「スポーン→採掘→インベントリをassert」を高速実行。
> クロックPortでfast-forward）+ **内蔵障害物コースプレビュー（歩く/泳ぐ/跳ぶ/スニークを操作確認）**

つまり 2 本立てである。

| 検証 | 何を保証するか | 状態 |
| --- | --- | --- |
| Node 決定論シナリオテスト | ロジックが正しいこと。CI で高速に回る | 実装済（`test/scenario.test.ts`） |
| 内蔵障害物コースプレビュー | **人間が操作して確かめられること**。テストが見ない部分 | 未実装 |

## 2. 完了条件（plan.md §6 Step 2）

> 各リポジトリの完了条件: ユニット/シナリオテスト green + **内蔵プレビューが操作可能**

**両方**が条件である。テストが緑でもプレビューが動かなければ完了ではない。
mc-sim の場合、プレビューは**障害物コース**で、歩く / 泳ぐ / 跳ぶ / スニークを操作確認できること。

プレビューは `apps/preview-*/` に置く。モジュール契約（`GameModule`）には含めない（plan.md §4.1 末尾）。

### 2.1 プレビューの依存

障害物コースは描画と入力を要するため、mc-render と mc-playground-kit に依存する。
両方とも mc-sim の**下流**なので、**mc-sim の `dependencies` に入れてはならない**。

- `apps/preview-obstacle-course/` は `devDependencies` として kit を参照する
  （mx-gameplay / mx-redstone と同じ扱い）。
- `pnpm check:deps` の `dev-only-package-in-dependencies` / `dev-only-package-in-shipped-source`
  がこれを機械的に守る。
- 現在のスキャン対象（`SCAN_ROOTS`）に `apps` は含まれていない。プレビュー追加時に
  `scripts/check-dependency-whitelist.ts` の `SCAN_ROOTS` へ `'apps'` を足し、
  `isToolingOrTestPath` が `apps/` を tooling 扱いすることを確認すること。

**依存順の都合**: mc-render / kit は mc-sim の後に作られる（plan.md §6 Step 2 の構築順
`worldgen → sim → render → kit`）。つまり mc-sim は「テスト green」を先に満たし、
プレビューは kit 完成後に追加して完了条件を満たす、という 2 段階になる。この順序は避けられない。

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
| `test/autosave.test.ts` | 9 | DN-05 / DN-08 |
| `test/kernel-mirror.test.ts` | 7 | `domain/kernel-vocabulary.ts` が mc-kernel と同形であること（§4.4） |
| `test/check-dependency-whitelist.test.ts` | 26 | DN-12 + 依存ホワイトリスト本体 |

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
  → test
  → coverage (閾値なし、アーティファクト化)
```

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
| APIロックの diff テスト | plan.md §6 Step 0-3 | publish 開始前（必須） |
| 参照実装 fixture との互換テスト | plan.md §3.5 | セーブフォーマット定義時 |
