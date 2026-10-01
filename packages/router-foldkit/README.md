# @effect-stack/router-foldkit

EffectStack routing in native Foldkit Model, Message, Command, Subscription, and Html flows. No Atom registry is required.

## Release compatibility

This workspace validates Effect 4.0.0 and `@effect/platform-browser` 4.0.0 with Foldkit 0.164.0. **Foldkit 0.164.0 still
declares RC Effect peers.** The workspace validation exception does not promise published stable compatibility. Releasing
this adapter requires an aligned Foldkit peer/dependency bump; consumers should use that future compatible release, not
override peer requirements. Install the adapter, `@effect-stack/router`, Effect 4, and the compatible Foldkit release
together; browser applications also need `@effect/platform-browser` 4.

The adapter is currently a private workspace package to prevent premature publication. Remove that release hold only after updating Foldkit to an aligned stable-v4 release and rerunning CI.

## Setup

Declare application schemas before routes. `State` and `RouterMessage` are route-independent schemas, avoiding cyclic
Model/application inference. Wrap router messages in your own application Message:

```ts
import { create, RouterMessage, State } from "@effect-stack/router-foldkit"
import { Schema } from "effect"

const Model = Schema.Struct({ router: State, count: Schema.Number })
type Model = typeof Model.Type
const GotRouter = Schema.TaggedStruct("GotRouter", { message: RouterMessage })
const Message = Schema.Union([GotRouter, Schema.TaggedStruct("Increment", {})])
type Message = typeof Message.Type

const { route, layout, make } = create<Model, Message>({
  getState: (model) => model.router,
  setState: (model, router) => ({ ...model, router }),
  toMessage: (message) => GotRouter.make({ message })
})

const Project = layout("project", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString.pipe(Schema.brand("ProjectId")) },
  render: ({ h, input, outlet }) => h.section([], [h.h1([], [`Project ${input.params.projectId}`]), outlet()])
})
const Index = Project.index({
  render: ({ model, h, input }) => h.p([], [`${input.params.projectId}: ${model.count}`])
})
const App = make("Example", [Index])
```

Views are pure callbacks receiving `{ model, h, input, outlet }` and returning native Foldkit `Html`. Child routes,
layouts, and indexes receive decoded ancestor URL input, including brands. Layouts may be transparent; endpoints need
`render` or `empty: true`. `create` also accepts pure `pending`, `notFound`, and diagnostic `error` fallbacks.

`make` returns the canonical core application (`layer`, `service`, typed destinations, and application identity), extended
with Foldkit integration. Close its router Layer before connecting, then supply the connection's resources and persistent
subscription to your own runtime:

```ts
import * as BrowserHistory from "@effect-stack/router/BrowserHistory"
import type { ConnectionId } from "@effect-stack/router-foldkit"
import { Layer } from "effect"
import type { Document, HtmlBuilder } from "foldkit/html"
import * as Runtime from "foldkit/runtime"
import type * as Update from "foldkit/update"

const connection = App.connect(App.layer.pipe(Layer.provide(BrowserHistory.layer)))

const update = (model: Model, message: Message): Update.Return<Model, Message, ConnectionId<"Example">> => {
  switch (message._tag) {
    case "GotRouter":
      return App.update(model, message.message)
    case "Increment":
      return { model: { ...model, count: model.count + 1 } }
  }
}
const viewDocument = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: "Projects",
  body: App.view(model, h)
})

Runtime.run(
  Runtime.makeApplication({
    Model,
    init: () => ({ model: { router: App.initialState, count: 0 } }),
    update,
    view: viewDocument,
    resources: connection.resources,
    subscriptions: connection.subscriptions,
    container: document.getElementById("root")
  })
)
```

Keep the explicit `Update.Return` annotation: it preserves the connection requirement and breaks view/update inference
cycles. Manual Message matching, as above, or Foldkit's Message helpers both work. Compose your own Commands, resources,
and subscriptions normally. **Omit Foldkit's `routing` config**; EffectStack owns navigation and history.

`connect` accepts a closed, possibly fallible `Layer<AppService, StartupE>`. Its resources are an infallible bridge Layer;
`subscriptions.router` persistently starts and scopes the router Layer internally, publishing startup failures into Model
state instead of failing Foldkit resource acquisition. Retain this subscription for the application's lifetime. Restored
HMR Model state is schema-revalidated, and the persistent subscription resynchronizes it from the running router; the
snapshot is not an executable router service. SSR and hydration are not supported by this adapter.

## Gates and failures

`prepare: (input) => Effect<void, E, R>` is an optional authorization/readiness gate. Supply its services through the
router Layer. Data and remote resources remain caller-owned: use Foldkit Commands/Submodels, or optional Effect Atom
integration without a mandatory registry.

For domain failures, provide an optional service-free `errorSchema` codec. The adapter serializes the gate failure into
State and restores it for the pure `error({ model, h, failure, retry })` callback:

```ts
error: ({ h, failure, retry }) =>
  h.div(
    [h.Role("alert")],
    [
      failure._tag === "Domain" ? String(failure.error) : failure.diagnostic.message,
      h.button([h.OnClick(retry)], ["Retry"])
    ]
  )
```

`failure` is either `{ _tag: "Domain", error: E }` or `{ _tag: "Diagnostic", diagnostic }`. Without a codec, or if
encoding/decoding fails, rendering receives a diagnostic rather than an unchecked domain value. `retry` is already an
application Message; pass it directly to `h.OnClick`. Retry reruns gates, not application data loading. Native rendering
exceptions remain Foldkit/application-owned. The [browser example](examples/basic) demonstrates controllable gate failure
and recovery through an application Command without side effects in `update`.

## Navigation

- `App.navigate(typedPathOrDestination, { replace?, state? })` returns an application Message.
- `App.link(h, target, children, { attributes?, replace?, state? })` returns native anchor `Html`.
- `App.retry()`, `refresh()`, `back()`, `forward()`, and `go(delta)` return application Messages.
- `App.input(model.router, definition)` returns an `Option` of coherent displayed, decoded route input.
- `App.cancel(attempt)` targets only adapter-submitted navigation handles. It does not guarantee cancellation of
  initialization, retries, refreshes, or history traversals.

Navigation `state` accepts JSON or `undefined` and lives in `history.state`, not the Model snapshot. Links keep real `href`
values and browser anchor semantics. The connection's scoped listener intercepts only adapter-marked links carrying this
application's capability; ordinary links remain native. It respects modifiers, targets, downloads, and prevented events.
By default it listens on `document`; use `connect(layer, { linkRoot: () => stableParent })` for an embed or
`{ linkRoot: false }` for headless operation. Do not add a separate navigation click handler to adapter links.
Foldkit may replace its render container, so an embed's listener root must be a stable surrounding element, not that replaceable container.

See [adoption](../../docs/adoption.md), [architecture](../../docs/architecture.md), and
[navigation contracts](../../docs/router-navigation.md) for shared guarantees.
