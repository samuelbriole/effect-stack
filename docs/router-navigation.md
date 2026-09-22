# Navigation contracts

Shared behavior for the headless Router and its React, Solid, and Vue adapters.
See [adoption](adoption.md) for setup.

## Commands and completion

The contract's `service` key provides the runtime router:

```ts
const router = yield * Routes.service
const outcome = yield * router.navigate(Routes.project({ params: { projectId } }))
```

| Command                 | Completion                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `navigate`, `submit`    | The attempt reaches `Committed`, `Superseded`, or `Cancelled`; failures use the error channel |
| `refresh` / `retry`     | The observed URL is prepared again without adding history                                     |
| `back`, `forward`, `go` | The host accepted the traversal request; a later history event starts a separate attempt      |

`submit` returns an identity-specific handle with `await` and `cancel`. After acceptance the router owns the attempt:
interrupting the caller stops waiting but not the work, while `cancel` stops the attempt and publishes `Cancelled`.
Cancellation after publication is a no-op, and a stale cancel cannot affect a newer attempt.

Push/replace encode the destination, commit history, then accept the attempt. Pre-acceptance encoding or history failures
publish a rejected command status without cancelling previously accepted work and without letting an older attempt
overwrite that rejection. Browser/external changes are already committed locations and enter at the matching phase.

## Preparation and publication

- Ancestors prepare before descendants, and a fully resolved branch is published atomically.
- Group preparations run before child preparations; group data is a typed value, not implicit provision to children.
- The handler lifecycle scope closes before data becomes the resolved presentation. Returned data must not depend on a
  released handler-owned resource.
- Redirects are typed control failures consumed by the coordinator: the same attempt continues, intermediate history
  entries are replaced, hop count is bounded, and the final destination is reported on commitment.
- Expected domain failures are published against their owning node. Defects and finalizer failures stay in `Cause`. A
  defective handler settles pending state and notifies its waiter instead of killing the coordinator.

## Observations and snapshots

The service exposes a read-only snapshot and change stream; `AtomRouter.make(runtime, Routes)` exposes the same state as
read-only atoms and typed per-node projections.

| Projection    | Meaning                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `state`       | Snapshot: location, command status, presentation, and last resolved branch |
| `location`    | The observed location                                                      |
| `status`      | The latest command status, including pre-acceptance rejection              |
| `branch`      | The active branch's nodes, ancestors first                                 |
| `route(node)` | Typed inputs and prepared data for one node, `None` when inactive          |

A presentation entry keeps its decoded inputs, its `AsyncResult` data, and a retained pair (original inputs plus data)
so renderers can keep showing a coherent previous branch while a new attempt is pending. Route data hooks read the
presentation snapshot rather than combining observed-location inputs with retained data.

## Rendering and recovery

`RouterProvider` receives the contract, an application `AtomRuntime`, and nested view records mirroring the contract's
grouping. `Outlet` renders the branch; layout components render an `Outlet` to continue it. Pending, error, and not-found
boundaries replace their declaring node and descendants while preserving layouts above them. Startup failure is
distinguished from route failure; route retry reruns navigation and never rebuilds the application runtime.

`Link` renders a real anchor with a typed destination and preserves native modifier keys, alternate targets, and
downloads. Hooks return native values: React values, Solid accessors, and Vue computed refs.
