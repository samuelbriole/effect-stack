# @effect-stack/query

Effect-native remote resources shared by Effect programs, Router loaders, Streams, and Atom. One scoped client owns the
cache and its work; first-party React, Solid, and Vue adapters connect it to renderer lifecycles through Effect Atom.

## Install

```sh
pnpm add @effect-stack/query effect@rc
```

This package targets Effect v4 RC. Use matching versions of Effect and its Atom renderer bindings.

## Define a query

A definition describes how to load a resource. Input, success, failure, and service requirements are inferred from its
Effect. Validate remote data in your service or transport client with Schema.

```ts
import { Query, QueryClient } from "@effect-stack/query"
import { Context, Effect, Layer } from "effect"

interface User {
  readonly id: string
  readonly name: string
}

class UsersApi extends Context.Service<UsersApi, {
  readonly get: (id: string) => Effect.Effect<User>
}>()("app/UsersApi") {}

const userQuery = Query.make({
  name: "users.detail",
  load: Effect.fn("users.detail")(function*(id: string) {
    const api = yield* UsersApi
    return yield* api.get(id)
  }),
  staleTime: "30 seconds",
  gcTime: "5 minutes"
})

const UsersApiLive = Layer.succeed(UsersApi, {
  get: (id) => Effect.succeed({ id, name: "Ada" })
})

const program = Effect.scoped(Effect.gen(function*() {
  const client = yield* QueryClient.make({ layer: UsersApiLive })
  const users = client.query(userQuery)

  return yield* users("ada").get
}))
```

`QueryClient.make` builds the supplied Layer once. Its initialization failures belong to client construction; successfully
bound queries retain their own error types. `QueryClient.makeWith(context)` borrows services that your application has
already built. Those services must outlive the client.

## Resource operations

`client.query(definition)` returns a callable family. Calling the family is pure: it constructs a resource handle without
starting a request.

| Operation             | Contract                                                                             |
| --------------------- | ------------------------------------------------------------------------------------ |
| `resource.get`        | Return fresh data, or start/join a request and await its result.                     |
| `resource.refresh`    | Ignore freshness; start/join an appropriate request.                                 |
| `resource.invalidate` | Mark stale and schedule active revalidation.                                         |
| `family.invalidate`   | Invalidate all cached resources belonging to this definition.                        |
| `resource.snapshot`   | Sample `AsyncResult` without initiating a request or retaining observation interest. |
| `resource.changes`    | Observe `AsyncResult` through a scoped Stream; start loading when needed.            |

Query failures are values in the observation Stream, preserving their `Cause` and previous successful data. They do not
terminate observation. Imperative reads fail with the loader's typed errors.

### Identity and freshness

Resources are identified by the client, the query definition, and immutable input using Effect's structural equality.
Equal record/array inputs share a resource. Distinct definitions stay independent even when they have the same `name`;
names are diagnostic labels. Define reusable queries outside component render functions.

Every input affecting a response must be represented in that resource's input or the client's fixed service context.
Authentication or tenant changes require an appropriately isolated client lifetime or explicit resource identity.

- `staleTime` defaults to zero. Freshness expires independently of retention.
- `gcTime` defaults to five minutes, measured from the last consumer's departure.
- Observers see retained data while stale resources revalidate.
- Time passing alone does not initiate a request.
- Invalidation persists for inactive entries until they are acquired again.
- Keeping a resource handle in JavaScript does not keep its cached data alive.

### Shared work and cancellation

Effect readers and observers of a resource share one request. Interrupting one reader removes only its interest. When the
last interest disappears, unfinished read work is interrupted and its preceding settled state is retained until GC.

Each request has its own scope. Its finalizers run before the result is published; cached results should be reusable values
whose lifetime does not depend on that completed request scope.

Invalidation during a request advances the required generation. Existing callers can receive that request's result, but it
cannot clear the newer invalidation. Later callers await a request covering the newer generation. Active interests cause a
coalesced follow-up request.

## Atom and renderers

For renderer lifecycle management, typed application context, optional/dependent queries, and awaited mutation actions,
use a first-party adapter:

- [`@effect-stack/query-react`](../query-react)
- [`@effect-stack/query-solid`](../query-solid)
- [`@effect-stack/query-vue`](../query-vue)

Each adapter consumes already-bound resources and mutation handles. The application supplies its scoped client and can
share an existing Atom registry with Router. React's adapter activates queries after commit, so abandoned renders do not
start remote work.

