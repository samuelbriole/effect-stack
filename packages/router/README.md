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
  load: () => Effect.tryPromise(() => import("./project-module.js"))
})

export const router = Router.make({
  routes: [home, project],
  layer: BrowserHistory.layer
})
```

`router.href(route, input)` builds a typed URL without throwing. `router.state` is an Atom of Effect `AsyncResult`, and
`router.navigate` is an action Atom accepting `Router.push`, `Router.replace`, `Router.back`, `Router.forward`,
`Router.go`, and `Router.refresh` commands.

Routes are checked in declaration order. The first structurally matching route wins; malformed values on that route
produce `RouteDecodeError` rather than falling through. This release supports exact static segments and required named
segments only; trailing and repeated slashes remain significant. `Route.make` rejects invalid untyped definitions with
`RouteDefinitionError`, while URL matching and construction return typed `Result` failures.

Repeated search fields preserve ordered values. Empty arrays are not representable in a URL, and singleton arrays are
rejected when the field's Schema also accepts a scalar because that URL would be ambiguous.

See the repository [adoption guide](../../docs/adoption.md), the [React adapter example](../router-react/examples/basic),
and the [Solid](examples/solid) and [Vue](examples/vue) tracers.

## Effect data loaders

Use `loader` to prepare data from the decoded URL. Its result is inferred as `loaderData` on the resolved route;
`load` independently imports route code and exposes its result as `module`.

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
