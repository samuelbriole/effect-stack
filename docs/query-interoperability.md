# Query and Effect interoperability

Query builds on Effect's existing reactivity APIs with an application-scoped remote-state ownership model. The contracts
below apply to the pinned Effect `4.0.0-rc.112` implementation; automatic policies in upstream combinators remain owned by
those combinators.

## Existing Effect capabilities

`AtomHttpApi` and `AtomRpc` already provide typed transport-backed query and mutation atoms. Effect also supplies structural
Atom families, `AtomRegistry.getResult` for Effect consumers, `Reactivity` invalidation, `Atom.swr`, `Atom.withRefresh`,
optimistic combinators, and registry hydration. Sharing requests and reading Atom results from Effect are established
capabilities of that ecosystem.

Query's distinction is the combination of:

- One application-scoped cache shared across Atom registries and imperative readers.
- Freshness separated from inactive retention.
- Invalidation generations that persist for retained inactive entries.
- Read cancellation governed by shared consumer interest.
- Concurrent client-owned mutations with independently awaitable outcomes.
- Captured Effect Clock timing and finalized-execution publication.

`Cache` and `ScopedCache` have useful caching and resource-lifetime contracts, but substituting their TTL for Query's
freshness, inactive retention, and observer-interest model would change those semantics. This ownership model motivates the
current implementation. It does not imply an upstream roadmap commitment or a lack of overlap with existing Effect APIs.

## Observation and snapshots

`Query.Resource.observation` and `Mutation.Handle.observation` are self-contained public capabilities. Their synchronous
`getSnapshot()` methods expose authoritative cached state without starting work or acquiring observation interest. Their
`observe()` methods own subscription lifetimes. This separates reading cached state during React render from activating
work after commit.

Spread copies preserve the capability. A forwarding wrapper or test substitute must preserve or implement it consistently
with its Effect operations. QueryAtom accesses the capability directly, allowing compatible module copies to observe a
handle without sharing a private identity table. Atom memoization remains local; wrapper identity does not define cache
identity or create another execution owner.

Client notification dispatch isolates throwing callbacks and reports their defects with `Effect.logError`. Notification
failures do not replace an execution's Exit or prevent deferred settlement, delivery to other listeners, or shutdown.
Applications control these diagnostics through their captured Effect logging configuration.

## Native Atom refresh

`QueryAtom.query(resource)` uses the native readable-Atom refresh hook to delegate to the resource's synchronous
invalidation capability:

| State                    | Native refresh behavior                                  |
| ------------------------ | -------------------------------------------------------- |
| Active interest          | Advance the generation and start or queue revalidation.  |
| Retained, inactive entry | Mark stale persistently; loading waits for new interest. |
| No cache entry           | Leave the cache empty; first interest loads normally.    |
| Closed client            | No-op; never reopen the client.                          |

Notifications propagate to every registry observing that resource. This is the same invalidation transition used by the
resource's Effect operation, without introducing another runtime or a fire-and-forget waiter. Use `resource.refresh` to
acquire interest and await data. Mutation-Atom refresh only refreshes observation; it never starts a write.

Combinators that forward native refresh can use this path. Avoid accidentally stacking independent automatic policies:
Query applies its definition's `staleTime` on acquisition, while `Atom.swr` applies its own timestamp-based policy and can
force another invalidation. In the pinned implementation, SWR predicates use `Date.now()` and `Atom.withRefresh` uses host
timers; they do not inherit the client's Effect TestClock. A Query resource's own timing continues to use its captured Clock.

## Reactivity integration

There is no automatic mapping from Effect `Reactivity` keys to Query definitions or inputs in this release. A future bridge
must live in the application/client scope, attach and detach its upstream subscription there, and forward events through
resource or family invalidation. It must invalidate retained inactive entries even when no renderer is mounted; a listener
attached only to a view Atom cannot provide that guarantee.

Applications can already compose resource/family invalidation into their own Effect workflows. Post-write invalidation
belongs inside mutation execution so it survives the departure of a UI waiter. No second reactive cache is required.

## Transport integration

Use Effect's typed `HttpApiClient` and `RpcClient` services in query loaders and mutation execution. Supply those services
through the client's application Layer or borrowed Context, preserving their inferred success, error, and environment
types. Transport helpers should reuse those definitions and services. Wrapping already-cached `AtomHttpApi` or `AtomRpc`
results in another Query cache would introduce competing freshness and lifetime policies.

## Hydration and optimistic state

Query hydration is deferred. Hydrating or serializing only a view Atom does not populate the authoritative client cache;
future hydration must restore client entries and their freshness/invalidation metadata before attaching views.

Native optimistic Atom combinators operate on view state. They do not constitute Query-cache optimistic transactions and
cannot promise rollback across imperative readers or multiple registries. Any future Query optimistic API must coordinate
those consumers through the client-owned cache.
