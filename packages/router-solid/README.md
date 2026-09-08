# @effect-stack/router-solid

First-party client-side Solid routing over the EffectStack headless core.

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
accessors. Create the accessor during component setup and read it inside reactive expressions. This lets an existing route
component update when params, search, or loader data change while its local state remains mounted.

Route hooks accept selectors, such as `project.useLoaderData((data) => data.title)`. Params/search in pending/error views
read decoded incoming inputs; ordinary views retain the inputs associated with their resolved data.

`useRouter()` returns the registered router. `useNavigate()` returns a function accepting the same typed destination as
`Link` and `router.href`. `Navigate` performs declarative navigation. Links render real anchors with native modified-click,
target, download, and prevented-click behavior. Active links expose `aria-current="page"` and `data-active="true"`;
`exact` disables descendant-path active matching.

The navigation function returns a Promise completing with its own navigation. `useNavigateEffect()` exposes typed Effect
composition bound to the provider's registry. See [navigation and match snapshots](../../docs/router-navigation.md) for
completion, cancellation, and retained-data semantics.

## Routes, loading, and boundaries

Child paths are relative. `/` is an index route; an `id` instead of a `path` defines a pathless layout. URL Schemas are
inherited. Static segments outrank dynamic segments, and an index owns its shared URL's destination requirements.
`route.to` exposes the full literal route pattern for navigation and eventual generated file routes.

`loader` returns an Effect using decoded params, search, hash, and location. `load` independently imports a view module
with a `default` or `component` export. An explicit `component` takes precedence. Ancestors resolve before descendants;
code and data load concurrently within each route. Superseding navigation interrupts pending work.

`pendingComponent`, `errorComponent`, and `notFoundComponent` bubble to the nearest declaring ancestor, replacing its view
and descendants while preserving layouts above it. Error views receive `{ error, reset }`; `reset()` refreshes the URL.
Solid render errors use native error boundaries. Recovery waits for successfully refreshed data before clearing a latched
render error. Startup Retry rebuilds failed initialization.

## Effect service injection and lifetimes

Loaders request `Context.Service` values directly. Supply their implementations with `createRouter({ layer })`, using
Effect's `Layer.provide` and `Layer.merge` for composition. The type system requires the tree's application services and
rejects unresolved Layer dependencies. Tests can substitute `Layer.succeed` implementations. See the
[Projects service](examples/basic/src/Projects.ts) and its [application wiring](examples/basic/src/App.tsx).

`history` is a separate Effect Layer option, defaulting to BrowserHistory; supply MemoryHistory in tests.
`RouterProvider` owns an Atom registry by default and disposes it with the Solid owner. A supplied `registry` remains
caller-owned. Services are shared while the runtime stays mounted; Atom may release idle runtimes after their last
subscriber unmounts. Registry disposal also releases their scoped resources. Resources acquired inside a loader close
with its transition scope before data publication.

The adapter shares URL interpretation, destination typing, navigation state, and Effect lifetimes with the headless core.
Remote-resource caching belongs to application services or Query. SSR and hydration are deferred.
