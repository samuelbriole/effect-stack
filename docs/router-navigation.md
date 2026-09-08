# Navigation, match snapshots, and renderer composition

Router coordinates URL interpretation and transition-scoped code/data loading. Application services supply remote data;
Router does not own remote-resource caching.

## Awaitable navigation

Renderer `useNavigate()` returns an awaitable operation. `useNavigateEffect()` exposes the same operation as an Effect
with the registered router's typed errors and the provider's registry already supplied:

```ts
const navigate = useNavigate()
await navigate({ to: "/projects/:id", params: { id: 42 } })

const navigateEffect = useNavigateEffect()
const saveAndNavigate = Effect.gen(function*() {
  yield* saveProject
  yield* navigateEffect({ to: "/projects/:id", params: { id: 42 } })
  yield* recordCompletedNavigation
})
```

Push, replace, and refresh complete after their own transition finishes loading and publishes its terminal state. A
superseding navigation interrupts the previous operation; its caller does not accidentally await the newer navigation.
Interrupting an Effect caller, or aborting the awaitable bridge with an `AbortSignal`, cancels that caller's transition and
waits for scoped cleanup. Typed failures remain in Effect's error channel; defects and interruption remain in `Cause`.

Headless applications use `core.execute(command)` and supply `AtomRegistry.AtomRegistry`. The existing `core.navigate`
command atom remains available for Atom-driven event handlers. Back, forward, and go commands request history traversal;
their completion acknowledges that request, not a future browser `popstate`. History events enter the same transition
engine when they arrive. Out-of-range history traversal may emit no event.

The command atom also observes operations started through `execute`. Writing `Atom.Reset` resets its observed result to
Initial; the next operation updates it again. A headless operation keeps its engine mounted until completion or interrupted
cleanup, even without a separate state subscription.

`Atom.Interrupt` cancels an operation submitted through the command atom. Operations started through `execute` or
`useNavigateEffect` use their caller's Effect interruption; `useNavigate` accepts an `AbortSignal` for that purpose.

`Link` and declarative `Navigate` consume event-triggered operation failures because router state already exposes those
failures to route boundaries. Imperative callers receive the rejected Promise or typed Effect failure.

## Incoming inputs and retained data

The public branch contains explicitly separate snapshots:

- `location` and `transitionId` identify the incoming navigation.
- Each entry's `incoming` is a decoded URL match or a URL decoding failure. Decoded params/search are available before
  loaders finish, including in pending views.
- Each entry's loading `result` and `retained` resolved value keep data associated with the inputs and location that
  produced it. Incoming params are never silently attached to old loader data.
- `lastSuccess` is the last complete successful branch. Partial ancestor completion does not replace it.
- The branch `result` represents initialization, waiting, and terminal navigation outcomes, including runtime failures and
  interruption.

Entries form a typed union. Discriminate by the top-level `routeId` to recover that route's params, module, loader data,
and failures. An inactive route is represented by `Option.none()` in its stable `routeAtoms(route)` projections.

Each ordinary route view renders its own consistent resolved snapshot while refreshing. Pending/error views can describe the incoming
decoded inputs. React exposes values, Solid exposes accessors, and Vue exposes computed refs; all use the same underlying
match projections.

## Recovery and subscriptions

A render error stays latched while Retry refreshes the route. It clears only after a successful completed transition
includes the boundary's route and descendants. This handles refreshed data on the same History key and avoids retrying
stale failing data midway through an asynchronous load. A loader failure or not-found outcome replaces the latched render
failure through the shared presentation policy.

Startup Retry uses `core.retry`, which rebuilds failed initialization rather than sending a refresh command to a failed
cached engine. Healthy runtime retries perform a normal refresh.

Per-route Atom definitions are stable. Unchanged entries keep their identity during unrelated match settlement, and
selector subscriptions observe their selected inputs rather than every branch publication. Native renderer ownership and
error capture stay in the adapters; fallback precedence, nearest-boundary selection, and declarative destination comparison
live in `RenderPolicy`.

Declarative navigation includes history state in change detection. Supply immutable state values: Effect's structural
equality recognizes equivalent newly allocated values, and changed values trigger navigation even when the URL is the
same. Already-satisfied destinations do not create duplicate pushes when a pending fallback remounts a layout.
