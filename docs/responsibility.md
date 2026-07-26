# 責務

出典: plan.md §3.8。以下は原文の責務記述を、スコープ / 非スコープの境界まで展開したもの。

## 1. 責務（plan.md §3.8 原文）

> ゲーム状態の中枢。EntityManager・PlayerService・InventoryService・体力/空腹/XP・
> 実績/統計の記録・時間(TimeService)・ゲームループ・設定状態。
> **カメラ姿勢(`CameraPoseSnapshot`)の正はここが所有**

一言でいえば「**ゲームの真実（state of the world）を持つ場所**」。
plan.md §2.3-1 の分類でいう **名詞**。

## 2. スコープ内

| 領域 | 具体 | 状態 |
| --- | --- | --- |
| エンティティ管理 | `EntityManager`。存在・ID・トランスフォームの台帳 | 未実装 |
| プレイヤー状態 | `PlayerService`。姿勢（feet 原点）、モード | 骨組みのみ `application/player-service.ts` |
| **カメラ姿勢** | `CameraPoseSnapshot` の**正**。唯一の発行者 | 実装済 `application/player-service.ts` |
| インベントリ | スタックの置き場、追加/削除/照会 | 骨組みのみ `application/inventory-service.ts` |
| 体力 / 空腹 / XP | 数値状態と遷移（「何がダメージを与えるか」は持たない） | 未実装 |
| 実績 / 統計 | **記録**（画面は mx-ui） | 未実装 |
| 時間 | `TimeService`。tick カウンタ、昼夜、月齢 | 実装済 `application/time-service.ts` |
| ゲームループ | フレーム駆動、開始/停止、再入可能な初期化 | 実装済 `application/game-loop.ts` |
| 自動保存 | いつ保存するか（何を書くかは mc-save のフォーマット定義） | 実装済 `application/autosave.ts` |
| 設定状態 | グラフィックス / 音量 / 操作の**値の保持**（画面は mx-ui、適用は各所） | 未実装 |
| ~~チャンクダーティ通知~~ | **mc-worldgen に移った**（`ChunkStore.subscribeDirty`）。mc-sim は中継しない — §3.3 | — |
| レシピ / クラフト状態 | レシピ表とクラフト結果の状態（画面は mx-ui） | 実装済 `domain/recipe.ts` / `domain/crafting.ts` / `application/inventory-service.ts`。§3.1 |

## 3. 非スコープ（明示的に持たない）

**この節が本文書の主目的である。** 依存ハブの API が肥大する経路は、ほぼすべて
「便利だからここに置いた」であり、参照実装の合成層 13k LOC はその結果だった（plan.md §3.15）。

| 持たないもの | 正しい置き場 | 根拠 |
| --- | --- | --- |
| **描画。THREE.js の import 一切** | mc-render | plan.md §3.9。`tsconfig.base.json` の `lib: ["ES2024"]`（DOM 無し）で機械的に防ぐ |
| **実行時入力（キーボード/マウス/ポインタロック/タッチ/リマッピング）** | mc-render | plan.md §2.3-2 / §7。kit は devDependency 専用なので入力を kit に置けない |
| **地形生成・バイオーム分類・カーバー・構造物** | mc-worldgen | plan.md §3.7 |
| **ノイズ関数** | mc-noise（mc-sim からは **推移依存で import 禁止**） | plan.md §2.3-5 |
| **物理積分・AABB 衝突解決・voxel-DDA** | mc-physics | plan.md §3.4。mc-sim は `step()` を**呼ぶ**だけ |
| **メッシュ生成** | mc-meshing | plan.md §3.3 |
| **セーブフォーマットの実体（IndexedDB アダプタ・コーデック基盤）** | mc-save | plan.md §3.5。mc-sim は `defineFormat` で自分のフォーマットを**定義する側** |
| **サウンド再生・字幕発行** | mc-audio | plan.md §3.6 |
| **採掘/設置/アイテム使用/Mob AI/ドロップ/流体/乗り物/ポータル/天候のルール** | mx-gameplay | plan.md §2.3-1、§3.11 |
| **レッドストーン電力伝播** | mx-redstone | plan.md §3.12 |
| **DOM UI 全般（HUD / メニュー / インベントリ画面 / 設定画面 / 実績画面）** | mx-ui | plan.md §3.13 |
| **ネットワークプロトコル・状態同期** | mx-multiplayer | plan.md §3.14 |
| **stage の全順序表** | mc-compose | plan.md §2.3-3。mc-sim は `after` 制約を宣言するだけ |
| **ブロック値の保持・ブロック書き込み・チャンクダーティ通知** | mc-worldgen（`ChunkStore`） | §3.3 |
| **Layer の最終合成・セッションライフサイクル（タイトル⇄ゲーム）** | mc-compose | plan.md §3.15 |
| **QA/デバッグAPI・Modding 入口・E2E** | mc-compose | plan.md §3.15 |
| **プレビュー共通ハーネス** | mc-playground-kit | plan.md §3.10 |

