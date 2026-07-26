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
mc-sim が `1.0.0` を出せるのは、以下がすべて満たされたとき。

1. **[testing.md](./testing.md) §2 の完了条件を満たしている。**
   テスト green **かつ**内蔵障害物コースプレビューが操作可能。
2. **APIロックファイルが 4 週間変更されていない**（plan.md §6 Step 3）。
   ツール選定（plan.md §9 の未決事項「api-extractor 相当の Effect-TS 互換手段」）は決着し、
   `api-lock.md` / `scripts/api-lock.ts` / `pnpm api:check` として実装済み（[public-api.md](./public-api.md) §6）。
   **計測の起点は `api-lock.md` が最後に変わったコミット**であり、主観の入らない事実になった。
3. **下流が実際に消費して契約を確認している。** 少なくとも mc-render と
   mc-playground-kit が mc-sim を使って動いていること。使われていない界面に
   「壊さない」と約束しても意味がない。
4. **[public-api.md](./public-api.md) §5 の未設計 API が埋まっている。**
   ただし**チャンクダーティ通知はここには来ない**。plan.md §3.8 はそれを mc-sim の API に
   挙げているが、フラグを持つのは §3.7 により mc-worldgen であり、worldgen は sim を
   呼べない（循環）。sim が公開するには毎フレーム全チャンクをポーリングするしかなく、
   それは §3.11 の O(chunks × blocks) の失敗そのものになる。チャンネルはフラグと同じ
   場所 —— `mc-worldgen` の `ChunkStore.subscribeDirty` —— に置かれた。
   根拠は `mc-worldgen/docs/public-api.md` §6-2。
5. `domain/kernel-vocabulary.ts` が削除され、`@nerima-games/mc-kernel` を
   `dependencies` から参照している（§5 参照）。

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

## 5. `domain/kernel-vocabulary.ts` の削除

**publish 運用より前に片付ける負債。**

nothing-is-published のブートストラップ問題を回避するため、mc-kernel の語彙のうち
mc-sim が使う分だけを `domain/kernel-vocabulary.ts` にミラーしてある。
mc-kernel が publish されたら:

1. `@nerima-games/mc-kernel` を `package.json#dependencies` に追加
2. `domain/kernel-vocabulary.ts` を削除
3. `from './kernel-vocabulary'` を `from '@nerima-games/mc-kernel'` に置換

**これで型検査が通らなければ、ミラーが drift しており、その drift 自体がバグである。**
ミラーは意図的に最小（mc-sim が実際に使う分だけ）にしてあり、これは「正直に保つ対象を小さくする」ため。

### 5-1. 「最小」の唯一の例外 — Clock Port は**丸ごと**ミラーする

`ClockPort` は `Context.Tag` であり、Effect は Tag を**その文字列キー**
（`'@nerima-games/mc-kernel/ClockPort'`）で解決する。
同じキーから作られた 2 つのクラスは、TypeScript にとっては無関係な名前的別型でありながら、
**実行時には同じサービス**である。

したがって `ClockService` の**狭い**ミラーは「語彙が少ない」ではなく**サイレントな実行時ハザード**である。
1 フィールドのミラーに対して組んだ `Layer` が 2 フィールドの Tag を満たしてしまい、
足りないフィールドは、このファイルを見たことのないリポジトリで `undefined` として読まれる。

**これは実際に起きていた。** mc-sim のミラーは `monotonicSecs` の 1 フィールドで、
mc-kernel と mc-playground-kit は 2 フィールドだった。
mc-playground-kit は mc-sim に依存するので、両者は同じバンドルに同居する。

そのため、mc-sim が壁時計を 1 度も読まないにもかかわらず、
`EpochMillis` / `fixedClock` / `wallClockEpochMillis` とオブジェクト引数の `FixedClockLayer` まで
ミラーしてある。`test/kernel-mirror.test.ts` が Tag キーと形を**両方向で**固定しているので、
次の drift はフレームではなく CI で落ちる（[testing.md](./testing.md) §3.1）。

ミラーの drift が「削除して import に置き換えれば通る」という約束を破る唯一の経路であり、
その約束はこの節の 3 手順そのものである。

### 5-2. 2 つ目の例外 — `ITEM_TYPES` は**16 件すべて**ミラーする

閉じたリテラル union では、**メンバの集合そのものが型**である。
mc-sim のレシピ表が使う 6 個だけを写したミラーは「語彙が少ない」ではなく*狭い別の型*で、
`isItemType('sand')` がここでは `false`、kernel では `true` になる。
逆向き（mc-sim の都合でロスタに 1 個足す）はもっと悪い: ローカルでは通り、
kernel の `ItemType` が拒否するレシピ表を出荷し、**壊れるのはミラーを削除する日**である
—— この節が「何も起きない日」だと約束している、まさにその日である。

したがってロスタを増減させるのは mc-kernel の決定であって本リポジトリの決定ではない。
kernel 側では additive・MINOR、mc-sim 側では**ミラーとテストを同じコミットで更新する**だけの作業になる。
実際に足りなかった 7 個の要求は [public-api.md](./public-api.md) §4.1-7 に値段つきで書いてある。

### 5-3. この付け替えは mc-sim の公開面を**壊した**（ウィンドウがリセットされた）

mc-kernel が `0.2.0` に上がり `api-lock.md` が変わって §3 の 4 週間ウィンドウがリセットされたのと
同じことが、ここでも起きている。`domain/kernel-vocabulary.ts` はミラーであって公開面ではないが、
**ミラーの型が mc-sim の署名に現れている**ためである。

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

**APIロックの diff チェックはこの表から外れた。** 完了条件を待たずに済ませてあり、
`pnpm api:check` が `pnpm verify` の `check:deps` と `test` の間で、また CI の独立ステップとして走る
（[public-api.md](./public-api.md) §6）。ビルド段が無いままで動くことが選定の条件だったので、
上の「ビルド」行が埋まるのを待つ必要が無かった。

## 7. 依存の固定

| 依存 | 現在 | 方針 |
| --- | --- | --- |
| `effect` | `^3.20.0` | 16 リポジトリで**同一メジャーに揃える**。Context / Layer の型が跨るため、メジャーが混ざると合成できない |
| `@nerima-games/*` | 未宣言 | publish 後は**厳密ピン**（`0.3.1` のように範囲なし）。plan.md の bottom-up publish-then-pin |
| `typescript` / `vitest` / `oxlint` | `^` 付き | ツールチェーンは揃えるが厳密ピンはしない |
| `packageManager` | `pnpm@9.15.0` | 16 リポジトリで同一 |

`engines.node` は `>=22.0.0`。`flake.nix` の devShell が `nodejs_22` を入れる。
