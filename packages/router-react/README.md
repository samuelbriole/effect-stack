# @effect-stack/router-react

First-party client-side React routing over the EffectStack headless core.

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

- A root owns the application layout. Child paths are relative; `/` defines an index route.
- An `id` in place of `path` defines a pathless layout.
- Params and search Schemas are inherited. Redefining inherited fields is rejected.
- Static segments outrank dynamic segments. Ambiguous templates and misplaced children fail when the router is created.
- `route.to` is the full literal route pattern. `Link`, `useNavigate`, and `router.href` share destination typing.
  Empty params/search and the default empty hash may be omitted.
- Route-bound `useParams`, `useSearch`, `useLoaderData`, and `useMatch` read a resolved active match and fail clearly outside it.

## Loading and boundaries

`loader` returns an Effect using decoded URL inputs. Supply its services through `createRouter({ layer })`.
`history` is a separate Layer option, defaulting to BrowserHistory; MemoryHistory is useful in tests.
`load` imports a lazy view module with a `default` or `component` export. An explicit `component` takes precedence.

Ancestors resolve before descendants. Within each route, code and data load concurrently. Navigation supersession and
registry disposal interrupt the branch. Successful results are retained while that route refreshes; resources opened
in a loader's scope close before its result is published. Remote-resource caching belongs in application services or Query.

`pendingComponent`, `errorComponent`, and `notFoundComponent` bubble to the nearest declaring ancestor, replacing that
route's view and descendants. Layouts above the boundary remain mounted. Error components receive `{ error, reset }`;
`reset()` refreshes the current URL. Render errors also use the nearest error boundary.

The provider owns an Atom registry by default, including React StrictMode-safe disposal. Pass `registry` to integrate with
a caller-owned registry. `Link` renders a real anchor and preserves modifiers, targets, downloads, and prevented clicks;
active links expose `aria-current="page"` and `data-active="true"`. `exact` disables descendant-path active matching.

See the [React example](examples/basic/src/App.tsx). Route-pattern destinations and one-time registration form
the migration seam for future generated file routes. SSR and hydration are deferred.
