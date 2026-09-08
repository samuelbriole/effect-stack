# Adoption

EffectStack packages are incremental. Installing Router does not require adopting Query, Form, or DB packages.

For remote resources shared by Effect workflows and UI consumers, see the [Query guide](../packages/query/README.md).
Query has a scoped core and first-party adapters for [React](../packages/query-react), [Solid](../packages/query-solid), and
[Vue](../packages/query-vue), built on the official Atom bindings.

## Query adapters

Choose the adapter for your renderer and bind definitions in your application's scoped client. Each package exposes
`createQueryContext<App>()`, `useQuery`, and `useMutation`:

| Adapter                     | Query input                                              | Query result                        | Application context   |
| --------------------------- | -------------------------------------------------------- | ----------------------------------- | --------------------- |
| `@effect-stack/query-react` | Resource or optional resource                            | `AsyncResult<A, E>`                 | `App`                 |
| `@effect-stack/query-solid` | Accessor of resource or optional resource                | Accessor of `AsyncResult<A, E>`     | Accessor of `App`     |
| `@effect-stack/query-vue`   | Resource, ref, or getter, optionally wrapped in `Option` | Readonly ref of `AsyncResult<A, E>` | Readonly ref of `App` |

`Option.none()` disables observation. Mutation hooks accept application-acquired handles and expose native state plus
`executeEffect`, `startEffect`, `execute`, and `executeExit`. Use `executeExit` for typed, invocation-specific outcomes in
async event handlers. Accepted mutations remain client-owned when a waiter aborts or an observer unmounts.

Providers borrow their application value. Pass `registry={app.registry}` to share the application's registry with Router,
choose `"inherit"` to use the ambient native registry, or omit the prop for a provider-owned registry. Keep the client scope
alive until its UI is unmounted, and await scope closure before releasing application services.

## Install

While Effect v4 is under the release-candidate tag:

```sh
pnpm add @effect-stack/router effect@rc
```

Define routes once with `Route.make`, then create a facade with a History Layer:

```ts
import { BrowserHistory, Route, Router } from "@effect-stack/router"
import { Schema } from "effect"

const home = Route.make({ id: "home", path: "/", params: {}, search: {} })
const article = Route.make({
  id: "article",
  path: "/articles/:id",
  params: { id: Schema.FiniteFromString },
  search: { view: Schema.optionalKey(Schema.Literals(["full", "compact"])) }
})

export const router = Router.make({ routes: [home, article], layer: BrowserHistory.layer })
```

Use `MemoryHistory.layer("/initial")` in tests, SSR-like environments, and hosts without a DOM.

## Direct Atom usage

The public facade is ordinary Effect Atom state and an action Atom:

```ts
import { Router } from "@effect-stack/router"
import { Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"

const state = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const registry = AtomRegistry.make()
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
  yield* AtomRegistry.mount(registry, router.state)
  yield* AtomRegistry.mount(registry, router.navigate)
  registry.set(router.navigate, Router.push(home, { params: {}, search: {}, hash: "" }))
  yield* AtomRegistry.getResult(registry, router.navigate, { suspendOnWaiting: true })
  return registry.get(router.state)
})))
```

## React

For code-based nested routing, use the [first-party React adapter](../packages/router-react). It provides typed links,
route-local hooks, layouts, lazy views, and route boundaries, with a provider-owned Atom registry. See the
[React example](../packages/router-react/examples/basic/src/App.tsx) for a complete application.

For direct integration with the flat core router above, install `@effect/atom-react@rc`, mount `RegistryProvider`, and use
the official hooks:

```tsx
import { RegistryProvider, useAtomSet, useAtomValue } from "@effect/atom-react"

const View = () => {
  const state = useAtomValue(router.state)
  const navigate = useAtomSet(router.navigate)
  return <button onClick={() => navigate(Router.back)}>{state.waiting ? "Waiting" : "Back"}</button>
}

const App = () => (
  <RegistryProvider>
    <View />
  </RegistryProvider>
)
```

## Solid

For code-based nested routing, use the [first-party Solid adapter](../packages/router-solid). Its route-local hooks return
accessors, preserving Solid's fine-grained updates. The [Solid example](../packages/router-solid/examples/basic/src/App.tsx)
demonstrates nested layouts, typed links, injected Effect services, and a lazy view.

For direct integration with the flat core router above, install `@effect/atom-solid@rc` and use its accessor-based hooks:

```tsx
import { RegistryProvider, useAtomSet, useAtomValue } from "@effect/atom-solid"

const View = () => {
  const state = useAtomValue(() => router.state)
  const navigate = useAtomSet(() => router.navigate)
  return <button onClick={() => navigate(Router.back)}>{state().waiting ? "Waiting" : "Back"}</button>
}
```

## Vue

For code-based nested routing, use the [first-party Vue adapter](../packages/router-vue). Its route composables return
computed refs that templates auto-unwrap, with a provider-owned Atom registry. The
[Vue example](../packages/router-vue/examples/basic/src/ProjectLayout.vue) demonstrates nested layouts, typed links,
injected Effect services, and a lazy view.

For direct integration with the flat core router above, install `@effect/atom-vue@rc`, provide an Atom registry at the
application boundary, and use its Ref-based composables:

```ts
import { AtomRegistry, registryKey, useAtomSet, useAtomValue } from "@effect/atom-vue"
import { createApp, defineComponent, h } from "vue"

const View = defineComponent({
  setup() {
    const state = useAtomValue(() => router.state)
    const navigate = useAtomSet(() => router.navigate)
    return () => h("button", { onClick: () => navigate(Router.back) }, state.value.waiting ? "Waiting" : "Back")
  }
})

const registry = AtomRegistry.make()
const app = createApp(View)
app.provide(registryKey, registry)
app.onUnmount(() => registry.dispose())
app.mount("#root")
```

The React, Solid, and Vue examples exercise their first-party adapters; the
[renderer-neutral definitions](../packages/router/examples/shared) remain a shared core fixture.
