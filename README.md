# @nerima-games/mc-sim

## 責務

ゲーム状態の中枢。EntityManager・PlayerService・InventoryService・体力/空腹/XP・
実績/統計の記録・時間（TimeService）・ゲームループ・設定状態。
**カメラ姿勢（`CameraPoseSnapshot`）の正はここが所有する。**

詳細は [`docs/responsibility.md`](./docs/responsibility.md)（**非スコープの明示を含む**）。

## 依存

| 依存先 | 何をもらうか |
| --- | --- |
| `mc-kernel` | 共有語彙。どのリポジトリからも import 可（許可リストに書かずに import できる） |
| `mc-physics` | `step(state, world, dt)`、AABB クエリ、voxel-DDA |
| `mc-save` | `defineFormat` / `StoragePort`。mc-sim は自分のフォーマットを定義する側 |
| `mc-worldgen` | `generateChunk` / `BiomeService` / `ChunkManager` |

`mc-noise` は **import できない**（`mc-worldgen` 経由の推移依存に過ぎないため）。
`mc-render` は下流なので当然依存しない。`mc-playground-kit` には実行時にも devDependency にも依存しない。

**現在の `dependencies` は `effect` のみ。** 上記 4 つはまだどれも publish されていないため
（plan.md §6 Step 3 の bottom-up publish-then-pin）、kernel の語彙は
`domain/kernel-vocabulary.ts` に暫定ミラーしてある。kernel 公開時に削除する。

## このリポジトリの位置づけ

4 層アーキテクチャの**基盤**層。そして**依存ハブ**である。

```
mc-render / mc-playground-kit / mx-gameplay / mx-redstone / mx-ui / mx-multiplayer
                         ↓ 6 リポジトリすべてが依存
                      mc-sim
                         ↓
          mc-physics / mc-save / mc-worldgen  (+ mc-kernel)
```

plan.md §8 のリスク表第 2 項が「mc-sim のAPIが揺れて全下流に波及（依存ハブ）」であり、
**本リポジトリの公開 API 設計はプロジェクト全体の最大リスクそのもの**である。
対策は APIロックファイルを最初から適用し、公開 API の変更を明示的なレビュー対象にすること。

依存グラフ全体・4 階層・名詞/動詞ルール・kit の devDependency 専用規則・stage 全順序の所有者は
[`docs/architecture.md`](./docs/architecture.md) を参照。

### 依存ルール（16 リポジトリ共通）

| ルール | 内容 |
| --- | --- |
| ハード失敗 | 違反があれば CI は必ず非ゼロ終了する。警告で済ませない |
| 循環禁止 | 循環依存は一切許可しない。「co-evolution ペア」のような例外リストは設けない |
| 推移閉包の禁止 | A→B、B→C のとき A は C を import できない |
| kernel は例外 | mc-kernel はどこからでも import 可（`dependencies` への記載は必要） |
| 宣言と実体の一致 | import する `@nerima-games/*` は `package.json` に記載必須 |
| mc-playground-kit は devDependency 専用 | `dependencies` に入れてはならない。実行時依存になると出荷ビルドから入力処理が消える |
| `Date.now()` 禁止 | 時刻はすべて注入された Clock Port から取得する |

`scripts/check-dependency-whitelist.ts` は 16 リポジトリ共通のテンプレートである。
冒頭で囲ってある `REPOSITORY_POLICY` 定数だけを書き換え、それ以外はそのままコピーする。
本リポジトリの版は **plan.md §2.1 の 16 リポジトリ全行**を保持しており、循環検査が全体を見る。

### `Date.now()` 禁止の実装方法

oxlint 0.12 は `no-restricted-syntax` も `no-restricted-properties` も実装しておらず、
`no-restricted-globals` は `oxlint --rules` の一覧に出るものの実装されていない
（mc-kernel で 0.12.0 に対し実測確認済み。3 ルールすべて設定した状態で `Date.now()` を書いても診断 0 件）。

