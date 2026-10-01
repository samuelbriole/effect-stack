# Architecture

EffectStack packages are independently adoptable. Each domain has one owner:

| Domain                                                   | Owner                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| URLs, matching, history, navigation, transition gates    | Router                                                          |
| Remote-resource state and mutations                      | Application services with Effect Atom or Foldkit Model/Commands |
| Editing, validation, submission                          | Form (planned)                                                  |
| Normalized entities, indexes, transactions, live queries | DB (exploring)                                                  |

## Dependency direction

```text
Renderer adapter -> headless core -> Effect
                 -> native renderer (and official Effect Atom adapter where applicable)
Platform adapter -> core service interface
```

Cores must remain platform- and renderer-independent. Browser and memory history implement the core `History.History`.
React, Solid, and Vue adapters depend on `@effect-stack/router` and their official Effect Atom adapters.
The Foldkit adapter depends on the core and Foldkit's Commands, Subscriptions, and HTML builder, not an Atom registry.

## Unified route definitions

A definition owns its identity, URL schemas, optional `prepare` gate, and native presentation together. `route` declares
an endpoint; `layout` exposes parent-aware `route`, `layout`, and `index` constructors. `make(appId, definitions)` selects
definitions and includes their ancestors, without separate implementation registration. `index` is shorthand for an
endpoint at its parent's path, not a separate node kind.

```ts
const Project = Router.layout("project", "/projects/:projectId", {
  params: { projectId: ProjectId },
  prepare: ({ params }) => Access.use((access) => access.check(params.projectId))
})
const ProjectIndex = Project.index()
const App = Router.make("Example", [Home, ProjectIndex])
```

- Names are specified once and qualified by parentage (`project`, `project.index`); array order does not define identity.
- Leading slashes are local; `params`/`search` inheritance is a disjoint union that rejects redeclared fields, and `hash`
  inherits the nearest declared schema. A child's own hash schema overrides it; each ancestor still validates its own input.
- Trusted facts live in a private `WeakMap` keyed by the exact constructor output. Definitions are frozen; copied or
  spread values are rejected at assembly, and renderer ownership is a private capability, not a string. One neutral
  definition engine backs both headless core and every native adapter.

`prepare: (decodedInput) => Effect<void, E, R>` contributes inferred errors and requirements, excluding redirects and
transient Scope. Assembly follows actual typed parents; erased evidence conservatively retains unknown E/R.
`App.service` is invariant in aggregate E/R, and each application has its own service key and runtime token.
Definitions may be shared across applications; runtime router instances remain independent.

Application Layers supply gate dependencies. Gates capture that context without its Scope, run in fresh scopes, and close
before branch publication. Long-lived resources belong to application Layers or Effect Atom, not gates.

The default setup uses one composed `Atom.runtime` and registry for navigation and resource atoms. Sharing a runtime
does not couple gate cancellation to resource subscriptions or make router retry refresh resources. Separate runtimes
remain available for independent service lifetimes or startup failures; different registries or runtime factories must
not be assumed to share services. Resource retention and preload policy belong to Atom.

The supported `@effect-stack/router/Adapter` bridge shares definition construction, application assembly, and target
normalization. Native option types, Providers, hooks, rendering, and lifecycle stay in each adapter; core never calls
components. Native assembly returns the same canonical application, with opaque presentation stored privately and checked
against the adapter's factory. Providers take that application and a runtime explicitly; applications own native render
boundaries. Every native endpoint needs presentation or `empty: true`; layouts may be transparent.

Foldkit keeps application data and a serializable presentation snapshot in its Model, with runtime definitions/services outside it. Its pure views receive the application Model, native HTML builder, decoded displayed input, and a lazy outlet. A persistent Subscription acquires the router in a fresh scope, shares it with navigation Commands, and resynchronizes after Model preservation. Commands fold operational failures into Messages; startup failures do not expose gate retry.

`Adapter.getApplicationNodes` and `getApplicationNode` expose validated canonical schema facts, not gate records or private definition metadata. `Presentation.projectPresentation` and `selectOutlet` share retained-branch and failure selection with data-only adapters.

## Navigation identity and typed paths

`makeNavigation<typeof App>()` provides typed path helpers with a type-only application import, avoiding eager definition
import cycles. Unbound helpers resolve against the nearest provider; erased types cannot authenticate it.
`makeNavigation(App)` and application-taking hooks validate the exact provider token.

Path templates retain correlated params/search/hash types. Resolution reads the canonical endpoint index synchronously,
without acquiring a service. `Adapter.resolveNavigationTarget` normalizes path and identity targets; href encoding and
submission validate schemas and membership before history writes. Identity destinations from `.to()` remain supported.

## Runtime ownership

- One scoped Router owns history observation, commands, attempts, and the authoritative snapshot. AtomRouter observes
  that service through the supplied runtime; it never creates another navigation engine.
- Status describes accepted navigation; pre-acceptance failures use only the command's error channel. Retained branches
  keep their original decoded input until commitment; initial preparation uses one application-level pending view.
- The coordinator owns acceptance, cancellation, and publication authority together. Obsolete attempts cannot publish
  or redirect, and transient scopes close before atomic branch publication.

See [navigation contracts](router-navigation.md), the [glossary](../GLOSSARY.md), and the [roadmap](roadmap.md).
