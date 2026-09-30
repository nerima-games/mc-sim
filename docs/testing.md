# テスト / 検証

## 1. 検証対象

mc-sim は、決定論的なドメインロジック、Effect のサービス、ステージ登録、操作可能な
プレビューを別々の層として検証する。

| 層 | 主な検証 | 目的 |
| --- | --- | --- |
| domain | `test/**/*.test.ts` の純粋関数テスト | ルール、境界値、状態遷移を固定する |
| application | Effect のサービスと `TestClock` / `Ref` | 時間、保存、原子性、ライフサイクルを固定する |
| stages | 登録テストと型検査 | 所有権と依存方向を固定する |
| preview | `apps/preview-sim/` の手動実行 | 数値の推移と操作可能なシナリオを人間が確認する |

Node のシナリオテストは CI で高速に走り、プレビューは `pnpm preview` で起動する。
プレビューはシミュレーションの状態を表示するが、移動・衝突・描画を mc-sim が所有する
わけではない。障害物コースの移動挙動は `mc-physics` などの体験層の責務である。

## 2. 必須コマンド

リポジトリのルートで、Corepack 管理の pnpm を使って実行する。

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | build、test、preview の三つの TypeScript 境界を検査する |
| `pnpm lint` | `src`、`test`、`apps` を oxlint で検査し、続けて `ast-grep scan` で構造的なルール（`no-type-assertion` など）を検査する |
| `pnpm build` | `scripts/clean-dist.mjs` で `dist/` を消し、`tsc -p tsconfig.release.json` で `dist/` を生成する（`tsdown` バンドルは廃止） |
| `pnpm test` | `test/**/*.test.ts` を Vitest で実行する |
| `pnpm test:coverage` | V8 の文・分岐・関数・行カバレッジを検査する |
| `pnpm verify` | 型検査、lint、通常テストを順に実行する |
| `pnpm package:verify` | `pnpm build` の後、`scripts/verify-package.mjs` で公開 export の一覧と `pnpm pack` した archive の内容を検証する |
| `pnpm preview` | 決定論シナリオを端末で確認する |
| `pnpm bench` | 爆発計画のホットパスを計測する（`verify` には入らない） |

`pnpm test:coverage` のしきい値は文・分岐・関数・行のすべて 100% である。カバレッジを
無視するコメントや、テストを選択しないことで通る設定は置かない。

## 3. 爆発計画のホットパスと計測

`planExplosion` は半径が大きいほど走査対象と遮蔽計算が増えるため、`scripts/benchmark-explosion.ts`
で半径 4、8、16 の固定シナリオを計測する。入力は seed 7、原点、全ブロックを耐性 0 の破壊可能な
ブロックとして固定し、計測前に同じ入力を 2 回実行して訪問数・破壊数・切り詰め状態の決定性を確認する。

計測は `uptime` の 1 分 load average が 10 未満のときだけ行う。計測方式は mc-noise の R-C5 方式に合わせる。20 回のウォームアップ後、9 回の奇数サンプルを取り、
各サンプルで `planExplosion` と、同じ半径の立方体セル数だけ整数加算する yardstick を交互に計測する。
比較は絶対ミリ秒ではなく `planExplosion / yardstick` の中央値で行うため、baseline はマシン固有の速度表ではなく、
同一プロセス内の回帰検知用である。baseline の guard tolerance は既定 1.3 倍、workload tolerance は既定 2.0 倍で、共有ランナーの wall-clock ノイズを
考慮した診断ゲートとする。

```console
pnpm bench
pnpm bench -- --workload-tolerance=3
pnpm bench -- --update-baseline
```

ベンチマークは `pnpm verify` と CI の通常テストには含めない。baseline を更新するときは、実装または計測方式の
意図した変更理由をレビュー記録に残し、ホスト名・会社名・秘密値を `scripts/bench-baseline.json` に保存しない。

## 4. プレビュー

`apps/preview-sim/` はゲームモジュールの公開 API ではなく、シミュレーションを人間が
確認するためのアプリケーションである。

```text
pnpm preview
pnpm preview -- --scenario obstacle-course
pnpm preview -- --stats
```

シナリオは入力列を一つずつ適用し、ポーズ、カメラ、ゲームクロック、日中時刻、インベントリ、
オートセーブの状態を表示する。`--scenario obstacle-course` はプレイヤーを座標へ移動する
スクリプトであり、衝突判定やジャンプの物理を実装したものではない。この境界を越えるには
物理・体験層を接続する必要がある。

## 5. 依存と時間の境界

共有語彙は所有元の公開パッケージを直接使う。

- `mc-kernel` は `ItemType`、ブロック、時計、金床などを所有する。
- `mc-worldgen` はワールド生成の型を所有する。
- `mc-save` は保存フォーマットとストレージ境界を所有する。
- `mc-physics` は物理の型と計算を所有する。爆発・Primed TNT・projectile・frame-timing クランプの
  計算そのもの（mc-physics = mc-kernel 実装）もここに含み、mc-sim は re-export するだけである。

これらの語彙を `src/domain` に複製したミラーは存在しない。`ClockPort` は mc-kernel から
直接 import し、Effect の `Clock` はサービス層で注入する。シミュレーションのコードは
壁時計を直接読まず、時間をテストから制御できる形にする。

## 6. テストの書き方

テストは実装の行数ではなく、利用者から見える不変条件を検証する。

- 純粋な計算は入力と結果を表にまとめ、正常値・境界値・不正値を同じ規則で確認する。
- Effect のサービスは `TestClock`、`Ref`、インメモリの保存ポートを使い、時間と外部状態を
  決定論的にする。
- 並行更新、保存からの復元、空スロット、未知のアイテム、無効なブロックなど、入力が
  欠けたり壊れたりする境界を優先する。
- 醸造、精錬、金床、保存、ブロック相互作用は、公開された結果と消費量を検証する。
- 共有ヘルパーはテストの重複を減らすために使うが、各テストは検証対象の不変条件を明示する。

テスト選択は Vitest の `include` によって非空の `test/**/*.test.ts` に限定する。全体テスト、
カバレッジ、型検査を別々に実行し、どれか一つの終了コードだけを成功の根拠にしない。

## 7. CI の順序

CI（`.github/workflows/ci.yaml`）は `nix develop` の中で次の順序で実行する。

1. GitHub Packages 認証を設定し、`pnpm install --frozen-lockfile` でインストールする。
2. `pnpm verify`（`pnpm typecheck && pnpm lint && pnpm test` の 3 段）を実行する。
3. `pull_request` かつ `release/*` ブランチでない場合のみ Changeset の有無を確認する。
4. `pnpm test:coverage` で 100% のしきい値を確認する。
5. `pnpm package:verify` で `dist/` を生成し、公開 export と pack した archive の内容を検証する。
6. `pnpm audit` で依存の既知脆弱性を確認する。

変更セットの確認はリリース運用の入力であり、実装の正しさを測るテストの代替ではない。
