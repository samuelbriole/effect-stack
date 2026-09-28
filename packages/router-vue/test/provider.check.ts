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
import {
  Provider,
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

const App = make("Vue", [Home, Project])
const AppLive = App.layer.pipe(Layer.provide(MemoryHistory.layer()))

h(Provider<typeof App>, { app: App, runtime: Atom.runtime(AppLive) })
Provider({ app: App, runtime: Atom.runtime(AppLive) })
// @ts-expect-error The provider runtime must supply the application's service.
h(Provider<typeof App>, { app: App, runtime: Atom.runtime(Layer.empty) })
// @ts-expect-error Direct calls infer application authority from app, not runtime.
Provider({ app: App, runtime: Atom.runtime(Layer.empty) })
const AnotherApp = make("AnotherVue", [Home])
const anotherRuntime = Atom.runtime(AnotherApp.layer.pipe(Layer.provide(MemoryHistory.layer())))
// @ts-expect-error Same definitions cannot substitute a different application service.
h(Provider<typeof App>, { app: App, runtime: anotherRuntime })
// @ts-expect-error Direct provider calls reject a different application runtime.
Provider({ app: App, runtime: anotherRuntime })

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
const HashApp = make("VueHash", [HashedIndex])
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
