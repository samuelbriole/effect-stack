---
"@effect-stack/router": patch
---

Compile static route trees once, precomputing ranked path segments, ancestry lookup, and destination endpoints. Reuse
compiled plans across navigation and expose Pipeable route-tree builders with a stable model-identification guard.
