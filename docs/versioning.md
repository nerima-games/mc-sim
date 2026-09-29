# バージョニングと公開

## 1. 現在のパッケージ形態

現在の `package.json` は次の公開境界を持つ。

| 項目 | 現在の方針 |
| --- | --- |
| バージョン | `package.json#version` を正とする。`0.x` のため破壊的変更は minor で表す |
| 実行時入口 | `dist/index.js` |
| 型入口 | `dist/index.d.ts` |
| 配布対象 | `dist`、`README.md`、`LICENSE` |
| Node / pnpm | Node 24 以上、pnpm 11.24.0 以上 |
| 公開 API | `src/index.ts` を入口にし、build で成果物を検査する |

`pnpm build` は `scripts/clean-dist.mjs` で `dist/` を消してから、`tsc -p tsconfig.release.json`
で `dist/` に JavaScript と宣言ファイルを直接生成する（`tsdown` によるバンドルは廃止した。
バンドルは `exports` サブパスと declaration map を壊し、mirror/repoint ゲートが読む型の
同一性を保証できないため）。TypeScript ソースしか公開していない段階ではないため、公開物の
import と型宣言の両方を検証対象にする。

## 2. `0.x` の運用

`0.x` では互換性を自動で約束しない。変更の種類は次のように扱う。

- 既存の入力・出力・型を壊す変更は minor bump。
- 後方互換な機能追加や修正は patch bump。
- 公開面を変える場合は、`src/index.ts`、生成された宣言、利用側のテストを同じ変更単位で確認する。

`1.0.0` は実装がすべて終わったことではなく、公開面を互換性のある契約として維持する
判断である。判断材料は、必須テストとプレビュー、実際の下流利用、未設計の公開 API の
解消、レビュー済みのビルド成果物とする。API の凍結日数を測る自動ロック機構は導入しない。

### 2.1 保存形式の版管理

`SIMULATION_SAVE_FORMAT` の現行 version は 2。v2 はホットバーの選択状態と
統計台帳（カウンタ / unlocked ID）を保存する。

**`mc-save` 0.3.0 以降は migration chain を提供しない**（`mc-save` の README.md
「旧版セーブを現行版へ自動変換する migration chain は提供しません」）。`loadFrom` は
format の現行 version のみを要求し、それ以外の version で保存された envelope は
`SaveDecodeError` として拒否される（サイレントな変換はしない）。v1 → v2 の自動移行は
0.2.2 世代の `mc-save` にのみ存在した機能で、`mc-save` を 0.3.0 に上げた時点で
`SIMULATION_SAVE_FORMAT` からも撤去した。移行コード自体は git 履歴に残る。

これは既存の公開 API を温存する互換アダプターではなく、保存形式そのものの版管理である。
現時点のセーブは 0.x の開発用セーブであり、v1 形式のセーブを読めなくすることは許容している。

## 3. 共有依存の直接利用

共有語彙は各パッケージが所有し、mc-sim は公開 API を直接 import する。

- `mc-kernel` はアイテム、ブロック、時計、金床などを提供する。
- `mc-worldgen` はディメンションなどのワールド生成型を提供する。
- `mc-save` は保存フォーマットを提供する。
- `mc-physics` は物理の計算と型を提供する。

ローカルの共有語彙ファイルは削除済みである。複製を残すと、型検査では見えない Tag や閉じた union のずれが
実行時に現れるためである。共有依存の更新は、上流パッケージの型・実行時挙動・このリポジトリ
のテストを同時に確認する。

**廃止（2026-08-30）**: 以前はここで `tsdown.config.ts` の `deps.alwaysBundle` により、TypeScript
ソースとして公開される依存を実行時バンドルへ含めていた。ビルドが `tsc -p tsconfig.release.json`
単体（バンドラなし）に切り替わったため、この節は成立しない。`dist/index.js` は依存の import
文をそのまま emit するので、依存自身が `dist/` を公開していない場合、Node の ESM ローダーは
`node_modules` 内の `.ts` を型除去できず（`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`）、
その依存への import で失敗する。

**現在の状態**: 固定している依存（版数の正は `package.json#dependencies`）はどれも
`main`/`exports` が `dist/index.js` を指し、`dist/` を公開している。上の失敗モードは今は
起こらず、`pnpm package:verify` の動的 import 検証が疑うのは mc-sim 自身のコードだけである。
ただしこれは固定された保証ではない。依存を追加・更新するたびに、その依存が `dist/` を
公開していることを確かめ、`pnpm package:verify` を通す。

## 4. 依存バージョン

| 依存 | 現在の扱い |
| --- | --- |
| `effect` | `3.22.1`（exact, `dependencies`）。Effect の Context / Layer を共有するため同一 major を使う |
| `mc-kernel` | `package.json#dependencies` |
| `mc-physics` | `package.json#dependencies` |
| `mc-save` | `package.json#dependencies` |
| `mc-worldgen` | `package.json#dependencies` |
| TypeScript | `7.0.2`（exact）。`@typescript/native` / `typescript6` エイリアスは廃止した |
| Vitest | `4.1.11`（exact）。`@effect/vitest` は `0.30.0` |

版数の正は常に `package.json#dependencies` であり、この表は依存の役割だけを示す。

依存を更新したら `pnpm install --frozen-lockfile`、`pnpm peers check`、`pnpm typecheck`、
`pnpm build`、`pnpm test:coverage` を実行する。特に Effect と依存パッケージの major を
混ぜない。Context.Tag と Layer の型は package identity を跨いで合成されるためである。

## 5. リリース前の確認

リリース候補では、次の順に確認する。

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm test:coverage`
5. `pnpm build`
6. `node --input-type=module` で `dist/index.js` を import し、代表的な公開 API を呼ぶ
7. `pnpm pack --dry-run` で `dist` とドキュメントだけが配布対象であることを確認する

変更セットや publish の実行はリリース担当の明示的な判断で行う。検証で見つかった
失敗を、タイムアウト延長・テスト除外・型の緩和で隠してはならない。
