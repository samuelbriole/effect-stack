# @effect-stack/router

Effect-native, renderer-independent URLs, history, navigation, and transition gates. Application data belongs to
official Effect Atom resources; the router owns no resource cache or success-data channel.

```sh
pnpm add @effect-stack/router effect@4
```

## Headless setup

```ts
import { Effect, Layer, Schema } from "effect"
import { MemoryHistory, Router } from "@effect-stack/router"

const Home = Router.route("home", "/")
const Project = Router.layout("project", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  search: { tab: Schema.optionalKey(Schema.String) },
  prepare: ({ params }) => Effect.log(`Preparing project ${params.projectId}`)
})
const Index = Project.index()
const Details = Project.route("details", "/details")
await Effect.runPromise(
  Effect.gen(function* () {
    const App = yield* Router.make("Example", [Home, Index, Details])
    return yield* Effect.gen(function* () {
      const router = yield* App.service
      yield* router.navigate(Details.to({ params: { projectId: 42 } }))
      return yield* router.state
    }).pipe(Effect.provide(App.layer.pipe(Layer.provide(MemoryHistory.layer("/")))))
  })
)
```

`make` returns a lazy Effect: each execution validates the selection and creates a fresh application, without acquiring
runtime services. Invalid assembly is a defect; service acquisition still belongs to `App.layer`.
URL codecs must be synchronous and context-free.

## APIs

- `prepare(decodedInput)` is an optional gate returning `Effect<void, E, R>`; provide its requirements through `App.layer`.
- `App.service` exposes `navigate`, `submit`, `refresh`/`retry`, history traversal, `state`, and the `changes` stream.
- `.to(input, options?)` constructs a destination; `Router.href(destination)` returns a synchronous encoding `Result`.
- `resolvePathDestination(App, template, input)` resolves canonical endpoint paths without service acquisition.

`ErrorOf<Def>`/`RequirementsOf<Def>` expose a gate's E/R; `ApplicationErrorOf<App>`/`ApplicationRequirementsOf<App>` aggregate
the selection's evidence. `DecodedRouteInputOfDef<Def>` describes its decoded params, search, hash, and location.

## Atom integration

Build the runtime with `Router.layer(assembly)`, which supplies `Router.RuntimeApplication`: the canonical application and
scoped router. Use one application per runtime.

`AtomRouter.make(runtime, App)` observes that acquired service through read-only `service`, `state`, `location`, `status`,
`branch`, and `route(def)` atoms; `App` must be that runtime's canonical application witness. Use the same
`runtime.atom(effect)` and `Atom.family` for application resources.
Its `navigate(destination, options?)` and `retry()` factories create lazy, independent result atoms for commands; consuming
an atom starts its command. Keep the same atom when observing one invocation, and create another for a new invocation.
Actions retain typed navigation/gate and runtime Layer errors. Use Atom's default result unwrapping to read snapshots;
the state atom's `waiting` flag describes its subscription, while `status` describes navigation progress.

See [adoption](../../docs/adoption.md) for renderer setup and the supported `@effect-stack/router/Adapter` bridge,
[architecture](../../docs/architecture.md) for ownership, and [navigation contracts](../../docs/router-navigation.md) for shared behavior.
