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

## Lifecycle and cancellation

Each Atom registry builds one Router runtime from its Layer. A `SubscriptionRef` is authoritative state, a scoped
`FiberMap` owns the current transition, and a generation token prevents stale publication. Starting navigation interrupts
the previous loader; its finalizers run, and even a non-cancelable Promise completion cannot overwrite newer state.
Disposing the registry closes the scope, interrupts work, and removes History listeners.

Navigation exposes Effect `AsyncResult`: initial, waiting with previous state, success, and failure. Expected errors retain
their identity, including the failing URL part and lazy route ID. Defects and interruption remain in `Cause`.

## Route loading versus remote state

A lazy route module is renderer-neutral code splitting. Native dynamic import caching is allowed, but Router does not own
preloading, eviction, request deduplication, or remote cache policy. Those resource concerns belong to Query.

Routes are matched in declaration order. Duplicate IDs and exact path templates are rejected; otherwise the first
structural match wins. This deterministic rule remains until an explicit route-ranking design replaces it.
