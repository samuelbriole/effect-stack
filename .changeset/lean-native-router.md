---
"@effect-stack/router": minor
"@effect-stack/router-react": minor
"@effect-stack/router-solid": minor
"@effect-stack/router-vue": minor
---

- Make headless and native `make(...)` return a lazy Effect. Each execution creates a fresh canonical application;
  invalid assembly is a defect. Route declarations, rendering, and href encoding remain synchronous.
- Replace native `Provider` with `<RouterProvider runtime={runtime} />` in React, Solid, and Vue. Compose
  `layer(make(...))` into the Atom runtime; no application prop, selector service, or top-level runner is needed.
  `AtomRouter.make` now requires that acquired application bundle.
- Use native stream observations and independent command atoms. React navigation preserves typed errors and per-call
  outcomes without replay on runtime refresh; registry teardown cleans up outstanding waits. Promise navigation rejects
  normalization defects, and captured Effect navigation rejects obsolete or refreshing services before writing history.
