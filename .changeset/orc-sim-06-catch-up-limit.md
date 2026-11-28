---
"@nerima-games/mc-sim": patch
---

Let `makeTickService` take an optional maximum catch-up tick count. It defaults to `MAX_CATCH_UP_TICKS` (5), so existing callers are unchanged.
