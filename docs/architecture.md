# Architecture

EffectStack is a set of headless modules with explicit ownership. Applications may adopt each module independently.

## Ownership boundaries

- **Router** is authoritative for URL interpretation, route matching, navigation history, navigation commands, and
  navigation lifecycle state.
- **Query** is authoritative for remote-resource lifecycle, caching, staleness, and mutations.
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

@effect-stack/query-react -> @effect-stack/query + @effect/atom-react + React
@effect-stack/query-solid -> @effect-stack/query + @effect/atom-solid + Solid
@effect-stack/query-vue   -> @effect-stack/query + @effect/atom-vue + Vue
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

Query's application-scoped client owns one cache shared by Effect reads, Streams, mutation controllers, and read-only Atom
views. `QueryClient.make` builds its service Layer once; `makeWith` borrows already-built services. Layer initialization
errors belong to construction, and bound operations require no Atom registry or application services. Query definitions
plus immutable structural inputs determine identity within a client.

Read requests are shared by active consumers. Losing one consumer removes its interest; losing the last interrupts the
request. Mutation invocations are client-owned after acceptance, have independent outcomes, and survive observer or waiter
departure. Each execution has a child scope whose finalizers complete before publication. Native `AsyncResult` represents
query outcomes; mutation state identifies the latest-started invocation and counts all pending work.

Freshness is separate from inactive retention. Invalidation persists on inactive entries and advances a generation so an
older request cannot satisfy newer callers. Atom bindings own observation leases, not another cache. Registry disposal
releases those leases synchronously; closing the application/client scope awaits asynchronous cleanup before borrowed
services are released. See the [Query guide](../packages/query/README.md) for operation and lifetime contracts.

First-party Query adapters own typed application context, optional reactive resource selection, renderer subscription
lifecycles, and invocation-specific event bridges. They consume bound resources and application-acquired mutation handles;
the core client remains the cache and execution owner. Provider values and supplied registries are borrowed. A provider
creates an owned native registry when none is supplied, or explicitly inherits the ambient registry with `registry="inherit"`.
Query and Router can share the same application-owned registry without either borrowing provider disposing it.

React query subscriptions activate at commit: an abandoned render cannot start a query or redirect the committed resource's
subscription. Pure synchronous snapshots expose cached query and mutation state during render. Solid accessors and Vue refs/getters drive native reactive resource switching. `Option.none()` represents a
disabled query and holds no query interest. Each selected resource supplies its own `AsyncResult`, including retained
success during its refresh. Application context is a value in React, an accessor in Solid, and a readonly Ref in Vue so
provider updates retain each renderer's normal reactivity.

Mutation adapters expose the core's state and environment-free Effects together with native Promise and typed `Exit`
bridges. Each action follows its own invocation, independently of the controller's latest result. Aborting a waiter or
unmounting an observer does not cancel accepted writes. Explicit invocation interruption and application-scope closure
retain the core's finalization guarantees.

Bound resources and mutation handles carry self-contained observation capabilities. Observation is part of their structural
public contract, preserved by forwarding wrappers and spread copies, rather than a hidden lookup keyed by the original
handle. Cache metadata transitions commit before external notifications, and shutdown publishes accepted execution outcomes
only after their finalizers finish. Native query-Atom refresh delegates to persistent core invalidation. See
[Effect interoperability](query-interoperability.md) for the refresh, transport, reactivity, and hydration boundaries.

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
