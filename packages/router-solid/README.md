# @effect-stack/router-solid

Client-side Solid routing with typed links, nested outlets, reactive route hooks, and boundaries over the
[`@effect-stack/router`](../router) core.

## Install and define routes

```sh
pnpm add @effect-stack/router-solid @effect-stack/router @effect/atom-solid@rc effect@rc solid-js
```

```tsx
import { createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from "@effect-stack/router-solid"
import { Effect, Schema } from "effect"

const root = createRootRoute({
  component: () => (
    <main>
      <Outlet />
    </main>
  )
})
const project = createRoute({
  getParentRoute: () => root,
  path: "projects/:id",
  params: { id: Schema.FiniteFromString },
  loader: ({ params }) => Effect.succeed({ title: `Project ${params.id}` }),
  component: Project
})
const router = createRouter({ routeTree: root.addChildren([project]) })

declare module "@effect-stack/router-solid" {
  interface Register {
    router: typeof router
  }
}

function Project() {
  const data = project.useLoaderData()
  return (
    <>
      <h1>{data().title}</h1>
      <Link to="/projects/:id" params={{ id: 43 }}>Next</Link>
    </>
  )
}

export const App = () => <RouterProvider router={router} />
```

## Native Solid behavior

`route.useParams()`, `route.useSearch()`, `route.useLoaderData()`, `route.useMatch()`, and `useRouterState()` return
accessors. Create the accessor during component setup and read it inside reactive expressions, so an existing route
component updates when params, search, or loader data change while its local state stays mounted. Route hooks accept
selectors, such as `project.useLoaderData((data) => data.title)`.

`useRouter()` returns the registered router. `useNavigate()` returns a function accepting the same typed destination as
`Link` and `router.href`; the returned Promise completes with its own navigation, and `useNavigateEffect()` exposes typed
Effect composition bound to the provider's registry. `Navigate` performs declarative navigation. See
[navigation contracts](../../docs/router-navigation.md) for completion, cancellation, incoming inputs, and
retained data.

Links render real anchors with native modified-click, target, download, and prevented-click behavior. Active links expose
`aria-current="page"` and `data-active="true"`; `exact` disables descendant-path active matching.

## Routes, loading, and boundaries

Child paths are relative. `/` is an index route; an `id` instead of a `path` defines a pathless layout. URL Schemas are
inherited, and `route.to` exposes the full literal route pattern.

`loader` prepares data; `lazy` imports code. Present `default`/`component` exports must be Solid components. An explicit
route `component` wins; modules with neither export use `Outlet`. Invalid selected views reach the nearest error boundary.

Declare `pendingComponent`, `errorComponent`, and `notFoundComponent` on routes. Error views receive `{ error, reset }`;
render errors use Solid's native error boundaries. See
[rendering and recovery](../../docs/router-navigation.md#rendering-and-recovery) for boundary selection and Retry.

## Effect service injection and lifetimes

Loaders request `Context.Service` values directly. Supply their implementations with `createRouter({ layer })`, composing
with Effect's `Layer.provide` and `Layer.merge`. The type system requires the tree's application services and rejects
unresolved Layer dependencies; tests can substitute `Layer.succeed` implementations. `history` is a separate Layer option,
defaulting to BrowserHistory; supply `MemoryHistory.layer()` in tests. See the
[Projects service](examples/basic/src/Projects.ts) and its [application wiring](examples/basic/src/App.tsx).

`RouterProvider` owns an Atom registry by default and disposes it with the Solid owner; a supplied `registry` remains
caller-owned. See [resource lifetime](../../docs/router-navigation.md#loading-and-resource-lifetime) for application
services and loader scopes.

See the [Solid example](examples/basic/src/App.tsx) for nested layouts, typed links, injected services, and a lazy view.
