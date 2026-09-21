import { MemoryHistory, type Route, type RouteTree } from "@effect-stack/router"
import { createRootRoute, createRoute, createRouter } from "@effect-stack/router-react"
import { Context, Effect, Layer } from "effect"
import { describe, expect, test } from "tstyche"

class Connection extends Context.Service<Connection, { readonly name: string }>()("test/Connection") {}
class Projects extends Context.Service<Projects, { readonly title: string }>()("test/Projects") {}
const connection = Layer.succeed(Connection, Connection.of({ name: "connection" }))
const projects = Layer.effect(
  Projects,
  Effect.gen(function*() {
    const service = yield* Connection
    return Projects.of({ title: service.name })
  })
)
const root = createRootRoute({ loader: () => Connection.use((service) => Effect.succeed(service.name)) })
const child = createRoute({
  getParentRoute: () => root,
  path: "projects",
  lazy: () => Projects.use((service) => Effect.succeed({ title: service.title })),
  loader: () => Effect.addFinalizer(() => Effect.void)
})
const routeTree = root.addChildren([child])

describe("Effect Layer requirements", () => {
  test("combines ancestor and lazy-module services while supplying the loader Scope", () => {
    expect<Route.Route.Services<RouteTree.All<typeof routeTree>>>().type.toBe<Connection | Projects>()
    expect(createRouter).type.not.toBeCallableWith({ routeTree, history: MemoryHistory.layer() })
    expect(createRouter).type.not.toBeCallableWith({ routeTree, layer: connection })
    expect(createRouter).type.not.toBeCallableWith({ routeTree, layer: projects })
    expect(createRouter).type.not.toBeCallableWith({ routeTree, layer: Layer.merge(connection, projects) })
    expect(createRouter).type.toBeCallableWith({
      routeTree,
      history: MemoryHistory.layer(),
      layer: Layer.merge(connection, projects.pipe(Layer.provide(connection)))
    })
  })
})
