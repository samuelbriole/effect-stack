/**
 * Compile-time provider runtime requirement checks. Typechecked by
 * `pnpm check`; not run by Vitest.
 */
import * as Layer from "effect/Layer"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Atom from "effect/reactivity/Atom"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import { make, route, Provider } from "@effect-stack/router-react"

const Home = route("home", "/", { component: () => null })
const Project = route("project", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  component: () => null
})

const App = make("React", [Home, Project])
const AppLive = App.layer.pipe(Layer.provide(MemoryHistory.layer()))

const good = <Provider app={App} runtime={Atom.runtime(AppLive)} />
void good

const missing = (
  // @ts-expect-error The provider runtime must supply the application's service.
  <Provider app={App} runtime={Atom.runtime(Layer.empty)} />
)
void missing

const Other = make("OtherReact", [Home])
const otherRuntime = Atom.runtime(Other.layer.pipe(Layer.provide(MemoryHistory.layer())))
// @ts-expect-error app inference must not widen to accommodate a foreign service runtime.
const foreignRuntime = <Provider app={App} runtime={otherRuntime} />
void foreignRuntime
const ErrorApp = make("React", [route("failure", "/", { empty: true, prepare: () => Effect.fail("failure" as const) })])
// @ts-expect-error matching app ids do not erase the invariant application error/requirement witness.
const sameIdRuntime = <Provider app={ErrorApp} runtime={Atom.runtime(AppLive)} />
void sameIdRuntime
const children = (
  // @ts-expect-error Provider renders the application; ignored children are not supported.
  <Provider app={App} runtime={Atom.runtime(AppLive)}>
    ignored
  </Provider>
)
void children