For direct Atom integration, the core also exposes stable read-only views:

```ts
import { QueryAtom } from "@effect-stack/query"

const userAtom = QueryAtom.query(users("ada"))
```

The Atom is a stable, read-only view over the existing client. Use the official renderer bindings:

```tsx
// React
const result = useAtomValue(userAtom)

// Solid: the result is an accessor.
const result = useAtomValue(() => userAtom)

// Vue: the result is a Ref.
const result = useAtomValue(() => userAtom)
```

Import `useAtomValue` from `@effect/atom-react`, `@effect/atom-solid`, or `@effect/atom-vue`, respectively. Mount their registry
provider at the application root. The full examples demonstrate the first-party adapters:

- [React](examples/react)
- [Solid](examples/solid)
- [Vue](examples/vue)
- [Shared application](examples/shared)

Different registries can observe the same client and share its cache. Atom teardown releases observation interest; Query
owns inactive retention. Query state is native `AsyncResult`, including initial, waiting, success, and failure with previous
success.

## Mutations

Bind an observable controller, composing post-success invalidation as an ordinary Effect:

```ts
import { Mutation, QueryAtom } from "@effect-stack/query"

const rename = yield* client.mutation(Mutation.make({
  name: "users.rename",
  execute: Effect.fn("users.rename")(function*(input: RenameInput) {
    const api = yield* UsersApi
    const updated = yield* api.rename(input)
    yield* users(input.id).invalidate
    return updated
  })
}))

const stateAtom = QueryAtom.mutation(rename)
const updated = yield* rename.execute(input)
```

Here `RenameInput` and `UsersApi.rename` belong to the application. Each binding creates an independent controller, so two
editors can have separate mutation state while updating shared queries.

For explicit invocation control:

```ts
const invocation = yield * rename.start(input)
const updated = yield * invocation.await
// Explicit cancellation, including finalization:
yield * invocation.interrupt
```

- Invocations execute concurrently and each waiter receives its own outcome.
- `state.latest` is an `Option` containing the most recently **started** invocation's ID, input, and `AsyncResult`.
- `state.pendingCount` counts all unfinished invocations. An older completion cannot replace the latest invocation's result.
- Once accepted, a mutation belongs to the client. Interrupting its waiter or unmounting its observer does not cancel it.
- Explicit invocation interruption and client shutdown interrupt unfinished mutations and await their finalizers.
- Success is reported after the composed invalidation commits. Query revalidation can continue afterward; its failures
  belong to query state.

Interruption of a client-side write does not determine whether the remote server committed it. Mutation state preserves
interruption through `Cause`.

## Retry with Schedule

Compose retry inside the loader so deduplicated consumers share one retry sequence:

```ts
import { Schedule } from "effect"

const retryPolicy = Schedule.max([
  Schedule.exponential("100 millis"),
  Schedule.recurs(2)
])

const userQuery = Query.make({
  name: "users.detail",
  load: Effect.fn("users.detail")(function*(id: string) {
    const api = yield* UsersApi
    return yield* api.get(id).pipe(Effect.retry(retryPolicy))
  })
})
```

This permits two retries after the initial attempt. Schedule errors and service requirements remain part of the inferred
loader type. Defects and interruption are not retried. Mutation retry is also explicit: place it around the intended remote
operation before post-success invalidation, and use it when retrying that operation is appropriate.

## Application ownership and Router

Keep the client scope open for the application's lifetime. A client returned from an already-completed `Effect.scoped` is
closed and cannot serve a renderer.

Build shared services once, acquire Query with `makeWith`, and pass the bound resource's Effect to a Router loader:

```ts
loader: ;
;(({ params }) => users(params.id).get)
```

Router can use `Layer.succeedContext(services)` to borrow the same already-built application services. Independently
building the same Layer in separate runtimes does not establish that their resources are shared.

Teardown order is: unmount the renderer, dispose its registry, then close and await the application/client scope before
releasing borrowed services. Registry disposal initiates subscription cleanup synchronously; client scope closure is the
barrier that waits for asynchronous request and mutation finalizers. Operations on a closed client interrupt.

## Modules

Both namespace imports and module subpaths are supported:

```ts
import { Mutation, Query, QueryAtom, QueryClient } from "@effect-stack/query"
import * as Query from "@effect-stack/query/Query"
```
