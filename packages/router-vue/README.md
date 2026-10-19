# @effect-stack/router-vue

Native Vue routing with typed URL schemas and optional direct Effect gates. Data belongs to official Effect Atom resources.

```sh
pnpm add @effect-stack/router-vue @effect-stack/router @effect/atom-vue effect@4 vue
```

## Setup

```ts
import { make, layer, layout, RouterProvider, Outlet, useRouteInput } from "@effect-stack/router-vue"
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import { Atom } from "effect/reactivity"
import { Effect, Layer, Schema } from "effect"
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
export const assembly = make("Example", [Index])
export type Application = Effect.Success<typeof assembly>
const runtime = Atom.runtime(layer(assembly).pipe(Layer.provide(BrowserHistory.layer)))
export const App = defineComponent({
  setup: () => () => h(RouterProvider, { runtime })
})
```

Native components receive no injected router props. `useRouteInput` returns a decoded-input computed ref.
A `render: () => VNodeChild` callback is also supported. Endpoints need component/render or `empty: true`;
layouts may be transparent. `Outlet` renders nested routes.

`RouterProvider` accepts `runtime` and optional `pending`, a native component for initial loading. For `h` calls with extra
services, use `RouterProvider<R>` with the runtime's service union if Vue cannot infer it.

## Resources and gates

Official `useAtomValue(() => atom)` returns a readonly ref. Select a domain-owned family using computed decoded input,
and refresh via `injectRegistry().refresh(atom)`. Use one composed runtime for the router and domain services by default:
`layer(assembly).pipe(Layer.provideMerge(services))` exposes the services for families built with `runtime.atom`.
See the [standalone example](examples/basic) for loading, failure, and refresh recovery.

`prepare: (decodedInput) => Effect<void, E, R>` is an optional gate; supply its services through Layers. Route `error`
receives `ViewFailureProps<E>` for gate/decode failures and retry. Render exceptions belong to Vue `onErrorCaptured`
boundaries. Router retry reruns gates, not resource loading.

## Navigation

`makeNavigation(app)` and `useRouter(app)`, `useRouterState(app)`, `useNavigate(app)`, and
`useNavigateEffect(app)` validate exact provider tokens when supplied an acquired application witness. Links are real anchors and retain Vue
`mergeProps` listener arrays, native cancellation, modifiers, targets, and downloads. `useRouteInput` is an input-only computed
ref; `useRouterState` is computed and `useRouter` returns a service accessor.

```ts
// navigation.ts — no runtime application import
import type { Application } from "./router.ts"
import { makeNavigation } from "@effect-stack/router-vue"
export const { Link, Navigate, useNavigate } = makeNavigation<Application>()
```

Type-only helpers use the nearest provider without runtime identity checks and avoid route definition import cycles.
Child definitions import their actual parent; parents must not eagerly import children.

See [adoption](../../docs/adoption.md) for runtime composition, [navigation contracts](../../docs/router-navigation.md)
for shared behavior, and [architecture](../../docs/architecture.md) for ownership.
