# @effect-stack/router-react

First-party React adapter for `@effect-stack/router`.

```sh
pnpm add @effect-stack/router-react @effect-stack/router @effect/atom-react effect@rc react
```

## Provider

```tsx
import { RegistryProvider } from "@effect/atom-react"
import { RouterProvider } from "@effect-stack/router-react"
import { Atom } from "effect/unstable/reactivity"
import { RouterLive, Routes } from "./router.ts"

const runtime = Atom.runtime(RouterLive)

const views = {
  home: HomePage,
  project: { component: ProjectPage, pending: ProjectPending, error: ProjectError },
  login: LoginPage
}

export const App = () => (
  <RegistryProvider>
    <RouterProvider routes={Routes} runtime={runtime} views={views} />
  </RegistryProvider>
)
```

`RouterProvider` mounts the supplied runtime in the surrounding official `RegistryProvider`. Views mirror the contract's
grouping; layout components render `<Outlet />` to continue the branch.

## Hooks

```tsx
function ProjectPage() {
  const { params, search, data } = useRoute(Routes.project)
  return <h1>{data.title}</h1>
}
```

- `useRoute(node)` returns decoded inputs and prepared data for the active branch. It throws a diagnosed error outside a
  resolved branch.
- `useRouter()` returns the runtime router service for imperative navigation.
- `useRouterState()` returns the read-only snapshot.
- `useNavigate()` returns a Promise-based navigation function; `useNavigateEffect()` returns an Effect; `useRetry()`
  reruns the observed URL through the router service.

## Links and declarative navigation

```tsx
<Link to={Routes.project({ params })}>Project</Link>
<Navigate to={Routes.login({ search: { returnTo } })} replace />
```

`Link` renders a real anchor and preserves native modifier keys, alternate targets, downloads, and prevented events.

See the [navigation contracts](../../docs/router-navigation.md).
