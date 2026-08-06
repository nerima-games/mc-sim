# バージョニングと公開

## 1. 現状

| 項目 | 値 |
| --- | --- |
| `version` | `0.1.0` |
| 公開状態 | **未公開**。GitHub Packages にも上げていない |
| `main` / `types` / `exports` | **TypeScript ソースを直接指す**（`./index.ts`）。ビルド成果物ではない |
| ビルドパイプライン | **無い**。全 tsconfig が `noEmit: true` の検査専用 |
| `dependencies` | `effect` のみ |

## 2. なぜ `0.x` に留めるのか

plan.md §6 Step 3 / §8:

> 界面が安定した（APIロック4週間無変更）リポジトリから GitHub Packages 等へ npm 公開 +
> changesets 運用に切り替え。それまでは dev-meta workspace 統合で開発。

> **新規構築初期は全界面が高churn** → npm公開を遅らせ dev-meta workspace で開発（§6 Step 0）。
> bump連鎖を構造的に回避

mc-sim には**下流が 6 リポジトリある**（mc-render / mc-playground-kit / mx-gameplay /
mx-redstone / mx-ui / mx-multiplayer）。この段階で publish すると、mc-sim を 1 回 bump するたびに
6 リポジトリの `package.json` を更新し、そのうち mc-render / mx-* の bump がさらに
mc-compose に波及する。plan.md §8 が第 2 リスクに挙げる「API が揺れて全下流に波及」は、
まさにこの連鎖のことである。

開発中は `mc-dev-meta` workspace が 16 リポジトリの clone を `repos/` に並べ、
`workspace:*` 解決でモノレポ同等の DX を提供する（plan.md §6 Step 0-2）。
公開しなくても他リポジトリから使える状態はここで作る。

## 3. `0.x` → `1.0.0` の条件

`1.0.0` は「完成した」の意味ではなく「**この界面を壊さないと約束する**」の意味である。

**旧ゲートの廃止**: かつては「APIロックファイル（`api-lock.md`）が4週間変更されていない」という
日数計測ベースの自動フリーズゲートを条件の1つとしていた。この機構（`api-lock.md` /
`scripts/api-lock.ts` / `pnpm api:check`）は org 全体の方針として撤去された
（[API_STANDARD.md §4](../../.github/API_STANDARD.md)）。**代わりに、`1.0.0` への昇格は
maintainer(take)による裁量判断のみで行う**（[RELEASE_STANDARD.md §4.2](../../.github/RELEASE_STANDARD.md)）。
「〇〇日間 API 変更なし」のような定量的な代替ゲートは導入しない。

以下は昇格を判断する際に maintainer が参照する材料であり、自動ゲートではない。

1. **[testing.md](./testing.md) §2 の完了条件を満たしている。**
   テスト green **かつ**内蔵障害物コースプレビューが操作可能。
2. **下流が実際に消費して契約を確認している。** 少なくとも mc-render と
   mc-playground-kit が mc-sim を使って動いていること。使われていない界面に
   「壊さない」と約束しても意味がない。
3. **[public-api.md](./public-api.md) §5 の未設計 API が埋まっている。**
   ただし**チャンクダーティ通知はここには来ない**。plan.md §3.8 はそれを mc-sim の API に
   挙げているが、フラグを持つのは §3.7 により mc-worldgen であり、worldgen は sim を
   呼べない（循環）。sim が公開するには毎フレーム全チャンクをポーリングするしかなく、
   それは §3.11 の O(chunks × blocks) の失敗そのものになる。チャンネルはフラグと同じ
   場所 —— `mc-worldgen` の `ChunkStore.subscribeDirty` —— に置かれた。
   根拠は `mc-worldgen/docs/public-api.md` §6-2。
4. `@nerima-games/mc-kernel` を `dependencies` から参照し、共有語彙と `ClockPort` を
   直接 import している（§5 参照）。

mc-sim は依存ハブなので、**このプロジェクトで最後に `1.0.0` になるリポジトリのひとつ**になる想定。
早く 1.0.0 を出すことに価値はない。

### 3.1 `0.x` の間の運用

