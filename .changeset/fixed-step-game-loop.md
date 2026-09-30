---
"@nerima-games/mc-sim": minor
---

Replace variable frame advancement with a branded fixed-step accumulator, kernel SimulationTick tracking, bounded catch-up, pause/resume controls, interpolation diagnostics, and overload reporting. Each 0.05-second tick runs two 0.025-second physics substeps. Remove the internal `domain/frame-timing` forwarder; root frame-timing names remain available as direct kernel re-exports, so consumers using the package root are unaffected while deep imports must migrate.
