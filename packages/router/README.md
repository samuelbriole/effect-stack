# `@effect-stack/router`

Renderer-independent routing built with Effect v4 and Effect Atom.

> EffectStack is an independent community project built on Effect. It is not maintained by Effectful Technologies Inc.

> This initial release targets the Effect v4 release candidate. Install `effect@rc` and keep it compatible with the
> package peer range.

## Install

```sh
pnpm add @effect-stack/router effect@rc
```

## Define routes

```ts
import { BrowserHistory, Route, Router } from "@effect-stack/router"
import { Effect, Schema } from "effect"

const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))

const home = Route.make({ id: "home", path: "/", params: {}, search: {} })
const project = Route.make({
  id: "project",
  path: "/projects/:projectId",
  params: { projectId: ProjectId },
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  hash: Schema.Literals(["", "details"]),
  lazy: () => Effect.tryPromise(() => import("./project-module.js"))
})

export const router = Router.make({
  routes: [home, project],
  layer: BrowserHistory.layer
})
```

`router.href(route, input)` builds a typed URL without throwing. `router.state` is an Atom of Effect `AsyncResult`,
and `router.branch`, `router.completed`, and `router.navigation` are read-only Atom observations of navigation state.

`router.execute(command)` is the only navigation command interface: it exposes the operation as an Effect requiring
`AtomRegistry.AtomRegistry`.
Push/replace/refresh await their own navigation and scoped cleanup; superseding navigation interrupts the previous
operation. Traversal commands acknowledge the history request. `router.retry` rebuilds failed initialization or refreshes
a healthy runtime. `router.navigation` is a read-only projection of the latest navigation operation; its successful
projection carries no value. See
[navigation and match snapshots](../../docs/router-navigation.md) for the full contract.

Routes are planned by the canonical routing model: static segments rank ahead of dynamic ones, malformed
percent-encoding never matches a segment, and routes with equal ranking keep declaration order. `Router.fromTree`
additionally resolves ancestor chains and rejects ambiguous templates; prefer a tree when two templates can match the
same URL and the ancestor views should render.
This release supports exact static segments and required named
segments only; trailing and repeated slashes remain significant. `Route.make` rejects invalid untyped definitions with
`RouteDefinitionError`, while URL matching and construction return typed `Result` failures.

Repeated search fields preserve ordered values. Empty arrays are not representable in a URL, and singleton arrays are
rejected when the field's Schema also accepts a scalar because that URL would be ambiguous.

See the repository [adoption guide](../../docs/adoption.md), and the
[React](../router-react/examples/basic), [Solid](../router-solid/examples/basic), and [Vue](../router-vue/examples/basic)
adapter examples.

## Nested trees and shared destinations

`RouteTree.root` and `RouteTree.make` define renderer-independent root, nested, index, and pathless routes. Connect them with
`addChildren`, then use `Router.fromTree` to build the Atom runtime. Nested matching ranks static segments ahead of dynamic
segments, and indexes ahead of the ancestors sharing their URL.

Route-tree builders support `.pipe(...)` and `RouteTree.isNode` identification. `RouteTree.compile(tree)` validates the
static tree and exposes a small operation-oriented interface: the flattened route list, `plan` for branch matching, and
`target` for destination resolution. Ranking, path segments, ancestry, and endpoint indexes are precomputed once but
stay private.

`RouteTree.Destination<typeof tree>` supplies the common typed destination model for renderer adapters. It includes the
ranked endpoint's inherited params, search, and hash, requiring inputs only when their Schemas require them. An index's
requirements cannot be bypassed by targeting an ancestor at the same URL. `Compiled["target"]` selects that endpoint and
fills omitted empty inputs; adapters then pass its `route` and `input` to `Route.href` for Schema validation and
encoding before dispatching a navigation command. This keeps destination interpretation shared across React, Solid, and
future adapters.

Compiled trees and the route arrays passed to `Router.make` are static, immutable definitions. Build a new tree with
`addChildren` when changing definitions; identity-based setup caches then compile the new value independently.

The typed `router.branch` preserves each route's inputs, module, data, and errors through a distributive match union.
Discriminate entries by `routeId`. Incoming decoded matches, retained resolved matches, incoming location, transition
identity, and the last complete successful branch are explicitly separate. Stable `router.routeAtoms(route)` projections
allow custom adapters and application subscriptions to observe only their relevant matches.

## Effect data loaders

Use `loader` to prepare data from the decoded URL. Its result is inferred as `loaderData` on the resolved route;
`lazy` independently imports route code and exposes its result as `module`.

```ts
import { MemoryHistory, Route, Router } from "@effect-stack/router"
import { Context, Effect, Layer, Schema } from "effect"

class Projects extends Context.Service<Projects, {
  readonly get: (id: number) => Effect.Effect<{ readonly id: number; readonly title: string }>
}>()("Projects") {}

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
    Layer.succeed(Projects, {
      get: (id) => Effect.succeed({ id, title: `Project ${id}` })
    })
  )
})
```

Loaders receive `{ params, search, hash, location }` after URL validation. The router Layer must supply every service
required by code loading and data loading. Both execute concurrently; the router publishes a resolved route after both
succeed. Expected data failures become `Router.RouteLoaderError` with the original `error` and `routeId`.
Defects and interruption remain in `Cause`.

Data loaders run on every matched resolution, including refresh and history navigation. Superseding navigation or
disposing the registry interrupts pending work. Loader scopes close when the transition finishes, so returned data must
not depend on resources kept open by that scope. The active match retains the result; resource caching and reuse can be
provided by the application's services or a future Query integration.
