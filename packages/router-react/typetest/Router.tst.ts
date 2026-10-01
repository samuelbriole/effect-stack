import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
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
const App = make("React", [Home, Project])
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
test("index hash stays exact through useRouteInput", () => {
  const Parent = layout("hash", "/hash", { component: () => null })
  const Index = Parent.index({ hash: Schema.String, component: () => null })
  const HashApp = make("Hash", [Index])
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
