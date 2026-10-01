# @effect-stack/router

Effect-native, renderer-independent URLs, history, navigation, and transition gates. Application data belongs to
official Effect Atom resources; the router owns no resource cache or success-data channel.

```sh
pnpm add @effect-stack/router effect@4
```

## Headless setup

```ts
import { Effect, Layer, Schema } from "effect"
import { MemoryHistory, Router } from "@effect-stack/router"

const Home = Router.route("home", "/")
const Project = Router.layout("project", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  search: { tab: Schema.optionalKey(Schema.String) },
  prepare: ({ params }) => Effect.log(`Preparing project ${params.projectId}`)
})
const Index = Project.index()
const Details = Project.route("details", "/details")
const App = Router.make("Example", [Home, Index, Details])

await Effect.runPromise(
  Effect.gen(function* () {
    const router = yield* App.service
    yield* router.navigate(Details.to({ params: { projectId: 42 } }))
    return yield* router.state
  }).pipe(Effect.provide(App.layer.pipe(Layer.provide(MemoryHistory.layer("/")))))
)
```

`route` declares an endpoint; `layout` declares a parent-aware layout or transparent group, exposing `route`, `layout`,
and `index`. Selecting a child includes its ancestors once; selecting a parent never includes its children. Leading
slashes are local to the parent; `parent.index(options)` is shorthand for `parent.route("index", "/", options)`.
Names are qualified by parentage, not array order. Params/search inherit exact decoded
types and reject redeclared fields. Hash inherits the nearest declared schema unless overridden; ancestors still validate their own schemas. URL codecs must be synchronous and context-free.

## Direct gates

`prepare` is an optional direct `(decodedInput) => Effect<void, E, R>`. Supply its requirements through Layers; construction
failures remain Layer errors. Gates run after history writes, ancestors first, with scoped cleanup before publication.
The application's Layer can fail with `HistoryError` when acquiring the initial location; gate failures remain navigation errors.

`ErrorOf<Def>` and `RequirementsOf<Def>` project a gate's own E/R. `ApplicationErrorOf<App>` and
`ApplicationRequirementsOf<App>` collect them across selected definitions and their actual parents.
`DecodedRouteInputOfDef<Def>` describes the complete decoded params/search/hash and matched location.

## Navigation and observation

- `.to(input, options?)` constructs an identity destination; `Router.href(destination)` encodes it independently of a selection.
- `navigate` awaits `Committed`, `Superseded`, or `Cancelled`; failures stay in Effect's error channel.
- `submit` returns an identity-specific `await`/`cancel` handle. Caller interruption stops waiting, not accepted work.
- `refresh`/`retry` rerun gates without adding history or refreshing application resources.
- `back`/`forward`/`go` request history traversal.
- `state` and `changes` expose the authoritative read-only snapshot.
- `resolvePathDestination(App, template, input)` resolves canonical endpoint paths synchronously, without service acquisition.

Definitions are frozen constructor-owned values. Copies, spreads, foreign destinations, and renderer-owner mismatches
are rejected. `BrowserHistory.layer` and `MemoryHistory.layer(initialHref)` implement the same history service.
Status describes accepted navigation; validation or history-write failures use the command's error channel without
changing accepted work or its status.

## Atom integration

`AtomRouter.make(runtime, App)` retrieves the existing router service and validates exact application identity; it never
creates a second engine. It exposes official read-only atoms: `service`, `state`, `location`, `status`, `branch`, and
`route(def)`. A route projection is `None` when inactive, otherwise coherent decoded input, never resource data or pending
gate progress. Projections observe the displayed branch: old input is retained while a new navigation is pending.

Build resource families with the same `runtime.atom(effect)` and `Atom.family`. Refresh, errors, retention, and
subscriptions belong to Atom, independently of navigation. The router does not guarantee preload handoff.

React, Solid, and Vue adapters share the supported `@effect-stack/router/Adapter` definition engine while preserving native
rendering. See [adoption](../../docs/adoption.md), [architecture](../../docs/architecture.md), and
[navigation contracts](../../docs/router-navigation.md).

## Renderer command bridge

Custom renderer adapters can use `Adapter.navigateDetached(router, target, options?)` and `Adapter.retryDetached(router)`
with the exact assembled router value. Targets retain the selected destination and correlated path-input types.
The bridge owns scoped execution and reports unpublished failures with the application's Effect Logger and full `Cause`;
it does not invoke native presentation or renderer lifecycle callbacks. Explicit Effect/Promise navigation remains available.

Configure logging while acquiring the application, for example:

```ts
import { Layer, Logger } from "effect"

const layer = App.layer.pipe(Layer.provide(MemoryHistory.layer("/")), Layer.provide(Logger.layer([Logger.consoleJson])))
```

See [observation failures](../../docs/router-navigation.md#observation-failures) for retry and diagnostic behavior.
