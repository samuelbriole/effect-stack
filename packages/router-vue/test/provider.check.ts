/**
 * Compile-time provider and bound-helper checks. Typechecked by `pnpm check`;
 * not run by Vitest.
 */
import * as Layer from "effect/Layer"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Atom from "effect/reactivity/Atom"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import type * as Router from "@effect-stack/router/Router"
import * as Context from "effect/Context"
import {
  RouterProvider,
  layer,
  useRouteInput,
  useNavigateEffect,
  makeNavigation,
  layout,
  make,
  route
} from "@effect-stack/router-vue"
import { h } from "vue"

const Home = route("home", "/", { render: () => null })
const Project = route("project", "/projects/:projectId", {
  params: { projectId: Schema.FiniteFromString },
  render: () => "project"
})

const App = Effect.runSync(make("Vue", [Home, Project]))
const AppLive = layer(Effect.succeed(App)).pipe(Layer.provide(MemoryHistory.layer()))

h(RouterProvider, { runtime: Atom.runtime(AppLive) })
RouterProvider({ runtime: Atom.runtime(AppLive) })
// @ts-expect-error The provider runtime must supply the standard selected application tag.
h(RouterProvider, { runtime: Atom.runtime(Layer.empty) })
// @ts-expect-error Direct calls reject a missing standard tag.
RouterProvider({ runtime: Atom.runtime(Layer.empty) })
const appOnlyRuntime = Atom.runtime(App.layer.pipe(Layer.provide(MemoryHistory.layer())))
// @ts-expect-error A dynamic application service does not supply the standard tag.
h(RouterProvider, { runtime: appOnlyRuntime })
// @ts-expect-error Direct calls reject app.layer-only runtimes.
RouterProvider({ runtime: appOnlyRuntime })
// @ts-expect-error The old application prop is not part of the provider API.
RouterProvider({ app: App, runtime: Atom.runtime(AppLive) })

class Domain extends Context.Service<Domain, {}>()("check/VueDomain") {}
const services = Layer.merge(MemoryHistory.layer(), Layer.succeed(Domain, {}))
const extendedLayer = layer(Domain.pipe(Effect.as(App))).pipe(Layer.provideMerge(services))
const extendedRuntime = Atom.runtime(extendedLayer)
RouterProvider({ runtime: extendedRuntime })
h(RouterProvider, { runtime: extendedRuntime })
h(RouterProvider<Layer.Success<typeof extendedLayer>>, { runtime: extendedRuntime })
const failingRuntime = Atom.runtime(
  layer(Effect.fail("startup").pipe(Effect.andThen(Effect.succeed(App)))).pipe(Layer.provide(services))
)
RouterProvider({ runtime: failingRuntime })
h(RouterProvider, { runtime: failingRuntime })

h(makeNavigation(App).Link, { to: Home.to() })
h(makeNavigation(App).Navigate, { to: Home.to(), replace: true })

const Other = route("other", "/other/:otherId", {
  params: { otherId: Schema.FiniteFromString },
  render: () => null
})
h(makeNavigation(App).Link, {
  // @ts-expect-error Bound links reject destinations outside the selection.
  to: Other.to({ params: { otherId: Schema.decodeUnknownSync(Schema.FiniteFromString)(1) } })
})

// An index endpoint carries its own hash through destinations and computed refs.
const HashParent = layout("hashParent", "/hash-parent", {})
const HashedIndex = HashParent.index({
  hash: Schema.String,
  prepare: () => Effect.void
})
const HashApp = Effect.runSync(make("VueHash", [HashedIndex]))
void HashApp
const hashInput = useRouteInput(HashedIndex)
const hashValue: string = hashInput.value.hash
void hashValue
HashedIndex.to({ hash: "section" })
// @ts-expect-error the index hash destination requires its declared hash
HashedIndex.to({})

// Typed path navigation on the bound link.
const projectIdPath = Schema.decodeUnknownSync(Schema.FiniteFromString)(1)
h(makeNavigation(App).Link, { to: "/projects/:projectId", params: { projectId: projectIdPath } })
// @ts-expect-error an unknown path template is not a selected endpoint
h(makeNavigation(App).Link, { to: "/nope" })
// @ts-expect-error a path param keeps its decoded type
h(makeNavigation(App).Link, { to: "/projects/:projectId", params: { projectId: "nope" } })

// --- explicitly selected layout kind ---
const LayoutOnly = layout("layoutOnly", "/layout-only", {})
type LayoutOnlyPaths = Router.PathsOf<readonly [typeof LayoutOnly]>
// @ts-expect-error a selected layout is not a navigable endpoint
const layoutOnlyPath: LayoutOnlyPaths = "/layout-only"
void layoutOnlyPath

const SelectedLayout = layout("selected", "/selected", { search: { tab: Schema.String } })
const SelectedIndex = SelectedLayout.index({
  search: { page: Schema.FiniteFromString },
  prepare: () => Effect.void
})
type LayoutRoutes = readonly [typeof SelectedLayout, typeof SelectedIndex]
const page = Schema.decodeUnknownSync(Schema.FiniteFromString)("1")
const layoutIndexTarget: Router.PathTargets<LayoutRoutes> = { to: "/selected", search: { tab: "x", page } }
void layoutIndexTarget
// @ts-expect-error the index's own search field is required at the shared path
const layoutIndexMissing: Router.PathTargets<LayoutRoutes> = { to: "/selected", search: { tab: "x" } }
void layoutIndexMissing

// --- bound useNavigateEffect conformance ---
const otherId = Schema.decodeUnknownSync(Schema.FiniteFromString)(1)
const boundNavigate = useNavigateEffect(App)
type BoundNavigateTarget = Parameters<typeof boundNavigate>[0]
// @ts-expect-error a bound effect keeps the application's exact target union
const foreignBoundTarget: BoundNavigateTarget = Other.to({ params: { otherId } })
void foreignBoundTarget
type BoundNavigateError =
  ReturnType<typeof boundNavigate> extends Effect.Effect<infer _A, infer E, infer _R> ? E : never
// The error channel is the application's typed navigation error, never `unknown`.
const errorIsNotUnknown: unknown extends BoundNavigateError ? "error is unknown" : true = true
void errorIsNotUnknown
