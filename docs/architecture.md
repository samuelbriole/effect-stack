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

## Contracts and Layers

A route collection is a declarative contract created with `Router.schema(collectionId, defs)`. The contract owns:

- Typed destination constructors (`Routes.project({ params, search })`).
- Qualified, ancestry-aware node identities.
- The runtime service key (`Routes.service`).
- Optional `success` and `error` schemas that determine handler and view types.

Implementations are ordinary Layers. `Router.route(descriptor, handler)` records one handler; `Router.layer(contract)`
requires the union of mandatory implementation services plus `History.Service` and returns the contract's service.
Application composition is `Layer.provide`/`Layer.provideMerge`/`Layer.mergeAll`; there is no registration pass, global
augmentation, or renderer binding factory.

Implementation Layers are constructed once per router runtime. Per-navigation handler execution is scoped separately;
the handler scope closes before resolved data is published. Applications that need long-lived resources own them in
application service Layers or Effect Atom scopes.

## Runtime ownership

- One scoped `Router` service owns history observation, commands, transition workers, and the authoritative snapshot.
  Atom and renderer adapters only observe that service. `AtomRouter.make(runtime, contract)` retrieves the service from
  an existing `AtomRuntime`; it never creates a second engine.
- A `SubscriptionRef` holds the snapshot: observed location, latest command status, accepted pending attempt,
  destination-associated failure, and the last resolved branch. Command status and presentation are deliberately
  separate, so a rejected new command cannot cancel accepted work or overwrite a newer rejection.
- Attempts receive monotonic identities. Acceptance is serialized; obsolete attempts lose publication authority before
  they can publish or redirect. Handler scopes close before publication. Expected terminal values are `Committed`,
  `Superseded`, and `Cancelled`; domain failures stay in the Effect error channel and defects remain in `Cause`.
- Browser and memory history are renderer-independent. Listeners are established before the initial location is read so
  an external change cannot race initial observation, and programmatic push/replace produce exactly one attempt.

See [navigation contracts](router-navigation.md) for attempts, completion, cancellation, snapshots, and recovery, the
[migration guide](migration-router.md) for changes from the previous API, and the [roadmap](roadmap.md) for deferred
work.
