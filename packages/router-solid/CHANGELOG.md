# @effect-stack/router-solid

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