そのため禁止は **`scripts/check-dependency-whitelist.ts` 側で実装**している。
対象は `Date.now()` / `new Date()` / `performance.now()` の 3 つ。
コメント・文字列リテラル・正規表現リテラルの中身はマスクされるので誤検知しない。
Clock Port の実装アダプタだけは `mc-kernel-allow-time-source` コメントで除外できる。

oxlint が該当ルールを実装したら oxlint.json 側へ移す。

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_22 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 22 以上と pnpm 9.15.0（`corepack` 推奨）を用意する。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` と `tsconfig.test.json` の両方を型検査 |
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定。prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API、`environment: 'node'`） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測（閾値は未設定。後述） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止の検査 |
| `pnpm verify` | `typecheck && lint && check:deps && test`。CI と同じ内容 |

## 現状

**このリポジトリはまだ叩き台（pre-audit first cut）である。**

入っているのは「参照実装で実測確定した設計注意を、回帰テストとして最初から焼き込む」ための最小実装だけ。

| 領域 | 実装 | 設計注意 |
| --- | --- | --- |
| カメラ姿勢の所有 | `domain/camera-pose.ts` / `application/player-service.ts` | DN-01 |
| ゲームループの再入可能性 | `application/game-loop.ts` | DN-02 |
| deltaTime クランプ | `domain/frame-timing.ts` | DN-03 |
| `setDayLength → setTimeOfDay` 順序 | `domain/time-of-day.ts` / `application/time-service.ts` | DN-04 |
| 自動保存の `Schedule.spaced` | `application/autosave.ts` | DN-05 |
| `Ref.modify` による TOCTOU 回避 | `application/inventory-service.ts` | DN-07 |

各 DN の参照実装証跡（file:line）と、書くべき回帰テストの一覧は
[`docs/design-notes.md`](./docs/design-notes.md)。

### まだ無いもの

- **EntityManager / 体力・空腹・XP / 実績・統計 / 設定状態 / チャンクダーティ通知。**
  特に**チャンクダーティ通知は最優先**。これが無いと mc-render が着手できない
  （[`docs/public-api.md`](./docs/public-api.md) §5）。
- **内蔵障害物コースプレビュー。** plan.md §6 Step 2 の完了条件の半分。
  mc-render / mc-playground-kit の完成後にしか作れない（[`docs/testing.md`](./docs/testing.md) §2.1）。
- **リポジトリ内 workspace 分割**（entity / inventory / game）。plan.md §3.8 内部構成。
- **APIロックファイル。** plan.md §6 Step 0-3。ツール未選定（§9 未決）。publish 開始までに必須。
- **`ItemId` が暫定 `string`。** 本来は mc-kernel の `ItemType`（リテラル union、網羅性チェックつき）。
- **ビルド／publish はまだない。** `exports` は TypeScript ソースを直接指している。
  それまで `version` は `0.x` に留める（[`docs/versioning.md`](./docs/versioning.md)）。
- **カバレッジ閾値は未設定。** 参照実装は 99% を強制しているが、スケルトンに閾値を課しても意味がない。
  計測とレポートは常に動かしており、99% ゲートは完了条件到達時に有効化する。
- **`domain/kernel-vocabulary.ts` は暫定ミラー。** mc-kernel 公開時に削除する。
  `index.ts` から re-export していないのは、真実の出所を 2 つにしないため。
  ミラーは意図的に最小だが、**Clock Port だけは丸ごと**写してある —— `ClockPort` は
  文字列キーで解決される `Context.Tag` なので、狭いミラーは「語彙が少ない」ではなく
  実行時ハザードである（狭い `Layer` が広い Tag を満たし、欠けたフィールドが `undefined` になる）。
  `test/kernel-mirror.test.ts` が Tag キーと形を両方向で固定している
  （[`docs/versioning.md`](./docs/versioning.md) §5-1、[`docs/testing.md`](./docs/testing.md) §3.1）。

## ドキュメント

[`docs/README.md`](./docs/README.md) が索引。

## License

MIT
