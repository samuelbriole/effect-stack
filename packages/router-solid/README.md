# @effect-stack/router-solid

Native Solid routing with typed URL schemas and optional direct transition gates. Data belongs to official Effect Atom.

```sh
pnpm add @effect-stack/router-solid @effect-stack/router @effect/atom-solid effect@4 solid-js
```

## Setup

```tsx
import { make, layer, layout, Outlet, RouterProvider, useRouteInput } from "@effect-stack/router-solid"
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import { RegistryProvider } from "@effect/atom-solid"
import { Atom } from "effect/reactivity"
import { Effect, Layer, Schema } from "effect"
import type { JSX } from "solid-js"

const Projects = layout("projects", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  component: () => <Outlet />
})
const Index = Projects.index({ component: ProjectPage })
function ProjectPage(): JSX.Element {
  const input = useRouteInput(Index)
  return <h1>Project {input().params.projectId}</h1>
}
export const assembly = make("Example", [Index])
export type Application = Effect.Success<typeof assembly>
const runtime = Atom.runtime(layer(assembly).pipe(Layer.provide(BrowserHistory.layer)))
export const App = () => (
  <RegistryProvider>
    <RouterProvider runtime={runtime} />
  </RegistryProvider>
)
```

Components are ordinary Solid components without injected router props. `useRouteInput` returns a decoded-input accessor.
Component identity, getter reactivity, and child mounts remain native. Endpoints need a component or `empty: true`;
layouts may be transparent. `Outlet` renders nested routes.

`RouterProvider` accepts `runtime` and optional `pending`, a native component for initial loading.

## Resources and gates

Official `useAtomValue(() => atom)` returns an accessor. `useAtomResource(() => atom)` integrates with Solid resources and
Suspense; `useAtomRefresh(() => atom)` refreshes a resource. Use one composed runtime for the router and domain services by
default: `layer(assembly).pipe(Layer.provideMerge(services))` exposes the services for families built with `runtime.atom`.
See the [standalone example](examples/basic) for loading, failure, and refresh recovery.

`prepare: (decodedInput) => Effect<void, E, R>` is an optional gate; supply its services through Layers. Route `error`
receives `ViewFailureProps<E>` for gate/decode failures and retry. Native exceptions belong to Solid `ErrorBoundary`;
resource loading belongs to `Suspense`. `useRetry()` reruns gates, not resource loading.

## Navigation

When a canonical witness is available, `makeNavigation(app)` binds navigation helpers to the exact provider token.
`useRouter(app)`, `useRouterState(app)`, `useNavigate(app)`, and `useNavigateEffect(app)` also check that token;
no-argument hooks use the nearest provider. `useRouteInput(definition)` is an input-only accessor. Router state and service
hooks return accessors. Links preserve native modifiers, targets, downloads, refs, event tuples, and prevented events.

```ts
// navigation.ts
import type { Application } from "./App.tsx"
import { makeNavigation } from "@effect-stack/router-solid"
export const { Link, Navigate, useNavigate } = makeNavigation<Application>()
```

Type-only helpers use the nearest provider without runtime identity checks and avoid route definition import cycles.
Child definitions import their actual parent; parents must not eagerly import children.

See [adoption](../../docs/adoption.md) for runtime composition, [navigation contracts](../../docs/router-navigation.md)
for shared behavior, and [architecture](../../docs/architecture.md) for ownership.
