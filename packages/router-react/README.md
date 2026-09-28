# @effect-stack/router-react

Native React routing with typed URL schemas and optional direct Effect transition gates. Data uses official Effect Atom
resources independently of the router.

```sh
pnpm add @effect-stack/router-react @effect-stack/router @effect/atom-react effect@rc react
```

## Setup

```tsx
import { make, layout, Outlet, Provider, useRouteInput } from "@effect-stack/router-react"
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import { RegistryProvider } from "@effect/atom-react"
import { Atom } from "effect/reactivity"
import { Layer, Schema } from "effect"
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
const Application = make("Example", [Index])
const runtime = Atom.runtime(Application.layer.pipe(Layer.provide(BrowserHistory.layer)))
export const App = () => (
  <RegistryProvider>
    <Provider app={Application} runtime={runtime} />
  </RegistryProvider>
)
```

Components are ordinary React function, class, or memo components with no mandatory injected router props. `useRouteInput`
returns the displayed branch's coherent decoded input, retaining old input during pending navigation. Annotate native
return types for self-referencing component inference. Every endpoint needs a component or `empty: true`; layouts may be
transparent. `Outlet` continues nested rendering.

## Resources and gates

Use official `useAtomValue`, `useAtomSuspense`, and `useAtomRefresh` with domain-owned atoms/families. See the complete
[standalone example](examples/basic) and [Atom-first adoption example](../../docs/adoption.md). Resource refresh is separate
from `useRetry()`, which only reruns gates. Native exceptions propagate to application-owned React error boundaries;
resetting those boundaries or refreshing resources does not implicitly retry gates.

Use one composed runtime for the router and domain services by default. Supply domain services with
`Application.layer.pipe(Layer.provideMerge(services))`, then define resource families with that same `runtime.atom`.
Sharing the runtime does not make navigation cancellation cancel independently subscribed resources.

`prepare: (input) => Effect<void, E, R>` is optional and direct. Supplied Layers provide its services; transient gate scopes
close before branch publication. The Provider's `pending` prop supplies an ordinary component shown before any resolved branch;
`error` receives `ViewFailureProps<E>` for gate/decode failures with a
typed pure domain failure or full infrastructure/mixed Cause, plus retry. History is written before gates run.

## Navigation

`makeNavigation(Application)` supplies exact-token-bound `Link`, `Navigate`, `useNavigate`, and `useNavigateEffect`.
Links accept identity destinations or typed endpoint path templates with correlated params/search/hash.
Links are real anchors, preserving modifier keys, downloads, targets, native cancellation, React 19 refs, and replace/state.
`useRouter(app)`, `useRouterState(app)`, `useNavigate(app)`, and `useNavigateEffect(app)` validate the exact application
token; their no-argument forms use the nearest provider. `useRouteInput(definition)` reads decoded input, not resource data.

```tsx
// navigation.tsx — no runtime application or destination import
import type { Application } from "./routes.tsx"
import { makeNavigation } from "@effect-stack/router-react"
export const { Link, Navigate, useNavigate } = makeNavigation<typeof Application>()
```

Unbound helpers resolve against the nearest provider: the erased application type cannot be runtime-verified. Bound
helpers enforce exact identity. Child modules import their actual parent definition; parents must not eagerly import
children. Type-only navigation avoids route definition import cycles without a mutable registration singleton.

See [navigation contracts](../../docs/router-navigation.md).
