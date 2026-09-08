# `@effect-stack/query-react`

First-party React bindings for [`@effect-stack/query`](../query/README.md): commit-time query subscriptions, optional resource
selection, typed application context, and invocation-specific mutation actions.

## Install

```sh
pnpm add @effect-stack/query-react @effect-stack/query @effect/atom-react@rc effect@rc react
```

Use matching Effect v4 RC and Atom adapter versions.

## Provide your application

Acquire the Query client and mutation handles in your application's live Effect scope. Pass the resulting typed bundle to
a context created once at module scope. In these snippets, `MyApp` is your application type with a bound `users` family and
an acquired `rename` handle.

```tsx
import { createQueryContext, useQuery } from "@effect-stack/query-react"
import type { MyApp } from "./app"

const QueryApp = createQueryContext<MyApp>()

function Root({ app }: { readonly app: MyApp }) {
  return (
    <QueryApp.Provider value={app}>
      <Screen />
    </QueryApp.Provider>
  )
}

function Screen() {
  const app = QueryApp.useQueryContext()
  const result = useQuery(app.users("ada"))
  return <p>{result._tag === "Success" ? result.value.name : result.waiting ? "Loading…" : result._tag}</p>
}
```

The Provider borrows the application value. It does not construct or close the client. `useQueryContext` returns exactly
the type accepted by its matching Provider and throws an actionable error outside that Provider.

### Registry ownership

| `registry` prop      | Behavior                                                  |
| -------------------- | --------------------------------------------------------- |
| Omitted              | Own a native Atom registry with StrictMode-safe disposal. |
| An existing registry | Borrow that registry and leave its disposal to its owner. |
| `"inherit"`          | Reuse the surrounding native Atom registry.               |

For Router integration, pass the same application-owned registry to both providers:

```tsx
<QueryApp.Provider value={app} registry={app.registry}>
  <Screen />
</QueryApp.Provider>
```

Replacing the registry remounts its provider subtree. Replacing `value` propagates through normal React context updates.
Keep the client's scope alive until the components using it have unmounted, then close and await the application scope.

## Query subscriptions

`useQuery(resource)` returns native `AsyncResult<A, E>`. Bind definitions with `client.query` before passing their resources
to hooks; this checks service requirements once and preserves result/error inference.

Query interest activates only after React commits. Abandoned Suspense and transition renders cannot start requests or
redirect the committed subscription. StrictMode replay can release and reacquire interest, so request counts across replay
depend on whether another consumer keeps the request alive. The client remains the cache and execution owner.

Switching resources releases interest in the previous resource and observes the selected resource's own state. A failed
refresh retains that resource's native previous success and Cause; unrelated data is not carried across resource keys.

### Optional and dependent queries

Pass an `Option<Resource<A, E>>` to keep hooks unconditional:

```tsx
import { Option } from "effect"
import { useState } from "react"

function OptionalProfile() {
  const app = QueryApp.useQueryContext()
  const [selectedId, selectId] = useState(Option.none<string>())
  const result = useQuery(Option.map(selectedId, app.users))

  return (
    <div>
      <button onClick={() => selectId(Option.some("ada"))}>Observe Ada</button>
      <button onClick={() => selectId(Option.none())}>Disable</button>
      <p>{result._tag}</p>
    </div>
  )
}
```

`None` returns Initial state and holds no query interest. Re-enabling follows the core's freshness and inactive-retention
policy. Dependent queries can similarly map an upstream optional value into a bound resource.

## Mutations

`useMutation` observes a handle acquired by the application through `client.mutation`. Each returned action follows its own
invocation, independently of the controller's latest displayed result.

```tsx
import { useMutation } from "@effect-stack/query-react"
import { Cause, Exit } from "effect"
import { useState } from "react"

function RenameButton() {
  const app = QueryApp.useQueryContext()
  const rename = useMutation(app.rename)
  const [message, setMessage] = useState("")

  return (
    <div>
      <button
        onClick={async () => {
          const exit = await rename.executeExit({ id: "ada", name: "Grace" })
          setMessage(Exit.isSuccess(exit) ? `Saved ${exit.value.name}` : Cause.pretty(exit.cause))
        }}
      >
        Rename
      </button>
      <p>{rename.state.pendingCount} in flight</p>
      <p>{message}</p>
    </div>
  )
}
```

| Member                         | Result                                                                     |
| ------------------------------ | -------------------------------------------------------------------------- |
| `state`                        | Native `Mutation.State<I, A, E>`.                                          |
| `executeEffect(input)`         | Environment-free `Effect<A, E>`.                                           |
| `startEffect(input)`           | Environment-free Effect returning an explicit invocation handle.           |
| `execute(input, options?)`     | `Promise<A>` using native Effect runner rejection semantics.               |
| `executeExit(input, options?)` | `Promise<Exit<A, E>>`, preserving typed errors, defects, and interruption. |

Both Promise methods accept `{ signal?: AbortSignal }`. Aborting the waiter or unmounting the component does not cancel an
accepted, client-owned mutation. Explicit cancellation uses the `invocation.interrupt` Effect returned by `startEffect` and
awaits its finalizers. Promise rejection does not have a typed error channel; use `executeExit` or the Effect methods when
handling typed failures.

Compose successful-write invalidation inside the mutation definition, so it remains part of the accepted invocation even
when its UI waiter goes away. Separate editors can use separately acquired handles over the same client cache.

See the [complete React example](../query/examples/react) and its [shared scoped application](../query/examples/shared).
