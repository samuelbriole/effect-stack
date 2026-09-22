/**
 * Compile-time provider runtime requirement checks. Typechecked by
 * `pnpm check`; not run by Vitest.
 */
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Atom from "effect/unstable/reactivity/Atom"
import type { RouterProviderProps, Views } from "@effect-stack/router-vue"
import * as Router from "@effect-stack/router/Router"
import * as Route from "@effect-stack/router/Route"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"

const Routes = Router.make("Vue").add(
  Route.make("home", "/"),
  Route.make("project", "/projects/:projectId", {
    params: { projectId: Schema.FiniteFromString },
    success: Schema.Struct({ title: Schema.String })
  })
)

const ProjectLive = Router.route(Routes.project, () => Effect.succeed({ title: "x" }))
const AppLive = Router.layer(Routes).pipe(Layer.provide(ProjectLive), Layer.provide(MemoryHistory.layer()))

const views = {} as Views<typeof Routes>

const good: RouterProviderProps<typeof Routes, Router.ServiceIdOf<typeof Routes>, never> = {
  routes: Routes,
  runtime: Atom.runtime(AppLive),
  views
}
void good

const missing: RouterProviderProps<typeof Routes, never, never> = {
  routes: Routes,
  // @ts-expect-error The provider runtime must supply the contract's service.
  runtime: Atom.runtime(Layer.empty),
  views
}
void missing
