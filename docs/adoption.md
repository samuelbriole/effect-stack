# Adopt Router

Choose an integration; each package can be adopted independently. Router targets Effect v4 RC.

| Use case                              | Start here                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Nested React views                    | [React adapter](../packages/router-react) · [example](../packages/router-react/examples/basic) |
| Nested Solid views                    | [Solid adapter](../packages/router-solid) · [example](../packages/router-solid/examples/basic) |
| Nested Vue views                      | [Vue adapter](../packages/router-vue) · [example](../packages/router-vue/examples/basic)       |
| Headless routing or a custom renderer | [Core API](../packages/router) and the examples below                                          |

## Headless usage

```sh
pnpm add @effect-stack/router effect@rc
```

This complete example uses memory history and owns its registry. Browser applications can use `BrowserHistory.layer`.

```ts
import { MemoryHistory, Route, Router } from "@effect-stack/router"
import { Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"

const home = Route.make({ id: "home", path: "/", params: {}, search: {} })
const router = Router.make({ routes: [home], layer: MemoryHistory.layer() })

const state = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const registry = AtomRegistry.make()
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
  yield* AtomRegistry.mount(registry, router.state)
  yield* router.execute(Router.refresh).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
  return registry.get(router.state)
})))
```

Use the same registry for observations and commands. Dispose registries you create; borrowed registries remain owned by
their caller. `execute` returns an Effect; observing an Atom does not dispatch a command.

## Direct renderer integration

For a custom UI over the headless core, use the official Effect Atom adapters. First-party Router adapters add typed
links, outlets, route hooks, and boundaries on top of these primitives.

| Renderer | Package                 | Read state                                             | Access the registry                                              |
| -------- | ----------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| React    | `@effect/atom-react@rc` | `useAtomValue(router.state)`                           | `useContext(RegistryContext)` inside `RegistryProvider`          |
| Solid    | `@effect/atom-solid@rc` | `useAtomValue(() => router.state)` returns an accessor | `useContext(RegistryContext)` inside `RegistryProvider`          |
| Vue      | `@effect/atom-vue@rc`   | `useAtomValue(() => router.state)` returns a ref       | `inject(registryKey)` after `app.provide(registryKey, registry)` |

For example, after exporting your core `router` from `./router.ts`, a React view can observe navigation and dispatch a
refresh. Install `@effect/atom-react@rc` alongside the core and React:

```tsx
import { Router } from "@effect-stack/router"
import { RegistryContext, RegistryProvider, useAtomValue } from "@effect/atom-react"
import { Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"
import { useContext } from "react"
import { router } from "./router.ts"

const View = () => {
  const navigation = useAtomValue(router.navigation)
  const registry = useContext(RegistryContext)
  const refresh = () =>
    void Effect.runPromise(
      router.execute(Router.refresh).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
    ).catch(() => {}) // Failures are rendered from the observed result below.
  return (
    <>
      <button onClick={refresh} disabled={navigation.waiting}>Refresh</button>
      {navigation._tag === "Failure" && <p role="alert">Navigation failed.</p>}
    </>
  )
}

export const App = () => (
  <RegistryProvider>
    <View />
  </RegistryProvider>
)
```

Solid and Vue event handlers run `execute` with their registry in the same way. In Vue, register disposal with
`app.onUnmount(() => registry.dispose())` when the application owns the registry.

See [navigation contracts](router-navigation.md) for completion, cancellation, retained data, and recovery.
