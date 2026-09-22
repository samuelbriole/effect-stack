---
"@effect-stack/router": major
"@effect-stack/router-react": major
"@effect-stack/router-solid": major
"@effect-stack/router-vue": major
---

Replace the route-builder and registration API with concise route contracts implemented by composable Layers.

`Router.schema(collectionId, defs)` declares typed destinations, optional `success`/`error` schemas, and the runtime
service key `Routes.service`. `Router.route(descriptor, handler)` records one implementation Layer and
`Router.layer(Routes)` assembles the router, requiring every mandatory implementation plus `History.Service`. Nested
`children` describe non-addressable groups with an empty-string index child.

Navigation is exposed through the contract's service: `navigate`, `submit` (an identity-specific handle with
`await`/`cancel`), `refresh`/`retry`, and traversal commands. Terminal outcomes are `Committed`, `Superseded`, and
`Cancelled`; expected domain failures use the Effect error channel and redirects are typed control failures. Handler
scopes close before resolved data is published.

The renderer adapters now take `routes`, an application `AtomRuntime`, and nested `views`. `useRoute(node)` returns typed
decoded inputs and prepared data; React returns values, Solid accessors, and Vue computed refs. `AtomRouter.make(runtime,
Routes)` exposes read-only observations over the same service.

This removes `collect`, implementation `bind`, `withRoute`, application-wide module augmentation, `RouteTree`,
`RenderPolicy`, and public activation leases. See `docs/migration-router.md` for the migration path.
