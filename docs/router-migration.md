# Router migration: 0.2 to 0.3

These breaking changes apply to the core and all three renderer adapters. They implement the
[Router review](https://github.com/samuelbriole/effect-stack/issues/11). For current behavior, see
[navigation contracts](router-navigation.md).

## Navigation

Replace writes to `router.navigate` with `router.execute(command)`:

```ts
import { Effect } from "effect"
import { AtomRegistry } from "effect/unstable/reactivity"

// Given your router, command, and application registry:
await Effect.runPromise(
  router.execute(command).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry))
)
```

- Read `router.navigation` instead of `router.navigate`; custom adapters mount `core.navigation`.
- Replace `Atom.Interrupt` writes with caller interruption or `useNavigate`'s `AbortSignal`.
- `Atom.Reset` has no replacement. The projection always follows the latest operation.
- Success values in `navigation` and `branch.result` are now actually `undefined`, including retained previous successes.
  Read resolved data from `state` or branch matches.

Push/replace/refresh still await their own transition and cleanup. History traversal still completes on host acceptance.

## Code loading

Rename the `load` option and `route.load` field to `lazy` across core and adapter route definitions.
`loader` still prepares data; resolved lazy modules still appear as `module`.
`Route.Route.LoadError`, `Route.Route.LoadServices`, and `Router.RouteLoadError` retain their names.

## Flat matching

`Router.make` now shares the tree planner:

- Static segments outrank dynamic ones: `/users/new` wins over `/users/:id` regardless of declaration order.
  Equal-ranking flat patterns keep declaration order.
- Malformed percent-encoding cannot match a static segment. Handle `RouteNotFound` when no route matches;
  malformed dynamic parameters and Schema failures still produce `RouteDecodeError`.
- A not-found branch retains a covering route: `/users/123` with only `/users` configured retains that match while
  the leaf reports not-found. An uncovered URL has no matches.

Duplicate IDs and exact duplicate path templates remain invalid. Use a tree when you need ancestor layouts.

## Compilation API

Create `const compiled = RouteTree.compile(tree)` and replace removed APIs as follows:

| Removed                                 | Replacement                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `RouteTree.plan(routes, location)`      | `compiled.plan(location)`                                                                          |
| `RouteTree.target(routes, destination)` | `compiled.target(destination)`                                                                     |
| `compiled.byId.get(id)?.route`          | `compiled.routes.find((route) => route.id === id)`                                                 |
| `compiled.endpoints.get(template)`      | `compiled.target({ to: template })` returns `{ route, input }` and throws for unknown destinations |
| `compiled.ranked`, `RouteTree.Ranked`   | Internal details; use planning behavior rather than ranking indexes                                |

`RouteTree.flatten` remains available for tooling. ID lookup via `find` is linear; it returns a route, not an index entry.

## Design rationale

The in-repository audit at `138a75e` found no external-to-Router consumers of the removed compilation indexes; it did
not establish downstream usage. Breaking changes are released together in a 0.x minor version.

One command interface removes writable-Atom reset/submission rules. Shared planning removes two matching implementations.
React and Solid share `RouteTree.CheckedLazyModule`; Vue retains stricter component checks. Constructor overloads stay
local to preserve inference and renderer-specific hooks.
