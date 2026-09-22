import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { expect, test } from "tstyche"
import type { AnyNode, Destination, HandlerInputOf, ServiceIdOf } from "@effect-stack/router/Router"
import * as MemoryHistory from "@effect-stack/router/MemoryHistory"
import * as Route from "@effect-stack/router/Route"
import * as RouteGroup from "@effect-stack/router/RouteGroup"
import * as Router from "@effect-stack/router/Router"

const ProjectId = Schema.FiniteFromString.pipe(Schema.brand("ProjectId"))
const projectId = Schema.decodeUnknownSync(ProjectId)(1)

const Routes = Router.make("App").add(
  Route.make("home", "/"),
  Route.make("project", "/projects/:projectId", {
    params: { projectId: ProjectId },
    search: { tab: Schema.optionalKey(Schema.Literals(["overview", "activity"])) },
    success: Schema.Struct({ title: Schema.String }),
    error: Schema.Struct({ code: Schema.Number })
  }),
  Route.make("login", "/login", {
    search: { returnTo: Schema.optionalKey(Schema.String) }
  })
)

const Other = Router.make("Other").add(
  Route.make("home", "/"),
  Route.make("project", "/projects/:projectId", {
    params: { projectId: Schema.FiniteFromString },
    success: Schema.Struct({ name: Schema.String })
  })
)

const Nested = Router.make("Nested").add(
  Route.make("home", "/"),
  RouteGroup.make("projects")
    .add(
      Route.make("index", "/"),
      Route.make("detail", "/:projectId", {
        params: { projectId: ProjectId },
        success: Schema.Struct({ title: Schema.String })
      })
    )
    .prefix("/projects")
)

test("string routes take no input", () => {
  expect(Routes.home).type.toBeCallableWith()
  expect(Routes.home()).type.toBeAssignableTo<Destination<string>>()
})

test("typed destinations require declared params and accept optional search", () => {
  expect(Routes.project).type.toBeCallableWith({ params: { projectId }, search: { tab: "activity" } })
  expect(Routes.project).type.toBeCallableWith({ params: { projectId } })
})

test("nested contracts expose inherited inputs", () => {
  expect(Nested.projects.detail).type.toBeCallableWith({ params: { projectId } })
  expect(Nested.projects.index).type.toBeCallableWith()
})

test("direct handlers infer their input", () => {
  Router.route(Routes.project, (input) => {
    expect(input).type.toBe<HandlerInputOf<typeof Routes.project>>()
    return Effect.succeed({ title: String(input.params.projectId) })
  })
})

test("effectful handler factories are supported through the builder", () => {
  Router.route(Routes.project).buildEffect(
    Effect.succeed((input: HandlerInputOf<typeof Routes.project>) =>
      Effect.succeed({ title: String(input.params.projectId) })
    )
  )
})

test("declared success handlers are accepted", () => {
  Router.route(Routes.project, () => Effect.succeed({ title: "ok" }))
})

test("missing mandatory implementations remain a Layer requirement", () => {
  const incomplete = Router.layer(Routes).pipe(Layer.provide(MemoryHistory.layer()))
  expect(incomplete).type.not.toBeAssignableTo<Layer.Layer<ServiceIdOf<typeof Routes>>>()
})

test("same local route names in separate collections stay distinct", () => {
  expect(Routes.project({ params: { projectId } })).type.toBeAssignableTo<Destination<string>>()
  expect(Other.project({ params: { projectId: 1 } })).type.toBeAssignableTo<Destination<string>>()
})

test("group layouts and node data are addressable", () => {
  expect(Nested.projects.detail).type.toBeCallableWith({ params: { projectId } })
  expect(Nested.projects.detail({ params: { projectId } })).type.toBeAssignableTo<Destination<string>>()
})

test("standalone declarations and groups are not callable destinations", () => {
  const declaration = Route.make("detail", "/:projectId", { params: { projectId: ProjectId } })
  expect(declaration).type.not.toBeAssignableTo<(...args: never) => unknown>()
  expect(Nested.projects).type.not.toBeAssignableTo<(...args: never) => unknown>()
})

test("cross-collection destinations and raw declarations stay distinct", () => {
  expect(Routes.project({ params: { projectId } })).type.toBeAssignableTo<Destination<"App">>()
  expect(Other.project({ params: { projectId: 1 } })).type.not.toBeAssignableTo<Destination<"App">>()
  expect(Route.make("detail", "/:projectId", { params: { projectId: ProjectId } })).type.not.toBeAssignableTo<AnyNode>()
  expect(Routes.project).type.toBeAssignableTo<AnyNode>()
})

test("group inputs inherit to independently declared descendants", () => {
  const Grouped = Router.make("Grouped").add(
    RouteGroup.make("org", { params: { projectId: ProjectId } })
      .add(
        Route.make("detail", "/:detailId", {
          params: { detailId: Schema.String },
          success: Schema.Struct({ value: Schema.String })
        })
      )
      .prefix("/org/:projectId")
  )
  expect(Grouped.org.detail).type.toBeCallableWith({ params: { projectId, detailId: "d" } })
  expect(Grouped.org.detail).type.not.toBeCallableWith({ params: { detailId: "d" } })
})
