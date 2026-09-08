---
"@effect-stack/query": minor
"@effect-stack/query-react": patch
"@effect-stack/query-vue": patch
---

Make query notifications reentrancy-safe and publish shutdown outcomes only after execution finalizers complete. Expose
self-contained observation capabilities on resources and mutation handles, forward native Atom refresh to persistent Query
invalidation, and render cached React snapshots without acquiring interest. Normalize borrowed Vue registry identities so
reactive proxies cannot break native registry cleanup.
