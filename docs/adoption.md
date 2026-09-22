# Adopt Router

Choose an integration; each package can be adopted independently. Router targets Effect v4 RC.

| Use case                              | Start here                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Nested React views                    | [React adapter](../packages/router-react) · [example](../packages/router-react/examples/basic) |
| Nested Solid views                    | [Solid adapter](../packages/router-solid) · [example](../packages/router-solid/examples/basic) |
| Nested Vue views                      | [Vue adapter](../packages/router-vue) · [example](../packages/router-vue/examples/basic)       |
| Headless routing or a custom renderer | [Core API](../packages/router) and the example below                                           |

## Define a contract

```ts
import * as Route from "@effect-stack/router/Route"
import * as Router from "@effect-stack/router/Router"
import { Schema } from "effect"

export const Routes = Router.make("App").add(
  Route.make("home", "/"),
  Route.make("project", "/projects/:projectId", {
    params: { projectId: Schema.FiniteFromString },
    search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
    success: Schema.Struct({ title: Schema.String }),
    error: Schema.Struct({ code: Schema.Number })
  })
)
```

## Implement routes as Layers

```ts
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import { Effect, Layer } from "effect"

const ProjectLive = Router.route(Routes.project, ({ params }) =>
  ProjectService.use((projects) => projects.get(params.projectId))
)

export const RouterLive = Router.layer(Routes).pipe(Layer.provide(ProjectLive), Layer.provide(BrowserHistory.layer))
```

Missing implementation Layers and missing application services remain visible to the compiler. `Router.layer` does not
fail when initial route preparation fails; the failure is published against the observed URL.

## Headless usage

```ts
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const router = yield* Routes.service
  const outcome = yield* router.navigate(Routes.project({ params: { projectId: 1 } }))
  const state = yield* router.state
  return { outcome, state }
}).pipe(Effect.provide(RouterLive))

await Effect.runPromise(program)
```

No renderer or `AtomRegistry` is required for headless navigation. Use `MemoryHistory.layer(initialHref)` in tests.

## Renderer integration

```tsx
import { RegistryProvider } from "@effect/atom-react"
import { Atom } from "effect/unstable/reactivity"
import { RouterProvider, useRoute } from "@effect-stack/router-react"
import { RouterLive, Routes } from "./router.ts"

const runtime = Atom.runtime(RouterLive)

function ProjectPage() {
  const { params, data } = useRoute(Routes.project)
  return <h1>{data.title}</h1>
}

const views = {
  home: HomePage,
  project: { component: ProjectPage, pending: ProjectPending, error: ProjectError }
}

export const App = () => (
  <RegistryProvider>
    <RouterProvider routes={Routes} runtime={runtime} views={views} />
  </RegistryProvider>
)
```

Solid and Vue expose the same provider shape with native returns: Solid hooks return accessors and Vue hooks return
computed refs. `AtomRouter.make(runtime, Routes)` exposes read-only atoms when a renderer wants lower-level access.

See [navigation contracts](router-navigation.md) for completion, cancellation, retained data, and recovery.
