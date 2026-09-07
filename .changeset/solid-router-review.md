---
"@effect-stack/router-solid": patch
---

Expose decoded incoming inputs to Solid fallback views through stable per-route selector subscriptions returning
accessors. Share the renderer-neutral presentation policy for fallback selection, recovery tokens, and declarative
navigation comparison. Solid navigation now returns an awaitable Promise with a registry-supplied typed Effect bridge,
retries failed initialization through the core, recovers latched render errors only after completed successful
transitions, and observes history-state-only declarative updates. Lazy module view validation rejects present null
exports and distributes over module unions.
