# 責務

出典: plan.md §3.8。以下は原文の責務記述を、スコープ / 非スコープの境界まで展開したもの。

## 1. 責務（plan.md §3.8 原文）

> ゲーム状態の中枢。EntityManager・PlayerService・InventoryService・CropService・体力/空腹/XP・
> 実績/統計の記録・時間(TimeService)・ゲームループ・設定状態。
> **カメラ姿勢(`CameraPoseSnapshot`)の正はここが所有**

一言でいえば「**ゲームの真実（state of the world）を持つ場所**」。
plan.md §2.3-1 の分類でいう **名詞**。

## 2. スコープ内

| 領域 | 具体 | 状態 |
| --- | --- | --- |
| エンティティ管理 | `EntityManager`。存在・ID・トランスフォームの台帳 | 実装済 `domain/entity.ts` / `application/entity-manager.ts`。§3.1 |
| プレイヤー状態 | `PlayerService`。姿勢（feet 原点）、**どの次元に居るか**、モード | 姿勢と次元は実装済 `application/player-service.ts`。§3.7 |
| **カメラ姿勢** | `CameraPoseSnapshot` の**正**。唯一の発行者 | 実装済 `application/player-service.ts` |
| インベントリ | スタックの置き場、追加/削除/照会 | 骨組みのみ `application/inventory-service.ts` |
| 体力 / 空腹 / XP | 数値状態と遷移（「何がダメージを与えるか」は持たない） | 実装済 `domain/vitals.ts` / `application/vitals-service.ts`。§3.4 |
| 実績 / 統計 | **記録**（画面は mx-ui） | 実装済 `domain/statistics.ts` / `application/statistics-service.ts`。§3.5 |
| 時間 | `TimeService`。tick カウンタ、昼夜、月齢 | 実装済 `application/time-service.ts` |
| 作物 | `CropService`。次元 + `BlockPosition` ごとの植栽・成長・除去状態 | 実装済 `domain/crop.ts` / `application/crop-service.ts` |
| ゲームループ | フレーム駆動、開始/停止、再入可能な初期化 | 実装済 `application/game-loop.ts` |
| 自動保存 | いつ保存するか（何を書くかは mc-save のフォーマット定義） | 実装済 `application/autosave.ts` |
| **stage 登録** | `sim:physics` 1 本。`after` 制約は **0 本**（§2.1） | 実装済 `stages/registration.ts` |
| 設定状態 | グラフィックス / 音量 / 操作の**値の保持**（画面は mx-ui、適用は各所） | 実装済 `domain/settings.ts` / `application/settings-service.ts`。§3.6 |
| ~~チャンクダーティ通知~~ | **mc-worldgen に移った**（`ChunkStore.subscribeDirty`）。mc-sim は中継しない — §3.3 | — |
| レシピ / クラフト状態 | レシピ表とクラフト結果の状態（画面は mx-ui） | 実装済 `domain/recipe.ts` / `domain/crafting.ts` / `application/inventory-service.ts`。§3.1 |

### 2.1 `sim:physics` —— なぜ 1 本で、なぜ `after` が 0 本なのか

**`sim:physics` はロスターの中で唯一、複数リポジトリから名指しされている stage である。**
mx-gameplay・mx-redstone・mx-ui・mc-render の 4 者が `after: [StageId('sim:physics')]` を宣言しており、
これは**ロスター全体のリポジトリ間順序エッジの全部**にあたる（他の 8 本はすべて自リポジトリ内）。
`stages/` が無かったあいだ、この 4 本は 4 本とも dangling として捨てられていた。
捨てられていることは、各リポジトリからは自分の 1 本しか見えないので誰にも見えなかった。

**フレームは動かない。** mc-compose の resolver に現ロスター + `sim:physics` を通した実測では、
`sim:physics` は 1 番（`render:input` の直後、plan.md §4.2 の空だった `simulation:physics` 枠）に入り、
**他の 13 本の順序は 1 つも変わらず**、dangling が 4 本から 0 本になる。
変わったのは順序ではなく、「宣言された制約が満たされている」ことのほうである。

**stage は 1 本だけ。** フレーム毎に起きうるものは 3 つあるが、stage はそのうち 1 つである。

