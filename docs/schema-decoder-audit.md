# Schema decoder audit

The source-wide audit searched `src/` with `rg -n 'Schema\.(filter|declare|refine)'` and inspected each match. The findings below are the declarations whose acceptance predicate delegates to a constructor or validation result. Such predicates can accept an input because it can be normalized, even when that input is not the declared output value.

| Schema | Acceptance path | Strict decoder replacement | Normalization entry point retained | Status |
| --- | --- | --- | --- | --- |
| `BrewingStateSchema` | `brewingState` supplies omitted fields and treats nullish bottle slots as empty | Required-field `Schema.Struct` using branded field schemas | `brewingState` for construction and `validateBrewingSnapshot` for snapshot restore | Complete |
| `BrewingServiceStateSchema` | `brewingState` accepts the service state | Compose strict brewing state and service fields | `brewingState` remains the construction function | Pending |
| `FurnaceStateSchema` | `furnaceState` defaults station and timers, then brands durations and slots | Required-field `Schema.Struct` using branded field schemas | `furnaceState` for construction and `validateFurnaceSnapshot` for snapshot restore | Pending |
| `FurnaceServiceStateSchema` | `validateFurnaceSnapshot` validates by constructing a furnace state | Compose strict furnace state with branded experience | `validateFurnaceSnapshot` remains the snapshot restore entry point | Pending |
| `SmeltingRecipeInputSchema` and `SmeltingRecipeOptionSchema` | `validateRecipe` accepts raw branded-field inputs and constructs branded IDs and durations | Strict union schemas for starter and kernel recipe variants | `validateRecipe` at recipe-table ingress | Pending |
| `ContainerStorageSnapshotSchema` and private `ContainerSchema` | `validateContainerStorageSnapshot` validates and copies persisted values into owned state | Strict schemas for stored stack, container, and snapshot shapes | `validateContainerStorageSnapshot` at persistence ingress | Pending |
| `PlayerStorageSnapshotSchema` | `validatePlayerStorageSnapshot` validates and copies persisted values into owned state | Strict schema composed from inventory, equipment, and durability schemas | `validatePlayerStorageSnapshot` at persistence ingress | Pending |
| `ContainerStoredStackSchema` | `isContainerStoredStack` probes `validateContainerStorageSnapshot` | Strict stored-stack schema | None; this predicate is replaced by the schema | Pending |

The audit also found `TimeStateSchema`, several direct brand predicates, and other `Schema.declare` uses. Those do not call a normalizing constructor or a validation-result function, so they are not in this finding list. The strict-decoder gate will separately test schemas with introspectable required fields.
