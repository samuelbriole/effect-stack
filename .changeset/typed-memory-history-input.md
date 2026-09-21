---
"@effect-stack/router": patch
---

Require a string initial URL in `MemoryHistory.make` instead of allowing an inferred `any` parameter. Omitting the URL still defaults to `/`.
