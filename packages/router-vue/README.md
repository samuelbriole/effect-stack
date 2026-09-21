# @effect-stack/router-vue

Client-side Vue routing with typed links, nested outlets, route composables, and boundaries over the
[`@effect-stack/router`](../router) core.

## Install and define routes

```sh
pnpm add @effect-stack/router-vue @effect-stack/router @effect/atom-vue@rc effect@rc vue
```

Define routes in a plain `.ts` module, register the router type once, and mount the provider from your root component.

```ts
// router.ts
import { createRootRoute, createRoute, createRouter, Outlet } from "@effect-stack/router-vue"
import { Effect, Schema } from "effect"
import { h } from "vue"
import ProjectView from "./ProjectView.vue"

const root = createRootRoute({ component: () => h(Outlet) })
export const project = createRoute({
  getParentRoute: () => root,
  path: "projects/:id",
  params: { id: Schema.FiniteFromString },
  loader: ({ params }) => Effect.succeed({ title: `Project ${params.id}` }),
  component: ProjectView
})
export const router = createRouter({ routeTree: root.addChildren([project]) })

declare module "@effect-stack/router-vue" {
  interface Register {
    router: typeof router
  }
}
```

```vue
<!-- App.vue -->
<script setup lang="ts">
import { RouterProvider } from "@effect-stack/router-vue"
import { router } from "./router.ts"
</script>

<template>
  <RouterProvider :router="router" />
</template>
```

## Vue reactivity

`route.useParams()`, `route.useSearch()`, `route.useLoaderData()`, and `route.useMatch()` return `ComputedRef` values, and
`useRouterState()` returns a readonly `Ref`. Read them with `.value` in setup code; templates auto-unwrap refs, so an
existing route component updates reactively when params, search, or loader data change while its local state remains
mounted:

```vue
<!-- ProjectView.vue -->
<script setup lang="ts">
import { Link } from "@effect-stack/router-vue"
import { project } from "./router.ts"

const data = project.useLoaderData()
const params = project.useParams()
</script>

<template>
  <h1>{{ data.title }}</h1>
  <nav>
    <Link to="/projects/:id" :params="params" exact>Overview</Link>
  </nav>
</template>
```

Route hooks accept selectors, such as `project.useLoaderData((data) => data.title)`. `useRouter()` returns the registered
router, and `useNavigate()` returns a function accepting the same typed destination as `Link` and `router.href`; the
returned Promise completes with its own navigation, and `useNavigateEffect()` exposes typed Effect composition bound to the
provider's registry. `Navigate` performs declarative navigation. In `.ts` render functions that return `h(Link, ...)`,
annotate the result as `VNode` so the route type and the `Register` augmentation stay non-circular; SFC views importing
route composables avoid this entirely.

## Routes, loading, and boundaries

Views are ordinary Vue components: SFCs, `defineComponent` results, or functional render functions. A root owns the
application layout. Child paths are relative; `/` defines an index route, and an `id` in place of `path` defines a pathless
layout. Params and search Schemas are inherited, and `route.to` is the full literal route pattern; `Link`, `useNavigate`,
and `router.href` share destination typing.

`loader` prepares data; `lazy` imports code. Present `default`/`component` exports must be Vue components. An explicit
route `component` wins; modules with neither export use `Outlet`. Invalid selected views reach the nearest error boundary.

Declare `pendingComponent`, `errorComponent`, and `notFoundComponent` on routes. Error components receive `{ error, reset }`
props. See [navigation contracts](../../docs/router-navigation.md) for completion, cancellation, snapshots, and recovery.

## Effect service injection and lifetimes

Loaders request `Context.Service` values directly. Supply their implementations with `createRouter({ layer })`, composing
with Effect's `Layer.provide` and `Layer.merge`. The type system requires the tree's application services and rejects
unresolved Layer dependencies; tests can substitute `Layer.succeed` implementations. `history` is a separate Layer option,
defaulting to BrowserHistory; supply `MemoryHistory.layer()` in tests.

`RouterProvider` owns an Atom registry by default and disposes it with its component scope; a supplied `registry` prop
remains caller-owned. See [resource lifetime](../../docs/router-navigation.md#loading-and-resource-lifetime), the
[Projects service](examples/basic/src/Projects.ts), and its [router wiring](examples/basic/src/router.ts).

`Link` renders a real anchor and preserves modifiers, targets, downloads, and prevented clicks; active links expose
`aria-current="page"` and `data-active="true"`, and `exact` disables descendant-path active matching.

See the [Vue example](examples/basic/src/ProjectLayout.vue) for nested layouts, typed links, injected services, and a lazy
SFC view.
