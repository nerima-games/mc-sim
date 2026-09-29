---
"@nerima-games/mc-sim": minor
---

追随する `mc-kernel` 0.8.0 の canonical `ItemStack`、時間 brand、座標 brand の公開契約へ移行し、
`mc-physics` 0.3.0 と `mc-save` 0.5.0 の型境界に同期しました。空の stack は `undefined` slot とし、
`count: 0` と未解決 component patch の互換 shape は公開 API に残しません。
