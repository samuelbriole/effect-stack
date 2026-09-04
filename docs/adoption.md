# Adoption

EffectStack packages are incremental. Installing Router does not require adopting future Query, Form, or DB packages.

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

Install `@effect/atom-react@rc`, mount `RegistryProvider`, then use the official hooks directly:

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

Install `@effect/atom-solid@rc` and use its accessor-based hooks:

```tsx
import { RegistryProvider, useAtomSet, useAtomValue } from "@effect/atom-solid"

const View = () => {
  const state = useAtomValue(() => router.state)
  const navigate = useAtomSet(() => router.navigate)
  return <button onClick={() => navigate(Router.back)}>{state().waiting ? "Waiting" : "Back"}</button>
}
```

## Vue

Install `@effect/atom-vue@rc`, provide an Atom registry at the application boundary, and use its Ref-based composables:

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

See the complete [React](../examples/router-react), [Solid](../examples/router-solid), and
[Vue](../examples/router-vue) tracers, all of which consume the same
[renderer-neutral definitions](../examples/router-shared).
