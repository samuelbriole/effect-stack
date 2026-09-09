# Router review decisions

Record of the consumer audits, accepted breaking changes, migration recipes, and deliberate deferrals from the
[router architectural review](https://github.com/samuelbriole/effect-stack/issues/11). Reviewed commit: `138a75e`.
Per the maintainer's direction, compatibility-only surfaces are removed rather than preserved: the package is 0.x and
every consumer in this repository is migrated in the same release. See
[navigation and match snapshots](router-navigation.md) for the runtime contract these decisions operate within.

## Navigation interface: one command operation plus read-only observation

`Router.execute(command)` (headless) and the adapters' `useNavigate`/`useNavigateEffect` are the only navigation command
interfaces: each follows its own invocation, joins its own transition fiber, and propagates typed failures and
interruption to the caller. Observing navigation stays in Atoms: `branch`, `state`, `completed`, `routeAtoms`, and the
new read-only `navigation` projection of `Snapshot.operation`.

### Removed: the writable `navigate` command atom

The previously documented compatibility atom (`Atom.AtomResultFn<Command, void, ...>`) is removed, together with the
`Atom.Reset` and `Atom.Interrupt` control machinery it required (submission atom, reset boundary, operation epoch, and
the rules that hid the settlement of reset operations). Reasons:

- Every dispatch path now has a caller: `execute`, the renderer hooks, the adapters' `Link`/`Navigate`, and boundary
  resets. No in-repo consumer needs to dispatch without a caller fiber.
- Cancellation is invocation-specific through `execute` (interrupting the caller interrupts exactly the transition it
  started and awaits its cleanup), which is strictly simpler than the atom's ownership split.
- The remaining projection, `router.navigation`, is read-only: it observes operations started through `execute` or the
  host history, waits while an operation is in flight, settles when that operation's transition finishes, and settles
  directly for failures raised before a transition is accepted. Its success value is always `undefined`.

Preserved unchanged: history acceptance semantics for `Back`/`Forward`/`Go` (they complete when the host accepts the
traversal), branch/location/lastSuccess snapshots, and `retry` rebuilding failed initialization. Operation ownership is
its own concept, separate from the branch's active transition token: every operation start, pre-claim rejection, and
traversal claim takes a strictly newer monotonic revision, and each claimed operation settles the projection exactly
once with its own full outcome — acceptance, a typed failure, a defect, or an interruption, all with the original
Cause. A traversal acknowledged after — or failing after — its own history change started a destination transition
therefore loses that settlement to the destination's newer claim: `navigation` keeps waiting for the destination (or
keeps the destination's outcome) instead of being stolen by the stale traversal. Likewise, an older in-flight
transition settling behind a newer rejection updates its branch without reviving the projection.

Migration:

- `registry.set(router.navigate, command)` → `yield* router.execute(command)` with `AtomRegistry.AtomRegistry`
  supplied (in event handlers, run it with your host's runner, as the adapters' `Link` does).
- Reading the atom's projection → `router.navigation` (identical `AsyncResult<void, ...>` values, minus reset).
- `Atom.Interrupt` / `Atom.Reset` writes → interrupt the caller's Effect (or the `AbortSignal` on `useNavigate`);
  reset semantics no longer exist, and the projection always tracks the latest operation.
- Adapters mount `core.navigation` instead of `core.navigate` to retain the provider's scoped runtime.

## Canonical routing model: one planner for trees and flat routers

The static-before-dynamic planner is the single routing model. `Router.fromTree` plans through the compiled tree;
`Router.make` now plans flat route lists through the same planner (routes without tree metadata plan as ordinary
exact-match endpoints with no ancestors). The legacy declaration-order first-match matcher is removed.

### Accepted breaking changes for flat routers

- **Precedence.** A static segment outranks a dynamic one regardless of declaration order: with
  `["/users/:id", "/users/new"]`, `/users/new` now resolves the static route even though the dynamic route was declared
  first. Equal-ranking routes (for example `/items/:id` and `/items/:slug`) keep declaration order as the stable
  tie-break.
- **Malformed percent-encoding.** A malformed segment no longer matches a static candidate: the URL settles as
  `RouteNotFound` instead of a terminal `RouteDecodeError` on the first structurally scanned route. Malformed encoding
  in a _dynamic_ position still belongs to the matched route: its own decoder reports the typed `RouteDecodeError`.
  Values that decode but fail the parameter Schema remain `RouteDecodeError`.
- **Not-found branches.** A flat not-found URL retains the covering route entry in `branch.matches`, mirroring the tree
  model: `/users/123` with only a `/users` route publishes that entry while the leaf settles as `RouteNotFound`. A URL
  no route covers publishes an empty branch.
- Duplicate route IDs and exact duplicate path templates remain rejected with `RouterConfigurationError`.

Migration: if you relied on first-match declaration order, make the winner's static segments specific (they now
outrank dynamic ones automatically) or reorder equal-ranking routes explicitly. If you rendered a typed decode failure
for malformed URLs, handle `RouteNotFound` for unmatched static segments; dynamic-segment decode failures are unchanged.

