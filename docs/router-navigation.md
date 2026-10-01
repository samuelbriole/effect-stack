# Navigation contracts

Shared behavior for the headless Router and its React, Solid, and Vue adapters.
See [adoption](adoption.md) for setup.

## Commands and completion

The assembled application's `service` key provides the runtime router:

```ts
const router = yield * App.service
const outcome = yield * router.navigate(ProjectIndex.to({ params: { projectId } }))
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
use the command's Effect error channel without changing previously accepted work or its status.
Browser/external changes are already committed locations and enter at the matching phase.

Explicit Effect commands retain their typed failures and full `Cause`; Promise hooks reject on failure.
Renderer `Link`, `Navigate`, and `useRetry` use the shared detached-command policy: work runs in the router's Scope,
and otherwise-unobserved failures are logged through the Effect Logger captured during application acquisition.
Failures already published by that exact attempt are not logged a second time. An obsolete attempt's unpublished
cleanup failure is still reported, even after newer work commits. Shutdown interruption alone is not an error diagnostic.
These diagnostics never change accepted status or replay a navigation or history write.

`navigate`/`submit` options override a destination's defaults: the option `replace` beats the destination's captured
`replace`, and an explicit option `state` beats the destination's captured `state` — including an explicit `undefined`
option `state`, which clears the destination default. An absent option keeps the destination default. A declared hash
schema always validates the value: a required hash rejects a missing fragment on encode and decode, while an
optional/undefined hash accepts its absence. An encoded hash that is an empty string (including through a schema
transformation) is unrepresentable — an empty fragment cannot be distinguished from an absent one — so it is rejected
rather than silently dropped. A required path parameter cannot encode to an empty segment or a protocol-relative href.

## Membership and identity

Native navigation helpers created with `makeNavigation<typeof App>()` accept an identity destination
or a typed path target. A path target resolves synchronously to the canonical selected endpoint
through `Router.resolvePathDestination`, which reads only the assembled node index and never awaits
the router service. The helper imports the application type only; it cannot verify the erased type
at runtime, so it resolves against the nearest active provider. `makeNavigation(App)` binds the same helpers to an exact
provider token; application-taking hooks such as `useRouter(App)` make the same check.

Destinations are validated against the selected definitions before any history write. A foreign destination — including a
definition from an independent selection that happens to share a qualified id — fails with `RouteEncodeError` and leaves
accepted work untouched. Redirects perform the same check before replacing history. The service's `href` checks membership
while the collection-independent `Router.href` does not. All hrefs use the same codecs; selection-aware encoding checks
membership first. `AtomRouter.href` and renderer `Link`/`Navigate` validate synchronously against the supplied witness,
so links render correctly even before the runtime starts.

Definitions are constructor-owned and frozen; copied or spread values are rejected at assembly. Selecting a child includes
its ancestor closure once, while selecting an ancestor never includes its children. The same definition can be selected by
multiple applications, each owning independent services and resources. `AtomRouter.make(runtime, App)` validates the exact
finalized application identity (application id, routes, and canonical token) on every acquisition path, failing startup
when a runtime was assembled from a different application specification. Every finalized application also owns a fresh
service key, so two applications over the same definitions cannot collide.

## Gates and publication

- Ancestors prepare before descendants, and a fully resolved branch is published atomically.
- Layout gates run before child gates. `prepare` is a direct `(decodedInput) => Effect<void, E, R>`; there is no
  handler factory or success data channel. Gates run **after** the history write, never guard the URL write.
- All transient gate scopes close before the branch is published atomically. Long-lived resources belong to supplied
  service Layers or application-owned Effect Atom runtimes.
- Redirects are typed control failures consumed by the coordinator: the same attempt continues, intermediate history
  entries are replaced, hop count is bounded, and the final destination is reported on commitment.
- Expected domain failures are published against their owning node. Defects, finalizer failures, and a gate's own
  interruption stay in `Cause` and settle the attempt rather than leaving it pending.
- Initial history acquisition and supplied service Layer construction failures are startup failures; route retry reruns
  gates without rebuilding Layers or refreshing application resources.

## Observations and snapshots

The service exposes a read-only snapshot and change stream; `AtomRouter.make(runtime, App)` exposes the same state as
read-only atoms and typed per-node projections.

| Projection    | Meaning                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `state`       | Snapshot: location, accepted navigation status, presentation, and last resolved branch |
| `location`    | The observed location                                                                  |
| `status`      | Accepted navigation status; pre-acceptance failures do not change it                   |
| `branch`      | The active branch's nodes, ancestors first                                             |
| `route(node)` | Typed decoded input for one displayed node, `None` when inactive                       |

A presentation entry keeps decoded input and failure provenance. Pending presentation contains only the incoming attempt
and location, not per-node preparation progress. While an attempt is pending, renderers and
route projections read the previous resolved branch and its original input, not the newest observed URL. On commitment,
the whole new branch and its decoded input become visible together. Application Atom families selected by that input
therefore remain coherent with the displayed component. The router publishes no data `Option` or resource result.

### Observation failures

`BrowserHistory` retries its read-only location snapshot twice, after 25 ms and 50 ms. Metadata repair, UUID-backed
pushes, and other history writes are never replayed. An exhausted `popstate` read or failed metadata repair is logged
with its full `Cause` and skipped; the same listener remains available for later events. A skipped location is not
prepared automatically without another observation or explicit command. Initial acquisition failures remain startup failures.

Defects and mixed causes are not retried or treated as recoverable observations. The router reports a terminal
`History.changes` failure as `Router.historyObservationStopped`, preserving its full `Cause` and the last accepted
snapshot. A custom History stream is not automatically restarted: restartability is not guaranteed by its interface.
An intentional stream completion is not a failure. Observation health must not be inferred from navigation `status`.
An observation source that self-interrupts while the router Scope is still open is a terminal failure, not normal shutdown.
If logging a skipped browser observation fails, its terminal `Cause` retains both the history failure and the Logger defect.

Use standard `Logger.layer` configuration around application acquisition to capture diagnostics; no separate
router diagnostic state or custom logging module is required.

## Rendering and recovery

Native `make(...)` returns one canonical application; `Provider` takes `app` and `runtime`. Adapters share construction
through `@effect-stack/router/Adapter` while preserving native rendering and lifecycle. Every endpoint requires
presentation (`component` or Vue `render`) or `empty: true`; layouts may be transparent. `index(options)` is shorthand for
`route("index", "/", options)` at the parent's path, with ordinary endpoint semantics.

Components receive no mandatory injected props; `useRouteInput(def)` reads displayed input (React value, Solid accessor,
Vue computed ref). Layouts render an `Outlet` to continue the branch. Initial preparation uses the Provider's optional
`pending` component; later preparation retains the committed branch. Routing error views replace the failing node and
descendants while preserving layouts above it. Bound navigation helpers reject a different provider token.

Error views receive one discriminated failure. Only a pure expected gate failure attributed to its own node is
`{ _tag: "Domain", error }`; decode, encode, history, defect, finalizer, and mixed failures stay `{ _tag: "Cause", cause }`
so infrastructure failures are never cast to the gate's domain error. Startup failure has no gate-retry control: service
acquisition failed. Route retry reruns gates without rebuilding the runtime or refreshing resource atoms.
Application-owned resource errors and refresh use official Effect Atom APIs independently of routing. Native render
exceptions propagate to application-owned error boundaries; their reset does not implicitly retry navigation.

`Link` renders a real anchor with a typed destination and preserves native modifier keys, alternate targets, and
downloads. Hooks return native values: React values, Solid accessors, and Vue computed refs. React `Link` also accepts
`replace`/`state` options and native anchor props including `ref`; bound helpers preserve these native props. Typed
path navigation selects endpoint nodes only, so a selected layout contributes no navigable path and a layout that
shares its path with an index endpoint keeps the index's own required fields.

`Navigate` reacts to its encoded target and explicit options, not observed-location changes; redirects do not resubmit
an unchanged target.
