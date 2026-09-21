---
"@effect-stack/router": minor
"@effect-stack/router-react": minor
"@effect-stack/router-solid": minor
"@effect-stack/router-vue": minor
---

Simplify Router's public API and fix navigation result values. Breaking changes:

- Replace writable `router.navigate` with `router.execute(command)`, supplying `AtomRegistry.AtomRegistry`.
  Observe `router.navigation`; cancel through Effect interruption or `useNavigate`'s `AbortSignal`. `Atom.Reset` is removed.
- Navigation and branch successes, including retained previous successes, now contain `undefined` as declared.
  Resolved data remains in route snapshots. Older operations cannot overwrite newer navigation outcomes.
- Flat routes now rank static segments ahead of dynamic ones; equal-ranking patterns keep declaration order.
  Malformed static segments no longer match, dynamic decoding failures remain typed, and not-found branches retain
  covering matches.
- Rename the code-loading option and stored route field from `load` to `lazy`. `loader` still prepares data.
- Use `RouteTree.compile(tree).plan` and `.target` instead of standalone `RouteTree.plan` and `.target`.
  Compiled values expose only `routes`, `plan`, and `target`; use `routes.find` for ID lookup. `flatten` remains available.

See the [migration guide](https://github.com/samuelbriole/effect-stack/blob/main/docs/router-migration.md) for replacements
and behavior changes. Invocation-specific cleanup, history-acceptance completion, and initialization retry are preserved.
