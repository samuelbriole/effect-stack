---
"@effect-stack/router": major
"@effect-stack/router-react": major
"@effect-stack/router-solid": major
"@effect-stack/router-vue": major
---

Replace the definition-object route builder with immutable, pipeable declarations implemented by composable Layers.

`Route.make(identifier, path, options?)` and `RouteGroup.make(identifier, options?)` declare typed leaves and groups with
`params`/`search`/`hash`/`success`/`error` schemas, `.add(...)`, `.prefix(path)`, and `.pipe`. `Router.make(collectionId)`
binds them into a contract exposing typed destinations (`Routes.project.detail`), the runtime service key `Routes.service`,
and immutable `.add`. Group prefixes are persistent and applied once; leading slashes are local; `params`/`search` are
inherited as a disjoint union that rejects redeclared fields, while `hash`/`success`/`error` stay node-local.
`Router.route(descriptor, handler)` records one implementation Layer and `Router.layer(Routes)` assembles the router,
requiring every mandatory implementation plus `History.Service` and verifying canonical node ownership.

Destinations, redirects, service hrefs, Atom projections, and renderer `Link`/`Navigate` validate collection membership
before acting, so foreign contracts fail with `RouteEncodeError` without moving history, and `AtomRouter.make` fails
startup when the runtime was assembled from a different contract version. Renderer `Views` records are now derived from
the actual bound children rather than an expanding metadata exclusion list, so builder methods never become view
requirements.

Navigation is exposed through the contract's service: `navigate`, `submit` (an identity-specific handle with
`await`/`cancel`), `refresh`/`retry`, and traversal commands. Terminal outcomes are `Committed`, `Superseded`, and
`Cancelled`; expected domain failures use the Effect error channel and redirects are typed control failures. Handler
scopes close before resolved data is published.

The renderer adapters take `routes`, an application `AtomRuntime`, and nested `views`. `useRoute(node)` returns typed
decoded inputs and prepared data; React returns values, Solid accessors, and Vue computed refs.

This is a breaking change to the declaration API only; there are no compatibility aliases. Navigation semantics,
Layers, and renderer props are otherwise unchanged.
