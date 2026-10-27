---
"@nerima-games/mc-sim": minor
---

Integrate the Effect 4 and mc-kernel simulation contracts, item and station state, service ports, and deterministic core tick. Validate state transitions before persistence and make fixed-step interpolation use the configured step duration. Export Effect Schemas for public operation results and add decoder checks for their success and declared error channels.

Align mc-sim's direct `@nerima-games/mc-kernel` dependency to 0.11.0 for consumers combining its public branded types with mc-worldgen 0.7.0. This pin does not change the kernel versions required by transitive dependencies.
