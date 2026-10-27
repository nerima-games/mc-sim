---
"@nerima-games/mc-sim": minor
---

Move to `effect` 4 and `@nerima-games/mc-kernel` 0.9.0. Inventory APIs now expose the kernel's branded `ItemType` and typed stack-construction `Result`s; player and container snapshot validators propagate `ItemStackFailure`. Callers must handle the returned failures. Identical inputs retain deterministic simulation behavior.
