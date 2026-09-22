# @effect-stack/router

Effect-native, renderer-independent routing for the web. A route collection is a declarative contract implemented by
composable Layers.

```sh
pnpm add @effect-stack/router effect@rc
```

## Contract

```ts
import * as Router from "@effect-stack/router/Router"
import { Schema } from "effect"

export const Routes = Router.schema("App", {
  home: "/",
  project: {
    path: "/projects/:projectId",
    params: { projectId: Schema.FiniteFromString },
    search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
    success: Schema.Struct({ title: Schema.String }),
    error: Schema.Struct({ code: Schema.Number })
  },
  login: {
    path: "/login",
    search: { returnTo: Schema.optionalKey(Schema.String) }
  }
})
```

- A parameterless route is one string entry.
- A route with typed inputs is one object declaration.
- `success`/`error` schemas determine handler and view types.
- Nested `children` describe non-addressable groups with an empty-string index child.
- `Routes.service` is the typed runtime service key.

## Destinations and hrefs

```ts
const destination = Routes.project({ params: { projectId }, search: { tab: "activity" } })
const href = Router.href(destination) // Result<string, RouteEncodeError>
```

Destination construction performs no navigation. Encoding remains fallible because refinements can reject runtime
values.

## Implementations

```ts
const ProjectLive = Router.route(Routes.project, ({ params }) =>
  Projects.use((projects) => projects.get(params.projectId))
)

const RouterLive = Router.layer(Routes).pipe(Layer.provide(ProjectLive), Layer.provide(BrowserHistory.layer))
```

`Router.route` validates handler success against the declared `success` type and rejects undeclared errors while allowing
`Router.redirect`. `Router.layer` requires every mandatory implementation service plus `History.Service`; missing pieces
remain unsatisfied Layer requirements. Use `Router.route(descriptor).buildEffect(...)` when the handler is constructed
effectfully.

Implementation services use the same key for one qualified node, so ordinary `Context` composition applies: when two
Layers provide the same implementation key, the later-provided Layer wins. The router does not attempt duplicate
detection beyond `Context` merging, matching deliberate test substitution.

## Runtime

```ts
const program = Effect.gen(function* () {
  const router = yield* Routes.service
  const outcome = yield* router.navigate(Routes.project({ params: { projectId } }))
  return outcome
}).pipe(Effect.provide(RouterLive))
```

The service exposes `navigate`, `submit` (an identity-specific handle with `await`/`cancel`), `refresh`, `retry`,
`back`/`forward`/`go`, read-only `state`, and `changes`. Terminal outcomes are `Committed`, `Superseded`, and
`Cancelled`; domain failures use the Effect error channel.

## History

`BrowserHistory.layer` provides browser-backed history. `MemoryHistory.layer(initialHref)` is deterministic and useful
in tests. Both are renderer-independent.

## Atom integration

`AtomRouter.make(runtime, Routes)` retrieves the contract's service from an existing `AtomRuntime` and exposes read-only
observations (`state`, `location`, `status`, `branch`, and typed `route(node)` projections). It never creates a second
engine and never exposes writable router state.

See the [navigation contracts](../../docs/router-navigation.md).