| もの | 判定 | 理由 |
| --- | --- | --- |
| `application/game-loop.ts` | stage では**ない** | stage を**呼ぶ**側。順序表から組み立てた `FrameHandler` を駆動する |
| `application/autosave.ts` | stage では**ない** | `Schedule.spaced` の daemon。フレームではなく**時間**で動く。毎フレーム保存は別物であって小さい版ではない |
| ワールドを 1 フレーム進める | **stage** | 「フレーム毎にちょうど 1 回」であり、それは stage の定義そのもの |

**時刻と作物成長の前進（`TimeService.advance(dt)` / `CropService.advance(dt)`）はこの stage の中にある。**
mx-gameplay が `stages/registration.ts:276-284` で「時計を進めるのは mc-sim だ」と明記しているため、
どこかの mc-sim の stage に置く必要がある。2 本目を作る案は 2 通りとも実測で悪い:
`sim:time-weather` は `gameplay:time-weather` と**同じフェーズ**に入り、
フェーズ内順序は辞書順なので gameplay が先に走って 1 フレーム古い時刻を読む
（`before` が無いので mc-sim 側では直せない）。`sim:time` 等はどのフェーズにも一致せず
**フレーム末尾**へ落ちる。`sim:physics` は骨格上シミュレーションの先頭なので、
時刻を読む後続すべてが「そのフレームの時刻」を読む。詳細は `stages/registration.ts` の冒頭。

**`after` は 0 本。** 唯一の候補 `render:input` は宣言しない。(1) 全順序の主張は
plan.md §2.3-3 により mc-compose のもの、(2) mc-render は mc-sim に依存しているので逆向きエッジは
循環であり、文字列である `after` は `pnpm check:deps` をすり抜けてそれをやってしまう、
(3) 入力 stage を 1 本も登録しないビルド（シナリオテスト、ヘッドレスサーバ）でも
シミュレーションは正しい ——つまり本リポジトリの制約ではない。

## 3. 非スコープ（明示的に持たない）

**この節が本文書の主目的である。** 依存ハブの API が肥大する経路は、ほぼすべて
「便利だからここに置いた」であり、参照実装の合成層 13k LOC はその結果だった（plan.md §3.15）。

| 持たないもの | 正しい置き場 | 根拠 |
| --- | --- | --- |
| **描画。THREE.js の import 一切** | mc-render | plan.md §3.9。`tsconfig.base.json` の `lib: ["ES2024"]`（DOM 無し）で機械的に防ぐ |
| **実行時入力（キーボード/マウス/ポインタロック/タッチ/リマッピング）** | mc-render | plan.md §2.3-2 / §7。kit は devDependency 専用なので入力を kit に置けない |
| **地形生成・バイオーム分類・カーバー・構造物** | mc-worldgen | plan.md §3.7 |
| **ノイズ関数** | mc-noise（mc-sim からは **推移依存で import 禁止**） | plan.md §2.3-5 |
| **物理積分・AABB 衝突解決・voxel-DDA** | mc-physics | plan.md §3.4。mc-sim は `integrateBody()` と `resolveBody()` を**呼ぶ**だけ |
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
「状態管理は sim、AI/スポーン/ドロップのルールは gameplay」と明記している。**実装済。**

この行は長らく両側から空いていた。mx-gameplay の `domain/mob/` には完成した
クリーパーのルールが 4 本（導火線・爆風・スポーン条件・ドロップ）あり、
`gameplay:entities` stage はそのどれも呼んでいなかった ——
`mx-gameplay/stages/registration.ts:230-246` が「走らせるには座標と体力を持つ Mob の名簿が要る。
それはセーブを跨ぐ状態であり、したがって mc-sim のものである。ここに
`Ref<Map<MobId, CreeperFuse>>` を置けば今日動くが、それは削除した `timeOfDaySecs` の Ref と
同じ間違い（名詞の第 2 の所有者）になる」と書いて**意図的に空けていた**。名簿が本節の側である。

境界の実装上の形は 1 つの型引数である。`Entity<S>` の `behaviour` が
mx-gameplay の `CreeperFuse` を運ぶが、**mc-sim はその中を読まないし読めない**
（mx-gameplay を import すれば循環で `pnpm check:deps` が落ちる）。
`domain/entity.ts` に `'creeper'` という文字列は 1 つも無く、kind による分岐も無い。
根拠と、`Record<string, unknown>` にしなかった理由は
[public-api.md](./public-api.md) §7-1。

**体力の数値は台帳が持ち、最大体力は持たない。** kind ごとの定数はルール層のものであり、
その表をミラーすれば mc-sim が「クリーパーとは何か」を知ることになる（§7-6）。

