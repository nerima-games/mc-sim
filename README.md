# @nerima-games/mc-sim

## 責務

ゲーム状態の中枢。EntityManager・PlayerService・InventoryService・CropService・体力/空腹/XP・
実績/統計の記録・時間（TimeService）・ゲームループ・設定状態。
**カメラ姿勢（`CameraPoseSnapshot`）の正はここが所有する。**

詳細は [`docs/responsibility.md`](./docs/responsibility.md)（**非スコープの明示を含む**）。

## 依存

| 依存先 | 何をもらうか |
| --- | --- |
| `mc-kernel` | 共有語彙。どのリポジトリからも import 可（許可リストに書かずに import できる） |
| `mc-physics` | `step(state, world, dt)`、AABB クエリ、voxel-DDA |
| `mc-save` | `defineFormat` / `StoragePort`。mc-sim は自分のフォーマットを定義する側 |
| `mc-worldgen` | `generateChunk` / `BiomeService` / `ChunkStore`（ブロックの読み書きとダーティ購読） |

`mc-noise` は **import できない**（`mc-worldgen` 経由の推移依存に過ぎないため）。
`mc-render` は下流なので当然依存しない。`mc-playground-kit` には実行時にも devDependency にも依存しない。

現在は `@nerima-games/mc-kernel@0.2.4`、`@nerima-games/mc-physics@0.1.0`、`effect` を
直接依存として固定している。既存コードの段階的移行のため
`domain/kernel-vocabulary.ts` の互換ミラーは残るが、新しい crop 境界は kernel の
`BlockPosition` / `BlockType` を直接 import する。

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
**これは実装されている。** リポジトリ直下の `api-lock.md`（公開宣言 70 件 + 参照されている非 export 宣言 17 件）が
公開面の正本で、`pnpm api:check` が `pnpm verify` と CI の両方で走る
（[`docs/public-api.md`](./docs/public-api.md) §6）。6 リポジトリが黙って壊れる変更は、
レビューの前に diff として目に見える。

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
$ direnv allow          # flake.nix の devShell で nodejs_24 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 24 以上と pnpm 11（`corepack` 推奨）を用意する。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` / `tsconfig.test.json` / `tsconfig.preview.json` の 3 プロジェクトを型検査 |
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定。prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm preview` | 内蔵プレビュー（決定論シナリオステッパ）。**`pnpm verify` には入らない**。[`apps/preview-sim/README.md`](./apps/preview-sim/README.md) |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API、`environment: 'node'`） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測（閾値は未設定。後述） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止の検査 |
| `pnpm api:check` | `api-lock.md` が実際の公開 API と食い違えば非ゼロ終了（[`docs/public-api.md`](./docs/public-api.md) §6） |
| `pnpm api:update` | `api-lock.md` を書き直す。公開面を変える PR は結果を同じ PR に含める |
| `pnpm verify` | `typecheck && lint && check:deps && api:check && test`。CI と同じ内容 |

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
| レシピ表とクラフトの原子性 | `domain/recipe.ts` / `domain/crafting.ts` | DN-07 / DN-11 |
| 次元・ブロック座標ごとの作物状態 | `domain/crop.ts` / `application/crop-service.ts` | JSON-safe snapshot と deterministic tick |
| **エンティティ台帳（`EntityManager`）** | `domain/entity.ts` / `application/entity-manager.ts` | DN-07 / DN-09 / DN-11。[公開API §7](./docs/public-api.md) |
| **`sim:physics` の登録** | `stages/registration.ts` / `stages/stage-ids.ts` | [責務 §2.1](./docs/responsibility.md) |

`sim:physics` は**ロスターのリポジトリ間順序エッジ 4 本すべての宛先**であり、
`stages/` が無かったあいだ 4 本とも dangling として捨てられていた。
登録してもフレームの順序は動かない（実測。他 13 本は不変で dangling が 0 になる）
—— 変わるのは「宣言された制約が満たされている」ことのほうである。詳細は
[docs/responsibility.md §2.1](./docs/responsibility.md)。

各 DN の参照実装証跡（file:line）と、書くべき回帰テストの一覧は
[`docs/design-notes.md`](./docs/design-notes.md)。

### まだ無いもの

- ~~EntityManager~~ → **入った**（`domain/entity.ts` / `application/entity-manager.ts`）。
  mx-gameplay の `domain/mob/` にあるクリーパーのルール 4 本が待っていた名簿であり、
  向こうの `gameplay:entities` が「走らせるには座標と体力を持つ名簿が要る。それは
  セーブを跨ぐ状態なので mc-sim のものだ」と書いて**意図的に空けていた**枠である。
  `CreeperFuse` は**型引数**として運ぶ —— mc-sim は中を読まないし、mx-gameplay を
  import できない（循環）。設計と、ホスト側の呼び出し列は
  [`docs/public-api.md`](./docs/public-api.md) §7。
  **`simModule` にはまだ入れていない**（§7-5 に理由）。
- **体力・空腹・XP / 実績・統計 / 設定状態。** 台帳が持つ体力はエンティティの
  `healthPoints` だけで、プレイヤーの空腹・XP・最大体力はまだ無い。
- **かまど / 醸造 / 金床 / エンチャント**（plan.md §7 のうちクラフト以外）。
  グリッド形ではないので `domain/recipe.ts` には 1 行も無い。レシピモデルは
  shaped / shapeless までで、材料タグ（「任意の板材」）は `Ingredient` を
  **メンバ 1 つの tagged union**にすることで、破壊的変更にならない形で繰り延べてある
  （[`docs/public-api.md`](./docs/public-api.md) §4.1-6）。
- ~~チャンクダーティ通知~~ → **mc-worldgen の `ChunkStore` に決着した。ここには来ない。**
  plan.md §3.8 の公開 API 文は挙げているが、§3.7 が mc-worldgen に与える
  「ダーティフラグ」と両立しない。根拠は [docs/responsibility.md](./docs/responsibility.md) §3.3
  （[`docs/public-api.md`](./docs/public-api.md) §5）。
- **一人称の障害物コース（歩く / 泳ぐ / 跳ぶ / スニーク）。** docs/testing.md §1 が
  プレビューの形として挙げているもの。**待っているのはハーネスではない。**
  `PlayerServiceApi` は `pose / look / moveTo / cameraPose / restore / reset` で全部であり、
  速度も接地フラグもしゃがみ状態も浮力もコライダーも**このリポジトリには無い**。
  `moveTo` はテレポートで、何もそれに反対しない。だから今日コースを作ると
  プレイヤーは障害物をすり抜ける。移動はキャラクタコントローラを所有する側
  （mc-physics / mx-gameplay）の動詞である（plan.md §2.3-1）。
  **内蔵プレビューそのものは [`apps/preview-sim/`](./apps/preview-sim/) にある** ——
  mc-sim が実際に所有している 8 つの状態機械を、注入したクロックで 1 フレームずつ
  進めて見せる決定論シナリオステッパで、kit も publish も THREE.js も要らない
  （[`docs/testing.md`](./docs/testing.md) §2.1）。
- **リポジトリ内 workspace 分割**（entity / inventory / game）。plan.md §3.8 内部構成。
- **ビルド／publish はまだない。** `exports` は TypeScript ソースを直接指している。
  それまで `version` は `0.x` に留める（[`docs/versioning.md`](./docs/versioning.md)）。
- **カバレッジ閾値は未設定。** 参照実装は 99% を強制しているが、スケルトンに閾値を課しても意味がない。
  計測とレポートは常に動かしており、99% ゲートは完了条件到達時に有効化する。
- **`domain/kernel-vocabulary.ts` は段階移行中の互換ミラー。** 新規 API は公開済み mc-kernel を直接使う。
  `index.ts` から re-export していないのは、真実の出所を 2 つにしないため。
  ミラーは意図的に最小だが、**Clock Port だけは丸ごと**写してある —— `ClockPort` は
  文字列キーで解決される `Context.Tag` なので、狭いミラーは「語彙が少ない」ではなく
  実行時ハザードである（狭い `Layer` が広い Tag を満たし、欠けたフィールドが `undefined` になる）。
  `test/kernel-mirror.test.ts` が Tag キーと形を両方向で固定している
  （[`docs/versioning.md`](./docs/versioning.md) §5-1、[`docs/testing.md`](./docs/testing.md) §3.1）。
  **アイテム語彙（`ITEM_TYPES` / `ItemType` / `isItemType`）も丸ごと写してある** ——
  閉じたリテラル union は「メンバの集合そのものが型」なので、mc-sim が使う 6 個だけを
  写したミラーは *狭い別の型* になる。逆向き（mc-sim の都合で 1 個足す）はもっと悪く、
  ローカルでは通り、ミラー削除の日に初めて壊れる。ロスタを増やすのは mc-kernel の
  決定であってここの決定ではない（[`domain/recipe.ts`](./domain/recipe.ts) の表ヘッダ）。
  **この手順は 1 度回った**: 足りない 8 個を値段つきで要求し、kernel が 7 個を
  それぞれの kernel 側の理由（ドロップ規則・mob ドロップ・着火アイテム）とともに承認、
  1 個（`crafting_table`）は却下。ロスタは 16 → 23 になり、削っていたレシピ 2 行が戻った
  （[`docs/public-api.md`](./docs/public-api.md) §4.1-7、
  [`docs/versioning.md`](./docs/versioning.md) §5-4）。

## ドキュメント

[`docs/README.md`](./docs/README.md) が索引。

## License

MIT
