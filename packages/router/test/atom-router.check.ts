/**
 * Compile-time AtomRouter runtime requirement checks. Typechecked by
 * `pnpm check`; not run by Vitest.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRouter from "@effect-stack/router/AtomRouter"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import * as Route from "@effect-stack/router/Route"
import * as Router from "@effect-stack/router/Router"

const Routes = Router.make("App").add(
  Route.make("home", "/"),
  Route.make("project", "/projects/:projectId", {
    params: { projectId: Schema.FiniteFromString },
    success: Schema.Struct({ title: Schema.String })
  })
)

const ProjectLive = Router.route(Routes.project, () => Effect.succeed({ title: "x" }))
const AppLive = Router.layer(Routes).pipe(Layer.provide(ProjectLive), Layer.provide(MemoryHistory.layer()))

const appRuntime = Atom.runtime(AppLive)
const good = AtomRouter.make(appRuntime, Routes)
void good

const emptyRuntime = Atom.runtime(Layer.empty)
// @ts-expect-error The runtime must provide the contract's service identifier.
const missing = AtomRouter.make(emptyRuntime, Routes)
void missing

const Other = Router.make("Other").add(Route.make("home", "/"))
const otherRuntime = Atom.runtime(Router.layer(Other).pipe(Layer.provide(MemoryHistory.layer())))
// @ts-expect-error The runtime provides a different collection's service.
const wrong = AtomRouter.make(otherRuntime, Routes)
void wrong
