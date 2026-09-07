---
"@effect-stack/router-react": patch
"@effect-stack/router-solid": patch
"@effect-stack/router-vue": patch
---

Validate lazy route module views. A `load` module that presents a `default` or `component` export must match the
renderer's component type (`React.ComponentType`, including memo/lazy wrappers, Solid `Component`, or Vue
`Component`), while renderer-neutral modules keep the `Outlet` fallback and data inference. A selected invalid view
now throws an actionable `Error` containing the route ID inside the render boundary, so the nearest `errorComponent`
catches it.
