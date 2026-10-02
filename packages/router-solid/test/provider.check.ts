/**
 * Compile-time provider runtime requirement checks. Typechecked by
 * `pnpm check`; not run by Vitest.
 */
import * as Layer from "effect/Layer"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Atom from "effect/reactivity/Atom"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import type * as Router from "@effect-stack/router/Router"
import { layout, layer, make, makeNavigation, RouterProvider, route, useRouteInput } from "@effect-stack/router-solid"

const Home = route("home", "/", { component: () => null })
const Project = route("project", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  component: () => null
})

const App = Effect.runSync(make("Solid", [Home, Project]))
const AppLive = layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer()))

RouterProvider({ runtime: Atom.runtime(AppLive) })
// @ts-expect-error The provider runtime must supply the standard selection service.
RouterProvider({ runtime: Atom.runtime(Layer.empty) })
// @ts-expect-error The application's own layer lacks the standard selection service.
RouterProvider({ runtime: Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer()))) })
// @ts-expect-error The runtime alone selects the application.
RouterProvider({ app: App, runtime: Atom.runtime(AppLive) })

// An index endpoint carries its own hash through destinations and accessors.
const HashParent = layout("hashParent", "/hash-parent", {})
const HashedIndex = HashParent.index({
  hash: Schema.String,
  prepare: () => Effect.void,
  empty: true
})
const HashApp = Effect.runSync(make("SolidHash", [HashedIndex]))
const hashInput = useRouteInput(HashedIndex)
void HashApp
const hashValue: string = hashInput().hash
void hashValue
HashedIndex.to({ hash: "section" })
// @ts-expect-error the index hash destination requires its declared hash
HashedIndex.to({})

// Typed path navigation on the bound link.
const projectIdPath = Schema.decodeUnknownSync(Schema.FiniteFromString)(1)
const Navigation = makeNavigation(App)
Navigation.Link({ to: "/projects/:projectId", params: { projectId: projectIdPath } })
// @ts-expect-error an unknown path template is not a selected endpoint
Navigation.Link({ to: "/nope" })
// @ts-expect-error a path param keeps its decoded type
Navigation.Link({ to: "/projects/:projectId", params: { projectId: "nope" } })

// --- explicitly selected layout kind ---
const LayoutOnly = layout("layoutOnly", "/layout-only", {})
type LayoutOnlyPaths = Router.PathsOf<readonly [typeof LayoutOnly]>
// @ts-expect-error a selected layout is not a navigable endpoint
const layoutOnlyPath: LayoutOnlyPaths = "/layout-only"
void layoutOnlyPath

const SelectedLayout = layout("selected", "/selected", { search: { tab: Schema.String } })
const SelectedIndex = SelectedLayout.index({
  search: { page: Schema.FiniteFromString },
  prepare: () => Effect.void,
  empty: true
})
type LayoutRoutes = readonly [typeof SelectedLayout, typeof SelectedIndex]
const page = Schema.decodeUnknownSync(Schema.FiniteFromString)("1")
const layoutIndexTarget: Router.PathTargets<LayoutRoutes> = { to: "/selected", search: { tab: "x", page } }
void layoutIndexTarget
// @ts-expect-error the index's own search field is required at the shared path
const layoutIndexMissing: Router.PathTargets<LayoutRoutes> = { to: "/selected", search: { tab: "x" } }
void layoutIndexMissing

// --- bound useNavigateEffect conformance ---
const Other = route("other", "/other/:otherId", {
  params: { otherId: Schema.FiniteFromString },
  component: () => null
})
const otherId = Schema.decodeUnknownSync(Schema.FiniteFromString)(1)
type BoundNavigateTarget = Parameters<ReturnType<typeof Navigation.useNavigateEffect>>[0]
// @ts-expect-error a bound effect keeps the application's exact target union
const foreignBoundTarget: BoundNavigateTarget = Other.to({ params: { otherId } })
void foreignBoundTarget
type BoundNavigateError =
  ReturnType<ReturnType<typeof Navigation.useNavigateEffect>> extends Effect.Effect<infer _A, infer E, infer _R>
    ? E
    : never
// The error channel is the application's typed navigation error, never `unknown`.
const errorIsNotUnknown: unknown extends BoundNavigateError ? "error is unknown" : true = true
void errorIsNotUnknown
