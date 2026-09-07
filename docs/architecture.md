# Architecture

EffectStack is a set of headless modules with explicit ownership. Applications may adopt each module independently.

## Ownership boundaries

- **Router** is authoritative for URL interpretation, route matching, navigation history, navigation commands, and
  navigation lifecycle state.
- Future **Query** is authoritative for remote-resource lifecycle, caching, staleness, and mutations.
- Future **Form** is authoritative for editing, validation, and submission state.
- Future **DB** is authoritative for normalized entities, indexes, transactions, and live queries.

History is an infrastructure seam beneath Router, not a competing owner. Browser and memory adapters implement the same
small Effect service. Atom observes and controls the Router runtime across renderers; it does not duplicate state.

## Dependency direction

```text
React/Solid/Vue applications -> official Effect Atom adapter -> @effect-stack/router -> Effect
                                                           \-> History adapter
```

Core packages must never import a renderer. A future renderer adapter must depend toward the headless package:

```text
@effect-stack/router-react -> @effect-stack/router + @effect/atom-react + React
@effect-stack/router-solid -> @effect-stack/router + @effect/atom-solid + Solid
@effect-stack/router-vue   -> @effect-stack/router + @effect/atom-vue + Vue
```

Such a package is created only after it earns an interface with substantive behavior such as accessible links, outlets,
active state, lazy views, or SSR hydration. Renaming or re-exporting Atom hooks is too shallow.

The React, Solid, and Vue adapters own view declarations, provider context, route hooks, anchors, outlets, and render
boundaries.
The core `RouteTree` owns tree validation, inherited URL schemas, static-before-dynamic matching, branch planning, and the
shared typed destination model and endpoint selection. A compiled tree validates and precomputes static ranking, path
segments, ancestry, and destination endpoints once. `RenderPolicy` owns renderer-neutral fallback selection and declarative
navigation comparison; native adapters own how the selected view is rendered.
`Router.fromTree` resolves ancestors before descendants and exposes per-match state through Atom. Code and data loading
within one match remain concurrent. Pending/error/not-found views replace their declaring route and descendants, preserving
layouts above that boundary. SSR and hydration remain deferred.

## Lifecycle and cancellation

Dependencies use Effect's native `Context.Service` and `Layer` mechanism. Route loaders declare their service requirements
in their Effect types; router construction requires a Layer providing those services. Applications compose implementations
at their entry point and can substitute test Layers without changing routes. Renderer context carries the router and Atom
registry; application service construction, sharing, and finalization belong to Effect.

Each Atom registry builds one Router runtime from its Layer. A `SubscriptionRef` is authoritative state, a scoped
`FiberMap` owns the current transition, and a transition token prevents stale publication. Starting navigation interrupts
the previous loader; its finalizers run, and even a non-cancelable Promise completion cannot overwrite newer state.
Disposing the registry closes the scope, interrupts work, and removes History listeners.

Navigation exposes Effect `AsyncResult`: initial, waiting with previous state, success, and failure. Expected errors retain
their identity, including the failing URL part and lazy route ID. Defects and interruption remain in `Cause`.

The branch separates decoded incoming inputs, retained resolved data, and the last complete successful snapshot. Public
match unions preserve route-specific types; stable route atoms support selected subscriptions. Effect navigation joins its
own transition and renderer hooks expose an awaitable bridge. See [navigation and match snapshots](router-navigation.md)
for completion, interruption, and recovery semantics.

## Route loading versus remote state

A lazy route module is renderer-neutral code splitting. Native dynamic import caching is allowed, but Router does not own
preloading, eviction, request deduplication, or remote cache policy. Those resource concerns belong to Query.

Route `loader` effects prepare data from decoded params, search, hash, and the current location. Router coordinates their
execution alongside lazy code loading and retains `loaderData` on the resolved match. Both effects run concurrently in
the transition scope; either failure interrupts unfinished sibling work. The scope closes before resolution is published,
so loader results must not depend on transition-scoped resources remaining open. Refresh and history navigation run the
loaders again. Applications can supply resource caching through Layer services without transferring cache ownership to
Router. Expected data-loader failures preserve route identity separately from lazy-module failures.

Flat `Router.make` routes are matched in declaration order. Duplicate IDs and exact path templates are rejected; otherwise
the first structural match wins. Nested `Router.fromTree` branches use static-before-dynamic ranking and reject ambiguous
templates.
