# @effect-stack/query-vue

First-party Vue bindings for EffectStack Query. Observe remote resources as native `AsyncResult` refs, run mutations with
Promise and Effect bridges, and share a typed application object through a scoped provider.

The adapter never constructs or owns a `QueryClient`: your application builds the scoped client in its own Effect and
hands the bound resources and handles to components through the context.

## Install

```sh
pnpm add @effect-stack/query-vue @effect-stack/query @effect/atom-vue@rc effect@rc vue
```

Use matching Effect v4 RC and Atom adapter versions.

## Application context

`createQueryContext<App>()` creates one isolated typed context. The Provider receives the `App` value and selects the
Atom registry; `useQueryContext()` reads the value back as a readonly ref:

```ts
// app-context.ts
import { createQueryContext } from "@effect-stack/query-vue"
import type { QueryExampleApp } from "./app.ts"

export const { Provider, useQueryContext } = createQueryContext<QueryExampleApp>()
```

```vue
<!-- App.vue -->
<script setup lang="ts">
import { Provider } from "./app-context.ts"
import type { QueryExampleApp } from "./app.ts"
import UserList from "./UserList.vue"

defineProps<{ readonly app: QueryExampleApp }>()
</script>

<template>
  <Provider :value="app" :registry="app.registry">
    <UserList />
  </Provider>
</template>
```

```vue
<!-- UserList.vue -->
<script setup lang="ts">
import { useQuery } from "@effect-stack/query-vue"
import { useQueryContext } from "./app-context.ts"

const app = useQueryContext()
const users = useQuery(() => app.value.resources.userList)
// `users` is Readonly<Ref<AsyncResult<Users, ApiError>>>
</script>

<template>
  <!-- templates auto-unwrap the ref: `users` is the AsyncResult itself -->
  <ul v-if="users._tag === 'Success'">
    <li v-for="user in users.value" :key="user.id">{{ user.name }}</li>
  </ul>
</template>
```

`useQueryContext()` returns `Readonly<Ref<App>>` — Vue-native honest reactivity. Replacing the Provider's `value` prop
publishes the new object to every consumer through the ref without remounting anything, so components keep mounted state
and query leases. Read it as `app.value` in render functions and watch sources; unwrap once in setup with
`const app = appRef.value` only when the value is fixed. Reading outside the provider throws with an actionable error.

Calling the hook in `setup` is required, like every Vue composable.

## Registry ownership

The `registry` prop selects which `AtomRegistry` observes the queries in the subtree. Atom bindings own observation
leases, so the registry choice decides when interests release:

| Prop                   | Behaviour                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| _(omitted)_            | The Provider owns a fresh registry and disposes it with its component scope — with the subtree. |
| `registry: myRegistry` | The registry is borrowed and never disposed here; the caller keeps ownership.                   |
| `registry: "inherit"`  | Joins the ambient `@effect/atom-vue` registry, falling back to the native module default.       |

Replacing the registry remounts the keyed provider subtree, so every atom resubscribes through the new registry and
leases on the old one release in order. Replacing the `App` value does not remount. Several contexts can coexist in one
tree; each factory keeps its own injection identity.

## Queries

`useQuery` observes one bound resource — the same `Resource` a route loader or Effect calls:

```ts
import { useQuery } from "@effect-stack/query-vue"

const result = useQuery(() => app.value.resources.userList)
const detail = useQuery(() => app.value.resources.userDetail(id.value))
```

Keep dependent queries unconditional by selecting an optional bound resource:

```ts
import { Option } from "effect"
import { shallowRef } from "vue"
import type { UserId } from "./app.ts"

const selectedId = shallowRef(Option.none<UserId>())
const maybe = useQuery(() => Option.map(selectedId.value, app.value.resources.userDetail))
```

- The returned ref carries the authoritative `AsyncResult`: `Initial`, `Success`, or `Failure`, including `waiting`
  refresh states. Templates unwrap the ref automatically.
- A `None` resource publishes `AsyncResult.initial()` and holds no lease.
- When the selected resource changes, the previous interest releases on the next reactive flush and the new resource
  republishes from its own state — never the unrelated previous data. A late completion of an abandoned load cannot
  reach the ref.
- Plain values, refs, getters, and `Option` wrappers are all accepted. Values arriving through deep `ref()` or
  `reactive()` proxies are unwrapped to the original resource, so every view of one resource shares one atom and one
  interest.
- Mounted readers share one deduplicated load; losing one interest releases it and losing the last interrupts it.
  Data retention and refetch policy stay in the client.

## Mutations

`useMutation` observes a pre-acquired controller handle and exposes its explicit methods. Acquire handles in the
application Effect (`client.mutation(definition)`); the hook never builds controllers or runs Effects inside reactive
code, and it unwraps proxy-wrapped handles the same way `useQuery` unwraps resources:

```ts
import { useMutation } from "@effect-stack/query-vue"
import { Effect, Exit } from "effect"

const rename = useMutation(() => app.value.mutations.renameUser)

rename.state.value // Mutation.State: latest invocation + pendingCount
const exit = await rename.executeExit(input, { signal: controller.signal })
if (Exit.isSuccess(exit)) {
  // Render exit.value; failures retain their typed Cause in exit.cause.
}
const invocation = await Effect.runPromise(rename.startEffect(input)) // client-owned write
```

- `state` is a readonly ref over the aggregate controller state: `latest` is the most recently **started** invocation
  regardless of completion order, and `pendingCount` counts every unfinished invocation of this controller.
- Each `execute`/`executeExit`/`executeEffect`/`startEffect` call selects the current handle at action time and its own
  invocation outcome; results never come from `state.latest`. Both Effect-returning methods capture the handle when
  called, before the returned Effect is run.
- `execute` returns `Promise<A>` with native Effect runner rejection semantics; Promise rejection has no typed error
  channel. `executeExit` returns `Promise<Exit<A, E>>`. The Effect methods retain typed failures and require no environment.
- `execute`/`executeExit` accept an optional `signal`, which aborts the waiter only. Accepted invocations are
  client-owned: they continue after waiter abort, observer loss, or unmount, and their invalidation effects still
  commit.
- Interrupt a specific write through its invocation: `await Effect.runPromise(invocation.interrupt)` completes after
  that invocation's finalizers.

## Lifecycle

Keep the client's scope outside the component tree: create it while booting the application Effect, provide the built
App through the Provider, and close it when the application shuts down. Unmounting releases observation leases only.
Registry disposal releases leases synchronously; closing the client scope awaits asynchronous cleanup before borrowed
services release. See the [Query guide](../query/README.md) for the full operation and lifetime contract and
[docs/architecture.md](../../docs/architecture.md) for the ownership boundaries.

## Type-safety notes

- `useQuery` and `useMutation` infer exact result, error, and mutation input types through refs and getters. `useQuery`
  additionally accepts `Option`-wrapped resources for disabled and dependent queries.
- Refs handed back are `Readonly`: assignment to `.value` is a compile error by design.
- Provider props are checked against the `App` type; only an `AtomRegistry` instance or the `"inherit"` literal are
  accepted for the registry slot.
