---
"@effect-stack/router": minor
"@effect-stack/router-react": minor
"@effect-stack/router-solid": minor
"@effect-stack/router-vue": minor
---

Replace split route contracts and implementations with unified route and layout definitions for the core, React,
Solid, and Vue. Definitions inherit typed URL schemas and support direct `prepare` gates; ordinary native components use
`useRouteInput` and application-owned Effect atoms instead of router loader data or injected data props. Remove the redundant
`useRoute` hook and `RouteResult` alias.

Assemble one canonical application; native `Provider` takes `app` and `runtime`. Add type-only path navigation, optional
exact application binding through `makeNavigation(app)`, and single-runtime examples. `index` is shorthand for an ordinary
endpoint at its parent's path. Expose definition and aggregate application error/requirement projections; rename the
history service to `History.History`.

Use application-level initial pending views and application-owned native render boundaries. Pre-acceptance failures leave
accepted navigation status unchanged; initial history acquisition failures surface as startup errors. Fix nested provider
outlets and omitted Vue navigation defaults, and prevent resubmission of unchanged `Navigate` targets. Self-interrupting
gates settle as cause-level failures. Resource refresh remains independent of navigation retry and cancellation.
