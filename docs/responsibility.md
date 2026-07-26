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
| チャンクダーティ通知 | 「このチャンクが変わった」の発行（購読者は mc-render） | 未実装 |
| レシピ / クラフト状態 | レシピ表とクラフト結果の状態（画面は mx-ui） | 未実装 |

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

**クラフト。** レシピ表とクラフト結果の状態は mc-sim、画面は mx-ui（plan.md §7）。
ただし「かまどが何秒で焼けるか」の進行は tick を持つ mc-sim 側になる可能性が高い。
最初の実装時に決めて本文書に追記すること。

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
| `mc-worldgen` | `generateChunk`、`BiomeService`、`ChunkManager` | 未使用 |

### 子（mc-sim に依存する）

| リポジトリ | 何を使うか | mc-sim 側で壊してはいけないもの |
| --- | --- | --- |
| `mc-render` | `CameraPoseSnapshot`、チャンクダーティ購読、プレイヤー状態 | 姿勢スナップショットの形と発行タイミング |
| `mc-playground-kit` | ミニ世界のセッション構築、`GameLoop` | `start` / `stop` の再入可能性 |
| `mx-gameplay` | `InventoryService`、`EntityManager`、`TimeService`、体力/空腹 | 状態サービスの読み書き API |
| `mx-redstone` | ワールド状態の読み書き、tick | 同上 |
| `mx-ui` | 表示するための全状態（HUD / インベントリ / 実績 / 統計） | 読み取り API の網羅性 |
| `mx-multiplayer` | 同期すべき状態のスナップショットと適用 | スナップショット/復元の対称性 |

**この 6 者への影響を評価せずに公開 API を変更しないこと。**
APIロックファイル（plan.md §6 Step 0-3）を最初から適用し、公開 API の diff をレビュー対象にする。
