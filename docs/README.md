# mc-sim ドキュメント索引

`@nerima-games/mc-sim` の実装情報一式。上位仕様は plan.md（**非公開**）、
参照実装は `<reference-impl>`（凍結・テストオラクル扱い）。
本ディレクトリ内の参照実装パスはすべて ts-minecraft リポジトリルート相対で書く。

## 表記

| 表記 | 意味 |
| --- | --- |
| `<reference-impl>` | **参照実装のチェックアウトのルート**。凍結された `takeokunn/ts-minecraft` の作業コピーを指す。本ドキュメント群では `<reference-impl>/packages/…` の形か、単に `packages/…`（同じくルート相対）で引用する。手元のどこに clone してあっても読み替えられるようにするためのプレースホルダである |
| plan.md | リポジトリ構成仕様書（16 リポジトリ、確定済み）。**非公開**であり、公開読者は開けない。だから本ドキュメント群は「plan.md を読まなくても追える」ことを要件にしている —— plan.md の主張を引くときは必ず原文を引用し、参照実装での裏づけを file:line で添える |
| `nerima-games/<repo>` | 同 org の兄弟リポジトリ。リンクは GitHub の URL で張る |

## このリポジトリを一言でいうと

**ゲーム状態の中枢であり、本計画で最も重要な公開APIを持つリポジトリ。**
mc-render / mc-playground-kit / mx-gameplay / mx-redstone / mx-ui / mx-multiplayer の
**6リポジトリが直接依存する**（plan.md §2.1）。plan.md §8 のリスク表で第2項が
「mc-sim のAPIが揺れて全下流に波及」であり、本リポジトリの界面設計はプロジェクト全体の
最大リスクそのものである。

## 読む順序

| 文書 | 内容 | 誰が読むか |
| --- | --- | --- |
| [architecture.md](./architecture.md) | 4階層アーキテクチャ、依存グラフ全体、本リポジトリの位置、名詞/動詞ルール、kit の devDependency 専用規則、stage 全順序の所有者 | 最初に全員 |
| [responsibility.md](./responsibility.md) | plan.md §3.8 の責務、**非スコープ**の明示、親（依存先）と子（依存元） | 機能を足す前に |
| [public-api.md](./public-api.md) | 公開すべきAPI。参照実装の実コードと突き合わせて検証済み | API を触る人 |
| [design-notes.md](./design-notes.md) | 設計注意の全項目。参照実装の file:line 証跡つき。**各項目は書くべき回帰テスト名として表現している** | 実装する人（必読） |
| [porting.md](./porting.md) | 移植元パスと**実測 LOC**（`wc -l` 実行値。plan.md の見積りは当てにしない） | 移植する人 |
| [testing.md](./testing.md) | 検証要件、完了条件、カバレッジゲートの扱い | テストを書く人 |
| [versioning.md](./versioning.md) | 0.x → 1.0.0 の方針、GitHub Packages、build/publish の追加時期 | リリースする人 |

## いま何が入っているか

現在の実装は、状態・純粋な判定・Effect サービス・stage 登録を分離し、
共有語彙を所有パッケージから直接利用する構成である。回帰テストは
参照実装で確認した境界と、Minecraft の状態遷移を固定する。

| 領域 | 実装 | 対応する設計注意 |
| --- | --- | --- |
| カメラ姿勢の所有 | `domain/camera-pose.ts` / `application/player-service.ts` | DN-01 |
| ゲームループの再入可能性 | `application/game-loop.ts` | DN-02 |
| deltaTime クランプ | `domain/frame-timing.ts` | DN-03 |
| `setDayLength → setTimeOfDay` 順序 | `domain/time-of-day.ts` / `application/time-service.ts` | DN-04 |
| 自動保存の `Schedule.spaced` | `application/autosave.ts` | DN-05 |
| `Ref.modify` による TOCTOU 回避 | `application/inventory-service.ts` | DN-07 |
| **ホットバー選択** | `domain/hotbar.ts` / `application/hotbar-service.ts` | 9スロットの投影は `InventoryService`、選択状態は `HotbarService` |
| レシピ表とクラフトの原子性 | `domain/recipe-data.ts` / `domain/recipe.ts` / `domain/crafting.ts` | DN-07 / DN-11（[public-api.md](./public-api.md) §4.1） |
| **セーブ/ロード境界の修復**（`normaliseTimeState` / `normaliseInventory`） | `domain/time-of-day.ts` / `domain/inventory.ts` | [public-api.md](./public-api.md) §2-2 / §4-1 |
| **捨てたものを数える**（`framesDropped` / `secondsLostToClamp`） | `application/game-loop.ts` / `domain/frame-timing.ts` | [public-api.md](./public-api.md) §3-1 |
| エンティティ台帳・体力・空腹・XP | `application/entity-manager.ts` / `domain/vitals-hunger.ts` | [responsibility.md](./responsibility.md) §3.4 |
| 統計・設定・採掘・採取・乗り物 | `domain/statistics.ts` / `domain/settings.ts` / `application/*-service.ts` | [responsibility.md](./responsibility.md) §3 |
| かまど・醸造（現行語彙の4レシピ）・金床 | `domain/smelting.ts` / `domain/brewing.ts` / mc-kernel の anvil API | [public-api.md](./public-api.md) |
| **エンチャントテーブル** | `domain/enchantment-table-data.ts` / `domain/enchantment-table.ts` | スロット計算・重み付き抽選・競合除去・本の出力 |
| セーブ/ロード・ブロック相互作用 | `application/save-service.ts` / `domain/block-interaction.ts` | [testing.md](./testing.md) |

`--stats` が挙げた発見の決着内容は [`apps/preview-sim/README.md`](../apps/preview-sim/README.md) にある。

未実装または別パッケージが所有するものは、永続的な実績モデル、現行 `mc-kernel` の `ItemType` 語彙に
含まれない装備のエンチャント規則と公式醸造レシピ、物理を伴う一人称
障害物コース、リポジトリ内 workspace 分割、publish 自動化である。対応する 32 個のエンチャント規則は
`domain/enchantment-data.ts` にあり、同ファイルの金床コスト表とともに、`domain/enchantment.ts` が
`mc-kernel` の汎用金床 API に接続する。`domain/enchantment-table-data.ts` と
`domain/enchantment-table.ts` は、同じ語彙境界でスロット計算・重み付き抽選・競合除去を実装する。
金床コストはエンチャント本と同種アイテムを区別する。
共有の `ItemType` / `ClockPort` は `@nerima-games/mc-kernel`、`Dimension` は
`@nerima-games/mc-worldgen` から直接 import し、リポジトリ内の互換ミラーは置かない。
公開入口は `src/index.ts` で、`pnpm build` が ESM 実行物と TypeScript 宣言を `dist/` に生成する。
