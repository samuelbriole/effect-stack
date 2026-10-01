/**
 * Compile-time AtomRouter runtime requirement checks. Typechecked by
 * `pnpm check`; not run by Vitest.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Atom from "effect/reactivity/Atom"
import * as AtomRouter from "@effect-stack/router/AtomRouter"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import * as Router from "@effect-stack/router/Router"

const Home = Router.route("home", "/")
const Project = Router.route("project", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  prepare: () => Effect.void
})

const App = Router.make("App", [Home, Project])
const AppLive = App.layer.pipe(Layer.provide(MemoryHistory.layer()))

const appRuntime = Atom.runtime(AppLive)
const good = AtomRouter.make(appRuntime, App)
void good

const emptyRuntime = Atom.runtime(Layer.empty)
// @ts-expect-error The runtime must provide the application's service identifier.
const missing = AtomRouter.make(emptyRuntime, App)
void missing

const Other = Router.route("home", "/")
const OtherApp = Router.make("Other", [Other])
const otherRuntime = Atom.runtime(OtherApp.layer.pipe(Layer.provide(MemoryHistory.layer())))
// @ts-expect-error The runtime provides a different application's service.
const wrong = AtomRouter.make(otherRuntime, App)
void wrong

// A runtime for the same application identifier but different gate metadata
// is rejected statically by the branded service identifier.
const OtherSpec = Router.route("project", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  prepare: () => Effect.fail("different" as const)
})
const OtherSpecApp = Router.make("App", [Home, OtherSpec])
const otherSpecRuntime = Atom.runtime(OtherSpecApp.layer.pipe(Layer.provide(MemoryHistory.layer())))
// @ts-expect-error The runtime provides different gate metadata.
const wrongSpec = AtomRouter.make(otherSpecRuntime, App)
void wrongSpec
