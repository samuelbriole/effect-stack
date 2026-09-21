# @effect-stack/router-vue

## 0.3.0

### Minor Changes

- [#15](https://github.com/samuelbriole/effect-stack/pull/15) [`1c1232e`](https://github.com/samuelbriole/effect-stack/commit/1c1232ef781afa73b1d88f4996fe10da558925e6) Thanks [@samuelbriole](https://github.com/samuelbriole)! - Raise the minimum Effect and Effect atom peer versions to 4.0.0-rc.116. The React adapter now requires React 19.3.0 or newer, and the Vue adapter requires Vue 3.5.43 or newer within their existing major versions.

- [#12](https://github.com/samuelbriole/effect-stack/pull/12) [`4de4cd9`](https://github.com/samuelbriole/effect-stack/commit/4de4cd954f9ada1019b2dbda8eda6545f8c3ac47) Thanks [@samuelbriole](https://github.com/samuelbriole)! - Simplify Router's public API and fix navigation result values. Breaking changes:
  
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
  
  Invocation-specific cleanup, history-acceptance completion, and initialization retry are preserved.

### Patch Changes

- Updated dependencies [[`1c1232e`](https://github.com/samuelbriole/effect-stack/commit/1c1232ef781afa73b1d88f4996fe10da558925e6), [`4de4cd9`](https://github.com/samuelbriole/effect-stack/commit/4de4cd954f9ada1019b2dbda8eda6545f8c3ac47), [`1c1232e`](https://github.com/samuelbriole/effect-stack/commit/1c1232ef781afa73b1d88f4996fe10da558925e6)]:
  - @effect-stack/router@0.3.0

## 0.2.0

### Minor Changes

- [#7](https://github.com/samuelbriole/effect-stack/pull/7) [`5c38565`](https://github.com/samuelbriole/effect-stack/commit/5c385653998c382ff9f24e5139bd031f7877d45f) Thanks [@samuelbriole](https://github.com/samuelbriole)! - Add nested Effect-native routing and first-party React, Solid, and Vue adapters.
  
  ### Headless routing
  
  - Add ranked nested, index, and pathless route trees with inherited URL Schemas, typed node kinds, Pipeable builders, and
    a stable model-identification guard. Compile static ranking, path segments, ancestry, and destination endpoints once.
  - Share typed destinations and endpoint selection through `RouteTree`. Same-URL indexes own their destination requirements,
    including indexes beneath pathless layouts; ancestor destinations cannot bypass required search or hash inputs.
  - Add Effect data loaders receiving decoded params, search, hash, and location, with inferred data, failures, and Layer
    requirements. Resolve ancestors before descendants and load code and data concurrently within each route.
  - Expose typed incoming matches, retained resolved data, the last complete successful branch, transition identity, and
    stable per-route Atom projections with selective subscriptions. Preserve route/input correlation in nested commands and
    enforce generic route-error constructor types.
  - Add composable Effect navigation and initialization retry. Navigation awaits its own transition and scoped cleanup,
    retains the engine for headless callers, safely serializes concurrent acceptance, and interrupts superseded work. Current
    interruption publishes terminal branch failure, and late asynchronous results cannot overwrite newer navigation.
  - Keep the command atom compatible with navigation observation, interruption, and resetting its result to Initial. Retry
    rebuilds failed initialization without duplicating its initial load.
  
  ### Native renderer adapters
  
  - Add providers, typed links and navigation, route-local hooks, nested outlets, persistent layouts, lazy views, and bubbling
    pending/error/not-found boundaries. React exposes hook values, Solid exposes reactive accessors, and Vue exposes computed
    route composables, all with selector support.
  - Integrate native Effect services and Layers with registry-owned scoped lifetimes, service sharing, and caller-owned
    registry support. Links retain native anchor behavior and expose active state.
  - Return awaitable navigation Promises and provide typed, registry-bound Effect navigation hooks across all three renderers.
  - Make decoded incoming params and search available in fallback views while keeping retained loader data associated with
    its original inputs. Share renderer-neutral fallback selection and declarative navigation policy.
  - Recover latched render errors only after a relevant transition successfully completes. Handle history-state-only
    declarative updates and avoid duplicate navigation when pending boundaries remount already-satisfied redirects.
  - Constrain present lazy `component` and `default` exports to valid renderer views and report invalid selected exports
    through the nearest error boundary with route identity. Renderer-neutral modules retain the Outlet fallback.
  
  Include package-local examples, dependency-injection and navigation documentation, React package repository metadata, and
  standalone artifact checks that build the complete publishable package graph.

### Patch Changes

- Updated dependencies [[`5c38565`](https://github.com/samuelbriole/effect-stack/commit/5c385653998c382ff9f24e5139bd031f7877d45f)]:
  - @effect-stack/router@0.2.0
