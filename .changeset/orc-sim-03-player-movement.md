---
"@nerima-games/mc-sim": minor
---

Move the player through mc-physics `applyMovementInput`, `stepBody` and `applyMovementFriction`. Horizontal velocity now carries over between ticks (acceleration and friction instead of an instant `walkSpeed`), and `SimFrameState.velocity` holds the velocity after friction. Add `SimInputPort.setSneakIntent` and `SimFrameState.sneakIntent`: sneaking slows the player and stops them at ledges. Ice, soul sand and ladders take effect when `SimPhysicsConfig.resolve` provides `blockIdAt`.
