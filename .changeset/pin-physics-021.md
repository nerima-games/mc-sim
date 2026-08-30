---
"@nerima-games/mc-sim": patch
---

Pin mc-physics 0.2.1, whose tsc-emitted declarations restore the projectile API types that 0.2.0's bundled d.ts dropped; consumers type-checking mc-sim's declarations against mc-physics no longer see missing exports.
