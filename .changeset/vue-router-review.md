---
"@effect-stack/router-vue": patch
---

Expose decoded incoming inputs to fallback views through stable per-route computed subscriptions with selector overloads,
and share renderer-neutral fallback selection, recovery tokens, and declarative intent comparison. Vue navigation now
returns an awaitable Promise with a typed Effect bridge, retries failed initialization, recovers render errors after
completed successful transitions, and observes history-state-only declarative updates.
