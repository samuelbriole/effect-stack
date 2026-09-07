---
"@effect-stack/router-react": patch
"@effect-stack/router-solid": patch
---

Avoid repeating declarative navigation when a pending boundary remounts an already-satisfied redirect. Preserve explicit
same-URL history-state updates, matching the Vue adapter's behavior.
