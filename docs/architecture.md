# Architecture

EffectStack packages are independently adoptable. Each domain has one owner:

| Domain                                                   | Owner                                |
| -------------------------------------------------------- | ------------------------------------ |
| URLs, matching, history, navigation, route loading       | Router                               |
| Remote-resource state and mutations                      | Effect Atom and application services |
| Editing, validation, submission                          | Form (planned)                       |
| Normalized entities, indexes, transactions, live queries | DB (exploring)                       |

## Dependency direction

```text
Renderer adapter -> headless core -> Effect
                 -> official Effect Atom adapter + renderer
Platform adapter -> core service interface
```

Cores must remain platform- and renderer-independent. Browser and memory history implement the core `History.Service`.
React, Solid, and Vue adapters depend on `@effect-stack/router` and their official Effect Atom adapters.

`RouteTree` owns tree validation, inherited URL schemas, and typed destinations. A shared internal planner handles flat
and nested matching. Compiled trees expose `routes`, `plan`, and `target`; indexes stay private. See the
[Router reference](../packages/router/README.md#matching-and-trees) for matching rules.

`RenderPolicy` owns fallback selection and declarative-navigation comparison. Adapters own providers, route hooks,
links, views, error capture, and native subscription lifetimes. Share helpers only where they preserve inference and
renderer semantics; re-exporting Atom hooks alone does not justify a package.

## Runtime ownership

- Each Atom registry builds a scoped Router runtime from the supplied Layer. Applications compose services and Layers;
  renderer context carries the router and registry.
- A `SubscriptionRef` owns state, and a scoped `FiberMap` owns the current transition. Serialized acceptance and
  transition identity prevent orphaned work and stale publication.
- Operation claims independently protect `navigation`: an older traversal or transition cannot overwrite a newer
  operation's outcome. Commands enter through `execute`; Atoms observe the runtime.
- Code and data loading use transition scopes. Long-lived resources and remote caching belong to application services
  or Effect Atom. Router retains resolved match data, not a remote-resource cache.

See [navigation contracts](router-navigation.md) for completion, cancellation, snapshots, and recovery, and the
[roadmap](roadmap.md) for deferred work.
