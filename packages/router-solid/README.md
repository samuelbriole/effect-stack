# @effect-stack/router-solid

First-party Solid adapter for `@effect-stack/router`.

```sh
pnpm add @effect-stack/router-solid @effect-stack/router @effect/atom-solid effect@rc solid-js
```

## Provider

```tsx
import { RegistryProvider } from "@effect/atom-solid"
import { RouterProvider } from "@effect-stack/router-solid"
import { Atom } from "effect/unstable/reactivity"
import { RouterLive, Routes } from "./router.ts"

const runtime = Atom.runtime(RouterLive)

const views = {
  home: HomePage,
  project: { component: ProjectPage, pending: ProjectPending, error: ProjectError }
}

export const App = () => (
  <RegistryProvider>
    <RouterProvider routes={Routes} runtime={runtime} views={views} />
  </RegistryProvider>
)
```

Layout components render `<Outlet />` to continue the branch.

## Hooks

Solid hooks return native accessors:

```tsx
function ProjectPage() {
  const route = useRoute(Routes.project)
  return <h1>{route().data.title}</h1>
}
```

- `useRoute(node)` returns an accessor of decoded inputs and prepared data.
- `useRouter()` returns an accessor of the runtime service.
- `useRouterState()` returns an accessor of the read-only snapshot.
- `useNavigate()`, `useNavigateEffect()`, and `useRetry()` mirror the React adapter.

`Link` renders a real anchor with typed destinations and native event behavior.

See the [navigation contracts](../../docs/router-navigation.md).