`0.x` では semver の互換保証が働かない（`^0.1.0` は `0.2.0` を受け入れない）。
mc-dev-meta workspace で開発している間は問題にならないが、publish 後 `1.0.0` 前の期間は:

- **破壊的変更 = minor bump**（`0.1.0` → `0.2.0`）
- **後方互換の追加・修正 = patch bump**（`0.1.0` → `0.1.1`）
- 下流は `~0.1.0` ではなく **`0.1.x` を明示ピン**して、意図しない minor 取り込みを防ぐ

## 4. GitHub Packages

`package.json`:

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com",
  "access": "restricted"
}
```

- スコープは `@nerima-games`。GitHub Organization `nerima-games` 配下のリポジトリと対応する。
- `access: restricted`（private）。plan.md §9 の未決事項「パッケージ公開先」は
  GitHub Packages で確定したものとして扱う。
- 消費側は `.npmrc` に `@nerima-games:registry=https://npm.pkg.github.com` と
  `//npm.pkg.github.com/:_authToken=...` が要る。**現在の `.npmrc` にはまだ書いていない**
  （公開物が無いため）。最初の publish と同時に 16 リポジトリ分を揃える。

## 5. `mc-kernel` 直接依存への移行（完了）

mc-kernel は公開済みなので、mc-sim は `@nerima-games/mc-kernel@0.2.18` を
`dependencies` から直接参照する。共有語彙、`ClockPort`、時間値は公開 package から
import し、ローカルの `domain/kernel-vocabulary.ts` と mirror-only test は削除済みである。

以前のミラーは `ClockPort` のサービス形状を狭める実行時ハザードを隠していた。
Effect は `Context.Tag` を文字列キーで解決するため、型だけが通る狭い `Layer` は
実行時に不足フィールドを残す。公開 package を直接利用することで、語彙と Port の定義は
一つの出所に揃う。

移行時に確認した条件:

1. source と test の kernel 語彙 import が `@nerima-games/mc-kernel` を指す
2. ローカルミラーとミラー専用テストが存在しない
3. `pnpm typecheck` と実行時テストが公開 package の契約を検証する

以下の §5-3 と §5-4 は、移行前の API-lock 運用と語彙拡張を記録した歴史節である。

### 5-3. この付け替えは mc-sim の公開面を**壊した**（歴史的記録。ウィンドウ機構自体は撤去済み）

**この節は api-lock 時代の記録として残す。** 当時は mc-kernel が `0.2.0` に上がり
`api-lock.md` が変わって §3 の 4 週間ウィンドウがリセットされる、という運用だったが、
そのフリーズウィンドウ機構自体が org 全体で撤去された（§3 冒頭「旧ゲートの廃止」参照）。
`domain/kernel-vocabulary.ts` はミラーであって公開面ではないが、
**ミラーの型が mc-sim の署名に現れている**ため、当時これも公開面の破壊的変更として扱われた。

| 差分 | 種別 |
| --- | --- |
| `ItemId`（公開型、`= string`）を**削除** | 破壊的 |
| `add` / `remove` / `countOf` / `addItem` / `removeItem` / `countOf` / `itemStack` / `exactly` / `ingredientMatches` / `shapedRecipe` / `shapelessRecipe` / `craftGrid` / `ingredientCost` の `ItemId` → `ItemType`（`string` → 閉じた union） | 破壊的（入力が狭くなる） |
| `ItemStack.item` / `Ingredient.item` / `MissingIngredient.item` の型 | 破壊的 |
| `NormaliseOutcome.discarded` を追加 | 追加（ただし返り値型の変更なので lock に出る） |
| `STARTER_RECIPES` の内容が 7 件 → 5 件 | 型は不変・**値**の変更（lock には出ない。[public-api.md](./public-api.md) §4.1-7） |

`exported declarations` は 112 → 111、`supporting declarations` は 22 → 24
（`ITEM_TYPES` と `ItemType` が署名から参照されるため）。
**§3 の条件 2 の起点は、このコミットに移動する。**

なお `index.ts` はこのミラーを **re-export していない**。consumer が mc-sim 経由で
kernel の語彙を取ると真実の出所が 2 つになり、上記の削除が破壊的変更に化けるためである。

### 5-4. ロスタが 16 → 23 になり、**ウィンドウがもう一度リセットされた（歴史的記録）**

