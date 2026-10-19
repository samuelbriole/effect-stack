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

const App = Effect.runSync(Router.make("App", [Home, Project]))
const AppLive = Router.layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer()))

const appRuntime = Atom.runtime(AppLive)
const good = AtomRouter.make(appRuntime, App)
void good

const emptyRuntime = Atom.runtime(Layer.empty)
// @ts-expect-error The runtime must provide the standard acquired application bundle.
const missing = AtomRouter.make(emptyRuntime, App)
void missing

const headlessRuntime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer())))
// @ts-expect-error A headless application service alone does not provide the standard bundle.
const headless = AtomRouter.make(headlessRuntime, App)
void headless
