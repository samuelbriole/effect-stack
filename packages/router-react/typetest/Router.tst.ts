import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Atom from "effect/reactivity/Atom"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import type { ComponentProps, ReactNode } from "react"
import { expect, test } from "tstyche"
import type * as Router from "@effect-stack/router/Router"
import * as ReactRouter from "@effect-stack/router-react"
import { layout, make, makeNavigation, route, useRouteInput, useNavigateEffect } from "@effect-stack/router-react"

const WorkspaceId = Schema.FiniteFromString.pipe(Schema.brand("WorkspaceId"))
const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
const Home = route("home", "/", { component: () => null })
class Dep extends Context.Service<Dep, {}>()("type/ReactDep") {}
class Missing extends Schema.TaggedError<Missing>()("Missing", {}) {}
const Workspace = layout("workspace", "/workspaces/:workspaceId", {
  params: { workspaceId: WorkspaceId },
  component: () => null,
  prepare: () => Effect.asVoid(Dep)
})
const Project = Workspace.route("project", "/projects/:projectId", {
  params: { projectId: ProjectId },
  prepare: () => Effect.fail(new Missing()),
  component: () => null
})
const assembly = make("React", [Home, Project])
const App = Effect.runSync(assembly)
test("inherited hash stays exact in native gates, hooks, index, and overrides", () => {
  const Parent = layout("inheritedHash", "/inherited-hash", { hash: ProjectId })
  const Nested = Parent.layout("nested", "/nested", {
    prepare: ({ hash }) => {
      expect(hash).type.toBe<typeof ProjectId.Type>()
      return Effect.void
    }
  })
  const Child = Nested.route("child", "/child", {
    empty: true,
    prepare: ({ hash }) => {
      expect(hash).type.toBe<typeof ProjectId.Type>()
      return Effect.void
    }
  })
  const Index = Nested.index({
    empty: true,
    prepare: ({ hash }) => {
      expect(hash).type.toBe<typeof ProjectId.Type>()
      return Effect.void
    }
  })
  expect(useRouteInput(Child).hash).type.toBe<typeof ProjectId.Type>()
  expect(useRouteInput(Index).hash).type.toBe<typeof ProjectId.Type>()
  expect(useRouteInput(Child)).type.toBe<Router.DecodedRouteInputOfDef<typeof Child>>()
  expect(useRouteInput(Index)).type.toBe<Router.DecodedRouteInputOfDef<typeof Index>>()
  expect(Child.to).type.not.toBeCallableWith({})
  expect(Index.to).type.not.toBeCallableWith({})
  const Override = Nested.route("override", "/override", {
    hash: Schema.String,
    empty: true,
    prepare: ({ hash }) => {
      expect(hash).type.toBe<string>()
      return Effect.void
    }
  })
  expect(useRouteInput(Override).hash).type.toBe<string>()
  expect(useRouteInput(Override)).type.toBe<Router.DecodedRouteInputOfDef<typeof Override>>()
})
test("useRouteInput is the sole decoded input hook and preserves exact inference", () => {
  expect(assembly).type.toBe<Effect.Effect<Router.ApplicationOf<"React", readonly [typeof Home, typeof Project]>>>()
  expect<Effect.Error<typeof assembly>>().type.toBe<never>()
  expect<Effect.Services<typeof assembly>>().type.toBe<never>()
  expect(ReactRouter).type.not.toHaveProperty("useRoute")
  expect(useRouteInput(Project)).type.toBe<Router.DecodedRouteInputOfDef<typeof Project>>()
  expect(useRouteInput(Project).params).type.toBe<Router.ParamsOfDef<typeof Project>>()
  expect<Router.ErrorOf<typeof Project>>().type.toBe<Missing>()
  expect<Router.RequirementsOf<typeof Project>>().type.toBe<never>()
  expect<Router.ApplicationRequirementsOf<typeof App>>().type.toBe<Dep>()
  expect<Router.ApplicationErrorOf<typeof App>>().type.toBe<Missing>()
  expect<(typeof Project)["~parent"]>().type.toBe<typeof Workspace>()
})
test("supplied Layers carry natural startup errors", () => {
  class Startup extends Schema.TaggedError<Startup>()("Startup", {}) {}
  const layer = App.layer.pipe(Layer.provide(Layer.effect(Dep, Effect.fail(new Startup()))))
  expect<Layer.Error<typeof layer>>().type.toBe<Startup | Router.History.HistoryError>()
})
test("native layer preserves assembly services, typed errors, and gate evidence while owning Scope", () => {
  class AssemblyDependency extends Context.Service<AssemblyDependency, { readonly fail: boolean }>()(
    "type/ReactAssemblyDependency"
  ) {}
  class Startup extends Schema.TaggedError<Startup>()("AssemblyStartup", {}) {}
  const requiredAssembly = Effect.gen(function* () {
    yield* Scope.Scope
    const dependency = yield* AssemblyDependency
    if (dependency.fail) return yield* Effect.fail(new Startup())
    return yield* assembly
  })
  const selected = ReactRouter.layer(requiredAssembly)
  expect<Layer.Services<typeof selected>>().type.toBe<AssemblyDependency | Dep | Router.History.History>()
  expect<Layer.Error<typeof selected>>().type.toBe<Startup | Router.History.HistoryError>()
  expect<Layer.Success<typeof selected>>().type.toBe<Router.RuntimeApplication>()
})
test("runtime-only providers retain layer requirements and startup errors", () => {
  const selected = ReactRouter.layer(assembly)
  expect<Layer.Services<typeof selected>>().type.toBe<Dep | Router.History.History>()
  expect<Layer.Error<typeof selected>>().type.toBe<Router.History.HistoryError>()
  const live = selected.pipe(Layer.provide(Layer.merge(MemoryHistory.layer(), Layer.succeed(Dep, {}))))
  const runtime = Atom.runtime(live)
  expect(ReactRouter.RouterProvider).type.toBeCallableWith({ runtime })
  expect(ReactRouter.RouterProvider).type.not.toBeCallableWith({
    runtime: Atom.runtime(Layer.empty)
  })
  expect(ReactRouter.RouterProvider).type.not.toBeCallableWith({
    runtime: Atom.runtime(App.layer.pipe(Layer.provide(Layer.merge(MemoryHistory.layer(), Layer.succeed(Dep, {})))))
  })
  expect(ReactRouter).type.not.toHaveProperty("Provider")
  expect<keyof ReactRouter.RouterProviderProps<Router.RuntimeApplication, never>>().type.toBe<"runtime" | "pending">()
  class Startup extends Schema.TaggedError<Startup>()("Startup", {}) {}
  const startup = selected.pipe(
    Layer.provideMerge(Layer.merge(MemoryHistory.layer(), Layer.effect(Dep, Effect.fail(new Startup()))))
  )
  expect(ReactRouter.RouterProvider).type.toBeCallableWith({ runtime: Atom.runtime(startup) })
  expect<Layer.Success<typeof selected>>().type.toBe<Router.RuntimeApplication>()
  const navigation = makeNavigation<Effect.Success<typeof assembly>>()
  expect(navigation.useNavigateEffect()).type.toBe<
    (
      target: Router.NavigateTarget<typeof App.routes>,
      options?: Router.NavigateOptions
    ) => Effect.Effect<Router.NavigationOutcome, Router.NavigationError<Missing>>
  >()
  expect<ReturnType<typeof navigation.useNavigate>>().type.toBe<
    (
      target: Router.NavigateTarget<typeof App.routes>,
      options?: Router.NavigateOptions
    ) => Promise<Router.NavigationOutcome>
  >()
})
test("index hash stays exact through useRouteInput", () => {
  const Parent = layout("hash", "/hash", { component: () => null })
  const Index = Parent.index({ hash: Schema.String, component: () => null })
  const HashApp = Effect.runSync(make("Hash", [Index]))
  expect<Router.RoutesOf<typeof HashApp>>().type.toBe<readonly [typeof Index]>()
  expect(useRouteInput(Index).hash).type.toBe<string>()
  expect(Index.to).type.toBeCallableWith({ hash: "deep" })
})
test("component-first order does not introduce an inferred application cycle", () => {
  const First = route("first", "/first/:id", {
    component: (): ReactNode => String(useRouteInput(First).params.id),
    params: { id: ProjectId },
    prepare: () => Effect.void
  })
  expect<Router.ParamsOfDef<typeof First>>().type.toBe<{ readonly id: typeof ProjectId.Type }>()
})
test("type-only navigation preserves correlated endpoint targets", () => {
  const navigation = makeNavigation<typeof App>()
  type Props = ComponentProps<typeof navigation.Link>
  expect<{
    to: "/workspaces/:workspaceId/projects/:projectId"
    params: Router.ParamsOfDef<typeof Project>
  }>().type.toBeAssignableTo<Props>()
  expect<{ to: "/nope" }>().type.not.toBeAssignableTo<Props>()
})
test("bound navigation preserves exact targets and typed domain errors", () => {
  const navigate = useNavigateEffect(App)
  const bound = makeNavigation(App)
  expect<Parameters<typeof navigate>[0]>().type.toBe<Router.NavigateTarget<typeof App.routes>>()
  expect<Effect.Error<ReturnType<typeof navigate>>>().type.toBe<
    Router.NavigationError<Router.ApplicationErrorOf<typeof App>>
  >()
  expect(bound.useNavigateEffect()).type.toBe<typeof navigate>()
  const Foreign = route("foreign", "/foreign", { component: () => null })
  expect(Foreign.to()).type.not.toBeAssignableTo<Router.DestinationOf<typeof App.routes>>()
})
test("component-first and error-first order keeps contextual gate inference", () => {
  const ErrorFirst = route("errorFirst", "/error-first", {
    error: ({ failure }) => {
      if (failure._tag === "Domain") expect(failure.error).type.toBe<Missing>()
      return null
    },
    component: () => null,
    prepare: () => Effect.fail(new Missing())
  })
  expect<Router.ErrorOf<typeof ErrorFirst>>().type.toBe<Missing>()
})
