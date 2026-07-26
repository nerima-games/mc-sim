# 移植元と実測 LOC

参照実装 `takeokunn/ts-minecraft`（凍結・仕様書兼テストオラクル）からの移植元一覧。
**LOC はすべて本ドキュメント作成時に `wc -l` で実測した値**であり、plan.md の見積りではない。

計測条件（明示しないと再現できないため）:

```console
# production LOC: .ts のうち *.test.ts / *.spec.ts を除く（node_modules / dist は対象外）
$ find <dir> -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' | xargs cat | wc -l
# test LOC: *.test.ts / *.spec.ts のみ
```

`packages/*/test/` 配下のヘルパ（`*-test-utils.ts` 等）は `.test.ts` ではないため
**production 側に計上される**。参照実装はこのファイル名規約なので、数値を読むときは注意すること。

## 1. サマリ

| 移植元 | production | test | ファイル数(prod) | plan.md の記載 | 判定 |
| --- | ---: | ---: | ---: | --- | --- |
| `packages/entity`（全体） | **10,865** | 23,654 | 199 | 「10.9k」 | 一致 |
| `packages/inventory` | **4,474** | 10,331 | 59 | 「4.5k」 | 一致 |
| `packages/game`（全体） | **4,794** | 9,979 | 64 | — | — |
| `packages/game` の physics 以外 | **3,341** | — | — | 「3.3k」 | 一致 |
| **mc-sim への移植量（合計）** | **約 13,762** | 約 44,000 | | 「約18.7k」相当 | §1.1 参照 |

### 1.1 plan.md の合計との差

plan.md §3.8 は移植元として entity 10.9k + inventory 4.5k + game 非physics 3.3k = **18.7k** を挙げる。
しかし §3.11（mx-gameplay）が **`packages/entity` の mob 関連 4,918 LOC を mx-gameplay へ**持っていく
（実装コードだけなら 4,722。差の内訳は下記）。
両方を額面どおり読むと mob/ が二重計上になる。実測で切り分けると:

| 区分 | production LOC |
| --- | ---: |
| `packages/entity` 全体（`test/` ヘルパ 481 行を含む） | 10,865 |
| うち mob 関連（`application/mob` + `domain/mob` + `test/mob`、mx-gameplay 行き） | **4,918** |
| **`packages/entity` の mc-sim 取り分** | **5,947** |

したがって **mc-sim への実移植量は 5,947 + 4,474 + 3,341 = 13,762 LOC**。
plan.md の 18.7k は mob/ を含んだ数字である。

#### 4,918 と 4,722 —— mx-gameplay の数字との突き合わせ

