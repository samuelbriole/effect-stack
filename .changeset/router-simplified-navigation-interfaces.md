---
"@effect-stack/router": minor
"@effect-stack/router-react": minor
"@effect-stack/router-solid": minor
"@effect-stack/router-vue": minor
---

Simplify the router's public interfaces following the architectural review. Compatibility-only surfaces are removed;
every consumer in this repository is migrated. See `docs/router-review-decisions.md` for audits, rationale, and
deferrals, and `docs/router-navigation.md` for the runtime contract.

- **Navigation: `execute` is the only command interface.** The writable `router.navigate` command atom is removed,
  together with the `Atom.Reset` and `Atom.Interrupt` control machinery. Replace
  `registry.set(router.navigate, command)` with `router.execute(command)` (supplying `AtomRegistry.AtomRegistry`);
  replace atom-level cancellation with Effect interruption of the caller (or `useNavigate`'s `AbortSignal`).
  `router.navigation` is the new read-only observation of the latest navigation operation, covering operations started
  through `execute` or the host history. Each claimed operation (transition, pre-acceptance rejection, or traversal)
  settles that projection once with its own full outcome — acceptance, typed failure, defect, or interruption — and
  only while its claim is current, so a stale traversal or an older transition can never overwrite a newer result.
  Invocation-specific completion and finalization, `Back`/`Forward`/`Go`
  history-acceptance semantics, branch snapshots, and `retry` initialization recovery are preserved. Renderer
  providers now mount `core.navigation` to retain their scoped runtime, and the Vue outlet reset dispatches
  `execute(Router.refresh)`.
- **Navigation success values honor their declared `void` contract.** A settled transition previously cast its
  resolved-route `AsyncResult` into the operation projection, so success values (and failure-retained previous
  successes) leaked the resolved route object. Both `branch.result` and `router.navigation` now carry a true
  `AsyncResult<void, ...>`; resolved data stays in `matches` and `lastSuccess`.
- **Canonical routing for flat routers.** `Router.make` plans through the same static-before-dynamic planner as
  `Router.fromTree`; the declaration-order first-match matcher is removed. Flat routers now rank static segments ahead
  of dynamic ones regardless of declaration order (equal-ranking routes keep declaration order), malformed
  percent-encoding no longer matches a static candidate (the navigation settles as `RouteNotFound` instead of a
  terminal `RouteDecodeError`), and not-found branches retain the covering route entry like the tree model.
- **`lazy` is the only code-loading name.** The `load` compatibility alias is removed from `Route.make`, the
  route-tree builders, and all three adapters, and the route's stored field is `lazy` (was normalized to `load`).
  Rename the route option and any direct `route.load` reads to `lazy`. `RouteTree.CheckedLazyModule` guards the `lazy`
  key only.
- **Reduced compilation surface.** The standalone `RouteTree.plan` and `RouteTree.target` flattened-array entry points
  are removed; use `RouteTree.compile(tree).plan`/`.target`. `RouteTree.Compiled` exposes only `routes`, `plan`, and
  `target`; ranking, ancestry, and endpoint indexes stay private (`compiled.routes.find(...)` replaces the removed
  `byId`, `compiled.target` replaces `endpoints`). `RouteTree.flatten` remains for deliberate introspection.
