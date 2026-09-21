# `@effect-stack/router`

Renderer-independent routing with Schema-validated URLs, scoped Effect loaders, and Atom observations.
Targets **Effect v4 RC**; install a version compatible with the package's peer range.

## Install and define routes

```sh
pnpm add @effect-stack/router effect@rc
```

```ts
import { BrowserHistory, Route, Router } from "@effect-stack/router"
import { Schema } from "effect"

const home = Route.make({ id: "home", path: "/", params: {}, search: {} })
const project = Route.make({
  id: "project",
  path: "/projects/:id",
  params: { id: Schema.FiniteFromString },
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  hash: Schema.Literals(["", "details"])
})

export const router = Router.make({ routes: [home, project], layer: BrowserHistory.layer })
```

Use `MemoryHistory.layer("/initial")` in tests and non-browser hosts. For views, choose a
[React](../router-react), [Solid](../router-solid), or [Vue](../router-vue) adapter, or
[integrate the core directly](../../docs/adoption.md).

## Navigation API

- `router.href(route, input)` returns a typed `Result` containing the encoded URL or `RouteEncodeError`.
- `router.execute(command)` runs `push`, `replace`, `refresh`, `back`, `forward`, or `go` with an
  `AtomRegistry.AtomRegistry` service. Push/replace/refresh await their transition; traversal acknowledges the host request.
- `router.retry` rebuilds failed initialization or refreshes a healthy runtime.
- `state`, `navigation`, `branch`, `completed`, and `routeAtoms(route)` expose read-only Atom observations.

See [navigation contracts](../../docs/router-navigation.md) for cancellation, snapshots, resource lifetime, and recovery.

## Matching and trees

Routes support exact static segments and required named parameters. Trailing and repeated slashes are significant.

- Static segments outrank dynamic ones; equal-ranking flat patterns keep declaration order.
- Malformed percent-encoding cannot match a static segment. Matched dynamic parameters with invalid encoding or Schema
  values produce `RouteDecodeError`; an unmatched URL produces `RouteNotFound`.
- Flat routers reject duplicate IDs and exact path templates. Not-found branches retain a covering match when available.
- Repeated search fields preserve ordered values. Empty arrays are unrepresentable; singleton arrays are rejected when
  the Schema also accepts a scalar, since the URL would be ambiguous.
- Invalid route definitions throw `RouteDefinitionError`; matching and URL encoding return typed `Result` failures.

Use `RouteTree.root`, `RouteTree.make`, and `addChildren` for nested, index, and pathless routes, then `Router.fromTree`.
Trees inherit URL schemas, reject ambiguous templates, preserve ancestor chains, and rank indexes ahead of ancestors
sharing the same URL. Builders support `.pipe(...)` and `RouteTree.isNode`.

`RouteTree.Destination<typeof tree>` describes typed destinations with required params, search, and hash inputs.
An index route's requirements cannot be bypassed by targeting its ancestor at the same URL.

For tooling, `RouteTree.compile(tree)` exposes `routes`, `plan(location)`, and `target(destination)`.
`target` selects the endpoint and fills omitted empty inputs; pass its `{ route, input }` to `Route.href` for encoding.
It throws for unknown destinations. `RouteTree.flatten` provides the validated preorder route list.
Definitions are immutable: use `addChildren` to create a new tree rather than mutate cached trees or route arrays.

## Code, data, and services

`lazy: () => Effect.tryPromise(() => import("./page.js"))` loads code into `module`.
`loader` receives decoded `{ params, search, hash, location }` and returns `loaderData`:

```ts
import { MemoryHistory, Route, Router } from "@effect-stack/router"
import { Context, Effect, Layer, Schema } from "effect"

class Projects extends Context.Service<
  Projects,
  {
    readonly get: (id: number) => Effect.Effect<{ readonly id: number; readonly title: string }>
  }
>()("Projects") {}

const project = Route.make({
  id: "project",
  path: "/projects/:id",
  params: { id: Schema.FiniteFromString },
  search: {},
  loader: ({ params }) => Projects.use((projects) => projects.get(params.id))
})

const router = Router.make({
  routes: [project],
  layer: Layer.merge(
    MemoryHistory.layer("/projects/42"),
    Layer.succeed(Projects, { get: (id) => Effect.succeed({ id, title: `Project ${id}` }) })
  )
})
```

The router Layer must supply all code/data loader services. Loader scopes close before results are published;
long-lived resources and remote caching belong to application services or Effect Atom.

[Architecture](../../docs/architecture.md)
