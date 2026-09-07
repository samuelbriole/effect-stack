---
"@effect-stack/router": patch
---

Preserve route/input correlation in nested commands, enforce generic failure constructor types, and publish current
navigation interruption as terminal branch failure. Build the complete package graph for standalone artifact checks.

Expose typed Effect navigation and initialization retry, explicit incoming/retained branch snapshots, typed per-route
failures, and stable route Atom projections. Navigation awaits its own transition and scoped cleanup, including headless
operations and concurrent supersession. The compatibility command atom observes these operations and supports resetting
its result to Initial.
