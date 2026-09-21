# @effect-stack/router-react

Client-side React routing with typed links, nested outlets, route hooks, and boundaries over the
[`@effect-stack/router`](../router) core.

## Install and define routes

```sh
pnpm add @effect-stack/router-react @effect-stack/router @effect/atom-react@rc effect@rc react react-dom
```

```tsx
import { createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from "@effect-stack/router-react"
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

declare module "@effect-stack/router-react" {
  interface Register {
    router: typeof router
  }
}

function Project() {
  const data = project.useLoaderData()
  return (
    <>
      <h1>{data.title}</h1>
      <Link to="/projects/:id" params={{ id: 43 }}>Next</Link>
    </>
  )
}

export const App = () => <RouterProvider router={router} />
```

## Route definitions

- A root owns the application layout. Child paths are relative; `/` defines an index route, and an `id` in place of `path`
  defines a pathless layout.
- Params and search Schemas are inherited; redefining inherited fields is rejected.
- `route.to` is the full literal route pattern. `Link`, `useNavigate`, and `router.href` share destination typing; empty
  params/search and the default empty hash may be omitted.
- Route hooks accept selectors, for example `project.useLoaderData((data) => data.title)`. `useLoaderData` and `useMatch`
  require a resolved snapshot; pending/error views read decoded incoming inputs as described in
  [navigation contracts](../../docs/router-navigation.md).

## Navigation and links

`useNavigate()` returns a Promise that completes with its own navigation. `useNavigateEffect()` preserves typed failures
and Effect composition using the provider's registry, and `Navigate` performs declarative navigation. `useRouterState()`
subscribes to the router state Atom, optionally through a selector.

`Link` renders a real anchor and preserves modifiers, targets, downloads, and prevented clicks. Active links expose
`aria-current="page"` and `data-active="true"`; `exact` disables descendant-path active matching.

## Loading, services, and boundaries

`loader` prepares data; `lazy` imports code. Present `default`/`component` exports must be React components. An explicit
route `component` wins; modules with neither export use `Outlet`. Invalid selected views reach the nearest error boundary.

Application dependencies are `Context.Service` values requested directly by loaders. `createRouter` requires an
application `layer` whenever the route tree requires services. Compose implementations with `Layer.provide`/`Layer.merge`;
use `Layer.succeed` to substitute test services.

`history` is a separate Layer option, defaulting to BrowserHistory; pass `MemoryHistory.layer()` as the `history` option
in tests. The
[Projects example service](examples/basic/src/Projects.ts) demonstrates an injectable implementation.

Declare `pendingComponent`, `errorComponent`, and `notFoundComponent` on routes. Error components receive `{ error, reset }`.
See [rendering and recovery](../../docs/router-navigation.md#rendering-and-recovery) for boundary selection and Retry.

The provider owns an Atom registry by default, including React StrictMode-safe disposal; pass `registry` to integrate with
a caller-owned registry. See [resource lifetime](../../docs/router-navigation.md#loading-and-resource-lifetime) for
application services and loader scopes.

See the [React example](examples/basic/src/App.tsx) for nested layouts, typed links, injected services, and a lazy view.
