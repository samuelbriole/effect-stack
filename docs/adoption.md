# Adopt Router

Router targets Effect v4. Choose [React](../packages/router-react), [Solid](../packages/router-solid),
[Vue](../packages/router-vue), or the [headless core](../packages/router).

Routes own URL schemas, an optional direct transition gate, and native presentation. Application data belongs to
official Effect Atom resources, not routing. Each renderer's `examples/basic` is a standalone application demonstrating
branded decoded IDs, one composed runtime for navigation and domain resources, reachable resource failure, and refresh
recovery.

## Headless setup

```ts
import { Effect, Layer, Schema } from "effect"
import { MemoryHistory, Router } from "@effect-stack/router"

const Home = Router.route("home", "/")
const Project = Router.layout("project", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString }
})
const Index = Project.index()
await Effect.runPromise(
  Effect.gen(function* () {
    const App = yield* Router.make("Example", [Home, Index])
    return yield* Effect.gen(function* () {
      const router = yield* App.service
      yield* router.navigate(Index.to({ params: { projectId: 42 } }))
      return yield* router.state
    }).pipe(Effect.provide(App.layer.pipe(Layer.provide(MemoryHistory.layer("/")))))
  })
)
```

Headless navigation needs neither a renderer nor an Atom registry.

## React with one application runtime

```tsx
import { Context, Effect, Layer, Schema } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import { RegistryProvider, useAtomValue, useAtomRefresh } from "@effect/atom-react"
import { layer, make, RouterProvider, route, useRouteInput } from "@effect-stack/router-react"
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import type { ReactNode } from "react"

const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
class Projects extends Context.Service<
  Projects,
  {
    readonly get: (id: typeof ProjectId.Type) => Effect.Effect<string>
  }
>()("example/Projects") {}
const domainLayer = Layer.succeed(Projects, { get: (id) => Effect.succeed(`Project ${id}`) })

const Project = route("project", "/projects/:projectId", {
  params: { projectId: ProjectId },
  component: ProjectPage
})
function ProjectPage(): ReactNode {
  const input = useRouteInput(Project)
  const resource = projectResource(input.params.projectId)
  const result = useAtomValue(resource)
  const refresh = useAtomRefresh(resource)
  return (
    <section>
      {AsyncResult.isSuccess(result) ? result.value : AsyncResult.isFailure(result) ? "Resource failed" : "Loading…"}
      <button onClick={refresh}>Refresh resource</button>
    </section>
  )
}
const assembly = make("Example", [Project])
export type Application = Effect.Success<typeof assembly>
const services = Layer.merge(BrowserHistory.layer, domainLayer)
const runtime = Atom.runtime(layer(assembly).pipe(Layer.provideMerge(services)))
const projectResource = Atom.family((id: typeof ProjectId.Type) =>
  runtime.atom(Projects.use((projects) => projects.get(id)))
)
export const App = () => (
  <RegistryProvider>
    <RouterProvider runtime={runtime} />
  </RegistryProvider>
)
```

React, Solid, and Vue share this setup: `layer(assembly)` lazily acquires the application inside the runtime, and
`RouterProvider` needs no application prop or selector service. Compose one application Layer per runtime; use independent
runtimes for independent routers. Reusing the same Layer may share acquisition through Effect's memoization.
Startup pending/failure views render before router context is available.

`Layer.provideMerge(services)` supplies gate dependencies and exposes domain services to resource atoms in the same runtime.
Resources remain independent: cancelling a gate does not cancel their subscriptions, and router retry does not refresh them.
An optional `prepare` gate is for transition readiness, not data publication.

Solid's `useAtomValue(() => atom)` returns an accessor; Vue's returns a ref, refreshed with `injectRegistry().refresh(atom)`.
See the package examples for native Suspense and error handling. Annotate a component's return type when it reads its own
definition to avoid an inference cycle. Resources are read during rendering, so definitions and resource families can
share a module without eager execution.

## Type-only path helpers

```tsx
// navigation.tsx
import type { Application } from "./App.tsx"
import { makeNavigation } from "@effect-stack/router-react"
export const { Link } = makeNavigation<Application>()
```

Type-only helpers avoid eager route-definition import cycles and resolve against the nearest provider.
Use `makeNavigation(app)` or `useRouter(app)` when exact provider-token checks matter.

See [navigation contracts](router-navigation.md) and [architecture](architecture.md).
