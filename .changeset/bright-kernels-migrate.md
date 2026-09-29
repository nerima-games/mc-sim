---
"@nerima-games/mc-sim": minor
---

`mc-kernel` 0.8.0、`mc-physics` 0.3.0、`mc-save` 0.5.0 の公開契約へ移行します。

- inventory の `ItemStack` は kernel 所有の解決済み canonical shape（`item` / `count` /
  `components`）になり、`itemStack`、`maxStackCountForItem`、`addItemStack` を kernel の
  型・実装へ委譲します。空 slot は `undefined`、`count: 0`、未解決 component patch、
  durability の sidecar は公開 stack shape に含めません。
- `TimeServiceApi.dayLengthSecs` は `Effect.Effect<number>` から
  `Effect.Effect<FixedDurationSecs>` になります。`Dimension` は `mc-worldgen` ではなく
  `mc-kernel` が所有します。`Statistics` と `StatisticKey` / `AchievementId`、vehicle の
  型と ID、block-interaction の decision 型も kernel 所有型を再輸出します。crop、player、
  save coordinator、vehicle の dimension 引数も同じ kernel 型を使います。
- `save` の wire schema は version 3 とし、canonical `ItemStack` の `components` を保存します。
  v1 / v2 の envelope と、components を持たない旧 stack shape は暗黙修復せず
  `SaveDecodeError` で拒否します。player / container / equipment の snapshot でも旧
  `{ item, count }` shape を受理しません。

この変更は 0.x の公開型・保存形式を変更するため minor release です。release declaration の
差分は `application/game-loop.d.ts`、`application/inventory-interaction.d.ts`、
`application/player-service.d.ts`、`application/save-coordinator.d.ts`、
`application/time-service.d.ts`、`application/vehicle-service.d.ts`、
`domain/block-interaction.d.ts`、`domain/crop.d.ts`、`domain/frame-timing.d.ts`、
`domain/inventory.d.ts`、`domain/save-data.d.ts`、`domain/statistics.d.ts`、
`domain/vehicle.d.ts` の 13 ファイルに及びます。
