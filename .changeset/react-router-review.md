---
"@effect-stack/router-react": patch
"@effect-stack/router": patch
---

Expose decoded incoming inputs to fallback views and stable per-route selector subscriptions. Centralize renderer-neutral
fallback selection and declarative navigation comparison. React navigation now returns an awaitable result with a typed
Effect bridge, retries failed initialization, recovers render errors after completed successful transitions, and observes
history-state-only declarative updates.
