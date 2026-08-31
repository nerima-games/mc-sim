---
"@nerima-games/mc-sim": patch
---

Pin mc-save 0.4.1 and mc-worldgen 0.3.1. mc-save 0.4.0 added an `undefinedFieldsAsNull` codec for named top-level fields; mc-sim's own inventory-slot `undefined` sentinel is an array element, a shape that codec explicitly does not cover, and no code in this repo currently converts `Inventory.slots` into `SimulationSave.player.inventory` — the save-boundary type already declares that field as `T | null` on both sides, so no boundary code changed here. mc-worldgen 0.3.0 dropped its local `portal-frame` duplicate in favor of re-exporting from `@nerima-games/mc-kernel`; mc-sim only imports `Dimension`, `Chunk`, and `chunkSnapshotOf` from mc-worldgen, none of which moved, so no call sites changed. No source changes were required beyond the two pins.