mx-gameplay の [porting.md](https://github.com/nerima-games/mx-gameplay/blob/main/docs/porting.md) §3-1 は
同じ mob/ を **4,722**（91 ファイル）と実測している。**食い違いではない。**

**差の 196 行は `packages/entity/test/mob/test-utils.ts` ちょうど 1 ファイルである。**

```console
$ find packages/entity/application/mob packages/entity/domain/mob \
    -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' | xargs cat | wc -l
4722
$ wc -l packages/entity/test/mob/test-utils.ts
196
```

| 数え方 | 走査対象 | LOC |
| --- | --- | ---: |
| 実装コードのみ（mx-gameplay の移植見積） | `application/mob/` + `domain/mob/` | **4,722** |
| 本書の production 規則（`test/` ヘルパ込み） | 上記 + `test/mob/` | **4,918** |

本書は冒頭で「`packages/*/test/` 配下のヘルパは `.test.ts` ではないため production 側に計上される」と
宣言しており、`packages/entity` 全体の 10,865 も同じ規則で数えている（うち 481 行が `test/` ヘルパ）。
**だから本書の引き算では 4,918 を使うのが正しい。** 10,865 から 4,722 を引くと、
`test/mob/test-utils.ts` の 196 行が mc-sim 取り分に紛れ込む。

実装コードだけで見たい場合の対応表:

| | `test/` ヘルパ込み（本書の規則） | 実装コードのみ |
| --- | ---: | ---: |
| `packages/entity` 全体 | 10,865 | 10,384 |
| うち mob 関連 | 4,918 | 4,722 |
| **mc-sim 取り分** | **5,947** | **5,662** |

**移植の作業量を見積もるときは実装コードのみの列を、`wc -l` の再現性を確認するときは
本書の規則の列を使うこと。列をまたいで引き算しないこと。**

ただし plan.md §7 は「Mob（状態管理は sim、AI/スポーン/ドロップのルールは gameplay）」とも書いており、
mob/ の実装コード 4,722 LOC は**丸ごと mx-gameplay ではなく分割される**。分割比は移植時に判断する。
`entity-manager-entity-map.ts` (20) / `entity-manager-cache.ts` (15) /
`entity-manager-entity-mutation.ts` (174) のような台帳側は mc-sim、
`entity-manager-ai-*.ts` / `entity-manager-creeper-detonation.ts` /
`entity-manager-daylight-burn.ts` のような挙動側は mx-gameplay。

## 2. `packages/entity` の内訳（実測）

| ディレクトリ | production LOC | 行き先 |
| --- | ---: | --- |
| `packages/entity/` (index.ts) | 111 | mc-sim |
| `application/` (直下) | 1,490 | mc-sim |
| `application/mob/` | 2,586 | 分割（大半 mx-gameplay） |
| `application/redstone/` | 329 | **mx-redstone** |
| `application/trading/` | 169 | mx-gameplay |
| `application/village/` | 431 | mx-gameplay（構造物自体は mc-worldgen） |
| `domain/` (直下) | 1,400 | mc-sim |
| `domain/achievement/` | 178 | mc-sim（記録）+ mx-ui（画面） |
| `domain/mob/` | 1,292 | 分割 |
| `domain/mob/ender-dragon/` | 357 | mx-gameplay |
| `domain/mob/mobs/` | 487 | 分割 |
| `domain/redstone/` | 548 | **mx-redstone** |
| `domain/statistics/` | 65 | mc-sim |
| `domain/trading/` | 46 | mx-gameplay |
| `domain/village/` | 895 | mx-gameplay |
| `test/` 配下のヘルパ | 481 | 移植先のテストへ |

**注意**: `packages/entity` に redstone が 877 LOC（`application/redstone` 329 +
`domain/redstone` 548）ある。plan.md §3.12 は mx-redstone の移植元を
「redstone-*-effects 6ファイル(618 LOC) + phase-16 のブロック群」としか書いておらず、
この 877 LOC に触れていない。**mx-redstone 側で再確認が必要。**

### 2.1 個別サービス（実測 `wc -l`、関連ファイル合計）

| サービス | production LOC | 備考 |
| --- | ---: | --- |
| `entity-manager*`（39 ファイル） | 2,327 | mob/ 配下。分割対象 |
| `movement-service.ts` | 255 | |
| `health-service*`（config 含む） | 239 | `Ref.modify` の手本（:68-86） |
| `hunger-service*` | 113 | |
| `player-service.ts` | 77 | 再入可能性の反面教師（:15-18） |
| `statistics-service.ts` | 47 | |
| `achievement-service.ts` | 38 | |
| `xp-service.ts` | 37 | |
| `camera-state` 系 4 ファイル | **146** | 内訳は §2.2 |

### 2.2 カメラ関連（DN-01 の当事者）

| ファイル | LOC | 備考 |
| --- | ---: | --- |
| `application/camera-state.ts` | 55 | THREE import 無し。yaw/pitch を保持 |
| `application/first-person-camera-service.ts` | 48 | |
| `application/third-person-camera-service.ts` | 30 | |
| `domain/camera-state.ts` | 13 | `PITCH_LIMIT = Math.PI / 2 - 0.01` (:12-13) |
| **合計** | **146** | |

読み戻し側（mc-sim には移植せず、**削除**する構造）は `packages/app/application/frame/stages/` にある。
一覧は [design-notes.md](./design-notes.md) DN-01。

## 3. `packages/inventory` の内訳（実測）

| ディレクトリ | production LOC |
| --- | ---: |
| `application/` | 2,808 |
| `domain/` | 1,257 |
| `test/` 配下のヘルパ | 395 |
| `infrastructure/` `presentation/` | 0（空） |

主要ファイル: `inventory-service.ts`（14 メソッド、:22-101）、`inventory-service-state.ts`、
`chest-service*`、`furnace-service*`（6 ファイル）、`equipment-service*`、`recipe-service*`、
`hotbar-service.ts`、`inventory-rollback.ts`。

**分岐判断**: かまど（`furnace-service*`）は「焼ける時間」という tick 進行を持つ。
状態は mc-sim、レシピ表も mc-sim（plan.md §7「クラフト・かまど…: sim(レシピ/状態) + ui(画面)」）。
「燃料を入れたら燃え始める」というルールが mx-gameplay かどうかは要判断。

## 4. `packages/game` の内訳（実測）

`packages/game` は physics を含むため、mc-physics と mc-sim に分かれる。

| 区分 | production LOC | 行き先 |
| --- | ---: | --- |
| physics 関連（下記 grep でマッチする 13 ファイル） | **1,453** | **mc-physics** |
| それ以外 | **3,341** | **mc-sim** |
| 合計 | 4,794 | |

physics 側の切り分けは `physic|collision|aabb` にマッチするファイル:

```
packages/game/domain/aabb-collision.ts                        361
packages/game/domain/player-physics.ts                        310
packages/game/domain/block-collision-predicates.ts            208
packages/game/test/physics-builders.ts                        199   ← test ヘルパ
packages/game/application/physics-service.ts                  151
packages/game/infrastructure/boundary/physics-world-service.ts 57
packages/game/domain/aabb-collision-shapes.ts                  56
packages/game/domain/physics-port.ts                           29
packages/game/domain/physics-body.ts                           25
packages/game/application/physics-service-schema.ts            17
packages/game/domain/physics-world.ts                          16
packages/game/domain/physics-shape.ts                          12
packages/game/application/physics-service-error.ts             12
                                                     合計   1,453
```

**この 1,453 は plan.md §3.4 の「1,453 LOC」と完全一致する。** plan.md がこの grep 条件で
計数したことが分かるので、mc-physics 側もこの切り分けを使えばよい。

### 4.1 mc-sim 取り分（3,341 LOC）の主要ファイル

| ファイル | LOC | 対応する設計注意 |
| --- | ---: | --- |
| `application/game-state-update-orchestration.ts` | 319 | |
| `application/game-state-service.ts` | 268 | DN-09（reset の後付け :87-92） |
| `application/game-loop.ts` | **260** | **DN-02 / DN-03**（:119 のクランプ、:133/:228 の forkDaemon、:141-148/:198-201 のコメント） |
| `infrastructure/settings-storage-service.ts` | 151 | |
| `application/settings-service.ts` | 107 | |
| `application/settings.schema.ts` | 79 | |
| `application/settings-service.config.ts` | 70 | |
| `application/time-service.ts` | **59** | **DN-04** |
| `application/time-service-state.ts` | **53** | **DN-04**（:32-33 分母、:45-48 / :50-53 の非可換性） |
| `application/game-state-support.ts` | 53 | |
| `application/game-state-player-sync.ts` | 30 | |
| `application/game-loop-pacing.ts` | 28 | |
| `application/game-state-errors.ts` | 18 | |
| `application/game-state.types.ts` | 16 | |
| `domain/settings-storage-port.ts` | 14 | |
| `application/settings-service-environment.ts` | 7 | |
| `test/game-state-test-utils.ts` | 146 | test ヘルパ |
| `test/settings-service-test-utils.ts` | 109 | test ヘルパ |

`packages/game` には `sound-caption-port.ts` と `domain/audio-engine-port.ts` もあるが、
これらは **mc-audio** 行き（plan.md §3.6 / §4.3）。

## 5. 本リポジトリ外だが mc-sim と対になるもの

| 移植元 | LOC | 行き先 | mc-sim との関係 |
| --- | ---: | --- | --- |
| `packages/app/application/main/session-autosave.ts` | 74 | **mc-sim**（`application/autosave.ts` の元） | DN-05。既に移植済み |
| `packages/app/application/main/session-bootstrap-world-presentation-time.ts` | — | mc-compose | DN-04 の正しい呼び順の唯一の例（:26-27） |
| `packages/app/application/frame/stages/input-stage-runtime.ts` | — | mx-ui / mc-compose | DN-04 を壊している呼び出し（:17-30） |
| `packages/app/application/frame/stages/` の camera 読み戻し 13 箇所 | — | **削除** | DN-01 |
| `packages/app/application/frame/stages/render-stage.ts` | — | mc-render | :41-48 / :98-100 の生カメラ変形 |

## 6. テスト資産の移植

plan.md §6 Step 2: 「各Stepで参照実装の対応テスト・fixture・E2Eシナリオをオラクルとして移植し、
既知バグ（§3各所の設計注意）の再発を防ぐ」。

| 移植元テスト | LOC | 優先度 |
| --- | ---: | --- |
| `packages/game` の `*.test.ts` | 9,979 | 高（game-loop / time-service） |
| `packages/inventory` の `*.test.ts` | 10,331 | 高 |
| `packages/entity` の `*.test.ts` | 23,654 | 中（mob/ 分を除く） |

plan.md 冒頭は参照実装の資産を「9,177 ユニットテスト・E2E 64本」と書く。
E2E の実測は **23 ファイル / `test(` 70 箇所**（`e2e/**/*.e2e.ts`）であり、64 とは一致しない。
**この差分は mc-compose 側で決着済みである** ——
[porting.md](https://github.com/nerima-games/mc-compose/blob/main/docs/porting.md) §0 が
同じ 70 本 / 23 ファイル / 2,875 LOC を確定させ、「plan.md の 64 本と食い違う（+6）」と記録している。
移植計画に使う数字は **70** である。

## 7. 移植しないもの

| 参照実装の要素 | 理由 |
| --- | --- |
| `Effect.Service` によるサービス定義 | `Context.Tag` + 明示 Layer に置き換える（[public-api.md](./public-api.md) §0） |
| カメラ読み戻しの 13 箇所 | 構造ごと廃止（DN-01） |
| `packages/game/application/game-loop.ts` の `requestAnimationFrame` 直呼び | `submitFrame` による注入に置き換え（Node でテストするため） |
| `lastTimestamp === 0` の番兵 | `undefined` に置き換え（DN-03） |
| `addBlock` の `InventoryError` 失敗チャネル | leftover の戻り値に置き換え（[public-api.md](./public-api.md) §4） |
