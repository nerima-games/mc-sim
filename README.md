# @nerima-games/mc-sim

## 責務

ゲーム状態の中枢。EntityManager・PlayerService・InventoryService・CropService・体力/空腹/XP・
実績/統計の記録・時間（TimeService）・ゲームループ・設定状態・決定論的な爆発計画。
**カメラ姿勢（`CameraPoseSnapshot`）の正はここが所有する。**

詳細は [`docs/responsibility.md`](./docs/responsibility.md)（**非スコープの明示を含む**）。

## 依存

| 依存先 | 何をもらうか |
| --- | --- |
| `mc-kernel` | 共有語彙。どのリポジトリからも import 可（許可リストに書かずに import できる） |
| `mc-physics` | `integrateBody(state, dt)` / `resolveBody(state, dt, options)`、AABB クエリ、voxel-DDA |
| `mc-save` | `defineFormat` / `StoragePort`。mc-sim は自分のフォーマットを定義する側 |
| `mc-worldgen` | `generateChunk` / `BiomeService` / `ChunkStore`（ブロックの読み書きとダーティ購読） |

`mc-noise` は **import できない**（`mc-worldgen` 経由の推移依存に過ぎないため）。
`mc-render` は下流なので当然依存しない。`mc-playground-kit` には実行時にも devDependency にも依存しない。

現在は `@nerima-games/mc-kernel@0.4.0`、`@nerima-games/mc-physics@0.1.7`、
`@nerima-games/mc-save@0.2.2`、`@nerima-games/mc-worldgen@0.1.14`、`effect` を
直接依存として宣言している。mc-kernel と mc-worldgen の語彙はローカルに複製せず、
各パッケージの公開 API を直接 import する。

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
対策は `src/index.ts` を公開面の正本とし、`pnpm build` が生成する declaration と
実行バンドルを同時に検査すること。公開 API の変更は依存先を含めた明示的なレビュー対象にする。

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
| 時刻の注入 | ゲーム状態の時刻は `ClockPort` / Effect のテスト可能なクロックから取得する |

依存境界は `package.json` の直接依存宣言と `.oxlintrc.json` の import 制限で検査する。
推移依存を直接参照せず、実行時に必要な `@nerima-games/*` は必ず dependencies に宣言する。

ランタイムの時刻取得を直接行わない規約は、型付きのポートとテスト用クロックで担保する。

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
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定。prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm preview` | 内蔵プレビュー（決定論シナリオステッパ）。**`pnpm verify` には入らない**。[`apps/preview-sim/README.md`](./apps/preview-sim/README.md) |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API、`environment: 'node'`） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | V8 カバレッジ計測。statements / branches / functions / lines の閾値は 100% |
| `pnpm build` | tsdown の実行バンドルと TypeScript declaration を `dist/` に生成 |
| `pnpm verify` | `typecheck && lint && test` |

## 現状

**現行実装の中心機能**

入っているのは「参照実装で実測確定した設計注意を、回帰テストとして最初から焼き込む」ための最小実装だけ。

| 領域 | 実装 | 設計注意 |
| --- | --- | --- |
| カメラ姿勢の所有 | `domain/camera-pose.ts` / `application/player-service.ts` | DN-01 |
| ゲームループの再入可能性 | `application/game-loop.ts` | DN-02 |
| deltaTime クランプ | `domain/frame-timing.ts` | DN-03 |
| `setDayLength → setTimeOfDay` 順序 | `domain/time-of-day.ts` / `application/time-service.ts` | DN-04 |
| 自動保存の `Schedule.spaced` | `application/autosave.ts` | DN-05 |
| `Ref.modify` による TOCTOU 回避 | `application/inventory-service.ts` | DN-07 |
| **ホットバー選択** | `domain/hotbar.ts` / `application/hotbar-service.ts` | 9スロットの投影は `InventoryService`、選択状態は `HotbarService` |
| 消費アイテムと耐久消費の原子的決済 | `InventoryService.consumeAndDamageAt` | 対象スロット・アイテムを再検証し、同一 `Ref.modify` 内で全成功または無変更 |
| レシピ表とクラフトの原子性 | `domain/recipe-data.ts` / `domain/recipe.ts` / `domain/crafting.ts` | DN-07 / DN-11 |
| 次元・ブロック座標ごとの作物状態 | `domain/crop.ts` / `application/crop-service.ts` | JSON-safe snapshot と deterministic tick |
| **エンティティ台帳（`EntityManager`）** | `domain/entity.ts` / `application/entity-manager.ts` | DN-07 / DN-09 / DN-11。[公開API §7](./docs/public-api.md) |
| **爆発計画** | `domain/explosion.ts` | seed・遮蔽・耐性・距離減衰を純粋計算し、全変更をホストの単一 transaction へ渡す。[公開API §8](./docs/public-api.md) |
| **TNT fuse 統合** | `domain/primed-tnt.ts` | fuse snapshot を最大 10 秒ずつ純粋に進め、detonation と爆発 mutation をホストの単一 transaction へ渡す。[公開API §8.1](./docs/public-api.md) |
| **`sim:physics` の登録と着地衝撃通知** | `stages/registration.ts` / `stages/stage-ids.ts` | [責務 §2.1](./docs/responsibility.md) / [公開API §4.2](./docs/public-api.md) |

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
- ~~体力・空腹・XP / 統計 / 設定状態~~ → **実装済み**（`domain/vitals.ts`、
  `domain/statistics.ts`、`domain/settings.ts`）。統計台帳（カウンタ / unlocked ID）は
  `SimulationSave` v2 に保存し、実績の registry / predicate は `mx-gameplay` 側の責務としてまだ別途必要。
- かまど / 醸造 / 金床 → **現行 `mc-kernel` 語彙の範囲を実装済み**（`domain/smelting.ts`、
  `domain/brewing.ts`、mc-kernel の anvil API）。醸造は `STARTER_BREWING_RECIPES` の4レシピを
  提供し、セーブ境界は `domain/save-data.ts` / `application/save-service.ts` にある。
- ~~エンチャントテーブルの確率付きオファー~~ → **実装済み**（`domain/enchantment-table-data.ts`、
  `domain/enchantment-table.ts`）。現行 `mc-kernel` の `ItemType` 語彙で表現できる 32 個の規則を
  データとして分離し、公式のスロット計算・重み付き抽選・競合除去・本の出力を純粋ロジックで提供する。
  語彙外の装備、`wind_burst` など `mc-kernel` にまだ存在しない規則は、依存パッケージの語彙境界に残る。
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
- **publish 自動化**。`pnpm build`、`exports`、`pnpm pack --dry-run` は整備済みだが、
  レジストリへの公開ワークフローはこのリポジトリの責務外である。
- ~~カバレッジ閾値~~ → **100% を設定済み**。対象は `src/` の実行コードで、テストは
  Vitest/V8 の Node.js 24 実行環境を対象にする。
- **ローカル語彙ミラー**。mc-kernel と mc-worldgen の旧ミラーは削除済みで、
  ソース・テストとも公開パッケージを直接参照する。

## ドキュメント

[`docs/README.md`](./docs/README.md) が索引。

## License

MIT
