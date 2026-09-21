# Navigation contracts

Shared behavior for the headless Router and its React, Solid, and Vue adapters.
See [adoption](adoption.md) for setup and [migration](router-migration.md) for breaking changes.

## Commands and completion

Headless code runs `router.execute(command)` with `AtomRegistry.AtomRegistry` supplied. Renderer hooks bind the provider's
registry: `useNavigate()` returns a Promise, and `useNavigateEffect()` returns an Effect with the router's typed errors.

| Command                      | Completion                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `push`, `replace`, `refresh` | Its own transition has finished loading, published terminal state, and closed its scopes |
| `back`, `forward`, `go`      | The host has accepted traversal; a later history event starts a separate transition      |

Push/replace update history before loading. Ancestors resolve before descendants, so a branch can render progressively.
Out-of-range traversal may emit no history event.

Superseding navigation interrupts the previous transition. Interrupting its Effect caller, or passing an `AbortSignal`
to the Promise bridge, cancels that caller's transition and awaits cleanup. `execute` keeps the engine mounted for the
call, even without a state subscription. Custom history adapters should acknowledge `go` promptly: dispatch is currently
uninterruptible, so caller interruption waits for a blocked `go` to return.

Expected failures stay typed; defects and interruption remain in `Cause`. Imperative callers receive the failed Effect
or rejected Promise. `Link`, `Navigate`, and boundary resets consume event-handler failures; route failures render through
boundaries, while pre-transition failures remain observable through `navigation`.

## Loading and resource lifetime

- `lazy` imports route code; its result becomes `module`. `loader` prepares data; its result becomes `loaderData`.
- Loaders receive decoded `{ params, search, hash, location }`. The router Layer supplies their service requirements.
- Within each route, code and data load concurrently. A failure interrupts unfinished sibling work. Expected failures
  become `RouteLoadError` or `RouteLoaderError`, preserving the original error and route ID.
- Loader scopes close before resolution is published. Returned data must not depend on resources kept open by those scopes.
- Refresh and history navigation rerun loaders. Supersession and runtime disposal interrupt pending work; late results
  cannot overwrite newer state. Registry disposal also releases services and history listeners.

Remote caching, request deduplication, and resource eviction belong to Effect Atom or application services.

## Observations and snapshots

All Router Atoms are read-only observations:

| Projection          | Meaning                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `state`             | Leaf route's `AsyncResult`, including resolved inputs, module, and data                              |
| `navigation`        | Latest operation's `AsyncResult<void, ...>`, including pre-transition failures and history traversal |
| `branch`            | Incoming location, transition identity, per-route matches, branch result, and `lastSuccess`          |
| `completed`         | Last fully successful branch, or `Option.none()`                                                     |
| `routeAtoms(route)` | Stable projections for one route; `Option.none()` when inactive                                      |

`navigation` belongs to the newest operation claim. An older transition can finish its branch without overwriting a
newer rejection. If traversal starts a destination transition before acknowledgment, that destination owns the
projection; late traversal outcomes cannot replace it. Success values in `navigation` and `branch.result` are always
`undefined`, including retained previous successes.

The branch keeps inputs and data separate:

- `incoming`: decoded URL inputs or a decoding failure, available before loaders finish.
- `result` and `retained`: loading state and resolved data with the inputs and location that produced it.
- `lastSuccess` at branch level: the last complete successful branch; partial ancestor resolution does not replace it.

Discriminate match entries by `routeId` to recover route-specific types. Ordinary views retain consistent resolved data
while refreshing; pending/error views can read incoming decoded inputs. React exposes values, Solid accessors, and Vue
computed refs. Selectors observe selected values; unrelated match settlement preserves unchanged entry identity.

## Rendering and recovery

Pending/error/not-found boundaries replace their declaring route and descendants, preserving layouts above them.
A render error stays latched during Retry and clears only when a successful completed transition includes the relevant
route and descendants. Loader failures and not-found outcomes take precedence over latched render failures.

Startup Retry calls `router.retry` to rebuild failed initialization. Retrying a healthy runtime performs a refresh.

Declarative `Navigate` compares destination and history state. Use immutable state values: structurally equal values
avoid redundant navigation, while changed state can navigate at the same URL. Already-satisfied destinations do not
create duplicate pushes when pending boundaries remount a layout.