**戦闘・体力。** 体力の数値と減算は mc-sim。「剣が何ダメージか」「落下で何ダメージか」は mx-gameplay。
plan.md §7「sim(状態) + gameplay(ルール)」。

**ライティング。** BFS 光伝播とライトグリッド（4bit パック）は **mc-worldgen が所有**し、
チャンクデータの一部である。適用（描画）は mc-render。mc-sim は通り道ですらない（plan.md §3.7 / §7）。

**クラフト。** レシピ表とクラフト結果の状態は mc-sim、画面は mx-ui（plan.md §7）。**実装済。**
以下は「最初の実装時に決めて本文書に追記すること」への回答である。

- **レシピ表は名詞なのでここ。** `STARTER_RECIPES` は **20 件**だけで、モデル（shaped / shapeless /
  平行移動 / 鏡像 / 穴 / 順列 / 曖昧性）を動かすためにあり、コンテンツのデータベースではない。
  鉄のヘルメット / チェストプレート / レギンス / ブーツの 4 種も、本家と同じ shaped の配置で含む。
  大きな捏造表は構造ではなくコンテンツであり、コンテンツは mc-kernel のブロック表の議論の隣にある
  （[design-notes.md](./design-notes.md) DN-11）。
  **鏡像と「相異なる 3 材料の順列」もこの表が動かしている。** 一時期は該当する本家レシピが
  kernel の 16 アイテムの中に無く、見せるためだけに捏造せずローカル表へ移していた。
  kernel がロスタを 23 に広げた（それぞれ kernel 側の理由を伴って）ので、
  本家レシピ 2 行がそのまま戻った（[public-api.md](./public-api.md) §4.1-7）。
- **一致判定（`matchRecipe`）は全域かつ表順非依存。** 曖昧性は「shaped > shapeless、
  同順位は id 辞書順」で解決し、`conflictsIn` が同順位の衝突を報告する。
  根拠は [public-api.md](./public-api.md) §4.1-2。
- **グリッドは値であって状態ではない。** 画面が開いている間だけ存在するものを mc-sim が
  保持すると 36 スロットと二重管理になる。§4.1-4 に代償ごと書いてある。
- **`craft` は `InventoryService` に置いた。** 原子性は 1 つの Ref でしか成立せず、
  Ref を持っているのはインベントリだからである（§4.1-5、DN-07）。サービスは増えていない。
- **アイテム語彙は増やしていない。いまは増やせない。** レシピ表の `'oak_planks'` 等は
  mc-kernel の `ItemType`（閉じたリテラル union）のメンバで、`domain/kernel-vocabulary.ts` に
  ミラーしてある。望ましい失敗は実際に起きた —— 表の 3 件が存在しないアイテムを名指していて
  型検査に落ち、**kernel に 8 個足させるのではなく削った**（[public-api.md](./public-api.md) §4.1-7）。
  ロスタを決めるのは kernel であり、tier-2 のレシピ表を根拠に tier-1 の語彙を広げるのは
  本プロジェクトが 2 回退けた「推測されたロスタ」と同じ形である。
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

### 3.4 体力 / 空腹 / XP —— 「何がダメージを与えるか」を持たないとはどういうことか

`domain/vitals.ts` / `application/vitals-service.ts`。**実装済。**
本行の但し書きは API の形そのものであり、注釈ではない。

- **`applyDamage(vitals, { amount, cause })` は量と死因を受け取り、どちらも解釈しない。**
  クリーパーの爆風か落下か溶岩かはルールであり mx-gameplay のもの（plan.md §2.3-1）。
  ダメージ表も落下距離の算術も、燃えるものの一覧も、`cause` による分岐も **1 つも無い**。
  `DamageCause` は裸の `string` である —— `mx-gameplay/domain/death-cause.ts` が
  11 個の死因ロスタとその文言を所有しており、ここでその union をミラーすれば
  `ItemType` の狭いミラーとまったく同じ「第 2 の所有者」になる。
  **死因は殺した一撃のときだけ記録する**（参照実装の `justDied ? …` と同じ、
  `health-service.ts:82`）。死体への 2 撃目が死亡メッセージを書き換えないのはそのためである。

