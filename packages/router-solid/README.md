# @effect-stack/router-solid

Native Solid routing with typed URL schemas and optional direct transition gates. Data belongs to official Effect Atom.

```sh
pnpm add @effect-stack/router-solid @effect-stack/router @effect/atom-solid effect@4 solid-js
```

## Setup

```tsx
import { make, layout, Outlet, Provider, useRouteInput } from "@effect-stack/router-solid"
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import { RegistryProvider } from "@effect/atom-solid"
import { Atom } from "effect/reactivity"
import { Layer, Schema } from "effect"
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
const Application = make("Example", [Index])
const runtime = Atom.runtime(Application.layer.pipe(Layer.provide(BrowserHistory.layer)))
export const App = () => (
  <RegistryProvider>
    <Provider app={Application} runtime={runtime} />
  </RegistryProvider>
)
```

Components are ordinary Solid components with no mandatory router props. `useRouteInput` returns an accessor to coherent
displayed input, retaining the old value while navigation is pending. Solid component identity, getter reactivity, child
mounts, and native tuple event handlers remain native. Endpoints require a component or `empty: true`; layouts can be
transparent. `Outlet` continues nested rendering.

## Resources and gates

Official `useAtomValue(() => atom)` returns an accessor. `useAtomResource(() => atom)` integrates with Solid resources and
Suspense; `useAtomRefresh(() => atom)` refreshes a resource. Use one composed runtime for the router and domain services by
default: `Application.layer.pipe(Layer.provideMerge(services))` exposes the services for families built with `runtime.atom`.
Resource subscriptions and cancellation remain independent of navigation. The [standalone example](examples/basic)
demonstrates loading, failure, and refresh recovery.

`prepare: (decodedInput) => Effect<void, E, R>` is an optional direct gate, not a data loader or URL-write guard. Its
requirements come from supplied Layers. The Provider's `pending` prop supplies the initial loading component; pending navigation
retains the displayed branch. Route `error` receives `ViewFailureProps<E>` for gate/decode failures and retry. Native
exceptions belong to application-owned `ErrorBoundary`; resource loading belongs to `Suspense`. Router retry reruns gates
freshly; resource refresh and boundary reset never implicitly rerun gates.

## Navigation

`makeNavigation(Application)` binds navigation helpers to the exact provider token. `useRouter(Application)`,
`useRouterState(Application)`, `useNavigate(Application)`, and `useNavigateEffect(Application)` also check that token;
no-argument hooks use the nearest provider. `useRouteInput(definition)` is an input-only accessor. Router state and service
hooks return accessors. Links preserve native modifiers, targets, downloads, refs, event tuples, and prevented events.

```ts
// navigation.ts
import type { Application } from "./App.tsx"
import { makeNavigation } from "@effect-stack/router-solid"
export const { Link, Navigate, useNavigate } = makeNavigation<typeof Application>()
```

Type-only helpers import no route definition module and resolve against the nearest provider; erased identity cannot
be checked at runtime. Use bound helpers for exact token checks. Child definitions import their actual parent, never an
assembled application; parents must not eagerly import children.

See [adoption](../../docs/adoption.md) and [navigation contracts](../../docs/router-navigation.md).
