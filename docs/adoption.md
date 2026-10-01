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
const App = Router.make("Example", [Home, Index])

await Effect.runPromise(
  Effect.gen(function* () {
    const router = yield* App.service
    yield* router.navigate(Index.to({ params: { projectId: 42 } }))
    return yield* router.state
  }).pipe(Effect.provide(App.layer.pipe(Layer.provide(MemoryHistory.layer("/")))))
)
```

No renderer or Atom registry is required for headless navigation. Child constructors inherit exact decoded
params/search and carry the actual typed parent. Hash schemas inherit unless overridden; ancestor schemas still validate. Layouts are not navigable endpoints;
`parent.index(options)` is shorthand for `parent.route("index", "/", options)` at the parent's path.

## React with one application runtime

```tsx
import { Context, Effect, Layer, Schema } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import { RegistryProvider, useAtomValue, useAtomRefresh } from "@effect/atom-react"
import { make, Provider, route, useRouteInput } from "@effect-stack/router-react"
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
export const Application = make("Example", [Project])
const services = Layer.merge(BrowserHistory.layer, domainLayer)
const runtime = Atom.runtime(Application.layer.pipe(Layer.provideMerge(services)))
const projectResource = Atom.family((id: typeof ProjectId.Type) =>
  runtime.atom(Projects.use((projects) => projects.get(id)))
)
export const App = () => (
  <RegistryProvider>
    <Provider app={Application} runtime={runtime} />
  </RegistryProvider>
)
```

The same runtime supplies navigation gates and resource atoms. `Layer.provideMerge` supplies the router's requirements
while exposing the domain services to atoms. Data remains application-owned: cancelling a gate does not cancel an
independently subscribed resource, and router retry does not refresh it. Separate runtimes remain an option when service
lifetimes or Layer startup failures should be independent.

Solid uses official `useAtomValue(() => atom)` accessors or `useAtomResource`; Vue uses official
`useAtomValue(() => atom)` refs with computed selection and `injectRegistry().refresh(atom)`. Native components receive
no mandatory router props. `useRouteInput(def)` reads displayed input, retaining the previous input while navigation is
pending. Annotate a native component's return type when it reads its own definition to avoid a TypeScript inference cycle.
In these small examples, definitions, application assembly, runtime, and resource families share `routes.tsx`/`routes.ts`.
Components read resources only when rendered, after module initialization, so no eager application import cycle is needed.

## Gates and recovery

An optional `prepare: (decodedInput) => Effect<void, E, R>` is for transition authorization/readiness, not data publication.
Supply its requirements through Layers. The router writes history first, then runs ancestor gates before descendants;
all transient scopes close before atomic publication. `retry` reruns gates, not application resource refresh. Resource
failure recovery uses the official Atom refresh API. Do not add a gate that waits on every resource by default.
Initial navigation uses the Provider's optional `pending` component; later preparation retains the displayed branch.
Native render exceptions and boundary resets belong to application components, not route retry.

## Type-only path helpers

```tsx
// navigation.tsx
import type { Application } from "./App.tsx"
import { makeNavigation } from "@effect-stack/router-react"
export const { Link } = makeNavigation<typeof Application>()
```

Route components can import this helper without importing route definition modules or eagerly creating parent/child
cycles. The erased application type cannot be verified at runtime: unbound helpers resolve against the nearest provider.
Use `makeNavigation(Application)` or `useRouter(Application)` when exact provider-token checks matter.

See [navigation contracts](router-navigation.md) and [architecture](architecture.md).
