# @effect-stack/router

Effect-native, renderer-independent routing for the web. A route collection is a declarative contract implemented by
composable Layers.

```sh
pnpm add @effect-stack/router effect@rc
```

## Declarations

Routes and groups are immutable, pipeable declarations. Bind them into a named collection with `Router.make(...).add(...)`.

```ts
import * as Route from "@effect-stack/router/Route"
import * as RouteGroup from "@effect-stack/router/RouteGroup"
import * as Router from "@effect-stack/router/Router"
import { Schema } from "effect"

export const ProjectRoutes = RouteGroup.make("project", {
  params: { projectId: Schema.FiniteFromString },
  search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
  success: Schema.Struct({ title: Schema.String }),
  error: Schema.Struct({ code: Schema.Number })
})
  .add(Route.make("index", "/"), Route.make("details", "/details", { success: Schema.Void }))
  .prefix("/projects/:projectId")

export const Routes = Router.make("App").add(
  Route.make("home", "/"),
  Route.make("login", "/login", { search: { returnTo: Schema.optionalKey(Schema.String) } }),
  ProjectRoutes
)
```

- `Route.make(identifier, path, options?)` declares one addressable leaf; `path` is slash-local (`/` is the index spelling).
- `RouteGroup.make(identifier, options?)` declares a non-addressable group with `.add(...)`, `.prefix(path)`, and `.pipe`.
- `params`, `search`, `hash`, `success`, and `error` schemas determine destination, handler, and view types.
- `Routes.service` is the typed runtime service key; `Routes.project.details` is a bound destination.
- Every `.add`/`.prefix` returns a new value. Standalone declarations are not implementation targets or destinations;
  bound nodes cannot be added back as declarations.

## Paths, prefixes, and inheritance

- Leading `/` is local to the parent mount and never escapes: `/projects` + `/:projectId` is `/projects/:projectId`.
- Group prefixes are persistent and applied once when bound. `.prefix("/projects").prefix("/admin")` mounts at
  `/admin/projects`; `.prefix("/")` is an identity, and a group without a prefix is pathless.
- `params` and `search` are inherited by descendants. Redeclaring an inherited field — even the same schema — is rejected
  at binding, so effective fields are always the disjoint union of inherited and own fields.
- `hash`, `success`, and `error` stay node-local. Every matched ancestor decodes the raw fragment through its own hash
  schema, so a child destination can fail an ancestor hash constraint as a typed decoding failure.
- URL `params`, `search`, and `hash` schemas must be context-free codecs; service-requiring codecs are rejected statically.
  An asynchronous transformation cannot be distinguished statically, so it is accepted at declaration time and the
  actual encode or decode then fails with a typed `RouteEncodeError` or `RouteDecodeError` rather than a Fiber defect.
- Options must be concrete object literals. A widened `Route.Options`, or a union of options, is rejected rather than
  silently erasing the schema sections that drive destination, handler, and implementation types.

## Destinations and hrefs

```ts
const destination = Routes.project.details({ params: { projectId }, search: { tab: "activity" } })
const href = Router.href(destination) // Result<string, RouteEncodeError>
```

Destination construction performs no navigation. Encoding remains fallible because refinements can reject runtime
values. `Router.href` is collection-independent; the service's `router.href(destination)` and the renderer adapters
reject destinations that do not belong to the bound collection.

## Implementations

```ts
const ProjectLive = Router.route(Routes.project, ({ params }) =>
  Projects.use((projects) => projects.get(params.projectId))
)

const RouterLive = Router.layer(Routes).pipe(Layer.provide(ProjectLive), Layer.provide(BrowserHistory.layer))
```

`Router.route` validates handler success against the declared `success` type and rejects undeclared errors while allowing
`Router.redirect`. Declaring `success` or `error` (including `Schema.Void`) makes an implementation mandatory; a route
with neither is a no-op. `Router.layer` requires every mandatory implementation service plus `History.Service`; missing
pieces remain unsatisfied Layer requirements. Use `Router.route(descriptor).buildEffect(...)` when the handler is
constructed effectfully. Layer assembly verifies that each implementation targets the canonical bound node.

Implementation services use the same key for one qualified node, so ordinary `Context` composition applies: when two
Layers provide the same implementation key, the later-provided Layer wins. The router does not attempt duplicate
detection beyond `Context` merging, matching deliberate test substitution.

## Runtime

```ts
const program = Effect.gen(function* () {
  const router = yield* Routes.service
  const outcome = yield* router.navigate(Routes.project.index({ params: { projectId } }))
  return outcome
}).pipe(Effect.provide(RouterLive))
```

The service exposes `navigate`, `submit` (an identity-specific handle with `await`/`cancel`), `refresh`, `retry`,
`back`/`forward`/`go`, read-only `state`, and `changes`. Terminal outcomes are `Committed`, `Superseded`, and
`Cancelled`; domain failures use the Effect error channel.

## History

`BrowserHistory.layer` provides browser-backed history. `MemoryHistory.layer(initialHref)` is deterministic and useful
in tests. Both are renderer-independent.

## Atom integration

`AtomRouter.make(runtime, Routes)` retrieves the contract's service from an existing `AtomRuntime` and exposes read-only
observations (`state`, `location`, `status`, `branch`, and typed `route(node)` projections). It never creates a second
engine and never exposes writable router state.

See the [navigation contracts](../../docs/router-navigation.md).