### 3.1 境界が紛らわしい 4 件

**Mob。** 「Mob という存在がいて座標と体力を持つ」は mc-sim（`EntityManager`）。
「クリーパーがプレイヤーに近づいて起爆する」は mx-gameplay。plan.md §7 が
「状態管理は sim、AI/スポーン/ドロップのルールは gameplay」と明記している。

**戦闘・体力。** 体力の数値と減算は mc-sim。「剣が何ダメージか」「落下で何ダメージか」は mx-gameplay。
plan.md §7「sim(状態) + gameplay(ルール)」。

**ライティング。** BFS 光伝播とライトグリッド（4bit パック）は **mc-worldgen が所有**し、
チャンクデータの一部である。適用（描画）は mc-render。mc-sim は通り道ですらない（plan.md §3.7 / §7）。

**クラフト。** レシピ表とクラフト結果の状態は mc-sim、画面は mx-ui（plan.md §7）。**実装済。**
以下は「最初の実装時に決めて本文書に追記すること」への回答である。

- **レシピ表は名詞なのでここ。** `STARTER_RECIPES` は 7 件だけで、モデル（shaped / shapeless /
  平行移動 / 鏡像 / 順列 / 曖昧性）を動かすためにあり、コンテンツのデータベースではない。
  大きな捏造表は構造ではなくコンテンツであり、コンテンツは mc-kernel のブロック表の議論の隣にある
  （[design-notes.md](./design-notes.md) DN-11）。
- **一致判定（`matchRecipe`）は全域かつ表順非依存。** 曖昧性は「shaped > shapeless、
  同順位は id 辞書順」で解決し、`conflictsIn` が同順位の衝突を報告する。
  根拠は [public-api.md](./public-api.md) §4.1-2。
- **グリッドは値であって状態ではない。** 画面が開いている間だけ存在するものを mc-sim が
  保持すると 36 スロットと二重管理になる。§4.1-4 に代償ごと書いてある。
- **`craft` は `InventoryService` に置いた。** 原子性は 1 つの Ref でしか成立せず、
  Ref を持っているのはインベントリだからである（§4.1-5、DN-07）。サービスは増えていない。
- **アイテム語彙は増やしていない。** レシピ表の `'OAK_PLANKS'` 等は `domain/inventory.ts` の
  暫定 `ItemId`（= `string`）そのもので、mc-kernel の `ItemType` が公開されたら
  リテラル union のメンバになり、表は型検査に落ちる。それが望ましい失敗である。
  判定コードは**アイテム ID を名指しで分岐しない**（DN-11）—— 名指しがあるのはデータ側だけ。

**かまど / 醸造 / 金床 / エンチャントは入っていない。** グリッド形ではないので `Recipe` の
仲間ではなく、`domain/recipe.ts` に 1 行も無い。「かまどが何秒で焼けるか」の進行が
tick を持つ mc-sim 側になる、という見立ては変わっていない —— ただし決めるのは
かまどを実装する時であり、レシピモデルを先に一般化して待ち構えることはしない。

### 3.3 チャンクダーティ通知は mc-sim のものではなくなった

plan.md §3.8 の**公開 API 文**は「チャンクダーティ通知」を挙げている。
一方 §3.7 は mc-worldgen に `ChunkManager`（ロード / アンロード / **ダーティフラグ**）を与えている。
**この 2 つは両立しない。** mc-worldgen は mc-sim を import できない（循環）ので、
worldgen が持つフラグを mc-sim が発行するには mc-sim が毎フレーム全ロードチャンクを走査するしかなく、
それは `mc-render/docs/public-api.md` §3.3 が名指しで却下している pull 設計である。

