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

The public facade is ordinary Effect Atom state plus the `router.execute(command)` Effect interface for navigation:

```ts
import { Router } from "@effect-stack/router"
import { Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"

const state = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
  const registry = AtomRegistry.make()
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()))
  yield* AtomRegistry.mount(registry, router.state)
  yield* router
    .execute(Router.push(home, { params: {}, search: {}, hash: "" }))
    .pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
  return registry.get(router.state)
})))
```

`router.branch`, `router.completed`, and `router.navigation` remain read-only observations; they never dispatch work.

## React

For code-based nested routing, use the [first-party React adapter](../packages/router-react). It provides typed links,
route-local hooks, layouts, lazy views, and route boundaries, with a provider-owned Atom registry. See the
[React example](../packages/router-react/examples/basic/src/App.tsx) for a complete application.

For direct integration with the flat core router above, install `@effect/atom-react@rc`, mount `RegistryProvider`, and use
the official hooks. Event handlers dispatch `execute` through the ambient registry:

```tsx
import { RegistryContext, RegistryProvider, useAtomValue } from "@effect/atom-react"
import { AtomRegistry } from "effect/unstable/reactivity"

const View = () => {
  const state = useAtomValue(router.state)
  const registry = React.useContext(RegistryContext)
  const goBack = () =>
    void Effect
      .runPromise(router.execute(Router.back).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry)))
      .catch(() => {})
  return <button onClick={goBack}>{state.waiting ? "Waiting" : "Back"}</button>
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
import { RegistryContext, useAtomValue } from "@effect/atom-solid"
import { AtomRegistry } from "effect/unstable/reactivity"
import { useContext } from "solid-js"

const View = () => {
  const state = useAtomValue(() => router.state)
  const registry = useContext(RegistryContext)
  const goBack = () =>
    void Effect
      .runPromise(router.execute(Router.back).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry)))
      .catch(() => {})
  return <button onClick={goBack}>{state().waiting ? "Waiting" : "Back"}</button>
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
import { AtomRegistry, registryKey, useAtomValue } from "@effect/atom-vue"
import { createApp, defineComponent, h, inject } from "vue"

const View = defineComponent({
  setup() {
    const state = useAtomValue(() => router.state)
    const registry = inject(registryKey)!
    const goBack = () =>
      void Effect
        .runPromise(router.execute(Router.back).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry)))
        .catch(() => {})
    return () => h("button", { onClick: goBack }, state.value.waiting ? "Waiting" : "Back")
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