- **飽和度(saturation)と疲労度(exhaustion)はここ。消耗の「原因表」はここではない。**
  この分割が本節でいちばん判断を要した箇所である。
  - 両者は**フレームとセーブを跨いで残る数値**であり、両者のあいだのカスケード
    （疲労 4 で飽和 1、飽和が空なら空腹 1）は**数値の遷移**である。だからここ。
  - 一方 `EXHAUSTION_SPRINT_PER_BLOCK = 0.1` / `EXHAUSTION_JUMP = 0.05` /
    `EXHAUSTION_ATTACK = 0.1`（`hunger-service.config.ts:20-25`）は
    「**何が消耗させるか**」であり、これは「何がダメージを与えるか」の動詞違いにすぎない。
    **持っていない。** `addExhaustion` は `applyDamage` と同様、呼び手が計算した量を受け取る。
  - **境界上の定数が 1 つあり、明記してある。** `EXHAUSTION_PER_REGEN = 6` はコストなので
    上の議論ではルール層のものになるはずだが、それが課金される「行為」を行うのは
    この状態機械自身（食事タイマー）であり、呼び手には課金の機会が見えない。
    `domain/vitals.ts` の当該定数の doc comment にこの但し書きごと書いてある。

- **`advanceFoodTimer` は信号を返し、何も適用しない。** 餓死が何ダメージか、回復が何ポイントかは
  量であり、この module は量を 1 つも知らない。参照実装も同じ線を引いている
  （`hunger-service.ts:60-62`「for the caller to apply to HealthService」）。
  違いは、あちらでは呼び手が同じパッケージ内にいたのに対し、こちらでは mc-sim から見えない
  別リポジトリにいることである。

- **食事タイマーは「4 秒」であって「80 tick」ではない。** 参照実装の
  `FOOD_TICK_INTERVAL = 80` はコメント自身が「80 ticks = 4 s at 20 t/s」と測定を述べている。
  **mc-sim は 60 tick/s である。** 80 をそのまま転記すると 1.33 秒ごとに発火し、
  空腹の減りが 3 倍速くなる —— しかも忠実な移植に見える。
  移るのは**持続時間**のほうであり、それがコメントが実際に測っていたものだからである。
  `test/vitals.test.ts` の `REGRESSION: the food tick is FOUR SECONDS` がこれを固定する。

- **XP は 2 つの数ではなく 1 つの数である。** `totalExperience` だけを保持し、
  レベルと進捗は導出する。曲線は参照実装の 3 区分
  （`player-xp-calc.ts:5-13`、レベル 0-15 / 16-30 / 31+）をコメントごと転記したもので、
  **捏造した定数は 1 つも無い**。累計の閉じた式はその走行和の導出であり、
  `experienceCostOfLevel` の逐次加算と 0..400 で一致することをテストが固定している
  —— 誰も検算しない導出は、手数の多い捏造定数と同じだからである。

- **参照実装の `levelFromXP` は非有限入力で停止しない。** `while (true)` の
  `accumulated + cost > totalXP` は `NaN` でも `Infinity` でも永久に偽であり、
  そういう `totalXP` を持つセーブファイルはフレームループを**無音で凍らせる**。
  正直な移植はこれを無料で相続する。ここでは倍増 + 二分探索にしてあり、
  ガードを外すと該当テストは「誤った数」ではなく**ハング**して赤くなる（実測 60 秒で未完了、
  正常時 0.5 秒）。

- **mx-ui の `VitalsSnapshot` に合わせてあるのはフィールド名である。**
  `healthPoints` / `maxHealthPoints` / `hungerPoints` / `maxHungerPoints` /
  `experienceLevel` / `experienceProgress` の 6 つを `vitalsView` が出す。
  残る 2 つ（`hotbar` / `selectedHotbarIndex`）はインベントリ側であり、
  **選択中スロットは mc-sim にまだ無い**。状態なので来るときはここに来るが、
  呼び手のいない公開 API を先に生やすのは plan.md §8 の第 2 リスクそのものなので、
  `domain/vitals.ts` に行き先つきで名指ししてある。

- **プレイヤーの体力が `EntityManager` の台帳に入らない理由。** §3.1 の
  「最大体力を持たない」は **kind の表**についての議論であり、プレイヤーはその表の行ではない。
  プレイヤーは 1 人しかおらず、mx-ui はハートの本数を知るために `maxHealthPoints` を要求し、
  空腹と経験値は他の誰にも存在しない。台帳に入れればクリーパーが飽和度を持つことになる。

### 3.5 実績 / 統計 —— 記録だけを持つ

`domain/statistics.ts` / `application/statistics-service.ts`。**実装済。**
本行で働いている語は **記録** である。この行には 3 つのものがあり、ここにあるのは 1 つ目だけ。

