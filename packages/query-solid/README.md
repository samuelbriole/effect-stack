# @effect-stack/query-solid

First-party Solid bindings for [EffectStack Query](../query/README.md), built on the official
[`@effect/atom-solid`](https://effect.website/docs/effect-atom/) hooks. The headless core owns caching,
sharing, freshness, and mutation ownership; this package owns reactive observation and Promise bridges.

## Install

```sh
pnpm add @effect-stack/query-solid @effect-stack/query @effect/atom-solid@rc effect@rc solid-js
```

Use matching Effect v4 RC and Atom adapter versions.

## Application context

`createQueryContext<App>()` creates a provider and hook pair typed with your concrete application value —
the object that carries your scoped `QueryClient` and the resources and mutation handles acquired from it.

```tsx
import { createQueryContext, useQuery } from "@effect-stack/query-solid"
import { Option } from "effect"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { type JSX, Show } from "solid-js"
import type { App } from "./app"

const AppQuery = createQueryContext<App>()

function UserCard(props: { readonly id: number }): JSX.Element {
  const app = AppQuery.useQueryContext()
  const result = useQuery(() => Option.some(app().user(props.id)))
  const user = () => {
    const state = result()
    return AsyncResult.isSuccess(state) ? state.value : undefined
  }
  return (
    <Show when={user()} keyed>
      {(user) => <h1>{user.name}</h1>}
    </Show>
  )
}
```

Here `App` is your typed application bundle, acquired in a live Effect scope, with a bound `user` family and a pre-acquired
`renameUser` mutation handle. Define the context once at module scope.

Solid context is captured at setup, so `useQueryContext()` honestly returns a live `Accessor<App>` rather
than a snapshot. (React returns `App` directly, and Vue returns a readonly `Ref<App>`; each adapter follows
its framework's native reactive shape.) Replacing the Provider `value` updates mounted selectors and later
actions without remounting the subtree. Replacing the `registry`, by contrast, remounts the subtree keyed.

## Registry ownership

`Provider` binds Atom subscriptions through an explicit ownership choice:

| `registry` prop   | Owner             | On Provider unmount                      |
| ----------------- | ----------------- | ---------------------------------------- |
| omitted           | The Provider      | The created registry is disposed         |
| an `AtomRegistry` | You (borrowed)    | Nothing is disposed; leases release      |
| `"inherit"`       | An outer provider | The subtree follows the ambient registry |

The query client is always application-owned: it is built in your Effect scope and passed in through
`value`. The adapter never acquires or releases client lifecycle.

```tsx
// The application scope owns the client; Solid owns the default registry.
<AppQuery.Provider value={app}>
  <UsersView />
</AppQuery.Provider>

// Share one registry with other Atom consumers; the Provider borrows it.
<AppQuery.Provider value={app} registry={registry}>
  <UsersView />
</AppQuery.Provider>
```

## Solid store selections

Hooks accept selections made from a native `createStore` store. Solid's `Store<T>` type keeps the plain
member type, but reads through the store are reactive proxies; the core binds resources and handles by
object identity. The adapter therefore unwraps the selected resource (including the contents of a freshly
built `Some`) to the exact client-created object before binding, while source tracking stays reactive.

Note Solid's documented setter contract: assigning a plain object to a path merges it instead of
replacing it. To switch to another resource or handle wholesale, bulk-assign from the root
(`setStore({ users: grace })`) or store an `Option` selection so updates replace the selected value:

```tsx
import type { Query } from "@effect-stack/query"
import { createStore } from "solid-js/store"

const [store, setStore] = createStore<{ users: Query.Resource<User, ApiError> }>({ users: ada })
useQuery(() => store.users)
setStore({ users: grace }) // replaces identity and rebinds the subscription
```

## `useQuery`

`useQuery(resource)` accepts an accessor over a bound `Query.Resource` or an
`Option.Option<Query.Resource<A, E>>` and returns an accessor over the core's native `AsyncResult`,
with expected errors, defects, and interruption preserved in `Cause`.

- `Option.none()` is inert: the accessor reports `AsyncResult.initial()` and acquires no read interest.
- When the selected resource changes, the previous lease releases and the accessor reports the new
  resource's own state. Data never carries across resources, and superseded late completions cannot
  resurrect stale values.
- Two components observing one resource share one in-flight load, together with imperative `resource.get`
  reads. Unmounting all observers releases the lease; accepted work is interrupted per the core contract.

Keep dependent queries unconditional by deriving an optional resource from the available input:

```tsx
import { createSignal } from "solid-js"

const [selectedId, selectId] = createSignal(Option.none<number>())
const result = useQuery(() => Option.map(selectedId(), app().user))
selectId(Option.some(1))
selectId(Option.none())
```

## `useMutation`

Applications acquire mutation handles once through the scoped client (`yield* client.mutation(definition)`)
and pass them to the hook as an accessor:

```tsx
import { useMutation } from "@effect-stack/query-solid"
import { Cause, Exit } from "effect"
import { createSignal, type JSX } from "solid-js"

function RenameButton(props: { readonly id: number }): JSX.Element {
  const app = AppQuery.useQueryContext()
  const rename = useMutation(() => app().renameUser)
  const [message, setMessage] = createSignal("")
  const save = async () => {
    const exit = await rename.executeExit({ id: props.id, name: "Ada" })
    setMessage(Exit.isSuccess(exit) ? `Saved ${exit.value.name}` : Cause.pretty(exit.cause))
  }
  return (
    <>
      <button onClick={save}>Rename ({rename.state().pendingCount} in flight)</button>
      <p role="status">{message()}</p>
    </>
  )
}
```

The returned object exposes:

- `state` — a reactive accessor over the controller's `Mutation.State`: latest-started invocation plus the
  count of all pending work.
- `executeEffect(input)` / `startEffect(input)` — environment-free Effects for composing inside the
  application's Effect runtime. `startEffect` yields the client-owned `Invocation` handle (`await`,
  `interrupt`).
- `execute(input, options?)` / `executeExit(input, options?)` — Promise bridges over Effect's native
  runners. `options.signal` aborts the waiter only; accepted invocations survive and keep publishing state.

`execute` returns `Promise<A>` with native runner rejection semantics. `executeExit` returns `Promise<Exit<A, E>>`, retaining
typed failures, defects, and interruption. Use the latter or the Effect methods when handling typed failures. Compose
post-success invalidation inside the mutation definition, so it belongs to the accepted invocation.

Each action selects the current handle when it is called and captures it for that invocation; a later
handle switch never reroutes work already started. Reading state never owns invocation lifetime:
unmounting observers leaves accepted writes running in the client scope.

## Testing and examples

Runtime tests mount real Solid trees in `happy-dom`; type tests assert inference through TSTyche. See the
[Query examples](../query/examples/solid) for a mounted application.