§5-2 の要求が通り、kernel の `ITEM_TYPES` が 7 個増えた。ミラーを同じコミットで追随させた結果、
当時は `api-lock.md` が変わっている(この文書・機構は現在は廃止済み。§3 冒頭参照)。

| 差分 | 種別 |
| --- | --- |
| `ITEM_TYPES` のタプル型に 7 リテラル追加（`coal` / `iron_ingot` / `flint` / `gunpowder` / `blaze_powder` / `flint_and_steel` / `fire_charge`） | **追加**。ただし `ItemType = (typeof ITEM_TYPES)[number]` は**広がる** |
| `STARTER_RECIPES` の内容が 5 件 → 7 件 | 型は不変・**値**の変更（lock には出ない。[public-api.md](./public-api.md) §4.1-7） |

`exported declarations` は 111、`supporting declarations` は 24 のまま —— **宣言は増減していない**。
それでも §3 の条件 2 の起点は**このコミットに移動する**。理由は `ItemType` が
union として広がった側だからである:

- **入力位置**（`add` / `remove` / `countOf` / `itemStack` / `exactly` / `shapelessRecipe` …）では
  追加であり、既存の呼び出しは 1 つも壊れない。
- **出力位置**（`ItemStack.item` / `Ingredient.item` / `MissingIngredient.item`）では
  consumer 側が受け取る union が広がる。`ItemType` を**網羅的に**switch している consumer
  （mx-ui のアイテムアイコン表が該当しうる）は、7 ケース足りなくなる。
  「網羅性が壊れる」は型検査で落ちる変更であり、lock の宣言数が動かないことは
  その根拠にならない。

これは kernel 側の分類（additive・MINOR）と矛盾しない。MINOR は「既存の呼び出しが壊れない」で
あって「誰も何も直さなくてよい」ではなく、閉じた union を公開する型の宿命として、
**広がりは下流に伝播する**。当時の4週間ウィンドウはそれが落ち着くまでの期間だったが、
この機構は現在は撤去されている（§3 冒頭参照）。

## 6. ビルド / publish パイプライン（完了時に追加）

現在 `noEmit: true` で `exports` が `.ts` を指しているのは、**consumer が TypeScript を
直接コンパイルする前提**の暫定形。dev-meta workspace 内では動くが、publish 物としては不可。

完了条件到達時に追加するもの:

| 項目 | 内容 |
| --- | --- |
| ビルド | `tsconfig.build.json` の `noEmit` を外し `outDir: dist` + `declaration` |
| `exports` | `{ ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }` |
| `files` | `dist` 中心に変更 |
| changesets | plan.md §6 Step 3。bump とチェンジログの運用 |
| publish ワークフロー | `.github/workflows/` に追加。タグ or changeset 起点 |
| カバレッジ 99% ゲート | `vitest.config.ts` + CI（[testing.md](./testing.md) §5） |

`.gitignore` は既に `dist/` `build/` `out/` を無視するようにしてある。

**APIロック機構（`api-lock.md` / `scripts/api-lock.ts` / `pnpm api:check`）は org 全体の方針として
撤去された。** 破壊的変更の判定は自動ツールではなく人間のレビューで行う
（[API_STANDARD.md §3-4](../../.github/API_STANDARD.md)）。

## 7. 依存の固定

| 依存 | 現在 | 方針 |
| --- | --- | --- |
| `effect` | `^3.20.0` | 16 リポジトリで**同一メジャーに揃える**。Context / Layer の型が跨るため、メジャーが混ざると合成できない |
| `@nerima-games/*` | 未宣言 | publish 後は**厳密ピン**（`0.3.1` のように範囲なし）。plan.md の bottom-up publish-then-pin |
| `typescript` / `vitest` | `^` 付き | ツールチェーンは揃えるが厳密ピンはしない |
| `oxlint` | `flake.nix` の devShell（package.json の devDependency ではない） | 16 リポジトリで同一バージョンに固定し、npm 経由のバージョンドリフトを排除する |
| `packageManager` | `pnpm@9.15.0` | 16 リポジトリで同一 |

`engines.node` は `>=22.0.0`。`flake.nix` の devShell が `nodejs_22` を入れる。
