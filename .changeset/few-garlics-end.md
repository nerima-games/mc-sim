---
"@nerima-games/mc-sim": minor
---

Integrate the Effect 4 and mc-kernel 0.10 simulation contracts, item and station state, service ports, and deterministic core tick. Validate state transitions before persistence and make fixed-step interpolation use the configured step duration.

Align the mc-kernel dependency to 0.11.0 so downstream worldgen APIs resolve against a single branded kernel.
