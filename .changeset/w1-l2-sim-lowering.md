---
"@nerima-games/mc-sim": minor
---

Add the save coordinator (debounced writes with generation-consistent snapshot retry, at most one publish in flight) and the placement-consumption rule, both brought down from the composing app. The coordinator now takes its next batch and clears its running flag in one atomic update, closing a window where a request arriving between those two steps was lost.
