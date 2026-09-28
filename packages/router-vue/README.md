# @effect-stack/router-vue

Native Vue routing with typed URL schemas and optional direct Effect gates. Data belongs to official Effect Atom resources.

```sh
pnpm add @effect-stack/router-vue @effect-stack/router @effect/atom-vue effect@rc vue
```

## Setup

```ts
import { make, layout, Provider, Outlet, useRouteInput } from "@effect-stack/router-vue"
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import { Atom } from "effect/reactivity"
import { Layer, Schema } from "effect"
import { defineComponent, h, type VNodeChild } from "vue"

const Projects = layout("projects", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  component: () => h(Outlet)
})
const ProjectPage = defineComponent({
  setup(): () => VNodeChild {
    const input = useRouteInput(Index)
    return () => h("h1", `Project ${input.value.params.projectId}`)
  }
})
const Index = Projects.index({ component: ProjectPage })
const Application = make("Example", [Index])
const runtime = Atom.runtime(Application.layer.pipe(Layer.provide(BrowserHistory.layer)))
export const App = defineComponent({
  setup: () => () => h(Provider<typeof Application>, { app: Application, runtime })
})
```

Native components receive no mandatory injected router props. `useRouteInput` returns a computed ref to coherent displayed
input; pending navigation retains the original branch/input. A `render: () => VNodeChild` callback is also supported.
Endpoints require component/render or `empty: true`; layouts can be transparent. `Outlet` continues nested rendering.

## Resources and gates

Official `useAtomValue(() => atom)` returns a readonly ref. Select a domain-owned family using computed decoded input,
and refresh via `injectRegistry().refresh(atom)`. Use one composed runtime for the router and domain services by default:
`Application.layer.pipe(Layer.provideMerge(services))` exposes the services for families built with `runtime.atom`.
Resource subscriptions and cancellation remain independent of navigation. The [standalone example](examples/basic)
demonstrates reachable loading/failure/success and refresh recovery.

`prepare: (decodedInput) => Effect<void, E, R>` is optional and direct. Supply requirements through Layers. History is
written first, then transient gate scopes close before atomic branch publication. The Provider's `pending` prop supplies a native
component for initial loading, with no mandatory props. Route error views handle gate/decode failures only;
`ViewFailureProps<E>` distinguishes typed pure gate failures from full Causes. Render exceptions propagate to application-owned
Vue `onErrorCaptured` boundaries. Router retry reruns gates and does not refresh application resources.

## Navigation

`makeNavigation(Application)` and `useRouter(Application)`, `useRouterState(Application)`, `useNavigate(Application)`, and
`useNavigateEffect(Application)` validate exact provider tokens. Links are real anchors and retain Vue
`mergeProps` listener arrays, native cancellation, modifiers, targets, and downloads. `useRouteInput` is an input-only computed
ref; `useRouterState` is computed and `useRouter` returns a service accessor.

```ts
// navigation.ts — no runtime application import
import type { Application } from "./router.ts"
import { makeNavigation } from "@effect-stack/router-vue"
export const { Link, Navigate, useNavigate } = makeNavigation<typeof Application>()
```

Unbound helpers resolve against the nearest provider and cannot check erased application identity; use bound helpers for
exact token checks. Child modules import their actual parent definition. Type-only helpers avoid eager destination imports
and parent/child cycles without a mutable registration singleton.

The generic `Provider({ app, runtime })` checks the application's service requirement. Vue's `h` overload cannot infer
generic application evidence: use `h(Provider<typeof Application>, { app: Application, runtime })`. This erases runtime
construction errors, but retains exact service checks. Direct calls preserve the supplied runtime's error and requirement channels.

See [adoption](../../docs/adoption.md) and [navigation contracts](../../docs/router-navigation.md).