## Reduced compilation surface

- `Compiled` exposes only `routes`, `plan`, and `target`. `ranked`, `byId`, `endpoints`, and the `Ranked` type remain
  private.
- The standalone `RouteTree.plan` and `RouteTree.target` flattened-array entry points — kept only for legacy callers —
  are removed. The canonical planner moved to an internal module shared by `RouteTree.compile` and flat `Router.make`,
  so there is exactly one matching implementation.
- `RouteTree.flatten` stays: it is substantive introspection (validated preorder route list) and the documented seam
  for advanced tooling.

### Consumer audit evidence

The audit at `138a75e` (`git grep` over `packages/**/*.ts{,x}`) found readers of the reduced members only inside the
router packages themselves; all were migrated. Readers today: `compiled.plan` (core flat/tree planning),
`compiled.routes` (`Router.fromTree`), `compiled.target` (all three adapters' destination and href resolution). The
standalone `RouteTree.plan`/`target` had no consumer beyond equivalence tests, which now exercise `compiled` directly.
This proves in-repo usage only; the removal is confirmed against this repository, and the 0.x minor release records the
breaking detail in the changelog.

### Migration

- Ancestor/id lookup (was `compiled.byId.get(id)?.route`): `compiled.routes.find((route) => route.id === id)`. Linear
  rather than indexed, and it returns the route, not precomputed segments or depth.
- Endpoint resolution (was `RouteTree.target(routes, destination)` or `compiled.endpoints.get(template)`):
  `RouteTree.compile(tree).target({ to: template })`, which selects the same ranked endpoint and fills omitted empty
  inputs. It throws for unknown destinations; probe with `routes.some((route) => route.path === template)` if you need
  a total lookup.
- Ranking introspection (was `compiled.ranked`) or array planning (was `RouteTree.plan(routes, location)`): observe
  behavior through `compiled.plan(location)`; the internal ranking order remains an implementation detail.

## Code loading: `lazy` is the only name

`lazy` is the sole option and stored field name for route code loading: `Route.make`, the route-tree builders,
`RouteTree.Loading`, `RouteTree.CheckedLazyModule`, and all three adapters use it, and the compiled route value exposes
the loader as `route.lazy`. The `load` option alias and its "both supplied" definition error are removed, and the
`Route` interface's stored field no longer carries the old `load` name, so code loading and data loading differ by more
than one letter and by name, not just by spelling. Resolved matches still expose the imported value as `module`.

Migration: rename the route option and any direct `route.load` reads to `lazy`. The type helpers
(`Route.Route.LoadError`, `Route.Route.LoadServices`, `Router.RouteLoadError`) keep their names; they describe the
lazy loader's error and service channels.

## Adapter construction: shared guard, local overloads

- Shared into core: `RouteTree.CheckedLazyModule<M, View>`, the distributed conditional that rejects `lazy` when a
  module's present `default`/`component` export is not the renderer's view type. React and Solid consume it directly.
  The Vue adapter keeps its stricter local variant because Vue option objects and arrays match `Component`
  structurally; that semantic is Vue-specific and was not pushed into core.
- Deferred: a generic cross-adapter `createRoute` factory. Each adapter's overloads encode renderer-specific result
  types (`ReactRoute` value hooks, `SolidRoute` accessor hooks, `VueRoute` computed refs) and exclusive path/id/index
  shapes. Parameterizing the factory over view component type, hook wrapper shape, and decoration type would move
  renderer vocabulary into core or produce a generic signature with worse inference and error messages than the
  duplicated overloads. The review explicitly allows this tradeoff; per-renderer component validation, error capture,
  and subscription lifecycles stay local.

## Out of scope

Per the review: no engine rewrite, no SSR/hydration work, and no long-lived route-instance scopes.