決着: **`ChunkStore` は mc-worldgen が所有し、ダーティチャンネルもそこにある**
（`@nerima-games/mc-worldgen/ChunkStore`、`subscribeDirty`）。
mc-render は plan.md §2.1 に既にある `render → worldgen` エッジで直接購読する。
mc-sim は中継しない。

この判断が本リポジトリにとって望ましい理由は、§3.2 の問い 3 と 4 がそのまま答えになっている:
チャンクの中身を*決める*のは worldgen（生成・ライト・直列化）で mc-sim は物理のために*読む*だけであり、
かつ plan.md §8 は mc-sim の公開 API 肥大を第 2 リスクに挙げている。
下流 6 者の界面を増やさずに済む。

根拠と、逆の選択のコストの全文は
`mc-worldgen/docs/public-api.md` §6-0 〜 §6-2 にある。

**mc-sim が引き続き所有するもの**: 掘ったブロックが入る `InventoryService`。
plan.md §2.3-1 の「採掘→インベントリに入る」は sim 経由、という例はそのまま生きている。
変わったのは「掘られた側」の置き場だけである。

### 3.2 判断手順

新しいコードをどこに置くか迷ったら、順に問う。

1. **THREE / DOM / WebAudio / IndexedDB に触るか** → 触るなら mc-sim ではない
2. **消したらゲームのルールが変わるか、状態が消えるだけか** → ルールなら体験モジュール（§2.3-1）
3. **他のリポジトリが「読む」ためのものか、「決める」ためのものか** → 決めるなら所有者側へ
4. **6 つの下流のうち 2 つ以上が必要とするか** → 1 つだけなら、その 1 つに置けないか再検討する
   （依存ハブの API を増やすコストは plan.md §8 の第 2 リスクそのもの）

## 4. 親と子

### 親（mc-sim が依存する）

| リポジトリ | 使うもの | 未公開のため現状 |
| --- | --- | --- |
| `mc-kernel` | 語彙全般（ブランデッド型、座標、`CameraPoseSnapshot`、Clock Port、`GameModule`） | `domain/kernel-vocabulary.ts` に暫定ミラー |
| `mc-physics` | `step(state, world, dt)`、AABB クエリ、voxel-DDA | 未使用 |
| `mc-save` | `defineFormat(name, version, schema, migrations)`、`StoragePort` | 未使用（`autosave.ts` は永続化 Effect を引数で受ける） |
| `mc-worldgen` | `generateChunk`、`BiomeService`、`ChunkStore`（物理のためにブロックを読む） | 未使用 |

### 子（mc-sim に依存する）

| リポジトリ | 何を使うか | mc-sim 側で壊してはいけないもの |
| --- | --- | --- |
| `mc-render` | `CameraPoseSnapshot`、プレイヤー状態（**チャンクダーティ購読は mc-worldgen から**） | 姿勢スナップショットの形と発行タイミング |
| `mc-playground-kit` | ミニ世界のセッション構築、`GameLoop` | `start` / `stop` の再入可能性 |
| `mx-gameplay` | `InventoryService`、`EntityManager`、`TimeService`、体力/空腹 | 状態サービスの読み書き API |
| `mx-redstone` | ワールド状態の読み書き、tick | 同上 |
| `mx-ui` | 表示するための全状態（HUD / インベントリ / 実績 / 統計） | 読み取り API の網羅性 |
| `mx-multiplayer` | 同期すべき状態のスナップショットと適用 | スナップショット/復元の対称性 |

**この 6 者への影響を評価せずに公開 API を変更しないこと。**
APIロックファイル（plan.md §6 Step 0-3）を最初から適用し、公開 API の diff をレビュー対象にする。
これは実装済みで、`pnpm api:check` が `pnpm verify` と CI の両方で走る。
公開面を変える PR は `pnpm api:update` の結果を同じ PR に含めること —— その差分が、
上の表の「壊れると困るもの」に何が起きたかを 6 者に見せる唯一の場所である
（[public-api.md](./public-api.md) §6）。