1. **何が今までに起きたか** —— 集計と、解除済み実績の集合。状態、セーブ対象、所有者 1 つ。**ここ。**
2. **何をイベントと数えるか** —— ブロックを壊したのは採掘イベントか、日光で死んだクリーパーは
   キルか。ルール。mx-gameplay。
3. **実績の解除条件と前提実績** —— 参照実装は
   `isUnlocked: (stats) => boolean` の表と不動点掃引である
   （`achievement/achievement.ts:10-44`）。**世界に対する述語の表はルール表である。**
   mc-sim は `unlock` と言われて記録するだけで、レジストリも述語も持たない。

**カウンタが名前付きフィールドではなく開いた map なのはなぜか。** 参照実装の
`Statistics` は 8 つの名前付きフィールドを持つ（`statistics/statistics.ts:9-18`）が、
その内訳は `Partial<Record<EntityType, number>>` である。`EntityType` は **Mob のロスタ**であり、
§3.1 がまさに mc-sim に持たせないと決めたものである。そして名前付きフィールドは、
9 個目の統計が「6 リポジトリが読む公開面の変更」になることを意味する（plan.md §8 第 2 リスク）。
**代償は引き受けてある** —— mc-sim は `blocks.mined` が
`blocks.mined.stone` の和であるべきだと言えない。キーを書く側がその関係を所有する。

### 3.6 設定状態 —— 値の保持だけを持つ

`domain/settings.ts` / `application/settings-service.ts`。**実装済。**
括弧の中（画面は mx-ui、適用は各所）が境界のすべてである。読んで何かを決めるフィールドは
ここに属さない。参照実装の `GRAPHICS_PRESETS` / `resolvePreset`
（`settings-service.config.ts:26-70`）は `'high'` を 14 個のレンダラつまみ
（THREE のピクセル型定数を含む）に変える表であり、それは**適用**で mc-render のものである。

参照実装の `SettingsSchema` は 18 フィールド。ここには 9 つある。**断った 9 つのほうが有用である。**

| 断ったもの | 理由 |
| --- | --- |
| **`dayLengthSeconds`**（schema:54） | **これが重要。** 日長は既に mc-sim が持っている —— `TimeState` の**分母**であり、`domain/time-of-day.ts` はそれを変えると何が起きるかを説明するために存在している。ここにも置けば **1 つのリポジトリの中に 1 つの数の所有者が 2 人**いることになる。`mx-gameplay/docs/architecture.md:142-148` が記録している失敗と同じ形である。参照実装はまさにこれをやっており、そのミッドセッション `setDayLength` が `domain/time-of-day.ts` 冒頭に名指しされている live bug である |
| `difficulty`（schema:55） | peaceful は「敵性 Mob がスポーンしない」「空腹でダメージを受けない」であり、どちら向きにもルール |
| `reducedMotion` / `uiScale` / `colorVisionMode` / `audioCaptionsEnabled`（schema:56-65） | 消費者が全部画面。mx-ui は `domain/accessibility.ts` と `domain/caption.ts` を既に持つ。本行が挙げる 3 分類に**表示**は無い |
| `adaptivePerformanceMode`（schema:70） | グラフィックスの値ではあるが、これが有効化するのは **`graphicsQuality` を実行時に下げる mc-render のアルゴリズム**である。フラグをここに置きつつ隣のフィールドをあちらが書き換えるのは、mc-sim が持つ値の第 2 の書き手を作ることである |
| `ResolvedGraphics`（schema:14-46） | 14 個のレンダラつまみ。適用 |

**デフォルト値は測定ではなく転記である。** `renderDistance: 5` は参照実装で
「the perf floor measured in the parity doc」を根拠にしているが、その文書は mc-sim に無く、
その測定は mc-sim では繰り返せない。`mx-gameplay/docs/responsibility.md` §5-4 が要求する最低条件
（転記であることを定数の doc comment に明記する）をそのまま満たしてある。
`audioEnabled: false` は特に読み返す価値がある —— 参照実装の根拠は
「audio causes noise during development and testing」であり、**プレイヤーではなく開発ループについての主張**である。

