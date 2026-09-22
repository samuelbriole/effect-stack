# @effect-stack/router-vue

First-party Vue adapter for `@effect-stack/router`.

```sh
pnpm add @effect-stack/router-vue @effect-stack/router @effect/atom-vue effect@rc vue
```

## Provider

```ts
import { createApp, h } from "vue"
import { RouterProvider } from "@effect-stack/router-vue"
import { Atom } from "effect/unstable/reactivity"
import { RouterLive, Routes } from "./router.ts"

const runtime = Atom.runtime(RouterLive)

const views = {
  home: HomePage,
  project: { component: ProjectPage, pending: ProjectPending, error: ProjectError }
}

createApp(() => h(RouterProvider, { routes: Routes, runtime, views })).mount("#app")
```

Provide the official Atom registry with `app.provide(registryKey, registry)` when the application owns one. Layout
components render `h(Outlet)` to continue the branch.

## Composables

Vue composables return computed refs:

```ts
const route = useRoute(Routes.project)
const title = computed(() => route.value.data.title)
```

- `useRoute(node)` returns a computed ref of decoded inputs and prepared data.
- `useRouter()` returns a function returning the runtime service.
- `useRouterState()` returns a computed ref of the read-only snapshot.
- `useNavigate()`, `useNavigateEffect()`, and `useRetry()` mirror the React adapter.

`Link` renders a real anchor with typed destinations and native event behavior.

See the [navigation contracts](../../docs/router-navigation.md).
