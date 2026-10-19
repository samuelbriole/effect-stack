# @effect-stack/router-react

Native React routing with typed URL schemas and optional direct Effect transition gates. Data uses official Effect Atom
resources independently of the router.

```sh
pnpm add @effect-stack/router-react @effect-stack/router @effect/atom-react effect@4 react
```

## Setup

```tsx
import { make, layer, layout, Outlet, RouterProvider, useRouteInput } from "@effect-stack/router-react"
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import { RegistryProvider } from "@effect/atom-react"
import { Atom } from "effect/reactivity"
import { Effect, Layer, Schema } from "effect"
import type { ReactNode } from "react"

const Projects = layout("projects", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  component: () => <Outlet />
})
const Index = Projects.index({ component: ProjectPage })
function ProjectPage(): ReactNode {
  const input = useRouteInput(Index)
  return <h1>Project {input.params.projectId}</h1>
}
const assembly = make("Example", [Index])
export type Application = Effect.Success<typeof assembly>
const runtime = Atom.runtime(layer(assembly).pipe(Layer.provide(BrowserHistory.layer)))
export const App = () => (
  <RegistryProvider>
    <RouterProvider runtime={runtime} />
  </RegistryProvider>
)
```

Components are ordinary React function, class, or memo components without injected router props. `useRouteInput` returns
decoded input as a value. Annotate native return types for self-referencing component inference. Endpoints need a component
or `empty: true`; layouts may be transparent. `Outlet` renders nested routes.

`RouterProvider` accepts `runtime` and optional `pending`, an ordinary component for initial loading.

## Resources and gates

Use official `useAtomValue`, `useAtomSuspense`, and `useAtomRefresh` with domain-owned atoms/families. Native exceptions
belong to React error boundaries. See the [standalone example](examples/basic) for loading, failure, and refresh recovery.

Use one composed runtime for the router and domain services by default. Supply domain services with
`layer(assembly).pipe(Layer.provideMerge(services))` to keep them available to resource families built with `runtime.atom`.

`prepare: (input) => Effect<void, E, R>` is an optional gate; supply its services through Layers. Route `error` receives
`ViewFailureProps<E>` for gate/decode failures and retry. `useRetry()` reruns gates, not resource loading.

## Navigation

`makeNavigation(app)` supplies exact-token-bound `Link`, `Navigate`, `useNavigate`, and `useNavigateEffect` for an assembled witness.
Links accept identity destinations or typed endpoint path templates with correlated params/search/hash.
Links are real anchors, preserving modifier keys, downloads, targets, native cancellation, React 19 refs, and replace/state.
`useRouter(app)`, `useRouterState(app)`, `useNavigate(app)`, and `useNavigateEffect(app)` validate the exact application
token; their no-argument forms use the nearest provider. `useRouteInput(definition)` reads decoded input, not resource data.
`useNavigate` and `useRetry` execute through runtime result atoms; overlapping navigation calls keep independent outcomes.
`useNavigate` rejects normalization failures and defects through its Promise rather than throwing synchronously.
`useNavigateEffect` exposes the same command for Effect composition without running it.

```tsx
// navigation.tsx — no runtime application or destination import
import type { Application } from "./routes.tsx"
import { makeNavigation } from "@effect-stack/router-react"
export const { Link, Navigate, useNavigate } = makeNavigation<Application>()
```

Type-only helpers use the nearest provider without runtime identity checks and avoid route definition import cycles.
Child definitions import their actual parent; parents must not eagerly import children.

See [adoption](../../docs/adoption.md) for runtime composition, [navigation contracts](../../docs/router-navigation.md)
for shared behavior, and [architecture](../../docs/architecture.md) for ownership.