**`SettingsService.reset` はここだけ意味が違う。** 他の 5 サービスの `reset` は
「このワールドを捨てる」だが、設定はワールドではない。ワールド teardown 経路に繋いだホストは、
別のセーブを開くたびにプレイヤーの設定を無音で工場出荷状態に戻す —— クラッシュもエラーも無く、
「設定が勝手に戻る」以外のバグ報告が書けない欠陥である。
DN-09 が要求するので存在し、意味は設定画面の RESTORE DEFAULTS ボタンだけである。
`test/settings.test.ts` がこの失敗に名前を付けて固定している。

### 3.7 次元 —— 語は mc-worldgen のもの、状態はここ

`application/player-service.ts` の `dimension` / `setDimension`、および
`domain/worldgen-vocabulary.ts`。**実装済。**

**この行が長らく空いていた理由は、メソッドが未実装だったからではない。**
`mx-gameplay/domain/player-port.ts` が欠けているものを名指しで記録していた ——
「the missing thing is an OWNERSHIP DECISION and not an unwritten method」。
`Dimension` という語をどのリポジトリが所有するかが決まっておらず、
決まらないうちにここで union を書けば、本プロジェクトが 5 回記録した
「二つの綴り」になる。閉じた union はメンバ集合そのものが型だからである。

**決着: 語は mc-worldgen が所有する。** kernel には `Dimension` 型が無く
（実測、`block-registry.ts` の無関係なコメント 1 件のみ）候補ではあっても現職ではない。
参照実装は `packages/world`（= mc-worldgen）に宣言しており、
**その union を読むルールを既に所有しているのも mc-worldgen** である。
mc-worldgen が barrel に出したので、ここは `domain/worldgen-vocabulary.ts` に
**文字単位で転記**している。`domain/kernel-vocabulary.ts` に足していないのは、
あのファイルを置き換えるのは `@nerima-games/mc-kernel` であり、
kernel は `Dimension` を出さないからである（ミラーの住所は
「どの barrel が置き換えるか」で決まる）。

**mc-sim はこの値で分岐しない。** `if (dimension === 'nether')` は 1 つも無く、
あってはならない。ネザーの何が違うか —— 天井、溶岩湖、ポータル連結、湧くもの ——
は生成（mc-worldgen）とルール（mx-gameplay）であって、状態ではない。
`DamageCause` の文字列を保存して一度も読まないのと同じ姿勢である。

**`moveTo` と `setDimension` を 1 本に融合しなかった。** 融合すれば
「切り替えずに動く」が表現不能になり、それは mx-gameplay が記録している欠陥
（別世界の座標系の目的地を、切り替えていない世界に適用する）を型で防げる。
それでも 2 本なのは、`moveTo` 単独が**世界の中のあらゆる通常移動**
——歩行・リスポーン・同一次元内テレポート—— であり、こちらのほうが桁違いに多いからである。
融合すればホットパスに `Dimension` 引数が乗り、呼び手は自分が既に居る次元を
毎回書き直すことになる。**対にするのは呼び手の責任であり、それはルールなので mx-gameplay にある**
（`mx-gameplay/domain/portal-travel.ts`）。両順序が同じ状態に落ちることは
`test/player-service.test.ts` が固定している。

**`restore` は 2 引数になった。** 片方だけ復元する `restore(pose)` は、
ネザーで取ったセーブをオーバーワールドの同座標で開く —— クラッシュもエラーも無く、
「セーブが変な場所で開く」以外のバグ報告が書けない欠陥である。
省略可能な引数はそれを全ての既存呼び手に対して起こすので、**必須**にしてある。
`reset` も次元を戻す。片方だけ戻す teardown は §3.6 が
`SettingsService.reset` について記録した失敗と同じ形である。

## 4. 親と子

### 親（mc-sim が依存する）

| リポジトリ | 使うもの | 未公開のため現状 |
| --- | --- | --- |
| `mc-kernel` | 語彙全般（ブランデッド型、座標、`CameraPoseSnapshot`、Clock Port、`GameModule`） | `domain/kernel-vocabulary.ts` に暫定ミラー |
| `mc-physics` | `integrateBody(state, dt)`、`resolveBody(state, dt, options)`、AABB クエリ、voxel-DDA | `sim:physics` から使用 |
| `mc-save` | `defineFormat(name, version, schema, migrations)`、`StoragePort` | 未使用（`autosave.ts` は永続化 Effect を引数で受ける） |
| `mc-worldgen` | `generateChunk`、`BiomeService`、`ChunkStore`（物理のためにブロックを読む）、**`Dimension`** | `domain/worldgen-vocabulary.ts` に暫定ミラー（`Dimension` のみ）。§3.7 |

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
